import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { HDKey } from '@scure/bip32';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const TRON_PREFIX = 0x41;
const SUN_PER_TRX = 1_000_000n;

export interface TronKeyPair {
  privateKey: Uint8Array;
  address: string;
}

export interface TronTransferResult {
  txHash: string;
}

export interface Trc20TokenInfo {
  contractAddress: string;
  symbol: string | null;
  decimals: number;
}

export interface Trc20Balance {
  balance: string;
  formatted: string;
  decimals: number;
  symbol: string | null;
}

export interface TronTransactionStatus {
  status: 'pending' | 'confirmed' | 'failed';
  blockNumber?: string | null;
  error?: string;
}

interface TronTransaction {
  txID?: string;
  raw_data?: unknown;
  raw_data_hex?: string;
  signature?: string[];
}

export function deriveTronAddress(seed: Uint8Array, accountIndex: number): string {
  const keyPair = deriveTronKeyPair(seed, accountIndex);
  keyPair.privateKey.fill(0);
  return keyPair.address;
}

export function deriveTronKeyPair(seed: Uint8Array, accountIndex: number): TronKeyPair {
  const root = HDKey.fromMasterSeed(seed);
  const child = root.derive(`m/44'/195'/${accountIndex}'/0/0`);
  if (!child.privateKey) throw new Error('Unable to derive Tron private key');
  const privateKey = child.privateKey.slice();
  const publicKey = secp256k1.getPublicKey(privateKey, false).slice(1);
  const hash = keccak_256(publicKey);
  const payload = new Uint8Array(21);
  payload[0] = TRON_PREFIX;
  payload.set(hash.slice(-20), 1);
  child.privateKey.fill(0);
  return { privateKey, address: base58CheckEncode(payload) };
}

export function isTronAddress(value: string): boolean {
  try {
    const payload = base58CheckDecode(value);
    return payload.length === 21 && payload[0] === TRON_PREFIX;
  } catch {
    return false;
  }
}

export function tronAddressToHex(value: string): string {
  const payload = base58CheckDecode(value);
  if (payload.length !== 21 || payload[0] !== TRON_PREFIX) {
    throw new Error('Invalid Tron address');
  }
  return bytesToHex(payload);
}

export function formatTrx(sun: bigint): string {
  const whole = sun / SUN_PER_TRX;
  const fraction = (sun % SUN_PER_TRX).toString().padStart(6, '0');
  return `${whole}.${fraction}`;
}

export function parseTrx(value: string): bigint {
  const trimmed = value.trim();
  if (trimmed === '') throw new Error('Amount is required');
  if (trimmed.startsWith('-')) throw new Error('Amount must be non-negative');
  const [whole, fraction = ''] = trimmed.split('.');
  if (!/^\d+$/.test(whole || '0') || !/^\d*$/.test(fraction) || fraction.length > 6) {
    throw new Error('TRX amount must have at most 6 decimal places');
  }
  return BigInt(whole || '0') * SUN_PER_TRX + BigInt(fraction.padEnd(6, '0') || '0');
}

export async function getTronBalance(rpcUrl: string, address: string): Promise<{ balance: string; formatted: string }> {
  if (!isTronAddress(address)) throw new Error('Invalid Tron address');
  const res = await fetch(`${rpcUrl.replace(/\/+$/, '')}/wallet/getaccount`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: tronAddressToHex(address), visible: false }),
  });
  if (!res.ok) {
    throw new Error(`tron rpc request failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json() as { balance?: number | string };
  const balance = data.balance == null ? 0n : BigInt(data.balance);
  return { balance: balance.toString(), formatted: formatTrx(balance) };
}

export async function sendTronTransfer(input: {
  rpcUrl: string;
  privateKey: Uint8Array;
  from: string;
  to: string;
  amountSun: bigint;
}): Promise<TronTransferResult> {
  if (!isTronAddress(input.from)) throw new Error('Invalid Tron sender address');
  if (!isTronAddress(input.to)) throw new Error('Invalid Tron recipient address');
  if (input.amountSun <= 0n) throw new Error('Amount must be greater than zero');
  if (input.amountSun > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Amount exceeds supported Tron transfer limit');
  }

  const unsigned = await tronRpc<TronTransaction>(
    input.rpcUrl,
    '/wallet/createtransaction',
    {
      owner_address: input.from,
      to_address: input.to,
      amount: Number(input.amountSun),
      visible: true,
    },
  );
  if (!unsigned.txID || !unsigned.raw_data || !unsigned.raw_data_hex) {
    throw new Error('Tron create transaction response is invalid');
  }

  return signAndBroadcastTronTransaction(input.rpcUrl, unsigned, input.privateKey);
}

export async function getTrc20TokenInfo(rpcUrl: string, ownerAddress: string, contractAddress: string): Promise<Trc20TokenInfo> {
  assertTronContractAddress(contractAddress);
  const [decimalsRaw, symbolRaw] = await Promise.all([
    triggerConstantContract(rpcUrl, ownerAddress, contractAddress, 'decimals()', ''),
    triggerConstantContract(rpcUrl, ownerAddress, contractAddress, 'symbol()', ''),
  ]);
  const decimals = Number(decodeUint256(decimalsRaw));
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error('TRC20 decimals response is invalid');
  }
  return {
    contractAddress,
    decimals,
    symbol: decodeAbiString(symbolRaw),
  };
}

export async function getTrc20Balance(input: {
  rpcUrl: string;
  ownerAddress: string;
  contractAddress: string;
  decimals?: number;
  symbol?: string | null;
}): Promise<Trc20Balance> {
  assertTronContractAddress(input.contractAddress);
  if (!isTronAddress(input.ownerAddress)) throw new Error('Invalid Tron owner address');
  const decimals = input.decimals ?? (await getTrc20TokenInfo(input.rpcUrl, input.ownerAddress, input.contractAddress)).decimals;
  const raw = await triggerConstantContract(
    input.rpcUrl,
    input.ownerAddress,
    input.contractAddress,
    'balanceOf(address)',
    encodeAbiAddress(input.ownerAddress),
  );
  const balance = decodeUint256(raw);
  return {
    balance: balance.toString(),
    formatted: formatTokenAmount(balance, decimals),
    decimals,
    symbol: input.symbol ?? null,
  };
}

export async function sendTrc20Transfer(input: {
  rpcUrl: string;
  privateKey: Uint8Array;
  from: string;
  contractAddress: string;
  to: string;
  amount: string;
  decimals: number;
}): Promise<TronTransferResult & { amountBaseUnits: string }> {
  if (!isTronAddress(input.from)) throw new Error('Invalid Tron sender address');
  if (!isTronAddress(input.to)) throw new Error('Invalid Tron recipient address');
  assertTronContractAddress(input.contractAddress);
  const amountBaseUnits = parseTokenAmount(input.amount, input.decimals);
  if (amountBaseUnits <= 0n) throw new Error('Amount must be greater than zero');

  const unsigned = await tronRpc<TronTransaction>(
    input.rpcUrl,
    '/wallet/triggersmartcontract',
    {
      owner_address: input.from,
      contract_address: input.contractAddress,
      function_selector: 'transfer(address,uint256)',
      parameter: `${encodeAbiAddress(input.to)}${encodeUint256(amountBaseUnits)}`,
      fee_limit: 100_000_000,
      call_value: 0,
      visible: true,
    },
  );
  assertTronTriggerResult(unsigned);
  if (!unsigned.txID || !unsigned.raw_data || !unsigned.raw_data_hex) {
    throw new Error('TRC20 trigger response is invalid');
  }
  const result = await signAndBroadcastTronTransaction(input.rpcUrl, unsigned, input.privateKey);
  return { ...result, amountBaseUnits: amountBaseUnits.toString() };
}

export async function getTronTransactionStatus(rpcUrl: string, txHash: string): Promise<TronTransactionStatus> {
  if (!/^[0-9a-fA-F]{64}$/.test(txHash)) throw new Error('Invalid Tron transaction hash');
  const info = await tronRpc<{
    id?: string;
    blockNumber?: number | string;
    receipt?: { result?: string; energy_usage_total?: number | string; net_usage?: number | string };
    result?: string;
    contractRet?: string;
    resMessage?: string;
  }>(rpcUrl, '/wallet/gettransactioninfobyid', { value: txHash });

  if (!info.id && info.blockNumber == null && !info.receipt) {
    return { status: 'pending' };
  }
  const result = info.receipt?.result ?? info.contractRet ?? info.result;
  if (result && result !== 'SUCCESS') {
    return {
      status: 'failed',
      blockNumber: formatBlockNumber(info.blockNumber),
      error: formatTronExecutionError(result, info.resMessage),
    };
  }
  return {
    status: 'confirmed',
    blockNumber: formatBlockNumber(info.blockNumber),
  };
}

async function tronRpc<T>(rpcUrl: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${rpcUrl.replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`tron rpc request failed: ${res.status} ${res.statusText}`);
  }
  return await res.json() as T;
}

function assertTronTriggerResult(unsigned: TronTransaction & { result?: { result?: boolean; code?: string; message?: string } }): void {
  if (unsigned.result?.result === false) {
    throw new Error(formatTronExecutionError(unsigned.result.code ?? 'TRC20 trigger failed', unsigned.result.message));
  }
}

async function triggerConstantContract(
  rpcUrl: string,
  ownerAddress: string,
  contractAddress: string,
  functionSelector: string,
  parameter: string,
): Promise<string> {
  if (!isTronAddress(ownerAddress)) throw new Error('Invalid Tron owner address');
  const response = await tronRpc<{ constant_result?: string[]; result?: { result?: boolean; message?: string } }>(
    rpcUrl,
    '/wallet/triggerconstantcontract',
    {
      owner_address: ownerAddress,
      contract_address: contractAddress,
      function_selector: functionSelector,
      parameter,
      visible: true,
    },
  );
  if (response.result?.result === false) {
    throw new Error(`TRC20 constant call failed: ${response.result.message ?? 'unknown error'}`);
  }
  const value = response.constant_result?.[0];
  if (!value || !/^[0-9a-fA-F]*$/.test(value)) throw new Error('TRC20 constant call response is invalid');
  return value;
}

async function signAndBroadcastTronTransaction(
  rpcUrl: string,
  unsigned: TronTransaction,
  privateKey: Uint8Array,
): Promise<TronTransferResult> {
  if (!unsigned.txID || !unsigned.raw_data || !unsigned.raw_data_hex) {
    throw new Error('Tron transaction response is invalid');
  }
  const signature = secp256k1.sign(hexToBytes(unsigned.txID), privateKey, { lowS: true });
  const signed: TronTransaction = {
    ...unsigned,
    signature: [bytesToHex(signature)],
  };
  const broadcast = await tronRpc<{ result?: boolean; txid?: string; code?: string; message?: string }>(
    rpcUrl,
    '/wallet/broadcasttransaction',
    signed,
  );
  if (broadcast.result !== true) {
    throw new Error(formatTronExecutionError(broadcast.code ?? 'Tron broadcast failed', broadcast.message));
  }
  return { txHash: broadcast.txid ?? unsigned.txID };
}

function formatTronExecutionError(code: string, message?: string): string {
  const normalizedCode = code.trim() || 'Tron transaction failed';
  const decoded = decodeTronMessage(message);
  const lower = `${normalizedCode} ${decoded}`.toLowerCase();
  if (lower.includes('out_of_energy') || lower.includes('energy')) {
    return `Tron transaction failed: ${normalizedCode}. Energy is insufficient; freeze or rent Energy, or keep enough TRX to burn for fees${decoded ? ` (${decoded})` : ''}`;
  }
  if (lower.includes('bandwidth') || lower.includes('net_usage') || lower.includes('net usage')) {
    return `Tron transaction failed: ${normalizedCode}. Bandwidth is insufficient; freeze TRX for bandwidth or keep enough TRX to burn for bandwidth${decoded ? ` (${decoded})` : ''}`;
  }
  if (lower.includes('revert') || lower.includes('contract validate error')) {
    return `TRC20 contract reverted: ${decoded || normalizedCode}`;
  }
  return `Tron transaction failed: ${decoded ? `${normalizedCode}: ${decoded}` : normalizedCode}`;
}

function decodeTronMessage(message?: string): string {
  const raw = message?.trim() ?? '';
  if (!raw) return '';
  if (/^(0x)?[0-9a-fA-F]+$/.test(raw) && raw.replace(/^0x/i, '').length % 2 === 0) {
    try {
      const bytes = hexToBytes(raw.replace(/^0x/i, ''));
      return new TextDecoder().decode(bytes).replace(/\0+$/g, '').trim();
    } catch {
      return raw;
    }
  }
  return raw;
}

function assertTronContractAddress(value: string): void {
  if (!isTronAddress(value)) throw new Error('Invalid TRC20 contract address');
}

export function parseTokenAmount(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error('Token decimals must be an integer between 0 and 36');
  }
  const trimmed = value.trim();
  if (trimmed === '') throw new Error('Amount is required');
  if (trimmed.startsWith('-')) throw new Error('Amount must be non-negative');
  const [whole, fraction = ''] = trimmed.split('.');
  if (!/^\d+$/.test(whole || '0') || !/^\d*$/.test(fraction) || fraction.length > decimals) {
    throw new Error(`Token amount must have at most ${decimals} decimal places`);
  }
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
}

function formatTokenAmount(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString();
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function encodeAbiAddress(value: string): string {
  return tronAddressToHex(value).slice(2).padStart(64, '0');
}

function encodeUint256(value: bigint): string {
  if (value < 0n) throw new Error('uint256 value must be non-negative');
  return value.toString(16).padStart(64, '0');
}

function decodeUint256(hex: string): bigint {
  if (!/^[0-9a-fA-F]{1,64}$/.test(hex)) throw new Error('uint256 response is invalid');
  return BigInt(`0x${hex}`);
}

function decodeAbiString(hex: string): string | null {
  if (hex === '') return null;
  if (!/^[0-9a-fA-F]+$/.test(hex)) throw new Error('ABI string response is invalid');
  if (hex.length === 64) {
    const bytes = hexToBytes(hex).filter((byte) => byte !== 0);
    return bytes.length > 0 ? new TextDecoder().decode(bytes) : null;
  }
  if (hex.length < 128) return null;
  const length = Number(BigInt(`0x${hex.slice(64, 128)}`));
  if (!Number.isSafeInteger(length) || length < 0) throw new Error('ABI string length is invalid');
  const data = hex.slice(128, 128 + length * 2);
  if (data.length !== length * 2) throw new Error('ABI string data is truncated');
  return length > 0 ? new TextDecoder().decode(hexToBytes(data)) : null;
}

function base58CheckEncode(payload: Uint8Array): string {
  const checksum = sha256(sha256(payload)).slice(0, 4);
  const data = new Uint8Array(payload.length + checksum.length);
  data.set(payload);
  data.set(checksum, payload.length);
  return base58Encode(data);
}

function base58CheckDecode(value: string): Uint8Array {
  const data = base58Decode(value);
  if (data.length < 5) throw new Error('Invalid base58check payload');
  const payload = data.slice(0, -4);
  const checksum = data.slice(-4);
  const expected = sha256(sha256(payload)).slice(0, 4);
  for (let i = 0; i < 4; i++) {
    if (checksum[i] !== expected[i]) throw new Error('Invalid base58check checksum');
  }
  return payload;
}

function base58Encode(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) + BigInt(byte);
  let output = '';
  while (value > 0n) {
    const mod = value % 58n;
    output = BASE58_ALPHABET[Number(mod)] + output;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    output = BASE58_ALPHABET[0] + output;
  }
  return output || BASE58_ALPHABET[0];
}

function base58Decode(value: string): Uint8Array {
  let decoded = 0n;
  for (const char of value) {
    const index = BASE58_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base58 character');
    decoded = decoded * 58n + BigInt(index);
  }
  let hex = decoded.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  let bytes = hex === '00' ? new Uint8Array() : hexToBytes(hex);
  let leadingZeroes = 0;
  for (const char of value) {
    if (char !== BASE58_ALPHABET[0]) break;
    leadingZeroes += 1;
  }
  if (leadingZeroes > 0) {
    const next = new Uint8Array(leadingZeroes + bytes.length);
    next.set(bytes, leadingZeroes);
    bytes = next;
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function formatBlockNumber(value: number | string | undefined): string | null {
  if (value == null) return null;
  const parsed = typeof value === 'number' ? BigInt(value) : BigInt(value);
  return `0x${parsed.toString(16)}`;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
