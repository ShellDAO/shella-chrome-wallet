export {};

const REQUEST_TARGET = 'shella-contentscript';
const RESPONSE_TARGET = 'shella-inpage';
const EIP6963_ANNOUNCE = 'eip6963:announceProvider';
const EIP6963_REQUEST = 'eip6963:requestProvider';
const WALLET_STANDARD_REGISTER = 'wallet-standard:register-wallet';
const WALLET_STANDARD_APP_READY = 'wallet-standard:app-ready';

type ProviderEventName = 'connect' | 'disconnect' | 'accountsChanged' | 'chainChanged';
type SolanaProviderEventName = 'connect' | 'disconnect' | 'accountChanged';
type StandardWalletEventName = 'change';
type SolanaChainId = 'solana:mainnet' | 'solana:devnet' | 'solana:testnet';

interface ProviderRequestArgs {
  method: string;
  params?: unknown[];
}

interface ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

declare global {
  interface Window {
    ethereum?: ShellaInpageProvider;
    shella?: ShellaInpageProvider;
    tronLink?: ShellaTronLink;
    tronWeb?: ShellaTronWeb;
    solana?: ShellaSolanaProvider;
    ton?: ShellaTonBridge;
    aptos?: ShellaAptosProvider;
  }
}

interface ShellaTonBridge {
  isShella: true;
  tonconnect: {
    isWalletBrowser: false;
    deviceInfo: {
      platform: 'browser';
      appName: string;
      appVersion: string;
      maxProtocolVersion: number;
      features: Array<string | { name: string; maxMessages?: number; types?: string[] }>;
    };
    connect(protocolVersion?: number, request?: unknown): Promise<unknown>;
    restoreConnection(): Promise<unknown>;
    send(request: unknown): Promise<unknown>;
    listen(callback: (event: unknown) => void): () => void;
  };
}

interface ShellaTronLink {
  ready: boolean;
  request(args: ProviderRequestArgs): Promise<unknown>;
}

interface ShellaTronWeb {
  ready: boolean;
  defaultAddress: { base58: string | false; hex: string | false };
  trx: {
    getBalance(address?: string): Promise<unknown>;
    sendTransaction(to: string, amountSun: number | string): Promise<unknown>;
  };
  request(args: ProviderRequestArgs): Promise<unknown>;
}

interface ShellaAptosProvider {
  isShella: true;
  connect(): Promise<unknown>;
  account(): Promise<unknown>;
  network(): Promise<unknown>;
  getBalance(address?: string): Promise<unknown>;
  signAndSubmitTransaction(payload: unknown): Promise<unknown>;
  request(args: ProviderRequestArgs): Promise<unknown>;
}

interface SolanaPublicKeyLike {
  toString(): string;
  toBase58(): string;
}

interface StandardWalletAccount {
  address: string;
  publicKey: Uint8Array;
  chains: readonly SolanaChainId[];
  features: readonly string[];
  label: string;
  icon: string;
}

interface WalletStandardRegisterApi {
  register(...wallets: ShellaSolanaStandardWallet[]): () => void;
}

class ShellaSolanaProvider {
  isShella = true;
  isPhantom = true;
  publicKey: SolanaPublicKeyLike | null = null;
  isConnected = false;
  private readonly listeners = new Map<SolanaProviderEventName, Set<(payload: unknown) => void>>();

  constructor(private readonly requestBase: (args: ProviderRequestArgs) => Promise<unknown>) {}

  async connect(): Promise<{ publicKey: SolanaPublicKeyLike }> {
    const result = await this.request({ method: 'solana_connect', params: [] }) as { publicKey?: unknown };
    const address = typeof result.publicKey === 'string' ? result.publicKey : '';
    if (!address) throw new Error('Solana connection did not return a public key');
    this.publicKey = makeSolanaPublicKey(address);
    this.isConnected = true;
    this.emit('connect', this.publicKey);
    this.emit('accountChanged', this.publicKey);
    return { publicKey: this.publicKey };
  }

  async disconnect(): Promise<void> {
    this.publicKey = null;
    this.isConnected = false;
    this.emit('disconnect', null);
    this.emit('accountChanged', null);
  }

  async request(args: ProviderRequestArgs): Promise<unknown> {
    const result = await this.requestBase(args);
    if (args.method === 'solana_requestAccounts' || args.method === 'solana_connect') {
      const address = result && typeof result === 'object' && typeof (result as Record<string, unknown>).publicKey === 'string'
        ? (result as Record<string, string>).publicKey
        : null;
      if (address) {
        this.publicKey = makeSolanaPublicKey(address);
        this.isConnected = true;
      }
    }
    return result;
  }

  async signAndSendTransaction(transaction: unknown): Promise<unknown> {
    return this.request({ method: 'solana_signAndSendTransaction', params: [transaction] });
  }

  on(event: SolanaProviderEventName, listener: (payload: unknown) => void): this {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
    return this;
  }

  removeListener(event: SolanaProviderEventName, listener: (payload: unknown) => void): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  private emit(event: SolanaProviderEventName, payload: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(payload);
    }
  }
}

class ShellaSolanaStandardWallet {
  readonly version = '1.0.0';
  readonly name = 'Shella Wallet';
  readonly icon = SHELLA_ICON;
  readonly chains: readonly SolanaChainId[] = ['solana:mainnet', 'solana:devnet', 'solana:testnet'];
  private readonly listeners = new Map<StandardWalletEventName, Set<(payload: unknown) => void>>();
  private account: StandardWalletAccount | null = null;

  constructor(private readonly solana: ShellaSolanaProvider) {
    this.solana.on('connect', (publicKey) => this.updateAccount(publicKey));
    this.solana.on('accountChanged', (publicKey) => this.updateAccount(publicKey));
    this.solana.on('disconnect', () => this.updateAccount(null));
  }

  get accounts(): readonly StandardWalletAccount[] {
    return this.account ? [this.account] : [];
  }

  get features(): Record<string, unknown> {
    return {
      'standard:connect': { version: '1.0.0', connect: this.connect },
      'standard:disconnect': { version: '1.0.0', disconnect: this.disconnect },
      'standard:events': { version: '1.0.0', on: this.on },
      'solana:signAndSendTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signAndSendTransaction: this.signAndSendTransaction,
      },
    };
  }

  private connect = async ({ silent }: { silent?: boolean } = {}): Promise<{ accounts: readonly StandardWalletAccount[] }> => {
    if (!this.account && !silent) {
      const { publicKey } = await this.solana.connect();
      this.updateAccount(publicKey);
    }
    return { accounts: this.accounts };
  };

  private disconnect = async (): Promise<void> => {
    await this.solana.disconnect();
    this.updateAccount(null);
  };

  private on = (event: StandardWalletEventName, listener: (payload: unknown) => void): (() => void) => {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
    return () => set.delete(listener);
  };

  private signAndSendTransaction = async (...inputs: Array<{
    account: StandardWalletAccount;
    chain: SolanaChainId;
    transaction: unknown;
    options?: unknown;
  }>): Promise<Array<{ signature: Uint8Array }>> => {
    if (!this.account) throw new Error('Solana wallet is not connected');
    const outputs: Array<{ signature: Uint8Array }> = [];
    for (const input of inputs) {
      if (input.account !== this.account) throw new Error('Solana wallet account is not authorized');
      if (!this.chains.includes(input.chain)) throw new Error(`Unsupported Solana chain: ${input.chain}`);
      const result = await this.solana.signAndSendTransaction({
        transaction: input.transaction,
        chain: input.chain,
        options: input.options,
      });
      const signature = result && typeof result === 'object' && typeof (result as Record<string, unknown>).signature === 'string'
        ? (result as Record<string, string>).signature
        : '';
      if (!signature) throw new Error('Solana signAndSendTransaction did not return a signature');
      outputs.push({ signature: decodeBase58OrUtf8(signature) });
    }
    return outputs;
  };

  private updateAccount(publicKey: unknown): void {
    const address = publicKey && typeof publicKey === 'object' && typeof (publicKey as SolanaPublicKeyLike).toBase58 === 'function'
      ? (publicKey as SolanaPublicKeyLike).toBase58()
      : null;
    this.account = address
      ? {
          address,
          publicKey: decodeBase58OrUtf8(address),
          chains: this.chains,
          features: ['solana:signAndSendTransaction'],
          label: 'Shella Solana',
          icon: SHELLA_ICON,
        }
      : null;
    this.emit('change', { accounts: this.accounts });
  }

  private emit(event: StandardWalletEventName, payload: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(payload);
    }
  }
}

class ShellaInpageProvider {
  isShella = true;
  private readonly listeners = new Map<ProviderEventName, Set<(payload: unknown) => void>>();
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>();
  private accounts: string[] = [];
  private tronAccounts: string[] = [];
  private chainId: string | null = null;

  constructor(readonly info: ProviderInfo) {
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const data = event.data as { target?: string; id?: string; result?: unknown; error?: string };
      if (data?.target !== RESPONSE_TARGET || typeof data.id !== 'string') return;
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      if (data.error) {
        pending.reject(new Error(data.error));
        return;
      }
      pending.resolve(data.result);
    });

    window.addEventListener(EIP6963_REQUEST, this.announce.bind(this));
    queueMicrotask(() => this.announce());
  }

  async request({ method, params = [] }: ProviderRequestArgs): Promise<unknown> {
    // WALLET-L1: use crypto.getRandomValues for request correlation IDs instead
    // of Math.random() to prevent predictable-ID injection attacks.
    const idBytes = new Uint8Array(16);
    crypto.getRandomValues(idBytes);
    const id = Array.from(idBytes, (b) => b.toString(16).padStart(2, '0')).join('');
    const result = await new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      window.postMessage({ target: REQUEST_TARGET, id, method, params }, window.location.origin);
    });

    if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
      this.accounts = Array.isArray(result) ? result.filter((item): item is string => typeof item === 'string') : [];
      this.emit('accountsChanged', [...this.accounts]);
    }

    if (method === 'wallet_requestPermissions') {
      const permissions = Array.isArray(result) ? result : [];
      const accounts = permissions
        .flatMap((permission) => {
          if (!permission || typeof permission !== 'object') return [];
          const caveats = (permission as { caveats?: unknown }).caveats;
          if (!Array.isArray(caveats)) return [];
          return caveats.flatMap((caveat) => {
            if (!caveat || typeof caveat !== 'object') return [];
            const value = (caveat as { value?: unknown }).value;
            return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
          });
        });
      this.accounts = accounts;
      this.emit('accountsChanged', [...this.accounts]);
    }

    if (method === 'wallet_revokePermissions') {
      this.accounts = [];
      this.emit('accountsChanged', []);
    }

    if (method === 'eth_chainId' && typeof result === 'string') {
      this.chainId = result;
    }

    if (method === 'tron_requestAccounts') {
      const accounts = extractTronAccounts(result);
      this.tronAccounts = accounts;
      updateTronDefaultAddress(accounts[0] ?? null);
      this.emit('accountsChanged', [...accounts]);
    }

    if (method === 'tron_accounts') {
      const accounts = Array.isArray(result) ? result.filter((item): item is string => typeof item === 'string') : [];
      this.tronAccounts = accounts;
      updateTronDefaultAddress(accounts[0] ?? null);
    }

    if ((method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') && Array.isArray(params)) {
      const [payload] = params;
      const nextChainId =
        payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).chainId === 'string'
          ? (payload as Record<string, string>).chainId
          : null;
      if (nextChainId) {
        this.chainId = nextChainId;
        this.emit('chainChanged', nextChainId);
      }
    }

    return result;
  }

  on(event: ProviderEventName, listener: (payload: unknown) => void): this {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
    return this;
  }

  removeListener(event: ProviderEventName, listener: (payload: unknown) => void): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  private emit(event: ProviderEventName, payload: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(payload);
    }
  }

  private announce(): void {
    window.dispatchEvent(
      new CustomEvent(EIP6963_ANNOUNCE, {
        detail: {
          info: this.info,
          provider: this,
        },
      }),
    );
  }
}

const SHELLA_ICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOCIgZmlsbD0iIzFhNmVmNSIvPjxwYXRoIGQ9Ik0xNiA2bDcgNHY1YzAgNS40LTMuNCA5LjktNyAxMS0zLjYtMS4xLTctNS42LTctMTF2LTVsNy00eiIgZmlsbD0id2hpdGUiLz48L3N2Zz4=';

const info: ProviderInfo = {
  uuid: 'b7d5f1b4-7e0d-4e57-9448-6f2f4d3d4f2d',
  name: 'Shella Wallet',
  icon: SHELLA_ICON,
  rdns: 'network.shella.wallet',
};

const provider = new ShellaInpageProvider(info);
const tronLink: ShellaTronLink = {
  ready: true,
  request: (args) => provider.request(args),
};
const tronWeb: ShellaTronWeb = {
  ready: true,
  defaultAddress: { base58: false, hex: false },
  request: (args) => provider.request(args),
  trx: {
    getBalance: (address?: string) => provider.request({ method: 'tron_getBalance', params: address ? [address] : [] }),
    sendTransaction: (to: string, amountSun: number | string) =>
      provider.request({ method: 'tron_sendTransaction', params: [{ to, amountSun }] }),
  },
};
const solanaProvider = new ShellaSolanaProvider((args) => provider.request(args));
const solanaStandardWallet = new ShellaSolanaStandardWallet(solanaProvider);
let tonConnectClientId: string | null = null;
function getTonConnectManifestUrl(request: unknown): string {
  if (request && typeof request === 'object') {
    const manifestUrl = (request as Record<string, unknown>).manifestUrl;
    if (typeof manifestUrl === 'string' && manifestUrl.trim()) return manifestUrl;
  }
  return `${window.location.origin}/tonconnect-manifest.json`;
}

function getTonConnectRequestedItems(request: unknown): string[] {
  if (!request || typeof request !== 'object') return [];
  const items = (request as Record<string, unknown>).items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    if (typeof item === 'string') return [item];
    if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).name === 'string') {
      return [(item as Record<string, string>).name];
    }
    return [];
  });
}

function getTonConnectClientId(request: unknown): string {
  if (request && typeof request === 'object') {
    const candidate = (request as Record<string, unknown>).clientId ?? (request as Record<string, unknown>).appPublicKey;
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const tonBridge: ShellaTonBridge = {
  isShella: true,
  tonconnect: {
    isWalletBrowser: false,
    deviceInfo: {
      platform: 'browser',
      appName: 'Shella Wallet',
      appVersion: '0.22.0',
      maxProtocolVersion: 2,
      features: [
        { name: 'SendTransaction', maxMessages: 4 },
        { name: 'SignData', types: ['text', 'binary', 'cell'] },
        'ton_proof',
      ],
    },
    connect: async (protocolVersion = 2, request?: unknown) => {
      const clientId = getTonConnectClientId(request);
      const result = await provider.request({
        method: 'tonconnect_connect',
        params: [{
          protocolVersion,
          request: request ?? {},
          clientId,
          manifestUrl: getTonConnectManifestUrl(request),
          requestedItems: getTonConnectRequestedItems(request),
          features: [
            { name: 'SendTransaction', maxMessages: 4 },
            { name: 'SignData', types: ['text', 'binary', 'cell'] },
            { name: 'ton_proof' },
          ],
        }],
      });
      tonConnectClientId = clientId;
      return result;
    },
    restoreConnection: () => provider.request({ method: 'tonconnect_restoreConnection', params: [] }),
    send: (request: unknown) => {
      if (!request || typeof request !== 'object') throw new Error('TON Connect request is required');
      const candidate = request as Record<string, unknown>;
      const method = typeof candidate.method === 'string' ? candidate.method : '';
      if (!['sendTransaction', 'signData', 'ton_proof'].includes(method)) {
        throw new Error(`TON Connect method is not available yet: ${method || 'unknown'}`);
      }
      const clientId = typeof candidate.clientId === 'string' && candidate.clientId.trim()
        ? candidate.clientId
        : tonConnectClientId;
      if (!clientId) throw new Error('TON Connect session is not available');
      return provider.request({
        method: 'tonconnect_send',
        params: [{
          ...candidate,
          clientId,
        }],
      });
    },
    listen: () => () => undefined,
  },
};

const aptosProvider: ShellaAptosProvider = {
  isShella: true,
  connect: () => provider.request({ method: 'aptos_connect', params: [] }),
  account: () => provider.request({ method: 'aptos_account', params: [] }),
  network: () => provider.request({ method: 'aptos_network', params: [] }),
  getBalance: (address?: string) => provider.request({ method: 'aptos_getBalance', params: address ? [address] : [] }),
  signAndSubmitTransaction: (payload: unknown) => provider.request({ method: 'aptos_signAndSubmitTransaction', params: [payload] }),
  request: (args) => provider.request(args),
};

function extractTronAccounts(result: unknown): string[] {
  if (Array.isArray(result)) return result.filter((item): item is string => typeof item === 'string');
  if (result && typeof result === 'object') {
    const accounts = (result as Record<string, unknown>).accounts;
    if (Array.isArray(accounts)) return accounts.filter((item): item is string => typeof item === 'string');
  }
  return [];
}

function updateTronDefaultAddress(address: string | null): void {
  tronWeb.defaultAddress.base58 = address ?? false;
  tronWeb.defaultAddress.hex = false;
}

function makeSolanaPublicKey(address: string): SolanaPublicKeyLike {
  return {
    toString: () => address,
    toBase58: () => address,
  };
}

function registerStandardWallet(wallet: ShellaSolanaStandardWallet): void {
  const register = (api: WalletStandardRegisterApi) => api.register(wallet);
  window.addEventListener(WALLET_STANDARD_APP_READY, (event) => {
    const api = (event as Event & { detail?: WalletStandardRegisterApi }).detail;
    if (api && typeof api.register === 'function') register(api);
  });
  window.dispatchEvent(new CustomEvent(WALLET_STANDARD_REGISTER, { detail: register }));
}

function decodeBase58OrUtf8(value: string): Uint8Array {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const bytes = [0];
  for (const char of value) {
    const carryStart = alphabet.indexOf(char);
    if (carryStart < 0) return new TextEncoder().encode(value);
    let carry = carryStart;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of value) {
    if (char !== '1') break;
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

window.shella = provider;
window.tronLink = tronLink;
window.tronWeb = tronWeb;
window.solana = solanaProvider;
window.ton = tonBridge;
window.aptos = aptosProvider;
if (!window.ethereum) {
  window.ethereum = provider;
}
registerStandardWallet(solanaStandardWallet);
