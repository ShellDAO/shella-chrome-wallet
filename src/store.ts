/**
 * Minimal persistent store backed by chrome.storage.local.
 */

export interface Network {
  name: string;
  chainId: number;
  rpcUrl: string;
}

const DEFAULT_NETWORK: Network = {
  name: 'Shell Devnet',
  chainId: 1337,
  rpcUrl: 'http://127.0.0.1:8545',
};

export async function initStore(): Promise<void> {
  const existing = await chrome.storage.local.get(['network', 'accounts']);
  if (!existing.network) {
    await chrome.storage.local.set({ network: DEFAULT_NETWORK, accounts: [] });
  }
}

export async function getAccounts(): Promise<string[]> {
  const { accounts } = await chrome.storage.local.get('accounts');
  return accounts ?? [];
}

export async function getNetwork(): Promise<Network> {
  const { network } = await chrome.storage.local.get('network');
  return network ?? DEFAULT_NETWORK;
}

export async function setNetwork(n: Network): Promise<void> {
  await chrome.storage.local.set({ network: n });
}
