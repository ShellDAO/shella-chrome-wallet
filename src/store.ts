/**
 * Persistent store backed by chrome.storage.local.
 * Session state (unlocked key material) uses chrome.storage.session.
 */

import type {
  ChainKind,
  BitcoinUtxoPreference,
  ConnectedSitePermission,
  Network,
  PendingKeyRotation,
  SessionState,
  StoredAccount,
  TonConnectFeature,
  TonConnectSession,
  WatchedToken,
  WalletConnectConfig,
  WalletConnectPairing,
  WalletConnectSession,
  WalletState,
  WalletTxRecord,
} from './types.js';

export const KNOWN_NETWORKS: Record<string, Network> = {
  devnet: { name: 'Shell Devnet', chainId: 424242, rpcUrl: 'http://127.0.0.1:8545', kind: 'shell', symbol: 'SHELL', rpcProvenance: 'owned' },
  // Shell Testnet (SG3) via SSH tunnel: ssh -L 8545:127.0.0.1:8545 root@47.237.195.95
  localdev: { name: 'Shell Testnet (local)', chainId: 10, rpcUrl: 'http://127.0.0.1:8545', kind: 'shell', symbol: 'SHELL', rpcProvenance: 'owned' },
  testnet: { name: 'Shell Testnet', chainId: 10, rpcUrl: 'https://rpc.testnet.shell.network', kind: 'shell', symbol: 'SHELL', rpcProvenance: 'owned' },
  mainnet: { name: 'Shell Mainnet', chainId: 100000, rpcUrl: 'https://rpc.mainnet.shell.network', kind: 'shell', symbol: 'SHELL', rpcProvenance: 'owned' },
  tronShasta: { name: 'Tron Shasta', chainId: 2494104990, rpcUrl: 'https://api.shasta.trongrid.io', kind: 'tron', symbol: 'TRX', rpcProvenance: 'official-public' },
  tronNile: { name: 'Tron Nile', chainId: 3448148188, rpcUrl: 'https://nile.trongrid.io', kind: 'tron', symbol: 'TRX', rpcProvenance: 'official-public' },
  tronMainnet: { name: 'Tron Mainnet', chainId: 728126428, rpcUrl: 'https://api.trongrid.io', kind: 'tron', symbol: 'TRX', rpcProvenance: 'official-public' },
  solanaDevnet: { name: 'Solana Devnet', chainId: 103, rpcUrl: 'https://api.devnet.solana.com', kind: 'solana', symbol: 'SOL', rpcProvenance: 'official-public' },
  solanaTestnet: { name: 'Solana Testnet', chainId: 102, rpcUrl: 'https://api.testnet.solana.com', kind: 'solana', symbol: 'SOL', rpcProvenance: 'official-public' },
  solanaMainnet: { name: 'Solana Mainnet', chainId: 101, rpcUrl: 'https://api.mainnet-beta.solana.com', kind: 'solana', symbol: 'SOL', rpcProvenance: 'official-public' },
  bitcoinMainnet: { name: 'Bitcoin Mainnet', chainId: 8332, rpcUrl: 'https://blockstream.info/api', kind: 'bitcoin', symbol: 'BTC', rpcProvenance: 'third-party-public' },
  bitcoinTestnet: { name: 'Bitcoin Testnet', chainId: 18332, rpcUrl: 'https://blockstream.info/testnet/api', kind: 'bitcoin', symbol: 'BTC', rpcProvenance: 'third-party-public' },
  cosmosHub: { name: 'Cosmos Hub', chainId: 118, rpcUrl: 'https://rest.cosmos.directory/cosmoshub', kind: 'cosmos', symbol: 'ATOM', rpcProvenance: 'third-party-public', addressPrefix: 'cosmos', nativeDenom: 'uatom', nativeDecimals: 6 },
  cosmosTheta: { name: 'Cosmos Theta Testnet', chainId: 118001, rpcUrl: 'https://rest.sentry-01.theta-testnet.polypore.xyz', kind: 'cosmos', symbol: 'ATOM', rpcProvenance: 'third-party-public', addressPrefix: 'cosmos', nativeDenom: 'uatom', nativeDecimals: 6 },
  osmosisMainnet: { name: 'Osmosis Mainnet', chainId: 118007, rpcUrl: 'https://rest.cosmos.directory/osmosis', kind: 'cosmos', symbol: 'OSMO', rpcProvenance: 'third-party-public', addressPrefix: 'osmo', nativeDenom: 'uosmo', nativeDecimals: 6 },
  tonMainnet: { name: 'TON Mainnet', chainId: 607, rpcUrl: 'https://toncenter.com/api/v2', kind: 'ton', symbol: 'TON', rpcProvenance: 'third-party-public' },
  tonTestnet: { name: 'TON Testnet', chainId: 607001, rpcUrl: 'https://testnet.toncenter.com/api/v2', kind: 'ton', symbol: 'TON', rpcProvenance: 'third-party-public' },
  aptosTestnet: { name: 'Aptos Testnet', chainId: 2, rpcUrl: 'https://fullnode.testnet.aptoslabs.com/v1', kind: 'aptos', symbol: 'APT', rpcProvenance: 'official-public' },
  aptosDevnet: { name: 'Aptos Devnet', chainId: 35, rpcUrl: 'https://fullnode.devnet.aptoslabs.com/v1', kind: 'aptos', symbol: 'APT', rpcProvenance: 'official-public' },
};

const DEFAULT_NETWORK = KNOWN_NETWORKS.devnet;
const DEFAULT_WALLETCONNECT_CONFIG: WalletConnectConfig = { projectId: '', relayUrl: '' };
const CHAIN_KINDS = new Set<ChainKind>(['shell', 'evm', 'tron', 'solana', 'bitcoin', 'cosmos', 'ton', 'aptos']);
const RPC_PROVENANCE = new Set<NonNullable<Network['rpcProvenance']>>(['owned', 'official-public', 'third-party-public', 'user-custom']);

function inferRpcProvenance(network: Partial<Network>): NonNullable<Network['rpcProvenance']> {
  if (RPC_PROVENANCE.has(network.rpcProvenance as NonNullable<Network['rpcProvenance']>)) {
    return network.rpcProvenance as NonNullable<Network['rpcProvenance']>;
  }
  const rpcUrl = typeof network.rpcUrl === 'string' ? network.rpcUrl : '';
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(rpcUrl)) return 'owned';
  if (/^https:\/\/rpc\.(testnet|mainnet)\.shell\.network/i.test(rpcUrl)) return 'owned';
  if (/^https:\/\/(api\.(devnet|testnet|mainnet-beta)\.solana\.com|api\.shasta\.trongrid\.io|nile\.trongrid\.io|api\.trongrid\.io|fullnode\.(testnet|devnet)\.aptoslabs\.com)/i.test(rpcUrl)) {
    return 'official-public';
  }
  if (network.kind === 'shell' || network.kind === 'evm') return 'user-custom';
  return 'third-party-public';
}

function normalizeNetwork(value: unknown): Network {
  if (!value || typeof value !== 'object') return DEFAULT_NETWORK;
  const network = value as Partial<Network>;
  const kind = CHAIN_KINDS.has(network.kind as ChainKind) ? network.kind : 'shell';
  const normalized: Network = {
    name: typeof network.name === 'string' ? network.name : DEFAULT_NETWORK.name,
    chainId: typeof network.chainId === 'number' ? network.chainId : DEFAULT_NETWORK.chainId,
    rpcUrl: typeof network.rpcUrl === 'string' ? network.rpcUrl : DEFAULT_NETWORK.rpcUrl,
    kind,
    symbol: typeof network.symbol === 'string' ? network.symbol : network.kind === 'tron' ? 'TRX' : network.kind === 'solana' ? 'SOL' : network.kind === 'bitcoin' ? 'BTC' : network.kind === 'cosmos' ? 'ATOM' : network.kind === 'ton' ? 'TON' : network.kind === 'aptos' ? 'APT' : 'SHELL',
    rpcProvenance: inferRpcProvenance({ ...network, kind }),
  };
  if (normalized.kind === 'cosmos') {
    normalized.addressPrefix = typeof network.addressPrefix === 'string' ? network.addressPrefix : 'cosmos';
    normalized.nativeDenom = typeof network.nativeDenom === 'string' ? network.nativeDenom : 'uatom';
    normalized.nativeDecimals = typeof network.nativeDecimals === 'number' && Number.isInteger(network.nativeDecimals) && network.nativeDecimals >= 0 && network.nativeDecimals <= 18
      ? network.nativeDecimals
      : 6;
  }
  return normalized;
}

function normalizeConnectedSites(value: unknown): { sites: ConnectedSitePermission[]; migrated: boolean } {
  if (!Array.isArray(value)) return { sites: [], migrated: false };

  let migrated = false;

  const sites = value.flatMap((entry) => {
    if (typeof entry === 'string') {
      const now = Date.now();
      migrated = true;
      return [{
        origin: entry,
        accounts: [],
        chainId: DEFAULT_NETWORK.chainId,
        grantedAt: now,
        lastUsedAt: now,
      }];
    }

    if (!entry || typeof entry !== 'object') return [];
    const candidate = entry as Partial<ConnectedSitePermission>;
    if (typeof candidate.origin !== 'string') return [];
    const hasMissingFields =
      !Array.isArray(candidate.accounts) ||
      typeof candidate.chainId !== 'number' ||
      typeof candidate.grantedAt !== 'number' ||
      typeof candidate.lastUsedAt !== 'number';
    if (hasMissingFields) migrated = true;

    return [{
      origin: candidate.origin,
      accounts: Array.isArray(candidate.accounts)
        ? candidate.accounts.filter((item): item is string => typeof item === 'string' && isStoredConnectedAccount(item))
        : [],
      chainId: typeof candidate.chainId === 'number' ? candidate.chainId : DEFAULT_NETWORK.chainId,
      grantedAt: typeof candidate.grantedAt === 'number' ? candidate.grantedAt : Date.now(),
      lastUsedAt: typeof candidate.lastUsedAt === 'number' ? candidate.lastUsedAt : Date.now(),
    }];
  });

  return { sites, migrated };
}

function isStoredConnectedAccount(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value) ||
    /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value) ||
    /^(bc1|tb1)[ac-hj-np-z02-9]{11,87}$/i.test(value) ||
    /^[a-z][a-z0-9]{1,15}1[ac-hj-np-z02-9]{38}$/.test(value) ||
    /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

function normalizeWatchedTokens(value: unknown): { tokens: WatchedToken[]; migrated: boolean } {
  if (!Array.isArray(value)) return { tokens: [], migrated: false };
  let migrated = false;
  const seen = new Set<string>();
  const tokens = value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      migrated = true;
      return [];
    }
    const candidate = entry as Partial<WatchedToken>;
    const chainKind = CHAIN_KINDS.has(candidate.chainKind as ChainKind) ? candidate.chainKind as ChainKind : null;
    if (
      !chainKind ||
      typeof candidate.chainId !== 'number' ||
      typeof candidate.contractAddress !== 'string' ||
      typeof candidate.symbol !== 'string' ||
      typeof candidate.decimals !== 'number' ||
      !Number.isInteger(candidate.decimals) ||
      candidate.decimals < 0 ||
      candidate.decimals > 36
    ) {
      migrated = true;
      return [];
    }
    const key = `${chainKind}:${candidate.chainId}:${candidate.contractAddress.toLowerCase()}`;
    if (seen.has(key)) {
      migrated = true;
      return [];
    }
    seen.add(key);
    return [{
      chainKind,
      chainId: candidate.chainId,
      contractAddress: candidate.contractAddress,
      symbol: candidate.symbol,
      decimals: candidate.decimals,
      addedAt: typeof candidate.addedAt === 'number' ? candidate.addedAt : Date.now(),
    }];
  });
  return { tokens, migrated };
}

function normalizeWalletConnectSessions(value: unknown, now = Date.now()): { sessions: WalletConnectSession[]; migrated: boolean } {
  if (!Array.isArray(value)) return { sessions: [], migrated: false };
  let migrated = false;
  const seen = new Set<string>();
  const sessions = value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      migrated = true;
      return [];
    }
    const candidate = entry as Partial<WalletConnectSession>;
    const topic = typeof candidate.topic === 'string' ? candidate.topic : '';
    const origin = typeof candidate.origin === 'string' ? candidate.origin : '';
    const accounts = Array.isArray(candidate.accounts)
      ? candidate.accounts.filter((item): item is string => typeof item === 'string' && isStoredConnectedAccount(item))
      : [];
    const chainIds = Array.isArray(candidate.chainIds)
      ? [...new Set(candidate.chainIds.filter((item): item is number => Number.isSafeInteger(item) && item > 0))]
      : [];
    const methods = Array.isArray(candidate.methods)
      ? [...new Set(candidate.methods.filter((item): item is string => typeof item === 'string' && item.length > 0))]
      : [];
    const expiresAt = typeof candidate.expiresAt === 'number' ? candidate.expiresAt : 0;
    if (!topic || !origin || accounts.length === 0 || chainIds.length === 0 || methods.length === 0 || expiresAt <= now) {
      migrated = true;
      return [];
    }
    if (seen.has(topic)) {
      migrated = true;
      return [];
    }
    seen.add(topic);
    return [{
      topic,
      origin,
      accounts,
      chainIds,
      methods,
      grantedAt: typeof candidate.grantedAt === 'number' ? candidate.grantedAt : now,
      lastUsedAt: typeof candidate.lastUsedAt === 'number' ? candidate.lastUsedAt : now,
      expiresAt,
    }];
  });
  return { sessions, migrated };
}

function normalizeTonConnectFeatures(value: unknown): TonConnectFeature[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry) => {
    if (typeof entry === 'string') {
      const name = entry.trim();
      if (!name || seen.has(name)) return [];
      seen.add(name);
      return [{ name }];
    }
    if (!entry || typeof entry !== 'object') return [];
    const candidate = entry as Partial<TonConnectFeature>;
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
    if (!name || seen.has(name)) return [];
    seen.add(name);
    const feature: TonConnectFeature = { name };
    if (typeof candidate.maxMessages === 'number' && Number.isSafeInteger(candidate.maxMessages) && candidate.maxMessages > 0) {
      feature.maxMessages = candidate.maxMessages;
    }
    if (Array.isArray(candidate.types)) {
      const types = [...new Set(candidate.types.filter((item): item is string => typeof item === 'string' && item.length > 0))];
      if (types.length > 0) feature.types = types;
    }
    return [feature];
  });
}

function normalizeTonConnectNetwork(value: unknown, chainId: number): 'mainnet' | 'testnet' {
  if (value === 'mainnet' || value === 'testnet') return value;
  return chainId === KNOWN_NETWORKS.tonMainnet.chainId ? 'mainnet' : 'testnet';
}

function normalizeTonConnectSessions(value: unknown, now = Date.now()): { sessions: TonConnectSession[]; migrated: boolean } {
  if (!Array.isArray(value)) return { sessions: [], migrated: false };
  let migrated = false;
  const seen = new Set<string>();
  const sessions = value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      migrated = true;
      return [];
    }
    const candidate = entry as Partial<TonConnectSession>;
    const clientId = typeof candidate.clientId === 'string' ? candidate.clientId.trim() : '';
    const origin = typeof candidate.origin === 'string' ? candidate.origin.trim() : '';
    const manifestUrl = typeof candidate.manifestUrl === 'string' ? candidate.manifestUrl.trim() : '';
    const account = typeof candidate.account === 'string' ? candidate.account.trim() : '';
    const chainId = typeof candidate.chainId === 'number' && Number.isSafeInteger(candidate.chainId) && candidate.chainId > 0
      ? candidate.chainId
      : 0;
    const features = normalizeTonConnectFeatures(candidate.features);
    const expiresAt = typeof candidate.expiresAt === 'number' ? candidate.expiresAt : 0;
    if (!clientId || !origin || !manifestUrl || !account || chainId === 0 || features.length === 0 || expiresAt <= now) {
      migrated = true;
      return [];
    }
    if (seen.has(clientId)) {
      migrated = true;
      return [];
    }
    seen.add(clientId);
    return [{
      clientId,
      origin,
      manifestUrl,
      account,
      chainId,
      network: normalizeTonConnectNetwork(candidate.network, chainId),
      walletPublicKey: typeof candidate.walletPublicKey === 'string' && candidate.walletPublicKey.length > 0 ? candidate.walletPublicKey : undefined,
      features,
      grantedAt: typeof candidate.grantedAt === 'number' ? candidate.grantedAt : now,
      lastUsedAt: typeof candidate.lastUsedAt === 'number' ? candidate.lastUsedAt : now,
      expiresAt,
    }];
  });
  return { sessions, migrated };
}

function normalizeWalletConnectPairings(value: unknown, now = Date.now()): { pairings: WalletConnectPairing[]; migrated: boolean } {
  if (!Array.isArray(value)) return { pairings: [], migrated: false };
  let migrated = false;
  const seen = new Set<string>();
  const pairings = value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      migrated = true;
      return [];
    }
    const candidate = entry as Partial<WalletConnectPairing>;
    const topic = typeof candidate.topic === 'string' ? candidate.topic : '';
    const uri = typeof candidate.uri === 'string' ? candidate.uri : '';
    const relayProtocol = typeof candidate.relayProtocol === 'string' ? candidate.relayProtocol : '';
    const symKey = typeof candidate.symKey === 'string' ? candidate.symKey : '';
    const expiresAt = typeof candidate.expiresAt === 'number' ? candidate.expiresAt : 0;
    if (!topic || !uri || !relayProtocol || !symKey || expiresAt <= now) {
      migrated = true;
      return [];
    }
    if (seen.has(topic)) {
      migrated = true;
      return [];
    }
    seen.add(topic);
    return [{
      topic,
      uri,
      relayProtocol,
      symKey,
      createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : now,
      expiresAt,
    }];
  });
  return { pairings, migrated };
}

function normalizeWalletConnectConfig(value: unknown): WalletConnectConfig {
  if (!value || typeof value !== 'object') return DEFAULT_WALLETCONNECT_CONFIG;
  const candidate = value as Partial<WalletConnectConfig>;
  return {
    projectId: typeof candidate.projectId === 'string' ? candidate.projectId.trim() : '',
    relayUrl: typeof candidate.relayUrl === 'string' ? candidate.relayUrl.trim() : '',
  };
}

function normalizeBitcoinUtxoPreferences(value: unknown): { preferences: BitcoinUtxoPreference[]; migrated: boolean } {
  if (!Array.isArray(value)) return { preferences: [], migrated: false };
  let migrated = false;
  const seen = new Set<string>();
  const preferences = value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      migrated = true;
      return [];
    }
    const candidate = entry as Partial<BitcoinUtxoPreference>;
    const key = typeof candidate.key === 'string' ? candidate.key.trim().toLowerCase() : '';
    if (!/^[0-9a-f]{64}:[0-9]+$/i.test(key) || seen.has(key)) {
      migrated = true;
      return [];
    }
    seen.add(key);
    const label = typeof candidate.label === 'string' ? candidate.label.trim().slice(0, 64) : '';
    return [{
      key,
      ...(label ? { label } : {}),
      ...(candidate.locked === true ? { locked: true } : {}),
      updatedAt: typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt)
        ? candidate.updatedAt
        : Date.now(),
    }];
  });
  return { preferences, migrated };
}

export async function initStore(): Promise<void> {
  const existing = await chrome.storage.local.get([
    'network',
    'accounts',
    'autoLockMinutes',
    'connectedSites',
    'walletConnectConfig',
    'walletConnectSessions',
    'tonConnectSessions',
    'walletConnectPairings',
    'txQueue',
    'watchedTokens',
    'bitcoinUtxoPreferences',
  ]);
  if (!existing.accounts) {
    const { sites: connectedSites } = normalizeConnectedSites(existing.connectedSites);
    const { tokens: watchedTokens } = normalizeWatchedTokens(existing.watchedTokens);
    const { sessions: walletConnectSessions } = normalizeWalletConnectSessions(existing.walletConnectSessions);
    const { sessions: tonConnectSessions } = normalizeTonConnectSessions(existing.tonConnectSessions);
    const { pairings: walletConnectPairings } = normalizeWalletConnectPairings(existing.walletConnectPairings);
    const { preferences: bitcoinUtxoPreferences } = normalizeBitcoinUtxoPreferences(existing.bitcoinUtxoPreferences);
    await chrome.storage.local.set({
      network: DEFAULT_NETWORK,
      accounts: [],
      autoLockMinutes: 15,
      connectedSites,
      walletConnectConfig: normalizeWalletConnectConfig(existing.walletConnectConfig),
      walletConnectSessions,
      tonConnectSessions,
      walletConnectPairings,
      txQueue: [],
      watchedTokens,
      bitcoinUtxoPreferences,
    });
    return;
  }

  const { sites: connectedSites, migrated } = normalizeConnectedSites(existing.connectedSites);
  const { tokens: watchedTokens, migrated: tokensMigrated } = normalizeWatchedTokens(existing.watchedTokens);
  const { sessions: walletConnectSessions, migrated: walletConnectSessionsMigrated } = normalizeWalletConnectSessions(existing.walletConnectSessions);
  const { sessions: tonConnectSessions, migrated: tonConnectSessionsMigrated } = normalizeTonConnectSessions(existing.tonConnectSessions);
  const { pairings: walletConnectPairings, migrated: walletConnectPairingsMigrated } = normalizeWalletConnectPairings(existing.walletConnectPairings);
  const { preferences: bitcoinUtxoPreferences, migrated: bitcoinUtxoPreferencesMigrated } = normalizeBitcoinUtxoPreferences(existing.bitcoinUtxoPreferences);

  if (
    !existing.network ||
    existing.autoLockMinutes == null ||
    !existing.connectedSites ||
    !existing.walletConnectConfig ||
    !existing.walletConnectSessions ||
    !existing.tonConnectSessions ||
    !existing.walletConnectPairings ||
    !existing.txQueue ||
    !existing.watchedTokens ||
    !existing.bitcoinUtxoPreferences ||
    connectedSites.length !== (Array.isArray(existing.connectedSites) ? existing.connectedSites.length : 0) ||
    migrated ||
    walletConnectSessions.length !== (Array.isArray(existing.walletConnectSessions) ? existing.walletConnectSessions.length : 0) ||
    walletConnectSessionsMigrated ||
    tonConnectSessions.length !== (Array.isArray(existing.tonConnectSessions) ? existing.tonConnectSessions.length : 0) ||
    tonConnectSessionsMigrated ||
    walletConnectPairings.length !== (Array.isArray(existing.walletConnectPairings) ? existing.walletConnectPairings.length : 0) ||
    walletConnectPairingsMigrated ||
    watchedTokens.length !== (Array.isArray(existing.watchedTokens) ? existing.watchedTokens.length : 0) ||
    tokensMigrated ||
    bitcoinUtxoPreferences.length !== (Array.isArray(existing.bitcoinUtxoPreferences) ? existing.bitcoinUtxoPreferences.length : 0) ||
    bitcoinUtxoPreferencesMigrated
  ) {
    await chrome.storage.local.set({
      network: normalizeNetwork(existing.network),
      autoLockMinutes: existing.autoLockMinutes ?? 15,
      connectedSites,
      walletConnectConfig: normalizeWalletConnectConfig(existing.walletConnectConfig),
      walletConnectSessions,
      tonConnectSessions,
      walletConnectPairings,
      txQueue: existing.txQueue ?? [],
      watchedTokens,
      bitcoinUtxoPreferences,
    });
  }
}

export async function getWalletState(): Promise<WalletState> {
  const data = await chrome.storage.local.get([
    'network',
    'accounts',
    'autoLockMinutes',
    'connectedSites',
    'walletConnectConfig',
    'walletConnectSessions',
    'tonConnectSessions',
    'walletConnectPairings',
    'txQueue',
    'watchedTokens',
    'bitcoinUtxoPreferences',
  ]);
  const { tokens: watchedTokens } = normalizeWatchedTokens(data.watchedTokens);
  const { sessions: walletConnectSessions } = normalizeWalletConnectSessions(data.walletConnectSessions);
  const { sessions: tonConnectSessions } = normalizeTonConnectSessions(data.tonConnectSessions);
  const { pairings: walletConnectPairings } = normalizeWalletConnectPairings(data.walletConnectPairings);
  const { preferences: bitcoinUtxoPreferences } = normalizeBitcoinUtxoPreferences(data.bitcoinUtxoPreferences);
  return {
    network: normalizeNetwork(data.network),
    accounts: data.accounts ?? [],
    autoLockMinutes: data.autoLockMinutes ?? 15,
    connectedSites: normalizeConnectedSites(data.connectedSites).sites,
    walletConnectConfig: normalizeWalletConnectConfig(data.walletConnectConfig),
    walletConnectSessions,
    tonConnectSessions,
    walletConnectPairings,
    txQueue: data.txQueue ?? [],
    watchedTokens,
    bitcoinUtxoPreferences,
  };
}

export async function getAccounts(): Promise<StoredAccount[]> {
  const { accounts } = await chrome.storage.local.get('accounts');
  return accounts ?? [];
}

export async function addAccount(account: StoredAccount): Promise<void> {
  const accounts = await getAccounts();
  const exists = accounts.some((a) => a.pqAddress === account.pqAddress);
  if (!exists) {
    accounts.push(account);
    await chrome.storage.local.set({ accounts });
  }
}

export async function replaceAccountKeystore(pqAddress: string, keystoreJson: string): Promise<void> {
  const accounts = await getAccounts();
  const index = accounts.findIndex((a) => a.pqAddress.toLowerCase() === pqAddress.toLowerCase());
  if (index === -1) throw new Error('Account not found');
  accounts[index] = { ...accounts[index], keystoreJson };
  await chrome.storage.local.set({ accounts });
}

export async function getNetwork(): Promise<Network> {
  const { network } = await chrome.storage.local.get('network');
  return normalizeNetwork(network);
}

export async function setNetwork(n: Network): Promise<void> {
  await chrome.storage.local.set({ network: n });
}

export async function getTxQueue(): Promise<WalletTxRecord[]> {
  const { txQueue } = await chrome.storage.local.get('txQueue');
  return txQueue ?? [];
}

export async function setTxQueue(txQueue: WalletTxRecord[]): Promise<void> {
  await chrome.storage.local.set({ txQueue });
}

export async function upsertTxRecord(record: WalletTxRecord): Promise<void> {
  const txQueue = await getTxQueue();
  const next = [...txQueue];
  const index = next.findIndex((item) => item.txHash.toLowerCase() === record.txHash.toLowerCase());
  if (index === -1) {
    next.unshift(record);
  } else {
    next[index] = record;
  }
  await setTxQueue(next.slice(0, 50));
}

export async function getPendingKeyRotations(): Promise<PendingKeyRotation[]> {
  const { pendingKeyRotations } = await chrome.storage.local.get('pendingKeyRotations');
  return Array.isArray(pendingKeyRotations) ? pendingKeyRotations : [];
}

export async function addPendingKeyRotation(rotation: PendingKeyRotation): Promise<void> {
  const pending = await getPendingKeyRotations();
  const next = pending.filter((item) => item.txHash.toLowerCase() !== rotation.txHash.toLowerCase());
  next.unshift(rotation);
  await chrome.storage.local.set({ pendingKeyRotations: next.slice(0, 10) });
}

export async function setPendingKeyRotations(pendingKeyRotations: PendingKeyRotation[]): Promise<void> {
  await chrome.storage.local.set({ pendingKeyRotations });
}

export async function getAutoLockMinutes(): Promise<number> {
  const { autoLockMinutes } = await chrome.storage.local.get('autoLockMinutes');
  return autoLockMinutes ?? 15;
}

export async function setAutoLockMinutes(minutes: number): Promise<void> {
  await chrome.storage.local.set({ autoLockMinutes: minutes });
}

export async function getWalletConnectConfig(): Promise<WalletConnectConfig> {
  const { walletConnectConfig } = await chrome.storage.local.get('walletConnectConfig');
  return normalizeWalletConnectConfig(walletConnectConfig);
}

export async function setWalletConnectConfig(config: WalletConnectConfig): Promise<void> {
  await chrome.storage.local.set({ walletConnectConfig: normalizeWalletConnectConfig(config) });
}

// Session storage tracks unlock state only. Secret key material stays in memory.
export async function setSessionState(state: SessionState): Promise<void> {
  await chrome.storage.session.set({ walletSession: state });
}

export async function getSessionState(): Promise<SessionState | null> {
  const { walletSession } = await chrome.storage.session.get('walletSession');
  return walletSession ?? null;
}

export async function clearSessionState(): Promise<void> {
  await chrome.storage.session.remove('walletSession');
}

export async function getConnectedSites(): Promise<ConnectedSitePermission[]> {
  const { connectedSites } = await chrome.storage.local.get('connectedSites');
  return normalizeConnectedSites(connectedSites).sites;
}

export async function addConnectedSite(site: ConnectedSitePermission): Promise<void> {
  const sites = await getConnectedSites();
  const next = sites.filter((entry) => entry.origin !== site.origin);
  next.push(site);
  await chrome.storage.local.set({ connectedSites: next });
}

export async function removeConnectedSite(origin: string): Promise<void> {
  const sites = await getConnectedSites();
  await chrome.storage.local.set({
    connectedSites: sites.filter((site) => site.origin !== origin),
  });
}

export async function clearConnectedSites(): Promise<void> {
  await chrome.storage.local.set({ connectedSites: [] });
}

export async function getWalletConnectSessions(): Promise<WalletConnectSession[]> {
  const { walletConnectSessions } = await chrome.storage.local.get('walletConnectSessions');
  return normalizeWalletConnectSessions(walletConnectSessions).sessions;
}

export async function upsertWalletConnectSession(session: WalletConnectSession): Promise<void> {
  const sessions = await getWalletConnectSessions();
  const next = sessions.filter((entry) => entry.topic !== session.topic);
  next.push(session);
  await chrome.storage.local.set({ walletConnectSessions: next.slice(-50) });
}

export async function removeWalletConnectSession(topic: string): Promise<void> {
  const sessions = await getWalletConnectSessions();
  await chrome.storage.local.set({
    walletConnectSessions: sessions.filter((session) => session.topic !== topic),
  });
}

export async function clearWalletConnectSessions(): Promise<void> {
  await chrome.storage.local.set({ walletConnectSessions: [] });
}

export async function getTonConnectSessions(): Promise<TonConnectSession[]> {
  const { tonConnectSessions } = await chrome.storage.local.get('tonConnectSessions');
  return normalizeTonConnectSessions(tonConnectSessions).sessions;
}

export async function upsertTonConnectSession(session: TonConnectSession): Promise<void> {
  const normalized = normalizeTonConnectSessions([session], 0).sessions[0];
  if (!normalized) throw new Error('Invalid TonConnect session');
  const sessions = await getTonConnectSessions();
  const next = sessions.filter((entry) => entry.clientId !== normalized.clientId);
  next.push(normalized);
  await chrome.storage.local.set({ tonConnectSessions: next.slice(-50) });
}

export async function removeTonConnectSession(clientId: string): Promise<void> {
  const sessions = await getTonConnectSessions();
  await chrome.storage.local.set({
    tonConnectSessions: sessions.filter((session) => session.clientId !== clientId),
  });
}

export async function clearTonConnectSessions(): Promise<void> {
  await chrome.storage.local.set({ tonConnectSessions: [] });
}

export async function getWalletConnectPairings(): Promise<WalletConnectPairing[]> {
  const { walletConnectPairings } = await chrome.storage.local.get('walletConnectPairings');
  return normalizeWalletConnectPairings(walletConnectPairings).pairings;
}

export async function upsertWalletConnectPairing(pairing: WalletConnectPairing): Promise<void> {
  const pairings = await getWalletConnectPairings();
  const next = pairings.filter((entry) => entry.topic !== pairing.topic);
  next.push(pairing);
  await chrome.storage.local.set({ walletConnectPairings: next.slice(-50) });
}

export async function removeWalletConnectPairing(topic: string): Promise<void> {
  const pairings = await getWalletConnectPairings();
  await chrome.storage.local.set({
    walletConnectPairings: pairings.filter((pairing) => pairing.topic !== topic),
  });
}

export async function getWatchedTokens(): Promise<WatchedToken[]> {
  const { watchedTokens } = await chrome.storage.local.get('watchedTokens');
  return normalizeWatchedTokens(watchedTokens).tokens;
}

export async function addWatchedToken(token: WatchedToken): Promise<void> {
  const tokens = await getWatchedTokens();
  const key = `${token.chainKind}:${token.chainId}:${token.contractAddress.toLowerCase()}`;
  const next = tokens.filter((item) => `${item.chainKind}:${item.chainId}:${item.contractAddress.toLowerCase()}` !== key);
  next.unshift(token);
  await chrome.storage.local.set({ watchedTokens: next.slice(0, 100) });
}

export async function removeWatchedToken(chainKind: ChainKind, chainId: number, contractAddress: string): Promise<void> {
  const tokens = await getWatchedTokens();
  await chrome.storage.local.set({
    watchedTokens: tokens.filter((item) =>
      !(item.chainKind === chainKind && item.chainId === chainId && item.contractAddress.toLowerCase() === contractAddress.toLowerCase()),
    ),
  });
}

export async function getBitcoinUtxoPreferences(): Promise<BitcoinUtxoPreference[]> {
  const { bitcoinUtxoPreferences } = await chrome.storage.local.get('bitcoinUtxoPreferences');
  return normalizeBitcoinUtxoPreferences(bitcoinUtxoPreferences).preferences;
}

export async function upsertBitcoinUtxoPreference(preference: BitcoinUtxoPreference): Promise<void> {
  const normalized = normalizeBitcoinUtxoPreferences([preference]).preferences[0];
  if (!normalized) throw new Error('Invalid Bitcoin UTXO preference');
  const preferences = await getBitcoinUtxoPreferences();
  const next = preferences.filter((item) => item.key !== normalized.key);
  if (normalized.label || normalized.locked) {
    next.unshift({ ...normalized, updatedAt: Date.now() });
  }
  await chrome.storage.local.set({ bitcoinUtxoPreferences: next.slice(0, 500) });
}

export async function upsertBitcoinUtxoPreferences(preferencesToUpsert: BitcoinUtxoPreference[]): Promise<void> {
  const normalized = normalizeBitcoinUtxoPreferences(preferencesToUpsert).preferences;
  if (normalized.length === 0) return;
  const existing = await getBitcoinUtxoPreferences();
  const byKey = new Map(existing.map((preference) => [preference.key, preference]));
  const now = Date.now();
  for (const preference of normalized) {
    if (preference.label || preference.locked) {
      byKey.set(preference.key, { ...preference, updatedAt: now });
    } else {
      byKey.delete(preference.key);
    }
  }
  const next = [...byKey.values()].sort((left, right) => right.updatedAt - left.updatedAt);
  await chrome.storage.local.set({ bitcoinUtxoPreferences: next.slice(0, 500) });
}

export async function clearAllData(): Promise<void> {
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  await initStore();
  // hdStore is cleared by chrome.storage.local.clear() above
}

export async function getLastActiveAddress(): Promise<string | null> {
  const { lastActiveAddress } = await chrome.storage.local.get('lastActiveAddress');
  return typeof lastActiveAddress === 'string' ? lastActiveAddress : null;
}

export async function setLastActiveAddress(address: string): Promise<void> {
  await chrome.storage.local.set({ lastActiveAddress: address });
}

// HD wallet store — persists seed + mnemonic keystores and HD account count.
export interface HdStore {
  seedKeystoreJson: string;
  mnemonicKeystoreJson: string;
  accountCount: number;
}

export async function getHdStore(): Promise<HdStore | null> {
  const { hdStore } = await chrome.storage.local.get('hdStore');
  return (hdStore as HdStore) ?? null;
}

export async function setHdStore(data: HdStore): Promise<void> {
  await chrome.storage.local.set({ hdStore: data });
}

export async function clearHdStore(): Promise<void> {
  await chrome.storage.local.remove('hdStore');
}
