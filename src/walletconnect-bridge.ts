import SignClient from '@walletconnect/sign-client';
import type { IKeyValueStorage } from '@walletconnect/keyvaluestorage';
import type { SignClientTypes } from '@walletconnect/types';
import { getSdkError } from '@walletconnect/utils';
import type {
  WalletConnectApprovedNamespace,
  WalletConnectNamespaceProposal,
  WalletConnectPairing,
  WalletConnectRelayStatus,
} from './types.js';

interface WalletConnectBridgeOptions {
  projectId?: string;
  relayUrl?: string;
}

interface WalletConnectProposalApproval {
  origin: string;
  namespaces: Record<string, WalletConnectApprovedNamespace>;
}

interface WalletConnectBridgeHandlers {
  onSessionProposal(input: {
    id: number;
    topic: string;
    origin: string;
    requiredNamespaces: Record<string, WalletConnectNamespaceProposal>;
    optionalNamespaces: Record<string, WalletConnectNamespaceProposal>;
  }): Promise<WalletConnectProposalApproval>;
  onSessionApproved(input: {
    sessionTopic: string;
    origin: string;
    requiredNamespaces: Record<string, WalletConnectNamespaceProposal>;
    optionalNamespaces: Record<string, WalletConnectNamespaceProposal>;
    expirySeconds?: number;
  }): Promise<void>;
  onSessionRequest(input: {
    id: number;
    topic: string;
    chainId: string;
    request: { method: string; params: unknown[] };
  }): Promise<{ id: number; jsonrpc: '2.0'; result?: unknown; error?: { code: number; message: string } }>;
  onSessionDelete(topic: string): Promise<void>;
}

interface WalletConnectBridge {
  pair(uri: string, localPairing: WalletConnectPairing): Promise<WalletConnectPairing>;
  getStatus(): WalletConnectRelayStatus;
}

let clientPromise: Promise<SignClient> | null = null;
let status: WalletConnectRelayStatus = {
  initialized: false,
  connected: false,
  relayUrl: null,
  projectIdConfigured: false,
  lastError: null,
};

export async function initWalletConnectBridge(
  handlers: WalletConnectBridgeHandlers,
  options: WalletConnectBridgeOptions = {},
): Promise<WalletConnectBridge> {
  const client = await getSignClient(handlers, options);
  return {
    async pair(uri, localPairing) {
      try {
        const pairing = await client.pair({ uri });
        status = { ...status, connected: true, lastError: null };
        return {
          ...localPairing,
          topic: pairing.topic,
          relayProtocol: pairing.relay.protocol,
          expiresAt: normalizeWalletConnectEpochMs(pairing.expiry),
        };
      } catch (err) {
        status = { ...status, lastError: (err as Error).message };
        throw err;
      }
    },
    getStatus() {
      return status;
    },
  };
}

async function getSignClient(
  handlers: WalletConnectBridgeHandlers,
  options: WalletConnectBridgeOptions,
): Promise<SignClient> {
  if (!clientPromise) {
    clientPromise = SignClient.init({
      projectId: normalizeOptionalString(options.projectId),
      relayUrl: normalizeOptionalString(options.relayUrl),
      logger: 'error',
      metadata: {
        name: 'Shella Wallet',
        description: 'Shell Chain multi-chain browser wallet',
        url: 'https://shellchain.io',
        icons: [],
      },
      storage: new ChromeWalletConnectStorage(),
      customStoragePrefix: 'shella-walletconnect',
    }).then((client) => {
      bindSignClientEvents(client, handlers);
      status = {
        initialized: true,
        connected: false,
        relayUrl: client.core.relayUrl ?? null,
        projectIdConfigured: Boolean(client.core.projectId),
        lastError: null,
      };
      return client;
    }).catch((err) => {
      clientPromise = null;
      status = { ...status, initialized: false, connected: false, lastError: (err as Error).message };
      throw err;
    });
  }
  return clientPromise;
}

function bindSignClientEvents(client: SignClient, handlers: WalletConnectBridgeHandlers): void {
  client.on('session_proposal', (event) => {
    void handleSessionProposal(client, handlers, event).catch((err) => {
      status = { ...status, lastError: (err as Error).message };
    });
  });

  client.on('session_request', (event) => {
    void handleSessionRequest(client, handlers, event).catch((err) => {
      status = { ...status, lastError: (err as Error).message };
    });
  });

  client.on('session_delete', (event) => {
    void handlers.onSessionDelete(event.topic).catch((err) => {
      status = { ...status, lastError: (err as Error).message };
    });
  });

  client.on('session_expire', (event) => {
    void handlers.onSessionDelete(event.topic).catch((err) => {
      status = { ...status, lastError: (err as Error).message };
    });
  });
}

async function handleSessionProposal(
  client: SignClient,
  handlers: WalletConnectBridgeHandlers,
  event: SignClientTypes.EventArguments['session_proposal'],
): Promise<void> {
  const origin = normalizeOrigin(event.params.proposer.metadata.url || event.params.proposer.metadata.name);
  try {
    const approval = await handlers.onSessionProposal({
      id: event.id,
      topic: event.params.pairingTopic,
      origin,
      requiredNamespaces: event.params.requiredNamespaces,
      optionalNamespaces: event.params.optionalNamespaces,
    });
    const settlement = await client.approve({
      id: event.id,
      namespaces: approval.namespaces,
    });
    const session = await settlement.acknowledged();
    await handlers.onSessionApproved({
      sessionTopic: session.topic,
      origin: approval.origin,
      requiredNamespaces: event.params.requiredNamespaces,
      optionalNamespaces: event.params.optionalNamespaces,
      expirySeconds: Math.max(1, Math.floor(session.expiry - Date.now() / 1000)),
    });
    status = { ...status, connected: true, lastError: null };
  } catch (err) {
    await client.reject({
      id: event.id,
      reason: getSdkError('USER_REJECTED', (err as Error).message),
    }).catch(() => undefined);
    throw err;
  }
}

async function handleSessionRequest(
  client: SignClient,
  handlers: WalletConnectBridgeHandlers,
  event: SignClientTypes.EventArguments['session_request'],
): Promise<void> {
  const rawParams = event.params.request.params;
  const params = Array.isArray(rawParams) ? rawParams : rawParams == null ? [] : [rawParams];
  const response = await handlers.onSessionRequest({
    id: event.id,
    topic: event.topic,
    chainId: event.params.chainId,
    request: {
      method: event.params.request.method,
      params,
    },
  });
  await client.respond({
    topic: event.topic,
    response: response.error
      ? { id: response.id, jsonrpc: '2.0', error: response.error }
      : { id: response.id, jsonrpc: '2.0', result: response.result },
  });
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value || 'walletconnect';
  }
}

function normalizeWalletConnectEpochMs(value: number): number {
  return value > 1_000_000_000_000 ? value : value * 1000;
}

class ChromeWalletConnectStorage implements IKeyValueStorage {
  private readonly prefix = 'walletconnect:';

  async getKeys(): Promise<string[]> {
    const all = await chrome.storage.local.get(null);
    return Object.keys(all).filter((key) => key.startsWith(this.prefix));
  }

  async getEntries<T = unknown>(): Promise<[string, T][]> {
    const all = await chrome.storage.local.get(null);
    return Object.entries(all)
      .filter(([key]) => key.startsWith(this.prefix))
      .map(([key, value]) => [key, value as T]);
  }

  async getItem<T = unknown>(key: string): Promise<T | undefined> {
    const result = await chrome.storage.local.get(this.storageKey(key));
    return result[this.storageKey(key)] as T | undefined;
  }

  async setItem<T = unknown>(key: string, value: T): Promise<void> {
    await chrome.storage.local.set({ [this.storageKey(key)]: value });
  }

  async removeItem(key: string): Promise<void> {
    await chrome.storage.local.remove(this.storageKey(key));
  }

  private storageKey(key: string): string {
    return key.startsWith(this.prefix) ? key : `${this.prefix}${key}`;
  }
}
