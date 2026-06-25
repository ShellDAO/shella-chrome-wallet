import { ed25519 } from '@noble/curves/ed25519.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import type { WalletTxRecord } from '../types.js';

const ED25519_SEED_KEY = new TextEncoder().encode('ed25519 seed');
const NANOTONS_PER_TON = 1_000_000_000n;
const TON_WALLET_V4R2_WALLET_ID = 698983191;
const DEFAULT_JETTON_TRANSFER_TON_AMOUNT = 50_000_000n;
const DEFAULT_JETTON_FORWARD_TON_AMOUNT = 1n;
const TON_WALLET_V4R2_CODE_BOC = 'te6ccgECFAEAAtQAART/APSkE/S88sgLAQIBIAIDAgFIBAUE+PKDCNcYINMf0x/THwL4I7vyZO1E0NMf0x/T//QE0VFDuvKhUVG68qIF+QFUEGT5EPKj+AAkpMjLH1JAyx9SMMv/UhD0AMntVPgPAdMHIcAAn2xRkyDXSpbTB9QC+wDoMOAhwAHjACHAAuMAAcADkTDjDQOkyMsfEssfy/8QERITAubQAdDTAyFxsJJfBOAi10nBIJJfBOAC0x8hghBwbHVnvSKCEGRzdHK9sJJfBeAD+kAwIPpEAcjKB8v/ydDtRNCBAUDXIfQEMFyBAQj0Cm+hMbOSXwfgBdM/yCWCEHBsdWe6kjgw4w0DghBkc3RyupJfBuMNBgcCASAICQB4AfoA9AQw+CdvIjBQCqEhvvLgUIIQcGx1Z4MesXCAGFAEywUmzxZY+gIZ9ADLaRfLH1Jgyz8gyYBA+wAGAIpQBIEBCPRZMO1E0IEBQNcgyAHPFvQAye1UAXKwjiOCEGRzdHKDHrFwgBhQBcsFUAPPFiP6AhPLassfyz/JgED7AJJfA+ICASAKCwBZvSQrb2omhAgKBrkPoCGEcNQICEekk30pkQzmkD6f+YN4EoAbeBAUiYcVnzGEAgFYDA0AEbjJftRNDXCx+AA9sp37UTQgQFA1yH0BDACyMoHy//J0AGBAQj0Cm+hMYAIBIA4PABmtznaiaEAga5Drhf/AABmvHfaiaEAQa5DrhY/AAG7SB/oA1NQi+QAFyMoHFcv/ydB3dIAYyMsFywIizxZQBfoCFMtrEszMyXP7AMhAFIEBCPRR8qcCAHCBAQjXGPoA0z/IVCBHgQEI9FHyp4IQbm90ZXB0gBjIywXLAlAGzxZQBPoCFMtqEssfyz/Jc/sAAgBsgQEI1xj6ANM/MFIkgQEI9Fnyp4IQZHN0cnB0gBjIywXLAlAFzxZQA/oCE8tqyx8Syz/Jc/sAAAr0AMntVA==';
const TON_WALLET_V4R2_CODE_HASH = hexToBytes('feb5ff6820e2ff0d9483e7e0d62c817d846789fb4ae580c878866d959dabd5c0');
const TON_WALLET_V4R2_CODE_DEPTH = 7;
let tonWalletV4CodeCellCache: TonCell | null = null;

export interface TonKeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  address: string;
}

export interface TonTransferResult {
  txHash: string;
  amountNanotons: string;
  seqno: number;
}

export interface TonInternalMessage {
  to: string;
  amountNanotons: bigint;
  body?: TonCell;
  stateInit?: TonCell;
  sendMode?: number;
}

export interface TonJettonInfo {
  contractAddress: string;
  walletAddress: string;
  decimals: number;
  symbol: string;
}

export interface TonTransactionStatus {
  status: 'pending' | 'confirmed' | 'failed';
  blockNumber?: string | null;
  error?: string;
}

export function deriveTonAddress(seed: Uint8Array, accountIndex: number): string {
  const keyPair = deriveTonKeyPair(seed, accountIndex);
  keyPair.privateKey.fill(0);
  keyPair.publicKey.fill(0);
  return keyPair.address;
}

export function deriveTonKeyPair(seed: Uint8Array, accountIndex: number): TonKeyPair {
  const privateKey = deriveSlip10Ed25519(seed, [44, 607, accountIndex]);
  const publicKey = ed25519.getPublicKey(privateKey);
  return {
    privateKey,
    publicKey,
    address: tonWalletAddress(publicKey),
  };
}

export function isTonAddress(value: string): boolean {
  try {
    parseTonAddress(value);
    return true;
  } catch {
    return false;
  }
}

export function parseTon(value: string): bigint {
  const trimmed = value.trim();
  if (trimmed === '') throw new Error('Amount is required');
  if (trimmed.startsWith('-')) throw new Error('Amount must be non-negative');
  const [whole, fraction = ''] = trimmed.split('.');
  if (!/^\d+$/.test(whole || '0') || !/^\d*$/.test(fraction) || fraction.length > 9) {
    throw new Error('TON amount must have at most 9 decimal places');
  }
  return BigInt(whole || '0') * NANOTONS_PER_TON + BigInt(fraction.padEnd(9, '0') || '0');
}

export async function getTonBalance(apiUrl: string, address: string): Promise<{ balance: string; formatted: string }> {
  if (!isTonAddress(address)) throw new Error('Invalid TON address');
  const url = `${apiUrl.replace(/\/+$/, '')}/getAddressBalance?address=${encodeURIComponent(address)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ton balance request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as { ok?: boolean; result?: string; balance?: string };
  const raw = data.result ?? data.balance ?? '0';
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) throw new Error('TON balance response is invalid');
  return { balance: raw, formatted: formatTon(BigInt(raw)) };
}

export function formatTon(nanotons: bigint): string {
  const whole = nanotons / NANOTONS_PER_TON;
  const fraction = (nanotons % NANOTONS_PER_TON).toString().padStart(9, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export async function sendTonTransfer(input: {
  apiUrl: string;
  privateKey: Uint8Array;
  from: string;
  to: string;
  amountNanotons: bigint;
  body?: TonCell;
  stateInit?: TonCell;
}): Promise<TonTransferResult> {
  return sendTonInternalMessages({
    apiUrl: input.apiUrl,
    privateKey: input.privateKey,
    from: input.from,
    messages: [{
      to: input.to,
      amountNanotons: input.amountNanotons,
      body: input.body,
      stateInit: input.stateInit,
    }],
  });
}

export async function sendTonInternalMessages(input: {
  apiUrl: string;
  privateKey: Uint8Array;
  from: string;
  messages: TonInternalMessage[];
}): Promise<TonTransferResult> {
  if (!isTonAddress(input.from)) throw new Error('Invalid TON sender address');
  if (input.messages.length === 0) throw new Error('TON transaction must contain at least one message');
  if (input.messages.length > 4) throw new Error('TON transaction cannot contain more than 4 messages');
  for (const message of input.messages) {
    if (!isTonAddress(message.to)) throw new Error('Invalid TON recipient address');
    if (message.amountNanotons <= 0n) throw new Error('Amount must be greater than zero');
    if (message.sendMode !== undefined && (!Number.isSafeInteger(message.sendMode) || message.sendMode < 0 || message.sendMode > 255)) {
      throw new Error('TON send mode must be between 0 and 255');
    }
  }
  const publicKey = ed25519.getPublicKey(input.privateKey);
  const walletState = await getTonWalletState(input.apiUrl, input.from);
  const message = buildTonWalletV4Transfer({
    privateKey: input.privateKey,
    publicKey,
    messages: input.messages,
    seqno: walletState.seqno,
    includeStateInit: walletState.needsStateInit,
    timeout: Math.floor(Date.now() / 1000) + 300,
  });
  const boc = tonCellToBoc(message);
  await tonCenterGet(input.apiUrl, 'sendBoc', { boc: bytesToBase64(boc) });
  return {
    txHash: bytesToHex(message.hash),
    amountNanotons: input.messages.reduce((sum, item) => sum + item.amountNanotons, 0n).toString(),
    seqno: walletState.seqno,
  };
}

export function parseTonPayloadCell(value: string): TonCell {
  return parseStackCell(value);
}

export async function getTonJettonInfo(apiUrl: string, masterAddress: string, ownerAddress: string): Promise<TonJettonInfo> {
  if (!isTonAddress(masterAddress)) throw new Error('Invalid Jetton master address');
  if (!isTonAddress(ownerAddress)) throw new Error('Invalid TON owner address');
  const walletAddress = await getTonJettonWalletAddress(apiUrl, masterAddress, ownerAddress);
  const metadata = await getTonJettonMetadata(apiUrl, masterAddress).catch(() => ({ symbol: 'JETTON', decimals: 9 }));
  return {
    contractAddress: normalizeTonAddress(masterAddress),
    walletAddress,
    decimals: metadata.decimals,
    symbol: metadata.symbol,
  };
}

export async function getTonJettonBalance(input: {
  apiUrl: string;
  masterAddress: string;
  ownerAddress: string;
  decimals?: number;
  symbol?: string;
}): Promise<{ balance: string; formatted: string; decimals: number; symbol: string }> {
  if (!isTonAddress(input.masterAddress)) throw new Error('Invalid Jetton master address');
  if (!isTonAddress(input.ownerAddress)) throw new Error('Invalid TON owner address');
  const info = await getTonJettonInfo(input.apiUrl, input.masterAddress, input.ownerAddress);
  const walletData = await runTonGetMethod(input.apiUrl, info.walletAddress, 'get_wallet_data');
  const balance = stackNumber(walletData.stack?.[0], 'Jetton wallet balance');
  const decimals = input.decimals ?? info.decimals;
  const symbol = input.symbol ?? info.symbol;
  return {
    balance: balance.toString(),
    formatted: formatJettonAmount(balance, decimals),
    decimals,
    symbol,
  };
}

export async function sendTonJettonTransfer(input: {
  apiUrl: string;
  privateKey: Uint8Array;
  from: string;
  masterAddress: string;
  to: string;
  amountBaseUnits: bigint;
  jettonTransferTonAmount?: bigint;
  forwardTonAmount?: bigint;
}): Promise<TonTransferResult & { jettonWalletAddress: string }> {
  if (!isTonAddress(input.from)) throw new Error('Invalid TON sender address');
  if (!isTonAddress(input.masterAddress)) throw new Error('Invalid Jetton master address');
  if (!isTonAddress(input.to)) throw new Error('Invalid TON recipient address');
  if (input.amountBaseUnits <= 0n) throw new Error('Amount must be greater than zero');
  const jettonTransferTonAmount = input.jettonTransferTonAmount ?? DEFAULT_JETTON_TRANSFER_TON_AMOUNT;
  const forwardTonAmount = input.forwardTonAmount ?? DEFAULT_JETTON_FORWARD_TON_AMOUNT;
  if (jettonTransferTonAmount <= 0n) throw new Error('Jetton transfer TON fee must be greater than zero');
  if (forwardTonAmount < 0n) throw new Error('Jetton forward TON amount must be non-negative');
  if (jettonTransferTonAmount <= forwardTonAmount) {
    throw new Error('Jetton transfer TON fee must be greater than forward amount');
  }
  const tonBalance = BigInt((await getTonBalance(input.apiUrl, input.from)).balance);
  if (tonBalance < jettonTransferTonAmount) {
    throw new Error('Insufficient TON balance for Jetton transfer fee');
  }

  const publicKey = ed25519.getPublicKey(input.privateKey);
  const walletState = await getTonWalletState(input.apiUrl, input.from);
  const jettonWalletAddress = await getTonJettonWalletAddress(input.apiUrl, input.masterAddress, input.from);
  const transferBody = buildJettonTransferBody({
    amountBaseUnits: input.amountBaseUnits,
    destination: input.to,
    responseDestination: input.from,
    forwardTonAmount,
  });
  const message = buildTonWalletV4Transfer({
    privateKey: input.privateKey,
    publicKey,
    messages: [{
      to: jettonWalletAddress,
      amountNanotons: jettonTransferTonAmount,
      body: transferBody,
    }],
    seqno: walletState.seqno,
    includeStateInit: walletState.needsStateInit,
    timeout: Math.floor(Date.now() / 1000) + 300,
  });
  const boc = tonCellToBoc(message);
  await tonCenterGet(input.apiUrl, 'sendBoc', { boc: bytesToBase64(boc) });
  return {
    txHash: bytesToHex(message.hash),
    amountNanotons: jettonTransferTonAmount.toString(),
    seqno: walletState.seqno,
    jettonWalletAddress,
  };
}

export async function getTonTransactionStatus(apiUrl: string, txHash: string, address?: string): Promise<TonTransactionStatus> {
  if (!/^[0-9a-f]{64}$/i.test(txHash)) return { status: 'pending' };
  if (!address || !isTonAddress(address)) return { status: 'pending' };
  const transactions = await getTonTransactions(apiUrl, address, 10);
  const match = transactions.find((tx) => {
    const candidates = [
      tx.transaction_id?.hash,
      tx.in_msg?.hash,
      tx.hash,
    ].filter((value): value is string => typeof value === 'string' && value.length > 0);
    return candidates.some((value) => normalizeTonHash(value) === txHash.toLowerCase());
  });
  if (!match) return { status: 'pending' };
  const failed = match.aborted === true
    || match.success === false
    || match.compute_ph?.success === false
    || (typeof match.compute_ph?.exit_code === 'number' && match.compute_ph.exit_code !== 0)
    || match.action?.success === false;
  return failed
    ? { status: 'failed', error: 'TON transaction failed' }
    : { status: 'confirmed', blockNumber: match.transaction_id?.lt ?? match.lt ?? null };
}

export async function getTonTransactionHistory(
  apiUrl: string,
  address: string,
  page = 0,
  limit = 20,
): Promise<{ txs: WalletTxRecord[]; total: number }> {
  if (!isTonAddress(address)) throw new Error('Invalid TON address');
  const safePage = Number.isInteger(page) && page > 0 ? page : 0;
  const fetchLimit = Math.min((safePage + 1) * limit, 100);
  const [transactions, jettonTxs] = await Promise.all([
    getTonTransactions(apiUrl, address, fetchLimit),
    getTonJettonTransactionHistory(apiUrl, address, fetchLimit).catch(() => []),
  ]);
  const normalized = [
    ...transactions
    .flatMap((tx) => normalizeTonHistoryTx(tx, address))
      .filter((tx): tx is WalletTxRecord => tx !== null),
    ...jettonTxs,
  ]
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const start = safePage * limit;
  const txs = normalized.slice(start, start + limit);
  return { txs, total: Math.max(normalized.length, start + txs.length) };
}

export async function getTonJettonTransactionHistoryForMaster(
  apiUrl: string,
  address: string,
  masterAddress: string,
  page = 0,
  limit = 20,
): Promise<{ txs: WalletTxRecord[]; total: number }> {
  if (!isTonAddress(address)) throw new Error('Invalid TON address');
  if (!isTonAddress(masterAddress)) throw new Error('Invalid Jetton master address');
  const safePage = Number.isInteger(page) && page > 0 ? page : 0;
  const fetchLimit = Math.min((safePage + 1) * limit, 100);
  const normalized = await getTonJettonTransactionHistory(apiUrl, address, fetchLimit, masterAddress);
  const start = safePage * limit;
  const txs = normalized
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(start, start + limit);
  return { txs, total: Math.max(normalized.length, start + txs.length) };
}

export async function getTonJettonTransactionStatusForMaster(
  apiUrl: string,
  address: string,
  masterAddress: string,
  txHash: string,
): Promise<TonTransactionStatus> {
  if (!/^[0-9a-f]{64}$/i.test(txHash)) return { status: 'pending' };
  const history = await getTonJettonTransactionHistoryForMaster(apiUrl, address, masterAddress, 0, 20);
  const match = history.txs.find((tx) => tx.txHash.toLowerCase() === txHash.toLowerCase());
  if (!match) return { status: 'pending' };
  return match.status === 'failed'
    ? { status: 'failed', error: match.error ?? 'Jetton transaction failed' }
    : { status: 'confirmed', blockNumber: match.blockNumber ?? null };
}

interface TonCenterTransaction {
  hash?: string;
  lt?: string;
  utime?: number;
  aborted?: boolean;
  success?: boolean;
  transaction_id?: {
    hash?: string;
    lt?: string;
  };
  in_msg?: {
    hash?: string;
    source?: string;
    destination?: string;
    value?: string | number;
  };
  out_msgs?: Array<{
    hash?: string;
    source?: string;
    destination?: string;
    value?: string | number;
  }>;
  compute_ph?: {
    success?: boolean;
    exit_code?: number;
  };
  action?: {
    success?: boolean;
  };
}

interface TonApiTransactionsResponse {
  transactions?: TonCenterTransaction[];
}

interface TonApiJettonHistoryResponse {
  events?: TonApiAccountEvent[];
  operations?: TonApiJettonOperation[];
}

interface TonApiAccountEvent {
  event_id?: string;
  timestamp?: number;
  actions?: TonApiAccountAction[];
}

interface TonApiAccountAction {
  type?: string;
  status?: string;
  JettonTransfer?: TonApiJettonTransferAction;
}

interface TonApiJettonTransferAction {
  amount?: string | number;
  sender?: TonApiAccountRef;
  recipient?: TonApiAccountRef;
  senders_wallet?: string;
  recipients_wallet?: string;
  jetton?: TonApiJettonRef;
}

interface TonApiJettonOperation {
  operation?: string;
  utime?: number;
  lt?: number | string;
  transaction_hash?: string;
  amount?: string | number;
  source?: TonApiAccountRef;
  destination?: TonApiAccountRef;
  jetton?: TonApiJettonRef;
}

interface TonApiAccountRef {
  address?: string;
}

interface TonApiJettonRef {
  address?: string;
  symbol?: string;
  decimals?: string | number;
}

async function getTonTransactions(apiUrl: string, address: string, limit: number): Promise<TonCenterTransaction[]> {
  try {
    return await tonCenterGet<TonCenterTransaction[]>(apiUrl, 'getTransactions', {
      address,
      limit: String(limit),
      archival: 'true',
    });
  } catch {
    const base = tonApiBaseUrl(apiUrl);
    const url = `${base}/v2/blockchain/accounts/${encodeURIComponent(toTonRawAddress(address))}/transactions?limit=${encodeURIComponent(String(limit))}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`tonapi request failed: ${res.status} ${res.statusText}`);
    const data = await res.json() as TonApiTransactionsResponse;
    if (!Array.isArray(data.transactions)) throw new Error('TON API transactions response is invalid');
    return data.transactions;
  }
}

async function getTonJettonTransactionHistory(
  apiUrl: string,
  address: string,
  limit: number,
  masterAddress?: string,
): Promise<WalletTxRecord[]> {
  const base = tonApiBaseUrl(apiUrl);
  const account = encodeURIComponent(toTonRawAddress(address));
  const urls = masterAddress
    ? [
        `${base}/v2/jettons/${encodeURIComponent(toTonRawAddress(masterAddress))}/accounts/${account}/history?limit=${encodeURIComponent(String(limit))}`,
        `${base}/v2/accounts/${account}/jettons/${encodeURIComponent(toTonRawAddress(masterAddress))}/history?limit=${encodeURIComponent(String(limit))}`,
      ]
    : [`${base}/v2/accounts/${account}/jettons/history?limit=${encodeURIComponent(String(limit))}`];
  let lastError = '';
  for (const url of urls) {
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json() as TonApiJettonHistoryResponse;
      if (Array.isArray(data.events)) {
        return data.events.flatMap((event) => normalizeTonApiJettonEvent(event));
      }
      if (Array.isArray(data.operations)) {
        return data.operations.flatMap((operation) => normalizeTonApiJettonOperation(operation, address));
      }
      throw new Error('TON API jetton history response is invalid');
    }
    lastError = `${res.status} ${res.statusText}`;
    if (!masterAddress) break;
  }
  throw new Error(`tonapi jetton history request failed: ${lastError || 'unknown error'}`);
}

function tonApiBaseUrl(apiUrl: string): string {
  if (/testnet/i.test(apiUrl)) return 'https://testnet.tonapi.io';
  return 'https://tonapi.io';
}

async function getTonJettonMetadata(apiUrl: string, masterAddress: string): Promise<{ symbol: string; decimals: number }> {
  const base = tonApiBaseUrl(apiUrl);
  const url = `${base}/v2/jettons/${encodeURIComponent(toTonRawAddress(masterAddress))}`;
  const res = await fetch(url);
  if (res.ok) {
    const data = await res.json() as {
      metadata?: { symbol?: string; decimals?: string | number };
      symbol?: string;
      decimals?: string | number;
    };
    const symbol = sanitizeJettonSymbol(data.metadata?.symbol ?? data.symbol);
    const decimals = normalizeJettonDecimals(data.metadata?.decimals ?? data.decimals);
    return { symbol, decimals };
  }
  const onChain = await getTonJettonOnChainMetadata(apiUrl, masterAddress);
  if (onChain) return onChain;
  throw new Error(`tonapi jetton request failed: ${res.status} ${res.statusText}`);
}

async function getTonJettonWalletAddress(apiUrl: string, masterAddress: string, ownerAddress: string): Promise<string> {
  const ownerCell = createCell().storeAddress(ownerAddress).endCell();
  const result = await runTonGetMethod(apiUrl, masterAddress, 'get_wallet_address', [
    ['tvm.Slice', bytesToBase64(tonCellToBoc(ownerCell))],
  ]);
  const address = stackAddress(result.stack?.[0], 'Jetton wallet address');
  return address;
}

async function getTonJettonOnChainMetadata(apiUrl: string, masterAddress: string): Promise<{ symbol: string; decimals: number } | null> {
  const result = await runTonGetMethod(apiUrl, masterAddress, 'get_jetton_data');
  const contentCell = stackCell(result.stack?.[3]);
  if (!contentCell) return null;
  return parseTep64JettonMetadata(contentCell);
}

function toTonRawAddress(address: string): string {
  const parsed = parseTonAddress(address);
  return `${parsed.workchain}:${bytesToHex(parsed.hash)}`;
}

function normalizeTonAddress(address: string): string {
  const parsed = parseTonAddress(address);
  return toTonUserFriendlyAddress(parsed.workchain, parsed.hash, false);
}

function normalizeTonApiJettonEvent(event: TonApiAccountEvent): WalletTxRecord[] {
  const timestamp = typeof event.timestamp === 'number' && Number.isFinite(event.timestamp) ? event.timestamp * 1000 : Date.now();
  const actions = Array.isArray(event.actions) ? event.actions : [];
  return actions.flatMap((action, index) => {
    if (action.type !== 'JettonTransfer' || !action.JettonTransfer) return [];
    const transfer = action.JettonTransfer;
    const txHash = normalizeTonHistoryHash(event.event_id) ?? syntheticTonHistoryHash(`${event.event_id ?? 'jetton'}:${index}`);
    const amount = parseTonValue(transfer.amount);
    if (amount <= 0n) return [];
    const status = action.status === 'failed' ? 'failed' : 'confirmed';
    return [{
      txHash,
      chainKind: 'ton',
      from: normalizeTonAccountRef(transfer.sender) ?? normalizeTonHistoryAddress(transfer.senders_wallet) ?? '',
      to: normalizeTonAccountRef(transfer.recipient) ?? normalizeTonHistoryAddress(transfer.recipients_wallet),
      value: amount.toString(),
      data: '0x',
      createdAt: timestamp,
      updatedAt: timestamp,
      status,
      blockNumber: null,
      source: 'remote',
      shellType: 'jettonTransfer',
      error: status === 'failed' ? 'Jetton transaction failed' : undefined,
      tokenContract: normalizeTonHistoryAddress(transfer.jetton?.address) ?? null,
      tokenSymbol: sanitizeJettonSymbol(transfer.jetton?.symbol),
      tokenDecimals: normalizeJettonDecimals(transfer.jetton?.decimals),
    }];
  });
}

function normalizeTonApiJettonOperation(operation: TonApiJettonOperation, address: string): WalletTxRecord[] {
  if (operation.operation && operation.operation !== 'transfer') return [];
  const txHash = normalizeTonHistoryHash(operation.transaction_hash) ?? syntheticTonHistoryHash(`jetton:${operation.lt ?? ''}:${operation.amount ?? ''}`);
  const amount = parseTonValue(operation.amount);
  if (amount <= 0n) return [];
  const timestamp = typeof operation.utime === 'number' && Number.isFinite(operation.utime) ? operation.utime * 1000 : Date.now();
  return [{
    txHash,
    chainKind: 'ton',
    from: normalizeTonAccountRef(operation.source) ?? '',
    to: normalizeTonAccountRef(operation.destination) ?? address,
    value: amount.toString(),
    data: '0x',
    createdAt: timestamp,
    updatedAt: timestamp,
    status: 'confirmed',
    blockNumber: operation.lt == null ? null : String(operation.lt),
    source: 'remote',
    shellType: 'jettonTransfer',
    tokenContract: normalizeTonHistoryAddress(operation.jetton?.address) ?? null,
    tokenSymbol: sanitizeJettonSymbol(operation.jetton?.symbol),
    tokenDecimals: normalizeJettonDecimals(operation.jetton?.decimals),
  }];
}

function normalizeTonAccountRef(account: TonApiAccountRef | undefined): string | null {
  return normalizeTonHistoryAddress(account?.address);
}

function syntheticTonHistoryHash(value: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(value)));
}

function normalizeTonHistoryTx(tx: TonCenterTransaction, address: string): Array<WalletTxRecord | null> {
  const timestamp = typeof tx.utime === 'number' && Number.isFinite(tx.utime) ? tx.utime * 1000 : Date.now();
  const status = isTonTransactionFailed(tx) ? 'failed' : 'confirmed';
  const blockNumber = tx.transaction_id?.lt ?? tx.lt ?? null;
  const txHash = normalizeTonHistoryHash(tx.in_msg?.hash ?? tx.transaction_id?.hash ?? tx.hash);
  if (!txHash) return [];
  const outgoing = (tx.out_msgs ?? []).filter((msg) => {
    return msg.destination && parseTonValue(msg.value) > 0n;
  });
  if (outgoing.length > 0) {
    return outgoing.map((msg) => ({
      txHash,
      chainKind: 'ton',
      from: normalizeTonHistoryAddress(msg.source) ?? address,
      to: normalizeTonHistoryAddress(msg.destination),
      value: parseTonValue(msg.value).toString(),
      data: '0x',
      createdAt: timestamp,
      updatedAt: timestamp,
      status,
      blockNumber,
      source: 'remote',
      shellType: 'tonTransfer',
      error: status === 'failed' ? 'TON transaction failed' : undefined,
      tokenSymbol: 'TON',
      tokenDecimals: 9,
    }));
  }
  const incomingValue = parseTonValue(tx.in_msg?.value);
  if (incomingValue <= 0n) return [];
  return [{
    txHash,
    chainKind: 'ton',
    from: normalizeTonHistoryAddress(tx.in_msg?.source) ?? '',
    to: normalizeTonHistoryAddress(tx.in_msg?.destination) ?? address,
    value: incomingValue.toString(),
    data: '0x',
    createdAt: timestamp,
    updatedAt: timestamp,
    status,
    blockNumber,
    source: 'remote',
    shellType: 'tonTransfer',
    error: status === 'failed' ? 'TON transaction failed' : undefined,
    tokenSymbol: 'TON',
    tokenDecimals: 9,
  }];
}

function isTonTransactionFailed(tx: TonCenterTransaction): boolean {
  return tx.aborted === true
    || tx.success === false
    || tx.compute_ph?.success === false
    || (typeof tx.compute_ph?.exit_code === 'number' && tx.compute_ph.exit_code !== 0)
    || tx.action?.success === false;
}

function normalizeTonHistoryHash(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = normalizeTonHash(value);
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

function normalizeTonHistoryAddress(value: string | undefined): string | null {
  if (!value || !isTonAddress(value)) return null;
  return normalizeTonAddress(value);
}

function parseTonValue(value: string | number | undefined): bigint {
  if (value == null) return 0n;
  try {
    const parsed = BigInt(value);
    return parsed > 0n ? parsed : 0n;
  } catch {
    return 0n;
  }
}

function normalizeTonHash(value: string): string {
  if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();
  try {
    const bytes = base64ToBytes(value.replace(/-/g, '+').replace(/_/g, '/'));
    return bytes.length === 32 ? bytesToHex(bytes) : value.toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

async function getTonWalletState(apiUrl: string, address: string): Promise<{ seqno: number; needsStateInit: boolean }> {
  const info = await tonCenterGet<{
    wallet?: boolean;
    account_state?: string;
    seqno?: number | string;
  }>(apiUrl, 'getWalletInformation', { address });
  const accountState = info.account_state?.toLowerCase();
  if (accountState === 'uninitialized' || accountState === 'nonexist' || info.wallet === false) {
    return { seqno: 0, needsStateInit: true };
  }
  if (accountState && accountState !== 'active') {
    throw new Error('TON wallet must be active before sending');
  }
  const seqno: number | undefined = typeof info.seqno === 'string' ? Number(info.seqno) : info.seqno;
  if (seqno === undefined || !Number.isSafeInteger(seqno) || seqno < 0) throw new Error('TON seqno response is invalid');
  return { seqno, needsStateInit: false };
}

async function tonCenterGet<T>(apiUrl: string, method: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${apiUrl.replace(/\/+$/, '')}/${method}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`ton rpc request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as { ok?: boolean; result?: T; error?: string };
  if (data.ok === false) throw new Error(data.error ? `TON RPC failed: ${data.error}` : 'TON RPC failed');
  if (data.result === undefined) throw new Error('TON RPC response is invalid');
  return data.result;
}

async function runTonGetMethod(
  apiUrl: string,
  address: string,
  method: string,
  stack: unknown[] = [],
): Promise<{ stack?: unknown[] }> {
  const endpoint = `${apiUrl.replace(/\/+$/, '')}/runGetMethod`;
  const body = JSON.stringify({ address, method, stack });
  let res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  if (!res.ok && (res.status === 404 || res.status === 405)) {
    const url = new URL(endpoint);
    url.searchParams.set('address', address);
    url.searchParams.set('method', method);
    url.searchParams.set('stack', JSON.stringify(stack));
    res = await fetch(url.toString());
  }
  if (!res.ok) throw new Error(`ton get-method request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as { ok?: boolean; result?: { stack?: unknown[] }; stack?: unknown[]; error?: string };
  if (data.ok === false) throw new Error(data.error ? `TON get-method failed: ${data.error}` : 'TON get-method failed');
  const result = data.result ?? { stack: data.stack };
  if (!result || !Array.isArray(result.stack)) throw new Error('TON get-method response is invalid');
  return result;
}

function tonWalletAddress(publicKey: Uint8Array): string {
  const data = tonWalletV4DataCell(publicKey);
  const stateInit = tonCellHash({
    bits: Uint8Array.from([0x30]),
    bitLength: 5,
    refs: [
      { hash: TON_WALLET_V4R2_CODE_HASH, depth: TON_WALLET_V4R2_CODE_DEPTH },
      data,
    ],
  });
  return toTonUserFriendlyAddress(0, stateInit.hash, false);
}

function buildTonWalletV4Transfer(input: {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  messages: TonInternalMessage[];
  seqno: number;
  includeStateInit: boolean;
  timeout: number;
}): TonCell {
  const internalMessages = input.messages.map((message) => buildTonInternalMessage(message));
  const signingMessage = createCell()
    .storeUint(TON_WALLET_V4R2_WALLET_ID, 32)
    .storeUint(input.timeout, 32)
    .storeUint(input.seqno, 32)
    .storeUint(0, 8);
  for (let i = 0; i < internalMessages.length; i++) {
    signingMessage
      .storeUint(input.messages[i].sendMode ?? 3, 8)
      .storeRef(internalMessages[i]);
  }
  const signingMessageCell = signingMessage.endCell();
  const signature = ed25519.sign(signingMessageCell.hash, input.privateKey);
  const body = createCell()
    .storeBytes(signature)
    .storeCell(signingMessageCell)
    .endCell();
  return createCell()
    .storeUint(2, 2)
    .storeAddressNone()
    .storeAddress(tonWalletAddress(input.publicKey))
    .storeCoins(0n)
    .storeOptionalRef(input.includeStateInit ? tonWalletV4StateInit(input.publicKey) : null)
    .storeBit(true)
    .storeRef(body)
    .endCell();
}

function buildTonInternalMessage(input: TonInternalMessage): TonCell {
  const internalMessage = createCell()
    .storeBit(false)
    .storeBit(true)
    .storeBit(false)
    .storeBit(false)
    .storeAddressNone()
    .storeAddress(input.to)
    .storeCoins(input.amountNanotons)
    .storeBit(false)
    .storeCoins(0n)
    .storeCoins(0n)
    .storeUint(0n, 64)
    .storeUint(0, 32)
    .storeOptionalRef(input.stateInit ?? null)
    .storeBit(Boolean(input.body));
  if (input.body) internalMessage.storeRef(input.body);
  return internalMessage.endCell();
}

function buildJettonTransferBody(input: {
  amountBaseUnits: bigint;
  destination: string;
  responseDestination: string;
  forwardTonAmount: bigint;
}): TonCell {
  return createCell()
    .storeUint(0x0f8a7ea5, 32)
    .storeUint(BigInt(Date.now()), 64)
    .storeCoins(input.amountBaseUnits)
    .storeAddress(input.destination)
    .storeAddress(input.responseDestination)
    .storeBit(false)
    .storeCoins(input.forwardTonAmount)
    .storeBit(false)
    .endCell();
}

function tonWalletV4DataCell(publicKey: Uint8Array): TonCellRef {
  const bits = new Uint8Array(41);
  writeUint32(bits, 0, 0);
  writeUint32(bits, 4, TON_WALLET_V4R2_WALLET_ID);
  bits.set(publicKey, 8);
  return tonCellHash({ bits, bitLength: 321, refs: [] });
}

function tonWalletV4StateInit(publicKey: Uint8Array): TonCell {
  const code = tonWalletV4CodeCell();
  const dataRef = tonWalletV4DataCell(publicKey);
  const data: TonCell = { bits: new Uint8Array(41), bitLength: 321, refs: [], hash: dataRef.hash, depth: dataRef.depth };
  writeUint32(data.bits, 0, 0);
  writeUint32(data.bits, 4, TON_WALLET_V4R2_WALLET_ID);
  data.bits.set(publicKey, 8);
  return createCell()
    .storeUint(0x30, 5)
    .storeRef(code)
    .storeRef(data)
    .endCell();
}

function tonWalletV4CodeCell(): TonCell {
  if (tonWalletV4CodeCellCache) return tonWalletV4CodeCellCache;
  const code = parseTonBocSingleRoot(base64ToBytes(TON_WALLET_V4R2_CODE_BOC));
  if (!equalBytes(code.hash, TON_WALLET_V4R2_CODE_HASH) || code.depth !== TON_WALLET_V4R2_CODE_DEPTH) {
    throw new Error('TON Wallet V4R2 code BOC is invalid');
  }
  tonWalletV4CodeCellCache = code;
  return code;
}

interface TonCellRef {
  hash: Uint8Array;
  depth: number;
}

export interface TonCell extends TonCellRef {
  bits: Uint8Array;
  bitLength: number;
  refs: TonCell[];
}

function tonCellHash(input: { bits: Uint8Array; bitLength: number; refs: TonCellRef[] }): TonCellRef {
  const data = finalizeCellBits(input.bits, input.bitLength);
  const descriptors = Uint8Array.from([
    input.refs.length,
    Math.floor(input.bitLength / 8) + Math.ceil(input.bitLength / 8),
  ]);
  const depth = input.refs.length > 0 ? Math.max(...input.refs.map((ref) => ref.depth)) + 1 : 0;
  const repr = concatBytes(
    descriptors,
    data,
    ...input.refs.map((ref) => Uint8Array.from([(ref.depth >> 8) & 0xff, ref.depth & 0xff])),
    ...input.refs.map((ref) => ref.hash),
  );
  return { hash: sha256(repr), depth };
}

function tonCellToBoc(root: TonCell): Uint8Array {
  const cells = collectCells(root);
  const index = new Map<TonCell, number>();
  cells.forEach((cell, i) => index.set(cell, i));
  const serialized = cells.map((cell) => serializeCell(cell, index));
  const totalSize = serialized.reduce((sum, cell) => sum + cell.length, 0);
  const sizeBytes = byteLengthFor(cells.length);
  const offsetBytes = byteLengthFor(totalSize);
  return concatBytes(
    Uint8Array.from([0xb5, 0xee, 0x9c, 0x72, 0x01, sizeBytes, offsetBytes]),
    uintToBytes(cells.length, sizeBytes),
    uintToBytes(1, sizeBytes),
    uintToBytes(0, sizeBytes),
    uintToBytes(totalSize, offsetBytes),
    uintToBytes(0, sizeBytes),
    ...serialized,
  );
}

function collectCells(root: TonCell): TonCell[] {
  const cells: TonCell[] = [];
  const seen = new Set<TonCell>();
  const visit = (cell: TonCell): void => {
    if (seen.has(cell)) return;
    seen.add(cell);
    cells.push(cell);
    for (const ref of cell.refs) visit(ref);
  };
  visit(root);
  return cells;
}

function serializeCell(cell: TonCell, index: Map<TonCell, number>): Uint8Array {
  const data = finalizeCellBits(cell.bits, cell.bitLength);
  const descriptors = Uint8Array.from([
    cell.refs.length,
    Math.floor(cell.bitLength / 8) + Math.ceil(cell.bitLength / 8),
  ]);
  return concatBytes(descriptors, data, ...cell.refs.map((ref) => Uint8Array.from([index.get(ref) ?? 0])));
}

function parseTonBocSingleRoot(bytes: Uint8Array): TonCell {
  let offset = 0;
  if (readUint(bytes, offset, 4) !== 0xb5ee9c72) throw new Error('Invalid TON BOC magic');
  offset += 4;
  const flags = bytes[offset++];
  const hasIndex = (flags & 0x80) !== 0;
  const hasCrc32 = (flags & 0x40) !== 0;
  const sizeBytes = flags & 0x07;
  const offsetBytes = bytes[offset++];
  const cellsNum = readUint(bytes, offset, sizeBytes); offset += sizeBytes;
  const rootsNum = readUint(bytes, offset, sizeBytes); offset += sizeBytes;
  offset += sizeBytes;
  const totalCellsSize = readUint(bytes, offset, offsetBytes); offset += offsetBytes;
  const rootIndices: number[] = [];
  for (let i = 0; i < rootsNum; i++) {
    rootIndices.push(readUint(bytes, offset, sizeBytes));
    offset += sizeBytes;
  }
  if (hasIndex) offset += cellsNum * offsetBytes;
  const cellsEnd = offset + totalCellsSize;
  const parsed: Array<{ bits: Uint8Array; bitLength: number; refs: number[] }> = [];
  while (offset < cellsEnd) {
    const descriptor = bytes[offset++];
    const bitsDescriptor = bytes[offset++];
    const refsCount = descriptor & 0x07;
    if ((descriptor & 0x08) !== 0) throw new Error('Unsupported exotic TON cell');
    const dataBytes = Math.ceil(bitsDescriptor / 2);
    const bits = bytes.slice(offset, offset + dataBytes);
    offset += dataBytes;
    const bitLength = bitsDescriptor % 2 === 0
      ? dataBytes * 8
      : dataBytes * 8 - countCellPaddingBits(bits[dataBytes - 1]);
    const refs: number[] = [];
    for (let i = 0; i < refsCount; i++) {
      refs.push(readUint(bytes, offset, sizeBytes));
      offset += sizeBytes;
    }
    parsed.push({ bits, bitLength, refs });
  }
  if (hasCrc32) offset += 4;
  if (offset > bytes.length || rootIndices.length !== 1 || parsed.length !== cellsNum) {
    throw new Error('Invalid TON BOC structure');
  }
  const cells = new Array<TonCell>(parsed.length);
  const build = (index: number): TonCell => {
    const existing = cells[index];
    if (existing) return existing;
    const item = parsed[index];
    if (!item) throw new Error('Invalid TON BOC ref');
    const refs = item.refs.map(build);
    const ref = tonCellHash({ bits: item.bits, bitLength: item.bitLength, refs });
    const cell = { bits: item.bits, bitLength: item.bitLength, refs, hash: ref.hash, depth: ref.depth };
    cells[index] = cell;
    return cell;
  };
  return build(rootIndices[0]);
}

function countCellPaddingBits(lastByte: number): number {
  let trailingZeros = 0;
  while (trailingZeros < 8 && ((lastByte >> trailingZeros) & 1) === 0) trailingZeros += 1;
  return trailingZeros + 1;
}

class TonCellBuilder {
  private readonly bits: number[] = [];
  private readonly refs: TonCell[] = [];

  storeBit(value: boolean): this {
    this.bits.push(value ? 1 : 0);
    return this;
  }

  storeUint(value: number | bigint, bitLength: number): this {
    let normalized = BigInt(value);
    if (normalized < 0n) throw new Error('TON uint value must be non-negative');
    for (let i = bitLength - 1; i >= 0; i--) this.bits.push(Number((normalized >> BigInt(i)) & 1n));
    return this;
  }

  storeBytes(bytes: Uint8Array): this {
    for (const byte of bytes) this.storeUint(byte, 8);
    return this;
  }

  storeCoins(amount: bigint): this {
    if (amount < 0n) throw new Error('TON amount must be non-negative');
    if (amount === 0n) return this.storeUint(0, 4);
    const bytes: number[] = [];
    let value = amount;
    while (value > 0n) {
      bytes.unshift(Number(value & 0xffn));
      value >>= 8n;
    }
    if (bytes.length > 15) throw new Error('TON amount exceeds supported coin range');
    this.storeUint(bytes.length, 4);
    return this.storeBytes(Uint8Array.from(bytes));
  }

  storeAddressNone(): this {
    return this.storeUint(0, 2);
  }

  storeAddress(value: string): this {
    const address = parseTonAddress(value);
    this.storeUint(2, 2);
    this.storeBit(false);
    this.storeInt8(address.workchain);
    return this.storeBytes(address.hash);
  }

  storeInt8(value: number): this {
    if (!Number.isInteger(value) || value < -128 || value > 127) throw new Error('TON workchain is invalid');
    return this.storeUint(value < 0 ? 256 + value : value, 8);
  }

  storeRef(cell: TonCell): this {
    if (this.refs.length >= 4) throw new Error('TON cell cannot contain more than 4 refs');
    this.refs.push(cell);
    return this;
  }

  storeOptionalRef(cell: TonCell | null): this {
    if (!cell) return this.storeBit(false);
    this.storeBit(true);
    this.storeBit(true);
    return this.storeRef(cell);
  }

  storeCell(cell: TonCell): this {
    for (let i = 0; i < cell.bitLength; i++) {
      const byte = cell.bits[Math.floor(i / 8)];
      this.bits.push((byte >> (7 - (i % 8))) & 1);
    }
    for (const ref of cell.refs) this.storeRef(ref);
    return this;
  }

  endCell(): TonCell {
    if (this.bits.length > 1023) throw new Error('TON cell bit length exceeds 1023');
    const bitLength = this.bits.length;
    const bytes = new Uint8Array(Math.ceil(bitLength / 8));
    for (let i = 0; i < this.bits.length; i++) {
      if (this.bits[i]) bytes[Math.floor(i / 8)] |= 1 << (7 - (i % 8));
    }
    const ref = tonCellHash({ bits: bytes, bitLength, refs: this.refs });
    return { bits: bytes, bitLength, refs: this.refs.slice(), hash: ref.hash, depth: ref.depth };
  }
}

function createCell(): TonCellBuilder {
  return new TonCellBuilder();
}

function finalizeCellBits(bits: Uint8Array, bitLength: number): Uint8Array {
  const byteLength = Math.ceil(bitLength / 8);
  const out = bits.slice(0, byteLength);
  if (bitLength % 8 !== 0) out[byteLength - 1] |= 1 << (7 - (bitLength % 8));
  return out;
}

function toTonUserFriendlyAddress(workchain: number, hash: Uint8Array, bounceable: boolean): string {
  const body = new Uint8Array(34);
  body[0] = bounceable ? 0x11 : 0x51;
  body[1] = workchain === -1 ? 0xff : workchain & 0xff;
  body.set(hash, 2);
  return bytesToBase64(concatBytes(body, crc16Ccitt(body)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function parseTonAddress(value: string): { workchain: number; hash: Uint8Array } {
  const raw = value.match(/^(-?\d+):([0-9a-fA-F]{64})$/);
  if (raw) return { workchain: Number(raw[1]), hash: hexToBytes(raw[2]) };
  if (!/^[A-Za-z0-9_-]{48}$/.test(value)) throw new Error('Invalid TON address');
  const bytes = base64ToBytes(value.replace(/-/g, '+').replace(/_/g, '/'));
  if (bytes.length !== 36) throw new Error('Invalid TON address');
  const body = bytes.slice(0, 34);
  const checksum = bytes.slice(34);
  if (!equalBytes(crc16Ccitt(body), checksum)) throw new Error('Invalid TON address checksum');
  const workchain = body[1] === 0xff ? -1 : body[1];
  return { workchain, hash: body.slice(2) };
}

function crc16Ccitt(bytes: Uint8Array): Uint8Array {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return Uint8Array.from([(crc >> 8) & 0xff, crc & 0xff]);
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  if (typeof btoa === 'function') return btoa(binary);
  return Buffer.from(bytes).toString('base64');
}

function base64ToBytes(value: string): Uint8Array {
  const padded = value.padEnd(Math.ceil(value.length / 4) * 4, '=');
  if (typeof atob === 'function') return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  return Uint8Array.from(Buffer.from(padded, 'base64'));
}

function stackNumber(item: unknown, label: string): bigint {
  const value = stackValue(item);
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^-?0x[0-9a-f]+$/i.test(trimmed)) return BigInt(trimmed);
    if (/^-?\d+$/.test(trimmed)) return BigInt(trimmed);
  }
  throw new Error(`${label} response is invalid`);
}

function stackAddress(item: unknown, label: string): string {
  const value = stackValue(item);
  if (typeof value === 'string' && isTonAddress(value)) return normalizeTonAddress(value);
  const cell = stackCell(item);
  if (!cell) throw new Error(`${label} response is invalid`);
  return readTonAddressFromCell(cell);
}

function stackCell(item: unknown): TonCell | null {
  const value = stackValue(item);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const encoded = record.bytes ?? record.boc ?? record.cell;
    if (typeof encoded === 'string') return parseStackCell(encoded);
  }
  if (typeof value === 'string' && !isTonAddress(value)) return parseStackCell(value);
  return null;
}

function stackValue(item: unknown): unknown {
  if (Array.isArray(item)) return item[1] ?? item[0];
  if (item && typeof item === 'object') {
    const record = item as Record<string, unknown>;
    return record.value ?? record.bytes ?? record.boc ?? record.cell ?? record;
  }
  return item;
}

function parseStackCell(value: string): TonCell {
  const trimmed = value.trim();
  if (/^[0-9a-f]+$/i.test(trimmed) && trimmed.length % 2 === 0) {
    return parseTonBocSingleRoot(hexToBytes(trimmed));
  }
  return parseTonBocSingleRoot(base64ToBytes(trimmed.replace(/-/g, '+').replace(/_/g, '/')));
}

function readTonAddressFromCell(cell: TonCell): string {
  const slice = new TonCellSlice(cell);
  return slice.loadAddress();
}

function parseTep64JettonMetadata(content: TonCell): { symbol: string; decimals: number } | null {
  const slice = new TonCellSlice(content);
  if (slice.remainingBits() < 8) return null;
  const marker = Number(slice.loadUint(8));
  if (marker !== 0x00) return null;
  const dictionary = loadTonHashmapE(slice, 256);
  const symbol = decodeTep64Text(dictionary.get(tep64Key('symbol')));
  const decimalsText = decodeTep64Text(dictionary.get(tep64Key('decimals')));
  if (!symbol && !decimalsText) return null;
  return {
    symbol: sanitizeJettonSymbol(symbol),
    decimals: normalizeJettonDecimals(decimalsText),
  };
}

function tep64Key(key: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(key)));
}

function decodeTep64Text(cell: TonCell | undefined): string | null {
  if (!cell) return null;
  const bytes = readSnakeBytes(cell);
  const payload = bytes[0] === 0x00 || bytes[0] === 0x01 ? bytes.slice(1) : bytes;
  try {
    return new TextDecoder().decode(payload).replace(/\0+$/, '').trim();
  } catch {
    return null;
  }
}

function readSnakeBytes(cell: TonCell): Uint8Array {
  const chunks: Uint8Array[] = [];
  let current: TonCell | undefined = cell;
  while (current) {
    const slice = new TonCellSlice(current);
    chunks.push(slice.loadRemainingBytes());
    current = current.refs[0];
  }
  return concatBytes(...chunks);
}

function loadTonHashmapE(slice: TonCellSlice, keySize: number): Map<string, TonCell> {
  const hasRoot = slice.loadBit();
  const out = new Map<string, TonCell>();
  if (hasRoot === 0) return out;
  parseTonHashmapNode(slice.loadRef(), keySize, '', out);
  return out;
}

function parseTonHashmapNode(cell: TonCell, keySize: number, prefix: string, out: Map<string, TonCell>): void {
  const slice = new TonCellSlice(cell);
  const label = loadTonHashmapLabel(slice, keySize);
  const nextPrefix = `${prefix}${label}`;
  const remaining = keySize - label.length;
  if (remaining < 0) throw new Error('TON hashmap label is invalid');
  if (remaining === 0) {
    out.set(bitsToHex(nextPrefix), slice.refCount() > 0 ? slice.loadRef() : cell);
    return;
  }
  parseTonHashmapNode(slice.loadRef(), remaining - 1, `${nextPrefix}0`, out);
  parseTonHashmapNode(slice.loadRef(), remaining - 1, `${nextPrefix}1`, out);
}

function loadTonHashmapLabel(slice: TonCellSlice, keySize: number): string {
  const first = slice.loadBit();
  if (first === 0) {
    let length = 0;
    while (slice.loadBit() === 1) length += 1;
    return slice.loadBits(length);
  }
  const second = slice.loadBit();
  const lengthBits = Math.ceil(Math.log2(keySize + 1));
  const length = Number(slice.loadUint(lengthBits));
  if (second === 0) return slice.loadBits(length);
  const bit = slice.loadBit() === 1 ? '1' : '0';
  return bit.repeat(length);
}

function bitsToHex(bits: string): string {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === '1') bytes[Math.floor(i / 8)] |= 1 << (7 - (i % 8));
  }
  return bytesToHex(bytes);
}

function sanitizeJettonSymbol(value: unknown): string {
  if (typeof value !== 'string') return 'JETTON';
  const trimmed = value.trim().replace(/[^\w.-]/g, '');
  return trimmed.length > 0 && trimmed.length <= 16 ? trimmed : 'JETTON';
}

function normalizeJettonDecimals(value: unknown): number {
  const decimals = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : 9;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return 9;
  return decimals;
}

function formatJettonAmount(value: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('Jetton decimals must be an integer between 0 and 36');
  if (decimals === 0) return value.toString();
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

class TonCellSlice {
  private offset = 0;
  private refOffset = 0;

  constructor(private readonly cell: TonCell) {}

  loadUint(bitLength: number): bigint {
    let value = 0n;
    for (let i = 0; i < bitLength; i++) value = (value << 1n) | BigInt(this.loadBit());
    return value;
  }

  loadBits(bitLength: number): string {
    let bits = '';
    for (let i = 0; i < bitLength; i++) bits += this.loadBit() === 1 ? '1' : '0';
    return bits;
  }

  loadBit(): number {
    if (this.offset >= this.cell.bitLength) throw new Error('TON cell underflow');
    const byte = this.cell.bits[Math.floor(this.offset / 8)];
    const bit = (byte >> (7 - (this.offset % 8))) & 1;
    this.offset += 1;
    return bit;
  }

  loadRef(): TonCell {
    const ref = this.cell.refs[this.refOffset];
    if (!ref) throw new Error('TON cell ref underflow');
    this.refOffset += 1;
    return ref;
  }

  refCount(): number {
    return this.cell.refs.length - this.refOffset;
  }

  remainingBits(): number {
    return this.cell.bitLength - this.offset;
  }

  loadRemainingBytes(): Uint8Array {
    const byteLength = Math.floor(this.remainingBits() / 8);
    const out = new Uint8Array(byteLength);
    for (let i = 0; i < byteLength; i++) out[i] = Number(this.loadUint(8));
    return out;
  }

  loadAddress(): string {
    const tag = Number(this.loadUint(2));
    if (tag === 0) throw new Error('TON address is empty');
    if (tag !== 2) throw new Error('Unsupported TON address format');
    const anycast = this.loadBit();
    if (anycast !== 0) throw new Error('Unsupported TON anycast address');
    const workchainByte = Number(this.loadUint(8));
    const workchain = workchainByte === 0xff ? -1 : workchainByte;
    const hash = new Uint8Array(32);
    for (let i = 0; i < hash.length; i++) hash[i] = Number(this.loadUint(8));
    return toTonUserFriendlyAddress(workchain, hash, false);
  }
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function byteLengthFor(value: number): number {
  if (value <= 0xff) return 1;
  if (value <= 0xffff) return 2;
  if (value <= 0xffffff) return 3;
  return 4;
}

function uintToBytes(value: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i--) {
    out[i] = value & 0xff;
    value = Math.floor(value / 256);
  }
  return out;
}

function readUint(bytes: Uint8Array, offset: number, length: number): number {
  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + bytes[offset + i];
  return value;
}

function deriveSlip10Ed25519(seed: Uint8Array, path: number[]): Uint8Array {
  let digest = hmac(sha512, ED25519_SEED_KEY, seed);
  let key = digest.slice(0, 32);
  let chainCode = digest.slice(32);
  for (const index of path) {
    const hardened = 0x80000000 + index;
    const data = new Uint8Array(1 + 32 + 4);
    data[0] = 0;
    data.set(key, 1);
    data[33] = (hardened >>> 24) & 0xff;
    data[34] = (hardened >>> 16) & 0xff;
    data[35] = (hardened >>> 8) & 0xff;
    data[36] = hardened & 0xff;
    digest = hmac(sha512, chainCode, data);
    key = digest.slice(0, 32);
    chainCode = digest.slice(32);
  }
  return key;
}
