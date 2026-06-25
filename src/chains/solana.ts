import { ed25519 } from '@noble/curves/ed25519.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const LAMPORTS_PER_SOL = 1_000_000_000n;
const ED25519_SEED_KEY = new TextEncoder().encode('ed25519 seed');
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SYSVAR_RENT_ID = 'SysvarRent111111111111111111111111111111111';
const SPL_TOKEN_ACCOUNT_SIZE = 165;
const PDA_MARKER = new TextEncoder().encode('ProgramDerivedAddress');

export interface SolanaKeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  address: string;
}

export interface SolanaTransferResult {
  txHash: string;
}

export interface SolanaTransactionStatus {
  status: 'pending' | 'confirmed' | 'failed';
  error?: string;
}

export interface SplTokenInfo {
  contractAddress: string;
  decimals: number;
  symbol: string;
}

export interface SplRecipientAccountStatus {
  ownerAddress: string;
  recipientOwnerAddress: string;
  mintAddress: string;
  sourceTokenAccount: string;
  recipientTokenAccount: string | null;
  expectedAssociatedTokenAccount: string;
  recipientTokenAccountExists: boolean;
  createRecipientAtaRequired: boolean;
  rentLamports: string | null;
  extraInstruction: string | null;
}

export function deriveSolanaAddress(seed: Uint8Array, accountIndex: number): string {
  const keyPair = deriveSolanaKeyPair(seed, accountIndex);
  keyPair.privateKey.fill(0);
  keyPair.publicKey.fill(0);
  return keyPair.address;
}

export function deriveSolanaKeyPair(seed: Uint8Array, accountIndex: number): SolanaKeyPair {
  const privateKey = deriveSlip10Ed25519(seed, [44, 501, accountIndex, 0]);
  const publicKey = ed25519.getPublicKey(privateKey);
  return {
    privateKey,
    publicKey,
    address: base58Encode(publicKey),
  };
}

export function isSolanaAddress(value: string): boolean {
  try {
    return base58Decode(value).length === 32;
  } catch {
    return false;
  }
}

export function parseSol(value: string): bigint {
  const trimmed = value.trim();
  if (trimmed === '') throw new Error('Amount is required');
  if (trimmed.startsWith('-')) throw new Error('Amount must be non-negative');
  const [whole, fraction = ''] = trimmed.split('.');
  if (!/^\d+$/.test(whole || '0') || !/^\d*$/.test(fraction) || fraction.length > 9) {
    throw new Error('SOL amount must have at most 9 decimal places');
  }
  return BigInt(whole || '0') * LAMPORTS_PER_SOL + BigInt(fraction.padEnd(9, '0') || '0');
}

export function formatSol(lamports: bigint): string {
  const whole = lamports / LAMPORTS_PER_SOL;
  const fraction = (lamports % LAMPORTS_PER_SOL).toString().padStart(9, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export async function getSolanaBalance(rpcUrl: string, address: string): Promise<{ balance: string; formatted: string }> {
  if (!isSolanaAddress(address)) throw new Error('Invalid Solana address');
  const lamports = await solanaRpc<number | string>(rpcUrl, 'getBalance', [address]);
  const balance = BigInt(lamports);
  return { balance: balance.toString(), formatted: formatSol(balance) };
}

export async function sendSolanaTransfer(input: {
  rpcUrl: string;
  privateKey: Uint8Array;
  from: string;
  to: string;
  lamports: bigint;
}): Promise<SolanaTransferResult> {
  if (!isSolanaAddress(input.from)) throw new Error('Invalid Solana sender address');
  if (!isSolanaAddress(input.to)) throw new Error('Invalid Solana recipient address');
  if (input.lamports <= 0n) throw new Error('Amount must be greater than zero');
  if (input.lamports > 0xffff_ffff_ffff_ffffn) throw new Error('Amount exceeds supported Solana transfer limit');

  const latest = await solanaRpc<{ blockhash: string }>(input.rpcUrl, 'getLatestBlockhash', []);
  if (!latest?.blockhash || !isSolanaAddress(latest.blockhash)) throw new Error('Solana blockhash response is invalid');

  const message = buildTransferMessage({
    from: input.from,
    to: input.to,
    lamports: input.lamports,
    recentBlockhash: latest.blockhash,
  });
  const signature = ed25519.sign(message, input.privateKey);
  const transaction = concatBytes(encodeShortVec(1), signature, message);
  const txHash = await solanaRpc<string>(input.rpcUrl, 'sendTransaction', [
    bytesToBase64(transaction),
    { encoding: 'base64', skipPreflight: false },
  ]);
  return { txHash };
}

export async function sendSplTokenTransfer(input: {
  rpcUrl: string;
  privateKey: Uint8Array;
  ownerAddress: string;
  recipientOwnerAddress: string;
  mintAddress: string;
  amountBaseUnits: bigint;
  decimals: number;
  createRecipientAta?: boolean;
}): Promise<SolanaTransferResult> {
  if (!isSolanaAddress(input.ownerAddress)) throw new Error('Invalid Solana owner address');
  if (!isSolanaAddress(input.recipientOwnerAddress)) throw new Error('Invalid Solana recipient address');
  if (!isSolanaAddress(input.mintAddress)) throw new Error('Invalid SPL token mint address');
  if (input.amountBaseUnits <= 0n) throw new Error('Amount must be greater than zero');
  if (input.amountBaseUnits > 0xffff_ffff_ffff_ffffn) throw new Error('Amount exceeds supported SPL transfer limit');
  if (!Number.isInteger(input.decimals) || input.decimals < 0 || input.decimals > 36) {
    throw new Error('Token decimals must be an integer between 0 and 36');
  }

  const [sourceAccount, destinationAccounts, latest] = await Promise.all([
    findSplTokenAccount(input.rpcUrl, input.ownerAddress, input.mintAddress, input.amountBaseUnits),
    getSplTokenAccounts(input.rpcUrl, input.recipientOwnerAddress, input.mintAddress),
    solanaRpc<{ blockhash: string }>(input.rpcUrl, 'getLatestBlockhash', []),
  ]);
  if (!latest?.blockhash || !isSolanaAddress(latest.blockhash)) throw new Error('Solana blockhash response is invalid');
  const existingDestination = destinationAccounts[0]?.pubkey;
  const destinationAccount = existingDestination ?? deriveAssociatedTokenAddress(input.recipientOwnerAddress, input.mintAddress);
  if (!existingDestination && input.createRecipientAta !== true) {
    throw new Error('Recipient SPL token account not found. Create the recipient ATA first; automatic creation requires rent and an extra instruction.');
  }

  const message = existingDestination ? buildSplTransferCheckedMessage({
    ownerAddress: input.ownerAddress,
    sourceTokenAccount: sourceAccount,
    destinationTokenAccount: destinationAccount,
    mintAddress: input.mintAddress,
    amountBaseUnits: input.amountBaseUnits,
    decimals: input.decimals,
    recentBlockhash: latest.blockhash,
  }) : buildCreateAtaAndSplTransferCheckedMessage({
    payerAddress: input.ownerAddress,
    recipientOwnerAddress: input.recipientOwnerAddress,
    associatedTokenAccount: destinationAccount,
    sourceTokenAccount: sourceAccount,
    mintAddress: input.mintAddress,
    amountBaseUnits: input.amountBaseUnits,
    decimals: input.decimals,
    recentBlockhash: latest.blockhash,
  });
  const signature = ed25519.sign(message, input.privateKey);
  const transaction = concatBytes(encodeShortVec(1), signature, message);
  const txHash = await solanaRpc<string>(input.rpcUrl, 'sendTransaction', [
    bytesToBase64(transaction),
    { encoding: 'base64', skipPreflight: false },
  ]);
  return { txHash };
}

export async function getSplRecipientAccountStatus(input: {
  rpcUrl: string;
  ownerAddress: string;
  recipientOwnerAddress: string;
  mintAddress: string;
  amountBaseUnits: bigint;
}): Promise<SplRecipientAccountStatus> {
  if (!isSolanaAddress(input.ownerAddress)) throw new Error('Invalid Solana owner address');
  if (!isSolanaAddress(input.recipientOwnerAddress)) throw new Error('Invalid Solana recipient address');
  if (!isSolanaAddress(input.mintAddress)) throw new Error('Invalid SPL token mint address');
  if (input.amountBaseUnits <= 0n) throw new Error('Amount must be greater than zero');
  const [sourceTokenAccount, recipientAccounts] = await Promise.all([
    findSplTokenAccount(input.rpcUrl, input.ownerAddress, input.mintAddress, input.amountBaseUnits),
    getSplTokenAccounts(input.rpcUrl, input.recipientOwnerAddress, input.mintAddress),
  ]);
  const expectedAssociatedTokenAccount = deriveAssociatedTokenAddress(input.recipientOwnerAddress, input.mintAddress);
  const recipientTokenAccount = recipientAccounts[0]?.pubkey ?? null;
  const createRecipientAtaRequired = recipientTokenAccount == null;
  const rentLamports = createRecipientAtaRequired
    ? String(await solanaRpc<number | string>(input.rpcUrl, 'getMinimumBalanceForRentExemption', [SPL_TOKEN_ACCOUNT_SIZE]))
    : null;
  return {
    ownerAddress: input.ownerAddress,
    recipientOwnerAddress: input.recipientOwnerAddress,
    mintAddress: input.mintAddress,
    sourceTokenAccount,
    recipientTokenAccount,
    expectedAssociatedTokenAccount,
    recipientTokenAccountExists: !createRecipientAtaRequired,
    createRecipientAtaRequired,
    rentLamports,
    extraInstruction: createRecipientAtaRequired ? 'Create Associated Token Account before SPL TransferChecked' : null,
  };
}

export async function getSolanaTransactionStatus(rpcUrl: string, txHash: string): Promise<SolanaTransactionStatus> {
  const result = await solanaRpc<Array<{ confirmationStatus?: string; err?: unknown } | null>>(
    rpcUrl,
    'getSignatureStatuses',
    [[txHash]],
  );
  const status = result[0];
  if (!status) return { status: 'pending' };
  if (status.err != null) return { status: 'failed', error: formatSolanaTransactionError(status.err) };
  if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
    return { status: 'confirmed' };
  }
  return { status: 'pending' };
}

export async function getSplTokenInfo(rpcUrl: string, mintAddress: string): Promise<SplTokenInfo> {
  if (!isSolanaAddress(mintAddress)) throw new Error('Invalid SPL token mint address');
  const account = await solanaRpc<{ data?: { parsed?: { info?: { decimals?: number } } } | null } | null>(
    rpcUrl,
    'getParsedAccountInfo',
    [mintAddress, { encoding: 'jsonParsed' }],
  );
  const decimals = account?.data?.parsed?.info?.decimals;
  if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error('SPL token mint response is invalid');
  }
  return { contractAddress: mintAddress, decimals, symbol: 'SPL' };
}

export async function getSplTokenBalance(input: {
  rpcUrl: string;
  ownerAddress: string;
  mintAddress: string;
  decimals?: number;
  symbol?: string;
}): Promise<{ balance: string; formatted: string; decimals: number; symbol: string }> {
  if (!isSolanaAddress(input.ownerAddress)) throw new Error('Invalid Solana owner address');
  if (!isSolanaAddress(input.mintAddress)) throw new Error('Invalid SPL token mint address');
  const accounts = await getSplTokenAccounts(input.rpcUrl, input.ownerAddress, input.mintAddress);
  let decimals = input.decimals;
  let total = 0n;
  for (const account of accounts) {
    if (decimals === undefined) decimals = account.decimals;
    total += account.amount;
  }
  if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error('SPL token account response is invalid');
  }
  const normalizedDecimals = decimals;
  return {
    balance: total.toString(),
    formatted: formatTokenAmount(total, normalizedDecimals),
    decimals: normalizedDecimals,
    symbol: input.symbol ?? 'SPL',
  };
}

async function findSplTokenAccount(
  rpcUrl: string,
  ownerAddress: string,
  mintAddress: string,
  minimumAmount = 0n,
): Promise<string> {
  const accounts = await getSplTokenAccounts(rpcUrl, ownerAddress, mintAddress);
  const match = accounts.find((account) => account.amount >= minimumAmount);
  if (!match) {
    throw new Error(
      minimumAmount > 0n
        ? 'Insufficient SPL token balance'
        : 'Recipient SPL token account not found. Create the recipient ATA first; automatic creation requires rent and an extra instruction.',
    );
  }
  return match.pubkey;
}

async function getSplTokenAccounts(
  rpcUrl: string,
  ownerAddress: string,
  mintAddress: string,
): Promise<Array<{ pubkey: string; amount: bigint; decimals?: number }>> {
  const accounts = await solanaRpc<Array<{
    pubkey?: string;
    account?: {
      data?: {
        parsed?: {
          info?: {
            tokenAmount?: {
              amount?: string;
              decimals?: number;
            };
          };
        };
      };
    };
  }>>(
    rpcUrl,
    'getTokenAccountsByOwner',
    [ownerAddress, { mint: mintAddress }, { encoding: 'jsonParsed' }],
  );
  return accounts.map((account) => {
    const tokenAmount = account.account?.data?.parsed?.info?.tokenAmount;
    if (!account.pubkey || !isSolanaAddress(account.pubkey) || !tokenAmount?.amount || !/^\d+$/.test(tokenAmount.amount)) {
      throw new Error('SPL token account response is invalid');
    }
    return {
      pubkey: account.pubkey,
      amount: BigInt(tokenAmount.amount),
      decimals: tokenAmount.decimals,
    };
  });
}

async function solanaRpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  if (!res.ok) throw new Error(`solana rpc request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as { result?: unknown; error?: { code?: number; message?: string } };
  if (data.error) throw new Error(formatSolanaRpcError(data.error.message ?? 'RPC error', data.error.code));
  const result = data.result as { value?: T } | T;
  if (result && typeof result === 'object' && 'value' in result) return result.value as T;
  return result as T;
}

function formatSolanaRpcError(message: string, code?: number): string {
  const lower = message.toLowerCase();
  if (
    lower.includes('blockhash not found') ||
    lower.includes('blockhashnotfound') ||
    lower.includes('block height exceeded') ||
    lower.includes('expired blockhash')
  ) {
    return 'Solana blockhash expired. Refresh the transaction and try again.';
  }
  if (lower.includes('insufficient funds') || lower.includes('insufficient lamports') || lower.includes('rent')) {
    return 'Insufficient SOL for amount, fees, or rent.';
  }
  if (
    lower.includes('computationalbudgetexceeded') ||
    lower.includes('compute budget') ||
    lower.includes('priority fee') ||
    lower.includes('would exceed max block cost limit')
  ) {
    return 'Solana transaction needs a higher priority fee or compute budget. Retry with priority fee support enabled.';
  }
  if (lower.includes('account not found') || lower.includes('could not find account')) {
    return 'Solana account was not found. Check the recipient address and token account before retrying.';
  }
  return `[${code ?? -32000}] ${message}`;
}

function formatSolanaTransactionError(error: unknown): string {
  const message = typeof error === 'string'
    ? error
    : (() => {
        try {
          return JSON.stringify(error);
        } catch {
          return String(error);
        }
      })();
  return formatSolanaRpcError(message);
}

function formatTokenAmount(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString();
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function deriveSlip10Ed25519(seed: Uint8Array, path: number[]): Uint8Array {
  let digest = hmac(sha512, ED25519_SEED_KEY, seed);
  let key = digest.slice(0, 32);
  let chainCode = digest.slice(32);
  for (const index of path) {
    const data = new Uint8Array(37);
    data[0] = 0;
    data.set(key, 1);
    writeUint32BE(data, 33, index + 0x80000000);
    digest = hmac(sha512, chainCode, data);
    key.fill(0);
    chainCode.fill(0);
    key = digest.slice(0, 32);
    chainCode = digest.slice(32);
  }
  chainCode.fill(0);
  return key;
}

function buildTransferMessage(input: {
  from: string;
  to: string;
  lamports: bigint;
  recentBlockhash: string;
}): Uint8Array {
  const from = base58Decode(input.from);
  const to = base58Decode(input.to);
  const systemProgram = base58Decode(SYSTEM_PROGRAM_ID);
  const recentBlockhash = base58Decode(input.recentBlockhash);
  const data = new Uint8Array(12);
  writeUint32LE(data, 0, 2);
  writeBigUint64LE(data, 4, input.lamports);
  return concatBytes(
    new Uint8Array([1, 0, 1]),
    encodeShortVec(3),
    from,
    to,
    systemProgram,
    recentBlockhash,
    encodeShortVec(1),
    new Uint8Array([2]),
    encodeShortVec(2),
    new Uint8Array([0, 1]),
    encodeShortVec(data.length),
    data,
  );
}

function buildSplTransferCheckedMessage(input: {
  ownerAddress: string;
  sourceTokenAccount: string;
  destinationTokenAccount: string;
  mintAddress: string;
  amountBaseUnits: bigint;
  decimals: number;
  recentBlockhash: string;
}): Uint8Array {
  const owner = base58Decode(input.ownerAddress);
  const source = base58Decode(input.sourceTokenAccount);
  const destination = base58Decode(input.destinationTokenAccount);
  const mint = base58Decode(input.mintAddress);
  const tokenProgram = base58Decode(SPL_TOKEN_PROGRAM_ID);
  const recentBlockhash = base58Decode(input.recentBlockhash);
  const data = new Uint8Array(10);
  data[0] = 12;
  writeBigUint64LE(data, 1, input.amountBaseUnits);
  data[9] = input.decimals;
  return concatBytes(
    new Uint8Array([1, 0, 2]),
    encodeShortVec(5),
    owner,
    source,
    destination,
    mint,
    tokenProgram,
    recentBlockhash,
    encodeShortVec(1),
    new Uint8Array([4]),
    encodeShortVec(4),
    new Uint8Array([1, 3, 2, 0]),
    encodeShortVec(data.length),
    data,
  );
}

function buildCreateAtaAndSplTransferCheckedMessage(input: {
  payerAddress: string;
  recipientOwnerAddress: string;
  associatedTokenAccount: string;
  sourceTokenAccount: string;
  mintAddress: string;
  amountBaseUnits: bigint;
  decimals: number;
  recentBlockhash: string;
}): Uint8Array {
  const payer = base58Decode(input.payerAddress);
  const source = base58Decode(input.sourceTokenAccount);
  const associatedTokenAccount = base58Decode(input.associatedTokenAccount);
  const recipientOwner = base58Decode(input.recipientOwnerAddress);
  const mint = base58Decode(input.mintAddress);
  const systemProgram = base58Decode(SYSTEM_PROGRAM_ID);
  const tokenProgram = base58Decode(SPL_TOKEN_PROGRAM_ID);
  const rentSysvar = base58Decode(SYSVAR_RENT_ID);
  const associatedTokenProgram = base58Decode(ASSOCIATED_TOKEN_PROGRAM_ID);
  const recentBlockhash = base58Decode(input.recentBlockhash);
  const transferData = new Uint8Array(10);
  transferData[0] = 12;
  writeBigUint64LE(transferData, 1, input.amountBaseUnits);
  transferData[9] = input.decimals;
  return concatBytes(
    new Uint8Array([1, 0, 6]),
    encodeShortVec(9),
    payer,
    source,
    associatedTokenAccount,
    recipientOwner,
    mint,
    systemProgram,
    tokenProgram,
    rentSysvar,
    associatedTokenProgram,
    recentBlockhash,
    encodeShortVec(2),
    new Uint8Array([8]),
    encodeShortVec(7),
    new Uint8Array([0, 2, 3, 4, 5, 6, 7]),
    encodeShortVec(0),
    new Uint8Array([6]),
    encodeShortVec(4),
    new Uint8Array([1, 4, 2, 0]),
    encodeShortVec(transferData.length),
    transferData,
  );
}

function deriveAssociatedTokenAddress(ownerAddress: string, mintAddress: string): string {
  const owner = base58Decode(ownerAddress);
  const tokenProgram = base58Decode(SPL_TOKEN_PROGRAM_ID);
  const mint = base58Decode(mintAddress);
  const associatedTokenProgram = base58Decode(ASSOCIATED_TOKEN_PROGRAM_ID);
  for (let bump = 255; bump >= 0; bump--) {
    const candidate = sha256(concatBytes(
      owner,
      tokenProgram,
      mint,
      new Uint8Array([bump]),
      associatedTokenProgram,
      PDA_MARKER,
    ));
    if (!isEd25519Point(candidate)) return base58Encode(candidate);
  }
  throw new Error('Unable to derive Solana associated token account');
}

function isEd25519Point(bytes: Uint8Array): boolean {
  try {
    ed25519.Point.fromHex(bytesToHex(bytes));
    return true;
  } catch {
    return false;
  }
}

function encodeShortVec(value: number): Uint8Array {
  const out = [];
  let remaining = value;
  do {
    let elem = remaining & 0x7f;
    remaining >>= 7;
    if (remaining) elem |= 0x80;
    out.push(elem);
  } while (remaining);
  return new Uint8Array(out);
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
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function writeUint32BE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function writeUint32LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function writeBigUint64LE(bytes: Uint8Array, offset: number, value: bigint): void {
  for (let i = 0; i < 8; i++) {
    bytes[offset + i] = Number((value >> BigInt(i * 8)) & 0xffn);
  }
}
