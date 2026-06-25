import { ed25519 } from '@noble/curves/ed25519.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { sha3_256 } from '@noble/hashes/sha3.js';

const ED25519_SEED_KEY = new TextEncoder().encode('ed25519 seed');
const OCTAS_PER_APT = 100_000_000n;
const APTOS_ED25519_SCHEME = 0x00;
const APTOS_COIN_STORE = '0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>';

export interface AptosKeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  address: string;
}

export interface AptosTransferResult {
  txHash: string;
  amountOctas: string;
  sequenceNumber: string;
  maxGasAmount: string;
  gasUnitPrice: string;
  expirationTimestampSecs: string;
}

export interface AptosTransactionStatus {
  status: 'pending' | 'confirmed' | 'failed';
  blockNumber?: string | null;
  error?: string;
}

export interface AptosDappPayloadPreview {
  type: string;
  functionId: string | null;
  moduleAddress: string | null;
  moduleName: string | null;
  functionName: string | null;
  typeArguments: string[];
  argumentsSummary: string[];
  knownAction: 'nativeTransfer' | 'unknown';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  riskSummary: string;
  riskFlags: string[];
  recipient?: string;
  amountOctas?: string;
  warnings: string[];
}

export function deriveAptosAddress(seed: Uint8Array, accountIndex: number): string {
  const keyPair = deriveAptosKeyPair(seed, accountIndex);
  keyPair.privateKey.fill(0);
  keyPair.publicKey.fill(0);
  return keyPair.address;
}

export function deriveAptosKeyPair(seed: Uint8Array, accountIndex: number): AptosKeyPair {
  const privateKey = deriveSlip10Ed25519(seed, [44, 637, accountIndex, 0, 0]);
  const publicKey = ed25519.getPublicKey(privateKey);
  return {
    privateKey,
    publicKey,
    address: deriveAptosAddressFromPublicKey(publicKey),
  };
}

export function deriveAptosAddressFromPublicKey(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) throw new Error('Aptos Ed25519 public key must be 32 bytes');
  const input = new Uint8Array(33);
  input.set(publicKey, 0);
  input[32] = APTOS_ED25519_SCHEME;
  return `0x${bytesToHex(sha3_256(input))}`;
}

export function isAptosAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{1,64}$/.test(value);
}

export function normalizeAptosAddress(value: string): string {
  if (!isAptosAddress(value)) throw new Error('Invalid Aptos address');
  return `0x${value.slice(2).toLowerCase().padStart(64, '0')}`;
}

export function previewAptosDappPayload(payload: unknown): AptosDappPayloadPreview {
  if (!payload || typeof payload !== 'object') throw new Error('Aptos payload must be an object');
  const candidate = payload as {
    type?: unknown;
    function?: unknown;
    function_id?: unknown;
    type_arguments?: unknown;
    typeArguments?: unknown;
    arguments?: unknown;
    args?: unknown;
  };
  const type = typeof candidate.type === 'string' && candidate.type.trim()
    ? candidate.type.trim()
    : 'entry_function_payload';
  const functionId = typeof candidate.function === 'string'
    ? candidate.function.trim()
    : typeof candidate.function_id === 'string'
      ? candidate.function_id.trim()
      : null;
  const typeArguments = normalizeAptosStringArray(candidate.type_arguments ?? candidate.typeArguments);
  const rawArguments = Array.isArray(candidate.arguments) ? candidate.arguments : Array.isArray(candidate.args) ? candidate.args : [];
  const parsedFunction = functionId ? parseAptosFunctionId(functionId) : null;
  const normalizedFunctionId = parsedFunction
    ? `${parsedFunction.moduleAddress}::${parsedFunction.moduleName}::${parsedFunction.functionName}`
    : functionId;
  const warnings: string[] = [];
  if (type !== 'entry_function_payload') warnings.push(`Unsupported Aptos payload type: ${type}`);
  if (!parsedFunction) warnings.push('Aptos entry function is missing or invalid.');
  if (rawArguments.length > 8) warnings.push('Aptos payload has many arguments; inspect carefully before signing.');
  const risk = classifyAptosPayloadRisk({
    type,
    parsedFunction,
    typeArguments,
    rawArguments,
  });
  const preview: AptosDappPayloadPreview = {
    type,
    functionId: normalizedFunctionId,
    moduleAddress: parsedFunction?.moduleAddress ?? null,
    moduleName: parsedFunction?.moduleName ?? null,
    functionName: parsedFunction?.functionName ?? null,
    typeArguments,
    argumentsSummary: rawArguments.map(formatAptosArgumentSummary),
    knownAction: 'unknown',
    riskLevel: risk.level,
    riskSummary: risk.summary,
    riskFlags: risk.flags,
    warnings,
  };
  if (normalizedFunctionId === '0x0000000000000000000000000000000000000000000000000000000000000001::aptos_account::transfer') {
    const recipient = typeof rawArguments[0] === 'string' && isAptosAddress(rawArguments[0]) ? normalizeAptosAddress(rawArguments[0]) : null;
    const amountOctas = parseAptosPayloadU64(rawArguments[1]);
    if (recipient && amountOctas != null) {
      preview.knownAction = 'nativeTransfer';
      preview.recipient = recipient;
      preview.amountOctas = amountOctas.toString();
      preview.riskLevel = 'low';
      preview.riskSummary = 'Recognized native APT transfer.';
      preview.riskFlags = ['recognized-native-transfer'];
    } else {
      preview.warnings.push('Aptos transfer payload has invalid recipient or amount.');
      preview.riskLevel = 'high';
      preview.riskSummary = 'Aptos transfer payload is malformed.';
      preview.riskFlags = [...new Set([...preview.riskFlags, 'malformed-transfer'])];
    }
  }
  return preview;
}

export async function getAptosBalance(rpcUrl: string, address: string): Promise<{ balance: string; formatted: string }> {
  const normalizedAddress = normalizeAptosAddress(address);
  const url = `${rpcUrl.replace(/\/+$/, '')}/accounts/${encodeURIComponent(normalizedAddress)}/resource/${encodeURIComponent(APTOS_COIN_STORE)}`;
  const res = await fetch(url);
  if (res.status === 404) return { balance: '0', formatted: formatApt(0n) };
  if (!res.ok) throw new Error(`aptos rpc request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as { data?: { coin?: { value?: string | number } } };
  const value = data.data?.coin?.value;
  if (value == null) throw new Error('Aptos balance response is invalid');
  const balance = BigInt(value);
  return { balance: balance.toString(), formatted: formatApt(balance) };
}

export async function getAptosAccountSequence(rpcUrl: string, address: string): Promise<number> {
  const res = await fetch(`${rpcUrl.replace(/\/+$/, '')}/accounts/${encodeURIComponent(normalizeAptosAddress(address))}`);
  if (res.status === 404) return 0;
  if (!res.ok) throw new Error(`aptos account request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as { sequence_number?: string | number };
  if (data.sequence_number == null) throw new Error('Aptos account response is invalid');
  const sequence = Number(data.sequence_number);
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error('Aptos account response is invalid');
  return sequence;
}

export async function getAptosLedgerChainId(rpcUrl: string): Promise<number> {
  const res = await fetch(`${rpcUrl.replace(/\/+$/, '')}`);
  if (!res.ok) throw new Error(`aptos ledger request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as { chain_id?: number };
  const chainId = data.chain_id;
  if (typeof chainId !== 'number' || !Number.isInteger(chainId) || chainId < 0 || chainId > 255) {
    throw new Error('Aptos ledger response is invalid');
  }
  return chainId;
}

export async function getAptosTransactionStatus(rpcUrl: string, txHash: string): Promise<AptosTransactionStatus> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return { status: 'pending' };
  const res = await fetch(`${rpcUrl.replace(/\/+$/, '')}/transactions/by_hash/${encodeURIComponent(txHash.toLowerCase())}`);
  if (res.status === 404) return { status: 'pending' };
  if (!res.ok) throw new Error(`aptos tx status request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as {
    type?: string;
    success?: boolean;
    version?: string | number;
    vm_status?: string;
    abort_code?: string | number;
  };
  const blockNumber = data.version == null ? null : String(data.version);
  if (data.type === 'pending_transaction' || data.success == null) return { status: 'pending' };
  if (data.success === true) return { status: 'confirmed', blockNumber };
  return {
    status: 'failed',
    blockNumber,
    error: formatAptosVmStatus(data.vm_status, data.abort_code),
  };
}

export async function sendAptosTransfer(input: {
  rpcUrl: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  from: string;
  to: string;
  amountOctas: bigint;
}): Promise<AptosTransferResult> {
  if (input.amountOctas <= 0n) throw new Error('Amount must be greater than zero');
  if (input.amountOctas > 0xffff_ffff_ffff_ffffn) throw new Error('Amount exceeds supported Aptos transfer limit');
  const from = normalizeAptosAddress(input.from);
  const to = normalizeAptosAddress(input.to);
  const expected = deriveAptosAddressFromPublicKey(input.publicKey);
  if (from !== expected) throw new Error('Aptos public key does not match sender address');
  const [account, gasPrice, balance, ledgerChainId] = await Promise.all([
    getAptosAccount(input.rpcUrl, from),
    estimateAptosGasPrice(input.rpcUrl),
    getAptosBalance(input.rpcUrl, from),
    getAptosLedgerChainId(input.rpcUrl),
  ]);
  const maxGasAmount = 2_000n;
  const maxGasFee = maxGasAmount * gasPrice;
  if (BigInt(balance.balance) < input.amountOctas + maxGasFee) {
    throw new Error('Insufficient APT balance for amount and gas.');
  }
  const expirationTimestampSecs = BigInt(Math.floor(Date.now() / 1000) + 600);
  const rawTransaction = encodeRawTransaction({
    sender: from,
    sequenceNumber: BigInt(account.sequence_number),
    payload: encodeAptosTransferPayload(to, input.amountOctas),
    maxGasAmount,
    gasUnitPrice: gasPrice,
    expirationTimestampSecs,
    chainId: ledgerChainId,
  });
  const signature = ed25519.sign(concatBytes(aptosSigningMessage('APTOS::RawTransaction'), rawTransaction), input.privateKey);
  const signedTransaction = encodeSignedTransaction({
    rawTransaction,
    publicKey: input.publicKey,
    signature,
  });
  const txHash = await submitAptosSignedTransaction(input.rpcUrl, signedTransaction);
  return {
    txHash,
    amountOctas: input.amountOctas.toString(),
    sequenceNumber: account.sequence_number,
    maxGasAmount: maxGasAmount.toString(),
    gasUnitPrice: gasPrice.toString(),
    expirationTimestampSecs: expirationTimestampSecs.toString(),
  };
}

export function parseApt(value: string): bigint {
  const trimmed = value.trim();
  if (trimmed === '') throw new Error('Amount is required');
  if (trimmed.startsWith('-')) throw new Error('Amount must be non-negative');
  const [whole, fraction = ''] = trimmed.split('.');
  if (!/^\d+$/.test(whole || '0') || !/^\d*$/.test(fraction) || fraction.length > 8) {
    throw new Error('APT amount must have at most 8 decimal places');
  }
  return BigInt(whole || '0') * OCTAS_PER_APT + BigInt(fraction.padEnd(8, '0') || '0');
}

export function formatApt(octas: bigint): string {
  const whole = octas / OCTAS_PER_APT;
  const fraction = (octas % OCTAS_PER_APT).toString().padStart(8, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function formatAptosVmStatus(vmStatus?: string, abortCode?: string | number): string {
  const status = typeof vmStatus === 'string' && vmStatus.trim() ? vmStatus.trim() : 'unknown VM status';
  const lower = status.toLowerCase();
  if (lower.includes('sequence')) {
    return 'Aptos transaction sequence changed. Refresh wallet state and try again.';
  }
  if (lower.includes('insufficient') || lower.includes('balance')) {
    return 'Insufficient APT balance for amount and gas.';
  }
  if (lower.includes('out_of_gas') || lower.includes('max gas') || lower.includes('gas')) {
    return 'Aptos transaction ran out of gas.';
  }
  const suffix = abortCode == null ? '' : ` (abort code ${String(abortCode)})`;
  return `Aptos transaction failed: ${status}${suffix}`;
}

function parseAptosFunctionId(value: string): { moduleAddress: string; moduleName: string; functionName: string } | null {
  const parts = value.split('::');
  if (parts.length !== 3 || !isAptosAddress(parts[0]) || !parts[1] || !parts[2]) return null;
  return {
    moduleAddress: normalizeAptosAddress(parts[0]),
    moduleName: parts[1],
    functionName: parts[2],
  };
}

function classifyAptosPayloadRisk(input: {
  type: string;
  parsedFunction: { moduleAddress: string; moduleName: string; functionName: string } | null;
  typeArguments: string[];
  rawArguments: unknown[];
}): { level: AptosDappPayloadPreview['riskLevel']; summary: string; flags: string[] } {
  const flags: string[] = [];
  if (input.type !== 'entry_function_payload') flags.push('unsupported-payload-type');
  if (!input.parsedFunction) flags.push('invalid-entry-function');
  if (input.rawArguments.length > 8) flags.push('many-arguments');
  if (!input.parsedFunction) {
    return {
      level: flags.includes('unsupported-payload-type') ? 'critical' : 'high',
      summary: 'Aptos payload cannot be safely decoded.',
      flags,
    };
  }
  const { moduleAddress, moduleName, functionName } = input.parsedFunction;
  const lowerModule = moduleName.toLowerCase();
  const lowerFunction = functionName.toLowerCase();
  const sensitiveWords = ['transfer', 'withdraw', 'mint', 'burn', 'swap', 'stake', 'delegate', 'vote', 'admin', 'owner', 'upgrade', 'publish', 'set_', 'add_', 'remove_'];
  const isFrameworkModule = moduleAddress === '0x0000000000000000000000000000000000000000000000000000000000000001';
  const hasCoinTypeArgument = input.typeArguments.some((item) => /::/.test(item));
  if (!isFrameworkModule) flags.push('third-party-module');
  if (hasCoinTypeArgument) flags.push('type-argument-asset');
  if (sensitiveWords.some((word) => lowerFunction.includes(word))) flags.push('sensitive-function-name');
  if (['coin', 'aptos_account', 'account', 'managed_coin'].includes(lowerModule)) flags.push('asset-or-account-module');
  if (lowerFunction.includes('upgrade') || lowerFunction.includes('publish') || lowerModule.includes('code')) {
    flags.push('code-or-upgrade-operation');
    return { level: 'critical', summary: 'Payload appears to modify or publish code.', flags: [...new Set(flags)] };
  }
  if (flags.includes('third-party-module') && flags.includes('sensitive-function-name')) {
    return { level: 'high', summary: 'Unknown third-party Move function may move assets or change permissions.', flags: [...new Set(flags)] };
  }
  if (flags.includes('sensitive-function-name') || flags.includes('type-argument-asset')) {
    return { level: 'high', summary: 'Move function references asset-like types or sensitive actions.', flags: [...new Set(flags)] };
  }
  if (!isFrameworkModule) {
    return { level: 'high', summary: 'Unknown third-party Move entry function.', flags: [...new Set(flags)] };
  }
  return { level: 'medium', summary: 'Framework Move entry function is not recognized as a safe wallet action.', flags: [...new Set(flags.length ? flags : ['unrecognized-framework-function'])] };
}

function normalizeAptosStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean).slice(0, 16);
}

function formatAptosArgumentSummary(value: unknown): string {
  if (typeof value === 'string') {
    if (isAptosAddress(value)) return normalizeAptosAddress(value);
    return value.length > 80 ? `${value.slice(0, 77)}...` : value;
  }
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value && typeof value === 'object') return 'object';
  return String(value);
}

function parseAptosPayloadU64(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value >= 0n && value <= 0xffff_ffff_ffff_ffffn ? value : null;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const parsed = BigInt(value);
  return parsed <= 0xffff_ffff_ffff_ffffn ? parsed : null;
}

async function getAptosAccount(rpcUrl: string, address: string): Promise<{ sequence_number: string }> {
  const res = await fetch(`${rpcUrl.replace(/\/+$/, '')}/accounts/${encodeURIComponent(address)}`);
  if (res.status === 404) throw new Error('Aptos account is not funded or not created. Fund it before sending.');
  if (!res.ok) throw new Error(`aptos account request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as { sequence_number?: string | number };
  if (data.sequence_number == null) throw new Error('Aptos account response is invalid');
  return { sequence_number: String(data.sequence_number) };
}

async function estimateAptosGasPrice(rpcUrl: string): Promise<bigint> {
  const res = await fetch(`${rpcUrl.replace(/\/+$/, '')}/estimate_gas_price`);
  if (!res.ok) throw new Error(`aptos gas price request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as { gas_estimate?: string | number; prioritized_gas_estimate?: string | number };
  const value = data.gas_estimate ?? data.prioritized_gas_estimate;
  if (value == null) throw new Error('Aptos gas price response is invalid');
  const gasPrice = BigInt(value);
  if (gasPrice <= 0n) throw new Error('Aptos gas price must be greater than zero');
  return gasPrice;
}

async function submitAptosSignedTransaction(rpcUrl: string, signedTransaction: Uint8Array): Promise<string> {
  const res = await fetch(`${rpcUrl.replace(/\/+$/, '')}/transactions`, {
    method: 'POST',
    headers: { 'content-type': 'application/x.aptos.signed_transaction+bcs' },
    body: signedTransaction.buffer.slice(signedTransaction.byteOffset, signedTransaction.byteOffset + signedTransaction.byteLength) as ArrayBuffer,
  });
  if (!res.ok) throw new Error(`aptos broadcast request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as { hash?: string };
  if (typeof data.hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(data.hash)) {
    throw new Error('Aptos submit transaction response is invalid');
  }
  return data.hash.toLowerCase();
}

function encodeRawTransaction(input: {
  sender: string;
  sequenceNumber: bigint;
  payload: Uint8Array;
  maxGasAmount: bigint;
  gasUnitPrice: bigint;
  expirationTimestampSecs: bigint;
  chainId: number;
}): Uint8Array {
  return concatBytes(
    encodeAptosAddress(input.sender),
    bcsU64(input.sequenceNumber),
    input.payload,
    bcsU64(input.maxGasAmount),
    bcsU64(input.gasUnitPrice),
    bcsU64(input.expirationTimestampSecs),
    new Uint8Array([input.chainId & 0xff]),
  );
}

function encodeAptosTransferPayload(to: string, amountOctas: bigint): Uint8Array {
  return concatBytes(
    bcsUleb128(2), // TransactionPayload::EntryFunction
    encodeStructTag('0x1', 'aptos_account', 'transfer'),
    bcsSequence([]),
    bcsSequence([
      bcsBytes(encodeAptosAddress(to)),
      bcsU64(amountOctas),
    ]),
  );
}

function encodeSignedTransaction(input: {
  rawTransaction: Uint8Array;
  publicKey: Uint8Array;
  signature: Uint8Array;
}): Uint8Array {
  return concatBytes(
    input.rawTransaction,
    bcsUleb128(0), // TransactionAuthenticator::Ed25519
    bcsBytes(input.publicKey),
    bcsBytes(input.signature),
  );
}

function encodeStructTag(address: string, moduleName: string, functionName: string): Uint8Array {
  return concatBytes(
    encodeAptosAddress(address),
    bcsString(moduleName),
    bcsString(functionName),
  );
}

function encodeAptosAddress(address: string): Uint8Array {
  const normalized = normalizeAptosAddress(address).slice(2);
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    bytes[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function aptosSigningMessage(domain: string): Uint8Array {
  return sha3_256(new TextEncoder().encode(domain));
}

function bcsU64(value: bigint): Uint8Array {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) throw new Error('BCS u64 out of range');
  const bytes = new Uint8Array(8);
  let remaining = value;
  for (let i = 0; i < 8; i += 1) {
    bytes[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

function bcsUleb128(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('BCS uleb128 out of range');
  const bytes: number[] = [];
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining > 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0);
  return new Uint8Array(bytes);
}

function bcsBytes(bytes: Uint8Array): Uint8Array {
  return concatBytes(bcsUleb128(bytes.length), bytes);
}

function bcsString(value: string): Uint8Array {
  return bcsBytes(new TextEncoder().encode(value));
}

function bcsSequence(items: Uint8Array[]): Uint8Array {
  return concatBytes(bcsUleb128(items.length), ...items);
}

function deriveSlip10Ed25519(seed: Uint8Array, path: number[]): Uint8Array {
  let key = hmac(sha512, ED25519_SEED_KEY, seed);
  let chainCode = key.slice(32);
  let privateKey = key.slice(0, 32);
  for (const index of path) {
    const hardenedIndex = (index | 0x80000000) >>> 0;
    const data = new Uint8Array(1 + 32 + 4);
    data[0] = 0;
    data.set(privateKey, 1);
    data[33] = hardenedIndex >>> 24;
    data[34] = hardenedIndex >>> 16;
    data[35] = hardenedIndex >>> 8;
    data[36] = hardenedIndex;
    key = hmac(sha512, chainCode, data);
    privateKey.fill(0);
    chainCode.fill(0);
    privateKey = key.slice(0, 32);
    chainCode = key.slice(32);
  }
  chainCode.fill(0);
  return privateKey;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(arrays.reduce((sum, item) => sum + item.length, 0));
  let offset = 0;
  for (const item of arrays) {
    output.set(item, offset);
    offset += item.length;
  }
  return output;
}
