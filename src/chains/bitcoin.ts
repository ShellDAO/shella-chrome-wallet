import { HDKey } from '@scure/bip32';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import type { BitcoinTransferPreview, BitcoinTxInput, WalletTxRecord } from '../types.js';

const SATS_PER_BTC = 100_000_000n;
const SIGHASH_ALL = 0x01;
const DUST_THRESHOLD_SATS = 546n;
const RBF_SEQUENCE = 0xffff_fffd;
const BITCOIN_MEMPOOL_CHAIN_LIMIT_COUNT = 25;
const BITCOIN_MEMPOOL_CHAIN_LIMIT_VBYTES = 101_000;
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

export type BitcoinNetwork = 'mainnet' | 'testnet';

export interface BitcoinKeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  address: string;
}

export interface BitcoinTransferResult {
  txHash: string;
  amountSats: string;
  inputs: BitcoinTxInput[];
  feeSats: string;
  changeSats: string;
  feeRateSatVb: number;
  estimatedVbytes: number;
  rbfEnabled: boolean;
  packageFeeRateSatVb?: number | null;
}

export interface BitcoinTransactionStatus {
  status: 'pending' | 'confirmed' | 'failed';
  blockNumber?: string | null;
  error?: string;
}

export interface BitcoinCpfpPolicyCheck {
  ancestorCount: number | null;
  ancestorVbytes: number | null;
  descendantCount: number | null;
  descendantVbytes: number | null;
}

interface BitcoinUtxo {
  txid: string;
  vout: number;
  value: bigint;
  confirmed: boolean;
}

interface EsploraOutspend {
  spent?: boolean;
  txid?: string;
  vin?: number;
  status?: { confirmed?: boolean };
}

interface MempoolCpfpRelativeTx {
  txid?: string;
  fee?: number;
  weight?: number;
  vsize?: number;
  size?: number;
  adjustedVsize?: number;
}

interface MempoolCpfpResponse {
  ancestors?: MempoolCpfpRelativeTx[];
  descendants?: MempoolCpfpRelativeTx[];
}

interface EsploraAddressTx {
  txid?: string;
  fee?: number;
  weight?: number;
  size?: number;
  vsize?: number;
  status?: {
    confirmed?: boolean;
    block_height?: number;
    block_time?: number;
  };
  vin?: Array<{
    sequence?: number;
    prevout?: {
      scriptpubkey_address?: string;
      value?: number;
    };
  }>;
  vout?: Array<{
    scriptpubkey_address?: string;
    value?: number;
  }>;
}

export function deriveBitcoinAddress(seed: Uint8Array, accountIndex: number, network: BitcoinNetwork = 'mainnet'): string {
  const keyPair = deriveBitcoinKeyPair(seed, accountIndex, network);
  keyPair.privateKey.fill(0);
  keyPair.publicKey.fill(0);
  return keyPair.address;
}

export function deriveBitcoinKeyPair(seed: Uint8Array, accountIndex: number, network: BitcoinNetwork = 'mainnet'): BitcoinKeyPair {
  if (!Number.isInteger(accountIndex) || accountIndex < 0) {
    throw new Error('Bitcoin account index must be a non-negative integer');
  }
  const coinType = network === 'mainnet' ? 0 : 1;
  const child = HDKey.fromMasterSeed(seed).derive(`m/84'/${coinType}'/${accountIndex}'/0/0`);
  if (!child.privateKey) throw new Error('Failed to derive Bitcoin private key');
  const privateKey = child.privateKey.slice();
  const publicKey = secp256k1.getPublicKey(privateKey, true);
  const address = encodeP2wpkhAddress(publicKey, network);
  return { privateKey, publicKey, address };
}

export function isBitcoinAddress(value: string): boolean {
  try {
    decodeSegwitAddress(value);
    return true;
  } catch {
    return false;
  }
}

export function parseBtc(value: string): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error('BTC amount must be a positive decimal number');
  const [whole, fraction = ''] = trimmed.split('.');
  if (fraction.length > 8) throw new Error('BTC amount must have at most 8 decimal places');
  const sats = BigInt(whole) * SATS_PER_BTC + BigInt(fraction.padEnd(8, '0'));
  if (sats <= 0n) throw new Error('BTC amount must be greater than 0');
  return sats;
}

export function formatBtc(sats: bigint | string | number): string {
  const raw = BigInt(sats);
  const sign = raw < 0n ? '-' : '';
  const absolute = raw < 0n ? -raw : raw;
  const whole = absolute / SATS_PER_BTC;
  const fraction = (absolute % SATS_PER_BTC).toString().padStart(8, '0').replace(/0+$/, '');
  return `${sign}${whole.toString()}${fraction ? `.${fraction}` : ''}`;
}

export async function getBitcoinBalance(apiUrl: string, address: string): Promise<{ balance: string; formatted: string }> {
  if (!isBitcoinAddress(address)) throw new Error('Invalid Bitcoin address');
  const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/address/${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error(`bitcoin rpc request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as {
    chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
    mempool_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
  };
  const confirmed = BigInt(data.chain_stats?.funded_txo_sum ?? 0) - BigInt(data.chain_stats?.spent_txo_sum ?? 0);
  const mempool = BigInt(data.mempool_stats?.funded_txo_sum ?? 0) - BigInt(data.mempool_stats?.spent_txo_sum ?? 0);
  const balance = confirmed + mempool;
  return { balance: balance.toString(), formatted: formatBtc(balance) };
}

export async function sendBitcoinTransfer(input: {
  apiUrl: string;
  privateKey: Uint8Array;
  from: string;
  to: string;
  amountSats: bigint;
  feeRateSatVb?: number;
  inputs?: BitcoinTxInput[];
}): Promise<BitcoinTransferResult> {
  if (!isBitcoinAddress(input.from)) throw new Error('Invalid Bitcoin sender address');
  if (!isBitcoinAddress(input.to)) throw new Error('Invalid Bitcoin recipient address');
  if (input.amountSats <= 0n) throw new Error('Amount must be greater than zero');
  const fromDecoded = decodeSegwitAddress(input.from);
  const toDecoded = decodeSegwitAddress(input.to);
  if (fromDecoded.network !== toDecoded.network) throw new Error('Bitcoin recipient network does not match sender network');

  const publicKey = secp256k1.getPublicKey(input.privateKey, true);
  const expected = encodeP2wpkhAddress(publicKey, fromDecoded.network);
  if (expected !== input.from.toLowerCase()) throw new Error('Bitcoin private key does not match sender address');

  const utxos = input.inputs?.length
    ? normalizeManualBitcoinInputs(input.inputs)
    : await getBitcoinUtxos(input.apiUrl, input.from);
  const feeRate = normalizeFeeRate(input.feeRateSatVb ?? await getBitcoinFeeRate(input.apiUrl));
  const selected = selectUtxos(utxos, input.amountSats, feeRate);
  const result = await signAndBroadcastBitcoinTransfer({
    apiUrl: input.apiUrl,
    privateKey: input.privateKey,
    publicKey,
    from: input.from,
    to: input.to,
    amountSats: input.amountSats,
    inputs: selected.inputs,
    fee: selected.fee,
    change: selected.change,
    feeRateSatVb: feeRate,
    senderProgram: fromDecoded.program,
  });
  publicKey.fill(0);
  return result;
}

export async function replaceBitcoinTransfer(input: {
  apiUrl: string;
  privateKey: Uint8Array;
  from: string;
  to: string;
  amountSats: bigint;
  inputs: BitcoinTxInput[];
  feeRateSatVb: number;
}): Promise<BitcoinTransferResult> {
  if (!isBitcoinAddress(input.from)) throw new Error('Invalid Bitcoin sender address');
  if (!isBitcoinAddress(input.to)) throw new Error('Invalid Bitcoin recipient address');
  if (input.amountSats <= 0n) throw new Error('Amount must be greater than zero');
  const fromDecoded = decodeSegwitAddress(input.from);
  const toDecoded = decodeSegwitAddress(input.to);
  if (fromDecoded.network !== toDecoded.network) throw new Error('Bitcoin recipient network does not match sender network');
  const publicKey = secp256k1.getPublicKey(input.privateKey, true);
  const expected = encodeP2wpkhAddress(publicKey, fromDecoded.network);
  if (expected !== input.from.toLowerCase()) throw new Error('Bitcoin private key does not match sender address');
  const replacementInputs = input.inputs.map((entry) => ({
    txid: entry.txid.toLowerCase(),
    vout: entry.vout,
    value: BigInt(entry.valueSats),
    confirmed: entry.confirmed,
  }));
  const feeRate = normalizeFeeRate(input.feeRateSatVb);
  const selected = selectReplacementUtxos(replacementInputs, input.amountSats, feeRate);
  const result = await signAndBroadcastBitcoinTransfer({
    apiUrl: input.apiUrl,
    privateKey: input.privateKey,
    publicKey,
    from: input.from,
    to: input.to,
    amountSats: input.amountSats,
    inputs: selected.inputs,
    fee: selected.fee,
    change: selected.change,
    feeRateSatVb: feeRate,
    senderProgram: fromDecoded.program,
  });
  publicKey.fill(0);
  return result;
}

export async function sendBitcoinCpfpChild(input: {
  apiUrl: string;
  privateKey: Uint8Array;
  address: string;
  parentInput?: BitcoinTxInput;
  parentInputs?: BitcoinTxInput[];
  feeRateSatVb: number;
  parentFeeSats?: string | null;
  parentVbytes?: number | null;
}): Promise<BitcoinTransferResult> {
  if (!isBitcoinAddress(input.address)) throw new Error('Invalid Bitcoin address');
  const parentInputs = input.parentInputs?.length ? input.parentInputs : input.parentInput ? [input.parentInput] : [];
  if (parentInputs.length === 0) throw new Error('Bitcoin CPFP requires at least one parent output');
  const childInputs = parentInputs.map((parentInput) => {
    if (parentInput.confirmed) throw new Error('CPFP requires unconfirmed Bitcoin parent outputs');
    if (!/^[0-9a-fA-F]{64}$/.test(parentInput.txid)) throw new Error('Invalid Bitcoin parent transaction hash');
    if (!Number.isInteger(parentInput.vout) || parentInput.vout < 0) throw new Error('Invalid Bitcoin parent output index');
    const value = BigInt(parentInput.valueSats);
    if (value <= 0n) throw new Error('Bitcoin parent output value must be greater than zero');
    return {
      txid: parentInput.txid.toLowerCase(),
      vout: parentInput.vout,
      value,
      confirmed: false,
    };
  });
  const value = childInputs.reduce((sum, childInput) => sum + childInput.value, 0n);

  const decoded = decodeSegwitAddress(input.address);
  const publicKey = secp256k1.getPublicKey(input.privateKey, true);
  const expected = encodeP2wpkhAddress(publicKey, decoded.network);
  if (expected !== input.address.toLowerCase()) throw new Error('Bitcoin private key does not match address');

  const targetFeeRate = normalizeFeeRate(input.feeRateSatVb);
  const cpfpFee = estimateCpfpChildFee({
    targetFeeRateSatVb: targetFeeRate,
    parentFeeSats: input.parentFeeSats,
    parentVbytes: input.parentVbytes,
    childInputCount: childInputs.length,
  });
  const fee = cpfpFee.childFeeSats;
  const amountSats = value - fee;
  if (amountSats < DUST_THRESHOLD_SATS) throw new Error('Bitcoin parent output is too small for CPFP at this fee rate');

  const result = await signAndBroadcastBitcoinTransfer({
    apiUrl: input.apiUrl,
    privateKey: input.privateKey,
    publicKey,
    from: input.address,
    to: input.address,
    amountSats,
    inputs: childInputs,
    fee,
    change: 0n,
    feeRateSatVb: cpfpFee.childFeeRateSatVb,
    senderProgram: decoded.program,
  });
  publicKey.fill(0);
  return { ...result, packageFeeRateSatVb: cpfpFee.packageFeeRateSatVb };
}

export async function previewBitcoinTransfer(input: {
  apiUrl: string;
  from: string;
  to: string;
  amountSats: bigint;
  feeRateSatVb?: number;
  inputs?: BitcoinTxInput[];
}): Promise<BitcoinTransferPreview> {
  if (!isBitcoinAddress(input.from)) throw new Error('Invalid Bitcoin sender address');
  if (!isBitcoinAddress(input.to)) throw new Error('Invalid Bitcoin recipient address');
  if (input.amountSats <= 0n) throw new Error('Amount must be greater than zero');
  const fromDecoded = decodeSegwitAddress(input.from);
  const toDecoded = decodeSegwitAddress(input.to);
  if (fromDecoded.network !== toDecoded.network) throw new Error('Bitcoin recipient network does not match sender network');

  const utxos = input.inputs?.length
    ? normalizeManualBitcoinInputs(input.inputs)
    : await getBitcoinUtxos(input.apiUrl, input.from);
  const feeRate = normalizeFeeRate(input.feeRateSatVb ?? await getBitcoinFeeRate(input.apiUrl));
  const selected = selectUtxos(utxos, input.amountSats, feeRate);
  const outputCount = selected.change >= DUST_THRESHOLD_SATS ? 2 : 1;
  return {
    amountSats: input.amountSats.toString(),
    feeSats: selected.fee.toString(),
    feeRateSatVb: feeRate,
    inputCount: selected.inputs.length,
    inputs: selected.inputs.map((utxo) => ({
      txid: utxo.txid,
      vout: utxo.vout,
      valueSats: utxo.value.toString(),
      confirmed: utxo.confirmed,
    })),
    inputTotalSats: selected.inputTotal.toString(),
    changeSats: selected.change.toString(),
    dustSats: selected.dust.toString(),
    estimatedVbytes: estimateP2wpkhVbytes(selected.inputs.length, outputCount),
    rbfEnabled: true,
  };
}

export async function getBitcoinTransactionStatus(apiUrl: string, txHash: string): Promise<BitcoinTransactionStatus> {
  if (!/^[0-9a-fA-F]{64}$/.test(txHash)) throw new Error('Invalid Bitcoin transaction hash');
  const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/tx/${txHash}/status`);
  if (!res.ok) throw new Error(`bitcoin rpc request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as { confirmed?: boolean; block_height?: number };
  if (!data.confirmed) return { status: 'pending' };
  return {
    status: 'confirmed',
    blockNumber: data.block_height == null ? null : String(data.block_height),
  };
}

export async function getBitcoinTransactionHistory(apiUrl: string, address: string, page = 0, limit = 20): Promise<{ txs: WalletTxRecord[]; total: number }> {
  if (!isBitcoinAddress(address)) throw new Error('Invalid Bitcoin address');
  if (page > 0) return { txs: [], total: 0 };
  const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/address/${encodeURIComponent(address)}/txs`);
  if (!res.ok) throw new Error(`bitcoin rpc request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as EsploraAddressTx[];
  const normalized = data
    .slice(0, limit)
    .map((tx) => normalizeBitcoinHistoryTx(tx, address))
    .filter((tx): tx is WalletTxRecord => tx !== null);
  return { txs: normalized, total: normalized.length };
}

export async function checkBitcoinCpfpPolicy(apiUrl: string, parentInput: BitcoinTxInput, childVbytes = estimateP2wpkhVbytes(1, 1)): Promise<BitcoinCpfpPolicyCheck> {
  if (!/^[0-9a-fA-F]{64}$/.test(parentInput.txid)) throw new Error('Invalid Bitcoin parent transaction hash');
  if (!Number.isInteger(parentInput.vout) || parentInput.vout < 0) throw new Error('Invalid Bitcoin parent output index');

  const base = apiUrl.replace(/\/+$/, '');
  const outspend = await fetch(`${base}/tx/${parentInput.txid.toLowerCase()}/outspend/${parentInput.vout}`);
  if (!outspend.ok) throw new Error(`bitcoin rpc request failed: ${outspend.status} ${outspend.statusText}`);
  const outspendData = await outspend.json() as EsploraOutspend;
  if (outspendData.spent) {
    const spendingTx = outspendData.txid && /^[0-9a-fA-F]{64}$/.test(outspendData.txid)
      ? ` by ${outspendData.txid.toLowerCase()}`
      : '';
    throw new Error(`Bitcoin CPFP parent output is already spent${spendingTx}`);
  }

  const cpfpUrl = buildMempoolCpfpUrl(base, parentInput.txid.toLowerCase());
  if (!cpfpUrl) {
    return { ancestorCount: null, ancestorVbytes: null, descendantCount: null, descendantVbytes: null };
  }
  const cpfp = await fetch(cpfpUrl);
  if (cpfp.status === 404) {
    return { ancestorCount: null, ancestorVbytes: null, descendantCount: null, descendantVbytes: null };
  }
  if (!cpfp.ok) throw new Error(`bitcoin rpc request failed: ${cpfp.status} ${cpfp.statusText}`);
  const cpfpData = await cpfp.json() as MempoolCpfpResponse;
  const ancestors = summarizeCpfpRelatives(cpfpData.ancestors);
  const descendants = summarizeCpfpRelatives(cpfpData.descendants);
  const nextAncestorCount = ancestors.count + 1;
  const nextAncestorVbytes = ancestors.vbytes + childVbytes;
  const nextDescendantCount = descendants.count + 1;
  const nextDescendantVbytes = descendants.vbytes + childVbytes;
  if (nextAncestorCount > BITCOIN_MEMPOOL_CHAIN_LIMIT_COUNT || nextAncestorVbytes > BITCOIN_MEMPOOL_CHAIN_LIMIT_VBYTES) {
    throw new Error('Bitcoin CPFP would exceed mempool ancestor limits');
  }
  if (nextDescendantCount > BITCOIN_MEMPOOL_CHAIN_LIMIT_COUNT || nextDescendantVbytes > BITCOIN_MEMPOOL_CHAIN_LIMIT_VBYTES) {
    throw new Error('Bitcoin CPFP would exceed mempool descendant limits');
  }
  return {
    ancestorCount: ancestors.count,
    ancestorVbytes: ancestors.vbytes,
    descendantCount: descendants.count,
    descendantVbytes: descendants.vbytes,
  };
}

function encodeP2wpkhAddress(publicKey: Uint8Array, network: BitcoinNetwork): string {
  const hash160 = ripemd160(sha256(publicKey));
  const words = [0, ...convertBits(hash160, 8, 5, true)];
  return bech32Encode(network === 'mainnet' ? 'bc' : 'tb', words);
}

function buildMempoolCpfpUrl(base: string, txid: string): string | null {
  if (!/mempool\.space/i.test(base)) return null;
  if (/\/api$/i.test(base)) return `${base.replace(/\/api$/i, '/api/v1')}/cpfp/${txid}`;
  if (/\/api\/testnet$/i.test(base)) return `${base.replace(/\/api\/testnet$/i, '/api/v1/testnet')}/cpfp/${txid}`;
  if (/\/testnet\/api$/i.test(base)) return `${base.replace(/\/testnet\/api$/i, '/api/v1/testnet')}/cpfp/${txid}`;
  return `${base}/v1/cpfp/${txid}`;
}

function summarizeCpfpRelatives(value: MempoolCpfpRelativeTx[] | undefined): { count: number; vbytes: number } {
  const relatives = Array.isArray(value) ? value : [];
  return relatives.reduce((summary, tx) => {
    return {
      count: summary.count + 1,
      vbytes: summary.vbytes + inferRelativeVbytes(tx),
    };
  }, { count: 0, vbytes: 0 });
}

function inferRelativeVbytes(tx: MempoolCpfpRelativeTx): number {
  if (Number.isFinite(tx.adjustedVsize) && tx.adjustedVsize != null && tx.adjustedVsize > 0) return Math.ceil(tx.adjustedVsize);
  if (Number.isFinite(tx.vsize) && tx.vsize != null && tx.vsize > 0) return Math.ceil(tx.vsize);
  if (Number.isFinite(tx.weight) && tx.weight != null && tx.weight > 0) return Math.ceil(tx.weight / 4);
  if (Number.isFinite(tx.size) && tx.size != null && tx.size > 0) return Math.ceil(tx.size);
  return 0;
}

async function getBitcoinUtxos(apiUrl: string, address: string): Promise<BitcoinUtxo[]> {
  const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/address/${encodeURIComponent(address)}/utxo`);
  if (!res.ok) throw new Error(`bitcoin rpc request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as Array<{
    txid?: string;
    vout?: number;
    value?: number;
    status?: { confirmed?: boolean };
  }>;
  return data.flatMap((entry) => {
    const vout = entry.vout;
    const value = entry.value;
    if (!entry.txid || !/^[0-9a-fA-F]{64}$/.test(entry.txid) || !Number.isInteger(vout) || vout == null || vout < 0 || value == null) {
      return [];
    }
    return [{
      txid: entry.txid.toLowerCase(),
      vout,
      value: BigInt(value),
      confirmed: entry.status?.confirmed !== false,
    }];
  }).sort((a, b) => Number(b.value - a.value));
}

export async function getBitcoinSpendableUtxos(apiUrl: string, address: string): Promise<BitcoinTxInput[]> {
  const utxos = await getBitcoinUtxos(apiUrl, address);
  return utxos.map((utxo) => ({
    txid: utxo.txid,
    vout: utxo.vout,
    valueSats: utxo.value.toString(),
    confirmed: utxo.confirmed,
  }));
}

function normalizeBitcoinHistoryTx(tx: EsploraAddressTx, address: string): WalletTxRecord | null {
  if (!tx.txid || !/^[0-9a-fA-F]{64}$/.test(tx.txid)) return null;
  const normalizedAddress = address.toLowerCase();
  const inputs = tx.vin ?? [];
  const outputs = tx.vout ?? [];
  const inputFromAddress = inputs.reduce((sum, input) => {
    return input.prevout?.scriptpubkey_address?.toLowerCase() === normalizedAddress
      ? sum + BigInt(input.prevout.value ?? 0)
      : sum;
  }, 0n);
  const outputToAddress = outputs.reduce((sum, output) => {
    return output.scriptpubkey_address?.toLowerCase() === normalizedAddress
      ? sum + BigInt(output.value ?? 0)
      : sum;
  }, 0n);
  if (inputFromAddress === 0n && outputToAddress === 0n) return null;

  const outgoing = inputFromAddress > 0n;
  const counterpartyOutput = outputs.find((output) => output.scriptpubkey_address?.toLowerCase() !== normalizedAddress);
  const counterpartyInput = inputs.find((input) => input.prevout?.scriptpubkey_address?.toLowerCase() !== normalizedAddress);
  const timestamp = Number.isFinite(tx.status?.block_time)
    ? Number(tx.status?.block_time) * 1000
    : Date.now();
  const value = outgoing
    ? (inputFromAddress > outputToAddress ? inputFromAddress - outputToAddress : 0n)
    : outputToAddress;
  const rbfEnabled = inputs.some((input) => typeof input.sequence === 'number' && input.sequence < 0xffff_fffe);
  const bitcoinVbytes = inferBitcoinVbytes(tx);
  const cpfpOutputIndex = !outgoing && tx.status?.confirmed !== true
    ? outputs.findIndex((output) => output.scriptpubkey_address?.toLowerCase() === normalizedAddress && BigInt(output.value ?? 0) > 0n)
    : -1;
  const cpfpOutput = cpfpOutputIndex >= 0 ? outputs[cpfpOutputIndex] : null;

  return {
    txHash: tx.txid.toLowerCase(),
    chainKind: 'bitcoin',
    from: outgoing ? address : counterpartyInput?.prevout?.scriptpubkey_address ?? address,
    to: outgoing ? counterpartyOutput?.scriptpubkey_address ?? address : address,
    value: value.toString(),
    data: '0x',
    createdAt: timestamp,
    updatedAt: timestamp,
    status: tx.status?.confirmed ? 'confirmed' : 'pending',
    blockNumber: tx.status?.block_height == null ? null : String(tx.status.block_height),
    source: 'remote',
    shellType: 'bitcoinTransfer',
    rbfEnabled,
    bitcoinFeeSats: Number.isFinite(tx.fee) && tx.fee != null ? String(Math.max(0, Math.trunc(tx.fee))) : null,
    bitcoinVbytes,
    bitcoinCpfpInput: cpfpOutput ? {
      txid: tx.txid.toLowerCase(),
      vout: cpfpOutputIndex,
      valueSats: BigInt(cpfpOutput.value ?? 0).toString(),
      confirmed: false,
    } : null,
  };
}

function inferBitcoinVbytes(tx: EsploraAddressTx): number | null {
  if (Number.isFinite(tx.vsize) && tx.vsize != null && tx.vsize > 0) return Math.ceil(tx.vsize);
  if (Number.isFinite(tx.weight) && tx.weight != null && tx.weight > 0) return Math.ceil(tx.weight / 4);
  if (Number.isFinite(tx.size) && tx.size != null && tx.size > 0) return Math.ceil(tx.size);
  return null;
}

async function getBitcoinFeeRate(apiUrl: string): Promise<number> {
  const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/fee-estimates`);
  if (!res.ok) throw new Error(`bitcoin rpc request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as Record<string, number>;
  const rate = data['6'] ?? data['3'] ?? data['2'] ?? data['1'] ?? 5;
  return normalizeFeeRate(rate);
}

async function broadcastBitcoinTransaction(apiUrl: string, txHex: string): Promise<string> {
  const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/tx`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: txHex,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`bitcoin rpc request failed: ${res.status} ${res.statusText}`);
  const txHash = text.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(txHash)) throw new Error('Bitcoin broadcast response is invalid');
  return txHash.toLowerCase();
}

function selectUtxos(
  utxos: BitcoinUtxo[],
  amountSats: bigint,
  feeRateSatVb: number,
): { inputs: BitcoinUtxo[]; inputTotal: bigint; change: bigint; fee: bigint; dust: bigint } {
  const confirmed = utxos.filter((utxo) => utxo.confirmed);
  const selected: BitcoinUtxo[] = [];
  let total = 0n;
  for (const utxo of confirmed) {
    selected.push(utxo);
    total += utxo.value;
    const feeWithChange = estimateP2wpkhFee(selected.length, 2, feeRateSatVb);
    const feeWithoutChange = estimateP2wpkhFee(selected.length, 1, feeRateSatVb);
    if (total >= amountSats + feeWithChange + DUST_THRESHOLD_SATS) {
      return { inputs: selected, inputTotal: total, change: total - amountSats - feeWithChange, fee: feeWithChange, dust: 0n };
    }
    if (total >= amountSats + feeWithoutChange) {
      const dust = total - amountSats - feeWithoutChange;
      return { inputs: selected, inputTotal: total, change: 0n, fee: feeWithoutChange + dust, dust };
    }
  }
  throw new Error('Insufficient BTC balance');
}

function normalizeManualBitcoinInputs(inputs: BitcoinTxInput[]): BitcoinUtxo[] {
  const seen = new Set<string>();
  return inputs.map((input) => {
    if (!/^[0-9a-fA-F]{64}$/.test(input.txid)) throw new Error('Invalid Bitcoin selected input transaction hash');
    if (!Number.isInteger(input.vout) || input.vout < 0) throw new Error('Invalid Bitcoin selected input output index');
    if (!input.confirmed) throw new Error('Bitcoin coin control only supports confirmed UTXOs');
    const value = BigInt(input.valueSats);
    if (value <= 0n) throw new Error('Bitcoin selected input value must be greater than zero');
    const key = `${input.txid.toLowerCase()}:${input.vout}`;
    if (seen.has(key)) throw new Error('Duplicate Bitcoin selected input');
    seen.add(key);
    return {
      txid: input.txid.toLowerCase(),
      vout: input.vout,
      value,
      confirmed: input.confirmed,
    };
  });
}

function selectReplacementUtxos(
  inputs: BitcoinUtxo[],
  amountSats: bigint,
  feeRateSatVb: number,
): { inputs: BitcoinUtxo[]; inputTotal: bigint; change: bigint; fee: bigint; dust: bigint } {
  const inputTotal = inputs.reduce((sum, input) => sum + input.value, 0n);
  const feeWithChange = estimateP2wpkhFee(inputs.length, 2, feeRateSatVb);
  if (inputTotal >= amountSats + feeWithChange + DUST_THRESHOLD_SATS) {
    return { inputs, inputTotal, change: inputTotal - amountSats - feeWithChange, fee: feeWithChange, dust: 0n };
  }
  const feeWithoutChange = estimateP2wpkhFee(inputs.length, 1, feeRateSatVb);
  if (inputTotal >= amountSats + feeWithoutChange) {
    const dust = inputTotal - amountSats - feeWithoutChange;
    return { inputs, inputTotal, change: 0n, fee: feeWithoutChange + dust, dust };
  }
  throw new Error('Replacement fee is too high for the original Bitcoin inputs');
}

async function signAndBroadcastBitcoinTransfer(input: {
  apiUrl: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  from: string;
  to: string;
  amountSats: bigint;
  inputs: BitcoinUtxo[];
  fee: bigint;
  change: bigint;
  feeRateSatVb: number;
  senderProgram: Uint8Array;
}): Promise<BitcoinTransferResult> {
  const unsigned = buildBitcoinTransaction({
    inputs: input.inputs,
    outputs: [
      { value: input.amountSats, scriptPubKey: scriptPubKeyFromAddress(input.to) },
      ...(input.change >= DUST_THRESHOLD_SATS ? [{ value: input.change, scriptPubKey: scriptPubKeyFromAddress(input.from) }] : []),
    ],
    privateKey: input.privateKey,
    publicKey: input.publicKey,
    senderProgram: input.senderProgram,
  });
  const txHash = await broadcastBitcoinTransaction(input.apiUrl, bytesToHex(unsigned));
  return {
    txHash,
    amountSats: input.amountSats.toString(),
    inputs: input.inputs.map((utxo) => ({
      txid: utxo.txid,
      vout: utxo.vout,
      valueSats: utxo.value.toString(),
      confirmed: utxo.confirmed,
    })),
    feeSats: input.fee.toString(),
    changeSats: input.change.toString(),
    feeRateSatVb: input.feeRateSatVb,
    estimatedVbytes: estimateP2wpkhVbytes(input.inputs.length, input.change >= DUST_THRESHOLD_SATS ? 2 : 1),
    rbfEnabled: true,
  };
}

function estimateCpfpChildFee(input: {
  targetFeeRateSatVb: number;
  parentFeeSats?: string | null;
  parentVbytes?: number | null;
  childInputCount?: number;
}): { childFeeSats: bigint; childFeeRateSatVb: number; packageFeeRateSatVb: number | null } {
  const childInputCount = input.childInputCount ?? 1;
  const childVbytes = estimateP2wpkhVbytes(childInputCount, 1);
  const minimumChildFee = estimateP2wpkhFee(childInputCount, 1, 1);
  let childFeeSats = estimateP2wpkhFee(childInputCount, 1, input.targetFeeRateSatVb);
  let packageFeeRateSatVb: number | null = null;

  if (input.parentFeeSats != null && input.parentVbytes != null && Number.isFinite(input.parentVbytes) && input.parentVbytes > 0) {
    const parentFeeSats = BigInt(input.parentFeeSats);
    const parentVbytes = Math.ceil(input.parentVbytes);
    const packageVbytes = parentVbytes + childVbytes;
    const requiredPackageFee = BigInt(input.targetFeeRateSatVb * packageVbytes);
    const requiredChildFee = requiredPackageFee > parentFeeSats ? requiredPackageFee - parentFeeSats : minimumChildFee;
    childFeeSats = requiredChildFee > minimumChildFee ? requiredChildFee : minimumChildFee;
    packageFeeRateSatVb = Number(parentFeeSats + childFeeSats) / packageVbytes;
  }

  return {
    childFeeSats,
    childFeeRateSatVb: Math.max(1, Math.ceil(Number(childFeeSats) / childVbytes)),
    packageFeeRateSatVb,
  };
}

function normalizeFeeRate(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 5;
  return Math.max(1, Math.ceil(value));
}

function estimateP2wpkhFee(inputCount: number, outputCount: number, feeRateSatVb: number): bigint {
  return BigInt(estimateP2wpkhVbytes(inputCount, outputCount) * feeRateSatVb);
}

function estimateP2wpkhVbytes(inputCount: number, outputCount: number): number {
  return 10 + inputCount * 68 + outputCount * 31;
}

function buildBitcoinTransaction(input: {
  inputs: BitcoinUtxo[];
  outputs: Array<{ value: bigint; scriptPubKey: Uint8Array }>;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  senderProgram: Uint8Array;
}): Uint8Array {
  const version = uint32LE(2);
  const locktime = uint32LE(0);
  const inputCount = encodeVarInt(input.inputs.length);
  const outputCount = encodeVarInt(input.outputs.length);
  const prevouts = input.inputs.map((utxo) => concatBytes(reverseBytes(hexToBytes(utxo.txid)), uint32LE(utxo.vout)));
  const sequences = input.inputs.map(() => uint32LE(RBF_SEQUENCE));
  const outputs = input.outputs.map((output) => serializeTxOutput(output.value, output.scriptPubKey));
  const hashPrevouts = doubleSha256(concatBytes(...prevouts));
  const hashSequence = doubleSha256(concatBytes(...sequences));
  const hashOutputs = doubleSha256(concatBytes(...outputs));
  const scriptCode = concatBytes(
    new Uint8Array([0x19, 0x76, 0xa9, 0x14]),
    input.senderProgram,
    new Uint8Array([0x88, 0xac]),
  );
  const witnesses = input.inputs.map((utxo, index) => {
    const preimage = concatBytes(
      version,
      hashPrevouts,
      hashSequence,
      prevouts[index],
      scriptCode,
      uint64LE(utxo.value),
      sequences[index],
      hashOutputs,
      locktime,
      uint32LE(SIGHASH_ALL),
    );
    const signature = derEncodeSignature(secp256k1.sign(doubleSha256(preimage), input.privateKey));
    return concatBytes(
      encodeVarInt(2),
      encodeVarBytes(concatBytes(signature, new Uint8Array([SIGHASH_ALL]))),
      encodeVarBytes(input.publicKey),
    );
  });
  const baseInputs = input.inputs.map((_utxo, index) => concatBytes(prevouts[index], encodeVarInt(0), sequences[index]));
  return concatBytes(
    version,
    new Uint8Array([0x00, 0x01]),
    inputCount,
    ...baseInputs,
    outputCount,
    ...outputs,
    ...witnesses,
    locktime,
  );
}

function serializeTxOutput(value: bigint, scriptPubKey: Uint8Array): Uint8Array {
  return concatBytes(uint64LE(value), encodeVarBytes(scriptPubKey));
}

function scriptPubKeyFromAddress(address: string): Uint8Array {
  const decoded = decodeSegwitAddress(address);
  if (decoded.version !== 0 || decoded.program.length !== 20) throw new Error('Only P2WPKH Bitcoin addresses are supported');
  return concatBytes(new Uint8Array([0x00, 0x14]), decoded.program);
}

function decodeSegwitAddress(address: string): { network: BitcoinNetwork; version: number; program: Uint8Array } {
  const decoded = bech32Decode(address);
  const network = decoded.hrp === 'bc' ? 'mainnet' : decoded.hrp === 'tb' ? 'testnet' : null;
  if (!network) throw new Error('Invalid Bitcoin address prefix');
  if (decoded.words.length < 2) throw new Error('Invalid Bitcoin address data');
  const version = decoded.words[0];
  if (version !== 0) throw new Error('Only Bitcoin witness v0 addresses are supported');
  const program = new Uint8Array(convertBitsToBytes(decoded.words.slice(1), 5, 8, false));
  if (program.length !== 20) throw new Error('Only P2WPKH Bitcoin addresses are supported');
  return { network, version, program };
}

function bech32Encode(hrp: string, words: number[]): string {
  const checksum = bech32CreateChecksum(hrp, words);
  return `${hrp}1${[...words, ...checksum].map((word) => BECH32_CHARSET[word]).join('')}`;
}

function bech32Decode(value: string): { hrp: string; words: number[] } {
  if (value !== value.toLowerCase() && value !== value.toUpperCase()) throw new Error('Invalid mixed-case bech32 string');
  const normalized = value.toLowerCase();
  const separator = normalized.lastIndexOf('1');
  if (separator <= 0 || separator + 7 > normalized.length) throw new Error('Invalid bech32 separator');
  const hrp = normalized.slice(0, separator);
  const data = normalized.slice(separator + 1).split('').map((char) => BECH32_CHARSET.indexOf(char));
  if (data.some((word) => word < 0)) throw new Error('Invalid bech32 character');
  if (bech32Polymod([...bech32HrpExpand(hrp), ...data]) !== 1) throw new Error('Invalid bech32 checksum');
  return { hrp, words: data.slice(0, -6) };
}

function bech32CreateChecksum(hrp: string, words: number[]): number[] {
  const values = [...bech32HrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0];
  const polymod = bech32Polymod(values) ^ 1;
  const result: number[] = [];
  for (let p = 0; p < 6; p += 1) {
    result.push((polymod >> (5 * (5 - p))) & 31);
  }
  return result;
}

function bech32HrpExpand(hrp: string): number[] {
  const result: number[] = [];
  for (let i = 0; i < hrp.length; i += 1) result.push(hrp.charCodeAt(i) >> 5);
  result.push(0);
  for (let i = 0; i < hrp.length; i += 1) result.push(hrp.charCodeAt(i) & 31);
  return result;
}

function bech32Polymod(values: number[]): number {
  let chk = 1;
  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i += 1) {
      if ((top >> i) & 1) chk ^= BECH32_GENERATORS[i];
    }
  }
  return chk;
}

function convertBits(data: Uint8Array, fromBits: number, toBits: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const maxv = (1 << toBits) - 1;
  const result: number[] = [];
  for (const value of data) {
    if (value < 0 || value >> fromBits !== 0) throw new Error('Invalid bech32 source value');
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) result.push((acc << (toBits - bits)) & maxv);
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv) !== 0) {
    throw new Error('Invalid bech32 padding');
  }
  return result;
}

function convertBitsToBytes(data: number[], fromBits: number, toBits: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const maxv = (1 << toBits) - 1;
  const result: number[] = [];
  for (const value of data) {
    if (value < 0 || value >> fromBits !== 0) throw new Error('Invalid bech32 source value');
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) result.push((acc << (toBits - bits)) & maxv);
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv) !== 0) {
    throw new Error('Invalid bech32 padding');
  }
  return result;
}

function derEncodeSignature(signature: Uint8Array): Uint8Array {
  if (signature.length !== 64) throw new Error('Bitcoin signature response is invalid');
  const r = derEncodeInteger(signature.slice(0, 32));
  const s = derEncodeInteger(signature.slice(32, 64));
  return concatBytes(new Uint8Array([0x30, r.length + s.length]), r, s);
}

function derEncodeInteger(value: Uint8Array): Uint8Array {
  let offset = 0;
  while (offset < value.length - 1 && value[offset] === 0) offset += 1;
  const trimmed = value.slice(offset);
  const body = (trimmed[0] & 0x80) !== 0 ? concatBytes(new Uint8Array([0]), trimmed) : trimmed;
  return concatBytes(new Uint8Array([0x02, body.length]), body);
}

function doubleSha256(bytes: Uint8Array): Uint8Array {
  return sha256(sha256(bytes));
}

function encodeVarBytes(bytes: Uint8Array): Uint8Array {
  return concatBytes(encodeVarInt(bytes.length), bytes);
}

function encodeVarInt(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid varint value');
  if (value < 0xfd) return new Uint8Array([value]);
  if (value <= 0xffff) return concatBytes(new Uint8Array([0xfd]), uint16LE(value));
  if (value <= 0xffff_ffff) return concatBytes(new Uint8Array([0xfe]), uint32LE(value));
  return concatBytes(new Uint8Array([0xff]), uint64LE(BigInt(value)));
}

function uint16LE(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}

function uint32LE(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function uint64LE(value: bigint): Uint8Array {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) throw new Error('Invalid uint64 value');
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}

function reverseBytes(bytes: Uint8Array): Uint8Array {
  return bytes.slice().reverse();
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) throw new Error('Invalid hex string');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
