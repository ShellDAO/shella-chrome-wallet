/**
 * Shella Wallet — popup entry point.
 * Multi-view SPA rendered into #app.
 */

import QRCode from 'qrcode';
import type {
  AaBatchInnerCall,
  ApprovalRequest,
  BitcoinTransferPreview,
  BitcoinTxInput,
  BitcoinUtxoPreference,
  ChainCapabilities,
  ChainKind,
  CosmosDenomBalance,
  CosmosGovernanceProposal,
  CosmosIbcContext,
  CosmosRedelegationEntry,
  CosmosStakingPosition,
  CosmosValidatorSummary,
  ConnectedSitePermission,
  Network,
  WalletConnectConfig,
  WalletConnectPairing,
  WalletConnectRelayStatus,
  WalletNodeInfo,
  WalletSnapshot,
  WalletTxRecord,
  WatchedToken,
} from './types.js';
import { getChainCapabilities } from './chains/capabilities.js';
import { KNOWN_NETWORKS } from './store.js';

type View =
  | 'loading'
  | 'welcome'
  | 'create-password'
  | 'create-generating'
  | 'create-success'
  | 'hd-show-phrase'
  | 'hd-confirm-phrase'
  | 'hd-create-password'
  | 'hd-creating'
  | 'hd-restore-phrase'
  | 'hd-restore-password'
  | 'hd-restoring'
  | 'reveal-phrase'
  | 'reveal-phrase-confirm'
  | 'import-file'
  | 'import-password'
  | 'locked'
  | 'unlocking'
  | 'sending'
  | 'wallet'
  | 'send'
  | 'utxo-manager'
  | 'add-token'
  | 'send-token'
  | 'receive'
  | 'history'
  | 'settings'
  | 'accounts'
  | 'add-account'
  | 'add-account-generating'
  | 'switch-account'
  | 'advanced-pq'
  | 'approval-request';

interface AppState {
  view: View;
  pqAddress: string;
  balance: string;
  balanceFormatted: string;
  network: Network;
  detectedChainId: number | null;
  nonce: number | null;
  autoLockMinutes: number;
  connectedSites: ConnectedSitePermission[];
  walletConnectConfig: WalletConnectConfig;
  walletConnectPairings: WalletConnectPairing[];
  walletConnectRelayStatus: WalletConnectRelayStatus | null;
  txHistory: WalletTxRecord[];
  txQueue: WalletTxRecord[];
  watchedTokens: WatchedToken[];
  tokenBalances: Record<string, { balance: string; formatted: string; symbol: string; decimals: number }>;
  cosmosBalances: CosmosDenomBalance[];
  cosmosStaking: CosmosStakingPosition[];
  cosmosRedelegations: CosmosRedelegationEntry[];
  cosmosValidators: CosmosValidatorSummary[];
  cosmosGovernanceProposals: CosmosGovernanceProposal[];
  cosmosIbcContext: CosmosIbcContext | null;
  error: string;
  toast: string;
  nodeInfo: WalletNodeInfo | null;
  // Multi-account state
  accounts: Array<{ pqAddress: string; chainAddresses?: Record<string, string> }>;
  selectedTxHash: string;
  switchTargetAddress: string;
  // Temp fields for flows
  pendingKeystoreJson: string;
  pendingMnemonic: string;
  revealedMnemonic: string;
  sendTo: string;
  sendValue: string;
  sendData: string;
  sendCosmosMemo: string;
  sendGasLimit: string;
  sendMaxFeePerGas: string;
  sendMaxPriorityFeePerGas: string;
  sendBitcoinFeePreset: string;
  sendBitcoinFeeRate: string;
  sendBitcoinUtxoSort: string;
  sendBitcoinSelectedInputs: string[];
  bitcoinUtxoPreferences: BitcoinUtxoPreference[];
  bitcoinUtxoManagerInputs: BitcoinTxInput[];
  bitcoinUtxoFilter: string;
  sendPreview: BitcoinTransferPreview | null;
  sendPreviewConfirmed: boolean;
  tokenAddAddress: string;
  tokenSendContract: string;
  tokenSendSymbol: string;
  tokenSendDecimals: string;
  splRecipientStatus: SplRecipientAccountStatus | null;
  walletConnectUri: string;
  walletConnectProjectId: string;
  walletConnectRelayUrl: string;
  sessionPassword: string;
  sessionIndex: string;
  sessionRootAccountIndex: string;
  sessionExpiryBlock: string;
  sessionValueCap: string;
  sessionTarget: string;
  sessionTxSigningHash: string;
  sessionAuthJson: string;
  rotatePassword: string;
  pendingRotationTxHash: string;
  approvalRequest: ApprovalRequest | null;
}

interface SplRecipientAccountStatus {
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

interface ChainUiMetadata {
  capabilities: ChainCapabilities;
  symbol: string;
  accountModel: string;
  addressLabel: string;
  addressPlaceholder: string;
  receiveHint: string;
  feeModel: string;
  decimals: number;
  tokenStandard?: string;
  validateAddress(value: string): boolean;
  invalidAddressMessage: string;
}

interface NetworkOptionGroup {
  label: string;
  options: Array<{ key: keyof typeof KNOWN_NETWORKS; label: string }>;
}

const CHAIN_UI_METADATA: Record<ChainKind, ChainUiMetadata> = {
  shell: {
    capabilities: getChainCapabilities('shell'),
    symbol: 'SHELL',
    accountModel: 'Shell',
    addressLabel: '0x… hex',
    addressPlaceholder: '0x…',
    receiveHint: 'Share your Shell address to receive SHELL or Shell assets.',
    feeModel: 'Next nonce:',
    decimals: 18,
    tokenStandard: 'ERC20',
    validateAddress: (value) => /^0x[0-9a-fA-F]{64}$/.test(value),
    invalidAddressMessage: 'Recipient must be a 0x + 64-char hex Shell address',
  },
  evm: {
    capabilities: getChainCapabilities('evm'),
    symbol: 'SHELL',
    accountModel: 'Shell',
    addressLabel: '0x… hex',
    addressPlaceholder: '0x…',
    receiveHint: 'Share your 0x address to receive assets on this EVM-compatible network.',
    feeModel: 'Next nonce:',
    decimals: 18,
    tokenStandard: 'ERC20',
    validateAddress: (value) => /^0x[0-9a-fA-F]{64}$/.test(value),
    invalidAddressMessage: 'Recipient must be a 0x + 64-char hex Shell address',
  },
  tron: {
    capabilities: getChainCapabilities('tron'),
    symbol: 'TRX',
    accountModel: 'Tron',
    addressLabel: 'T… Tron address',
    addressPlaceholder: 'T…',
    receiveHint: 'Share your Tron address to receive TRX or TRC20 tokens.',
    feeModel: 'Tron bandwidth/energy',
    decimals: 6,
    tokenStandard: 'TRC20',
    validateAddress: (value) => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value),
    invalidAddressMessage: 'Recipient must be a valid Tron address',
  },
  solana: {
    capabilities: getChainCapabilities('solana'),
    symbol: 'SOL',
    accountModel: 'Solana',
    addressLabel: 'Base58 Solana address',
    addressPlaceholder: 'Solana address',
    receiveHint: 'Share your Solana address to receive SOL or Solana assets.',
    feeModel: 'Solana transaction fee',
    decimals: 9,
    tokenStandard: 'SPL',
    validateAddress: (value) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value),
    invalidAddressMessage: 'Recipient must be a valid Solana address',
  },
  bitcoin: {
    capabilities: getChainCapabilities('bitcoin'),
    symbol: 'BTC',
    accountModel: 'Bitcoin',
    addressLabel: 'bc1/tb1 Bitcoin address',
    addressPlaceholder: 'bc1… or tb1…',
    receiveHint: 'Share your Bitcoin address for the selected Bitcoin network.',
    feeModel: 'UTXO miner fee',
    decimals: 8,
    validateAddress: (value) => /^(bc1|tb1)[ac-hj-np-z02-9]{11,87}$/i.test(value),
    invalidAddressMessage: 'Recipient must be a valid Bitcoin address',
  },
  cosmos: {
    capabilities: getChainCapabilities('cosmos'),
    symbol: 'ATOM',
    accountModel: 'Cosmos',
    addressLabel: 'Cosmos bech32 address',
    addressPlaceholder: 'cosmos1… / osmo1…',
    receiveHint: 'Share your Cosmos SDK address to receive the selected network asset.',
    feeModel: 'Cosmos account sequence',
    decimals: 6,
    validateAddress: (value) => /^[a-z][a-z0-9]{1,15}1[ac-hj-np-z02-9]{38}$/.test(value),
    invalidAddressMessage: 'Recipient must be a valid Cosmos bech32 address',
  },
  ton: {
    capabilities: getChainCapabilities('ton'),
    symbol: 'TON',
    accountModel: 'TON',
    addressLabel: 'TON wallet address',
    addressPlaceholder: 'UQ… / EQ…',
    receiveHint: 'Share your TON wallet address to receive Toncoin or Jettons.',
    feeModel: 'TON wallet seqno',
    decimals: 9,
    tokenStandard: 'JETTON',
    validateAddress: (value) => /^-?\d+:[0-9a-fA-F]{64}$/.test(value) || /^[A-Za-z0-9_-]{48}$/.test(value),
    invalidAddressMessage: 'Recipient must be a valid TON address',
  },
  aptos: {
    capabilities: getChainCapabilities('aptos'),
    symbol: 'APT',
    accountModel: 'Aptos',
    addressLabel: '0x… Aptos address',
    addressPlaceholder: '0x…',
    receiveHint: 'Share your Aptos address to receive APT. Native APT sending is enabled; dApp signing remains disabled.',
    feeModel: 'Aptos sequence:',
    decimals: 8,
    validateAddress: (value) => /^0x[0-9a-fA-F]{1,64}$/.test(value),
    invalidAddressMessage: 'Recipient must be a valid Aptos 0x address',
  },
};

const NETWORK_OPTION_GROUPS: NetworkOptionGroup[] = [
  {
    label: 'Shell',
    options: [
      { key: 'devnet', label: '⬡ Devnet' },
      { key: 'localdev', label: '⬡ Testnet (local)' },
      { key: 'testnet', label: '⬡ Testnet' },
      { key: 'mainnet', label: '⬡ Mainnet' },
    ],
  },
  {
    label: 'Tron',
    options: [
      { key: 'tronShasta', label: '▣ Shasta' },
      { key: 'tronNile', label: '▣ Nile' },
      { key: 'tronMainnet', label: '▣ Mainnet' },
    ],
  },
  {
    label: 'Solana',
    options: [
      { key: 'solanaDevnet', label: '◎ Devnet' },
      { key: 'solanaTestnet', label: '◎ Testnet' },
      { key: 'solanaMainnet', label: '◎ Mainnet' },
    ],
  },
  {
    label: 'Bitcoin',
    options: [
      { key: 'bitcoinMainnet', label: '₿ Mainnet' },
      { key: 'bitcoinTestnet', label: '₿ Testnet' },
    ],
  },
  {
    label: 'Cosmos',
    options: [
      { key: 'cosmosHub', label: '✦ Cosmos Hub' },
      { key: 'osmosisMainnet', label: '✦ Osmosis' },
    ],
  },
  {
    label: 'TON',
    options: [
      { key: 'tonMainnet', label: '◈ Mainnet' },
      { key: 'tonTestnet', label: '◈ Testnet' },
    ],
  },
  {
    label: 'Aptos',
    options: [
      { key: 'aptosTestnet', label: '⬢ Testnet' },
      { key: 'aptosDevnet', label: '⬢ Devnet' },
    ],
  },
];

const state: AppState = {
  view: 'loading',
  pqAddress: '',
  balance: '0',
  balanceFormatted: '0.000000',
  network: { name: 'Shell Devnet', chainId: 424242, rpcUrl: 'http://127.0.0.1:8545', kind: 'shell', symbol: 'SHELL', rpcProvenance: 'owned' },
  detectedChainId: null,
  nonce: null,
  autoLockMinutes: 15,
  connectedSites: [],
  walletConnectConfig: { projectId: '', relayUrl: '' },
  walletConnectPairings: [],
  walletConnectRelayStatus: null,
  txHistory: [],
  txQueue: [],
  watchedTokens: [],
  tokenBalances: {},
  cosmosBalances: [],
  cosmosStaking: [],
  cosmosRedelegations: [],
  cosmosValidators: [],
  cosmosGovernanceProposals: [],
  cosmosIbcContext: null,
  error: '',
  toast: '',
  nodeInfo: null,
  pendingKeystoreJson: '',
  pendingMnemonic: '',
  revealedMnemonic: '',
  sendTo: '',
  sendValue: '',
  sendData: '0x',
  sendCosmosMemo: '',
  sendGasLimit: '',
  sendMaxFeePerGas: '',
  sendMaxPriorityFeePerGas: '',
  sendBitcoinFeePreset: 'auto',
  sendBitcoinFeeRate: '',
  sendBitcoinUtxoSort: 'value-desc',
  sendBitcoinSelectedInputs: [],
  bitcoinUtxoPreferences: [],
  bitcoinUtxoManagerInputs: [],
  bitcoinUtxoFilter: '',
  sendPreview: null,
  sendPreviewConfirmed: false,
  tokenAddAddress: '',
  tokenSendContract: '',
  tokenSendSymbol: '',
  tokenSendDecimals: '',
  splRecipientStatus: null,
  walletConnectUri: '',
  walletConnectProjectId: '',
  walletConnectRelayUrl: '',
  sessionPassword: '',
  sessionIndex: '0',
  sessionRootAccountIndex: '0',
  sessionExpiryBlock: '',
  sessionValueCap: '0',
  sessionTarget: '',
  sessionTxSigningHash: '',
  sessionAuthJson: '',
  rotatePassword: '',
  pendingRotationTxHash: '',
  approvalRequest: null,
  accounts: [],
  selectedTxHash: '',
  switchTargetAddress: '',
};

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderError(): string {
  return state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : '';
}

function send<T = unknown>(type: string, data: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...data }, (response: T & { error?: string }) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (response?.error) return reject(new Error(response.error));
      resolve(response);
    });
  });
}

function app(): HTMLElement {
  const el = document.getElementById('app');
  if (!el) throw new Error('#app element not found — popup DOM failed to load');
  return el;
}

function showToast(msg: string, isError = false): void {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast' + (isError ? ' toast-error' : ' toast-ok');
  el.style.display = 'block';
  setTimeout(() => {
    el.style.display = 'none';
  }, 3000);
}

export function truncate(addr: string, start = 10, end = 8): string {
  if (!addr || addr.length <= start + end + 3) return addr;
  return addr.slice(0, start) + '…' + addr.slice(-end);
}

function formatDateTime(value: string): string {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatApprovalValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return JSON.stringify(value);
}

function isRpcUnavailable(): boolean {
  return state.detectedChainId == null;
}

function isChainMismatch(): boolean {
  return state.detectedChainId != null && state.detectedChainId !== state.network.chainId;
}

function getNetworkWarning(): string {
  const metadata = currentChainUiMetadata();
  if (state.network.kind !== 'shell' && state.network.kind !== 'evm' && !state.pqAddress) {
    return `No ${metadata.accountModel} address is available for this account. Create or restore an HD wallet to enable ${metadata.accountModel}.`;
  }
  if (isRpcUnavailable()) {
    return `RPC unavailable for ${state.network.name}. Check the RPC URL or node status.`;
  }
  if (isChainMismatch()) {
    return `Chain mismatch: wallet expects ${state.network.chainId}, RPC returned ${state.detectedChainId}.`;
  }
  return '';
}

function getSendUnavailableReason(): string {
  const metadata = currentChainUiMetadata();
  const networkWarning = getNetworkWarning();
  if (networkWarning) return networkWarning;
  if (!metadata.capabilities.nativeTransfers) {
    return `${metadata.accountModel} transfers are not enabled yet.`;
  }
  return '';
}

function chainSymbol(): string {
  return state.network.symbol ?? currentChainUiMetadata().symbol;
}

function currentChainUiMetadata(): ChainUiMetadata {
  return CHAIN_UI_METADATA[state.network.kind ?? 'shell'];
}

export function formatRpcProvenance(network: Network): string {
  switch (network.rpcProvenance) {
    case 'owned': return 'Shell-owned/local RPC';
    case 'official-public': return 'Official public RPC';
    case 'third-party-public': return 'Third-party public RPC';
    case 'user-custom': return 'User custom RPC';
    default: return 'Unclassified RPC';
  }
}

function tokenKey(token: WatchedToken): string {
  return `${token.chainKind}:${token.chainId}:${token.contractAddress.toLowerCase()}`;
}

function tokenMessageType(action: 'add' | 'balance' | 'send' | 'remove' | 'info'): string {
  const standard = currentChainUiMetadata().tokenStandard;
  if (standard === 'TRC20') {
    return {
      add: 'ADD_TRC20_TOKEN',
      balance: 'GET_TRC20_BALANCE',
      send: 'SEND_TRC20_TRANSFER',
      remove: 'REMOVE_TRC20_TOKEN',
      info: 'GET_TRC20_TOKEN_INFO',
    }[action];
  }
  if (standard === 'SPL') {
    return {
      add: 'ADD_SPL_TOKEN',
      balance: 'GET_SPL_BALANCE',
      send: 'SEND_SPL_TRANSFER',
      remove: 'REMOVE_SPL_TOKEN',
      info: 'GET_SPL_TOKEN_INFO',
    }[action];
  }
  if (standard === 'JETTON') {
    return {
      add: 'ADD_JETTON_TOKEN',
      balance: 'GET_JETTON_BALANCE',
      send: 'SEND_JETTON_TRANSFER',
      remove: 'REMOVE_JETTON_TOKEN',
      info: 'GET_JETTON_TOKEN_INFO',
    }[action];
  }
  return {
    add: 'ADD_ERC20_TOKEN',
    balance: 'GET_ERC20_BALANCE',
    send: 'SEND_ERC20_TRANSFER',
    remove: 'REMOVE_ERC20_TOKEN',
    info: 'GET_ERC20_TOKEN_INFO',
  }[action];
}

function currentNetworkTokens(): WatchedToken[] {
  return state.watchedTokens.filter((token) => token.chainKind === state.network.kind && token.chainId === state.network.chainId);
}

function renderAccountModelMeta(): string {
  const metadata = currentChainUiMetadata();
  if (metadata.capabilities.accountNonce) {
    return state.nonce == null ? 'Nonce unavailable' : `Nonce: ${state.nonce}`;
  }
  return `Account model: ${metadata.accountModel}`;
}

export function renderNetworkOptions(): string {
  return NETWORK_OPTION_GROUPS.map((group) => `
    <optgroup label="${escapeHtml(group.label)}">
      ${group.options.map((option) => {
        const network = KNOWN_NETWORKS[option.key];
        return `<option value="${escapeHtml(option.key)}" ${state.network.name === network.name ? 'selected' : ''}>${escapeHtml(option.label)}</option>`;
      }).join('')}
    </optgroup>
  `).join('');
}

function getLatestFailedTx(): WalletTxRecord | null {
  const failed = state.txQueue.filter((tx) => tx.status === 'failed');
  if (failed.length === 0) return null;
  return [...failed].sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
}

function render(): void {
  const views: Record<View, () => string> = {
    loading: renderLoading,
    welcome: renderWelcome,
    'create-password': renderCreatePassword,
    'create-generating': renderGenerating,
    'create-success': renderCreateSuccess,
    'hd-show-phrase': renderHdShowPhrase,
    'hd-confirm-phrase': renderHdConfirmPhrase,
    'hd-create-password': renderHdCreatePassword,
    'hd-creating': renderHdCreating,
    'hd-restore-phrase': renderHdRestorePhrase,
    'hd-restore-password': renderHdRestorePassword,
    'hd-restoring': renderHdRestoring,
    'reveal-phrase': renderRevealPhraseConfirm,
    'reveal-phrase-confirm': renderRevealPhrase,
    'import-file': renderImportFile,
    'import-password': renderImportPassword,
    locked: renderLocked,
    unlocking: renderUnlocking,
    sending: renderSending,
    wallet: renderWallet,
    send: renderSend,
    'utxo-manager': renderBitcoinUtxoManager,
    'add-token': renderAddToken,
    'send-token': renderSendToken,
    receive: renderReceive,
    history: renderHistory,
    settings: renderSettings,
    accounts: renderAccounts,
    'add-account': renderAddAccount,
    'add-account-generating': renderAddAccountGenerating,
    'switch-account': renderSwitchAccount,
    'advanced-pq': renderAdvancedPq,
    'approval-request': renderApprovalRequest,
  };
  
  const appElement = app();
  appElement.textContent = '';
  
  // Create toast element safely
  const toastDiv = document.createElement('div');
  toastDiv.id = 'toast';
  toastDiv.className = 'toast';
  toastDiv.style.display = 'none';
  appElement.appendChild(toastDiv);
  
  // Create container for view content
  const viewContainer = document.createElement('div');
  viewContainer.innerHTML = views[state.view]?.() ?? renderLoading();
  appElement.appendChild(viewContainer);
  
  attachHandlers();
}

function renderLoading(): string {
  return `<div class="center"><div class="spinner"></div><p>Loading…</p></div>`;
}

function renderWelcome(): string {
  return `
    <div class="welcome">
      <div class="logo">🔐</div>
      <h1>Shella Wallet</h1>
      <p class="subtitle">Post-quantum wallet for Shell Chain</p>
      <button id="btn-create-hd" class="btn-primary">Create New Wallet</button>
      <button id="btn-restore-hd" class="btn-secondary">Import Recovery Phrase</button>
      <button id="btn-import" class="btn-secondary" style="margin-top:4px">Import Keystore</button>
    </div>
  `;
}

function renderCreatePassword(): string {
  return `
    <div class="view-form">
      <button class="btn-back" id="btn-back">← Back</button>
      <h2>Set Password</h2>
      <p class="hint">Protects your wallet on this device. Minimum 8 characters.</p>
      <label>Password
        <input type="password" id="pwd1" placeholder="Enter password" autocomplete="new-password" />
      </label>
      <label>Confirm Password
        <input type="password" id="pwd2" placeholder="Confirm password" autocomplete="new-password" />
      </label>
      ${renderError()}
      <button id="btn-confirm-pwd" class="btn-primary">Create Wallet</button>
    </div>
  `;
}

function renderGenerating(): string {
  return `
    <div class="center">
      <div class="spinner"></div>
      <h2>Generating Key Pair</h2>
      <p class="hint">Using ML-DSA-65 post-quantum algorithm…</p>
    </div>
  `;
}

function renderUnlocking(): string {
  return `
    <div class="center">
      <div class="spinner"></div>
      <h2>Unlocking…</h2>
      <p class="hint">Decrypting your keystore, please wait.</p>
    </div>
  `;
}

function renderSending(): string {
  return `
    <div class="center">
      <div class="spinner"></div>
      <h2>Sending Transaction…</h2>
      <p class="hint">Signing and broadcasting to ${escapeHtml(state.network.name)}…</p>
    </div>
  `;
}

function renderCreateSuccess(): string {
  return `
    <div class="view-form success-view">
      <div class="success-icon">✅</div>
      <h2>Wallet Created!</h2>
      <p class="hint">Your post-quantum wallet is ready.</p>
      <div class="address-box">
        <span class="label">Address</span>
        <span class="address monospace" id="addr-display">${escapeHtml(truncate(state.pqAddress))}</span>
        <button class="btn-copy" id="btn-copy-addr" title="Copy address">⧉</button>
      </div>
      <div class="info-box">
        <strong>⚠️ Backup Reminder</strong>
        <p>Export your keystore file and store it safely. It's the only way to recover your wallet.</p>
      </div>
      <button id="btn-export-ks" class="btn-secondary">Export Keystore</button>
      <button id="btn-goto-wallet" class="btn-primary">Open Wallet</button>
    </div>
  `;
}

function renderHdShowPhrase(): string {
  const words = state.pendingMnemonic.split(' ');
  const grid = words.map((word, i) => `
    <div class="phrase-word">
      <span class="word-num">${i + 1}</span>
      <span class="word-val">${escapeHtml(word)}</span>
    </div>
  `).join('');
  return `
    <div class="view-form">
      <button class="btn-back" id="btn-back">← Back</button>
      <h2>Recovery Phrase</h2>
      <p class="hint">⚠️ Write down these 24 words in order. Anyone with these words can access your wallet.</p>
      <div class="phrase-grid">${grid}</div>
      ${renderError()}
      <button id="btn-hd-phrase-next" class="btn-primary" style="margin-top:16px">I've Written It Down</button>
    </div>
  `;
}

function renderHdConfirmPhrase(): string {
  return `
    <div class="view-form">
      <button class="btn-back" id="btn-back">← Back</button>
      <h2>Confirm Backup</h2>
      <p class="hint">Confirm you have securely backed up your recovery phrase. You will not be able to view it again.</p>
      <label class="checkbox-label">
        <input type="checkbox" id="hd-confirm-check" />
        I have securely backed up my 24-word recovery phrase.
      </label>
      ${renderError()}
      <button id="btn-hd-confirm-next" class="btn-primary" style="margin-top:16px">Continue</button>
    </div>
  `;
}

function renderHdCreatePassword(): string {
  return `
    <div class="view-form">
      <button class="btn-back" id="btn-back">← Back</button>
      <h2>Set Password</h2>
      <p class="hint">Protects your wallet on this device. Minimum 8 characters.</p>
      <label>Password
        <input type="password" id="hd-pwd1" placeholder="Enter password" autocomplete="new-password" />
      </label>
      <label>Confirm Password
        <input type="password" id="hd-pwd2" placeholder="Confirm password" autocomplete="new-password" />
      </label>
      ${renderError()}
      <button id="btn-hd-create-confirm" class="btn-primary">Create Wallet</button>
    </div>
  `;
}

function renderHdCreating(): string {
  return `
    <div class="center">
      <div class="spinner"></div>
      <h2>Creating HD Wallet</h2>
      <p class="hint">Deriving ML-DSA-65 keys from recovery phrase…</p>
    </div>
  `;
}

function renderHdRestorePhrase(): string {
  return `
    <div class="view-form">
      <button class="btn-back" id="btn-back">← Back</button>
      <h2>Import Recovery Phrase</h2>
      <p class="hint">Enter your 12 or 24-word BIP-39 recovery phrase, separated by spaces.</p>
      <label>Recovery Phrase
        <textarea id="hd-restore-phrase-input" rows="4" placeholder="word1 word2 word3 …" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></textarea>
      </label>
      ${renderError()}
      <button id="btn-hd-restore-phrase-next" class="btn-primary">Continue</button>
    </div>
  `;
}

function renderHdRestorePassword(): string {
  return `
    <div class="view-form">
      <button class="btn-back" id="btn-back">← Back</button>
      <h2>Set Password</h2>
      <p class="hint">Protects your restored wallet on this device. Minimum 8 characters.</p>
      <label>Password
        <input type="password" id="hd-restore-pwd1" placeholder="Enter password" autocomplete="new-password" />
      </label>
      <label>Confirm Password
        <input type="password" id="hd-restore-pwd2" placeholder="Confirm password" autocomplete="new-password" />
      </label>
      ${renderError()}
      <button id="btn-hd-restore-confirm" class="btn-primary">Restore Wallet</button>
    </div>
  `;
}

function renderHdRestoring(): string {
  return `
    <div class="center">
      <div class="spinner"></div>
      <h2>Restoring Wallet</h2>
      <p class="hint">Deriving keys from recovery phrase…</p>
    </div>
  `;
}

function renderRevealPhraseConfirm(): string {
  return `
    <div class="view-form">
      <button class="btn-back" id="btn-back">← Back</button>
      <h2>Reveal Recovery Phrase</h2>
      <p class="hint">⚠️ Make sure nobody is watching your screen. Enter your password to reveal the recovery phrase.</p>
      <label>Password
        <input type="password" id="reveal-phrase-pwd" placeholder="Enter password" autocomplete="current-password" autofocus />
      </label>
      ${renderError()}
      <button id="btn-reveal-phrase-confirm" class="btn-primary">Reveal Phrase</button>
    </div>
  `;
}

function renderRevealPhrase(): string {
  const words = state.revealedMnemonic.split(' ');
  const grid = words.map((word, i) => `
    <div class="phrase-word">
      <span class="word-num">${i + 1}</span>
      <span class="word-val">${escapeHtml(word)}</span>
    </div>
  `).join('');
  return `
    <div class="view-form">
      <button class="btn-back" id="btn-back">← Back</button>
      <h2>Recovery Phrase</h2>
      <p class="hint">⚠️ Keep this phrase secret. Anyone with these words controls your wallet.</p>
      <div class="phrase-grid">${grid}</div>
      <button id="btn-back-from-phrase" class="btn-secondary" style="margin-top:16px">Done</button>
    </div>
  `;
}

function renderImportFile(): string {
  return `
    <div class="view-form">
      <button class="btn-back" id="btn-back">← Back</button>
      <h2>Import Keystore</h2>
      <p class="hint">Select a Shell CLI keystore JSON file.</p>
      <div class="file-drop" id="file-drop">
        <input type="file" id="ks-file" accept=".json,application/json" />
        <label for="ks-file">
          📄 Click to choose keystore file
        </label>
      </div>
      ${renderError()}
    </div>
  `;
}

function renderImportPassword(): string {
  return `
    <div class="view-form">
      <button class="btn-back" id="btn-back">← Back</button>
      <h2>Enter Keystore Password</h2>
      <p class="hint">Enter the password used to encrypt this keystore.</p>
      <label>Password
        <input type="password" id="import-pwd" placeholder="Keystore password" autocomplete="current-password" />
      </label>
      ${renderError()}
      <button id="btn-confirm-import" class="btn-primary">Import Wallet</button>
    </div>
  `;
}

function renderLocked(): string {
    const accountSelectorHtml = state.accounts.length > 1
    ? `<label>Account
        <select id="unlock-account-select">
          ${state.accounts.map(a =>
            `<option value="${escapeHtml(a.pqAddress)}" ${a.pqAddress === state.pqAddress ? 'selected' : ''}>
               ${escapeHtml(truncate(a.pqAddress))}
             </option>`
          ).join('')}
        </select>
      </label>`
    : '';

  return `
    <div class="view-form">
      <div class="logo">🔒</div>
      <h2>Wallet Locked</h2>
      ${accountSelectorHtml}
      <p class="hint">${escapeHtml(truncate(state.pqAddress) || 'Enter your password to unlock.')}</p>
      <label>Password
        <input type="password" id="unlock-pwd" placeholder="Enter password" autocomplete="current-password" autofocus />
      </label>
      ${renderError()}
      <button id="btn-unlock" class="btn-primary">Unlock</button>
    </div>
  `;
}

function renderWallet(): string {
  const pendingTxs = state.txQueue.filter((tx) => tx.status === 'pending').slice(0, 3);
  const networkWarning = getNetworkWarning();
  const failedTx = getLatestFailedTx();
  const cosmosAssetsHtml = renderCosmosDenomAssets();
  const cosmosStakingHtml = renderCosmosStakingPositions();
  const cosmosRedelegationsHtml = renderCosmosRedelegations();
  const cosmosValidatorsHtml = renderCosmosValidators();
  const cosmosGovernanceHtml = renderCosmosGovernanceProposals();
  const tokenHtml = renderTokenAssets();

  // Storage profile badge (v0.18.0)
  const storageProfile = state.nodeInfo?.storage_profile;
  const storageProfileClass =
    storageProfile === 'archive' || storageProfile === 'full' || storageProfile === 'light'
      ? storageProfile
      : 'unknown';
  const storageProfileHtml = storageProfile
    ? `<span class="storage-badge storage-badge-${storageProfileClass}" title="Node storage mode">
        ${storageProfile === 'archive' ? '🗄' : storageProfile === 'full' ? '💾' : '🔍'} ${escapeHtml(storageProfile)}
       </span>`
    : '';
  const rpcProvenanceHtml = `<span class="network-provenance" title="${escapeHtml(state.network.rpcUrl)}">${escapeHtml(formatRpcProvenance(state.network))}</span>`;

  // Node info panel — shown when shell_getNodeInfo succeeds.
  const nodeInfoHtml = state.nodeInfo
    ? `<div class="node-info-card">
        <span class="node-info-item" title="Node version">📦 ${escapeHtml(state.nodeInfo.version)}</span>
        <span class="node-info-item" title="Block height">🧱 #${state.nodeInfo.block_height.toLocaleString()}</span>
        <span class="node-info-item" title="Peer count">🔗 ${state.nodeInfo.peer_count} peer${state.nodeInfo.peer_count === 1 ? '' : 's'}</span>
      </div>`
    : '';

  const pendingHtml = pendingTxs.length > 0
    ? `
      <div class="pending-card">
        <div class="pending-title">Pending Transactions</div>
        ${pendingTxs.map((tx) => `
          <div class="pending-item">
            <span class="monospace">${escapeHtml(truncate(tx.txHash, 8, 6))}</span>
            <span>${escapeHtml(formatTxHistoryLabel(tx))}</span>
          </div>
        `).join('')}
      </div>
    `
    : '';
  const failedHtml = failedTx
    ? `
      <div class="status-card status-card-error">
        <div class="status-card-title">Latest failed transaction</div>
        <div class="status-card-row">
          <span class="monospace">${escapeHtml(truncate(failedTx.txHash, 8, 6))}</span>
          <span>${escapeHtml(formatDisplayValue(failedTx.value))} SHELL</span>
        </div>
        <div class="status-card-detail">${escapeHtml(failedTx.error ?? 'Transaction failed on-chain.')}</div>
      </div>
    `
    : '';
  return `
    <div class="wallet-view">
      <div class="wallet-header">
        <select id="quick-net-select" class="quick-net-select" title="Switch network">
          ${renderNetworkOptions()}
        </select>
        ${rpcProvenanceHtml}
        ${storageProfileHtml}
        <button class="btn-icon" id="btn-accounts" title="Accounts (${state.accounts.length})">👤</button>
        <button class="btn-icon" id="btn-settings" title="Settings">⚙</button>
        <button class="btn-icon" id="btn-lock" title="Lock wallet">🔒</button>
      </div>
      <div class="address-box">
        <span class="monospace address-short">${escapeHtml(truncate(state.pqAddress))}</span>
        <button class="btn-copy" id="btn-copy-addr" title="Copy address">⧉</button>
      </div>
      <div class="balance-section">
        <span class="balance-amount">${escapeHtml(state.balanceFormatted)}</span>
        <span class="balance-unit">${escapeHtml(chainSymbol())}</span>
        <button class="btn-refresh" id="btn-refresh" title="Refresh balance">↻</button>
      </div>
      <div class="wallet-meta">
        <span>Configured chain: ${state.network.chainId}</span>
        <span>${state.detectedChainId == null ? 'RPC unavailable' : `RPC chain: ${state.detectedChainId}`}</span>
        <span>${renderAccountModelMeta()}</span>
      </div>
      ${nodeInfoHtml}
      ${networkWarning ? `<div class="status-card status-card-warning">${escapeHtml(networkWarning)}</div>` : ''}
      <div class="action-row">
        <button class="btn-action" id="btn-send" ${currentChainUiMetadata().capabilities.nativeTransfers ? '' : 'disabled'}>
          <span>↑</span>Send
        </button>
        <button class="btn-action" id="btn-receive">
          <span>↓</span>Receive
        </button>
        <button class="btn-action" id="btn-history">
          <span>☰</span>History
        </button>
        ${currentChainUiMetadata().capabilities.utxo ? `
          <button class="btn-action" id="btn-utxo-manager">
            <span>☷</span>UTXOs
          </button>
        ` : ''}
      </div>
      ${cosmosAssetsHtml}
      ${cosmosStakingHtml}
      ${cosmosRedelegationsHtml}
      ${cosmosValidatorsHtml}
      ${cosmosGovernanceHtml}
      ${tokenHtml}
      ${failedHtml}
      ${pendingHtml}
    </div>
  `;
}

function renderCosmosDenomAssets(): string {
  if ((state.network.kind ?? 'shell') !== 'cosmos') return '';
  const rows = state.cosmosBalances.length > 0
    ? state.cosmosBalances.map((balance) => `
        <div class="token-item">
          <div class="token-main">
            <span class="token-symbol">${escapeHtml(balance.symbol)}</span>
            <span class="monospace token-contract">${escapeHtml(truncate(balance.denom, 12, 10))}</span>
          </div>
          <div class="token-balance">
            <span>${escapeHtml(balance.formatted)}</span>
            <span>${escapeHtml(balance.symbol)}</span>
          </div>
        </div>
      `).join('')
    : '<div class="empty-state compact-empty">No Cosmos SDK balances found</div>';
  return `
    <div class="token-card">
      <div class="token-card-header">
        <span>Cosmos SDK Balances</span>
      </div>
      ${rows}
    </div>
  `;
}

function renderCosmosStakingPositions(): string {
  if ((state.network.kind ?? 'shell') !== 'cosmos') return '';
  const rows = state.cosmosStaking.length > 0
    ? state.cosmosStaking.map((position) => `
        <div class="token-item">
          <div class="token-main">
            <span class="token-symbol">${escapeHtml(position.validatorMoniker)}</span>
            <span class="monospace token-contract">${escapeHtml(truncate(position.validatorAddress, 12, 10))}</span>
          </div>
          <div class="token-balance">
            <span>${escapeHtml(position.formatted)}</span>
            <span>${escapeHtml(position.symbol)}</span>
          </div>
          <button class="btn-secondary btn-compact btn-cosmos-redelegate" data-validator="${escapeHtml(position.validatorAddress)}">Redelegate</button>
          <button class="btn-secondary btn-compact btn-cosmos-undelegate" data-validator="${escapeHtml(position.validatorAddress)}">Undelegate</button>
          <button class="btn-secondary btn-compact btn-cosmos-withdraw-rewards" data-validator="${escapeHtml(position.validatorAddress)}">Rewards</button>
        </div>
      `).join('')
    : '<div class="empty-state compact-empty">No active Cosmos delegations found</div>';
  return `
    <div class="token-card">
      <div class="token-card-header">
        <span>Cosmos Staking</span>
        <button class="btn-secondary btn-compact" id="btn-cosmos-delegate">Delegate</button>
      </div>
      ${rows}
    </div>
  `;
}

function renderCosmosRedelegations(): string {
  if ((state.network.kind ?? 'shell') !== 'cosmos' || state.cosmosRedelegations.length === 0) return '';
  const rows = state.cosmosRedelegations.map((entry) => `
    <div class="token-item">
      <div class="token-main">
        <span class="token-symbol">Redelegation cooling down</span>
        <span class="monospace token-contract">${escapeHtml(truncate(entry.sourceValidatorAddress, 10, 6))} → ${escapeHtml(truncate(entry.destinationValidatorAddress, 10, 6))}</span>
        <span class="muted">Completes ${escapeHtml(formatDateTime(entry.completionTime))} · height ${escapeHtml(entry.creationHeight)}</span>
      </div>
      <div class="token-balance">
        <span>${escapeHtml(entry.formatted)}</span>
        <span>${escapeHtml(entry.symbol)}</span>
      </div>
    </div>
  `).join('');
  return `
    <div class="token-card">
      <div class="token-card-header">
        <span>Cosmos Redelegations</span>
      </div>
      <div class="empty-state compact-empty">
        A validator receiving a redelegation cannot be used as a new redelegation source until its cooldown completes.
      </div>
      ${rows}
    </div>
  `;
}

function renderCosmosValidators(): string {
  if ((state.network.kind ?? 'shell') !== 'cosmos') return '';
  const rows = state.cosmosValidators.length > 0
    ? state.cosmosValidators.slice(0, 8).map((validator) => {
        const risk = validator.riskFlags.length > 0 ? validator.riskFlags.join(', ') : 'normal';
        const riskSummary = summarizeCosmosValidatorRisk(validator);
        const maxCommission = validator.maxCommissionRate ? validator.maxCommissionPercent : 'unknown';
        const maxChange = validator.maxCommissionChangeRate ? validator.maxCommissionChangePercent : 'unknown';
        const selfDelegation = validator.minSelfDelegation || 'unknown';
        const votingPower = validator.votingPower || '0';
        const shares = validator.delegatorShares || 'unknown';
        const slashStatus = validator.tombstoned
          ? 'Tombstoned'
          : validator.missedBlocksCounter !== '0'
            ? `${validator.missedBlocksCounter} missed`
            : 'No recent misses';
        const jailedUntil = validator.jailedUntil ? formatDateTime(validator.jailedUntil) : 'not jailed';
        return `
          <div class="token-item">
            <div class="token-main">
              <span class="token-symbol">${escapeHtml(validator.moniker)}</span>
              <span class="monospace token-contract">${escapeHtml(truncate(validator.validatorAddress, 12, 10))}</span>
              <span class="muted">Risk ${escapeHtml(riskSummary.level)} · ${escapeHtml(riskSummary.guidance)}</span>
              <span class="muted">Commission ${escapeHtml(validator.commissionPercent)} · ${escapeHtml(risk)}</span>
              <span class="muted">Max ${escapeHtml(maxCommission)} · Daily change ${escapeHtml(maxChange)} · Self ${escapeHtml(selfDelegation)}</span>
              <span class="muted">Power ${escapeHtml(votingPower)} · Shares ${escapeHtml(truncate(shares, 10, 6))}</span>
              <span class="muted">Slash ${escapeHtml(slashStatus)} · Jailed until ${escapeHtml(jailedUntil)}</span>
            </div>
            <div class="token-balance">
              <span>${validator.jailed ? 'Jailed' : validator.status === 'BOND_STATUS_BONDED' ? 'Bonded' : escapeHtml(validator.status)}</span>
            </div>
            <button class="btn-secondary btn-compact btn-cosmos-delegate-validator" data-validator="${escapeHtml(validator.validatorAddress)}">Delegate</button>
          </div>
        `;
      }).join('')
    : '<div class="empty-state compact-empty">No Cosmos validators found</div>';
  return `
    <div class="token-card">
      <div class="token-card-header">
        <span>Cosmos Validators</span>
      </div>
      ${rows}
    </div>
  `;
}

function renderCosmosGovernanceProposals(): string {
  if ((state.network.kind ?? 'shell') !== 'cosmos') return '';
  const votingPower = summarizeCosmosVotingPower(state.cosmosStaking);
  const rows = state.cosmosGovernanceProposals.length > 0
    ? state.cosmosGovernanceProposals.slice(0, 5).map((proposal) => {
        const status = formatCosmosProposalStatus(proposal.status);
        const depositEnd = proposal.depositEndTime ? formatDateTime(proposal.depositEndTime) : 'not in deposit';
        const votingStart = proposal.votingStartTime ? formatDateTime(proposal.votingStartTime) : 'not started';
        const votingEnd = proposal.votingEndTime ? formatDateTime(proposal.votingEndTime) : 'not in voting';
        const summary = proposal.summary ? truncate(proposal.summary.replace(/\s+/g, ' '), 90, 0) : 'No summary';
        const tally = `Yes ${formatCosmosVoteCount(proposal.yesVotes)} · No ${formatCosmosVoteCount(proposal.noVotes)} · Abstain ${formatCosmosVoteCount(proposal.abstainVotes)} · Veto ${formatCosmosVoteCount(proposal.noWithVetoVotes)}`;
        const voterVote = formatCosmosVoterVote(proposal.voterVoteOption, proposal.voterVoteWeight);
        const params = `Quorum ${formatCosmosGovernancePercent(proposal.quorum)} · Threshold ${formatCosmosGovernancePercent(proposal.threshold)} · Veto ${formatCosmosGovernancePercent(proposal.vetoThreshold)}`;
        const risk = proposal.riskSummary || 'No immediate governance risk flags';
        const canVote = proposal.status === 'PROPOSAL_STATUS_VOTING_PERIOD';
        return `
          <div class="token-item">
            <div class="token-main">
              <span class="token-symbol">#${escapeHtml(proposal.id)} ${escapeHtml(proposal.title)}</span>
              <span class="muted">Status ${escapeHtml(status)} · Deposit ends ${escapeHtml(depositEnd)}</span>
              <span class="muted">Voting ${escapeHtml(votingStart)} -> ${escapeHtml(votingEnd)}</span>
              <span class="muted">${escapeHtml(tally)}</span>
              <span class="muted">Your vote ${escapeHtml(voterVote)}</span>
              <span class="muted">Deposit ${escapeHtml(proposal.totalDeposit)}</span>
              <span class="muted">${escapeHtml(params)}</span>
              <span class="muted">Risk ${escapeHtml(risk)}</span>
              <span class="muted">${escapeHtml(summary)}</span>
            </div>
            ${canVote ? `<button class="btn-secondary btn-compact btn-cosmos-vote" data-proposal-id="${escapeHtml(proposal.id)}">Vote</button>` : ''}
          </div>
        `;
      }).join('')
    : '<div class="empty-state compact-empty">No governance proposals found</div>';
  return `
    <div class="token-card">
      <div class="token-card-header">
        <span>Cosmos Governance</span>
        <span class="muted">Voting power ${escapeHtml(votingPower)}</span>
      </div>
      ${rows}
    </div>
  `;
}

export function formatCosmosProposalStatus(status: string): string {
  return status
    .replace(/^PROPOSAL_STATUS_/, '')
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ') || 'Unknown';
}

export function formatCosmosVoteCount(value: string): string {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return '0';
  return BigInt(normalized).toLocaleString('en-US');
}

export function formatCosmosGovernancePercent(value: string): string {
  if (!/^\d+(\.\d+)?$/.test(value)) return 'unknown';
  const percent = Number(value) * 100;
  if (!Number.isFinite(percent)) return 'unknown';
  return `${percent.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
}

export function formatCosmosVoterVote(optionValue: string, weightValue: string): string {
  if (!optionValue || optionValue === 'not voted') return 'Not voted';
  const options = optionValue.split(',').map((option) => formatCosmosVoteOption(option.trim()));
  const weights = weightValue.split(',').map((weight) => formatCosmosVoteWeight(weight.trim()));
  return options.map((option, index) => {
    const weight = weights[index];
    return weight ? `${option} ${weight}` : option;
  }).join(', ');
}

function formatCosmosVoteOption(option: string): string {
  return option
    .replace(/^VOTE_OPTION_/, '')
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ') || 'Unspecified';
}

function formatCosmosVoteWeight(weight: string): string {
  if (!/^\d+(\.\d+)?$/.test(weight)) return '';
  const percent = Number(weight) * 100;
  if (!Number.isFinite(percent)) return '';
  return `${percent.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
}

function summarizeCosmosVotingPower(positions: CosmosStakingPosition[]): string {
  const totals = new Map<string, bigint>();
  for (const position of positions) {
    try {
      totals.set(position.symbol, (totals.get(position.symbol) ?? 0n) + BigInt(position.amount));
    } catch {
      // Ignore malformed remote amounts; staking rows still render individually.
    }
  }
  const rendered = [...totals.entries()].map(([symbol, amount]) => `${formatCosmosVoteCount(amount.toString())} ${symbol}`);
  return rendered.join(', ') || '0';
}

function renderTokenAssets(): string {
  const metadata = currentChainUiMetadata();
  if (!metadata.capabilities.tokenTransfers) return '';
  const tokens = currentNetworkTokens();
  const tokenStandard = metadata.tokenStandard ?? 'Tokens';
  const rows = tokens.length > 0
    ? tokens.map((token) => {
        const balance = state.tokenBalances[tokenKey(token)];
        return `
          <div class="token-item">
            <div class="token-main">
              <span class="token-symbol">${escapeHtml(token.symbol)}</span>
              <span class="monospace token-contract">${escapeHtml(truncate(token.contractAddress, 8, 6))}</span>
            </div>
            <div class="token-balance">
              <span>${escapeHtml(balance?.formatted ?? '…')}</span>
              <span>${escapeHtml(balance?.symbol ?? token.symbol)}</span>
            </div>
            <button class="btn-secondary btn-token-send" data-contract="${escapeHtml(token.contractAddress)}">Send</button>
            <button class="btn-icon btn-token-remove" data-contract="${escapeHtml(token.contractAddress)}" title="Remove token">×</button>
          </div>
        `;
      }).join('')
    : `<div class="empty-state compact-empty">No ${escapeHtml(tokenStandard)} tokens added</div>`;
  return `
    <div class="token-card">
      <div class="token-card-header">
        <span>${escapeHtml(tokenStandard)} Tokens</span>
        <button class="btn-secondary btn-compact" id="btn-add-token">Add Token</button>
      </div>
      ${rows}
    </div>
  `;
}

function renderCosmosIbcTools(): string {
  const context = state.cosmosIbcContext;
  const routeOptions = context?.routes.length
    ? context.routes.map((route) => `<option value="${escapeHtml(route.id)}">${escapeHtml(route.label)}</option>`).join('')
    : '<option value="">No route presets for this network</option>';
  const traces = context?.denomTraces.length
    ? context.denomTraces.map((trace) => {
        const base = trace.baseDenom || 'unknown base denom';
        const path = trace.path || 'unknown path';
        const risk = trace.riskFlags.length ? trace.riskFlags.join('; ') : 'Trace resolved';
        return `<span class="muted">${escapeHtml(trace.denom)} -> ${escapeHtml(base)} via ${escapeHtml(path)} · ${escapeHtml(risk)}</span>`;
      }).join('')
    : '<span class="muted">No IBC denom traces detected in current balances</span>';
  const routeRisk = context?.routes.length
    ? context.routes.map((route) => `<span class="muted">${escapeHtml(route.destinationName)}: ${escapeHtml(route.riskFlags.join('; '))}</span>`).join('')
    : '<span class="muted">Route presets are advisory. Verify channel and receiver before broadcasting.</span>';
  return `
    <div class="status-card">
      <div class="token-card-header">
        <span>IBC route helper</span>
      </div>
      <label>Route preset
        <select id="send-cosmos-ibc-route" ${context?.routes.length ? '' : 'disabled'}>
          ${routeOptions}
        </select>
      </label>
      <label>Destination receiver
        <input type="text" id="send-cosmos-ibc-receiver" placeholder="Destination chain address" />
      </label>
      <button type="button" class="btn-secondary btn-compact" id="btn-cosmos-ibc-apply" ${context?.routes.length ? '' : 'disabled'}>Apply memo</button>
      <div class="stack-compact">${routeRisk}${traces}</div>
    </div>
  `;
}

function renderSend(): string {
  const sendUnavailableReason = getSendUnavailableReason();
  const metadata = currentChainUiMetadata();
  const supportsSmartContracts = metadata.capabilities.smartContracts;
  const sendDisabled = sendUnavailableReason !== '';
  return `
    <div class="view-form">
      <button class="btn-back" id="btn-back">← Back</button>
      <h2>Send ${escapeHtml(chainSymbol())}</h2>
      ${sendUnavailableReason ? `<div class="status-card status-card-warning">${escapeHtml(sendUnavailableReason)}</div>` : ''}
      <label>To Address (${escapeHtml(metadata.addressLabel)})
        <input type="text" id="send-to" placeholder="${escapeHtml(metadata.addressPlaceholder)}" value="${escapeHtml(state.sendTo)}" />
      </label>
      ${metadata.capabilities.utxo && isBitcoinAddressReuse(state.sendTo) ? `
        <div class="status-card status-card-warning">Recipient matches this wallet address. Reusing a Bitcoin address can reduce privacy; prefer a fresh receive address when possible.</div>
      ` : ''}
      <label>Amount (${escapeHtml(chainSymbol())})
        <input type="number" id="send-value" placeholder="0.0" step="any" min="0" value="${escapeHtml(state.sendValue)}" />
      </label>
      ${(state.network.kind ?? 'shell') === 'cosmos' ? `
        <label>Memo / IBC route memo
          <input type="text" id="send-cosmos-memo" placeholder='{"forward":{"receiver":"cosmos1...","channel":"channel-0"}}' value="${escapeHtml(state.sendCosmosMemo)}" />
        </label>
        ${renderCosmosIbcTools()}
      ` : ''}
      ${supportsSmartContracts ? `
        <label>Calldata (optional 0x...)
          <input type="text" id="send-data" placeholder="0x" value="${escapeHtml(state.sendData)}" />
        </label>
        <label>Gas Limit (optional)
          <input type="number" id="send-gas-limit" placeholder="21000" min="21000" value="${escapeHtml(state.sendGasLimit)}" />
        </label>
        <label>Max Fee Per Gas (optional, wei)
          <input type="number" id="send-max-fee" placeholder="1000000000" min="0" value="${escapeHtml(state.sendMaxFeePerGas)}" />
        </label>
        <label>Priority Fee (optional, wei)
          <input type="number" id="send-priority-fee" placeholder="100000000" min="0" value="${escapeHtml(state.sendMaxPriorityFeePerGas)}" />
        </label>
      ` : ''}
      ${metadata.capabilities.utxo ? `
        <label>Fee Priority
          <select id="send-fee-preset">
            ${renderBitcoinFeePresetOption('auto', 'Auto')}
            ${renderBitcoinFeePresetOption('slow', 'Slow - 2 sat/vB')}
            ${renderBitcoinFeePresetOption('normal', 'Normal - 5 sat/vB')}
            ${renderBitcoinFeePresetOption('fast', 'Fast - 10 sat/vB')}
            ${renderBitcoinFeePresetOption('custom', 'Custom')}
          </select>
        </label>
        <label>Custom Fee Rate (sat/vB)
          <input type="number" id="send-fee-rate" placeholder="Auto" step="1" min="1" value="${escapeHtml(state.sendBitcoinFeeRate)}" ${state.sendBitcoinFeePreset === 'custom' ? '' : 'disabled'} />
        </label>
      ` : ''}
      <div class="fee-info">
        <span class="label">${metadata.capabilities.accountNonce ? metadata.feeModel : 'Fee model:'}</span>
        <span class="fee-amount">${metadata.capabilities.accountNonce ? state.nonce == null ? 'unknown' : state.nonce : metadata.feeModel}</span>
      </div>
      ${metadata.capabilities.utxo ? renderBitcoinSendPreview() : ''}
      ${renderError()}
      <button id="btn-send-confirm" class="btn-primary" ${sendDisabled ? 'disabled' : ''}>
        ${sendDisabled ? 'Sending unavailable' : `Send ${escapeHtml(chainSymbol())}`}
      </button>
    </div>
  `;
}

function renderBitcoinSendPreview(): string {
  const preview = state.sendPreview;
  return `
    <div class="status-card">
      <div class="section-title">Bitcoin fee preview</div>
      ${preview ? `
        <div class="meta-grid">
          <span>Amount</span><strong>${escapeHtml(formatTokenDisplayValue(preview.amountSats, 8))} BTC</strong>
          <span>Miner fee</span><strong>${escapeHtml(formatTokenDisplayValue(preview.feeSats, 8))} BTC</strong>
          <span>Fee rate</span><strong>${escapeHtml(String(preview.feeRateSatVb))} sat/vB</strong>
          <span>Inputs</span><strong>${escapeHtml(String(preview.inputCount))}</strong>
          <span>Change</span><strong>${escapeHtml(formatTokenDisplayValue(preview.changeSats, 8))} BTC</strong>
          <span>Dust included in fee</span><strong>${escapeHtml(formatTokenDisplayValue(preview.dustSats, 8))} BTC</strong>
          <span>Estimated size</span><strong>${escapeHtml(String(preview.estimatedVbytes))} vB</strong>
          <span>RBF</span><strong>${preview.rbfEnabled ? 'Enabled' : 'Disabled'}</strong>
        </div>
        <div class="utxo-list">
          <div class="utxo-list-header">
            <div class="utxo-list-title">Coin control UTXOs</div>
            <select id="send-utxo-sort" class="utxo-sort">
              ${renderBitcoinUtxoSortOption('value-desc', 'Amount high')}
              ${renderBitcoinUtxoSortOption('value-asc', 'Amount low')}
              ${renderBitcoinUtxoSortOption('confirmed-first', 'Confirmed')}
              ${renderBitcoinUtxoSortOption('label', 'Label')}
            </select>
          </div>
          ${sortBitcoinInputs(preview.inputs, state.sendBitcoinUtxoSort, state.bitcoinUtxoPreferences).map((input) => {
            const key = bitcoinInputKey(input);
            const preference = getBitcoinUtxoPreference(key);
            const locked = preference?.locked === true;
            return `
            <div class="utxo-item ${locked ? 'utxo-item-locked' : ''}">
              <label class="checkbox-label">
                <input type="checkbox" class="send-bitcoin-input" data-input-key="${escapeHtml(key)}" ${isBitcoinInputSelected(input) ? 'checked' : ''} ${locked ? 'disabled' : ''} />
                <span class="monospace">${escapeHtml(truncate(input.txid, 8, 6))}:${escapeHtml(String(input.vout))}</span>
              </label>
              <strong>${escapeHtml(formatTokenDisplayValue(input.valueSats, 8))} BTC</strong>
              <div class="utxo-controls">
                <label class="utxo-label">
                  <span>Label</span>
                  <input type="text" class="utxo-label-input" data-input-key="${escapeHtml(key)}" maxlength="64" value="${escapeHtml(preference?.label ?? '')}" placeholder="No label" />
                </label>
                <label class="checkbox-label utxo-lock">
                  <input type="checkbox" class="utxo-lock-input" data-input-key="${escapeHtml(key)}" ${locked ? 'checked' : ''} />
                  Locked
                </label>
              </div>
              <em>${input.confirmed ? 'confirmed' : 'unconfirmed'}${locked ? ' · excluded until unlocked' : ''}</em>
            </div>
          `;
          }).join('')}
        </div>
        ${previewRequiresConfirmation(preview) ? `
          <label class="checkbox-label send-confirmation">
            <input type="checkbox" id="send-preview-confirm" ${state.sendPreviewConfirmed ? 'checked' : ''} />
            I reviewed the Bitcoin change and dust details for this transaction.
          </label>
        ` : ''}
      ` : '<div class="muted">Preview UTXO selection, miner fee, change, and dust before broadcasting.</div>'}
      <button id="btn-preview-send" class="btn-secondary">Preview Bitcoin fee</button>
    </div>
  `;
}

function renderBitcoinFeePresetOption(value: string, label: string): string {
  return `<option value="${escapeHtml(value)}" ${state.sendBitcoinFeePreset === value ? 'selected' : ''}>${escapeHtml(label)}</option>`;
}

function renderBitcoinUtxoSortOption(value: string, label: string): string {
  return `<option value="${escapeHtml(value)}" ${state.sendBitcoinUtxoSort === value ? 'selected' : ''}>${escapeHtml(label)}</option>`;
}

function renderBitcoinUtxoManager(): string {
  const filter = state.bitcoinUtxoFilter.trim().toLowerCase();
  const inputs = sortBitcoinInputs(state.bitcoinUtxoManagerInputs, state.sendBitcoinUtxoSort, state.bitcoinUtxoPreferences)
    .filter((input) => {
      if (!filter) return true;
      const key = bitcoinInputKey(input);
      const preference = getBitcoinUtxoPreference(key);
      return key.includes(filter) || (preference?.label ?? '').toLowerCase().includes(filter);
    });
  const rows = inputs.length
    ? inputs.map((input) => {
        const key = bitcoinInputKey(input);
        const preference = getBitcoinUtxoPreference(key);
        const locked = preference?.locked === true;
        return `
          <div class="utxo-item ${locked ? 'utxo-item-locked' : ''}">
            <label class="checkbox-label">
              <input type="checkbox" class="utxo-manager-select" data-input-key="${escapeHtml(key)}" />
              <span class="monospace">${escapeHtml(truncate(input.txid, 8, 6))}:${escapeHtml(String(input.vout))}</span>
            </label>
            <strong>${escapeHtml(formatTokenDisplayValue(input.valueSats, 8))} BTC</strong>
            <div class="utxo-controls">
              <label class="utxo-label">
                <span>Label</span>
                <input type="text" class="utxo-label-input" data-input-key="${escapeHtml(key)}" maxlength="64" value="${escapeHtml(preference?.label ?? '')}" placeholder="No label" />
              </label>
              <label class="checkbox-label utxo-lock">
                <input type="checkbox" class="utxo-lock-input" data-input-key="${escapeHtml(key)}" ${locked ? 'checked' : ''} />
                Locked
              </label>
            </div>
            <em>${input.confirmed ? 'confirmed' : 'unconfirmed'}${locked ? ' · excluded until unlocked' : ''}</em>
          </div>
        `;
      }).join('')
    : '<div class="empty-state compact-empty">No UTXOs match this filter</div>';
  return `
    <div class="view-form">
      <button class="btn-back" id="btn-back">← Back</button>
      <h2>Bitcoin UTXOs</h2>
      <div class="status-card">
        <div class="token-card-header">
          <span>Coin control manager</span>
          <button class="btn-secondary btn-compact" id="btn-utxo-refresh">Refresh</button>
        </div>
        <label>Filter by txid or label
          <input type="text" id="utxo-filter" value="${escapeHtml(state.bitcoinUtxoFilter)}" placeholder="savings, txid..." />
        </label>
        <div class="action-row compact-actions">
          <button type="button" class="btn-secondary btn-compact" id="btn-utxo-lock-selected">Lock selected</button>
          <button type="button" class="btn-secondary btn-compact" id="btn-utxo-unlock-selected">Unlock selected</button>
          <button type="button" class="btn-secondary btn-compact" id="btn-utxo-export-labels">Export labels</button>
          <button type="button" class="btn-secondary btn-compact" id="btn-utxo-import-labels">Import labels</button>
        </div>
        <textarea id="utxo-import-json" rows="3" placeholder='[{"key":"txid:vout","label":"savings","locked":true}]'></textarea>
      </div>
      <div class="utxo-list">${rows}</div>
      ${renderError()}
    </div>
  `;
}

export function resolveBitcoinFeePreset(preset: string, customValue: string): string {
  if (preset === 'slow') return '2';
  if (preset === 'normal') return '5';
  if (preset === 'fast') return '10';
  if (preset === 'custom') return customValue;
  return '';
}

function isBitcoinAddressReuse(to: string): boolean {
  return to.trim().toLowerCase() !== '' && to.trim().toLowerCase() === state.pqAddress.toLowerCase();
}

function renderAddToken(): string {
  const networkWarning = getNetworkWarning();
  const metadata = currentChainUiMetadata();
  const tokenStandard = metadata.tokenStandard ?? 'Token';
  const disabled = !metadata.capabilities.tokenTransfers || networkWarning !== '';
  return `
    <div class="view-form">
      <button class="btn-back" id="btn-back">← Back</button>
      <h2>Add ${escapeHtml(tokenStandard)} Token</h2>
      ${!metadata.capabilities.tokenTransfers ? `<div class="status-card status-card-warning">Switch to a network that supports ${escapeHtml(tokenStandard)} tokens.</div>` : ''}
      ${networkWarning ? `<div class="status-card status-card-warning">${escapeHtml(networkWarning)}</div>` : ''}
      <label>Contract Address
        <input type="text" id="token-contract" placeholder="${escapeHtml(metadata.addressPlaceholder)}" value="${escapeHtml(state.tokenAddAddress)}" />
      </label>
      ${renderError()}
      <button id="btn-add-token-confirm" class="btn-primary" ${disabled ? 'disabled' : ''}>Add Token</button>
    </div>
  `;
}

function renderSendToken(): string {
  const networkWarning = getNetworkWarning();
  const metadata = currentChainUiMetadata();
  const token = currentNetworkTokens().find((item) => item.contractAddress === state.tokenSendContract);
  const symbol = token?.symbol ?? state.tokenSendSymbol;
  const tokenStandard = metadata.tokenStandard ?? 'Token';
  const splStatus = metadata.tokenStandard === 'SPL' ? state.splRecipientStatus : null;
  const splAtaHtml = splStatus?.createRecipientAtaRequired ? `
    <div class="status-card status-card-warning">
      <div class="tx-detail-row"><span>Recipient ATA</span><span class="monospace">${escapeHtml(splStatus.expectedAssociatedTokenAccount)}</span></div>
      <div class="tx-detail-row"><span>Recipient owner</span><span class="monospace">${escapeHtml(splStatus.recipientOwnerAddress)}</span></div>
      <div class="tx-detail-row"><span>Mint</span><span class="monospace">${escapeHtml(splStatus.mintAddress)}</span></div>
      <div class="tx-detail-row"><span>Rent</span><span>${escapeHtml(formatTokenDisplayValue(splStatus.rentLamports ?? '0', 9))} SOL</span></div>
      <div class="tx-detail-row"><span>Extra instruction</span><span>${escapeHtml(splStatus.extraInstruction ?? 'Create Associated Token Account')}</span></div>
      <label class="checkbox-row">
        <input type="checkbox" id="spl-create-ata-confirm" />
        <span>Create recipient ATA and pay rent before sending</span>
      </label>
    </div>
  ` : splStatus ? `
    <div class="status-card">
      <div class="tx-detail-row"><span>Recipient token account</span><span class="monospace">${escapeHtml(splStatus.recipientTokenAccount ?? '')}</span></div>
    </div>
  ` : '';
  return `
    <div class="view-form">
      <button class="btn-back" id="btn-back">← Back</button>
      <h2>Send ${escapeHtml(symbol || tokenStandard)}</h2>
      ${networkWarning ? `<div class="status-card status-card-warning">${escapeHtml(networkWarning)}</div>` : ''}
      <label>To Address (${escapeHtml(metadata.addressLabel)})
        <input type="text" id="send-to" placeholder="${escapeHtml(metadata.addressPlaceholder)}" value="${escapeHtml(state.sendTo)}" />
      </label>
      <label>Amount (${escapeHtml(symbol || 'token')})
        <input type="number" id="send-value" placeholder="0.0" step="any" min="0" value="${escapeHtml(state.sendValue)}" />
      </label>
      <div class="fee-info">
        <span class="label">Fee model:</span>
        <span class="fee-amount">${escapeHtml(metadata.feeModel)}</span>
      </div>
      ${splAtaHtml}
      ${renderError()}
      <button id="btn-token-send-confirm" class="btn-primary" ${networkWarning ? 'disabled' : ''}>Send ${escapeHtml(symbol || 'Token')}</button>
    </div>
  `;
}

function renderReceive(): string {
  const metadata = currentChainUiMetadata();
  return `
    <div class="view-form">
      <button class="btn-back" id="btn-back">← Back</button>
      <h2>Receive ${escapeHtml(chainSymbol())}</h2>
      <p class="hint">${escapeHtml(metadata.receiveHint)}</p>
      <div class="qr-wrapper" style="display:flex;justify-content:center;margin:12px 0">
        <canvas id="qr-canvas"></canvas>
      </div>
      <label>${escapeHtml(metadata.addressLabel)}</label>
      <div class="address-box">
        <span class="monospace address-full" id="full-addr">${escapeHtml(state.pqAddress)}</span>
      </div>
      <button id="btn-copy-full" class="btn-primary">Copy Address</button>
    </div>
  `;
}

function renderHistory(): string {
  const txItems = state.txHistory.length > 0
    ? state.txHistory.map((tx) => {
        const isOutgoing = tx.from.toLowerCase() === state.pqAddress.toLowerCase();
        const readableType = formatTxHistoryType(tx);
        const isBatch = isAaBatchTx(tx);
        const isSponsored = !!tx.paymaster;
        const dir = readableType !== 'Transfer' ? readableType : (isOutgoing ? '↑ Sent' : '↓ Received');
        const val = isBatch ? '' : formatTxDisplayValue(tx);
        const hash = tx.txHash ? truncate(tx.txHash, 8, 6) : '–';
        const isExpanded = state.selectedTxHash === tx.txHash;
        const sponsoredBadge = isSponsored
          ? `<span class="badge badge-sponsored" title="Gas sponsored by paymaster">⚡ Sponsored</span>`
          : '';
        const explorerUrl = formatTxExplorerUrl(tx, state.network);
        const detail = isExpanded ? `
          <div class="tx-detail">
            <div class="tx-detail-row"><span>Hash</span><span class="monospace">${escapeHtml(tx.txHash ?? '–')}</span></div>
            <div class="tx-detail-row"><span>From</span><span class="monospace">${escapeHtml(truncate(tx.from, 10, 8))}</span></div>
            <div class="tx-detail-row"><span>To</span><span class="monospace">${escapeHtml(truncate(tx.to ?? '–', 10, 8))}</span></div>
            <div class="tx-detail-row"><span>Value</span><span>${escapeHtml(formatTxDisplayValue(tx))}</span></div>
            <div class="tx-detail-row"><span>Status</span><span>${escapeHtml(tx.status)}</span></div>
            ${tx.cosmosMemo ? `<div class="tx-detail-row"><span>Cosmos memo</span><span class="monospace">${escapeHtml(truncate(tx.cosmosMemo, 24, 12))}</span></div>` : ''}
            ${tx.chainKind === 'bitcoin' || tx.shellType === 'bitcoinTransfer' || tx.shellType === 'bitcoinCpfp' ? `
              <div class="tx-detail-row"><span>RBF</span><span>${tx.rbfEnabled ? 'Enabled' : 'Disabled/unknown'}</span></div>
              ${tx.bitcoinFeeRateSatVb ? `<div class="tx-detail-row"><span>Fee rate</span><span>${escapeHtml(String(tx.bitcoinFeeRateSatVb))} sat/vB</span></div>` : ''}
              ${tx.bitcoinFeeSats ? `<div class="tx-detail-row"><span>Fee</span><span>${escapeHtml(formatTokenDisplayValue(tx.bitcoinFeeSats, 8))} BTC</span></div>` : ''}
              ${tx.bitcoinVbytes ? `<div class="tx-detail-row"><span>Virtual size</span><span>${escapeHtml(String(tx.bitcoinVbytes))} vB</span></div>` : ''}
              ${tx.cpfpParentTxHash ? `<div class="tx-detail-row"><span>CPFP parent</span><span class="monospace">${escapeHtml(truncate(tx.cpfpParentTxHash, 8, 6))}</span></div>` : ''}
              ${tx.cpfpParentTxHashes?.length ? `<div class="tx-detail-row"><span>CPFP parents</span><span class="monospace">${escapeHtml(formatCpfpParents(tx.cpfpParentTxHashes))}</span></div>` : ''}
              ${tx.cpfpTargetFeeRateSatVb ? `<div class="tx-detail-row"><span>CPFP target</span><span>${escapeHtml(String(tx.cpfpTargetFeeRateSatVb))} sat/vB package</span></div>` : ''}
              ${tx.cpfpPackageFeeRateSatVb ? `<div class="tx-detail-row"><span>CPFP package</span><span>${escapeHtml(formatFeeRate(tx.cpfpPackageFeeRateSatVb))} sat/vB</span></div>` : ''}
              ${tx.cpfpAncestorCount != null ? `<div class="tx-detail-row"><span>CPFP ancestors</span><span>${escapeHtml(String(tx.cpfpAncestorCount))}</span></div>` : ''}
              ${tx.cpfpDescendantCount != null ? `<div class="tx-detail-row"><span>CPFP descendants</span><span>${escapeHtml(String(tx.cpfpDescendantCount))}</span></div>` : ''}
              ${canBumpBitcoinFee(tx) ? `<button class="btn-secondary btn-compact btn-bump-bitcoin-fee" data-txhash="${escapeHtml(tx.txHash)}">Bump fee</button>` : ''}
              ${canCpfpBitcoinTx(tx) ? `<button class="btn-secondary btn-compact btn-cpfp-bitcoin" data-txhash="${escapeHtml(tx.txHash)}">CPFP bump</button>` : ''}
            ` : ''}
            ${explorerUrl ? `<div class="tx-detail-row"><span>Explorer</span><a class="tx-explorer-link" href="${escapeHtml(explorerUrl)}" target="_blank" rel="noopener noreferrer">Open transaction</a></div>` : ''}
            ${tx.error ? `<div class="tx-detail-row tx-detail-error"><span>Error</span><span>${escapeHtml(tx.error)}</span></div>` : ''}
          </div>` : '';
        return `
          <div class="tx-item${isBatch ? ' tx-item-batch' : ''} tx-item-clickable" data-txhash="${escapeHtml(tx.txHash ?? '')}">
            <span class="tx-dir">${escapeHtml(dir)}</span>
            <span class="tx-hash monospace">${escapeHtml(hash)}</span>
            ${val ? `<span class="tx-value">${escapeHtml(val)}</span>` : ''}
            ${sponsoredBadge}
            <span class="tx-status ${escapeHtml(tx.status)}">${escapeHtml(tx.status)}</span>
            ${detail}
          </div>
        `;
      }).join('')
    : '<div class="empty-state">No transactions yet</div>';

  return `
    <div class="view-list">
      <div class="view-list-header">
        <button class="btn-back" id="btn-back">← Back</button>
        <h2>Transaction History</h2>
      </div>
      <div class="tx-list">${txItems}</div>
    </div>
  `;
}

function isAaBatchTx(tx: WalletTxRecord): boolean {
  return tx.shellType === 'aaBatch' || tx.txType === '0x7e';
}

export function formatTxHistoryType(tx: WalletTxRecord): string {
  const shellType = tx.shellType ?? tx.rewardKind;
  if (shellType === 'blockGasReward') return 'Block Reward';
  if (shellType === 'starkReward') return 'STARK Reward';
  if (isAaBatchTx(tx)) {
    return `⚡ Batch${tx.innerCallCount != null ? ` (${tx.innerCallCount} calls)` : ''}`;
  }
  if (shellType === 'contractCreate') return 'Contract Create';
  if (shellType === 'contractCall') return 'Contract Call';
  if (shellType === 'erc20Transfer') return 'ERC20 Transfer';
  if (shellType === 'trc20Transfer') return 'TRC20 Transfer';
  if (shellType === 'splTransfer') return 'SPL Transfer';
  if (shellType === 'jettonTransfer') return 'Jetton Transfer';
  if (shellType === 'tronTransfer') return 'TRX Transfer';
  if (shellType === 'solanaTransfer') return 'SOL Transfer';
  if (shellType === 'bitcoinTransfer') return 'BTC Transfer';
  if (shellType === 'bitcoinCpfp') return 'BTC CPFP';
  if (shellType === 'cosmosTransfer') return 'ATOM Transfer';
  if (shellType === 'tonTransfer') return 'TON Transfer';
  if (shellType === 'aptosTransfer') return 'APT Transfer';
  if (shellType === 'cosmosDelegate') return 'ATOM Delegate';
  if (shellType === 'cosmosUndelegate') return 'ATOM Undelegate';
  if (shellType === 'cosmosRedelegate') return 'ATOM Redelegate';
  if (shellType === 'cosmosWithdrawRewards') return 'ATOM Rewards';
  if (shellType === 'cosmosVote') return 'ATOM Vote';
  return 'Transfer';
}

export function formatTxHistoryLabel(tx: WalletTxRecord): string {
  const type = formatTxHistoryType(tx);
  if (type !== 'Transfer' && type !== 'TRX Transfer' && type !== 'TRC20 Transfer' && type !== 'ERC20 Transfer' && type !== 'SPL Transfer' && type !== 'Jetton Transfer' && type !== 'SOL Transfer' && type !== 'BTC Transfer' && type !== 'ATOM Transfer' && type !== 'ATOM Delegate' && type !== 'ATOM Undelegate' && type !== 'ATOM Redelegate' && type !== 'ATOM Vote' && type !== 'TON Transfer' && type !== 'APT Transfer') return type;
  return formatTxDisplayValue(tx);
}

export function formatTxExplorerUrl(tx: WalletTxRecord, network: Network): string | null {
  if (network.kind === 'bitcoin' && (tx.chainKind === 'bitcoin' || tx.shellType === 'bitcoinTransfer' || tx.shellType === 'bitcoinCpfp')) {
    if (!/^[0-9a-fA-F]{64}$/.test(tx.txHash)) return null;
    const isTestnet = network.chainId === 18332 || /\/testnet(\/|$)/i.test(network.rpcUrl);
    const base = isTestnet ? 'https://blockstream.info/testnet/tx' : 'https://blockstream.info/tx';
    return `${base}/${tx.txHash.toLowerCase()}`;
  }
  if (network.kind === 'aptos' && (tx.chainKind === 'aptos' || tx.shellType === 'aptosTransfer')) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(tx.txHash)) return null;
    const networkParam = network.chainId === 35 ? 'devnet' : network.chainId === 2 ? 'testnet' : 'mainnet';
    return `https://explorer.aptoslabs.com/txn/${tx.txHash.toLowerCase()}?network=${networkParam}`;
  }
  return null;
}

export function canBumpBitcoinFee(tx: WalletTxRecord): boolean {
  return (
    (tx.chainKind === 'bitcoin' || tx.shellType === 'bitcoinTransfer') &&
    tx.status === 'pending' &&
    tx.source === 'local' &&
    tx.rbfEnabled === true &&
    Array.isArray(tx.bitcoinInputs) &&
    tx.bitcoinInputs.length > 0
  );
}

export function canCpfpBitcoinTx(tx: WalletTxRecord): boolean {
  return (
    (tx.chainKind === 'bitcoin' || tx.shellType === 'bitcoinTransfer') &&
    tx.status === 'pending' &&
    tx.source === 'remote' &&
    tx.bitcoinCpfpInput != null &&
    tx.bitcoinCpfpInput.confirmed === false
  );
}

function formatTxDisplayValue(tx: WalletTxRecord): string {
  if (tx.shellType === 'trc20Transfer' || tx.shellType === 'erc20Transfer' || tx.shellType === 'splTransfer' || tx.shellType === 'jettonTransfer') {
    return `${formatTokenDisplayValue(tx.value, tx.tokenDecimals ?? 0)} ${tx.tokenSymbol ?? fallbackTokenSymbol(tx.shellType)}`;
  }
  if (tx.shellType === 'cosmosVote') {
    return `Proposal #${tx.value} ${formatCosmosVoterVote(tx.data ?? '', '')}`;
  }
  const nativeMetadata = tx.chainKind ? CHAIN_UI_METADATA[tx.chainKind] : null;
  if (
    tx.shellType === 'tronTransfer' ||
    tx.shellType === 'solanaTransfer' ||
    tx.shellType === 'bitcoinTransfer' ||
    tx.shellType === 'bitcoinCpfp' ||
    tx.shellType === 'cosmosTransfer' ||
    tx.shellType === 'tonTransfer' ||
    tx.shellType === 'aptosTransfer' ||
    tx.shellType === 'cosmosDelegate' ||
    tx.shellType === 'cosmosUndelegate' ||
    tx.chainKind === 'tron' ||
    tx.chainKind === 'solana' ||
    tx.chainKind === 'bitcoin' ||
    tx.chainKind === 'cosmos' ||
    tx.chainKind === 'ton' ||
    tx.chainKind === 'aptos'
  ) {
    const metadata = nativeMetadata ?? currentChainUiMetadata();
    const symbol = tx.shellType === 'cosmosTransfer' ? tx.tokenSymbol ?? metadata.symbol : metadata.symbol;
    const decimals = tx.shellType === 'cosmosTransfer' ? tx.tokenDecimals ?? metadata.decimals : metadata.decimals;
    return `${formatTokenDisplayValue(tx.value, decimals)} ${symbol}`;
  }
  return `${formatDisplayValue(tx.value)} SHELL`;
}

function fallbackTokenSymbol(shellType: string | null | undefined): string {
  if (shellType === 'erc20Transfer') return 'ERC20';
  if (shellType === 'splTransfer') return 'SPL';
  if (shellType === 'jettonTransfer') return 'JETTON';
  return 'TRC20';
}

function formatTokenDisplayValue(value: string, decimals: number): string {
  try {
    const raw = BigInt(value);
    if (decimals <= 0) return raw.toString();
    const scale = 10n ** BigInt(decimals);
    const whole = raw / scale;
    const fraction = (raw % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole.toString();
  } catch {
    return value;
  }
}

function formatFeeRate(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatCpfpParents(txHashes: string[]): string {
  const visible = txHashes.slice(0, 2).map((hash) => truncate(hash, 8, 6)).join(', ');
  return txHashes.length > 2 ? `${visible}, +${txHashes.length - 2}` : visible;
}

function renderAccounts(): string {
  const accountsHtml = state.accounts.map((acct, i) => {
    const isActive = acct.pqAddress === state.pqAddress;
    return `
      <div class="account-item${isActive ? ' account-item-active' : ''}">
        <div class="account-item-info">
          <span class="account-label">Account ${i + 1}</span>
          <span class="monospace account-address">${escapeHtml(truncate(acct.pqAddress))}</span>
          ${isActive ? '<span class="badge badge-active">Active</span>' : ''}
        </div>
        <div class="account-item-actions">
          ${!isActive
            ? `<button class="btn-secondary btn-switch-account" data-address="${escapeHtml(acct.pqAddress)}">Switch</button>`
            : ''}
          <button class="btn-secondary btn-copy-account" data-address="${escapeHtml(acct.pqAddress)}">Copy</button>
        </div>
      </div>
    `;
  }).join('');
  return `
    <div class="view-form">
      <button class="btn-back" id="btn-back">← Back</button>
      <h2>Accounts</h2>
      <div class="account-list">${accountsHtml}</div>
      <button id="btn-add-account" class="btn-secondary" style="margin-top:16px">+ Add Account</button>
      ${renderError()}
    </div>
  `;
}

function renderAddAccount(): string {
  return `
    <div class="view-form">
      <button class="btn-back" id="btn-back">← Back</button>
      <h2>Add Account</h2>
      <p class="hint">Set a password to protect this account's keystore. You will need it to switch to this account.</p>
      <label>Password
        <input type="password" id="add-account-pwd1" placeholder="Password (min 8 chars)" autocomplete="new-password" />
      </label>
      <label>Confirm Password
        <input type="password" id="add-account-pwd2" placeholder="Confirm password" autocomplete="new-password" />
      </label>
      ${renderError()}
      <button id="btn-add-account-confirm" class="btn-primary">Generate Account</button>
    </div>
  `;
}

function renderAddAccountGenerating(): string {
  return `<div class="center"><div class="spinner"></div><p>Generating new account…</p></div>`;
}

function renderSwitchAccount(): string {
  return `
    <div class="view-form">
      <button class="btn-back" id="btn-back">← Back</button>
      <h2>Switch Account</h2>
      <p class="hint">Enter the password for this account:</p>
      <div class="address-box" style="margin-bottom:12px">
        <span class="monospace">${escapeHtml(truncate(state.switchTargetAddress))}</span>
      </div>
      <label>Password
        <input type="password" id="switch-account-pwd" placeholder="Account password" autocomplete="current-password" autofocus />
      </label>
      ${renderError()}
      <button id="btn-switch-account-confirm" class="btn-primary">Switch</button>
    </div>
  `;
}

function renderSettings(): string {
  const connectedSitesHtml = state.connectedSites.length > 0
    ? state.connectedSites.map((site) => `
        <div class="site-item">
          <div class="site-item-main">
            <div class="site-origin">${escapeHtml(site.origin)}</div>
            <div class="site-meta">
              <span>${escapeHtml(site.accounts.length > 0 ? truncate(site.accounts[0], 8, 6) : 'No accounts')}</span>
              <span>Chain ${site.chainId}</span>
            </div>
          </div>
          <button class="btn-secondary btn-site-revoke" data-origin="${escapeHtml(site.origin)}">Revoke</button>
        </div>
      `).join('')
    : '<div class="empty-state compact-empty">No connected dApps yet</div>';
  const walletConnectPairingsHtml = state.walletConnectPairings.length > 0
    ? state.walletConnectPairings.map((pairing) => `
        <div class="site-item">
          <div class="site-item-main">
            <div class="site-origin">${escapeHtml(truncate(pairing.topic, 10, 8))}</div>
            <div class="site-meta">
              <span>${escapeHtml(pairing.relayProtocol)}</span>
              <span>Expires ${escapeHtml(formatWalletConnectExpiry(pairing.expiresAt))}</span>
            </div>
          </div>
          <button class="btn-secondary btn-wc-pairing-remove" data-topic="${escapeHtml(pairing.topic)}">Remove</button>
        </div>
      `).join('')
    : '<div class="empty-state compact-empty">No WalletConnect pairings yet</div>';
  const relayStatus = state.walletConnectRelayStatus;
  const relayStatusHtml = `
    <div class="status-card ${relayStatus?.lastError ? 'status-card-error' : relayStatus?.initialized ? 'status-card-success' : ''}">
      <div>${relayStatus?.initialized ? 'Relay ready' : 'Relay not initialized'}</div>
      <div class="site-meta" style="margin-top:6px">
        <span>${relayStatus?.projectIdConfigured ? 'Project ID set' : 'Project ID empty'}</span>
        <span>${escapeHtml(relayStatus?.relayUrl || 'default relay')}</span>
      </div>
      ${relayStatus?.lastError ? `<div class="hint" style="margin-top:6px">${escapeHtml(relayStatus.lastError)}</div>` : ''}
    </div>
  `;
  return `
    <div class="view-form">
      <button class="btn-back" id="btn-back">← Back</button>
      <h2>Settings</h2>

      <div class="section-title">Network</div>
      <select id="network-select" class="select-input">
        ${renderNetworkOptions()}
        <option value="custom">Custom RPC…</option>
      </select>
      <div id="custom-rpc-section" style="display:none">
        <label>Chain ID
          <input type="number" id="custom-chain-id" placeholder="424242" />
        </label>
        <label>RPC URL
          <input type="text" id="custom-rpc-url" placeholder="http://127.0.0.1:8545" />
        </label>
        <label>Network Name
          <input type="text" id="custom-net-name" placeholder="My Network" />
        </label>
        <button id="btn-save-custom" class="btn-secondary">Save Custom RPC</button>
      </div>

      <div class="section-title" style="margin-top:16px">Security</div>
      <label>Auto-lock (minutes, 0 = disabled)
        <input type="number" id="auto-lock-minutes" min="0" value="${escapeHtml(state.autoLockMinutes)}" />
      </label>
      <button id="btn-save-auto-lock" class="btn-secondary">Save Auto-lock</button>
      <button id="btn-export-ks" class="btn-secondary">Export Keystore</button>
      <button id="btn-reveal-phrase" class="btn-secondary">Reveal Recovery Phrase</button>
      <button id="btn-advanced-pq" class="btn-secondary">Advanced PQ</button>
      <button id="btn-reset" class="btn-danger">Reset Wallet</button>

      <div class="section-title" style="margin-top:16px">Connected dApps</div>
      <div class="site-list">${connectedSitesHtml}</div>

      <div class="section-title" style="margin-top:16px">WalletConnect</div>
      ${relayStatusHtml}
      <label>Project ID
        <input type="text" id="wc-project-id" placeholder="WalletConnect Project ID" value="${escapeHtml(state.walletConnectProjectId)}" />
      </label>
      <label>Relay URL
        <input type="text" id="wc-relay-url" placeholder="wss://relay.walletconnect.com" value="${escapeHtml(state.walletConnectRelayUrl)}" />
      </label>
      <button id="btn-save-wc-config" class="btn-secondary">Save WalletConnect</button>
      <label>Pairing URI
        <input type="text" id="wc-pairing-uri" placeholder="wc:topic@2?relay-protocol=irn&symKey=…" value="${escapeHtml(state.walletConnectUri)}" />
      </label>
      <button id="btn-wc-pair" class="btn-secondary">Pair WalletConnect</button>
      <div class="site-list">${walletConnectPairingsHtml}</div>
    </div>
  `;
}

function renderAdvancedPq(): string {
  const resultHtml = state.sessionAuthJson
    ? `
      <div class="section-title" style="margin-top:16px">Session Authorization</div>
      <textarea id="session-auth-json" rows="10" readonly>${escapeHtml(state.sessionAuthJson)}</textarea>
      <button id="btn-copy-session-auth" class="btn-secondary">Copy Session Auth</button>
    `
    : '';
  return `
    <div class="view-form">
      <button class="btn-back" id="btn-back">← Back</button>
      <h2>Advanced PQ</h2>
      <p class="hint">Authorize a deterministic HD session key for bounded AA/paymaster workflows.</p>

      <div class="section-title">Session Key</div>
      <label>Password
        <input type="password" id="session-password" placeholder="Wallet password" autocomplete="current-password" value="${escapeHtml(state.sessionPassword)}" />
      </label>
      <label>Root Account Index
        <input type="number" id="session-root-index" min="0" step="1" value="${escapeHtml(state.sessionRootAccountIndex)}" />
      </label>
      <label>Session Index
        <input type="number" id="session-index" min="0" step="1" value="${escapeHtml(state.sessionIndex)}" />
      </label>
      <label>Expiry Block
        <input type="number" id="session-expiry" min="1" step="1" placeholder="e.g. 430000" value="${escapeHtml(state.sessionExpiryBlock)}" />
      </label>
      <label>Value Cap (wei)
        <input type="text" id="session-value-cap" inputmode="numeric" placeholder="0" value="${escapeHtml(state.sessionValueCap)}" />
      </label>
      <label>Target Address (optional)
        <input type="text" id="session-target" placeholder="0x… or empty" value="${escapeHtml(state.sessionTarget)}" />
      </label>
      <label>Transaction Signing Hash (optional)
        <input type="text" id="session-tx-hash" placeholder="0x + 32 bytes, optional" value="${escapeHtml(state.sessionTxSigningHash)}" />
      </label>
      ${renderError()}
      <button id="btn-authorize-session" class="btn-primary">Authorize Session Key</button>
      ${resultHtml}

      <div class="section-title" style="margin-top:16px">Key Rotation</div>
      <p class="hint">Submit an AccountManager key-rotation transaction. The wallet activates the new local keystore only after the transaction confirms.</p>
      <label>Password
        <input type="password" id="rotate-password" placeholder="Wallet password" autocomplete="current-password" value="${escapeHtml(state.rotatePassword)}" />
      </label>
      <button id="btn-rotate-key" class="btn-secondary">Rotate Active Key</button>
      ${state.pendingRotationTxHash
        ? `<div class="status-card status-card-warning">Pending rotation: <span class="monospace">${escapeHtml(truncate(state.pendingRotationTxHash, 10, 8))}</span></div>`
        : ''}
    </div>
  `;
}

export function summarizeCosmosValidatorRisk(validator: CosmosValidatorSummary): { level: string; guidance: string } {
  const flags = new Set(validator.riskFlags);
  if (flags.has('tombstoned')) {
    return { level: 'Critical', guidance: 'do not delegate; validator is permanently slashed' };
  }
  if (flags.has('jailed') || validator.jailed) {
    return { level: 'Critical', guidance: 'do not delegate until unjailed and bonded' };
  }
  if (flags.has('not bonded') || validator.status !== 'BOND_STATUS_BONDED') {
    return { level: 'High', guidance: 'avoid new delegation until validator is bonded' };
  }
  if (flags.has('missed blocks')) {
    return { level: 'Warning', guidance: 'review signing reliability before delegating' };
  }
  if (flags.has('high commission') || flags.has('high max commission') || flags.has('high daily commission change')) {
    return { level: 'Warning', guidance: 'review commission terms before delegating' };
  }
  if (flags.has('low self delegation')) {
    return { level: 'Caution', guidance: 'validator has low economic self-alignment' };
  }
  return { level: 'OK', guidance: 'bonded with no detected slashing or commission warnings' };
}

function renderApprovalRequest(): string {
  const request = state.approvalRequest;
  if (!request) {
    return `
      <div class="center">
        <h2>Approval not found</h2>
        <p class="hint">This approval request may have expired.</p>
      </div>
    `;
  }

  // Detect AA batch transaction (tx_type = 0x7e)
  const isBatchTx = request.kind === 'send-transaction' &&
    (request.payload.tx_type === '0x7e' || request.payload.tx_type === 126);

  let detailsHtml: string;

  if (isBatchTx) {
    const innerCalls = Array.isArray(request.payload.inner_calls)
      ? (request.payload.inner_calls as AaBatchInnerCall[])
      : [];
    const paymaster = request.payload.paymaster as string | null | undefined;
    const isSponsored = !!paymaster;

    const callsHtml = innerCalls.length > 0
      ? innerCalls.map((call, i) => `
          <div class="inner-call-item">
            <div class="inner-call-index">#${i + 1}</div>
            <div class="approval-row">
              <span class="approval-key">To</span>
              <span class="approval-value monospace">${escapeHtml(call.to)}</span>
            </div>
            <div class="approval-row">
              <span class="approval-key">Value</span>
              <span class="approval-value">${escapeHtml(formatDisplayValue(call.value || '0'))} SHELL</span>
            </div>
            <div class="approval-row">
              <span class="approval-key">Gas</span>
              <span class="approval-value">${escapeHtml(call.gas_limit)}</span>
            </div>
            ${call.data && call.data !== '0x'
              ? `<div class="approval-row"><span class="approval-key">Data</span><span class="approval-value monospace" style="word-break:break-all">${escapeHtml(call.data.slice(0, 32))}…</span></div>`
              : ''}
          </div>
        `).join('')
      : '<div class="hint">No inner calls</div>';

    detailsHtml = `
      <div class="approval-card">
        <div class="batch-header">
          <span class="badge badge-batch">⚡ AA Batch (${innerCalls.length} call${innerCalls.length !== 1 ? 's' : ''})</span>
          ${isSponsored ? `<span class="badge badge-sponsored">⚡ Sponsored</span>` : ''}
        </div>
        ${isSponsored ? `<div class="approval-row"><span class="approval-key">Paymaster</span><span class="approval-value monospace">${escapeHtml(paymaster)}</span></div>` : ''}
        <div class="inner-calls-list">${callsHtml}</div>
      </div>
    `;
  } else if (request.kind === 'send-transaction') {
    const splStatus = request.payload.splRecipientStatus && typeof request.payload.splRecipientStatus === 'object'
      ? request.payload.splRecipientStatus as Partial<SplRecipientAccountStatus>
      : null;
    detailsHtml = `
      <div class="approval-card">
        <div class="approval-row">
          <span class="approval-key">Account</span>
          <span class="approval-value monospace">${escapeHtml(request.payload.account ?? '')}</span>
        </div>
        <div class="approval-row">
          <span class="approval-key">To</span>
          <span class="approval-value monospace">${escapeHtml(request.payload.to ?? '')}</span>
        </div>
        <div class="approval-row">
          <span class="approval-key">Value</span>
          <span class="approval-value monospace">${escapeHtml(request.payload.value ?? '0')}</span>
        </div>
        ${request.payload.tokenContract ? `
          <div class="approval-row">
            <span class="approval-key">Token</span>
            <span class="approval-value monospace">${escapeHtml(request.payload.tokenSymbol ?? request.payload.tokenContract)}</span>
          </div>
          <div class="approval-row">
            <span class="approval-key">Token contract</span>
            <span class="approval-value monospace">${escapeHtml(request.payload.tokenContract)}</span>
          </div>
        ` : ''}
        <div class="approval-row">
          <span class="approval-key">Chain</span>
          <span class="approval-value monospace">${escapeHtml(request.payload.chainKind ?? '')}:${escapeHtml(request.payload.chainId ?? '')}</span>
        </div>
        ${splStatus ? `
          <div class="approval-row">
            <span class="approval-key">Recipient ATA</span>
            <span class="approval-value monospace">${escapeHtml(splStatus.expectedAssociatedTokenAccount ?? '')}</span>
          </div>
          <div class="approval-row">
            <span class="approval-key">Recipient owner</span>
            <span class="approval-value monospace">${escapeHtml(splStatus.recipientOwnerAddress ?? '')}</span>
          </div>
          <div class="approval-row">
            <span class="approval-key">Mint</span>
            <span class="approval-value monospace">${escapeHtml(splStatus.mintAddress ?? '')}</span>
          </div>
          <div class="approval-row">
            <span class="approval-key">Rent</span>
            <span class="approval-value">${escapeHtml(formatTokenDisplayValue(String(splStatus.rentLamports ?? '0'), 9))} SOL</span>
          </div>
          <div class="approval-row">
            <span class="approval-key">Extra instruction</span>
            <span class="approval-value">${escapeHtml(splStatus.extraInstruction ?? 'Create Associated Token Account')}</span>
          </div>
        ` : ''}
      </div>
    `;
  } else if (request.kind === 'walletconnect-proposal') {
    const chainIds = Array.isArray(request.payload.chainIds) ? request.payload.chainIds : [];
    const methods = Array.isArray(request.payload.methods) ? request.payload.methods : [];
    const accounts = Array.isArray(request.payload.accounts) ? request.payload.accounts : [];
    detailsHtml = `
      <div class="approval-card">
        <div class="approval-row">
          <span class="approval-key">Topic</span>
          <span class="approval-value monospace">${escapeHtml(request.payload.topic ?? '')}</span>
        </div>
        <div class="approval-row">
          <span class="approval-key">Chains</span>
          <span class="approval-value monospace">${escapeHtml(chainIds.join(', '))}</span>
        </div>
        <div class="approval-row">
          <span class="approval-key">Methods</span>
          <span class="approval-value monospace">${escapeHtml(methods.join(', '))}</span>
        </div>
        <div class="approval-row">
          <span class="approval-key">Accounts</span>
          <span class="approval-value monospace">${escapeHtml(accounts.join(', '))}</span>
        </div>
      </div>
    `;
  } else if (request.kind === 'tonconnect-proposal') {
    const features = Array.isArray(request.payload.features)
      ? request.payload.features.map((feature) => {
          if (typeof feature === 'string') return feature;
          if (feature && typeof feature === 'object' && 'name' in feature) {
            const item = feature as { name?: unknown; maxMessages?: unknown; types?: unknown };
            const suffix = typeof item.maxMessages === 'number'
              ? ` (${item.maxMessages} messages)`
              : Array.isArray(item.types)
                ? ` (${item.types.filter((type): type is string => typeof type === 'string').join(', ')})`
                : '';
            return `${String(item.name ?? '')}${suffix}`;
          }
          return '';
        }).filter(Boolean)
      : [];
    const requestedItems = Array.isArray(request.payload.requestedItems) ? request.payload.requestedItems : [];
    detailsHtml = `
      <div class="approval-card">
        <div class="approval-row">
          <span class="approval-key">Client</span>
          <span class="approval-value monospace">${escapeHtml(request.payload.clientId ?? '')}</span>
        </div>
        <div class="approval-row">
          <span class="approval-key">Manifest</span>
          <span class="approval-value monospace">${escapeHtml(request.payload.manifestUrl ?? '')}</span>
        </div>
        <div class="approval-row">
          <span class="approval-key">Network</span>
          <span class="approval-value monospace">${escapeHtml(request.payload.network ?? '')} (${escapeHtml(request.payload.chainId ?? '')})</span>
        </div>
        <div class="approval-row">
          <span class="approval-key">Account</span>
          <span class="approval-value monospace">${escapeHtml(request.payload.account ?? '')}</span>
        </div>
        <div class="approval-row">
          <span class="approval-key">Features</span>
          <span class="approval-value monospace">${escapeHtml(features.join(', '))}</span>
        </div>
        ${requestedItems.length > 0 ? `
          <div class="approval-row">
            <span class="approval-key">Requests</span>
            <span class="approval-value monospace">${escapeHtml(requestedItems.join(', '))}</span>
          </div>
        ` : ''}
      </div>
    `;
  } else if (request.kind === 'tonconnect-request') {
    const messages = Array.isArray(request.payload.messages) ? request.payload.messages : [];
    const method = String(request.payload.method ?? 'sendTransaction');
    const messageRows = messages.map((message, i) => {
      const item = message && typeof message === 'object' ? message as Record<string, unknown> : {};
      return `
        <div class="inner-call-item">
          <div class="inner-call-index">#${i + 1}</div>
          <div class="approval-row">
            <span class="approval-key">To</span>
            <span class="approval-value monospace">${escapeHtml(item.to ?? '')}</span>
          </div>
          <div class="approval-row">
            <span class="approval-key">Amount</span>
            <span class="approval-value monospace">${escapeHtml(item.amountNanotons ?? '0')} nanotons</span>
          </div>
          ${item.hasPayload ? '<div class="approval-row"><span class="approval-key">Payload</span><span class="approval-value">Included</span></div>' : ''}
          ${item.hasStateInit ? '<div class="approval-row"><span class="approval-key">StateInit</span><span class="approval-value">Included</span></div>' : ''}
        </div>
      `;
    }).join('');
    detailsHtml = `
      <div class="approval-card">
        <div class="approval-row">
          <span class="approval-key">Client</span>
          <span class="approval-value monospace">${escapeHtml(request.payload.clientId ?? '')}</span>
        </div>
        <div class="approval-row">
          <span class="approval-key">Method</span>
          <span class="approval-value monospace">${escapeHtml(method)}</span>
        </div>
        <div class="approval-row">
          <span class="approval-key">Network</span>
          <span class="approval-value monospace">${escapeHtml(request.payload.network ?? '')} (${escapeHtml(request.payload.chainId ?? '')})</span>
        </div>
        <div class="approval-row">
          <span class="approval-key">Account</span>
          <span class="approval-value monospace">${escapeHtml(request.payload.account ?? '')}</span>
        </div>
        <div class="approval-row">
          <span class="approval-key">Valid Until</span>
          <span class="approval-value monospace">${escapeHtml(request.payload.validUntil ?? '')}</span>
        </div>
        ${messages.length > 0 ? `
          <div class="approval-row">
            <span class="approval-key">Total</span>
            <span class="approval-value monospace">${escapeHtml(request.payload.totalNanotons ?? '0')} nanotons</span>
          </div>
        ` : ''}
        ${request.payload.domain ? `
          <div class="approval-row">
            <span class="approval-key">Domain</span>
            <span class="approval-value monospace">${escapeHtml(request.payload.domain)}</span>
          </div>
        ` : ''}
        ${request.payload.timestamp ? `
          <div class="approval-row">
            <span class="approval-key">Timestamp</span>
            <span class="approval-value monospace">${escapeHtml(request.payload.timestamp)}</span>
          </div>
        ` : ''}
        ${request.payload.type ? `
          <div class="approval-row">
            <span class="approval-key">Type</span>
            <span class="approval-value monospace">${escapeHtml(request.payload.type)}</span>
          </div>
        ` : ''}
        ${request.payload.payload ? `
          <div class="approval-row">
            <span class="approval-key">Payload</span>
            <span class="approval-value monospace">${escapeHtml(request.payload.payload)}</span>
          </div>
        ` : ''}
        ${request.payload.schema ? `
          <div class="approval-row">
            <span class="approval-key">Schema</span>
            <span class="approval-value monospace">${escapeHtml(request.payload.schema)}</span>
          </div>
        ` : ''}
        ${messages.length > 0 ? `<div class="inner-calls-list">${messageRows}</div>` : ''}
      </div>
    `;
  } else if (request.kind === 'cosmos-sign-direct') {
    const messageDetails = Array.isArray(request.payload.messageDetails) ? request.payload.messageDetails : [];
    detailsHtml = `
      <div class="approval-card">
        <div class="approval-row">
          <span class="approval-key">Account</span>
          <span class="approval-value monospace">${escapeHtml(request.payload.account ?? '')}</span>
        </div>
        <div class="approval-row">
          <span class="approval-key">Chain ID</span>
          <span class="approval-value monospace">${escapeHtml(request.payload.chainId ?? '')}</span>
        </div>
        <div class="approval-row">
          <span class="approval-key">Account Number</span>
          <span class="approval-value monospace">${escapeHtml(request.payload.accountNumber ?? '')}</span>
        </div>
        <div class="approval-row">
          <span class="approval-key">Sign Mode</span>
          <span class="approval-value monospace">${escapeHtml(request.payload.signMode ?? '')}</span>
        </div>
        <div class="approval-row">
          <span class="approval-key">Messages</span>
          <span class="approval-value monospace">${escapeHtml(request.payload.messages ?? '')}</span>
        </div>
        ${messageDetails.map((entry) => `
          <div class="approval-row">
            <span class="approval-key">Message</span>
            <span class="approval-value monospace">${escapeHtml(entry)}</span>
          </div>
        `).join('')}
        <div class="approval-row">
          <span class="approval-key">Body</span>
          <span class="approval-value monospace">${escapeHtml(request.payload.bodyBytes ?? '')}</span>
        </div>
        <div class="approval-row">
          <span class="approval-key">Auth Info</span>
          <span class="approval-value monospace">${escapeHtml(request.payload.authInfoBytes ?? '')}</span>
        </div>
      </div>
    `;
  } else if (request.kind === 'cosmos-sign-amino') {
    const messageDetails = Array.isArray(request.payload.messageDetails) ? request.payload.messageDetails : [];
    detailsHtml = `
      <div class="approval-card">
        <div class="approval-row">
          <span class="approval-key">Account</span>
          <span class="approval-value monospace">${escapeHtml(request.payload.account ?? '')}</span>
        </div>
        <div class="approval-row">
          <span class="approval-key">Chain ID</span>
          <span class="approval-value monospace">${escapeHtml(request.payload.chainId ?? '')}</span>
        </div>
        <div class="approval-row">
          <span class="approval-key">Account Number</span>
          <span class="approval-value monospace">${escapeHtml(request.payload.accountNumber ?? '')}</span>
        </div>
        <div class="approval-row">
          <span class="approval-key">Sequence</span>
          <span class="approval-value monospace">${escapeHtml(request.payload.sequence ?? '')}</span>
        </div>
        <div class="approval-row">
          <span class="approval-key">Sign Mode</span>
          <span class="approval-value monospace">${escapeHtml(request.payload.signMode ?? '')}</span>
        </div>
        <div class="approval-row">
          <span class="approval-key">Fee</span>
          <span class="approval-value monospace">${escapeHtml(request.payload.fee ?? '')}</span>
        </div>
        <div class="approval-row">
          <span class="approval-key">Messages</span>
          <span class="approval-value monospace">${escapeHtml(request.payload.messages ?? '')}</span>
        </div>
        ${messageDetails.map((entry) => `
          <div class="approval-row">
            <span class="approval-key">Message</span>
            <span class="approval-value monospace">${escapeHtml(entry)}</span>
          </div>
        `).join('')}
        <div class="approval-row">
          <span class="approval-key">Memo</span>
          <span class="approval-value monospace">${escapeHtml(request.payload.memo ?? '')}</span>
        </div>
      </div>
    `;
  } else if (request.kind === 'aptos-sign-transaction') {
    detailsHtml = renderAptosApprovalPayload(request.payload);
  } else if (request.kind === 'add-chain' || request.kind === 'switch-chain') {
    // WALLET-H2: for chain operations, always show chain ID, network name, and
    // RPC URL host prominently so users can spot a malicious RPC endpoint.
    const rpcUrl = typeof request.payload.rpcUrl === 'string' ? request.payload.rpcUrl : '';
    let rpcHost = rpcUrl;
    try { rpcHost = new URL(rpcUrl).host; } catch { /* keep raw value */ }
    detailsHtml = `
      <div class="approval-card">
        <div class="approval-row">
          <span class="approval-key">Network</span>
          <span class="approval-value">${escapeHtml(request.payload.networkName ?? '')}</span>
        </div>
        <div class="approval-row">
          <span class="approval-key">Chain ID</span>
          <span class="approval-value monospace">${escapeHtml(request.payload.chainId ?? '')}</span>
        </div>
        <div class="approval-row">
          <span class="approval-key">RPC Host</span>
          <span class="approval-value monospace" style="font-weight:bold">${escapeHtml(rpcHost)}</span>
        </div>
        <div class="approval-row">
          <span class="approval-key">Requesting site</span>
          <span class="approval-value monospace">${escapeHtml(request.origin)}</span>
        </div>
      </div>
    `;
  } else {
    detailsHtml = `
      <div class="approval-card">
        ${Object.entries(request.payload)
          .map(([key, value]) => `
            <div class="approval-row">
              <span class="approval-key">${escapeHtml(key)}</span>
              <span class="approval-value monospace">${escapeHtml(formatApprovalValue(value))}</span>
            </div>
          `)
          .join('')}
      </div>
    `;
  }

  return `
    <div class="view-form">
      <div class="logo">🛡️</div>
      <h2>Approve Request</h2>
      <p class="hint">${escapeHtml(request.origin)}</p>
      <div class="status-card status-card-warning">This site is requesting: <strong>${escapeHtml(request.kind)}</strong></div>
      ${detailsHtml}
      ${renderError()}
      <button id="btn-approval-approve" class="btn-primary">Approve</button>
      <button id="btn-approval-reject" class="btn-secondary">Reject</button>
    </div>
  `;
}

export function renderAptosApprovalPayload(payload: Record<string, unknown>): string {
  const typeArguments = Array.isArray(payload.typeArguments) ? payload.typeArguments : [];
  const argumentsSummary = Array.isArray(payload.argumentsSummary) ? payload.argumentsSummary : [];
  const riskFlags = Array.isArray(payload.riskFlags) ? payload.riskFlags : [];
  const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
  return `
    <div class="approval-card">
      <div class="approval-row">
        <span class="approval-key">Account</span>
        <span class="approval-value monospace">${escapeHtml(payload.account ?? '')}</span>
      </div>
      <div class="approval-row">
        <span class="approval-key">Chain</span>
        <span class="approval-value monospace">${escapeHtml(payload.chainId ?? '')}</span>
      </div>
      <div class="approval-row">
        <span class="approval-key">Payload type</span>
        <span class="approval-value monospace">${escapeHtml(payload.type ?? '')}</span>
      </div>
      <div class="approval-row">
        <span class="approval-key">Action</span>
        <span class="approval-value monospace">${escapeHtml(payload.knownAction ?? 'unknown')}</span>
      </div>
      <div class="approval-row">
        <span class="approval-key">Risk</span>
        <span class="approval-value monospace">${escapeHtml(payload.riskLevel ?? 'unknown')}</span>
      </div>
      <div class="approval-row">
        <span class="approval-key">Risk summary</span>
        <span class="approval-value">${escapeHtml(payload.riskSummary ?? '')}</span>
      </div>
      <div class="approval-row">
        <span class="approval-key">Function</span>
        <span class="approval-value monospace">${escapeHtml(payload.functionId ?? '')}</span>
      </div>
      <div class="approval-row">
        <span class="approval-key">Module</span>
        <span class="approval-value monospace">${escapeHtml(payload.moduleAddress ?? '')}::${escapeHtml(payload.moduleName ?? '')}</span>
      </div>
      ${payload.recipient ? `
        <div class="approval-row">
          <span class="approval-key">Recipient</span>
          <span class="approval-value monospace">${escapeHtml(payload.recipient)}</span>
        </div>
      ` : ''}
      ${payload.amountOctas ? `
        <div class="approval-row">
          <span class="approval-key">Amount</span>
          <span class="approval-value monospace">${escapeHtml(payload.amountOctas)} octas</span>
        </div>
      ` : ''}
      ${typeArguments.length > 0 ? `
        <div class="approval-row">
          <span class="approval-key">Type args</span>
          <span class="approval-value monospace">${escapeHtml(typeArguments.join(', '))}</span>
        </div>
      ` : ''}
      ${argumentsSummary.map((entry, index) => `
        <div class="approval-row">
          <span class="approval-key">Arg #${index + 1}</span>
          <span class="approval-value monospace">${escapeHtml(entry)}</span>
        </div>
      `).join('')}
      ${riskFlags.length > 0 ? `
        <div class="approval-row">
          <span class="approval-key">Risk flags</span>
          <span class="approval-value monospace">${escapeHtml(riskFlags.join(', '))}</span>
        </div>
      ` : ''}
      ${warnings.map((entry) => `
        <div class="approval-row">
          <span class="approval-key">Warning</span>
          <span class="approval-value">${escapeHtml(entry)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

// ────────── Event handlers ──────────

function attachHandlers(): void {
  const on = (id: string, ev: string, fn: EventListener) => {
    document.getElementById(id)?.addEventListener(ev, fn);
  };

  on('btn-create', 'click', () => {
    state.error = '';
    state.view = 'create-password';
    render();
  });

  on('btn-create-hd', 'click', async () => {
    state.error = '';
    state.view = 'create-generating';
    render();
    try {
      const res = await send<{ mnemonic: string }>('GENERATE_MNEMONIC');
      state.pendingMnemonic = res.mnemonic;
      state.view = 'hd-show-phrase';
      render();
    } catch (err) {
      state.error = (err as Error).message;
      state.view = 'welcome';
      render();
    }
  });

  on('btn-restore-hd', 'click', () => {
    state.error = '';
    state.pendingMnemonic = '';
    state.view = 'hd-restore-phrase';
    render();
  });

  on('btn-hd-phrase-next', 'click', () => {
    state.error = '';
    state.view = 'hd-confirm-phrase';
    render();
  });

  on('btn-hd-confirm-next', 'click', () => {
    const checked = (document.getElementById('hd-confirm-check') as HTMLInputElement)?.checked;
    if (!checked) {
      state.error = 'Please confirm you have backed up your recovery phrase.';
      render();
      return;
    }
    state.error = '';
    state.view = 'hd-create-password';
    render();
  });

  on('btn-hd-create-confirm', 'click', async () => {
    const pwd1 = (document.getElementById('hd-pwd1') as HTMLInputElement)?.value;
    const pwd2 = (document.getElementById('hd-pwd2') as HTMLInputElement)?.value;
    if (!pwd1 || pwd1.length < 8) {
      state.error = 'Password must be at least 8 characters';
      render();
      return;
    }
    if (pwd1 !== pwd2) {
      state.error = 'Passwords do not match';
      render();
      return;
    }
    state.error = '';
    state.view = 'hd-creating';
    render();
    try {
      const res = await send<{ pqAddress: string }>('CREATE_HD_WALLET', {
        mnemonic: state.pendingMnemonic,
        password: pwd1,
      });
      state.pendingMnemonic = '';
      state.pqAddress = res.pqAddress;
      state.view = 'create-success';
      render();
    } catch (err) {
      state.error = (err as Error).message;
      state.view = 'hd-create-password';
      render();
    }
  });

  on('btn-hd-restore-phrase-next', 'click', () => {
    const phrase = ((document.getElementById('hd-restore-phrase-input') as HTMLTextAreaElement)?.value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    const wordCount = phrase.split(' ').length;
    if (wordCount !== 12 && wordCount !== 24) {
      state.error = 'Recovery phrase must be 12 or 24 words.';
      render();
      return;
    }
    state.error = '';
    state.pendingMnemonic = phrase;
    state.view = 'hd-restore-password';
    render();
  });

  on('btn-hd-restore-confirm', 'click', async () => {
    const pwd1 = (document.getElementById('hd-restore-pwd1') as HTMLInputElement)?.value;
    const pwd2 = (document.getElementById('hd-restore-pwd2') as HTMLInputElement)?.value;
    if (!pwd1 || pwd1.length < 8) {
      state.error = 'Password must be at least 8 characters';
      render();
      return;
    }
    if (pwd1 !== pwd2) {
      state.error = 'Passwords do not match';
      render();
      return;
    }
    state.error = '';
    state.view = 'hd-restoring';
    render();
    try {
      const res = await send<{ pqAddress: string }>('RESTORE_HD_WALLET', {
        mnemonic: state.pendingMnemonic,
        password: pwd1,
      });
      state.pendingMnemonic = '';
      state.pqAddress = res.pqAddress;
      await refreshWalletData();
      state.view = 'wallet';
      render();
      showToast('Wallet restored successfully');
    } catch (err) {
      state.error = (err as Error).message;
      state.view = 'hd-restore-password';
      render();
    }
  });

  on('btn-reveal-phrase', 'click', () => {
    state.error = '';
    state.revealedMnemonic = '';
    state.view = 'reveal-phrase';
    render();
  });

  on('btn-reveal-phrase-confirm', 'click', async () => {
    const pwd = (document.getElementById('reveal-phrase-pwd') as HTMLInputElement)?.value;
    if (!pwd) return;
    state.error = '';
    try {
      const res = await send<{ mnemonic: string }>('REVEAL_MNEMONIC', { password: pwd });
      state.revealedMnemonic = res.mnemonic;
      state.view = 'reveal-phrase-confirm';
      render();
    } catch (err) {
      state.error = (err as Error).message;
      render();
    }
  });

  on('btn-back-from-phrase', 'click', () => {
    state.revealedMnemonic = '';
    state.view = 'settings';
    render();
  });

  on('btn-import', 'click', () => {
    state.error = '';
    state.view = 'import-file';
    render();
  });

  on('btn-back', 'click', () => {
    state.error = '';
    const backMap: Partial<Record<View, View>> = {
      'create-password': 'welcome',
      'hd-show-phrase': 'welcome',
      'hd-confirm-phrase': 'hd-show-phrase',
      'hd-create-password': 'hd-confirm-phrase',
      'hd-restore-phrase': 'welcome',
      'hd-restore-password': 'hd-restore-phrase',
      'reveal-phrase': 'settings',
      'import-file': 'welcome',
      'import-password': 'import-file',
      send: 'wallet',
      'add-token': 'wallet',
      'send-token': 'wallet',
      receive: 'wallet',
      history: 'wallet',
      settings: 'wallet',
      accounts: 'wallet',
      'add-account': 'accounts',
      'switch-account': 'accounts',
      'advanced-pq': 'settings',
    };
    state.view = backMap[state.view] ?? 'wallet';
    render();
  });

  on('btn-confirm-pwd', 'click', async () => {
    const pwd1 = (document.getElementById('pwd1') as HTMLInputElement)?.value;
    const pwd2 = (document.getElementById('pwd2') as HTMLInputElement)?.value;
    if (!pwd1 || pwd1.length < 8) {
      state.error = 'Password must be at least 8 characters';
      render();
      return;
    }
    if (pwd1 !== pwd2) {
      state.error = 'Passwords do not match';
      render();
      return;
    }
    state.error = '';
    state.view = 'create-generating';
    render();
    try {
      const res = await send<{ pqAddress: string }>('CREATE_WALLET', {
        password: pwd1,
      });
      state.pqAddress = res.pqAddress;
      state.view = 'create-success';
      render();
    } catch (err) {
      state.error = (err as Error).message;
      state.view = 'create-password';
      render();
    }
  });

  on('btn-goto-wallet', 'click', async () => {
    await refreshWalletData();
    state.view = 'wallet';
    render();
  });

  // File import
  const fileInput = document.getElementById('ks-file') as HTMLInputElement | null;
  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const json = e.target?.result as string;
          JSON.parse(json); // validate
          state.pendingKeystoreJson = json;
          state.error = '';
          state.view = 'import-password';
          render();
        } catch {
          state.error = 'Invalid keystore file';
          render();
        }
      };
      reader.readAsText(file);
    });
  }

  on('btn-confirm-import', 'click', async () => {
    const pwd = (document.getElementById('import-pwd') as HTMLInputElement)?.value;
    if (!pwd) {
      state.error = 'Enter the keystore password';
      render();
      return;
    }
    state.error = '';
    state.view = 'create-generating';
    render();
    try {
      const res = await send<{ pqAddress: string }>('IMPORT_KEYSTORE', {
        keystoreJson: state.pendingKeystoreJson,
        password: pwd,
      });
      state.pqAddress = res.pqAddress;
      await refreshWalletData();
      state.view = 'wallet';
      render();
      showToast('Wallet imported successfully');
    } catch (err) {
      state.error = (err as Error).message;
      state.view = 'import-password';
      render();
    }
  });

  on('btn-unlock', 'click', async () => {
    const pwd = (document.getElementById('unlock-pwd') as HTMLInputElement)?.value;
    if (!pwd) return;
    const selectedAddress = (document.getElementById('unlock-account-select') as HTMLSelectElement | null)?.value;
    state.error = '';
    state.view = 'unlocking';
    render();
    try {
      await send('UNLOCK_WALLET', { password: pwd, ...(selectedAddress ? { address: selectedAddress } : {}) });
      await refreshWalletData();
      state.view = 'wallet';
      render();
    } catch (err) {
      state.error = (err as Error).message;
      state.view = 'locked';
      render();
    }
  });

  // Enter key on unlock password
  document.getElementById('unlock-pwd')?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') document.getElementById('btn-unlock')?.click();
  });

  on('btn-lock', 'click', async () => {
    await send('LOCK_WALLET');
    state.view = 'locked';
    render();
  });

  on('btn-settings', 'click', () => {
    state.view = 'settings';
    render();
  });

  on('btn-advanced-pq', 'click', () => {
    state.error = '';
    state.view = 'advanced-pq';
    render();
  });

  on('btn-accounts', 'click', () => {
    state.error = '';
    state.view = 'accounts';
    render();
  });

  // Add account flow
  on('btn-add-account', 'click', () => {
    state.error = '';
    state.view = 'add-account';
    render();
  });

  on('btn-add-account-confirm', 'click', async () => {
    const pwd1 = (document.getElementById('add-account-pwd1') as HTMLInputElement)?.value;
    const pwd2 = (document.getElementById('add-account-pwd2') as HTMLInputElement)?.value;
    if (!pwd1 || pwd1.length < 8) {
      state.error = 'Password must be at least 8 characters';
      render();
      return;
    }
    if (pwd1 !== pwd2) {
      state.error = 'Passwords do not match';
      render();
      return;
    }
    state.error = '';
    state.view = 'add-account-generating';
    render();
    try {
      await send<{ pqAddress: string }>('ADD_ACCOUNT', { password: pwd1 });
      await refreshWalletData();
      state.view = 'accounts';
      render();
    } catch (err) {
      state.error = (err as Error).message;
      state.view = 'add-account';
      render();
    }
  });

  // Switch account: clicking Switch on an account row
  document.querySelectorAll('.btn-switch-account').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.error = '';
      state.switchTargetAddress = (btn as HTMLElement).dataset.address ?? '';
      state.view = 'switch-account';
      render();
    });
  });

  // Copy address from accounts list
  document.querySelectorAll('.btn-copy-account').forEach((btn) => {
    btn.addEventListener('click', () => {
      const addr = (btn as HTMLElement).dataset.address ?? '';
      copyText(addr, 'Address copied');
    });
  });

  on('btn-switch-account-confirm', 'click', async () => {
    const pwd = (document.getElementById('switch-account-pwd') as HTMLInputElement)?.value;
    if (!pwd) return;
    state.error = '';
    try {
      await send('SWITCH_ACCOUNT', { password: pwd, address: state.switchTargetAddress });
      await refreshWalletData();
      state.view = 'wallet';
      render();
    } catch (err) {
      state.error = (err as Error).message;
      render();
    }
  });

  // History tx click-to-expand detail
  document.querySelectorAll('.tx-explorer-link').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.stopPropagation();
    });
  });

  document.querySelectorAll('.btn-bump-bitcoin-fee').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const txHash = (btn as HTMLElement).dataset.txhash ?? '';
      const feeRate = window.prompt('New Bitcoin fee rate (sat/vB)');
      if (feeRate == null) return;
      let parsedFeeRate: number | undefined;
      try {
        parsedFeeRate = parseOptionalPositiveNumber(feeRate.trim());
      } catch (err) {
        showToast((err as Error).message, true);
        return;
      }
      if (parsedFeeRate == null) return;
      try {
        const result = await send<{ txHash: string }>('BUMP_BITCOIN_FEE', { txHash, feeRateSatVb: parsedFeeRate });
        showToast('Replacement submitted: ' + truncate(result.txHash, 8, 6));
        const history = await send<{ txs: WalletTxRecord[] }>('GET_TX_HISTORY', { address: state.pqAddress });
        state.txHistory = history.txs;
        state.selectedTxHash = result.txHash;
        render();
      } catch (err) {
        showToast((err as Error).message, true);
      }
    });
  });

  document.querySelectorAll('.btn-cpfp-bitcoin').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const txHash = (btn as HTMLElement).dataset.txhash ?? '';
      const feeRate = window.prompt('Target Bitcoin CPFP package fee rate (sat/vB)');
      if (feeRate == null) return;
      let parsedFeeRate: number | undefined;
      try {
        parsedFeeRate = parseOptionalPositiveNumber(feeRate.trim());
      } catch (err) {
        showToast((err as Error).message, true);
        return;
      }
      if (parsedFeeRate == null) return;
      try {
        const result = await send<{ txHash: string }>('BUMP_BITCOIN_CPFP', { txHash, feeRateSatVb: parsedFeeRate });
        showToast('CPFP child submitted: ' + truncate(result.txHash, 8, 6));
        const history = await send<{ txs: WalletTxRecord[] }>('GET_TX_HISTORY', { address: state.pqAddress });
        state.txHistory = history.txs;
        state.selectedTxHash = result.txHash;
        render();
      } catch (err) {
        showToast((err as Error).message, true);
      }
    });
  });

  const delegateButton = document.getElementById('btn-cosmos-delegate');
  if (delegateButton) {
    delegateButton.addEventListener('click', async () => {
      const validatorAddress = window.prompt('Cosmos validator operator address');
      if (!validatorAddress) return;
      const amount = window.prompt(`Amount to delegate (${chainSymbol()})`);
      if (!amount) return;
      await submitCosmosStaking('DELEGATE_COSMOS_STAKE', validatorAddress.trim(), amount.trim(), 'Delegation submitted');
    });
  }

  document.querySelectorAll('.btn-cosmos-undelegate').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const validatorAddress = (btn as HTMLElement).dataset.validator ?? '';
      if (!validatorAddress) return;
      const amount = window.prompt(`Amount to undelegate (${chainSymbol()})`);
      if (!amount) return;
      await submitCosmosStaking('UNDELEGATE_COSMOS_STAKE', validatorAddress, amount.trim(), 'Undelegation submitted');
    });
  });

  document.querySelectorAll('.btn-cosmos-redelegate').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const sourceValidatorAddress = (btn as HTMLElement).dataset.validator ?? '';
      if (!sourceValidatorAddress) return;
      const destinationValidatorAddress = window.prompt('Destination Cosmos validator operator address');
      if (!destinationValidatorAddress) return;
      const amount = window.prompt(`Amount to redelegate (${chainSymbol()})`);
      if (!amount) return;
      await submitCosmosRedelegation(sourceValidatorAddress, destinationValidatorAddress.trim(), amount.trim());
    });
  });

  document.querySelectorAll('.btn-cosmos-withdraw-rewards').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const validatorAddress = (btn as HTMLElement).dataset.validator ?? '';
      if (!validatorAddress) return;
      await submitCosmosRewards(validatorAddress);
    });
  });

  document.querySelectorAll('.btn-cosmos-delegate-validator').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const validatorAddress = (btn as HTMLElement).dataset.validator ?? '';
      if (!validatorAddress) return;
      const amount = window.prompt(`Amount to delegate (${chainSymbol()})`);
      if (!amount) return;
      await submitCosmosStaking('DELEGATE_COSMOS_STAKE', validatorAddress, amount.trim(), 'Delegation submitted');
    });
  });

  document.querySelectorAll('.btn-cosmos-vote').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const proposalId = (btn as HTMLElement).dataset.proposalId ?? '';
      if (!proposalId) return;
      const option = window.prompt('Vote option: yes, no, abstain, or no_with_veto', 'yes');
      if (!option) return;
      const proposal = state.cosmosGovernanceProposals.find((item) => item.id === proposalId);
      if (proposal) {
        const details = [
          `Proposal #${proposal.id}: ${proposal.title}`,
          `Deposit: ${proposal.totalDeposit}`,
          `Voting: ${proposal.votingStartTime || 'not started'} -> ${proposal.votingEndTime || 'not in voting'}`,
          `Params: quorum ${formatCosmosGovernancePercent(proposal.quorum)}, threshold ${formatCosmosGovernancePercent(proposal.threshold)}, veto ${formatCosmosGovernancePercent(proposal.vetoThreshold)}`,
          `Risk: ${proposal.riskSummary || 'No immediate governance risk flags'}`,
          `Submit vote: ${option.trim()}`,
        ].join('\n');
        if (!window.confirm(details)) return;
      }
      await submitCosmosGovernanceVote(proposalId, option.trim());
    });
  });

  document.querySelectorAll('.tx-item-clickable').forEach((item) => {
    item.addEventListener('click', () => {
      const hash = (item as HTMLElement).dataset.txhash ?? '';
      state.selectedTxHash = state.selectedTxHash === hash ? '' : hash;
      render();
    });
  });

  document.querySelectorAll('.btn-token-send').forEach((btn) => {
    btn.addEventListener('click', () => {
      const contract = (btn as HTMLElement).dataset.contract ?? '';
      const token = currentNetworkTokens().find((item) => item.contractAddress === contract);
      if (!token) return;
      state.error = '';
      state.sendTo = '';
      state.sendValue = '';
      state.sendCosmosMemo = '';
      state.splRecipientStatus = null;
      state.tokenSendContract = token.contractAddress;
      state.tokenSendSymbol = token.symbol;
      state.tokenSendDecimals = String(token.decimals);
      state.view = 'send-token';
      render();
    });
  });

  document.querySelectorAll('.btn-token-remove').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const contractAddress = (btn as HTMLElement).dataset.contract ?? '';
      try {
        await send(tokenMessageType('remove'), { contractAddress });
        await refreshWalletData();
        showToast('Token removed');
        render();
      } catch (err) {
        showToast((err as Error).message, true);
      }
    });
  });

  // QR code for receive view
  if (state.view === 'receive') {
    const canvas = document.getElementById('qr-canvas') as HTMLCanvasElement | null;
    if (canvas && state.pqAddress) {
      QRCode.toCanvas(canvas, state.pqAddress, { width: 180, margin: 2 }).catch(() => {
        // QR generation failed silently — address still shown as text
      });
    }
  }

  // Quick network switcher in wallet header
  const quickNetSelect = document.getElementById('quick-net-select') as HTMLSelectElement | null;
  if (quickNetSelect) {
    quickNetSelect.addEventListener('change', async () => {
      const val = quickNetSelect.value;
      const net = KNOWN_NETWORKS[val];
      if (net) {
        try {
          await send('SET_NETWORK', { network: net });
          state.network = net;
          await refreshWalletData();
          showToast('Switched to ' + net.name);
          render();
        } catch (err) {
          showToast((err as Error).message, true);
        }
      }
    });
  }

  on('btn-send', 'click', () => {
    state.sendTo = '';
    state.sendValue = '';
    state.sendData = '0x';
    state.sendCosmosMemo = '';
    state.sendGasLimit = '';
    state.sendMaxFeePerGas = '';
    state.sendMaxPriorityFeePerGas = '';
    state.sendBitcoinFeePreset = 'auto';
    state.sendBitcoinFeeRate = '';
    state.sendBitcoinUtxoSort = 'value-desc';
    state.sendBitcoinSelectedInputs = [];
    state.sendPreview = null;
    state.sendPreviewConfirmed = false;
    state.error = '';
    state.view = 'send';
    render();
  });

  on('btn-add-token', 'click', () => {
    state.error = '';
    state.tokenAddAddress = '';
    state.view = 'add-token';
    render();
  });

  on('btn-add-token-confirm', 'click', async () => {
    const contractAddress = (document.getElementById('token-contract') as HTMLInputElement)?.value?.trim();
    const metadata = currentChainUiMetadata();
    const tokenStandard = metadata.tokenStandard ?? 'token';
    if (!contractAddress) {
      state.error = `Enter a ${tokenStandard} contract address`;
      render();
      return;
    }
    if (!metadata.capabilities.tokenTransfers) {
      state.error = `${metadata.accountModel} tokens are not supported yet`;
      render();
      return;
    }
    if (!metadata.validateAddress(contractAddress)) {
      state.error = `Contract must be a valid ${metadata.accountModel} address`;
      render();
      return;
    }
    state.error = '';
    state.tokenAddAddress = contractAddress;
    try {
      await send(tokenMessageType('add'), { contractAddress });
      await refreshWalletData();
      state.view = 'wallet';
      showToast('Token added');
      render();
    } catch (err) {
      state.error = (err as Error).message;
      render();
    }
  });

  on('btn-receive', 'click', () => {
    state.view = 'receive';
    render();
  });

  on('btn-history', 'click', async () => {
    state.view = 'history';
    render();
    try {
      const res = await send<{ txs: WalletTxRecord[] }>('GET_TX_HISTORY', { address: state.pqAddress });
      state.txHistory = res.txs;
      render();
    } catch {
      // leave empty
    }
  });

  on('btn-utxo-manager', 'click', async () => {
    await openBitcoinUtxoManager();
  });

  on('btn-utxo-refresh', 'click', async () => {
    await openBitcoinUtxoManager();
  });

  on('utxo-filter', 'input', () => {
    state.bitcoinUtxoFilter = (document.getElementById('utxo-filter') as HTMLInputElement | null)?.value ?? '';
    render();
  });

  on('btn-utxo-lock-selected', 'click', async () => {
    await setSelectedBitcoinUtxoLocks(true);
  });

  on('btn-utxo-unlock-selected', 'click', async () => {
    await setSelectedBitcoinUtxoLocks(false);
  });

  on('btn-utxo-export-labels', 'click', () => {
    downloadJson(JSON.stringify(state.bitcoinUtxoPreferences, null, 2), 'shella-bitcoin-utxo-labels.json');
    showToast('Bitcoin UTXO labels exported');
  });

  on('btn-utxo-import-labels', 'click', async () => {
    const raw = (document.getElementById('utxo-import-json') as HTMLTextAreaElement | null)?.value?.trim() ?? '';
    if (!raw) {
      state.error = 'Paste UTXO label JSON before importing';
      render();
      return;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) throw new Error('UTXO label JSON must be an array');
      state.bitcoinUtxoPreferences = (await send<{ preferences: BitcoinUtxoPreference[] }>('SET_BITCOIN_UTXO_PREFERENCES', {
        preferences: parsed,
      })).preferences;
      state.error = '';
      render();
      showToast('Bitcoin UTXO labels imported');
    } catch (err) {
      state.error = (err as Error).message;
      render();
    }
  });

  on('btn-refresh', 'click', async () => {
    try {
      await refreshBalance();
      render();
      showToast('Balance refreshed');
    } catch (err) {
      showToast((err as Error).message, true);
    }
  });

  on('btn-send-confirm', 'click', async () => {
    if (getSendUnavailableReason()) {
      state.error = getSendUnavailableReason();
      render();
      return;
    }
    const to = (document.getElementById('send-to') as HTMLInputElement)?.value?.trim();
    const value = (document.getElementById('send-value') as HTMLInputElement)?.value?.trim();
    const data = (document.getElementById('send-data') as HTMLInputElement)?.value?.trim() || '0x';
    const cosmosMemo = (document.getElementById('send-cosmos-memo') as HTMLInputElement | null)?.value?.trim() ?? '';
    const gasLimit = (document.getElementById('send-gas-limit') as HTMLInputElement)?.value?.trim();
    const maxFeePerGas = (document.getElementById('send-max-fee') as HTMLInputElement)?.value?.trim();
    const maxPriorityFeePerGas =
      (document.getElementById('send-priority-fee') as HTMLInputElement)?.value?.trim();
    const feePreset = (document.getElementById('send-fee-preset') as HTMLSelectElement | null)?.value ?? 'auto';
    const customFeeRateSatVb = (document.getElementById('send-fee-rate') as HTMLInputElement)?.value?.trim();
    const feeRateSatVb = resolveBitcoinFeePreset(feePreset, customFeeRateSatVb);

    if (!to || !value) {
      state.error = 'Enter recipient address and amount';
      render();
      return;
    }
    const metadata = currentChainUiMetadata();
    if (!metadata.validateAddress(to)) {
      state.error = metadata.invalidAddressMessage;
      render();
      return;
    }
    if (Number(value) <= 0) {
      state.error = 'Amount must be greater than 0';
      render();
      return;
    }
    if (currentChainUiMetadata().capabilities.smartContracts && data !== '0x' && (!/^0x[0-9a-fA-F]*$/.test(data) || data.length % 2 !== 0)) {
      state.error = 'Calldata must be an even-length 0x-prefixed hex string';
      render();
      return;
    }
    let parsedFeeRateSatVb: number | undefined;
    try {
      parsedFeeRateSatVb = parseOptionalPositiveNumber(feeRateSatVb);
    } catch (err) {
      state.error = (err as Error).message;
      render();
      return;
    }
    if (currentChainUiMetadata().capabilities.utxo) {
      if (!state.sendPreview) {
        state.error = 'Preview Bitcoin fee before sending';
        render();
        return;
      }
      const selectedInputs = collectSelectedBitcoinInputs();
      const selectedKeys = selectedInputs?.map(bitcoinInputKey) ?? [];
      const previewKeys = state.sendPreview.inputs.map(bitcoinInputKey);
      if (selectedKeys.length !== previewKeys.length || selectedKeys.some((key, index) => key !== previewKeys[index])) {
        state.error = 'Update the Bitcoin fee preview after changing selected UTXOs';
        state.sendPreviewConfirmed = false;
        render();
        return;
      }
      if (state.sendTo !== to || state.sendValue !== value || state.sendBitcoinFeeRate !== feeRateSatVb || state.sendBitcoinFeePreset !== feePreset) {
        state.error = 'Update the Bitcoin fee preview after changing recipient, amount, or fee rate';
        state.sendPreview = null;
        state.sendPreviewConfirmed = false;
        render();
        return;
      }
      const previewConfirmed = (document.getElementById('send-preview-confirm') as HTMLInputElement | null)?.checked === true;
      if (previewRequiresConfirmation(state.sendPreview) && !previewConfirmed) {
        state.error = 'Confirm the Bitcoin change and dust details before sending';
        render();
        return;
      }
      state.sendPreviewConfirmed = previewConfirmed;
    }
    state.error = '';
    state.sendTo = to;
    state.sendValue = value;
    state.sendData = data;
    state.sendCosmosMemo = cosmosMemo;
    state.sendGasLimit = gasLimit;
    state.sendMaxFeePerGas = maxFeePerGas;
    state.sendMaxPriorityFeePerGas = maxPriorityFeePerGas;
    state.sendBitcoinFeePreset = feePreset;
    state.sendBitcoinFeeRate = feeRateSatVb;
    const bitcoinInputs = state.sendPreview?.inputs;
    state.sendPreview = null;
    state.sendPreviewConfirmed = false;
    state.sendBitcoinSelectedInputs = [];
    state.view = 'sending';
    render();
    try {
      const res = await send<{ txHash: string }>('SEND_TX', {
        to,
        value,
        data,
        gasLimit: parseOptionalNumber(gasLimit),
        maxFeePerGas: parseOptionalNumber(maxFeePerGas),
        maxPriorityFeePerGas: parseOptionalNumber(maxPriorityFeePerGas),
        feeRateSatVb: parsedFeeRateSatVb,
        bitcoinInputs,
        cosmosMemo,
      });
      showToast('Submitted: ' + truncate(res.txHash, 8, 6));
      await refreshWalletData();
      state.view = 'wallet';
      render();
    } catch (err) {
      state.error = (err as Error).message;
      state.view = 'send';
      render();
    }
  });

  on('btn-cosmos-ibc-apply', 'click', () => {
    const routeId = (document.getElementById('send-cosmos-ibc-route') as HTMLSelectElement | null)?.value ?? '';
    const receiver = (document.getElementById('send-cosmos-ibc-receiver') as HTMLInputElement | null)?.value?.trim() ?? '';
    const route = state.cosmosIbcContext?.routes.find((item) => item.id === routeId);
    if (!route) {
      state.error = 'Select an IBC route preset';
      render();
      return;
    }
    if (!receiver) {
      state.error = 'Enter the destination receiver for the IBC memo';
      render();
      return;
    }
    if (!receiver.startsWith(`${route.receiverPrefix}1`)) {
      state.error = `IBC receiver should use ${route.receiverPrefix} prefix for ${route.destinationName}`;
      render();
      return;
    }
    const memo = JSON.stringify({ forward: { receiver, port: route.port, channel: route.channel } });
    state.sendCosmosMemo = memo;
    const memoInput = document.getElementById('send-cosmos-memo') as HTMLInputElement | null;
    if (memoInput) memoInput.value = memo;
    state.error = '';
    render();
  });

  on('btn-preview-send', 'click', async () => {
    if (getNetworkWarning()) {
      state.error = getNetworkWarning();
      render();
      return;
    }
    const to = (document.getElementById('send-to') as HTMLInputElement)?.value?.trim();
    const value = (document.getElementById('send-value') as HTMLInputElement)?.value?.trim();
    const feePreset = (document.getElementById('send-fee-preset') as HTMLSelectElement | null)?.value ?? 'auto';
    const customFeeRateSatVb = (document.getElementById('send-fee-rate') as HTMLInputElement)?.value?.trim();
    const feeRateSatVb = resolveBitcoinFeePreset(feePreset, customFeeRateSatVb);
    if (!to || !value) {
      state.error = 'Enter recipient address and amount';
      render();
      return;
    }
    const metadata = currentChainUiMetadata();
    if (!metadata.validateAddress(to)) {
      state.error = metadata.invalidAddressMessage;
      render();
      return;
    }
    if (Number(value) <= 0) {
      state.error = 'Amount must be greater than 0';
      render();
      return;
    }
    let parsedFeeRateSatVb: number | undefined;
    try {
      parsedFeeRateSatVb = parseOptionalPositiveNumber(feeRateSatVb);
    } catch (err) {
      state.error = (err as Error).message;
      render();
      return;
    }
    state.error = '';
    state.sendTo = to;
    state.sendValue = value;
    state.sendBitcoinFeePreset = feePreset;
    state.sendBitcoinFeeRate = feeRateSatVb;
    const bitcoinInputs = collectSelectedBitcoinInputs();
    if (state.sendPreview && (!bitcoinInputs || bitcoinInputs.length === 0)) {
      state.error = 'Select at least one Bitcoin UTXO';
      render();
      return;
    }
    try {
      state.sendPreview = await send<BitcoinTransferPreview>('PREVIEW_SEND_TX', {
        to,
        value,
        feeRateSatVb: parsedFeeRateSatVb,
        bitcoinInputs,
      });
      state.sendBitcoinSelectedInputs = state.sendPreview.inputs.map(bitcoinInputKey);
      state.sendPreviewConfirmed = false;
      render();
      showToast('Bitcoin fee preview updated');
    } catch (err) {
      state.sendPreview = null;
      state.sendPreviewConfirmed = false;
      state.sendBitcoinSelectedInputs = [];
      state.error = (err as Error).message;
      render();
    }
  });

  on('send-fee-preset', 'change', () => {
    const feePreset = (document.getElementById('send-fee-preset') as HTMLSelectElement | null)?.value ?? 'auto';
    state.sendBitcoinFeePreset = feePreset;
    state.sendBitcoinFeeRate = feePreset === 'custom'
      ? (document.getElementById('send-fee-rate') as HTMLInputElement | null)?.value?.trim() ?? ''
      : resolveBitcoinFeePreset(feePreset, '');
    state.sendPreview = null;
    state.sendPreviewConfirmed = false;
    render();
  });

  on('send-utxo-sort', 'change', () => {
    state.sendBitcoinUtxoSort = (document.getElementById('send-utxo-sort') as HTMLSelectElement | null)?.value ?? 'value-desc';
    render();
  });

  document.querySelectorAll<HTMLInputElement>('.utxo-lock-input').forEach((input) => {
    input.addEventListener('change', async () => {
      const key = input.dataset.inputKey;
      if (!key) return;
      const existing = getBitcoinUtxoPreference(key);
      try {
        state.bitcoinUtxoPreferences = (await send<{ preferences: BitcoinUtxoPreference[] }>('SET_BITCOIN_UTXO_PREFERENCE', {
          preference: {
            key,
            label: existing?.label ?? '',
            locked: input.checked,
          },
        })).preferences;
        if (input.checked) {
          state.sendBitcoinSelectedInputs = state.sendBitcoinSelectedInputs.filter((item) => item !== key);
        } else if (state.sendPreview && state.sendBitcoinSelectedInputs.length === 0) {
          state.sendBitcoinSelectedInputs = state.sendPreview.inputs
            .filter((previewInput) => getBitcoinUtxoPreference(bitcoinInputKey(previewInput))?.locked !== true)
            .map(bitcoinInputKey);
        }
        state.sendPreviewConfirmed = false;
        render();
      } catch (err) {
        showToast((err as Error).message, true);
      }
    });
  });

  document.querySelectorAll<HTMLInputElement>('.utxo-label-input').forEach((input) => {
    input.addEventListener('change', async () => {
      const key = input.dataset.inputKey;
      if (!key) return;
      const existing = getBitcoinUtxoPreference(key);
      try {
        state.bitcoinUtxoPreferences = (await send<{ preferences: BitcoinUtxoPreference[] }>('SET_BITCOIN_UTXO_PREFERENCE', {
          preference: {
            key,
            label: input.value.trim(),
            locked: existing?.locked === true,
          },
        })).preferences;
        render();
      } catch (err) {
        showToast((err as Error).message, true);
      }
    });
  });

  on('btn-token-send-confirm', 'click', async () => {
    const to = (document.getElementById('send-to') as HTMLInputElement)?.value?.trim();
    const amount = (document.getElementById('send-value') as HTMLInputElement)?.value?.trim();
    if (!to || !amount) {
      state.error = 'Enter recipient address and amount';
      render();
      return;
    }
    const metadata = currentChainUiMetadata();
    if (!metadata.validateAddress(to)) {
      state.error = metadata.invalidAddressMessage;
      render();
      return;
    }
    if (Number(amount) <= 0) {
      state.error = 'Amount must be greater than 0';
      render();
      return;
    }
    state.error = '';
    state.sendTo = to;
    state.sendValue = amount;
    const createAtaConfirmed = (document.getElementById('spl-create-ata-confirm') as HTMLInputElement | null)?.checked === true;
    try {
      let createRecipientAta = false;
      if (metadata.tokenStandard === 'SPL') {
        const status = await send<SplRecipientAccountStatus>('GET_SPL_RECIPIENT_ACCOUNT_STATUS', {
          contractAddress: state.tokenSendContract,
          to,
          amount,
          decimals: parseOptionalNumber(state.tokenSendDecimals),
        });
        state.splRecipientStatus = status;
        if (status.createRecipientAtaRequired) {
          if (!createAtaConfirmed) {
            state.error = 'Review recipient ATA creation, rent, and extra instruction before confirming.';
            state.view = 'send-token';
            render();
            return;
          }
          createRecipientAta = true;
        }
      }
      state.view = 'sending';
      render();
      const res = await send<{ txHash: string }>(tokenMessageType('send'), {
        contractAddress: state.tokenSendContract,
        to,
        amount,
        decimals: parseOptionalNumber(state.tokenSendDecimals),
        symbol: state.tokenSendSymbol,
        createRecipientAta,
      });
      showToast('Submitted: ' + truncate(res.txHash, 8, 6));
      await refreshWalletData();
      state.view = 'wallet';
      render();
    } catch (err) {
      state.error = (err as Error).message;
      state.view = 'send-token';
      render();
    }
  });

  on('btn-copy-addr', 'click', () => copyText(state.pqAddress, 'Address copied'));
  on('btn-copy-full', 'click', () => copyText(state.pqAddress, 'Address copied'));

  on('btn-export-ks', 'click', async () => {
    try {
      const res = await send<{ keystoreJson: string }>('EXPORT_KEYSTORE');
      downloadJson(res.keystoreJson, 'shella-keystore.json');
      showToast('Keystore exported');
    } catch (err) {
      showToast((err as Error).message, true);
    }
  });

  on('btn-reset', 'click', async () => {
    if (confirm('Reset wallet? This deletes all local data. Make sure you have exported your keystore!')) {
      await send('RESET_WALLET');
      Object.assign(state, {
        view: 'welcome',
        pqAddress: '',
        balance: '0',
        balanceFormatted: '0.000000',
        detectedChainId: null,
        nonce: null,
        txHistory: [],
        txQueue: [],
        error: '',
      });
      render();
    }
  });

  // Network switch
  const netSelect = document.getElementById('network-select') as HTMLSelectElement | null;
  if (netSelect) {
    netSelect.addEventListener('change', async () => {
      const val = netSelect.value;
      if (val === 'custom') {
        const sec = document.getElementById('custom-rpc-section');
        if (sec) sec.style.display = 'block';
        return;
      }
      const net = KNOWN_NETWORKS[val];
      if (net) {
        try {
          await send('SET_NETWORK', { network: net });
          state.network = net;
          await refreshWalletData();
          showToast('Network switched to ' + net.name);
          render();
        } catch (err) {
          showToast((err as Error).message, true);
        }
      }
    });
  }

  on('btn-save-custom', 'click', async () => {
    const chainId = parseInt((document.getElementById('custom-chain-id') as HTMLInputElement)?.value);
    const rpcUrl = (document.getElementById('custom-rpc-url') as HTMLInputElement)?.value?.trim();
    const name = (document.getElementById('custom-net-name') as HTMLInputElement)?.value?.trim() || 'Custom';
    if (!chainId || !rpcUrl) {
      showToast('Fill in Chain ID and RPC URL', true);
      return;
    }
    const net = { name, chainId, rpcUrl, kind: 'shell' as const, symbol: 'SHELL', rpcProvenance: 'user-custom' as const };
    try {
      await send('SET_NETWORK', { network: net });
      state.network = net;
      await refreshWalletData();
      showToast('Custom RPC saved');
      render();
    } catch (err) {
      showToast((err as Error).message, true);
    }
  });

  on('btn-save-auto-lock', 'click', async () => {
    const minutes = Number((document.getElementById('auto-lock-minutes') as HTMLInputElement)?.value);
    if (!Number.isFinite(minutes) || minutes < 0) {
      showToast('Auto-lock minutes must be 0 or greater', true);
      return;
    }
    await send('SET_AUTO_LOCK', { minutes });
    state.autoLockMinutes = minutes;
    showToast('Auto-lock updated');
  });

  on('btn-save-wc-config', 'click', async () => {
    const projectId = (document.getElementById('wc-project-id') as HTMLInputElement)?.value?.trim() ?? '';
    const relayUrl = (document.getElementById('wc-relay-url') as HTMLInputElement)?.value?.trim() ?? '';
    if (relayUrl && !/^wss?:\/\//i.test(relayUrl)) {
      showToast('Relay URL must start with ws:// or wss://', true);
      return;
    }
    try {
      const config = await send<WalletConnectConfig>('SET_WALLETCONNECT_CONFIG', { projectId, relayUrl });
      state.walletConnectConfig = config;
      state.walletConnectProjectId = config.projectId;
      state.walletConnectRelayUrl = config.relayUrl;
      state.walletConnectRelayStatus = await send<WalletConnectRelayStatus>('GET_WALLETCONNECT_RELAY_STATUS');
      render();
      showToast('WalletConnect settings saved');
    } catch (err) {
      showToast((err as Error).message, true);
    }
  });

  on('btn-wc-pair', 'click', async () => {
    const uri = (document.getElementById('wc-pairing-uri') as HTMLInputElement)?.value?.trim() ?? '';
    state.walletConnectUri = uri;
    if (!uri) {
      showToast('Enter a WalletConnect URI', true);
      return;
    }
    try {
      await send('START_WALLETCONNECT_PAIRING', { uri, useRelay: true });
      state.walletConnectUri = '';
      await refreshWalletData();
      render();
      showToast('WalletConnect pairing added');
    } catch (err) {
      render();
      showToast((err as Error).message, true);
    }
  });

  on('btn-authorize-session', 'click', async () => {
    const password = (document.getElementById('session-password') as HTMLInputElement)?.value ?? '';
    const sessionIndex = (document.getElementById('session-index') as HTMLInputElement)?.value?.trim() ?? '0';
    const rootAccountIndex = (document.getElementById('session-root-index') as HTMLInputElement)?.value?.trim() ?? '0';
    const expiryBlock = (document.getElementById('session-expiry') as HTMLInputElement)?.value?.trim() ?? '';
    const valueCap = (document.getElementById('session-value-cap') as HTMLInputElement)?.value?.trim() ?? '0';
    const target = (document.getElementById('session-target') as HTMLInputElement)?.value?.trim() ?? '';
    const txSigningHash = (document.getElementById('session-tx-hash') as HTMLInputElement)?.value?.trim() ?? '';

    state.sessionPassword = password;
    state.sessionIndex = sessionIndex;
    state.sessionRootAccountIndex = rootAccountIndex;
    state.sessionExpiryBlock = expiryBlock;
    state.sessionValueCap = valueCap;
    state.sessionTarget = target;
    state.sessionTxSigningHash = txSigningHash;

    if (!password) {
      state.error = 'Enter wallet password';
      render();
      return;
    }
    if (!isNonNegativeIntegerString(sessionIndex) || !isNonNegativeIntegerString(rootAccountIndex)) {
      state.error = 'Account and session indices must be non-negative integers';
      render();
      return;
    }
    if (!isPositiveIntegerString(expiryBlock)) {
      state.error = 'Expiry block must be a positive integer';
      render();
      return;
    }
    if (!isQuantityString(valueCap)) {
      state.error = 'Value cap must be a hex or decimal quantity';
      render();
      return;
    }
    if (target && !/^0x[0-9a-fA-F]{64}$/.test(target)) {
      state.error = 'Target must be a 0x + 64-char Shell address';
      render();
      return;
    }
    if (txSigningHash && !/^0x[0-9a-fA-F]{64}$/.test(txSigningHash)) {
      state.error = 'Transaction signing hash must be 0x + 32 bytes';
      render();
      return;
    }

    state.error = '';
    try {
      const result = await send('AUTHORIZE_SESSION_KEY', {
        password,
        sessionIndex: Number(sessionIndex),
        rootAccountIndex: Number(rootAccountIndex),
        expiryBlock: Number(expiryBlock),
        valueCap,
        target: target || null,
        txSigningHash: txSigningHash || undefined,
      });
      state.sessionPassword = '';
      state.sessionAuthJson = JSON.stringify(result, null, 2);
      render();
      showToast('Session key authorized');
    } catch (err) {
      state.error = (err as Error).message;
      render();
    }
  });

  on('btn-copy-session-auth', 'click', () => {
    copyText(state.sessionAuthJson, 'Session auth copied');
  });

  on('btn-rotate-key', 'click', async () => {
    const password = (document.getElementById('rotate-password') as HTMLInputElement)?.value ?? '';
    state.rotatePassword = password;
    if (!password) {
      state.error = 'Enter wallet password';
      render();
      return;
    }
    state.error = '';
    try {
      const result = await send<{ txHash: string; pqAddress: string }>('ROTATE_KEY', { password });
      state.rotatePassword = '';
      state.pendingRotationTxHash = result.txHash;
      await refreshWalletData();
      render();
      showToast('Key rotation submitted');
    } catch (err) {
      state.error = (err as Error).message;
      render();
    }
  });

  on('btn-approval-approve', 'click', async () => {
    if (!state.approvalRequest) return;
    await send('RESOLVE_APPROVAL', { requestId: state.approvalRequest.id, approved: true });
    window.close();
  });

  on('btn-approval-reject', 'click', async () => {
    if (!state.approvalRequest) return;
    await send('RESOLVE_APPROVAL', { requestId: state.approvalRequest.id, approved: false });
    window.close();
  });

  if (typeof document.querySelectorAll === 'function') {
    document.querySelectorAll<HTMLButtonElement>('.btn-site-revoke').forEach((button) => {
      button.addEventListener('click', async () => {
        const origin = button.dataset.origin;
        if (!origin) return;
        await send('REMOVE_CONNECTED_SITE', { origin });
        state.connectedSites = state.connectedSites.filter((site) => site.origin !== origin);
        render();
        showToast('dApp permission revoked');
      });
    });
    document.querySelectorAll<HTMLButtonElement>('.btn-wc-pairing-remove').forEach((button) => {
      button.addEventListener('click', async () => {
        const topic = button.dataset.topic;
        if (!topic) return;
        try {
          await send('REMOVE_WALLETCONNECT_PAIRING', { topic });
          state.walletConnectPairings = state.walletConnectPairings.filter((pairing) => pairing.topic !== topic);
          render();
          showToast('WalletConnect pairing removed');
        } catch (err) {
          showToast((err as Error).message, true);
        }
      });
    });
  }
}

// ────────── Helpers ──────────

async function refreshBalance(): Promise<void> {
  if (!state.pqAddress) return;
  const res = await send<{ balance: string; formatted: string }>('GET_BALANCE', {
    address: state.pqAddress,
  });
  state.balance = res.balance;
  state.balanceFormatted = res.formatted;
  if ((state.network.kind ?? 'shell') === 'cosmos') {
    const [balances, staking, redelegations, validators, proposals, ibcContext] = await Promise.all([
      send<{ balances: CosmosDenomBalance[] }>('GET_COSMOS_BALANCES', {
        address: state.pqAddress,
      }).catch(() => ({ balances: [] })),
      send<{ positions: CosmosStakingPosition[] }>('GET_COSMOS_STAKING', {
        address: state.pqAddress,
      }).catch(() => ({ positions: [] })),
      send<{ redelegations: CosmosRedelegationEntry[] }>('GET_COSMOS_REDELEGATIONS', {
        address: state.pqAddress,
      }).catch(() => ({ redelegations: [] })),
      send<{ validators: CosmosValidatorSummary[] }>('GET_COSMOS_VALIDATORS').catch(() => ({ validators: [] })),
      send<{ proposals: CosmosGovernanceProposal[] }>('GET_COSMOS_GOVERNANCE_PROPOSALS', {
        address: state.pqAddress,
      }).catch(() => ({ proposals: [] })),
      send<CosmosIbcContext>('GET_COSMOS_IBC_CONTEXT', {
        address: state.pqAddress,
      }).catch(() => null),
    ]);
    state.cosmosBalances = balances.balances;
    state.cosmosStaking = staking.positions;
    state.cosmosRedelegations = redelegations.redelegations;
    state.cosmosValidators = validators.validators;
    state.cosmosGovernanceProposals = proposals.proposals;
    state.cosmosIbcContext = ibcContext;
  } else {
    state.cosmosBalances = [];
    state.cosmosStaking = [];
    state.cosmosRedelegations = [];
    state.cosmosValidators = [];
    state.cosmosGovernanceProposals = [];
    state.cosmosIbcContext = null;
  }
}

async function refreshWalletData(): Promise<void> {
  const snapshot = await send<WalletSnapshot>('GET_WALLET_SNAPSHOT');
  state.network = snapshot.wallet.network;
  state.txQueue = snapshot.wallet.txQueue;
  state.watchedTokens = snapshot.wallet.watchedTokens ?? [];
  state.autoLockMinutes = snapshot.wallet.autoLockMinutes;
  state.connectedSites = snapshot.wallet.connectedSites;
  state.walletConnectConfig = snapshot.wallet.walletConnectConfig ?? { projectId: '', relayUrl: '' };
  state.walletConnectProjectId = state.walletConnectConfig.projectId;
  state.walletConnectRelayUrl = state.walletConnectConfig.relayUrl;
  state.walletConnectPairings = snapshot.wallet.walletConnectPairings ?? [];
  state.bitcoinUtxoPreferences = snapshot.wallet.bitcoinUtxoPreferences ?? [];
  state.walletConnectRelayStatus = await send<WalletConnectRelayStatus>('GET_WALLETCONNECT_RELAY_STATUS').catch(() => null);
  state.detectedChainId = snapshot.detectedChainId;
  state.nonce = snapshot.nonce;
  state.nodeInfo = snapshot.nodeInfo ?? null;
  state.accounts = snapshot.wallet.accounts ?? [];
  if (snapshot.activeAddress) {
    state.pqAddress = snapshot.activeAddress;
  } else if (snapshot.primaryAccount) {
    state.pqAddress = snapshot.primaryAccount.pqAddress;
  }
  if (snapshot.balance) {
    state.balance = snapshot.balance.raw;
    state.balanceFormatted = snapshot.balance.formatted;
  } else {
    state.balance = '0';
    state.balanceFormatted = '0.000000';
  }
  state.cosmosBalances = snapshot.cosmosBalances ?? [];
  state.cosmosStaking = snapshot.cosmosStaking ?? [];
  state.cosmosRedelegations = snapshot.cosmosRedelegations ?? [];
  state.cosmosValidators = snapshot.cosmosValidators ?? [];
  state.cosmosGovernanceProposals = snapshot.cosmosGovernanceProposals ?? [];
  state.cosmosIbcContext = snapshot.cosmosIbcContext ?? null;
  await refreshTokenBalances();
}

async function refreshTokenBalances(): Promise<void> {
  if (!currentChainUiMetadata().capabilities.tokenTransfers || !state.pqAddress) {
    state.tokenBalances = {};
    return;
  }
  const entries = await Promise.all(currentNetworkTokens().map(async (token) => {
    try {
      const balance = await send<{ balance: string; formatted: string; decimals: number; symbol: string | null }>(tokenMessageType('balance'), {
        contractAddress: token.contractAddress,
        ownerAddress: state.pqAddress,
        decimals: token.decimals,
        symbol: token.symbol,
      });
      return [tokenKey(token), {
        balance: balance.balance,
        formatted: balance.formatted,
        symbol: balance.symbol ?? token.symbol,
        decimals: balance.decimals,
      }] as const;
    } catch {
      return [tokenKey(token), {
        balance: '0',
        formatted: 'unavailable',
        symbol: token.symbol,
        decimals: token.decimals,
      }] as const;
    }
  }));
  state.tokenBalances = Object.fromEntries(entries);
}

async function submitCosmosStaking(
  messageType: 'DELEGATE_COSMOS_STAKE' | 'UNDELEGATE_COSMOS_STAKE',
  validatorAddress: string,
  amount: string,
  successMessage: string,
): Promise<void> {
  if (!validatorAddress || !amount) return;
  try {
    const result = await send<{ txHash: string }>(messageType, { validatorAddress, amount });
    showToast(`${successMessage}: ${truncate(result.txHash, 8, 6)}`);
    await refreshWalletData();
    state.view = 'wallet';
    render();
  } catch (err) {
    showToast((err as Error).message, true);
  }
}

async function submitCosmosRewards(validatorAddress: string): Promise<void> {
  if (!validatorAddress) return;
  try {
    const result = await send<{ txHash: string }>('WITHDRAW_COSMOS_REWARDS', { validatorAddress });
    showToast(`Rewards withdrawal submitted: ${truncate(result.txHash, 8, 6)}`);
    await refreshWalletData();
    state.view = 'wallet';
    render();
  } catch (err) {
    showToast((err as Error).message, true);
  }
}

async function submitCosmosRedelegation(sourceValidatorAddress: string, destinationValidatorAddress: string, amount: string): Promise<void> {
  if (!sourceValidatorAddress || !destinationValidatorAddress || !amount) return;
  const blocked = findBlockingRedelegation(sourceValidatorAddress);
  if (blocked) {
    showToast(`Redelegation cooling down until ${formatDateTime(blocked.completionTime)}`, true);
    return;
  }
  try {
    const result = await send<{ txHash: string }>('REDELEGATE_COSMOS_STAKE', { sourceValidatorAddress, destinationValidatorAddress, amount });
    showToast(`Redelegation submitted: ${truncate(result.txHash, 8, 6)}`);
    await refreshWalletData();
    state.view = 'wallet';
    render();
  } catch (err) {
    showToast((err as Error).message, true);
  }
}

async function submitCosmosGovernanceVote(proposalId: string, option: string): Promise<void> {
  if (!proposalId || !option) return;
  try {
    const result = await send<{ txHash: string }>('VOTE_COSMOS_GOVERNANCE', { proposalId, option });
    showToast(`Vote submitted: ${truncate(result.txHash, 8, 6)}`);
    await refreshWalletData();
    state.view = 'wallet';
    render();
  } catch (err) {
    showToast((err as Error).message, true);
  }
}

async function openBitcoinUtxoManager(): Promise<void> {
  if (!state.pqAddress) return;
  state.view = 'utxo-manager';
  render();
  try {
    const [inputs, preferences] = await Promise.all([
      send<{ inputs: BitcoinTxInput[] }>('GET_BITCOIN_UTXOS', { address: state.pqAddress }),
      send<{ preferences: BitcoinUtxoPreference[] }>('GET_BITCOIN_UTXO_PREFERENCES'),
    ]);
    state.bitcoinUtxoManagerInputs = inputs.inputs;
    state.bitcoinUtxoPreferences = preferences.preferences;
    state.error = '';
    render();
  } catch (err) {
    state.error = (err as Error).message;
    render();
  }
}

async function setSelectedBitcoinUtxoLocks(locked: boolean): Promise<void> {
  const keys = Array.from(document.querySelectorAll<HTMLInputElement>('.utxo-manager-select:checked'))
    .map((input) => input.dataset.inputKey)
    .filter((value): value is string => typeof value === 'string' && value !== '');
  if (keys.length === 0) {
    state.error = 'Select at least one UTXO';
    render();
    return;
  }
  const preferences = keys.map((key): BitcoinUtxoPreference => {
    const existing = getBitcoinUtxoPreference(key);
    return {
      key,
      label: existing?.label ?? '',
      locked,
      updatedAt: Date.now(),
    };
  });
  try {
    state.bitcoinUtxoPreferences = (await send<{ preferences: BitcoinUtxoPreference[] }>('SET_BITCOIN_UTXO_PREFERENCES', { preferences })).preferences;
    if (locked) state.sendBitcoinSelectedInputs = state.sendBitcoinSelectedInputs.filter((key) => !keys.includes(key));
    state.sendPreviewConfirmed = false;
    state.error = '';
    render();
    showToast(locked ? 'Selected UTXOs locked' : 'Selected UTXOs unlocked');
  } catch (err) {
    state.error = (err as Error).message;
    render();
  }
}

function findBlockingRedelegation(sourceValidatorAddress: string): CosmosRedelegationEntry | null {
  const now = Date.now();
  return state.cosmosRedelegations.find((entry) => {
    if (entry.destinationValidatorAddress !== sourceValidatorAddress) return false;
    const completionMs = Date.parse(entry.completionTime);
    return !Number.isFinite(completionMs) || completionMs > now;
  }) ?? null;
}

function copyText(text: string, msg: string): void {
  navigator.clipboard.writeText(text).then(() => showToast(msg)).catch(() => {
    // Fallback
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    showToast(msg);
  });
}

function downloadJson(json: string, filename: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseOptionalNumber(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseOptionalPositiveNumber(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Bitcoin fee rate must be greater than 0 sat/vB');
  }
  return parsed;
}

export function previewRequiresConfirmation(preview: BitcoinTransferPreview): boolean {
  try {
    return BigInt(preview.changeSats) > 0n || BigInt(preview.dustSats) > 0n;
  } catch {
    return true;
  }
}

function bitcoinInputKey(input: { txid: string; vout: number }): string {
  return `${input.txid.toLowerCase()}:${input.vout}`;
}

function getBitcoinUtxoPreference(key: string): BitcoinUtxoPreference | undefined {
  return state.bitcoinUtxoPreferences.find((preference) => preference.key === key.toLowerCase());
}

function isBitcoinInputSelected(input: { txid: string; vout: number }): boolean {
  const key = bitcoinInputKey(input);
  if (getBitcoinUtxoPreference(key)?.locked === true) return false;
  return state.sendBitcoinSelectedInputs.length === 0 || state.sendBitcoinSelectedInputs.includes(key);
}

function collectSelectedBitcoinInputs(): BitcoinTransferPreview['inputs'] | undefined {
  if (!state.sendPreview) return undefined;
  const checked = Array.from(document.querySelectorAll<HTMLInputElement>('.send-bitcoin-input:checked'))
    .map((input) => input.dataset.inputKey)
    .filter((value): value is string => typeof value === 'string' && value !== '');
  if (checked.length === 0) return undefined;
  const selected = new Set(checked);
  return state.sendPreview.inputs.filter((input) => {
    const key = bitcoinInputKey(input);
    return selected.has(key) && getBitcoinUtxoPreference(key)?.locked !== true;
  });
}

export function sortBitcoinInputs(
  inputs: BitcoinTransferPreview['inputs'],
  sort: string,
  preferences: BitcoinUtxoPreference[] = [],
): BitcoinTransferPreview['inputs'] {
  const labels = new Map(preferences.map((preference) => [preference.key.toLowerCase(), preference.label ?? '']));
  return [...inputs].sort((left, right) => {
    if (sort === 'value-asc' || sort === 'value-desc') {
      const delta = BigInt(left.valueSats) - BigInt(right.valueSats);
      if (delta !== 0n) return sort === 'value-asc' ? (delta < 0n ? -1 : 1) : (delta > 0n ? -1 : 1);
    }
    if (sort === 'confirmed-first' && left.confirmed !== right.confirmed) {
      return left.confirmed ? -1 : 1;
    }
    if (sort === 'label') {
      const labelDelta = (labels.get(bitcoinInputKey(left)) ?? '').localeCompare(labels.get(bitcoinInputKey(right)) ?? '');
      if (labelDelta !== 0) return labelDelta;
    }
    return bitcoinInputKey(left).localeCompare(bitcoinInputKey(right));
  });
}

function isNonNegativeIntegerString(value: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(value);
}

function isPositiveIntegerString(value: string): boolean {
  return /^[1-9][0-9]*$/.test(value);
}

function isQuantityString(value: string): boolean {
  return /^(0|[1-9][0-9]*|0x[0-9a-fA-F]+)$/.test(value);
}

export function formatDisplayValue(value: string): string {
  const normalized = value.startsWith('0x') ? BigInt(value) : BigInt(value);
  return (Number(normalized) / 1e18).toFixed(6);
}

export function formatWalletConnectExpiry(expiresAt: number): string {
  if (!Number.isFinite(expiresAt)) return 'unknown';
  const msRemaining = expiresAt - Date.now();
  if (msRemaining <= 0) return 'expired';
  const minutesRemaining = Math.ceil(msRemaining / 60000);
  if (minutesRemaining < 60) return `${minutesRemaining}m`;
  const hoursRemaining = Math.ceil(minutesRemaining / 60);
  if (hoursRemaining < 24) return `${hoursRemaining}h`;
  return `${Math.ceil(hoursRemaining / 24)}d`;
}

// ────────── Boot ──────────

async function boot(): Promise<void> {
  const approvalId = new URLSearchParams(window.location.search).get('approvalId');
  if (approvalId) {
    state.approvalRequest = await send<ApprovalRequest>('GET_APPROVAL_REQUEST', { requestId: approvalId });
    state.view = 'approval-request';
    render();
    return;
  }

  const snapshot = await send<WalletSnapshot>('GET_WALLET_SNAPSHOT');
  state.network = snapshot.wallet.network;
  state.txQueue = snapshot.wallet.txQueue;
  state.autoLockMinutes = snapshot.wallet.autoLockMinutes;
  state.connectedSites = snapshot.wallet.connectedSites;
  state.walletConnectConfig = snapshot.wallet.walletConnectConfig ?? { projectId: '', relayUrl: '' };
  state.walletConnectProjectId = state.walletConnectConfig.projectId;
  state.walletConnectRelayUrl = state.walletConnectConfig.relayUrl;
  state.walletConnectPairings = snapshot.wallet.walletConnectPairings ?? [];
  state.bitcoinUtxoPreferences = snapshot.wallet.bitcoinUtxoPreferences ?? [];
  state.walletConnectRelayStatus = await send<WalletConnectRelayStatus>('GET_WALLETCONNECT_RELAY_STATUS').catch(() => null);
  state.detectedChainId = snapshot.detectedChainId;
  state.nonce = snapshot.nonce;
  state.nodeInfo = snapshot.nodeInfo ?? null;
  state.accounts = snapshot.wallet.accounts ?? [];
  state.cosmosBalances = snapshot.cosmosBalances ?? [];
  state.cosmosStaking = snapshot.cosmosStaking ?? [];
  state.cosmosRedelegations = snapshot.cosmosRedelegations ?? [];
  state.cosmosValidators = snapshot.cosmosValidators ?? [];
  state.cosmosGovernanceProposals = snapshot.cosmosGovernanceProposals ?? [];

  if (!snapshot.primaryAccount) {
    state.view = 'welcome';
  } else if (snapshot.locked) {
    state.pqAddress = snapshot.activeAddress ?? snapshot.primaryAccount.pqAddress;
    state.view = 'locked';
  } else {
    state.pqAddress = snapshot.activeAddress ?? snapshot.primaryAccount.pqAddress;
    if (snapshot.balance) {
      state.balance = snapshot.balance.raw;
      state.balanceFormatted = snapshot.balance.formatted;
    } else {
      state.balance = '0';
      state.balanceFormatted = '0.000000';
    }
    state.view = 'wallet';
  }

  render();
}

boot().catch((err) => {
  state.view = 'locked';
  state.error = (err as Error).message;
  render();
});
