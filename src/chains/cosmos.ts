import { HDKey } from '@scure/bip32';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import type { CosmosDenomBalance, CosmosGovernanceProposal, CosmosIbcContext, CosmosIbcDenomTrace, CosmosIbcRoutePreset, CosmosRedelegationEntry, CosmosStakingPosition, CosmosValidatorSummary } from '../types.js';

const DEFAULT_COSMOS_BECH32_PREFIX = 'cosmos';
const DEFAULT_COSMOS_DENOM = 'uatom';
const DEFAULT_COSMOS_DECIMALS = 6;
const DEFAULT_COSMOS_GAS_LIMIT = 200_000n;
const COSMOS_GAS_BUFFER_NUMERATOR = 12n;
const COSMOS_GAS_BUFFER_DENOMINATOR = 10n;
const COSMOS_GAS_PRICE_NUMERATOR = 25n;
const COSMOS_GAS_PRICE_DENOMINATOR = 1_000n;
const MAX_COSMOS_MEMO_BYTES = 1024;
const MAX_IBC_FORWARD_DEPTH = 4;
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

export interface CosmosKeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  address: string;
}

export interface CosmosTransactionStatus {
  status: 'pending' | 'confirmed' | 'failed';
  blockNumber?: string | null;
  error?: string;
}

export interface CosmosTransferResult {
  txHash: string;
  amountUatom: string;
  feeUatom: string;
  gasLimit: string;
  sequence: string;
  accountNumber: string;
}

export interface CosmosDirectSignature {
  pubKeyTypeUrl: string;
  pubKeyBase64: string;
  signatureBase64: string;
}

type CosmosAminoJson = null | boolean | number | string | CosmosAminoJson[] | { [key: string]: CosmosAminoJson };

export type CosmosStakingAction = 'delegate' | 'undelegate';
export type CosmosGovernanceVoteChoice = 'yes' | 'no' | 'abstain' | 'no_with_veto';

interface CosmosBalanceResponse {
  balances?: Array<{
    denom?: string;
    amount?: string;
  }>;
}

interface CosmosAccountResponse {
  account?: {
    account_number?: string;
    sequence?: string;
    base_account?: {
      account_number?: string;
      sequence?: string;
    };
  };
}

interface CosmosBroadcastResponse {
  tx_response?: {
    txhash?: string;
    code?: number;
    raw_log?: string;
  };
}

interface CosmosSimulateResponse {
  gas_info?: {
    gas_used?: string;
  };
}

interface CosmosTxResponse {
  tx_response?: {
    txhash?: string;
    height?: string;
    code?: number;
    raw_log?: string;
  };
}

interface CosmosDelegationsResponse {
  delegation_responses?: Array<{
    delegation?: {
      validator_address?: string;
    };
    balance?: {
      denom?: string;
      amount?: string;
    };
  }>;
}

interface CosmosRedelegationsResponse {
  redelegation_responses?: Array<{
    redelegation?: {
      validator_src_address?: string;
      validator_dst_address?: string;
      entries?: Array<{
        creation_height?: string;
        completion_time?: string;
        initial_balance?: string;
        shares_dst?: string;
      }>;
    };
    entries?: Array<{
      redelegation_entry?: {
        creation_height?: string;
        completion_time?: string;
        initial_balance?: string;
        shares_dst?: string;
      };
      balance?: string;
    }>;
  }>;
}

interface CosmosValidatorResponse {
  validator?: {
    operator_address?: string;
    consensus_pubkey?: {
      type_url?: string;
      value?: string;
    };
    jailed?: boolean;
    status?: string;
    tokens?: string;
    delegator_shares?: string;
    min_self_delegation?: string;
    description?: {
      moniker?: string;
    };
    commission?: {
      commission_rates?: {
        rate?: string;
        max_rate?: string;
        max_change_rate?: string;
      };
    };
  };
}

interface CosmosValidatorsResponse {
  validators?: Array<NonNullable<CosmosValidatorResponse['validator']>>;
}

interface CosmosSigningInfosResponse {
  info?: CosmosSigningInfo[];
}

interface CosmosGovernanceProposalsResponse {
  proposals?: Array<{
    id?: string;
    proposal_id?: string;
    title?: string;
    summary?: string;
    status?: string;
    submit_time?: string;
    deposit_end_time?: string;
    voting_start_time?: string;
    voting_end_time?: string;
    total_deposit?: Array<{
      denom?: string;
      amount?: string;
    }>;
    final_tally_result?: CosmosGovernanceTally;
    messages?: Array<{
      '@type'?: string;
      content?: {
        title?: string;
        description?: string;
      };
    }>;
    content?: {
      title?: string;
      description?: string;
    };
  }>;
}

interface CosmosGovernanceTally {
  yes_count?: string;
  no_count?: string;
  abstain_count?: string;
  no_with_veto_count?: string;
}

interface CosmosGovernanceTallyResponse {
  tally?: CosmosGovernanceTally;
}

interface CosmosGovernanceParams {
  quorum?: string;
  threshold?: string;
  veto_threshold?: string;
}

interface CosmosGovernanceParamsResponse {
  params?: CosmosGovernanceParams;
}

interface CosmosGovernanceVoteOption {
  option?: string;
  weight?: string;
}

interface CosmosGovernanceVote {
  option?: string;
  options?: CosmosGovernanceVoteOption[];
  metadata?: string;
}

interface CosmosGovernanceVoteResponse {
  vote?: CosmosGovernanceVote;
}

interface CosmosIbcDenomTraceResponse {
  denom_trace?: {
    path?: string;
    base_denom?: string;
  };
}

interface CosmosSigningInfo {
  address?: string;
  start_height?: string;
  index_offset?: string;
  jailed_until?: string;
  tombstoned?: boolean;
  missed_blocks_counter?: string;
}

export function deriveCosmosAddress(seed: Uint8Array, accountIndex: number): string {
  const keyPair = deriveCosmosKeyPair(seed, accountIndex);
  keyPair.privateKey.fill(0);
  keyPair.publicKey.fill(0);
  return keyPair.address;
}

export function deriveCosmosKeyPair(seed: Uint8Array, accountIndex: number, addressPrefix = DEFAULT_COSMOS_BECH32_PREFIX): CosmosKeyPair {
  if (!Number.isInteger(accountIndex) || accountIndex < 0) {
    throw new Error('Cosmos account index must be a non-negative integer');
  }
  const child = HDKey.fromMasterSeed(seed).derive(`m/44'/118'/${accountIndex}'/0/0`);
  if (!child.privateKey) throw new Error('Failed to derive Cosmos private key');
  const privateKey = child.privateKey.slice();
  const publicKey = secp256k1.getPublicKey(privateKey, true);
  const address = encodeCosmosAddress(publicKey, addressPrefix);
  return { privateKey, publicKey, address };
}

export function isCosmosAddress(value: string, addressPrefix = DEFAULT_COSMOS_BECH32_PREFIX): boolean {
  try {
    const decoded = bech32Decode(value);
    return decoded.prefix === addressPrefix && decoded.data.length === 20;
  } catch {
    return false;
  }
}

export function convertCosmosAddressPrefix(address: string, addressPrefix: string): string {
  const decoded = bech32Decode(address);
  if (decoded.data.length !== 20) throw new Error('Invalid Cosmos address');
  return bech32Encode(addressPrefix, convertBits(decoded.data, 8, 5, true));
}

export function formatCosmosAmount(amount: bigint | string | number, decimals = DEFAULT_COSMOS_DECIMALS): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error('Cosmos decimals must be an integer between 0 and 18');
  }
  const raw = BigInt(amount);
  const sign = raw < 0n ? '-' : '';
  const absolute = raw < 0n ? -raw : raw;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${sign}${whole.toString()}${fraction ? `.${fraction}` : ''}`;
}

export function formatCosmosRawLog(rawLog?: string | null, fallback = 'Cosmos transaction failed'): string {
  const raw = rawLog?.trim();
  if (!raw) return fallback;

  let message = raw;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const logs = parsed
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return '';
          const record = entry as { log?: unknown; msg_index?: unknown };
          const log = typeof record.log === 'string' ? record.log.trim() : '';
          const index = typeof record.msg_index === 'number' || typeof record.msg_index === 'string'
            ? `message ${record.msg_index}`
            : '';
          return log && index ? `${index}: ${log}` : log || index;
        })
        .filter(Boolean);
      if (logs.length > 0) message = logs.join('; ');
    }
  } catch {
    // Most Cosmos SDK failures are plain strings, not JSON.
  }

  message = message
    .replace(/^failed to execute message;\s*/i, '')
    .replace(/^message index:\s*\d+:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!message) return fallback;
  if (/^cosmos transaction failed/i.test(message)) return message;
  return `${fallback}: ${message}`;
}

export function formatAtom(uatom: bigint | string | number): string {
  return formatCosmosAmount(uatom, DEFAULT_COSMOS_DECIMALS);
}

export function parseCosmosAmount(value: string, decimals = DEFAULT_COSMOS_DECIMALS, symbol = 'ATOM'): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error('Cosmos decimals must be an integer between 0 and 18');
  }
  const trimmed = value.trim();
  if (trimmed === '') throw new Error('Amount is required');
  if (trimmed.startsWith('-')) throw new Error('Amount must be non-negative');
  const [whole, fraction = ''] = trimmed.split('.');
  if (!/^\d+$/.test(whole || '0') || !/^\d*$/.test(fraction) || fraction.length > decimals) {
    throw new Error(`${symbol} amount must have at most ${decimals} decimal places`);
  }
  const amount = BigInt(whole || '0') * (10n ** BigInt(decimals)) + BigInt(fraction.padEnd(decimals, '0') || '0');
  if (amount <= 0n) throw new Error('Amount must be greater than zero');
  return amount;
}

export function parseAtom(value: string): bigint {
  return parseCosmosAmount(value, DEFAULT_COSMOS_DECIMALS, 'ATOM');
}

export function normalizeCosmosMemo(value?: string | null): string {
  const memo = value?.trim() ?? '';
  if (!memo) return '';
  if (new TextEncoder().encode(memo).length > MAX_COSMOS_MEMO_BYTES) {
    throw new Error(`Cosmos memo must be ${MAX_COSMOS_MEMO_BYTES} bytes or less`);
  }
  if (!memo.startsWith('{') && !memo.startsWith('[')) return memo;

  let parsed: unknown;
  try {
    parsed = JSON.parse(memo) as unknown;
  } catch {
    throw new Error('Cosmos memo JSON is invalid');
  }
  validateCosmosMemoRoute(parsed);
  return JSON.stringify(parsed);
}

export function buildCosmosIbcForwardMemo(input: { receiver: string; channel: string; port?: string; timeout?: string; retries?: string }): string {
  const forward: Record<string, string> = {
    receiver: input.receiver.trim(),
    port: input.port?.trim() || 'transfer',
    channel: input.channel.trim(),
  };
  if (input.timeout?.trim()) forward.timeout = input.timeout.trim();
  if (input.retries?.trim()) forward.retries = input.retries.trim();
  return normalizeCosmosMemo(JSON.stringify({ forward }));
}

export async function getCosmosIbcContext(apiUrl: string, chainId: number, denoms: string[] = []): Promise<CosmosIbcContext> {
  const baseUrl = apiUrl.replace(/\/+$/, '');
  const uniqueDenoms = [...new Set(denoms.map((denom) => denom.trim()).filter(Boolean))];
  const denomTraces = await Promise.all(uniqueDenoms.flatMap((denom): Array<Promise<CosmosIbcDenomTrace>> => {
    const match = /^ibc\/([0-9A-Fa-f]{64})$/.exec(denom);
    if (!match) return [];
    return [getCosmosIbcDenomTrace(baseUrl, denom, match[1]).catch(() => ({
      denom,
      hash: match[1].toUpperCase(),
      path: '',
      baseDenom: '',
      riskFlags: ['denom trace unavailable; verify origin chain before sending'],
    }))];
  }));
  return {
    routes: getCosmosIbcRoutePresets(chainId),
    denomTraces,
  };
}

function getCosmosIbcRoutePresets(chainId: number): CosmosIbcRoutePreset[] {
  if (chainId === 118) {
    return [createCosmosIbcRoutePreset({
      id: 'cosmoshub-osmosis-pfm',
      label: 'Cosmos Hub -> Osmosis forward memo',
      sourceChainId: 118,
      destinationChainId: 1_180,
      destinationName: 'Osmosis',
      channel: 'channel-141',
      receiverPrefix: 'osmo',
    })];
  }
  if (chainId === 1_180) {
    return [createCosmosIbcRoutePreset({
      id: 'osmosis-cosmoshub-pfm',
      label: 'Osmosis -> Cosmos Hub forward memo',
      sourceChainId: 1_180,
      destinationChainId: 118,
      destinationName: 'Cosmos Hub',
      channel: 'channel-0',
      receiverPrefix: 'cosmos',
    })];
  }
  return [];
}

function createCosmosIbcRoutePreset(input: {
  id: string;
  label: string;
  sourceChainId: number;
  destinationChainId: number;
  destinationName: string;
  channel: string;
  receiverPrefix: string;
}): CosmosIbcRoutePreset {
  return {
    ...input,
    port: 'transfer',
    memoTemplate: buildCosmosIbcForwardMemo({ receiver: `${input.receiverPrefix}1...`, channel: input.channel }),
    riskFlags: [
      'forward memo requires a packet-forward compatible receiver flow',
      `receiver should use ${input.receiverPrefix} prefix for ${input.destinationName}`,
      'verify channel and destination before broadcasting',
    ],
  };
}

async function getCosmosIbcDenomTrace(baseUrl: string, denom: string, hash: string): Promise<CosmosIbcDenomTrace> {
  const normalizedHash = hash.toUpperCase();
  const res = await fetch(`${baseUrl}/ibc/apps/transfer/v1/denom_traces/${encodeURIComponent(normalizedHash)}`);
  if (!res.ok) throw new Error(`cosmos ibc denom trace request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as CosmosIbcDenomTraceResponse;
  const trace = data.denom_trace;
  const path = trace?.path?.trim() ?? '';
  const baseDenom = trace?.base_denom?.trim() ?? '';
  return {
    denom,
    hash: normalizedHash,
    path,
    baseDenom,
    riskFlags: getCosmosIbcDenomTraceRiskFlags(path, baseDenom),
  };
}

function getCosmosIbcDenomTraceRiskFlags(path: string, baseDenom: string): string[] {
  const flags: string[] = [];
  if (!path || !baseDenom) flags.push('denom trace incomplete; verify origin chain before sending');
  if (path && !/^transfer\/channel-\d+(\/transfer\/channel-\d+)*$/.test(path)) flags.push('unexpected denom trace path');
  if (baseDenom && !/^(u[a-z0-9]{2,31}|[a-zA-Z][a-zA-Z0-9/:._-]{2,127})$/.test(baseDenom)) flags.push('unexpected base denom format');
  return flags;
}

function validateCosmosMemoRoute(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Cosmos memo JSON must be an object');
  }
  const record = value as { forward?: unknown };
  if (record.forward == null) return;
  validateIbcForward(record.forward, 1);
}

function validateIbcForward(value: unknown, depth: number): void {
  if (depth > MAX_IBC_FORWARD_DEPTH) throw new Error(`IBC route memo supports at most ${MAX_IBC_FORWARD_DEPTH} forwards`);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('IBC forward memo must be an object');
  }
  const forward = value as Record<string, unknown>;
  const receiver = requireMemoString(forward.receiver, 'IBC forward receiver');
  if (receiver.length < 3) throw new Error('IBC forward receiver is too short');
  const port = forward.port == null ? 'transfer' : requireMemoString(forward.port, 'IBC forward port');
  if (port !== 'transfer') throw new Error('IBC forward port must be transfer');
  const channel = requireMemoString(forward.channel, 'IBC forward channel');
  if (!/^channel-\d+$/.test(channel)) throw new Error('IBC forward channel must match channel-<number>');
  if (forward.timeout != null) validatePositiveIntegerLike(forward.timeout, 'IBC forward timeout');
  if (forward.retries != null) validatePositiveIntegerLike(forward.retries, 'IBC forward retries');
  if (forward.next != null) validateIbcForward(forward.next, depth + 1);
}

function requireMemoString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is required`);
  return value.trim();
}

function validatePositiveIntegerLike(value: unknown, label: string): void {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
    return;
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return;
  throw new Error(`${label} must be a positive integer`);
}

function formatCosmosPercent(value: string): string {
  try {
    const [whole, fraction = ''] = value.split('.');
    const scaled = BigInt(whole || '0') * 10_000n + BigInt(fraction.padEnd(18, '0').slice(0, 18)) / 100_000_000_000_000n;
    const percent = scaled / 100n;
    const decimal = (scaled % 100n).toString().padStart(2, '0').replace(/0+$/, '');
    return decimal ? `${percent}.${decimal}%` : `${percent}%`;
  } catch {
    return '0%';
  }
}

function getCosmosValidatorRiskFlags(input: {
  jailed: boolean;
  status: string;
  commissionRate: string;
  maxCommissionRate: string;
  maxCommissionChangeRate: string;
  minSelfDelegation: string;
  signingInfo?: CosmosSigningInfo;
}): string[] {
  const flags: string[] = [];
  if (input.jailed) flags.push('jailed');
  if (input.signingInfo?.tombstoned === true) flags.push('tombstoned');
  if (input.status !== 'BOND_STATUS_BONDED') flags.push('not bonded');
  try {
    const missedBlocks = BigInt(input.signingInfo?.missed_blocks_counter ?? '0');
    if (missedBlocks > 0n) flags.push('missed blocks');
  } catch {
    flags.push('unknown missed blocks');
  }
  try {
    const rate = Number(input.commissionRate);
    if (Number.isFinite(rate) && rate >= 0.2) flags.push('high commission');
  } catch {
    flags.push('unknown commission');
  }
  if (input.maxCommissionRate) {
    const maxRate = Number(input.maxCommissionRate);
    if (Number.isFinite(maxRate) && maxRate >= 0.5) flags.push('high max commission');
  }
  if (input.maxCommissionChangeRate) {
    const maxChangeRate = Number(input.maxCommissionChangeRate);
    if (Number.isFinite(maxChangeRate) && maxChangeRate >= 0.2) flags.push('high daily commission change');
  }
  if (input.minSelfDelegation) {
    try {
      const minSelfDelegation = BigInt(input.minSelfDelegation);
      if (minSelfDelegation <= 1n) flags.push('low self delegation');
    } catch {
      flags.push('unknown self delegation');
    }
  }
  return flags;
}

export async function getCosmosBalance(
  apiUrl: string,
  address: string,
  options: { addressPrefix?: string; denom?: string; decimals?: number } = {},
): Promise<{ balance: string; formatted: string }> {
  const addressPrefix = options.addressPrefix ?? DEFAULT_COSMOS_BECH32_PREFIX;
  const denom = options.denom ?? DEFAULT_COSMOS_DENOM;
  const decimals = options.decimals ?? DEFAULT_COSMOS_DECIMALS;
  if (!isCosmosAddress(address, addressPrefix)) throw new Error('Invalid Cosmos address');
  const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/cosmos/bank/v1beta1/balances/${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error(`cosmos rpc request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as CosmosBalanceResponse;
  const balance = BigInt(data.balances?.find((entry) => entry.denom === denom)?.amount ?? '0');
  return { balance: balance.toString(), formatted: formatCosmosAmount(balance, decimals) };
}

export async function getCosmosDenomBalances(
  apiUrl: string,
  address: string,
  options: { addressPrefix?: string; nativeDenom?: string; nativeSymbol?: string; nativeDecimals?: number } = {},
): Promise<CosmosDenomBalance[]> {
  const addressPrefix = options.addressPrefix ?? DEFAULT_COSMOS_BECH32_PREFIX;
  const nativeDenom = options.nativeDenom ?? DEFAULT_COSMOS_DENOM;
  const nativeSymbol = options.nativeSymbol ?? 'ATOM';
  const nativeDecimals = options.nativeDecimals ?? DEFAULT_COSMOS_DECIMALS;
  if (!isCosmosAddress(address, addressPrefix)) throw new Error('Invalid Cosmos address');
  const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/cosmos/bank/v1beta1/balances/${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error(`cosmos rpc request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as CosmosBalanceResponse;
  return (data.balances ?? [])
    .flatMap((entry): CosmosDenomBalance[] => {
      if (!entry.denom || !/^(ibc\/[0-9A-Fa-f]{64}|[a-zA-Z][a-zA-Z0-9/:._-]{2,127})$/.test(entry.denom)) return [];
      const amount = BigInt(entry.amount ?? '0');
      if (amount <= 0n) return [];
      const isNative = entry.denom === nativeDenom;
      const decimals = isNative ? nativeDecimals : 0;
      return [{
        denom: entry.denom,
        amount: amount.toString(),
        formatted: formatCosmosAmount(amount, decimals),
        symbol: isNative ? nativeSymbol : entry.denom,
        decimals,
        isNative,
      }];
    })
    .sort((left, right) => {
      if (left.isNative !== right.isNative) return left.isNative ? -1 : 1;
      return left.denom.localeCompare(right.denom);
    });
}

export async function getCosmosStakingPositions(
  apiUrl: string,
  address: string,
  options: { addressPrefix?: string; nativeDenom?: string; nativeSymbol?: string; nativeDecimals?: number } = {},
): Promise<CosmosStakingPosition[]> {
  const addressPrefix = options.addressPrefix ?? DEFAULT_COSMOS_BECH32_PREFIX;
  const nativeDenom = options.nativeDenom ?? DEFAULT_COSMOS_DENOM;
  const nativeSymbol = options.nativeSymbol ?? 'ATOM';
  const nativeDecimals = options.nativeDecimals ?? DEFAULT_COSMOS_DECIMALS;
  if (!isCosmosAddress(address, addressPrefix)) throw new Error('Invalid Cosmos address');
  const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/cosmos/staking/v1beta1/delegations/${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error(`cosmos staking request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as CosmosDelegationsResponse;
  const delegations = data.delegation_responses ?? [];
  const validators = await Promise.all(delegations.map(async (entry) => {
    const validatorAddress = entry.delegation?.validator_address?.trim() ?? '';
    const denom = entry.balance?.denom?.trim() ?? nativeDenom;
    const amount = BigInt(entry.balance?.amount ?? '0');
    if (!validatorAddress || amount <= 0n) return null;
    const decimals = denom === nativeDenom ? nativeDecimals : 0;
    const symbol = denom === nativeDenom ? nativeSymbol : denom;
    return {
      validatorAddress,
      validatorMoniker: await getCosmosValidatorMoniker(apiUrl, validatorAddress),
      amount: amount.toString(),
      formatted: formatCosmosAmount(amount, decimals),
      denom,
      symbol,
      decimals,
    } satisfies CosmosStakingPosition;
  }));
  return validators
    .filter((position): position is CosmosStakingPosition => position !== null)
    .sort((left, right) => BigInt(right.amount) > BigInt(left.amount) ? 1 : BigInt(right.amount) < BigInt(left.amount) ? -1 : left.validatorAddress.localeCompare(right.validatorAddress));
}

export async function getCosmosRedelegations(
  apiUrl: string,
  address: string,
  options: { addressPrefix?: string; nativeDenom?: string; nativeSymbol?: string; nativeDecimals?: number } = {},
): Promise<CosmosRedelegationEntry[]> {
  const addressPrefix = options.addressPrefix ?? DEFAULT_COSMOS_BECH32_PREFIX;
  const nativeDenom = options.nativeDenom ?? DEFAULT_COSMOS_DENOM;
  const nativeSymbol = options.nativeSymbol ?? 'ATOM';
  const nativeDecimals = options.nativeDecimals ?? DEFAULT_COSMOS_DECIMALS;
  if (!isCosmosAddress(address, addressPrefix)) throw new Error('Invalid Cosmos address');
  const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/cosmos/staking/v1beta1/delegators/${encodeURIComponent(address)}/redelegations`);
  if (!res.ok) throw new Error(`cosmos redelegations request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as CosmosRedelegationsResponse;
  return (data.redelegation_responses ?? [])
    .flatMap((entry): CosmosRedelegationEntry[] => {
      const sourceValidatorAddress = entry.redelegation?.validator_src_address?.trim() ?? '';
      const destinationValidatorAddress = entry.redelegation?.validator_dst_address?.trim() ?? '';
      if (!sourceValidatorAddress || !destinationValidatorAddress) return [];
      const nestedEntries = entry.entries?.length
        ? entry.entries.map((item) => ({
            creationHeight: item.redelegation_entry?.creation_height ?? '0',
            completionTime: item.redelegation_entry?.completion_time ?? '',
            balance: item.balance ?? item.redelegation_entry?.initial_balance ?? '0',
          }))
        : (entry.redelegation?.entries ?? []).map((item) => ({
            creationHeight: item.creation_height ?? '0',
            completionTime: item.completion_time ?? '',
            balance: item.initial_balance ?? '0',
          }));
      return nestedEntries.flatMap((item): CosmosRedelegationEntry[] => {
        const balance = BigInt(item.balance || '0');
        if (balance <= 0n) return [];
        return [{
          sourceValidatorAddress,
          destinationValidatorAddress,
          creationHeight: item.creationHeight,
          completionTime: item.completionTime,
          balance: balance.toString(),
          formatted: formatCosmosAmount(balance, nativeDecimals),
          denom: nativeDenom,
          symbol: nativeSymbol,
          decimals: nativeDecimals,
        }];
      });
    })
    .sort((left, right) => left.completionTime.localeCompare(right.completionTime) || left.sourceValidatorAddress.localeCompare(right.sourceValidatorAddress));
}

export async function getCosmosValidators(apiUrl: string, limit = 20, addressPrefix = DEFAULT_COSMOS_BECH32_PREFIX): Promise<CosmosValidatorSummary[]> {
  const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 100 ? limit : 20;
  const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/cosmos/staking/v1beta1/validators?pagination.limit=${safeLimit}`);
  if (!res.ok) throw new Error(`cosmos validators request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as CosmosValidatorsResponse;
  const signingInfos = await getCosmosSigningInfoMap(apiUrl).catch(() => new Map<string, CosmosSigningInfo>());
  return (data.validators ?? [])
    .flatMap((validator): CosmosValidatorSummary[] => {
      const validatorAddress = validator.operator_address?.trim() ?? '';
      if (!validatorAddress) return [];
      const consensusAddress = getCosmosConsensusAddress(validator.consensus_pubkey, `${addressPrefix}valcons`);
      const signingInfo = consensusAddress ? signingInfos.get(consensusAddress) : undefined;
      const commissionRates = validator.commission?.commission_rates;
      const commissionRate = commissionRates?.rate ?? '0';
      const maxCommissionRate = commissionRates?.max_rate ?? '';
      const maxCommissionChangeRate = commissionRates?.max_change_rate ?? '';
      const commissionPercent = formatCosmosPercent(commissionRate);
      const maxCommissionPercent = formatCosmosPercent(maxCommissionRate);
      const maxCommissionChangePercent = formatCosmosPercent(maxCommissionChangeRate);
      const status = validator.status ?? 'UNKNOWN';
      const jailed = validator.jailed === true;
      const minSelfDelegation = validator.min_self_delegation ?? '';
      return [{
        validatorAddress,
        moniker: validator.description?.moniker?.trim() || validatorAddress,
        status,
        jailed,
        commissionRate,
        commissionPercent,
        maxCommissionRate,
        maxCommissionPercent,
        maxCommissionChangeRate,
        maxCommissionChangePercent,
        votingPower: validator.tokens ?? '0',
        delegatorShares: validator.delegator_shares ?? '',
        minSelfDelegation,
        consensusAddress,
        missedBlocksCounter: signingInfo?.missed_blocks_counter ?? '0',
        jailedUntil: signingInfo?.jailed_until ?? '',
        tombstoned: signingInfo?.tombstoned === true,
        riskFlags: getCosmosValidatorRiskFlags({
          jailed,
          status,
          commissionRate,
          maxCommissionRate,
          maxCommissionChangeRate,
          minSelfDelegation,
          signingInfo,
        }),
      }];
    })
    .sort((left, right) => BigInt(right.votingPower || '0') > BigInt(left.votingPower || '0') ? 1 : BigInt(right.votingPower || '0') < BigInt(left.votingPower || '0') ? -1 : left.moniker.localeCompare(right.moniker));
}

export async function getCosmosGovernanceProposals(apiUrl: string, limit = 5, voterAddress = ''): Promise<CosmosGovernanceProposal[]> {
  const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 20 ? limit : 5;
  const baseUrl = apiUrl.replace(/\/+$/, '');
  const [res, params] = await Promise.all([
    fetch(`${baseUrl}/cosmos/gov/v1/proposals?pagination.limit=${safeLimit}&pagination.reverse=true`),
    getCosmosGovernanceParams(baseUrl).catch((): CosmosGovernanceParams => ({})),
  ]);
  if (!res.ok) throw new Error(`cosmos governance proposals request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as CosmosGovernanceProposalsResponse;
  const proposals = (data.proposals ?? [])
    .flatMap((proposal): Array<CosmosGovernanceProposal & { fallbackTally?: CosmosGovernanceTally }> => {
      const id = proposal.id ?? proposal.proposal_id ?? '';
      if (!id) return [];
      const content = proposal.content ?? proposal.messages?.find((message) => message.content)?.content;
      const title = proposal.title?.trim() || content?.title?.trim() || `Proposal ${id}`;
      const summary = proposal.summary?.trim() || content?.description?.trim() || '';
      return [{
        id,
        title,
        summary,
        status: proposal.status ?? 'PROPOSAL_STATUS_UNSPECIFIED',
        submitTime: proposal.submit_time ?? '',
        depositEndTime: proposal.deposit_end_time ?? '',
        votingStartTime: proposal.voting_start_time ?? '',
        votingEndTime: proposal.voting_end_time ?? '',
        totalDeposit: summarizeCosmosCoins(proposal.total_deposit ?? []),
        quorum: normalizeCosmosGovernanceParam(params.quorum),
        threshold: normalizeCosmosGovernanceParam(params.threshold),
        vetoThreshold: normalizeCosmosGovernanceParam(params.veto_threshold),
        riskFlags: [],
        riskSummary: '',
        ...normalizeCosmosProposalTally(proposal.final_tally_result),
        ...normalizeCosmosProposalVote(),
        fallbackTally: proposal.final_tally_result,
      }];
    })
    .sort((left, right) => BigInt(right.id || '0') > BigInt(left.id || '0') ? 1 : BigInt(right.id || '0') < BigInt(left.id || '0') ? -1 : 0)
    .slice(0, safeLimit);
  return Promise.all(proposals.map(async ({ fallbackTally, ...proposal }) => {
    const tally = await getCosmosProposalTally(baseUrl, proposal.id).catch(() => fallbackTally);
    const normalizedTally = normalizeCosmosProposalTally(tally);
    const risks = summarizeCosmosGovernanceRisk({ ...proposal, ...normalizedTally });
    return {
      ...proposal,
      ...normalizedTally,
      ...normalizeCosmosProposalVote(voterAddress ? await getCosmosProposalVote(baseUrl, proposal.id, voterAddress).catch(() => undefined) : undefined),
      riskFlags: risks.riskFlags,
      riskSummary: risks.riskSummary,
    };
  }));
}

async function getCosmosGovernanceParams(baseUrl: string): Promise<CosmosGovernanceParams> {
  const res = await fetch(`${baseUrl}/cosmos/gov/v1/params/tallying`);
  if (!res.ok) throw new Error(`cosmos governance params request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as CosmosGovernanceParamsResponse;
  return data.params ?? {};
}

async function getCosmosProposalTally(baseUrl: string, proposalId: string): Promise<CosmosGovernanceTally> {
  const res = await fetch(`${baseUrl}/cosmos/gov/v1/proposals/${encodeURIComponent(proposalId)}/tally`);
  if (!res.ok) throw new Error(`cosmos governance proposal tally request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as CosmosGovernanceTallyResponse;
  return data.tally ?? {};
}

function normalizeCosmosGovernanceParam(value?: string): string {
  if (!value || !/^\d+(\.\d+)?$/.test(value)) return '';
  return value;
}

function normalizeCosmosProposalTally(tally?: CosmosGovernanceTally): Pick<CosmosGovernanceProposal, 'yesVotes' | 'noVotes' | 'abstainVotes' | 'noWithVetoVotes'> {
  return {
    yesVotes: tally?.yes_count ?? '0',
    noVotes: tally?.no_count ?? '0',
    abstainVotes: tally?.abstain_count ?? '0',
    noWithVetoVotes: tally?.no_with_veto_count ?? '0',
  };
}

function summarizeCosmosGovernanceRisk(proposal: Pick<CosmosGovernanceProposal, 'status' | 'quorum' | 'threshold' | 'vetoThreshold' | 'yesVotes' | 'noVotes' | 'abstainVotes' | 'noWithVetoVotes' | 'votingEndTime'>): Pick<CosmosGovernanceProposal, 'riskFlags' | 'riskSummary'> {
  const riskFlags: string[] = [];
  const totalVotes = parseBigIntOrZero(proposal.yesVotes) + parseBigIntOrZero(proposal.noVotes) + parseBigIntOrZero(proposal.abstainVotes) + parseBigIntOrZero(proposal.noWithVetoVotes);
  const yesVotes = parseBigIntOrZero(proposal.yesVotes);
  const noWithVetoVotes = parseBigIntOrZero(proposal.noWithVetoVotes);
  if (proposal.status === 'PROPOSAL_STATUS_VOTING_PERIOD') {
    if (proposal.quorum) riskFlags.push(`Quorum requires ${formatCosmosPercent(proposal.quorum)} bonded participation`);
    if (proposal.threshold && totalVotes > 0n && ratioBelow(yesVotes, totalVotes - parseBigIntOrZero(proposal.abstainVotes), proposal.threshold)) {
      riskFlags.push(`Yes ratio is below ${formatCosmosPercent(proposal.threshold)} threshold`);
    }
    if (proposal.vetoThreshold && totalVotes > 0n && ratioAtLeast(noWithVetoVotes, totalVotes, proposal.vetoThreshold, 4n, 5n)) {
      riskFlags.push(`No-with-veto is near ${formatCosmosPercent(proposal.vetoThreshold)} veto threshold`);
    }
    if (proposal.votingEndTime) riskFlags.push(`Voting closes ${proposal.votingEndTime}`);
  }
  if (proposal.status === 'PROPOSAL_STATUS_DEPOSIT_PERIOD') {
    riskFlags.push('Deposit period: proposal is not voteable until minimum deposit is met');
  }
  return {
    riskFlags,
    riskSummary: riskFlags.length > 0 ? riskFlags.join('; ') : 'No immediate governance risk flags',
  };
}

function parseBigIntOrZero(value: string): bigint {
  try {
    return /^\d+$/.test(value) ? BigInt(value) : 0n;
  } catch {
    return 0n;
  }
}

function ratioBelow(numerator: bigint, denominator: bigint, threshold: string): boolean {
  if (denominator <= 0n) return false;
  return numerator * 1_000_000n < parseDecimalRatio(threshold) * denominator;
}

function ratioAtLeast(numerator: bigint, denominator: bigint, threshold: string, multiplierNumerator = 1n, multiplierDenominator = 1n): boolean {
  if (denominator <= 0n || multiplierDenominator <= 0n) return false;
  return numerator * 1_000_000n * multiplierDenominator >= parseDecimalRatio(threshold) * denominator * multiplierNumerator;
}

function parseDecimalRatio(value: string): bigint {
  if (!/^\d+(\.\d+)?$/.test(value)) return 0n;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole || '0') * 1_000_000n + BigInt(fraction.padEnd(6, '0').slice(0, 6));
}

async function getCosmosProposalVote(baseUrl: string, proposalId: string, voterAddress: string): Promise<CosmosGovernanceVote | undefined> {
  const res = await fetch(`${baseUrl}/cosmos/gov/v1/proposals/${encodeURIComponent(proposalId)}/votes/${encodeURIComponent(voterAddress)}`);
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`cosmos governance proposal vote request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as CosmosGovernanceVoteResponse;
  return data.vote;
}

function normalizeCosmosProposalVote(vote?: CosmosGovernanceVote): Pick<CosmosGovernanceProposal, 'voterVoteOption' | 'voterVoteWeight' | 'voterVoteMetadata'> {
  const options = vote?.options?.length
    ? vote.options
    : vote?.option
      ? [{ option: vote.option, weight: '1.000000000000000000' }]
      : [];
  return {
    voterVoteOption: options.map((option) => option.option ?? 'VOTE_OPTION_UNSPECIFIED').join(', ') || 'not voted',
    voterVoteWeight: options.map((option) => option.weight ?? '').filter(Boolean).join(', '),
    voterVoteMetadata: vote?.metadata ?? '',
  };
}

function summarizeCosmosCoins(coins: Array<{ denom?: string; amount?: string }>): string {
  if (coins.length === 0) return 'none';
  return coins
    .map((coin) => `${coin.amount ?? '?'}${coin.denom ?? '?'}`)
    .join(', ');
}

export async function sendCosmosTransfer(input: {
  apiUrl: string;
  chainId: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  from: string;
  to: string;
  amountUatom: bigint;
  denom?: string;
  addressPrefix?: string;
  feeUatom?: bigint;
  gasLimit?: bigint;
  memo?: string;
}): Promise<CosmosTransferResult> {
  const addressPrefix = input.addressPrefix ?? DEFAULT_COSMOS_BECH32_PREFIX;
  const denom = input.denom ?? DEFAULT_COSMOS_DENOM;
  if (!isCosmosAddress(input.from, addressPrefix)) throw new Error('Invalid Cosmos sender address');
  if (!isCosmosAddress(input.to, addressPrefix)) throw new Error('Invalid Cosmos recipient address');
  if (input.amountUatom <= 0n) throw new Error('Amount must be greater than zero');

  const account = await getCosmosAccount(input.apiUrl, input.from);
  const body = {
    from: input.from,
    to: input.to,
    amountUatom: input.amountUatom,
    denom,
    memo: normalizeCosmosMemo(input.memo),
  };

  const simulated = input.feeUatom == null || input.gasLimit == null
    ? await simulateCosmosTransfer({
        apiUrl: input.apiUrl,
        body,
        chainId: input.chainId,
        privateKey: input.privateKey,
        publicKey: input.publicKey,
        accountNumber: account.accountNumber,
        sequence: account.sequence,
      }).catch(() => null)
    : null;
  const gasLimit = input.gasLimit ?? simulated?.gasLimit ?? DEFAULT_COSMOS_GAS_LIMIT;
  const feeUatom = input.feeUatom ?? simulated?.feeUatom ?? estimateCosmosFee(gasLimit);
  if (feeUatom < 0n) throw new Error('Cosmos fee must be non-negative');
  if (gasLimit <= 0n) throw new Error('Cosmos gas limit must be greater than zero');

  const txBytes = buildSignedCosmosTx({
    bodyBytes: encodeTransferTxBody(body),
    chainId: input.chainId,
    publicKey: input.publicKey,
    privateKey: input.privateKey,
    accountNumber: account.accountNumber,
    sequence: account.sequence,
    feeUatom,
    gasLimit,
  });
  const txHash = await broadcastCosmosTx(input.apiUrl, txBytes);
  return {
    txHash,
    amountUatom: input.amountUatom.toString(),
    feeUatom: feeUatom.toString(),
    gasLimit: gasLimit.toString(),
    sequence: account.sequence.toString(),
    accountNumber: account.accountNumber.toString(),
  };
}

export async function sendCosmosStakingTransaction(input: {
  apiUrl: string;
  chainId: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  delegatorAddress: string;
  validatorAddress: string;
  amountUatom: bigint;
  action: CosmosStakingAction;
  denom?: string;
  addressPrefix?: string;
  feeUatom?: bigint;
  gasLimit?: bigint;
  memo?: string;
}): Promise<CosmosTransferResult> {
  const addressPrefix = input.addressPrefix ?? DEFAULT_COSMOS_BECH32_PREFIX;
  const denom = input.denom ?? DEFAULT_COSMOS_DENOM;
  if (!isCosmosAddress(input.delegatorAddress, addressPrefix)) throw new Error('Invalid Cosmos delegator address');
  if (!isCosmosAddress(input.validatorAddress, `${addressPrefix}valoper`)) throw new Error('Invalid Cosmos validator address');
  if (input.amountUatom <= 0n) throw new Error('Amount must be greater than zero');

  const account = await getCosmosAccount(input.apiUrl, input.delegatorAddress);
  const body = {
    delegatorAddress: input.delegatorAddress,
    validatorAddress: input.validatorAddress,
    amountUatom: input.amountUatom,
    denom,
    memo: normalizeCosmosMemo(input.memo),
    action: input.action,
  };
  const simulated = input.feeUatom == null || input.gasLimit == null
    ? await simulateCosmosStaking({
        apiUrl: input.apiUrl,
        body,
        chainId: input.chainId,
        privateKey: input.privateKey,
        publicKey: input.publicKey,
        accountNumber: account.accountNumber,
        sequence: account.sequence,
      }).catch(() => null)
    : null;
  const gasLimit = input.gasLimit ?? simulated?.gasLimit ?? DEFAULT_COSMOS_GAS_LIMIT;
  const feeUatom = input.feeUatom ?? simulated?.feeUatom ?? estimateCosmosFee(gasLimit);
  if (feeUatom < 0n) throw new Error('Cosmos fee must be non-negative');
  if (gasLimit <= 0n) throw new Error('Cosmos gas limit must be greater than zero');

  const txBytes = buildSignedCosmosTx({
    bodyBytes: encodeStakingTxBody(body),
    chainId: input.chainId,
    publicKey: input.publicKey,
    privateKey: input.privateKey,
    accountNumber: account.accountNumber,
    sequence: account.sequence,
    feeUatom,
    gasLimit,
  });
  const txHash = await broadcastCosmosTx(input.apiUrl, txBytes);
  return {
    txHash,
    amountUatom: input.amountUatom.toString(),
    feeUatom: feeUatom.toString(),
    gasLimit: gasLimit.toString(),
    sequence: account.sequence.toString(),
    accountNumber: account.accountNumber.toString(),
  };
}

export async function sendCosmosWithdrawRewardsTransaction(input: {
  apiUrl: string;
  chainId: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  delegatorAddress: string;
  validatorAddress: string;
  addressPrefix?: string;
  feeUatom?: bigint;
  gasLimit?: bigint;
  memo?: string;
}): Promise<CosmosTransferResult> {
  const addressPrefix = input.addressPrefix ?? DEFAULT_COSMOS_BECH32_PREFIX;
  if (!isCosmosAddress(input.delegatorAddress, addressPrefix)) throw new Error('Invalid Cosmos delegator address');
  if (!isCosmosAddress(input.validatorAddress, `${addressPrefix}valoper`)) throw new Error('Invalid Cosmos validator address');

  const account = await getCosmosAccount(input.apiUrl, input.delegatorAddress);
  const body = {
    delegatorAddress: input.delegatorAddress,
    validatorAddress: input.validatorAddress,
    memo: normalizeCosmosMemo(input.memo),
  };
  const simulated = input.feeUatom == null || input.gasLimit == null
    ? await simulateCosmosWithdrawRewards({
        apiUrl: input.apiUrl,
        body,
        chainId: input.chainId,
        privateKey: input.privateKey,
        publicKey: input.publicKey,
        accountNumber: account.accountNumber,
        sequence: account.sequence,
      }).catch(() => null)
    : null;
  const gasLimit = input.gasLimit ?? simulated?.gasLimit ?? DEFAULT_COSMOS_GAS_LIMIT;
  const feeUatom = input.feeUatom ?? simulated?.feeUatom ?? estimateCosmosFee(gasLimit);
  if (feeUatom < 0n) throw new Error('Cosmos fee must be non-negative');
  if (gasLimit <= 0n) throw new Error('Cosmos gas limit must be greater than zero');

  const txBytes = buildSignedCosmosTx({
    bodyBytes: encodeWithdrawRewardsTxBody(body),
    chainId: input.chainId,
    publicKey: input.publicKey,
    privateKey: input.privateKey,
    accountNumber: account.accountNumber,
    sequence: account.sequence,
    feeUatom,
    gasLimit,
  });
  const txHash = await broadcastCosmosTx(input.apiUrl, txBytes);
  return {
    txHash,
    amountUatom: '0',
    feeUatom: feeUatom.toString(),
    gasLimit: gasLimit.toString(),
    sequence: account.sequence.toString(),
    accountNumber: account.accountNumber.toString(),
  };
}

export async function sendCosmosRedelegateTransaction(input: {
  apiUrl: string;
  chainId: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  delegatorAddress: string;
  sourceValidatorAddress: string;
  destinationValidatorAddress: string;
  amountUatom: bigint;
  addressPrefix?: string;
  denom?: string;
  feeUatom?: bigint;
  gasLimit?: bigint;
  memo?: string;
}): Promise<CosmosTransferResult> {
  const addressPrefix = input.addressPrefix ?? DEFAULT_COSMOS_BECH32_PREFIX;
  const denom = input.denom ?? DEFAULT_COSMOS_DENOM;
  if (!isCosmosAddress(input.delegatorAddress, addressPrefix)) throw new Error('Invalid Cosmos delegator address');
  if (!isCosmosAddress(input.sourceValidatorAddress, `${addressPrefix}valoper`)) throw new Error('Invalid Cosmos source validator address');
  if (!isCosmosAddress(input.destinationValidatorAddress, `${addressPrefix}valoper`)) throw new Error('Invalid Cosmos destination validator address');
  if (input.sourceValidatorAddress === input.destinationValidatorAddress) throw new Error('Destination validator must be different');
  if (input.amountUatom <= 0n) throw new Error('Amount must be greater than zero');

  const account = await getCosmosAccount(input.apiUrl, input.delegatorAddress);
  const body = {
    delegatorAddress: input.delegatorAddress,
    sourceValidatorAddress: input.sourceValidatorAddress,
    destinationValidatorAddress: input.destinationValidatorAddress,
    amountUatom: input.amountUatom,
    denom,
    memo: normalizeCosmosMemo(input.memo),
  };
  const simulated = input.feeUatom == null || input.gasLimit == null
    ? await simulateCosmosRedelegate({
        apiUrl: input.apiUrl,
        body,
        chainId: input.chainId,
        privateKey: input.privateKey,
        publicKey: input.publicKey,
        accountNumber: account.accountNumber,
        sequence: account.sequence,
      }).catch(() => null)
    : null;
  const gasLimit = input.gasLimit ?? simulated?.gasLimit ?? DEFAULT_COSMOS_GAS_LIMIT;
  const feeUatom = input.feeUatom ?? simulated?.feeUatom ?? estimateCosmosFee(gasLimit);
  if (feeUatom < 0n) throw new Error('Cosmos fee must be non-negative');
  if (gasLimit <= 0n) throw new Error('Cosmos gas limit must be greater than zero');

  const txBytes = buildSignedCosmosTx({
    bodyBytes: encodeRedelegateTxBody(body),
    chainId: input.chainId,
    publicKey: input.publicKey,
    privateKey: input.privateKey,
    accountNumber: account.accountNumber,
    sequence: account.sequence,
    feeUatom,
    gasLimit,
  });
  const txHash = await broadcastCosmosTx(input.apiUrl, txBytes);
  return {
    txHash,
    amountUatom: input.amountUatom.toString(),
    feeUatom: feeUatom.toString(),
    gasLimit: gasLimit.toString(),
    sequence: account.sequence.toString(),
    accountNumber: account.accountNumber.toString(),
  };
}

export async function sendCosmosGovernanceVoteTransaction(input: {
  apiUrl: string;
  chainId: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  voterAddress: string;
  proposalId: string;
  option: CosmosGovernanceVoteChoice;
  addressPrefix?: string;
  feeUatom?: bigint;
  gasLimit?: bigint;
  memo?: string;
}): Promise<CosmosTransferResult> {
  const addressPrefix = input.addressPrefix ?? DEFAULT_COSMOS_BECH32_PREFIX;
  if (!isCosmosAddress(input.voterAddress, addressPrefix)) throw new Error('Invalid Cosmos voter address');
  if (!/^[1-9][0-9]*$/.test(input.proposalId)) throw new Error('Cosmos proposal ID must be a positive integer');
  const option = encodeCosmosVoteOption(input.option);
  const account = await getCosmosAccount(input.apiUrl, input.voterAddress);
  const body = {
    voterAddress: input.voterAddress,
    proposalId: BigInt(input.proposalId),
    option,
    memo: normalizeCosmosMemo(input.memo),
  };
  const simulated = input.feeUatom == null || input.gasLimit == null
    ? await simulateCosmosGovernanceVote({
        apiUrl: input.apiUrl,
        body,
        chainId: input.chainId,
        privateKey: input.privateKey,
        publicKey: input.publicKey,
        accountNumber: account.accountNumber,
        sequence: account.sequence,
      }).catch(() => null)
    : null;
  const gasLimit = input.gasLimit ?? simulated?.gasLimit ?? DEFAULT_COSMOS_GAS_LIMIT;
  const feeUatom = input.feeUatom ?? simulated?.feeUatom ?? estimateCosmosFee(gasLimit);
  if (feeUatom < 0n) throw new Error('Cosmos fee must be non-negative');
  if (gasLimit <= 0n) throw new Error('Cosmos gas limit must be greater than zero');

  const txBytes = buildSignedCosmosTx({
    bodyBytes: encodeGovernanceVoteTxBody(body),
    chainId: input.chainId,
    publicKey: input.publicKey,
    privateKey: input.privateKey,
    accountNumber: account.accountNumber,
    sequence: account.sequence,
    feeUatom,
    gasLimit,
  });
  const txHash = await broadcastCosmosTx(input.apiUrl, txBytes);
  return {
    txHash,
    amountUatom: input.proposalId,
    feeUatom: feeUatom.toString(),
    gasLimit: gasLimit.toString(),
    sequence: account.sequence.toString(),
    accountNumber: account.accountNumber.toString(),
  };
}

export function signCosmosDirectDoc(input: {
  bodyBytes: Uint8Array;
  authInfoBytes: Uint8Array;
  chainId: string;
  accountNumber: bigint;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}): CosmosDirectSignature {
  const signDoc = encodeSignDoc({
    bodyBytes: input.bodyBytes,
    authInfoBytes: input.authInfoBytes,
    chainId: input.chainId,
    accountNumber: input.accountNumber,
  });
  const signature = secp256k1.sign(sha256(signDoc), input.privateKey);
  return {
    pubKeyTypeUrl: '/cosmos.crypto.secp256k1.PubKey',
    pubKeyBase64: bytesToBase64(input.publicKey),
    signatureBase64: bytesToBase64(signature),
  };
}

export function signCosmosAminoDoc(input: {
  signDoc: Record<string, CosmosAminoJson>;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}): CosmosDirectSignature {
  const signBytes = new TextEncoder().encode(stableJsonStringify(input.signDoc));
  const signature = secp256k1.sign(sha256(signBytes), input.privateKey);
  return {
    pubKeyTypeUrl: '/cosmos.crypto.secp256k1.PubKey',
    pubKeyBase64: bytesToBase64(input.publicKey),
    signatureBase64: bytesToBase64(signature),
  };
}

function stableJsonStringify(value: CosmosAminoJson): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableJsonStringify(entry)).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`)
    .join(',')}}`;
}

export async function getCosmosTransactionStatus(apiUrl: string, txHash: string): Promise<CosmosTransactionStatus> {
  const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/cosmos/tx/v1beta1/txs/${encodeURIComponent(txHash)}`);
  if (res.status === 404) return { status: 'pending' };
  if (!res.ok) throw new Error(`cosmos tx status request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as CosmosTxResponse;
  const response = data.tx_response;
  if (!response) return { status: 'pending' };
  if (typeof response.code === 'number' && response.code !== 0) {
    return { status: 'failed', blockNumber: response.height ?? null, error: formatCosmosRawLog(response.raw_log) };
  }
  const height = BigInt(response.height ?? '0');
  if (height > 0n) return { status: 'confirmed', blockNumber: height.toString() };
  return { status: 'pending' };
}

async function getCosmosValidatorMoniker(apiUrl: string, validatorAddress: string): Promise<string> {
  const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/cosmos/staking/v1beta1/validators/${encodeURIComponent(validatorAddress)}`);
  if (!res.ok) return validatorAddress;
  const data = await res.json() as CosmosValidatorResponse;
  return data.validator?.description?.moniker?.trim() || validatorAddress;
}

async function getCosmosSigningInfoMap(apiUrl: string): Promise<Map<string, CosmosSigningInfo>> {
  const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/cosmos/slashing/v1beta1/signing_infos?pagination.limit=1000`);
  if (!res.ok) throw new Error(`cosmos signing info request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as CosmosSigningInfosResponse;
  return new Map((data.info ?? [])
    .flatMap((info): Array<[string, CosmosSigningInfo]> => {
      const address = info.address?.trim();
      return address ? [[address, info]] : [];
    }));
}

function getCosmosConsensusAddress(pubkey: { type_url?: string; value?: string } | undefined, addressPrefix: string): string {
  const value = pubkey?.value;
  if (!value) return '';
  const decoded = bytesFromBase64(value);
  const keyBytes = readFirstProtoBytesField(decoded) ?? decoded;
  if (keyBytes.length === 0) return '';
  return bech32Encode(addressPrefix, convertBits(ripemd160(sha256(keyBytes)), 8, 5, true));
}

function readFirstProtoBytesField(bytes: Uint8Array): Uint8Array | null {
  let offset = 0;
  while (offset < bytes.length) {
    const tag = readVarint(bytes, offset);
    offset = tag.offset;
    const wireType = Number(tag.value & 7n);
    if (wireType === 2) {
      const length = readVarint(bytes, offset);
      offset = length.offset;
      const end = offset + Number(length.value);
      if (end > bytes.length) return null;
      const value = bytes.slice(offset, end);
      return value.length > 0 ? value : null;
    }
    if (wireType === 0) {
      offset = readVarint(bytes, offset).offset;
    } else {
      return null;
    }
  }
  return null;
}

function readVarint(bytes: Uint8Array, offset: number): { value: bigint; offset: number } {
  let shift = 0n;
  let value = 0n;
  let cursor = offset;
  while (cursor < bytes.length) {
    const byte = bytes[cursor];
    cursor += 1;
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, offset: cursor };
    shift += 7n;
  }
  throw new Error('Invalid varint');
}

function encodeCosmosAddress(publicKey: Uint8Array, addressPrefix: string): string {
  return bech32Encode(addressPrefix, convertBits(ripemd160(sha256(publicKey)), 8, 5, true));
}

async function getCosmosAccount(apiUrl: string, address: string): Promise<{ accountNumber: bigint; sequence: bigint }> {
  const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/cosmos/auth/v1beta1/accounts/${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error(`cosmos account request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as CosmosAccountResponse;
  const account = data.account?.base_account ?? data.account;
  const accountNumber = BigInt(account?.account_number ?? '0');
  const sequence = BigInt(account?.sequence ?? '0');
  return { accountNumber, sequence };
}

async function broadcastCosmosTx(apiUrl: string, txBytes: Uint8Array): Promise<string> {
  const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/cosmos/tx/v1beta1/txs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tx_bytes: bytesToBase64(txBytes),
      mode: 'BROADCAST_MODE_SYNC',
    }),
  });
  if (!res.ok) throw new Error(`cosmos broadcast request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as CosmosBroadcastResponse;
  const response = data.tx_response;
  if (!response?.txhash) throw new Error('Cosmos broadcast response is invalid');
  if (typeof response.code === 'number' && response.code !== 0) {
    throw new Error(formatCosmosRawLog(response.raw_log));
  }
  return response.txhash;
}

async function simulateCosmosTransfer(input: {
  apiUrl: string;
  body: { from: string; to: string; amountUatom: bigint; denom: string; memo: string };
  chainId: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  accountNumber: bigint;
  sequence: bigint;
}): Promise<{ gasLimit: bigint; feeUatom: bigint }> {
  const txBytes = buildSignedCosmosTx({
    bodyBytes: encodeTransferTxBody(input.body),
    chainId: input.chainId,
    privateKey: input.privateKey,
    publicKey: input.publicKey,
    accountNumber: input.accountNumber,
    sequence: input.sequence,
    feeUatom: 0n,
    gasLimit: 0n,
  });
  const res = await fetch(`${input.apiUrl.replace(/\/+$/, '')}/cosmos/tx/v1beta1/simulate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tx_bytes: bytesToBase64(txBytes) }),
  });
  if (!res.ok) throw new Error(`cosmos simulate request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as CosmosSimulateResponse;
  const gasUsed = BigInt(data.gas_info?.gas_used ?? '0');
  if (gasUsed <= 0n) throw new Error('Cosmos simulate response is invalid');
  const gasLimit = ceilDiv(gasUsed * COSMOS_GAS_BUFFER_NUMERATOR, COSMOS_GAS_BUFFER_DENOMINATOR);
  return { gasLimit, feeUatom: estimateCosmosFee(gasLimit) };
}

async function simulateCosmosStaking(input: {
  apiUrl: string;
  body: { delegatorAddress: string; validatorAddress: string; amountUatom: bigint; denom: string; memo: string; action: CosmosStakingAction };
  chainId: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  accountNumber: bigint;
  sequence: bigint;
}): Promise<{ gasLimit: bigint; feeUatom: bigint }> {
  const txBytes = buildSignedCosmosTx({
    bodyBytes: encodeStakingTxBody(input.body),
    chainId: input.chainId,
    privateKey: input.privateKey,
    publicKey: input.publicKey,
    accountNumber: input.accountNumber,
    sequence: input.sequence,
    feeUatom: 0n,
    gasLimit: 0n,
  });
  const res = await fetch(`${input.apiUrl.replace(/\/+$/, '')}/cosmos/tx/v1beta1/simulate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tx_bytes: bytesToBase64(txBytes) }),
  });
  if (!res.ok) throw new Error(`cosmos simulate request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as CosmosSimulateResponse;
  const gasUsed = BigInt(data.gas_info?.gas_used ?? '0');
  if (gasUsed <= 0n) throw new Error('Cosmos simulate response is invalid');
  const gasLimit = ceilDiv(gasUsed * COSMOS_GAS_BUFFER_NUMERATOR, COSMOS_GAS_BUFFER_DENOMINATOR);
  return { gasLimit, feeUatom: estimateCosmosFee(gasLimit) };
}

async function simulateCosmosWithdrawRewards(input: {
  apiUrl: string;
  body: { delegatorAddress: string; validatorAddress: string; memo: string };
  chainId: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  accountNumber: bigint;
  sequence: bigint;
}): Promise<{ gasLimit: bigint; feeUatom: bigint }> {
  const txBytes = buildSignedCosmosTx({
    bodyBytes: encodeWithdrawRewardsTxBody(input.body),
    chainId: input.chainId,
    privateKey: input.privateKey,
    publicKey: input.publicKey,
    accountNumber: input.accountNumber,
    sequence: input.sequence,
    feeUatom: 0n,
    gasLimit: 0n,
  });
  const res = await fetch(`${input.apiUrl.replace(/\/+$/, '')}/cosmos/tx/v1beta1/simulate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tx_bytes: bytesToBase64(txBytes) }),
  });
  if (!res.ok) throw new Error(`cosmos simulate request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as CosmosSimulateResponse;
  const gasUsed = BigInt(data.gas_info?.gas_used ?? '0');
  if (gasUsed <= 0n) throw new Error('Cosmos simulate response is invalid');
  const gasLimit = ceilDiv(gasUsed * COSMOS_GAS_BUFFER_NUMERATOR, COSMOS_GAS_BUFFER_DENOMINATOR);
  return { gasLimit, feeUatom: estimateCosmosFee(gasLimit) };
}

async function simulateCosmosRedelegate(input: {
  apiUrl: string;
  body: { delegatorAddress: string; sourceValidatorAddress: string; destinationValidatorAddress: string; amountUatom: bigint; denom: string; memo: string };
  chainId: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  accountNumber: bigint;
  sequence: bigint;
}): Promise<{ gasLimit: bigint; feeUatom: bigint }> {
  const txBytes = buildSignedCosmosTx({
    bodyBytes: encodeRedelegateTxBody(input.body),
    chainId: input.chainId,
    privateKey: input.privateKey,
    publicKey: input.publicKey,
    accountNumber: input.accountNumber,
    sequence: input.sequence,
    feeUatom: 0n,
    gasLimit: 0n,
  });
  const res = await fetch(`${input.apiUrl.replace(/\/+$/, '')}/cosmos/tx/v1beta1/simulate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tx_bytes: bytesToBase64(txBytes) }),
  });
  if (!res.ok) throw new Error(`cosmos simulate request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as CosmosSimulateResponse;
  const gasUsed = BigInt(data.gas_info?.gas_used ?? '0');
  if (gasUsed <= 0n) throw new Error('Cosmos simulate response is invalid');
  const gasLimit = ceilDiv(gasUsed * COSMOS_GAS_BUFFER_NUMERATOR, COSMOS_GAS_BUFFER_DENOMINATOR);
  return { gasLimit, feeUatom: estimateCosmosFee(gasLimit) };
}

async function simulateCosmosGovernanceVote(input: {
  apiUrl: string;
  body: { voterAddress: string; proposalId: bigint; option: bigint; memo: string };
  chainId: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  accountNumber: bigint;
  sequence: bigint;
}): Promise<{ gasLimit: bigint; feeUatom: bigint }> {
  const txBytes = buildSignedCosmosTx({
    bodyBytes: encodeGovernanceVoteTxBody(input.body),
    chainId: input.chainId,
    privateKey: input.privateKey,
    publicKey: input.publicKey,
    accountNumber: input.accountNumber,
    sequence: input.sequence,
    feeUatom: 0n,
    gasLimit: 0n,
  });
  const res = await fetch(`${input.apiUrl.replace(/\/+$/, '')}/cosmos/tx/v1beta1/simulate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tx_bytes: bytesToBase64(txBytes) }),
  });
  if (!res.ok) throw new Error(`cosmos simulate request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as CosmosSimulateResponse;
  const gasUsed = BigInt(data.gas_info?.gas_used ?? '0');
  if (gasUsed <= 0n) throw new Error('Cosmos simulate response is invalid');
  const gasLimit = ceilDiv(gasUsed * COSMOS_GAS_BUFFER_NUMERATOR, COSMOS_GAS_BUFFER_DENOMINATOR);
  return { gasLimit, feeUatom: estimateCosmosFee(gasLimit) };
}

function buildSignedCosmosTx(input: {
  bodyBytes: Uint8Array;
  chainId: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  accountNumber: bigint;
  sequence: bigint;
  feeUatom: bigint;
  gasLimit: bigint;
}): Uint8Array {
  const bodyBytes = input.bodyBytes;
  const authInfoBytes = encodeAuthInfo({
    publicKey: input.publicKey,
    sequence: input.sequence,
    feeUatom: input.feeUatom,
    gasLimit: input.gasLimit,
  });
  const signDoc = encodeSignDoc({
    bodyBytes,
    authInfoBytes,
    chainId: input.chainId,
    accountNumber: input.accountNumber,
  });
  const signature = secp256k1.sign(sha256(signDoc), input.privateKey);
  return encodeTxRaw({ bodyBytes, authInfoBytes, signature });
}

function estimateCosmosFee(gasLimit: bigint): bigint {
  return ceilDiv(gasLimit * COSMOS_GAS_PRICE_NUMERATOR, COSMOS_GAS_PRICE_DENOMINATOR);
}

function ceilDiv(value: bigint, divisor: bigint): bigint {
  return (value + divisor - 1n) / divisor;
}

function encodeTransferTxBody(input: { from: string; to: string; amountUatom: bigint; denom: string; memo: string }): Uint8Array {
  const msgSend = encodeMessage([
    fieldString(1, input.from),
    fieldString(2, input.to),
    fieldBytes(3, encodeCoin(input.denom, input.amountUatom.toString())),
  ]);
  const msgAny = encodeAny('/cosmos.bank.v1beta1.MsgSend', msgSend);
  return encodeMessage([
    fieldBytes(1, msgAny),
    input.memo ? fieldString(2, input.memo) : new Uint8Array(),
  ]);
}

function encodeStakingTxBody(input: { delegatorAddress: string; validatorAddress: string; amountUatom: bigint; denom: string; memo: string; action: CosmosStakingAction }): Uint8Array {
  const msg = encodeMessage([
    fieldString(1, input.delegatorAddress),
    fieldString(2, input.validatorAddress),
    fieldBytes(3, encodeCoin(input.denom, input.amountUatom.toString())),
  ]);
  const msgAny = encodeAny(
    input.action === 'delegate' ? '/cosmos.staking.v1beta1.MsgDelegate' : '/cosmos.staking.v1beta1.MsgUndelegate',
    msg,
  );
  return encodeMessage([
    fieldBytes(1, msgAny),
    input.memo ? fieldString(2, input.memo) : new Uint8Array(),
  ]);
}

function encodeWithdrawRewardsTxBody(input: { delegatorAddress: string; validatorAddress: string; memo: string }): Uint8Array {
  const msg = encodeMessage([
    fieldString(1, input.delegatorAddress),
    fieldString(2, input.validatorAddress),
  ]);
  const msgAny = encodeAny('/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward', msg);
  return encodeMessage([
    fieldBytes(1, msgAny),
    input.memo ? fieldString(2, input.memo) : new Uint8Array(),
  ]);
}

function encodeRedelegateTxBody(input: { delegatorAddress: string; sourceValidatorAddress: string; destinationValidatorAddress: string; amountUatom: bigint; denom: string; memo: string }): Uint8Array {
  const msg = encodeMessage([
    fieldString(1, input.delegatorAddress),
    fieldString(2, input.sourceValidatorAddress),
    fieldString(3, input.destinationValidatorAddress),
    fieldBytes(4, encodeCoin(input.denom, input.amountUatom.toString())),
  ]);
  const msgAny = encodeAny('/cosmos.staking.v1beta1.MsgBeginRedelegate', msg);
  return encodeMessage([
    fieldBytes(1, msgAny),
    input.memo ? fieldString(2, input.memo) : new Uint8Array(),
  ]);
}

function encodeGovernanceVoteTxBody(input: { voterAddress: string; proposalId: bigint; option: bigint; memo: string }): Uint8Array {
  const msg = encodeMessage([
    fieldVarint(1, input.proposalId),
    fieldString(2, input.voterAddress),
    fieldVarint(3, input.option),
  ]);
  const msgAny = encodeAny('/cosmos.gov.v1.MsgVote', msg);
  return encodeMessage([
    fieldBytes(1, msgAny),
    input.memo ? fieldString(2, input.memo) : new Uint8Array(),
  ]);
}

function encodeCosmosVoteOption(option: CosmosGovernanceVoteChoice): bigint {
  if (option === 'yes') return 1n;
  if (option === 'abstain') return 2n;
  if (option === 'no') return 3n;
  if (option === 'no_with_veto') return 4n;
  throw new Error('Unsupported Cosmos vote option');
}

function encodeAuthInfo(input: { publicKey: Uint8Array; sequence: bigint; feeUatom: bigint; gasLimit: bigint }): Uint8Array {
  const pubKey = encodeAny('/cosmos.crypto.secp256k1.PubKey', encodeMessage([fieldBytes(1, input.publicKey)]));
  const singleMode = encodeMessage([fieldVarint(1, 1n)]);
  const modeInfo = encodeMessage([fieldBytes(1, singleMode)]);
  const signerInfo = encodeMessage([
    fieldBytes(1, pubKey),
    fieldBytes(2, modeInfo),
    fieldVarint(3, input.sequence),
  ]);
  const fee = encodeMessage([
    fieldBytes(1, encodeCoin('uatom', input.feeUatom.toString())),
    fieldVarint(2, input.gasLimit),
  ]);
  return encodeMessage([
    fieldBytes(1, signerInfo),
    fieldBytes(2, fee),
  ]);
}

function encodeSignDoc(input: { bodyBytes: Uint8Array; authInfoBytes: Uint8Array; chainId: string; accountNumber: bigint }): Uint8Array {
  return encodeMessage([
    fieldBytes(1, input.bodyBytes),
    fieldBytes(2, input.authInfoBytes),
    fieldString(3, input.chainId),
    fieldVarint(4, input.accountNumber),
  ]);
}

function encodeTxRaw(input: { bodyBytes: Uint8Array; authInfoBytes: Uint8Array; signature: Uint8Array }): Uint8Array {
  return encodeMessage([
    fieldBytes(1, input.bodyBytes),
    fieldBytes(2, input.authInfoBytes),
    fieldBytes(3, input.signature),
  ]);
}

function encodeCoin(denom: string, amount: string): Uint8Array {
  return encodeMessage([
    fieldString(1, denom),
    fieldString(2, amount),
  ]);
}

function encodeAny(typeUrl: string, value: Uint8Array): Uint8Array {
  return encodeMessage([
    fieldString(1, typeUrl),
    fieldBytes(2, value),
  ]);
}

function fieldString(fieldNumber: number, value: string): Uint8Array {
  return fieldBytes(fieldNumber, new TextEncoder().encode(value));
}

function fieldBytes(fieldNumber: number, value: Uint8Array): Uint8Array {
  if (value.length === 0) return new Uint8Array();
  return concatBytes(encodeVarint(BigInt((fieldNumber << 3) | 2)), encodeVarint(BigInt(value.length)), value);
}

function fieldVarint(fieldNumber: number, value: bigint): Uint8Array {
  return concatBytes(encodeVarint(BigInt(fieldNumber << 3)), encodeVarint(value));
}

function encodeMessage(fields: Uint8Array[]): Uint8Array {
  return concatBytes(...fields.filter((field) => field.length > 0));
}

function encodeVarint(value: bigint): Uint8Array {
  if (value < 0n) throw new Error('Varint value must be non-negative');
  const out: number[] = [];
  let remaining = value;
  while (remaining >= 0x80n) {
    out.push(Number((remaining & 0x7fn) | 0x80n));
    remaining >>= 7n;
  }
  out.push(Number(remaining));
  return Uint8Array.from(out);
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

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function bytesFromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function bech32Encode(prefix: string, data: number[]): string {
  const checksum = bech32CreateChecksum(prefix, data);
  return `${prefix}1${[...data, ...checksum].map((value) => BECH32_CHARSET[value]).join('')}`;
}

function bech32Decode(value: string): { prefix: string; data: Uint8Array } {
  if (value !== value.toLowerCase()) throw new Error('Bech32 address must be lowercase');
  const separator = value.lastIndexOf('1');
  if (separator <= 0 || separator + 7 > value.length) throw new Error('Invalid Bech32 separator');
  const prefix = value.slice(0, separator);
  const words = [...value.slice(separator + 1)].map((char) => {
    const index = BECH32_CHARSET.indexOf(char);
    if (index === -1) throw new Error('Invalid Bech32 character');
    return index;
  });
  if (!bech32VerifyChecksum(prefix, words)) throw new Error('Invalid Bech32 checksum');
  return { prefix, data: Uint8Array.from(convertBits(words.slice(0, -6), 5, 8, false)) };
}

function bech32CreateChecksum(prefix: string, data: number[]): number[] {
  const values = [...bech32HrpExpand(prefix), ...data, 0, 0, 0, 0, 0, 0];
  const polymod = bech32Polymod(values) ^ 1;
  return Array.from({ length: 6 }, (_entry, index) => (polymod >> (5 * (5 - index))) & 31);
}

function bech32VerifyChecksum(prefix: string, data: number[]): boolean {
  return bech32Polymod([...bech32HrpExpand(prefix), ...data]) === 1;
}

function bech32HrpExpand(prefix: string): number[] {
  return [
    ...[...prefix].map((char) => char.charCodeAt(0) >> 5),
    0,
    ...[...prefix].map((char) => char.charCodeAt(0) & 31),
  ];
}

function bech32Polymod(values: number[]): number {
  let chk = 1;
  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i += 1) {
      if (((top >> i) & 1) !== 0) chk ^= BECH32_GENERATORS[i];
    }
  }
  return chk;
}

function convertBits(data: ArrayLike<number>, fromBits: number, toBits: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const maxv = (1 << toBits) - 1;
  const result: number[] = [];
  for (let i = 0; i < data.length; i += 1) {
    const value = data[i];
    if (value < 0 || value >> fromBits !== 0) throw new Error('Invalid bech32 data range');
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
