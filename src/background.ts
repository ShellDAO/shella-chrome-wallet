/**
 * Shella Wallet — background service worker.
 *
 * Handles wallet lifecycle: key generation, encryption/decryption, lock/unlock,
 * transaction signing, receipt tracking, and RPC proxying.
 */

import { MlDsa65Adapter, generateMlDsa65KeyPair } from 'shell-sdk/adapters';
import { createShellProvider } from 'shell-sdk/provider';
import { ShellSigner } from 'shell-sdk/signer';
import { buildRotateKeyTransaction, buildTransaction, buildTransferTransaction, hashTransaction } from 'shell-sdk/transactions';
import { createSessionAuth, finalizeSessionAuth } from 'shell-sdk/session';
import type { SessionAuth, ShellEncryptedKey } from 'shell-sdk/types';
import { deriveAccount, deriveSessionKey, generateMnemonic, mnemonicToSeed, validateHdMnemonic } from 'shell-sdk/hdwallet';
import { defineChain, parseEther } from 'viem';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  deriveTronAddress,
  deriveTronKeyPair,
  getTronBalance,
  getTronTransactionStatus,
  getTrc20Balance,
  getTrc20TokenInfo,
  parseTrx,
  parseTokenAmount,
  sendTrc20Transfer,
  sendTronTransfer,
} from './chains/tron.js';
import {
  deriveSolanaAddress,
  deriveSolanaKeyPair,
  getSolanaBalance,
  getSolanaTransactionStatus,
  getSplRecipientAccountStatus,
  getSplTokenBalance,
  getSplTokenInfo,
  parseSol,
  sendSplTokenTransfer,
  sendSolanaTransfer,
} from './chains/solana.js';
import {
  type BitcoinNetwork,
  checkBitcoinCpfpPolicy,
  deriveBitcoinAddress,
  deriveBitcoinKeyPair,
  getBitcoinBalance,
  getBitcoinSpendableUtxos,
  getBitcoinTransactionHistory,
  getBitcoinTransactionStatus,
  parseBtc,
  previewBitcoinTransfer,
  replaceBitcoinTransfer,
  sendBitcoinCpfpChild,
  sendBitcoinTransfer,
} from './chains/bitcoin.js';
import {
  convertCosmosAddressPrefix,
  deriveCosmosAddress,
  deriveCosmosKeyPair,
  getCosmosBalance,
  getCosmosDenomBalances,
  getCosmosGovernanceProposals,
  getCosmosIbcContext,
  getCosmosRedelegations,
  getCosmosStakingPositions,
  getCosmosTransactionStatus,
  getCosmosValidators,
  normalizeCosmosMemo,
  parseCosmosAmount,
  sendCosmosGovernanceVoteTransaction,
  sendCosmosRedelegateTransaction,
  sendCosmosStakingTransaction,
  sendCosmosTransfer,
  sendCosmosWithdrawRewardsTransaction,
  signCosmosAminoDoc,
  signCosmosDirectDoc,
} from './chains/cosmos.js';
import {
  deriveTonAddress,
  deriveTonKeyPair,
  getTonBalance,
  getTonJettonBalance,
  getTonJettonInfo,
  getTonJettonTransactionHistoryForMaster,
  getTonJettonTransactionStatusForMaster,
  getTonTransactionHistory,
  getTonTransactionStatus,
  parseTonPayloadCell,
  parseTonAddress,
  parseTon,
  sendTonInternalMessages,
  sendTonJettonTransfer,
  sendTonTransfer,
  type TonInternalMessage,
} from './chains/ton.js';
import {
  deriveAptosAddress,
  deriveAptosKeyPair,
  formatApt,
  getAptosAccountSequence,
  getAptosBalance,
  getAptosTransactionStatus,
  parseApt,
  previewAptosDappPayload,
  sendAptosTransfer,
} from './chains/aptos.js';
import { getChainCapabilities } from './chains/capabilities.js';
import {
  getApprovalRequest,
  handleApprovalWindowRemoved,
  requestUserApproval,
  resolveApprovalRequest,
} from './background/approvals.js';
import { createKeystore, decryptKeystore, decryptHdSeed, encryptHdSeed, encryptMnemonic, decryptMnemonic } from './crypto.js';
import {
  KNOWN_NETWORKS,
  addAccount as addStoredAccount,
  addPendingKeyRotation,
  addConnectedSite,
  addWatchedToken,
  clearAllData,
  clearConnectedSites,
  clearProviderDisabledOrigins,
  clearSessionState,
  clearTonConnectSessions,
  clearWalletConnectPairings,
  clearWalletConnectSessions,
  clearWalletConnectSdkStorage,
  getAccounts,
  getAutoLockMinutes,
  getBitcoinUtxoPreferences,
  getConnectedSites,
  getAccountId,
  getHdStore,
  getLastActiveAccountId,
  getLastActiveAddress,
  getPendingKeyRotations,
  getProviderDisabledOrigins,
  getNetwork,
  getTonConnectSessions,
  getPortfolioSnapshotCache,
  getTxQueue,
  getWalletState,
  getWalletConnectConfig,
  getWalletConnectPairings,
  getWalletConnectSessions,
  initStore,
  removeConnectedSite,
  removeTonConnectSession,
  removeWatchedToken,
  removeWalletConnectPairing,
  removeWalletConnectSession,
  replaceAccountKeystore,
  setAutoLockMinutes,
  setHdStore,
  setLastActiveAccountId,
  setLastActiveAddress,
  setNetwork,
  setPendingKeyRotations,
  setPortfolioSnapshotCache,
  setProviderOriginDisabled,
  setSessionState,
  setWalletConnectConfig,
  setWatchedTokenHidden,
  setTxQueue,
  upsertBitcoinUtxoPreference,
  upsertBitcoinUtxoPreferences,
  upsertTonConnectSession,
  upsertTxRecord,
  upsertWalletConnectPairing,
  upsertWalletConnectSession,
} from './store.js';
import type {
  ChainAddressKey,
  ConnectedSitePermission,
  DappRequestMessage,
  ChainKind,
  Network,
  SendTransactionParams,
  StoredAccount,
  TonConnectFeature,
  TonConnectSession,
  WalletConnectApprovedNamespace,
  WalletConnectNamespaceProposal,
  WalletConnectPairing,
  WalletConnectProposalPreview,
  WalletConnectRelayStatus,
  WalletConnectSession,
  WalletNodeInfo,
  WalletSnapshot,
  WalletTxRecord,
  BitcoinTransferPreview,
  BitcoinTxInput,
  BitcoinUtxoPreference,
  ApprovalRiskSummary,
  CosmosDenomBalance,
  CosmosGovernanceProposal,
  CosmosRedelegationEntry,
  CosmosStakingPosition,
  CosmosValidatorSummary,
  PortfolioAsset,
  PortfolioNetworkAsset,
  PortfolioSnapshot,
  DappSessionsSnapshot,
  UnifiedDappSession,
} from './types.js';

const AUTO_LOCK_ALARM = 'shella-auto-lock';
const TX_POLL_ALARM = 'shella-tx-poll';
const TON_PENDING_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const TONCONNECT_DAPP_METHODS = ['tonconnect_connect', 'tonconnect_restoreConnection', 'tonconnect_send'];
const APTOS_DAPP_METHODS = ['aptos_connect', 'aptos_account', 'aptos_network', 'aptos_getBalance', 'aptos_signAndSubmitTransaction'];
const PORTFOLIO_BALANCE_TIMEOUT_MS = 2500;
const PORTFOLIO_STALE_AFTER_MS = 60 * 1000;
const PORTFOLIO_EXPIRED_AFTER_MS = 10 * 60 * 1000;
const PORTFOLIO_REFRESH_CONCURRENCY = 2;

let currentSigner: ShellSigner | null = null;
let currentTronPrivateKey: Uint8Array | null = null;
let currentSolanaPrivateKey: Uint8Array | null = null;
let currentBitcoinPrivateKeys: Partial<Record<BitcoinNetwork, Uint8Array>> = {};
let currentCosmosKeyPair: { privateKey: Uint8Array; publicKey: Uint8Array } | null = null;
let currentTonPrivateKey: Uint8Array | null = null;
let currentAptosKeyPair: { privateKey: Uint8Array; publicKey: Uint8Array } | null = null;
let walletConnectBridgePromise: Promise<WalletConnectBridge> | null = null;

interface WalletConnectBridge {
  pair(uri: string, localPairing: WalletConnectPairing): Promise<WalletConnectPairing>;
  getStatus(): WalletConnectRelayStatus;
}

// In-memory nonce tracker: prevents concurrent sendTransaction calls from
// allocating the same nonce before the first is committed to txQueue storage.
// Maps normalised-lowercase address → highest nonce already allocated this session.
const allocatedNonces = new Map<string, number>();
let hdAccountReservation: Promise<void> = Promise.resolve();

type NativeChainKind = Extract<ChainKind, 'tron' | 'solana' | 'bitcoin' | 'cosmos' | 'ton' | 'aptos'>;
type NativeBalance = { balance: string; formatted: string };
type NativeTransactionStatus = {
  status: WalletTxRecord['status'];
  blockNumber?: string | null;
  error?: string;
};
interface NativeChainAdapter {
  deriveAddresses(seed: Uint8Array, accountIndex: number): Partial<Record<ChainAddressKey, string>>;
  unlockKey(seed: Uint8Array, accountIndex: number, account: StoredAccount): void;
  getBalance(network: Network, address: string): Promise<NativeBalance>;
  getNonce?(network: Network, address: string): Promise<number | null>;
  send(network: Network, params: SendTransactionParams): Promise<{ txHash: string }>;
  getTransactionStatus(network: Network, tx: WalletTxRecord): Promise<NativeTransactionStatus>;
  getTransactionHistory?(network: Network, address: string, page: number): Promise<{ txs: WalletTxRecord[]; total: number }>;
}

interface NativeDappTransferRequest {
  to: string;
  value: bigint;
  from?: string;
}

interface NativeDappAdapter {
  chainKind: NativeChainKind;
  displayName: string;
  connectMethods: string[];
  accountsMethod: string;
  chainIdMethod: string;
  balanceMethod: string;
  sendMethods: string[];
  isAccount(value: string): boolean;
  getAccount(account: StoredAccount): string | null;
  formatConnectResponse(accounts: string[]): unknown;
  normalizeTransferRequest(params: unknown[] | undefined): NativeDappTransferRequest;
  formatTransferValue(request: NativeDappTransferRequest): string;
  sendTransfer(network: Network, request: NativeDappTransferRequest): Promise<{ txHash: string }>;
  formatSendResponse(result: { txHash: string }): unknown;
}

interface TokenProviderAdapter {
  chainKind: ChainKind;
  chainDisplayName: string;
  displayName: string;
  messageTypes: string[];
  preflightMessageTypes?: string[];
  dappSendMethod: string;
  getInfo(contractAddress: string): Promise<unknown>;
  addToken(contractAddress: string): Promise<{ ok: boolean }>;
  removeToken(contractAddress: string): Promise<{ ok: boolean }>;
  getBalance(input: {
    contractAddress: string;
    ownerAddress?: string;
    decimals?: number;
    symbol?: string;
  }): Promise<unknown>;
  getHistory?(input: {
    contractAddress: string;
    ownerAddress?: string;
    page?: number;
    limit?: number;
  }): Promise<unknown>;
  sendTransfer(input: {
    contractAddress: string;
    to: string;
    amount: string;
    decimals: number;
    symbol?: string;
    jettonTransferTonAmount?: string;
    forwardTonAmount?: string;
    createRecipientAta?: boolean;
  }): Promise<{ txHash: string }>;
  normalizeDappTransferRequest(params: unknown[] | undefined): {
    contractAddress: string;
    to: string;
    amount: string;
    decimals: number;
    symbol?: string;
    jettonTransferTonAmount?: string;
    forwardTonAmount?: string;
    createRecipientAta?: boolean;
  };
  formatDappSendResponse(result: { txHash: string }): unknown;
}

const NATIVE_CHAIN_ADAPTERS: Record<NativeChainKind, NativeChainAdapter> = {
  tron: {
    deriveAddresses: (seed, accountIndex) => ({ tron: deriveTronAddress(seed, accountIndex) }),
    unlockKey: (seed, accountIndex, account) => {
      const keyPair = deriveTronKeyPair(seed, accountIndex);
      if (account.chainAddresses?.tron && keyPair.address !== account.chainAddresses.tron) {
        keyPair.privateKey.fill(0);
        throw new Error('Derived Tron address does not match stored account');
      }
      replaceCurrentTronKey(keyPair.privateKey);
    },
    getBalance: (network, address) => getTronBalance(network.rpcUrl, address),
    send: (network, params) => sendTronTransaction(network, params),
    getTransactionStatus: (network, tx) => getTronTransactionStatus(network.rpcUrl, tx.txHash),
  },
  solana: {
    deriveAddresses: (seed, accountIndex) => ({ solana: deriveSolanaAddress(seed, accountIndex) }),
    unlockKey: (seed, accountIndex, account) => {
      const keyPair = deriveSolanaKeyPair(seed, accountIndex);
      if (account.chainAddresses?.solana && keyPair.address !== account.chainAddresses.solana) {
        keyPair.privateKey.fill(0);
        keyPair.publicKey.fill(0);
        throw new Error('Derived Solana address does not match stored account');
      }
      keyPair.publicKey.fill(0);
      replaceCurrentSolanaKey(keyPair.privateKey);
    },
    getBalance: (network, address) => getSolanaBalance(network.rpcUrl, address),
    send: (network, params) => sendSolanaTransaction(network, params),
    getTransactionStatus: (network, tx) => getSolanaTransactionStatus(network.rpcUrl, tx.txHash),
  },
  bitcoin: {
    deriveAddresses: (seed, accountIndex) => ({
      bitcoin: deriveBitcoinAddress(seed, accountIndex, 'mainnet'),
      bitcoinTestnet: deriveBitcoinAddress(seed, accountIndex, 'testnet'),
    }),
    unlockKey: (seed, accountIndex, account) => {
      const mainnetKeyPair = deriveBitcoinKeyPair(seed, accountIndex, 'mainnet');
      const testnetKeyPair = deriveBitcoinKeyPair(seed, accountIndex, 'testnet');
      if (account.chainAddresses?.bitcoin && mainnetKeyPair.address !== account.chainAddresses.bitcoin) {
        mainnetKeyPair.privateKey.fill(0);
        mainnetKeyPair.publicKey.fill(0);
        testnetKeyPair.privateKey.fill(0);
        testnetKeyPair.publicKey.fill(0);
        throw new Error('Derived Bitcoin address does not match stored account');
      }
      if (account.chainAddresses?.bitcoinTestnet && testnetKeyPair.address !== account.chainAddresses.bitcoinTestnet) {
        mainnetKeyPair.privateKey.fill(0);
        mainnetKeyPair.publicKey.fill(0);
        testnetKeyPair.privateKey.fill(0);
        testnetKeyPair.publicKey.fill(0);
        throw new Error('Derived Bitcoin testnet address does not match stored account');
      }
      mainnetKeyPair.publicKey.fill(0);
      testnetKeyPair.publicKey.fill(0);
      replaceCurrentBitcoinKeys({
        mainnet: mainnetKeyPair.privateKey,
        testnet: testnetKeyPair.privateKey,
      });
    },
    getBalance: (network, address) => getBitcoinBalance(network.rpcUrl, address),
    send: (network, params) => sendBitcoinTransaction(network, params),
    getTransactionStatus: (network, tx) => getBitcoinTransactionStatus(network.rpcUrl, tx.txHash),
    getTransactionHistory: (network, address, page) => getBitcoinTransactionHistory(network.rpcUrl, address, page),
  },
  cosmos: {
    deriveAddresses: (seed, accountIndex) => ({ cosmos: deriveCosmosAddress(seed, accountIndex) }),
    unlockKey: (seed, accountIndex, account) => {
      const keyPair = deriveCosmosKeyPair(seed, accountIndex);
      if (account.chainAddresses?.cosmos && keyPair.address !== account.chainAddresses.cosmos) {
        keyPair.privateKey.fill(0);
        keyPair.publicKey.fill(0);
        throw new Error('Derived Cosmos address does not match stored account');
      }
      replaceCurrentCosmosKeyPair({ privateKey: keyPair.privateKey, publicKey: keyPair.publicKey });
    },
    getBalance: (network, address) => getCosmosBalance(network.rpcUrl, address, {
      addressPrefix: getCosmosAddressPrefix(network),
      denom: getCosmosNativeDenom(network),
      decimals: getCosmosNativeDecimals(network),
    }),
    send: (network, params) => sendCosmosTransaction(network, params),
    getTransactionStatus: (network, tx) => getCosmosTransactionStatus(network.rpcUrl, tx.txHash),
  },
  ton: {
    deriveAddresses: (seed, accountIndex) => ({ ton: deriveTonAddress(seed, accountIndex) }),
    unlockKey: (seed, accountIndex, account) => {
      const keyPair = deriveTonKeyPair(seed, accountIndex);
      if (account.chainAddresses?.ton && keyPair.address !== account.chainAddresses.ton) {
        keyPair.privateKey.fill(0);
        keyPair.publicKey.fill(0);
        throw new Error('Derived TON address does not match stored account');
      }
      keyPair.publicKey.fill(0);
      replaceCurrentTonKey(keyPair.privateKey);
    },
    getBalance: (network, address) => getTonBalance(network.rpcUrl, address),
    send: (network, params) => sendTonTransaction(network, params),
    getTransactionStatus: async (network, tx) => {
      if (tx.shellType === 'jettonTransfer' && tx.tokenContract) {
        const jettonStatus = await getTonJettonTransactionStatusForMaster(network.rpcUrl, tx.from, tx.tokenContract, tx.txHash).catch(() => ({ status: 'pending' as const }));
        if (jettonStatus.status !== 'pending') return jettonStatus;
      }
      return getTonTransactionStatus(network.rpcUrl, tx.txHash, tx.from);
    },
    getTransactionHistory: (network, address, page) => getTonTransactionHistory(network.rpcUrl, address, page),
  },
  aptos: {
    deriveAddresses: (seed, accountIndex) => ({ aptos: deriveAptosAddress(seed, accountIndex) }),
    unlockKey: (seed, accountIndex, account) => {
      const keyPair = deriveAptosKeyPair(seed, accountIndex);
      if (account.chainAddresses?.aptos && keyPair.address !== account.chainAddresses.aptos) {
        keyPair.privateKey.fill(0);
        keyPair.publicKey.fill(0);
        throw new Error('Derived Aptos address does not match stored account');
      }
      replaceCurrentAptosKeyPair({ privateKey: keyPair.privateKey, publicKey: keyPair.publicKey });
    },
    getBalance: (network, address) => getAptosBalance(network.rpcUrl, address),
    getNonce: (network, address) => getAptosAccountSequence(network.rpcUrl, address),
    send: (network, params) => sendAptosTransaction(network, params),
    getTransactionStatus: (network, tx) => getAptosTransactionStatus(network.rpcUrl, tx.txHash),
  },
};

const NATIVE_DAPP_ADAPTERS: NativeDappAdapter[] = [
  {
    chainKind: 'tron',
    displayName: 'Tron',
    connectMethods: ['tron_requestAccounts'],
    accountsMethod: 'tron_accounts',
    chainIdMethod: 'tron_chainId',
    balanceMethod: 'tron_getBalance',
    sendMethods: ['tron_sendTransaction'],
    isAccount: (value) => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value),
    getAccount: (account) => getAccountAddressForChain(account, 'tron'),
    formatConnectResponse: (accounts) => ({ code: 200, message: 'ok', accounts }),
    normalizeTransferRequest: (params) => {
      const request = normalizeTronTransferRequest(params);
      return { to: request.to, value: request.amountSun, from: request.from };
    },
    formatTransferValue: (request) => request.value.toString(),
    sendTransfer: (network, request) => sendTronNativeTransfer(network, request.to, request.value),
    formatSendResponse: (result) => result,
  },
  {
    chainKind: 'solana',
    displayName: 'Solana',
    connectMethods: ['solana_requestAccounts', 'solana_connect'],
    accountsMethod: 'solana_accounts',
    chainIdMethod: 'solana_chainId',
    balanceMethod: 'solana_getBalance',
    sendMethods: ['solana_signAndSendTransaction', 'solana_sendTransaction'],
    isAccount: (value) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value),
    getAccount: (account) => getAccountAddressForChain(account, 'solana'),
    formatConnectResponse: (accounts) => ({ publicKey: accounts[0] }),
    normalizeTransferRequest: (params) => {
      const request = normalizeSolanaDappTransferRequest(params);
      return { to: request.to, value: request.lamports, from: request.from };
    },
    formatTransferValue: (request) => request.value.toString(),
    sendTransfer: async (network, request) => sendSolanaNativeTransfer(network, request.to, request.value),
    formatSendResponse: (result) => ({ signature: result.txHash }),
  },
  {
    chainKind: 'cosmos',
    displayName: 'Cosmos',
    connectMethods: [],
    accountsMethod: 'cosmos_accounts',
    chainIdMethod: 'cosmos_chainId',
    balanceMethod: 'cosmos_getBalance',
    sendMethods: [],
    isAccount: (value) => /^(cosmos|osmo)1[ac-hj-np-z02-9]{38}$/.test(value),
    getAccount: (account) => getAccountAddressForChain(account, 'cosmos'),
    formatConnectResponse: (accounts) => ({ accounts }),
    normalizeTransferRequest: () => {
      throw new Error('Cosmos dApp signing is not supported yet');
    },
    formatTransferValue: () => '0',
    sendTransfer: async () => {
      throw new Error('Cosmos dApp signing is not supported yet');
    },
    formatSendResponse: (result) => result,
  },
];

const TOKEN_PROVIDER_ADAPTERS: TokenProviderAdapter[] = [
  {
    chainKind: 'shell',
    chainDisplayName: 'Shell/EVM',
    displayName: 'ERC20',
    messageTypes: ['GET_ERC20_TOKEN_INFO', 'ADD_ERC20_TOKEN', 'REMOVE_ERC20_TOKEN', 'GET_ERC20_BALANCE', 'SEND_ERC20_TRANSFER'],
    dappSendMethod: 'shella_sendErc20Transfer',
    getInfo: (contractAddress) => getErc20Info(contractAddress),
    addToken: (contractAddress) => addErc20Token(contractAddress),
    removeToken: (contractAddress) => removeErc20Token(contractAddress),
    getBalance: (input) => getErc20TokenBalance(input),
    sendTransfer: (input) => sendErc20TokenTransfer(input),
    normalizeDappTransferRequest: (params) => normalizeErc20DappTransferRequest(params),
    formatDappSendResponse: (result) => result,
  },
  {
    chainKind: 'evm',
    chainDisplayName: 'Shell/EVM',
    displayName: 'ERC20',
    messageTypes: ['GET_ERC20_TOKEN_INFO', 'ADD_ERC20_TOKEN', 'REMOVE_ERC20_TOKEN', 'GET_ERC20_BALANCE', 'SEND_ERC20_TRANSFER'],
    dappSendMethod: 'shella_sendErc20Transfer',
    getInfo: (contractAddress) => getErc20Info(contractAddress),
    addToken: (contractAddress) => addErc20Token(contractAddress),
    removeToken: (contractAddress) => removeErc20Token(contractAddress),
    getBalance: (input) => getErc20TokenBalance(input),
    sendTransfer: (input) => sendErc20TokenTransfer(input),
    normalizeDappTransferRequest: (params) => normalizeErc20DappTransferRequest(params),
    formatDappSendResponse: (result) => result,
  },
  {
    chainKind: 'tron',
    chainDisplayName: 'Tron',
    displayName: 'TRC20',
    messageTypes: ['GET_TRC20_TOKEN_INFO', 'ADD_TRC20_TOKEN', 'REMOVE_TRC20_TOKEN', 'GET_TRC20_BALANCE', 'SEND_TRC20_TRANSFER'],
    dappSendMethod: 'tron_sendTrc20Transfer',
    getInfo: (contractAddress) => getTrc20Info(contractAddress),
    addToken: (contractAddress) => addTrc20Token(contractAddress),
    removeToken: (contractAddress) => removeTrc20Token(contractAddress),
    getBalance: (input) => getTrc20TokenBalance(input),
    sendTransfer: (input) => sendTrc20TokenTransfer(input),
    normalizeDappTransferRequest: (params) => normalizeTrc20DappTransferRequest(params),
    formatDappSendResponse: (result) => result,
  },
  {
    chainKind: 'solana',
    chainDisplayName: 'Solana',
    displayName: 'SPL',
    messageTypes: ['GET_SPL_TOKEN_INFO', 'ADD_SPL_TOKEN', 'REMOVE_SPL_TOKEN', 'GET_SPL_BALANCE', 'SEND_SPL_TRANSFER'],
    preflightMessageTypes: ['GET_SPL_RECIPIENT_ACCOUNT_STATUS'],
    dappSendMethod: 'solana_sendSplTransfer',
    getInfo: (contractAddress) => getSplInfo(contractAddress),
    addToken: (contractAddress) => addSplToken(contractAddress),
    removeToken: (contractAddress) => removeSplToken(contractAddress),
    getBalance: (input) => getSplTokenBalanceForActiveAccount(input),
    sendTransfer: (input) => sendSplTokenTransferForActiveAccount(input),
    normalizeDappTransferRequest: (params) => normalizeSplDappTransferRequest(params),
    formatDappSendResponse: (result) => result,
  },
  {
    chainKind: 'ton',
    chainDisplayName: 'TON',
    displayName: 'Jetton',
    messageTypes: ['GET_JETTON_TOKEN_INFO', 'ADD_JETTON_TOKEN', 'REMOVE_JETTON_TOKEN', 'GET_JETTON_BALANCE', 'GET_JETTON_HISTORY', 'SEND_JETTON_TRANSFER'],
    dappSendMethod: 'ton_sendJettonTransfer',
    getInfo: (contractAddress) => getJettonInfo(contractAddress),
    addToken: (contractAddress) => addJettonToken(contractAddress),
    removeToken: (contractAddress) => removeJettonToken(contractAddress),
    getBalance: (input) => getJettonTokenBalance(input),
    getHistory: (input) => getJettonTokenHistory(input),
    sendTransfer: (input) => sendJettonTokenTransfer(input),
    normalizeDappTransferRequest: (params) => normalizeJettonDappTransferRequest(params),
    formatDappSendResponse: (result) => result,
  },
];

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const COSMOS_WALLETCONNECT_SIGN_METHODS = ['cosmos_signDirect', 'cosmos_signAmino'];

chrome.runtime.onInstalled.addListener(async () => {
  await initStore();
  await pollPendingTransactions();
});

chrome.runtime.onStartup.addListener(async () => {
  disposeCurrentSigner();
  await clearSessionState();
  await pollPendingTransactions();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === AUTO_LOCK_ALARM) {
    await lockWallet();
    return;
  }
  if (alarm.name === TX_POLL_ALARM) {
    await pollPendingTransactions();
  }
});

chrome.windows.onRemoved.addListener((windowId) => {
  handleApprovalWindowRemoved(windowId);
});

const CONTENT_SCRIPT_MESSAGE_TYPES = new Set(['DAPP_REQUEST']);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const type = (msg as { type?: string }).type ?? '';

  if (!isExtensionPageSender(sender) && !CONTENT_SCRIPT_MESSAGE_TYPES.has(type)) {
    sendResponse({ ok: false, error: 'Unauthorized' });
    return true;
  }

  handleMessage(msg as { type: string; [key: string]: unknown })
    .then(sendResponse)
    .catch((err: unknown) => {
      sendResponse({ ok: false, error: toSafeErrorMessage(err) });
    });
  return true;
});

function isExtensionPageSender(sender?: chrome.runtime.MessageSender): boolean {
  if (!sender) return false;
  const extensionUrl = chrome.runtime.getURL('');
  return sender.id === chrome.runtime.id
    && typeof sender.url === 'string'
    && sender.url.startsWith(extensionUrl);
}

async function scheduleAutoLock(): Promise<void> {
  const minutes = await getAutoLockMinutes();
  if (minutes > 0) {
    chrome.alarms.create(AUTO_LOCK_ALARM, { delayInMinutes: minutes });
    return;
  }
  chrome.alarms.clear(AUTO_LOCK_ALARM);
}

async function scheduleTxPolling(): Promise<void> {
  const txQueue = await getTxQueue();
  if (txQueue.some((tx) => tx.status === 'pending')) {
    chrome.alarms.create(TX_POLL_ALARM, { delayInMinutes: 0.5, periodInMinutes: 0.5 });
  } else {
    chrome.alarms.clear(TX_POLL_ALARM);
  }
}

async function lockWallet(): Promise<void> {
  disposeCurrentSigner();
  await clearSessionState();
  chrome.alarms.clear(AUTO_LOCK_ALARM);
}

function disposeCurrentSigner(): void {
  currentSigner?.dispose();
  currentSigner = null;
  currentTronPrivateKey?.fill(0);
  currentTronPrivateKey = null;
  currentSolanaPrivateKey?.fill(0);
  currentSolanaPrivateKey = null;
  replaceCurrentBitcoinKeys({});
  replaceCurrentCosmosKeyPair(null);
  replaceCurrentTonKey(null);
  replaceCurrentAptosKeyPair(null);
}

function replaceCurrentSigner(signer: ShellSigner): void {
  disposeCurrentSigner();
  currentSigner = signer;
}

function replaceCurrentTronKey(privateKey: Uint8Array | null): void {
  currentTronPrivateKey?.fill(0);
  currentTronPrivateKey = privateKey;
}

function replaceCurrentSolanaKey(privateKey: Uint8Array | null): void {
  currentSolanaPrivateKey?.fill(0);
  currentSolanaPrivateKey = privateKey;
}

function replaceCurrentBitcoinKeys(privateKeys: Partial<Record<BitcoinNetwork, Uint8Array>>): void {
  for (const key of Object.values(currentBitcoinPrivateKeys)) key?.fill(0);
  currentBitcoinPrivateKeys = privateKeys;
}

function replaceCurrentCosmosKeyPair(keyPair: { privateKey: Uint8Array; publicKey: Uint8Array } | null): void {
  currentCosmosKeyPair?.privateKey.fill(0);
  currentCosmosKeyPair?.publicKey.fill(0);
  currentCosmosKeyPair = keyPair;
}

function replaceCurrentTonKey(privateKey: Uint8Array | null): void {
  if (currentTonPrivateKey) currentTonPrivateKey.fill(0);
  currentTonPrivateKey = privateKey;
}

function replaceCurrentAptosKeyPair(keyPair: { privateKey: Uint8Array; publicKey: Uint8Array } | null): void {
  currentAptosKeyPair?.privateKey.fill(0);
  currentAptosKeyPair?.publicKey.fill(0);
  currentAptosKeyPair = keyPair;
}

export async function handleMessage(msg: { type: string; [key: string]: unknown }): Promise<unknown> {
  const tokenProvider = getTokenProviderAdapterForMessage(msg.type);
  if (tokenProvider) {
    return handleTokenProviderMessage(tokenProvider, msg);
  }

  switch (msg.type) {
    case 'CREATE_WALLET':
      return createWallet(requirePassword(msg.password));
    case 'CREATE_HD_WALLET':
      return createHdWallet(requireString(msg.mnemonic, 'mnemonic'), requirePassword(msg.password));
    case 'RESTORE_HD_WALLET':
      return restoreHdWallet(requireString(msg.mnemonic, 'mnemonic'), requirePassword(msg.password));
    case 'GENERATE_MNEMONIC':
      return { mnemonic: generateMnemonic(256) };
    case 'REVEAL_MNEMONIC':
      return revealMnemonic(requirePassword(msg.password));
    case 'AUTHORIZE_SESSION_KEY':
      return authorizeSessionKey({
        password: requirePassword(msg.password),
        sessionIndex: optionalNumber(msg.sessionIndex) ?? 0,
        rootAccountIndex: optionalNumber(msg.rootAccountIndex) ?? 0,
        expiryBlock: requireNumber(msg.expiryBlock, 'expiryBlock'),
        valueCap: requireBigIntQuantity(msg.valueCap, 'valueCap'),
        target: optionalNullableString(msg.target),
        txSigningHash: optionalString(msg.txSigningHash),
      });
    case 'ROTATE_KEY':
      return rotateActiveKey(requirePassword(msg.password));
    case 'IMPORT_KEYSTORE':
      return importKeystore(requireString(msg.keystoreJson, 'keystoreJson'), requirePassword(msg.password));
    case 'UNLOCK_WALLET':
      return unlockWallet(requirePassword(msg.password), {
        address: typeof msg.address === 'string' ? msg.address : undefined,
        accountId: typeof msg.accountId === 'string' ? msg.accountId : undefined,
      });
    case 'ADD_ACCOUNT':
      return createAdditionalAccount(requirePassword(msg.password));
    case 'SWITCH_ACCOUNT':
      return unlockWallet(requirePassword(msg.password), {
        address: optionalString(msg.address),
        accountId: optionalString(msg.accountId),
      });
    case 'LOCK_WALLET':
      await lockWallet();
      return { ok: true };
    case 'CHECK_LOCKED':
      return { locked: currentSigner === null };
    case 'GET_WALLET_SNAPSHOT':
      return getWalletSnapshot();
    case 'GET_PORTFOLIO_SNAPSHOT':
      return getPortfolioSnapshot();
    case 'REFRESH_PORTFOLIO_SNAPSHOT':
      return refreshPortfolioSnapshot();
    case 'GET_ACCOUNTS':
      return { accounts: await getAccounts() };
    case 'GET_BALANCE':
      return getBalance(requireString(msg.address, 'address'));
    case 'GET_COSMOS_BALANCES':
      return { balances: await getCosmosBalances(requireString(msg.address, 'address')) };
    case 'GET_COSMOS_STAKING':
      return { positions: await getCosmosStaking(requireString(msg.address, 'address')) };
    case 'GET_COSMOS_REDELEGATIONS':
      return { redelegations: await getCosmosRedelegationsForAddress(requireString(msg.address, 'address')) };
    case 'GET_COSMOS_VALIDATORS':
      return { validators: await getCosmosValidatorSummaries() };
    case 'GET_COSMOS_GOVERNANCE_PROPOSALS':
      return { proposals: await getCosmosGovernanceProposalSummaries(optionalString(msg.address)) };
    case 'GET_COSMOS_IBC_CONTEXT':
      return getCosmosIbcContextForActiveNetwork(requireString(msg.address, 'address'));
    case 'DELEGATE_COSMOS_STAKE':
      return sendCosmosStaking('delegate', {
        validatorAddress: requireString(msg.validatorAddress, 'validatorAddress'),
        amount: requireString(msg.amount, 'amount'),
        memo: optionalString(msg.memo),
      });
    case 'UNDELEGATE_COSMOS_STAKE':
      return sendCosmosStaking('undelegate', {
        validatorAddress: requireString(msg.validatorAddress, 'validatorAddress'),
        amount: requireString(msg.amount, 'amount'),
        memo: optionalString(msg.memo),
      });
    case 'REDELEGATE_COSMOS_STAKE':
      return redelegateCosmosStake({
        sourceValidatorAddress: requireString(msg.sourceValidatorAddress, 'sourceValidatorAddress'),
        destinationValidatorAddress: requireString(msg.destinationValidatorAddress, 'destinationValidatorAddress'),
        amount: requireString(msg.amount, 'amount'),
        memo: optionalString(msg.memo),
      });
    case 'WITHDRAW_COSMOS_REWARDS':
      return withdrawCosmosRewards({
        validatorAddress: requireString(msg.validatorAddress, 'validatorAddress'),
        memo: optionalString(msg.memo),
      });
    case 'VOTE_COSMOS_GOVERNANCE':
      return voteCosmosGovernance({
        proposalId: requireString(msg.proposalId, 'proposalId'),
        option: requireString(msg.option, 'option'),
        memo: optionalString(msg.memo),
      });
    case 'GET_CHAIN_CAPABILITIES': {
      const network = msg.network ? validateNetwork(msg.network) : await getNetwork();
      return getChainCapabilities(getChainKind(network));
    }
    case 'GET_BITCOIN_UTXO_PREFERENCES':
      return { preferences: await getBitcoinUtxoPreferences() };
    case 'GET_BITCOIN_UTXOS':
      return { inputs: await getBitcoinUtxosForAddress(requireString(msg.address, 'address')) };
    case 'SET_BITCOIN_UTXO_PREFERENCE':
      await upsertBitcoinUtxoPreference(normalizeBitcoinUtxoPreference(msg.preference));
      return { preferences: await getBitcoinUtxoPreferences() };
    case 'SET_BITCOIN_UTXO_PREFERENCES':
      await upsertBitcoinUtxoPreferences(normalizeBitcoinUtxoPreferencesMessage(msg.preferences));
      return { preferences: await getBitcoinUtxoPreferences() };
    case 'GET_DAPP_METHODS': {
      const network = msg.network ? validateNetwork(msg.network) : await getNetwork();
      return { methods: getAllowedDappMethodsForNetwork(network) };
    }
    case 'GET_DAPP_SESSIONS_SNAPSHOT':
      return getDappSessionsSnapshot();
    case 'REVOKE_DAPP_SESSION':
      return revokeDappSession(requireString(msg.sessionId, 'sessionId'));
    case 'PREVIEW_APTOS_DAPP_PAYLOAD':
      return previewAptosDappPayload(msg.payload);
    case 'CREATE_WALLETCONNECT_SESSION':
      return createWalletConnectSession({
        topic: requireString(msg.topic, 'topic'),
        origin: requireString(msg.origin, 'origin'),
        chainIds: optionalNumberArray(msg.chainIds),
        methods: optionalStringArray(msg.methods),
        expirySeconds: optionalNumber(msg.expirySeconds),
      });
    case 'START_WALLETCONNECT_PAIRING':
      return startWalletConnectPairing(requireString(msg.uri, 'uri'), {
        expirySeconds: optionalNumber(msg.expirySeconds),
        useRelay: msg.useRelay === true,
        projectId: optionalString(msg.projectId),
        relayUrl: optionalString(msg.relayUrl),
      });
    case 'GET_WALLETCONNECT_PAIRINGS':
      return { pairings: await getWalletConnectPairings() };
    case 'GET_WALLETCONNECT_CONFIG':
      return getWalletConnectConfig();
    case 'SET_WALLETCONNECT_CONFIG':
      await setWalletConnectConfig({
        projectId: optionalString(msg.projectId) ?? '',
        relayUrl: optionalString(msg.relayUrl) ?? '',
      });
      return getWalletConnectConfig();
    case 'GET_WALLETCONNECT_RELAY_STATUS':
      return getWalletConnectRelayStatus();
    case 'REMOVE_WALLETCONNECT_PAIRING':
      await removeWalletConnectPairing(requireString(msg.topic, 'topic'));
      return { ok: true };
    case 'PREVIEW_WALLETCONNECT_PROPOSAL':
      return previewWalletConnectProposal({
        origin: requireString(msg.origin, 'origin'),
        requiredNamespaces: normalizeWalletConnectNamespaces(msg.requiredNamespaces, 'requiredNamespaces'),
        optionalNamespaces: normalizeWalletConnectNamespaces(msg.optionalNamespaces, 'optionalNamespaces'),
      });
    case 'CREATE_WALLETCONNECT_SESSION_FROM_PROPOSAL':
      return createWalletConnectSessionFromProposal({
        topic: requireString(msg.topic, 'topic'),
        origin: requireString(msg.origin, 'origin'),
        requiredNamespaces: normalizeWalletConnectNamespaces(msg.requiredNamespaces, 'requiredNamespaces'),
        optionalNamespaces: normalizeWalletConnectNamespaces(msg.optionalNamespaces, 'optionalNamespaces'),
        expirySeconds: optionalNumber(msg.expirySeconds),
      });
    case 'APPROVE_WALLETCONNECT_PROPOSAL':
      return approveWalletConnectProposal({
        topic: requireString(msg.topic, 'topic'),
        origin: requireString(msg.origin, 'origin'),
        requiredNamespaces: normalizeWalletConnectNamespaces(msg.requiredNamespaces, 'requiredNamespaces'),
        optionalNamespaces: normalizeWalletConnectNamespaces(msg.optionalNamespaces, 'optionalNamespaces'),
        expirySeconds: optionalNumber(msg.expirySeconds),
      });
    case 'GET_WALLETCONNECT_SESSIONS':
      return { sessions: await getWalletConnectSessions() };
    case 'REMOVE_WALLETCONNECT_SESSION':
      await removeWalletConnectSession(requireString(msg.topic, 'topic'));
      return { ok: true };
    case 'CREATE_TONCONNECT_SESSION':
      return createTonConnectSession({
        clientId: requireString(msg.clientId, 'clientId'),
        origin: requireString(msg.origin, 'origin'),
        manifestUrl: requireString(msg.manifestUrl, 'manifestUrl'),
        features: normalizeTonConnectFeatures(msg.features),
        expirySeconds: optionalNumber(msg.expirySeconds),
      });
    case 'APPROVE_TONCONNECT_PROPOSAL':
      return approveTonConnectProposal({
        clientId: requireString(msg.clientId, 'clientId'),
        origin: requireString(msg.origin, 'origin'),
        manifestUrl: requireString(msg.manifestUrl, 'manifestUrl'),
        requestedItems: optionalStringArray(msg.requestedItems),
        features: normalizeTonConnectFeatures(msg.features),
        expirySeconds: optionalNumber(msg.expirySeconds),
      });
    case 'GET_TONCONNECT_SESSIONS':
      return { sessions: await getTonConnectSessions() };
    case 'REMOVE_TONCONNECT_SESSION':
      await removeTonConnectSession(requireString(msg.clientId, 'clientId'));
      return { ok: true };
    case 'VALIDATE_WALLETCONNECT_REQUEST':
      return validateWalletConnectRequest({
        topic: requireString(msg.topic, 'topic'),
        chainId: requireNumber(msg.chainId, 'chainId'),
        method: requireString(msg.method, 'method'),
      });
    case 'EXECUTE_WALLETCONNECT_REQUEST':
      return executeWalletConnectRequest({
        topic: requireString(msg.topic, 'topic'),
        chainId: requireNumber(msg.chainId, 'chainId'),
        method: requireString(msg.method, 'method'),
        params: Array.isArray(msg.params) ? msg.params : [],
      });
    case 'EXECUTE_WALLETCONNECT_SESSION_REQUEST':
      return executeWalletConnectSessionRequest({
        topic: requireString(msg.topic, 'topic'),
        chainId: requireString(msg.chainId, 'chainId'),
        request: normalizeWalletConnectRequestPayload(msg.request),
      });
    case 'HANDLE_WALLETCONNECT_EVENT':
      return handleWalletConnectEvent(normalizeWalletConnectEvent(msg.event));
    case 'HANDLE_WALLETCONNECT_RPC_EVENT':
      return handleWalletConnectRpcEvent(normalizeWalletConnectRpcEvent(msg.event));
    case 'PREVIEW_SEND_TX':
      return previewSendTransaction({
        to: requireString(msg.to, 'to'),
        value: requireString(msg.value, 'value'),
        feeRateSatVb: optionalNumber(msg.feeRateSatVb),
        bitcoinInputs: normalizeBitcoinInputs(msg.bitcoinInputs),
      });
    case 'BUMP_BITCOIN_FEE':
      return bumpBitcoinFee({
        txHash: requireString(msg.txHash, 'txHash'),
        feeRateSatVb: requireNumber(msg.feeRateSatVb, 'feeRateSatVb'),
      });
    case 'BUMP_BITCOIN_CPFP':
      return bumpBitcoinCpfp({
        txHash: requireString(msg.txHash, 'txHash'),
        feeRateSatVb: requireNumber(msg.feeRateSatVb, 'feeRateSatVb'),
      });
    case 'SEND_TX':
      return sendTransaction({
        to: requireString(msg.to, 'to'),
        value: requireString(msg.value, 'value'),
        data: optionalString(msg.data),
        gasLimit: optionalNumber(msg.gasLimit),
        maxFeePerGas: optionalNumber(msg.maxFeePerGas),
        maxPriorityFeePerGas: optionalNumber(msg.maxPriorityFeePerGas),
        feeRateSatVb: optionalNumber(msg.feeRateSatVb),
        bitcoinInputs: normalizeBitcoinInputs(msg.bitcoinInputs),
        cosmosMemo: optionalString(msg.cosmosMemo),
      });
    case 'REVOKE_ERC20_APPROVAL':
      return revokeErc20Approval({
        tokenContract: requireString(msg.tokenContract, 'tokenContract'),
        spender: requireString(msg.spender, 'spender'),
      });
    case 'GET_TX_HISTORY':
      return getTxHistory(requireString(msg.address, 'address'), optionalNumber(msg.page) ?? 0);
    case 'GET_NETWORK':
      return { network: await getNetwork() };
    case 'SET_NETWORK':
      await setNetwork(validateNetwork(msg.network));
      return { ok: true };
    case 'EXPORT_KEYSTORE': {
      const active = await getActiveAccount();
      if (!active) throw new Error('No wallet to export');
      return { keystoreJson: active.keystoreJson };
    }
    case 'RESET_WALLET':
      await lockWallet();
      await clearAllData();
      return { ok: true };
    case 'SET_AUTO_LOCK':
      await setAutoLockMinutes(requireNumber(msg.minutes, 'minutes'));
      await scheduleAutoLock();
      return { ok: true };
    case 'GET_CONNECTED_SITES':
      return { sites: await getConnectedSites() };
    case 'GET_PROVIDER_DISABLED_ORIGINS':
      return { origins: await getProviderDisabledOrigins() };
    case 'SET_PROVIDER_ORIGIN_DISABLED':
      return {
        origins: await setProviderOriginDisabled(
          requireString(msg.origin, 'origin'),
          optionalBoolean(msg.disabled) ?? false,
        ),
      };
    case 'ADD_CONNECTED_SITE':
      await addConnectedSite({
        origin: normalizeOrigin(requireString(msg.origin, 'origin')),
        accounts: [],
        chainId: (await getNetwork()).chainId,
        grantedAt: Date.now(),
        lastUsedAt: Date.now(),
      });
      return { ok: true };
    case 'REMOVE_CONNECTED_SITE':
      await removeConnectedSite(normalizeOrigin(requireString(msg.origin, 'origin')));
      return { ok: true };
    case 'HIDE_WATCHED_TOKEN':
      await setWatchedTokenHidden(
        requireChainKind(msg.chainKind, 'chainKind'),
        requireNumber(msg.chainId, 'chainId'),
        requireString(msg.contractAddress, 'contractAddress'),
        true,
      );
      return { ok: true };
    case 'SHOW_WATCHED_TOKEN':
      await setWatchedTokenHidden(
        requireChainKind(msg.chainKind, 'chainKind'),
        requireNumber(msg.chainId, 'chainId'),
        requireString(msg.contractAddress, 'contractAddress'),
        false,
      );
      return { ok: true };
    case 'DISCONNECT_ALL_SITES':
      await Promise.all([
        clearConnectedSites(),
        clearProviderDisabledOrigins(),
        clearWalletConnectSessions(),
        clearWalletConnectPairings(),
        clearWalletConnectSdkStorage(),
        clearTonConnectSessions(),
      ]);
      return { ok: true };
    case 'GET_NODE_INFO':
      return getNodeInfoFromNode((await getNetwork()).rpcUrl);
    case 'DAPP_REQUEST':
      return handleDappRequest({
        origin: requireString(msg.origin, 'origin'),
        method: requireString(msg.method, 'method'),
        params: Array.isArray(msg.params) ? msg.params : [],
        interactive: Boolean(msg.interactive),
      });
    case 'GET_APPROVAL_REQUEST':
      return getApprovalRequest(requireString(msg.requestId, 'requestId'));
    case 'RESOLVE_APPROVAL':
      return resolveApprovalRequest(requireString(msg.requestId, 'requestId'), Boolean(msg.approved));
    default:
      throw new Error(`Unknown message type: ${msg.type}`);
  }
}

async function createWallet(password: string): Promise<{ pqAddress: string }> {
  const { publicKey: pk, secretKey: sk } = generateMlDsa65KeyPair();
  // WALLET-H1: pass an owned copy into the adapter so that zeroing sk below
  // does not corrupt the live signer's key buffer.
  const adapter = MlDsa65Adapter.fromKeyPair(pk, sk.slice());
  const signer = new ShellSigner('MlDsa65', adapter);
  const pqAddress = signer.getAddress();

  const keystore = await createKeystore(sk, pk, password, pqAddress, 'mldsa65');
  const account: StoredAccount = { pqAddress, keystoreJson: JSON.stringify(keystore) };
  await addStoredAccount(account);

  replaceCurrentSigner(signer);
  replaceCurrentTronKey(null);
  replaceCurrentSolanaKey(null);
  replaceCurrentBitcoinKeys({});
  replaceCurrentCosmosKeyPair(null);
  replaceCurrentTonKey(null);
  await setSessionState({
    unlockedPqAddress: pqAddress,
    unlockedAt: Date.now(),
  });
  await setLastActiveAddress(pqAddress);
  await setLastActiveAccountId(getAccountId(account));
  await scheduleAutoLock();
  sk.fill(0); // zero ephemeral local copy; adapter holds its own copy

  return { pqAddress };
}

async function importKeystore(
  keystoreJson: string,
  password: string,
): Promise<{ pqAddress: string }> {
  const parsed = parseKeystorePayload(keystoreJson);
  const { secretKey, publicKey } = await decryptKeystore(parsed, password);

  // WALLET-H1: pass an owned copy into the adapter so that zeroing secretKey below
  // does not corrupt the live signer's key buffer.
  const adapter = MlDsa65Adapter.fromKeyPair(publicKey, secretKey.slice());
  const signer = new ShellSigner('MlDsa65', adapter);
  const pqAddress = signer.getAddress();

  const account: StoredAccount = { pqAddress, keystoreJson: JSON.stringify(parsed) };
  await addStoredAccount(account);

  replaceCurrentSigner(signer);
  replaceCurrentTronKey(null);
  replaceCurrentSolanaKey(null);
  replaceCurrentBitcoinKeys({});
  replaceCurrentCosmosKeyPair(null);
  replaceCurrentTonKey(null);
  await setSessionState({ unlockedPqAddress: pqAddress, unlockedAt: Date.now() });
  await setLastActiveAddress(pqAddress);
  await setLastActiveAccountId(getAccountId(account));
  await scheduleAutoLock();
  secretKey.fill(0); // zero ephemeral local copy; adapter holds its own copy

  return { pqAddress };
}

async function createAdditionalAccount(password: string): Promise<{ pqAddress: string }> {
  // If an HD wallet exists, derive the next HD account from the seed.
  const hdStore = await getHdStore();
  if (hdStore) {
    const { hdStore: reservedHdStore, accountIndex } = await reserveNextHdAccountIndex();

    const seed = await decryptHdSeed(reservedHdStore.seedKeystoreJson, password);
    const account = deriveAccount(seed, 'ml-dsa-65', accountIndex, 0, 0);
    const chainAddresses = deriveNativeChainAddresses(seed, accountIndex, account.address);
    seed.fill(0);
    const keystore = await createKeystore(account.secretKey, account.publicKey, password, account.address, 'mldsa65');
    await addStoredAccount({
      pqAddress: account.address,
      keystoreJson: JSON.stringify(keystore),
      chainAddresses,
      derivationIndex: accountIndex,
    });
    account.secretKey.fill(0);

    return { pqAddress: account.address };
  }

  // Fallback: generate a new random keypair (non-HD wallet).
  const { publicKey: pk, secretKey: sk } = generateMlDsa65KeyPair();
  const adapter = MlDsa65Adapter.fromKeyPair(pk, sk.slice());
  const pqAddress = new ShellSigner('MlDsa65', adapter).getAddress();

  const keystore = await createKeystore(sk, pk, password, pqAddress, 'mldsa65');
  await addStoredAccount({ pqAddress, keystoreJson: JSON.stringify(keystore) });
  sk.fill(0);

  return { pqAddress };
}

async function reserveNextHdAccountIndex(): Promise<{
  hdStore: NonNullable<Awaited<ReturnType<typeof getHdStore>>>;
  accountIndex: number;
}> {
  const previous = hdAccountReservation;
  let release!: () => void;
  hdAccountReservation = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    const hdStore = await getHdStore();
    if (!hdStore) throw new Error('No HD wallet found');
    const accountIndex = hdStore.accountCount;
    await setHdStore({ ...hdStore, accountCount: accountIndex + 1 });
    return { hdStore, accountIndex };
  } finally {
    release();
  }
}

/**
 * Create a new HD wallet from a BIP-39 mnemonic (generated or user-provided).
 * Derives ML-DSA-65 account 0 at path m/9000'/8888'/1'/0'/0'/0' (all hardened),
 * stores the encrypted seed and mnemonic, and unlocks the wallet.
 */
async function createHdWallet(mnemonic: string, password: string): Promise<{ pqAddress: string }> {
  if (!validateHdMnemonic(mnemonic)) throw new Error('Invalid BIP-39 mnemonic');

  const seed = mnemonicToSeed(mnemonic);
  const account = deriveAccount(seed, 'ml-dsa-65', 0, 0, 0);

  const seedKeystore = await encryptHdSeed(seed, password, account.address);
  const mnemonicKeystore = await encryptMnemonic(mnemonic, password);
  const chainAddresses = deriveNativeChainAddresses(seed, 0, account.address);

  await setHdStore({
    seedKeystoreJson: JSON.stringify(seedKeystore),
    mnemonicKeystoreJson: JSON.stringify(mnemonicKeystore),
    accountCount: 1,
  });

  const keystore = await createKeystore(account.secretKey, account.publicKey, password, account.address, 'mldsa65');
  await addStoredAccount({
    pqAddress: account.address,
    keystoreJson: JSON.stringify(keystore),
    chainAddresses,
    derivationIndex: 0,
  });

  const adapter = MlDsa65Adapter.fromKeyPair(account.publicKey, account.secretKey.slice());
  const signer = new ShellSigner('MlDsa65', adapter);
  account.secretKey.fill(0);

  replaceCurrentSigner(signer);
  try {
    unlockNativeChainKeysFromSeed(seed, 0, { pqAddress: account.address, keystoreJson: JSON.stringify(keystore), chainAddresses, derivationIndex: 0 });
  } finally {
    seed.fill(0);
  }
  await setSessionState({ unlockedPqAddress: account.address, unlockedAt: Date.now() });
  await setLastActiveAddress(account.address);
  await setLastActiveAccountId(getAccountId({
    pqAddress: account.address,
    keystoreJson: JSON.stringify(keystore),
    chainAddresses,
    derivationIndex: 0,
  }));
  await scheduleAutoLock();

  return { pqAddress: account.address };
}

/** Restore an HD wallet from an existing BIP-39 mnemonic (same logic as create). */
async function restoreHdWallet(mnemonic: string, password: string): Promise<{ pqAddress: string }> {
  return createHdWallet(mnemonic, password);
}

/**
 * Reveal the recovery mnemonic after password verification.
 * The mnemonic is only available if the wallet was created as an HD wallet.
 */
async function revealMnemonic(password: string): Promise<{ mnemonic: string }> {
  const hdStore = await getHdStore();
  if (!hdStore) throw new Error('No HD wallet found. Recovery phrase is only available for HD wallets.');

  const mnemonic = await decryptMnemonic(hdStore.mnemonicKeystoreJson, password);
  return { mnemonic };
}

async function authorizeSessionKey(input: {
  password: string;
  sessionIndex: number;
  rootAccountIndex: number;
  expiryBlock: number;
  valueCap: bigint;
  target: string | null;
  txSigningHash?: string;
}): Promise<{
  rootAddress: string;
  sessionAddress: string;
  sessionPath: string;
  sessionAuth: SessionAuth;
}> {
  const hdStore = await getHdStore();
  if (!hdStore) throw new Error('No HD wallet found. Session keys require an HD seed.');
  if (!Number.isInteger(input.sessionIndex) || input.sessionIndex < 0) {
    throw new Error('sessionIndex must be a non-negative integer');
  }
  if (!Number.isInteger(input.rootAccountIndex) || input.rootAccountIndex < 0) {
    throw new Error('rootAccountIndex must be a non-negative integer');
  }
  if (!Number.isInteger(input.expiryBlock) || input.expiryBlock <= 0) {
    throw new Error('expiryBlock must be a positive integer');
  }
  if (input.target !== null) {
    normalizeRecipient(input.target);
  }

  const network = await getNetwork();
  const seed = await decryptHdSeed(hdStore.seedKeystoreJson, input.password);
  const rootAccount = deriveAccount(seed, 'ml-dsa-65', input.rootAccountIndex, 0, 0);
  const sessionAccount = deriveSessionKey(seed, 'ml-dsa-65', input.sessionIndex);
  seed.fill(0);

  const rootAdapter = MlDsa65Adapter.fromKeyPair(rootAccount.publicKey, rootAccount.secretKey.slice());
  const sessionAdapter = MlDsa65Adapter.fromKeyPair(sessionAccount.publicKey, sessionAccount.secretKey.slice());

  try {
    const activeAccount = await getActiveAccount();
    if (activeAccount && activeAccount.pqAddress !== rootAccount.address) {
      throw new Error('Active account does not match the requested rootAccountIndex');
    }

    let sessionAuth = await createSessionAuth(rootAdapter, sessionAccount.publicKey, sessionAccount.algoId, {
      chainId: BigInt(network.chainId),
      expiryBlock: input.expiryBlock,
      valueCap: input.valueCap,
      target: input.target,
    });

    if (input.txSigningHash) {
      sessionAuth = await finalizeSessionAuth(
        sessionAuth,
        sessionAdapter,
        parseSigningHash(input.txSigningHash),
      );
    }

    return {
      rootAddress: rootAccount.address,
      sessionAddress: sessionAccount.address,
      sessionPath: sessionAccount.path,
      sessionAuth,
    };
  } finally {
    rootAdapter.dispose();
    sessionAdapter.dispose();
    rootAccount.secretKey.fill(0);
    sessionAccount.secretKey.fill(0);
  }
}

async function getActiveAccount(): Promise<StoredAccount | null> {
  const accounts = await getAccounts();
  if (accounts.length === 0) return null;

  // When unlocked, the signer address is authoritative.
  if (currentSigner) {
    const addr = currentSigner.getAddress();
    const match = accounts.find(a => a.pqAddress === addr);
    if (match) return match;
  }

  const lastAccountId = await getLastActiveAccountId();
  if (lastAccountId) {
    const match = accounts.find(a => getAccountId(a) === lastAccountId);
    if (match) return match;
  }

  // Fall back to last persisted active address (survives lock).
  const lastAddr = await getLastActiveAddress();
  if (lastAddr) {
    const match = accounts.find(a => a.pqAddress === lastAddr);
    if (match) return match;
  }

  return accounts[0];
}

async function unlockWallet(
  password: string,
  selector: { address?: string; accountId?: string } = {},
): Promise<{ ok: boolean; pqAddress?: string; accountId?: string }> {
  const accounts = await getAccounts();
  if (accounts.length === 0) throw new Error('No wallet found');

  const account = selector.accountId != null
    ? accounts.find(a => getAccountId(a) === selector.accountId)
    : selector.address != null
    ? accounts.find(a => a.pqAddress === selector.address)
    : accounts[0];
  if (!account) throw new Error('Account not found');

  const { secretKey, publicKey } = await decryptKeystore(account.keystoreJson, password);

  // WALLET-H1: pass an owned copy into the adapter so that zeroing secretKey below
  // does not corrupt the live signer's key buffer.
  const adapter = MlDsa65Adapter.fromKeyPair(publicKey, secretKey.slice());
  replaceCurrentSigner(new ShellSigner('MlDsa65', adapter));
  await unlockNativeChainKeysForAccount(account, password);

  await setSessionState({ unlockedPqAddress: account.pqAddress, unlockedAt: Date.now() });
  await setLastActiveAddress(account.pqAddress);
  await setLastActiveAccountId(getAccountId(account));
  await scheduleAutoLock();
  secretKey.fill(0); // zero ephemeral local copy; adapter holds its own copy

  return { ok: true, pqAddress: account.pqAddress, accountId: getAccountId(account) };
}

function deriveNativeChainAddresses(seed: Uint8Array, accountIndex: number, shellAddress: string): Partial<Record<ChainAddressKey, string>> {
  return Object.values(NATIVE_CHAIN_ADAPTERS).reduce<Partial<Record<ChainAddressKey, string>>>(
    (addresses, adapter) => ({ ...addresses, ...adapter.deriveAddresses(seed, accountIndex) }),
    { shell: shellAddress },
  );
}

function clearNativeChainKeys(): void {
  replaceCurrentTronKey(null);
  replaceCurrentSolanaKey(null);
  replaceCurrentBitcoinKeys({});
  replaceCurrentCosmosKeyPair(null);
  replaceCurrentTonKey(null);
  replaceCurrentAptosKeyPair(null);
}

async function unlockNativeChainKeysForAccount(account: StoredAccount, password: string): Promise<void> {
  clearNativeChainKeys();
  if (account.derivationIndex == null) return;
  const hdStore = await getHdStore();
  if (!hdStore) return;
  const seed = await decryptHdSeed(hdStore.seedKeystoreJson, password);
  try {
    unlockNativeChainKeysFromSeed(seed, account.derivationIndex, account);
  } finally {
    seed.fill(0);
  }
}

function unlockNativeChainKeysFromSeed(seed: Uint8Array, accountIndex: number, account: StoredAccount): void {
  clearNativeChainKeys();
  try {
    for (const adapter of Object.values(NATIVE_CHAIN_ADAPTERS)) {
      adapter.unlockKey(seed, accountIndex, account);
    }
  } catch (error) {
    clearNativeChainKeys();
    throw error;
  }
}

async function getWalletSnapshot(): Promise<WalletSnapshot> {
  const wallet = await getWalletState();
  const activeAccount = await getActiveAccount();
  const primaryAccount = wallet.accounts[0] ?? null;
  const locked = currentSigner === null;
  const portfolioSnapshot = await getPortfolioSnapshot();

  if (!primaryAccount) {
    return {
      locked,
      wallet,
      primaryAccount: null,
      activeAccountId: null,
      activeMultichainAccount: null,
      activeAddress: null,
      activeChainKind: getChainKind(wallet.network),
      balance: null,
      nonce: null,
      detectedChainId: null,
      nodeInfo: null,
      portfolioSnapshot,
    };
  }

  try {
    const activeChainKind = getChainKind(wallet.network);
    const queryAccount = activeAccount ?? primaryAccount;
    const queryAddress = getAccountAddressForNetwork(queryAccount, wallet.network);
    const nativeAdapter = getNativeChainAdapter(activeChainKind);
    if (nativeAdapter) {
      if (!queryAddress) {
        return {
          locked,
          wallet,
          primaryAccount,
          ...getSnapshotAccountMeta(queryAccount),
          activeAddress: null,
          activeChainKind,
          balance: null,
          nonce: null,
          detectedChainId: wallet.network.chainId,
          nodeInfo: null,
          portfolioAssets: [],
          portfolioSnapshot,
        };
      }
      const [balance, nonce, cosmosBalances, cosmosStaking, cosmosRedelegations, cosmosValidators, cosmosGovernanceProposals, cosmosIbcContext] = await Promise.all([
        nativeAdapter.getBalance(wallet.network, queryAddress),
        nativeAdapter.getNonce ? nativeAdapter.getNonce(wallet.network, queryAddress).catch(() => null) : Promise.resolve(null),
        activeChainKind === 'cosmos' ? getCosmosBalances(queryAddress).catch(() => null) : Promise.resolve(null),
        activeChainKind === 'cosmos' ? getCosmosStaking(queryAddress).catch(() => null) : Promise.resolve(null),
        activeChainKind === 'cosmos' ? getCosmosRedelegationsForAddress(queryAddress).catch(() => null) : Promise.resolve(null),
        activeChainKind === 'cosmos' ? getCosmosValidatorSummaries().catch(() => null) : Promise.resolve(null),
        activeChainKind === 'cosmos' ? getCosmosGovernanceProposalSummaries(queryAddress).catch(() => null) : Promise.resolve(null),
        activeChainKind === 'cosmos' ? getCosmosIbcContextForActiveNetwork(queryAddress).catch(() => null) : Promise.resolve(null),
      ]);
      return {
        locked,
        wallet,
        primaryAccount,
        ...getSnapshotAccountMeta(queryAccount),
        activeAddress: queryAddress,
        activeChainKind,
        balance: { raw: balance.balance, formatted: balance.formatted },
        cosmosBalances,
        cosmosStaking,
        cosmosRedelegations,
        cosmosValidators,
        cosmosGovernanceProposals,
        cosmosIbcContext,
        nonce,
        detectedChainId: wallet.network.chainId,
        nodeInfo: null,
        portfolioSnapshot,
        portfolioAssets: await buildPortfolioAssets({
          wallet,
          account: queryAccount,
          network: wallet.network,
          activeBalance: { raw: balance.balance, formatted: balance.formatted },
          cosmosBalances,
        }),
      };
    }
    const provider = buildProvider(wallet.network);
    if (!queryAddress) throw new Error('No address available for active chain');
    const [balance, nonce, detectedChainId, nodeInfo] = await Promise.all([
      provider.client.getBalance({ address: asPqAddress(queryAddress, 'getBalance') }),
      provider.client.getTransactionCount({ address: asPqAddress(queryAddress, 'getTransactionCount') }),
      provider.client.getChainId(),
      getNodeInfoFromNode(wallet.network.rpcUrl).catch(() => null),
    ]);
    return {
      locked,
      wallet,
      primaryAccount,
      ...getSnapshotAccountMeta(queryAccount),
      activeAddress: queryAddress,
      activeChainKind,
      balance: {
        raw: balance.toString(),
        formatted: formatEther(balance),
      },
      nonce,
      detectedChainId,
      nodeInfo,
      portfolioSnapshot,
      portfolioAssets: await buildPortfolioAssets({
        wallet,
        account: queryAccount,
        network: wallet.network,
        activeBalance: { raw: balance.toString(), formatted: formatEther(balance) },
      }),
    };
  } catch {
    const activeChainKind = getChainKind(wallet.network);
    const queryAccount = activeAccount ?? primaryAccount;
    const activeAddress = getAccountAddressForNetwork(queryAccount, wallet.network);
    return {
      locked,
      wallet,
      primaryAccount,
      ...getSnapshotAccountMeta(queryAccount),
      activeAddress,
      activeChainKind,
      balance: null,
      nonce: null,
      detectedChainId: null,
      nodeInfo: null,
      portfolioSnapshot,
      portfolioAssets: activeAddress
        ? [buildUnavailableNativePortfolioAsset(wallet.network, activeAddress, 'Balance unavailable')]
        : [],
    };
  }
}

function getSnapshotAccountMeta(account: StoredAccount): Pick<WalletSnapshot, 'activeAccountId' | 'activeMultichainAccount'> {
  return {
    activeAccountId: getAccountId(account),
    activeMultichainAccount: account,
  };
}

async function getPortfolioSnapshot(): Promise<PortfolioSnapshot | null> {
  const cached = await getPortfolioSnapshotCache();
  return cached ? applyPortfolioCacheAge(cached) : null;
}

async function refreshPortfolioSnapshot(): Promise<PortfolioSnapshot> {
  const wallet = await getWalletState();
  const activeAccount = await getActiveAccount();
  const account = activeAccount ?? wallet.accounts[0] ?? null;
  if (!account) {
    const empty = {
      accountId: null,
      generatedAt: Date.now(),
      networks: [],
    };
    await setPortfolioSnapshotCache(empty);
    return empty;
  }

  const networks = getPortfolioNetworks(wallet);
  const items = await mapWithConcurrency(networks, PORTFOLIO_REFRESH_CONCURRENCY, (network) => buildPortfolioNetworkAsset(wallet, account, network));
  const snapshot = {
    accountId: getAccountId(account),
    generatedAt: Date.now(),
    networks: items,
  };
  await setPortfolioSnapshotCache(snapshot);
  return snapshot;
}

function applyPortfolioCacheAge(snapshot: PortfolioSnapshot, now = Date.now()): PortfolioSnapshot {
  const ageMs = now - snapshot.generatedAt;
  if (ageMs < PORTFOLIO_STALE_AFTER_MS) return snapshot;
  const suffix = ageMs >= PORTFOLIO_EXPIRED_AFTER_MS ? ' Refresh required.' : ' Refresh recommended.';
  return {
    ...snapshot,
    networks: snapshot.networks.map((network) => ({
      ...network,
      status: 'stale',
      error: network.error ?? `Cached portfolio data is stale.${suffix}`,
    })),
  };
}

function getPortfolioNetworks(wallet: WalletSnapshot['wallet']): Network[] {
  const byKey = new Map<string, Network>();
  const add = (network: Network): void => {
    byKey.set(`${getChainKind(network)}:${network.chainId}:${network.rpcUrl}`, network);
  };
  add(wallet.network);
  for (const token of wallet.watchedTokens) {
    if (token.hidden === true) continue;
    const tokenNetwork = Object.values(KNOWN_NETWORKS).find((network) =>
      getChainKind(network) === token.chainKind && network.chainId === token.chainId,
    );
    if (tokenNetwork) add(tokenNetwork);
  }
  return [...byKey.values()];
}

async function buildPortfolioNetworkAsset(
  wallet: WalletSnapshot['wallet'],
  account: StoredAccount,
  network: Network,
): Promise<PortfolioNetworkAsset> {
  const chainKind = getChainKind(network);
  const address = getAccountAddressForNetwork(account, network);
  const watchedTokenCount = wallet.watchedTokens.filter((token) =>
    token.chainKind === chainKind &&
    token.chainId === network.chainId &&
    token.hidden !== true,
  ).length;
  if (!address) {
    return {
      chainKind,
      chainId: network.chainId,
      networkName: network.name,
      rpcProvenance: network.rpcProvenance ?? 'user-custom',
      address: null,
      symbol: network.symbol ?? defaultNativeSymbol(chainKind),
      nativeAsset: null,
      watchedTokenCount,
      status: 'unavailable',
      error: 'Address unavailable',
      updatedAt: Date.now(),
    };
  }

  try {
    const balance = await withTimeout(getNativeBalanceForNetwork(network, address), PORTFOLIO_BALANCE_TIMEOUT_MS, 'Balance request timed out');
    const nativeAsset: PortfolioAsset = {
      chainKind,
      chainId: network.chainId,
      networkName: network.name,
      address,
      assetType: 'native',
      symbol: network.symbol ?? defaultNativeSymbol(chainKind),
      name: network.name,
      contractAddress: null,
      rawBalance: balance.balance,
      formattedBalance: balance.formatted,
      decimals: getNativeAssetDecimals(network),
      status: 'ok',
      error: null,
    };
    return {
      chainKind,
      chainId: network.chainId,
      networkName: network.name,
      rpcProvenance: network.rpcProvenance ?? 'user-custom',
      address,
      symbol: nativeAsset.symbol,
      nativeAsset,
      watchedTokenCount,
      status: 'ok',
      error: null,
      updatedAt: Date.now(),
    };
  } catch (error) {
    return {
      chainKind,
      chainId: network.chainId,
      networkName: network.name,
      rpcProvenance: network.rpcProvenance ?? 'user-custom',
      address,
      symbol: network.symbol ?? defaultNativeSymbol(chainKind),
      nativeAsset: buildUnavailableNativePortfolioAsset(network, address, toSafeErrorMessage(error)),
      watchedTokenCount,
      status: 'unavailable',
      error: toSafeErrorMessage(error),
      updatedAt: Date.now(),
    };
  }
}

async function getNativeBalanceForNetwork(network: Network, address: string): Promise<{ balance: string; formatted: string }> {
  const nativeAdapter = getNativeChainAdapter(getChainKind(network));
  if (nativeAdapter) return nativeAdapter.getBalance(network, address);
  const balanceHex = await portfolioRpcRequest<string>(network.rpcUrl, 'eth_getBalance', [asPqAddress(address, 'getBalance'), 'latest'], PORTFOLIO_BALANCE_TIMEOUT_MS);
  const balance = BigInt(balanceHex);
  return { balance: balance.toString(), formatted: formatEther(balance) };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function portfolioRpcRequest<T>(rpcUrl: string, method: string, params: unknown[], timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`rpc request failed: ${res.status} ${res.statusText}`);
    const data = await res.json() as { result?: T; error?: { code?: number; message?: string } };
    if (data.error) throw new Error(`[${data.error.code ?? -32000}] ${data.error.message ?? 'RPC error'}`);
    return data.result as T;
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw new Error('Balance request timed out');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function defaultNativeSymbol(chainKind: ChainKind): string {
  return chainKind === 'shell' || chainKind === 'evm' ? 'SHELL' : chainKind.toUpperCase();
}

async function getDappSessionsSnapshot(): Promise<DappSessionsSnapshot> {
  const [sites, walletConnectSessions, tonConnectSessions] = await Promise.all([
    getConnectedSites(),
    getWalletConnectSessions(),
    getTonConnectSessions(),
  ]);
  return {
    generatedAt: Date.now(),
    sessions: [
      ...sites.map(mapConnectedSiteSession),
      ...walletConnectSessions.map(mapWalletConnectSession),
      ...tonConnectSessions.map(mapTonConnectSession),
    ].sort((left, right) => right.lastUsedAt - left.lastUsedAt),
  };
}

function mapConnectedSiteSession(site: ConnectedSitePermission): UnifiedDappSession {
  return {
    id: `connected-site:${site.origin}`,
    kind: 'connected-site',
    origin: site.origin,
    protocol: 'EIP-1193',
    accounts: site.accounts,
    chains: [`Chain ${site.chainId}`],
    methods: ['eth_accounts', 'eth_chainId', 'eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4'],
    grantedAt: site.grantedAt,
    lastUsedAt: site.lastUsedAt,
    expiresAt: null,
    riskFlags: ['can request transactions', 'can request signatures'],
  };
}

function mapWalletConnectSession(session: WalletConnectSession): UnifiedDappSession {
  return {
    id: `walletconnect:${session.topic}`,
    kind: 'walletconnect',
    origin: session.origin,
    protocol: 'WalletConnect',
    accounts: session.accounts,
    chains: session.chainIds.map((chainId) => `Chain ${chainId}`),
    methods: session.methods,
    grantedAt: session.grantedAt,
    lastUsedAt: session.lastUsedAt,
    expiresAt: session.expiresAt,
    riskFlags: getDappMethodRiskFlags(session.methods, session.expiresAt),
  };
}

function mapTonConnectSession(session: TonConnectSession): UnifiedDappSession {
  const methods = session.features.map((feature) => feature.name);
  return {
    id: `tonconnect:${session.clientId}`,
    kind: 'tonconnect',
    origin: session.origin,
    protocol: 'TonConnect',
    accounts: [session.account],
    chains: [`${session.network} / Chain ${session.chainId}`],
    methods,
    grantedAt: session.grantedAt,
    lastUsedAt: session.lastUsedAt,
    expiresAt: session.expiresAt,
    riskFlags: getDappMethodRiskFlags(methods, session.expiresAt),
  };
}

function getDappMethodRiskFlags(methods: string[], expiresAt: number | null): string[] {
  const flags = new Set<string>();
  for (const method of methods) {
    if (/send|transaction|sign|typed|amino|direct|proof/i.test(method)) flags.add('can request signing');
    if (/unknown|custom/i.test(method)) flags.add('contains custom methods');
  }
  if (expiresAt && expiresAt - Date.now() > 30 * 24 * 60 * 60 * 1000) flags.add('long-lived session');
  return [...flags];
}

async function revokeDappSession(sessionId: string): Promise<{ ok: true }> {
  const [kind, rawId] = splitDappSessionId(sessionId);
  if (kind === 'connected-site') {
    await removeConnectedSite(rawId);
    return { ok: true };
  }
  if (kind === 'walletconnect') {
    await removeWalletConnectSession(rawId);
    return { ok: true };
  }
  if (kind === 'tonconnect') {
    await removeTonConnectSession(rawId);
    return { ok: true };
  }
  throw new Error('Unsupported dApp session kind');
}

function splitDappSessionId(sessionId: string): [UnifiedDappSession['kind'], string] {
  const separator = sessionId.indexOf(':');
  if (separator <= 0) throw new Error('Invalid dApp session id');
  const kind = sessionId.slice(0, separator);
  const rawId = sessionId.slice(separator + 1);
  if ((kind === 'connected-site' || kind === 'walletconnect' || kind === 'tonconnect') && rawId) {
    return [kind, rawId];
  }
  throw new Error('Invalid dApp session id');
}

async function buildPortfolioAssets(input: {
  wallet: WalletSnapshot['wallet'];
  account: StoredAccount;
  network: Network;
  activeBalance: { raw: string; formatted: string } | null;
  cosmosBalances?: CosmosDenomBalance[] | null;
}): Promise<PortfolioAsset[]> {
  const chainKind = getChainKind(input.network);
  const address = getAccountAddressForNetwork(input.account, input.network);
  if (!address) return [];

  const assets: PortfolioAsset[] = [];
  if (input.activeBalance) {
    assets.push({
      chainKind,
      chainId: input.network.chainId,
      networkName: input.network.name,
      address,
      assetType: 'native',
      symbol: input.network.symbol ?? (chainKind === 'shell' || chainKind === 'evm' ? 'SHELL' : chainKind.toUpperCase()),
      name: input.network.name,
      contractAddress: null,
      rawBalance: input.activeBalance.raw,
      formattedBalance: input.activeBalance.formatted,
      decimals: getNativeAssetDecimals(input.network),
      status: 'ok',
      error: null,
    });
  } else {
    assets.push(buildUnavailableNativePortfolioAsset(input.network, address, 'Balance unavailable'));
  }

  if (chainKind === 'cosmos' && input.cosmosBalances) {
    for (const balance of input.cosmosBalances) {
      assets.push({
        chainKind,
        chainId: input.network.chainId,
        networkName: input.network.name,
        address,
        assetType: 'cosmos-denom',
        symbol: balance.symbol,
        name: balance.denom,
        contractAddress: balance.denom,
        rawBalance: balance.amount,
        formattedBalance: balance.formatted,
        decimals: balance.decimals,
        status: 'ok',
        error: null,
      });
    }
  }

  const tokenAssets = await Promise.all(
    input.wallet.watchedTokens
      .filter((token) => token.chainKind === chainKind && token.chainId === input.network.chainId && token.hidden !== true)
      .map((token) => buildWatchedTokenPortfolioAsset(token, input.network, address)),
  );
  assets.push(...tokenAssets);
  return assets;
}

async function buildWatchedTokenPortfolioAsset(
  token: WalletSnapshot['wallet']['watchedTokens'][number],
  network: Network,
  ownerAddress: string,
): Promise<PortfolioAsset> {
  try {
    const balance = await getTokenBalanceForPortfolio(token, ownerAddress);
    return {
      chainKind: token.chainKind,
      chainId: token.chainId,
      networkName: network.name,
      address: ownerAddress,
      assetType: 'token',
      symbol: balance.symbol ?? token.symbol,
      name: token.symbol,
      contractAddress: token.contractAddress,
      rawBalance: balance.balance,
      formattedBalance: balance.formatted,
      decimals: balance.decimals,
      status: 'ok',
      error: null,
    };
  } catch (error) {
    return {
      chainKind: token.chainKind,
      chainId: token.chainId,
      networkName: network.name,
      address: ownerAddress,
      assetType: 'token',
      symbol: token.symbol,
      name: token.symbol,
      contractAddress: token.contractAddress,
      rawBalance: null,
      formattedBalance: null,
      decimals: token.decimals,
      status: 'unavailable',
      error: toSafeErrorMessage(error),
    };
  }
}

async function getTokenBalanceForPortfolio(
  token: WalletSnapshot['wallet']['watchedTokens'][number],
  ownerAddress: string,
): Promise<{ balance: string; formatted: string; decimals: number; symbol: string | null }> {
  if (token.chainKind === 'shell' || token.chainKind === 'evm') {
    return getErc20TokenBalance({
      contractAddress: token.contractAddress,
      ownerAddress,
      decimals: token.decimals,
      symbol: token.symbol,
    });
  }
  if (token.chainKind === 'tron') {
    return getTrc20TokenBalance({
      contractAddress: token.contractAddress,
      ownerAddress,
      decimals: token.decimals,
      symbol: token.symbol,
    });
  }
  if (token.chainKind === 'solana') {
    return getSplTokenBalanceForActiveAccount({
      contractAddress: token.contractAddress,
      decimals: token.decimals,
      symbol: token.symbol,
    });
  }
  if (token.chainKind === 'ton') {
    return getJettonTokenBalance({
      contractAddress: token.contractAddress,
      ownerAddress,
      decimals: token.decimals,
      symbol: token.symbol,
    });
  }
  throw new Error(`${token.chainKind} token portfolio assets are not supported`);
}

function buildUnavailableNativePortfolioAsset(network: Network, address: string, error: string): PortfolioAsset {
  const chainKind = getChainKind(network);
  return {
    chainKind,
    chainId: network.chainId,
    networkName: network.name,
    address,
    assetType: 'native',
    symbol: network.symbol ?? (chainKind === 'shell' || chainKind === 'evm' ? 'SHELL' : chainKind.toUpperCase()),
    name: network.name,
    contractAddress: null,
    rawBalance: null,
    formattedBalance: null,
    decimals: getNativeAssetDecimals(network),
    status: 'unavailable',
    error,
  };
}

function getNativeAssetDecimals(network: Network): number {
  const chainKind = getChainKind(network);
  if (chainKind === 'bitcoin') return 8;
  if (chainKind === 'cosmos') return getCosmosNativeDecimals(network);
  if (chainKind === 'solana' || chainKind === 'ton' || chainKind === 'aptos') return 9;
  if (chainKind === 'tron') return 6;
  return 18;
}

async function getBalance(address: string): Promise<{ balance: string; formatted: string }> {
  const network = await getNetwork();
  const nativeAdapter = getNativeChainAdapter(getChainKind(network));
  if (nativeAdapter) return nativeAdapter.getBalance(network, address);
  const provider = buildProvider(network);
  const balance = await provider.client.getBalance({ address: asPqAddress(address, 'getBalance') });
  return { balance: balance.toString(), formatted: formatEther(balance) };
}

async function getCosmosBalances(address: string): Promise<CosmosDenomBalance[]> {
  const network = await getNetwork();
  if (getChainKind(network) !== 'cosmos') throw new Error('Cosmos balances require a Cosmos network');
  return getCosmosDenomBalances(network.rpcUrl, address, {
    addressPrefix: getCosmosAddressPrefix(network),
    nativeDenom: getCosmosNativeDenom(network),
    nativeSymbol: network.symbol ?? 'ATOM',
    nativeDecimals: getCosmosNativeDecimals(network),
  });
}

async function getCosmosStaking(address: string): Promise<CosmosStakingPosition[]> {
  const network = await getNetwork();
  if (getChainKind(network) !== 'cosmos') throw new Error('Cosmos staking requires a Cosmos network');
  return getCosmosStakingPositions(network.rpcUrl, address, {
    addressPrefix: getCosmosAddressPrefix(network),
    nativeDenom: getCosmosNativeDenom(network),
    nativeSymbol: network.symbol ?? 'ATOM',
    nativeDecimals: getCosmosNativeDecimals(network),
  });
}

async function getCosmosRedelegationsForAddress(address: string): Promise<CosmosRedelegationEntry[]> {
  const network = await getNetwork();
  if (getChainKind(network) !== 'cosmos') throw new Error('Cosmos redelegations require a Cosmos network');
  return getCosmosRedelegations(network.rpcUrl, address, {
    addressPrefix: getCosmosAddressPrefix(network),
    nativeDenom: getCosmosNativeDenom(network),
    nativeSymbol: network.symbol ?? 'ATOM',
    nativeDecimals: getCosmosNativeDecimals(network),
  });
}

async function getCosmosValidatorSummaries(): Promise<CosmosValidatorSummary[]> {
  const network = await getNetwork();
  if (getChainKind(network) !== 'cosmos') throw new Error('Cosmos validators require a Cosmos network');
  return getCosmosValidators(network.rpcUrl, 20, getCosmosAddressPrefix(network));
}

async function getCosmosGovernanceProposalSummaries(voterAddress = ''): Promise<CosmosGovernanceProposal[]> {
  const network = await getNetwork();
  if (getChainKind(network) !== 'cosmos') throw new Error('Cosmos governance proposals require a Cosmos network');
  return getCosmosGovernanceProposals(network.rpcUrl, 5, voterAddress);
}

async function getCosmosIbcContextForActiveNetwork(address: string): Promise<Awaited<ReturnType<typeof getCosmosIbcContext>>> {
  const network = await getNetwork();
  if (getChainKind(network) !== 'cosmos') throw new Error('Cosmos IBC context requires a Cosmos network');
  const balances = address ? await getCosmosBalances(address).catch(() => []) : [];
  return getCosmosIbcContext(network.rpcUrl, network.chainId, balances.map((balance) => balance.denom));
}

async function sendTransaction(params: SendTransactionParams): Promise<{ txHash: string }> {
  if (!currentSigner) throw new Error('Wallet is locked');

  const network = await getNetwork();
  const nativeAdapter = getNativeChainAdapter(getChainKind(network));
  if (nativeAdapter) return nativeAdapter.send(network, params);
  if (params.expectedChainId !== undefined && params.expectedChainId !== network.chainId) {
    throw new Error(`Network changed during approval: expected ${params.expectedChainId}, got ${network.chainId}`);
  }
  const provider = buildProvider(network);
  const from = currentSigner.getAddress();
  const to = params.to === null ? null : normalizeRecipient(params.to);
  const valueBigInt = parseEtherValue(params.value);
  const data = normalizeData(params.data);
  if (to === null && data === '0x') {
    throw new Error('Contract deployment requires bytecode');
  }

  const onChainNonce = await provider.client.getTransactionCount({ address: asPqAddress(from, 'getTransactionCount') });
  const nonce = await allocateNextNonce(from, onChainNonce);
  const tx = to !== null && data === '0x'
    ? buildTransferTransaction({
        chainId: network.chainId,
        nonce,
        to,
        value: valueBigInt,
        gasLimit: params.gasLimit,
        maxFeePerGas: params.maxFeePerGas,
        maxPriorityFeePerGas: params.maxPriorityFeePerGas,
      })
    : buildTransaction({
        chainId: network.chainId,
        nonce,
        to,
        value: valueBigInt,
        data,
        gasLimit: params.gasLimit,
        maxFeePerGas: params.maxFeePerGas,
        maxPriorityFeePerGas: params.maxPriorityFeePerGas,
      });

  const signed = await currentSigner.buildSignedTransaction({
    tx,
    txHash: hashTransaction(tx),
    includePublicKey: nonce === 0,
  });

  const txHash = await provider.sendTransaction(signed);
  await upsertTxRecord({
    txHash,
    chainKind: getChainKind(network),
    from,
    to,
    value: valueBigInt.toString(),
    data,
    nonce,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'pending',
    source: 'local',
    shellType: to === null ? 'contractCreate' : data !== '0x' ? 'contractCall' : null,
  });
  await scheduleTxPolling();

  return { txHash };
}

async function sendTronTransaction(network: Network, params: SendTransactionParams): Promise<{ txHash: string }> {
  const amountSun = parseTrx(params.value);
  return sendTronNativeTransfer(network, requireString(params.to, 'to'), amountSun);
}

async function sendTronNativeTransfer(network: Network, to: string, amountSun: bigint): Promise<{ txHash: string }> {
  if (!currentTronPrivateKey) throw new Error('Tron key is not available for this account');
  const activeAccount = await getActiveAccount();
  const from = getAccountAddressForChain(activeAccount, 'tron');
  if (!from) throw new Error('No Tron address is available for this account');
  const { txHash } = await sendTronTransfer({
    rpcUrl: network.rpcUrl,
    privateKey: currentTronPrivateKey,
    from,
    to,
    amountSun,
  });
  await upsertTxRecord({
    txHash,
    chainKind: 'tron',
    from,
    to,
    value: amountSun.toString(),
    data: '0x',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'pending',
    source: 'local',
    shellType: 'tronTransfer',
  });
  await scheduleTxPolling();
  return { txHash };
}

async function sendSolanaTransaction(network: Network, params: SendTransactionParams): Promise<{ txHash: string }> {
  const lamports = parseSol(params.value);
  return sendSolanaNativeTransfer(network, requireString(params.to, 'to'), lamports);
}

async function sendSolanaNativeTransfer(network: Network, to: string, lamports: bigint): Promise<{ txHash: string }> {
  if (!currentSolanaPrivateKey) throw new Error('Solana key is not available for this account');
  const activeAccount = await getActiveAccount();
  const from = getAccountAddressForChain(activeAccount, 'solana');
  if (!from) throw new Error('No Solana address is available for this account');
  const { txHash } = await sendSolanaTransfer({
    rpcUrl: network.rpcUrl,
    privateKey: currentSolanaPrivateKey,
    from,
    to,
    lamports,
  });
  await upsertTxRecord({
    txHash,
    chainKind: 'solana',
    from,
    to,
    value: lamports.toString(),
    data: '0x',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'pending',
    source: 'local',
    shellType: 'solanaTransfer',
  });
  await scheduleTxPolling();
  return { txHash };
}

async function sendAptosTransaction(network: Network, params: SendTransactionParams): Promise<{ txHash: string }> {
  const amountOctas = parseApt(params.value);
  if (!currentAptosKeyPair) throw new Error('Aptos key is not available for this account');
  const activeAccount = await getActiveAccount();
  const from = getAccountAddressForChain(activeAccount, 'aptos');
  if (!from) throw new Error('No Aptos address is available for this account');
  const to = requireString(params.to, 'to');
  const result = await sendAptosTransfer({
    rpcUrl: network.rpcUrl,
    privateKey: currentAptosKeyPair.privateKey,
    publicKey: currentAptosKeyPair.publicKey,
    from,
    to,
    amountOctas,
  });
  await upsertTxRecord({
    txHash: result.txHash,
    chainKind: 'aptos',
    from,
    to,
    value: result.amountOctas,
    data: '0x',
    nonce: Number(result.sequenceNumber),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'pending',
    source: 'local',
    shellType: 'aptosTransfer',
    tokenSymbol: network.symbol ?? 'APT',
    tokenDecimals: 8,
    aptosMaxGasAmount: result.maxGasAmount,
    aptosGasUnitPrice: result.gasUnitPrice,
    aptosExpirationTimestampSecs: result.expirationTimestampSecs,
  });
  await scheduleTxPolling();
  return { txHash: result.txHash };
}

async function sendCosmosTransaction(network: Network, params: SendTransactionParams): Promise<{ txHash: string }> {
  const addressPrefix = getCosmosAddressPrefix(network);
  const nativeDenom = getCosmosNativeDenom(network);
  const nativeDecimals = getCosmosNativeDecimals(network);
  const amountUatom = parseCosmosAmount(params.value, nativeDecimals, network.symbol ?? 'ATOM');
  const cosmosMemo = normalizeCosmosMemo(params.cosmosMemo);
  if (!currentCosmosKeyPair) throw new Error('Cosmos key is not available for this account');
  const activeAccount = await getActiveAccount();
  const from = getAccountAddressForNetwork(activeAccount, network);
  if (!from) throw new Error('No Cosmos address is available for this account');
  const to = requireString(params.to, 'to');
  const result = await sendCosmosTransfer({
    apiUrl: network.rpcUrl,
    chainId: getCosmosChainId(network),
    privateKey: currentCosmosKeyPair.privateKey,
    publicKey: currentCosmosKeyPair.publicKey,
    from,
    to,
    amountUatom,
    addressPrefix,
    denom: nativeDenom,
    memo: cosmosMemo,
  });
  await upsertTxRecord({
    txHash: result.txHash,
    chainKind: 'cosmos',
    from,
    to,
    value: result.amountUatom,
    data: '0x',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'pending',
    source: 'local',
    shellType: 'cosmosTransfer',
    nonce: Number(result.sequence),
    cosmosFeeUatom: result.feeUatom,
    cosmosGasLimit: result.gasLimit,
    cosmosAccountNumber: result.accountNumber,
    cosmosMemo: cosmosMemo || null,
    tokenSymbol: network.symbol ?? 'ATOM',
    tokenDecimals: nativeDecimals,
  });
  await scheduleTxPolling();
  return { txHash: result.txHash };
}

async function sendTonTransaction(network: Network, params: SendTransactionParams): Promise<{ txHash: string }> {
  const amountNanotons = parseTon(params.value);
  if (!currentTonPrivateKey) throw new Error('TON key is not available for this account');
  const activeAccount = await getActiveAccount();
  const from = getAccountAddressForChain(activeAccount, 'ton');
  if (!from) throw new Error('No TON address is available for this account');
  const to = requireString(params.to, 'to');
  const result = await sendTonTransfer({
    apiUrl: network.rpcUrl,
    privateKey: currentTonPrivateKey,
    from,
    to,
    amountNanotons,
  });
  await upsertTxRecord({
    txHash: result.txHash,
    chainKind: 'ton',
    from,
    to,
    value: result.amountNanotons,
    data: '0x',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'pending',
    source: 'local',
    shellType: 'tonTransfer',
    nonce: result.seqno,
    tokenSymbol: network.symbol ?? 'TON',
    tokenDecimals: 9,
  });
  await scheduleTxPolling();
  return { txHash: result.txHash };
}

async function sendCosmosStaking(
  action: 'delegate' | 'undelegate',
  input: { validatorAddress: string; amount: string; memo?: string },
): Promise<{ txHash: string }> {
  const network = await getNetwork();
  if (getChainKind(network) !== 'cosmos') throw new Error('Cosmos staking requires a Cosmos network');
  const addressPrefix = getCosmosAddressPrefix(network);
  const nativeDenom = getCosmosNativeDenom(network);
  const nativeDecimals = getCosmosNativeDecimals(network);
  const amountUatom = parseCosmosAmount(input.amount, nativeDecimals, network.symbol ?? 'ATOM');
  const cosmosMemo = normalizeCosmosMemo(input.memo);
  if (!currentCosmosKeyPair) throw new Error('Cosmos key is not available for this account');
  const activeAccount = await getActiveAccount();
  const delegatorAddress = getAccountAddressForNetwork(activeAccount, network);
  if (!delegatorAddress) throw new Error('No Cosmos address is available for this account');
  const result = await sendCosmosStakingTransaction({
    apiUrl: network.rpcUrl,
    chainId: getCosmosChainId(network),
    privateKey: currentCosmosKeyPair.privateKey,
    publicKey: currentCosmosKeyPair.publicKey,
    delegatorAddress,
    validatorAddress: input.validatorAddress,
    amountUatom,
    action,
    addressPrefix,
    denom: nativeDenom,
    memo: cosmosMemo,
  });
  await upsertTxRecord({
    txHash: result.txHash,
    chainKind: 'cosmos',
    from: delegatorAddress,
    to: input.validatorAddress,
    value: result.amountUatom,
    data: '0x',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'pending',
    source: 'local',
    shellType: action === 'delegate' ? 'cosmosDelegate' : 'cosmosUndelegate',
    nonce: Number(result.sequence),
    cosmosFeeUatom: result.feeUatom,
    cosmosGasLimit: result.gasLimit,
    cosmosAccountNumber: result.accountNumber,
    cosmosMemo: cosmosMemo || null,
    tokenSymbol: network.symbol ?? 'ATOM',
    tokenDecimals: nativeDecimals,
  });
  await scheduleTxPolling();
  return { txHash: result.txHash };
}

async function redelegateCosmosStake(input: {
  sourceValidatorAddress: string;
  destinationValidatorAddress: string;
  amount: string;
  memo?: string;
}): Promise<{ txHash: string }> {
  const network = await getNetwork();
  if (getChainKind(network) !== 'cosmos') throw new Error('Cosmos redelegation requires a Cosmos network');
  const addressPrefix = getCosmosAddressPrefix(network);
  const nativeDenom = getCosmosNativeDenom(network);
  const nativeDecimals = getCosmosNativeDecimals(network);
  const amountUatom = parseCosmosAmount(input.amount, nativeDecimals, network.symbol ?? 'ATOM');
  const cosmosMemo = normalizeCosmosMemo(input.memo);
  if (!currentCosmosKeyPair) throw new Error('Cosmos key is not available for this account');
  const activeAccount = await getActiveAccount();
  const delegatorAddress = getAccountAddressForNetwork(activeAccount, network);
  if (!delegatorAddress) throw new Error('No Cosmos address is available for this account');
  const activeRedelegation = await findBlockingCosmosRedelegation(delegatorAddress, input.sourceValidatorAddress);
  if (activeRedelegation) {
    throw new Error(
      `Cosmos redelegation is cooling down until ${activeRedelegation.completionTime}; this destination validator cannot be redelegated again before completion`,
    );
  }
  const result = await sendCosmosRedelegateTransaction({
    apiUrl: network.rpcUrl,
    chainId: getCosmosChainId(network),
    privateKey: currentCosmosKeyPair.privateKey,
    publicKey: currentCosmosKeyPair.publicKey,
    delegatorAddress,
    sourceValidatorAddress: input.sourceValidatorAddress,
    destinationValidatorAddress: input.destinationValidatorAddress,
    amountUatom,
    addressPrefix,
    denom: nativeDenom,
    memo: cosmosMemo,
  });
  await upsertTxRecord({
    txHash: result.txHash,
    chainKind: 'cosmos',
    from: delegatorAddress,
    to: input.destinationValidatorAddress,
    value: result.amountUatom,
    data: '0x',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'pending',
    source: 'local',
    shellType: 'cosmosRedelegate',
    nonce: Number(result.sequence),
    cosmosFeeUatom: result.feeUatom,
    cosmosGasLimit: result.gasLimit,
    cosmosAccountNumber: result.accountNumber,
    cosmosMemo: cosmosMemo || null,
    tokenSymbol: network.symbol ?? 'ATOM',
    tokenDecimals: nativeDecimals,
  });
  await scheduleTxPolling();
  return { txHash: result.txHash };
}

async function findBlockingCosmosRedelegation(
  delegatorAddress: string,
  sourceValidatorAddress: string,
): Promise<CosmosRedelegationEntry | null> {
  const redelegations = await getCosmosRedelegationsForAddress(delegatorAddress);
  const now = Date.now();
  return redelegations.find((entry) => {
    if (entry.destinationValidatorAddress !== sourceValidatorAddress) return false;
    const completionMs = Date.parse(entry.completionTime);
    return !Number.isFinite(completionMs) || completionMs > now;
  }) ?? null;
}

async function withdrawCosmosRewards(input: { validatorAddress: string; memo?: string }): Promise<{ txHash: string }> {
  const network = await getNetwork();
  if (getChainKind(network) !== 'cosmos') throw new Error('Cosmos rewards require a Cosmos network');
  const addressPrefix = getCosmosAddressPrefix(network);
  const nativeDecimals = getCosmosNativeDecimals(network);
  const cosmosMemo = normalizeCosmosMemo(input.memo);
  if (!currentCosmosKeyPair) throw new Error('Cosmos key is not available for this account');
  const activeAccount = await getActiveAccount();
  const delegatorAddress = getAccountAddressForNetwork(activeAccount, network);
  if (!delegatorAddress) throw new Error('No Cosmos address is available for this account');
  const result = await sendCosmosWithdrawRewardsTransaction({
    apiUrl: network.rpcUrl,
    chainId: getCosmosChainId(network),
    privateKey: currentCosmosKeyPair.privateKey,
    publicKey: currentCosmosKeyPair.publicKey,
    delegatorAddress,
    validatorAddress: input.validatorAddress,
    addressPrefix,
    memo: cosmosMemo,
  });
  await upsertTxRecord({
    txHash: result.txHash,
    chainKind: 'cosmos',
    from: delegatorAddress,
    to: input.validatorAddress,
    value: '0',
    data: '0x',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'pending',
    source: 'local',
    shellType: 'cosmosWithdrawRewards',
    nonce: Number(result.sequence),
    cosmosFeeUatom: result.feeUatom,
    cosmosGasLimit: result.gasLimit,
    cosmosAccountNumber: result.accountNumber,
    cosmosMemo: cosmosMemo || null,
    tokenSymbol: network.symbol ?? 'ATOM',
    tokenDecimals: nativeDecimals,
  });
  await scheduleTxPolling();
  return { txHash: result.txHash };
}

async function voteCosmosGovernance(input: { proposalId: string; option: string; memo?: string }): Promise<{ txHash: string }> {
  const network = await getNetwork();
  if (getChainKind(network) !== 'cosmos') throw new Error('Cosmos governance voting requires a Cosmos network');
  const addressPrefix = getCosmosAddressPrefix(network);
  const nativeDecimals = getCosmosNativeDecimals(network);
  const option = normalizeCosmosGovernanceVoteOption(input.option);
  const cosmosMemo = normalizeCosmosMemo(input.memo);
  if (!currentCosmosKeyPair) throw new Error('Cosmos key is not available for this account');
  const activeAccount = await getActiveAccount();
  const voterAddress = getAccountAddressForNetwork(activeAccount, network);
  if (!voterAddress) throw new Error('No Cosmos address is available for this account');
  const result = await sendCosmosGovernanceVoteTransaction({
    apiUrl: network.rpcUrl,
    chainId: getCosmosChainId(network),
    privateKey: currentCosmosKeyPair.privateKey,
    publicKey: currentCosmosKeyPair.publicKey,
    voterAddress,
    proposalId: input.proposalId,
    option,
    addressPrefix,
    memo: cosmosMemo,
  });
  await upsertTxRecord({
    txHash: result.txHash,
    chainKind: 'cosmos',
    from: voterAddress,
    to: input.proposalId,
    value: input.proposalId,
    data: option,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'pending',
    source: 'local',
    shellType: 'cosmosVote',
    nonce: Number(result.sequence),
    cosmosFeeUatom: result.feeUatom,
    cosmosGasLimit: result.gasLimit,
    cosmosAccountNumber: result.accountNumber,
    cosmosMemo: cosmosMemo || null,
    tokenSymbol: network.symbol ?? 'ATOM',
    tokenDecimals: nativeDecimals,
  });
  await scheduleTxPolling();
  return { txHash: result.txHash };
}

function normalizeCosmosGovernanceVoteOption(option: string): 'yes' | 'no' | 'abstain' | 'no_with_veto' {
  const normalized = option.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'yes' || normalized === 'no' || normalized === 'abstain' || normalized === 'no_with_veto') return normalized;
  throw new Error('Cosmos vote option must be yes, no, abstain, or no_with_veto');
}

async function sendBitcoinTransaction(network: Network, params: SendTransactionParams): Promise<{ txHash: string }> {
  const amountSats = parseBtc(params.value);
  return sendBitcoinNativeTransfer(network, requireString(params.to, 'to'), amountSats, params.feeRateSatVb, params.bitcoinInputs);
}

async function getBitcoinUtxosForAddress(address: string): Promise<BitcoinTxInput[]> {
  const network = await getNetwork();
  if (getChainKind(network) !== 'bitcoin') throw new Error('Bitcoin UTXOs require a Bitcoin network');
  return getBitcoinSpendableUtxos(network.rpcUrl, address);
}

async function previewSendTransaction(params: { to: string; value: string; feeRateSatVb?: number; bitcoinInputs?: BitcoinTxInput[] }): Promise<BitcoinTransferPreview> {
  const network = await getNetwork();
  if (getChainKind(network) !== 'bitcoin') {
    throw new Error('Send preview is currently available for Bitcoin networks only');
  }
  const activeAccount = await getActiveAccount();
  const from = getAccountAddressForNetwork(activeAccount, network);
  if (!from) throw new Error('No Bitcoin address is available for this account');
  return previewBitcoinTransfer({
    apiUrl: network.rpcUrl,
    from,
    to: params.to,
    amountSats: parseBtc(params.value),
    feeRateSatVb: params.feeRateSatVb,
    inputs: params.bitcoinInputs,
  });
}

async function sendBitcoinNativeTransfer(network: Network, to: string, amountSats: bigint, feeRateSatVb?: number, bitcoinInputs?: BitcoinTxInput[]): Promise<{ txHash: string }> {
  const bitcoinNetwork = getBitcoinNetwork(network);
  const currentBitcoinPrivateKey = currentBitcoinPrivateKeys[bitcoinNetwork] ?? null;
  if (!currentBitcoinPrivateKey) throw new Error('Bitcoin key is not available for this account');
  const activeAccount = await getActiveAccount();
  const from = getAccountAddressForNetwork(activeAccount, network);
  if (!from) throw new Error('No Bitcoin address is available for this account');
  const result = await sendBitcoinTransfer({
    apiUrl: network.rpcUrl,
    privateKey: currentBitcoinPrivateKey,
    from,
    to,
    amountSats,
    feeRateSatVb,
    inputs: bitcoinInputs,
  });
  await upsertTxRecord({
    txHash: result.txHash,
    chainKind: 'bitcoin',
    from,
    to,
    value: amountSats.toString(),
    data: '0x',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'pending',
    source: 'local',
    shellType: 'bitcoinTransfer',
    rbfEnabled: result.rbfEnabled,
    bitcoinInputs: result.inputs,
    bitcoinFeeSats: result.feeSats,
    bitcoinChangeSats: result.changeSats,
    bitcoinFeeRateSatVb: result.feeRateSatVb,
    bitcoinVbytes: result.estimatedVbytes,
  });
  await scheduleTxPolling();
  return { txHash: result.txHash };
}

async function bumpBitcoinFee(input: { txHash: string; feeRateSatVb: number }): Promise<{ txHash: string }> {
  const network = await getNetwork();
  if (getChainKind(network) !== 'bitcoin') throw new Error('Bitcoin fee bump requires a Bitcoin network');
  const bitcoinNetwork = getBitcoinNetwork(network);
  const currentBitcoinPrivateKey = currentBitcoinPrivateKeys[bitcoinNetwork] ?? null;
  if (!currentBitcoinPrivateKey) throw new Error('Bitcoin key is not available for this account');
  const queue = await getTxQueue();
  const original = queue.find((tx) => tx.txHash.toLowerCase() === input.txHash.toLowerCase());
  if (!original) throw new Error('Bitcoin transaction not found');
  if (original.chainKind !== 'bitcoin' || original.shellType !== 'bitcoinTransfer') throw new Error('Only Bitcoin transfers can be fee bumped');
  if (original.status !== 'pending') throw new Error('Only pending Bitcoin transactions can be fee bumped');
  if (original.source !== 'local') throw new Error('Only local Bitcoin transactions can be fee bumped');
  if (!original.rbfEnabled) throw new Error('Bitcoin transaction is not RBF-enabled');
  if (!original.to) throw new Error('Bitcoin replacement recipient is missing');
  if (!original.bitcoinInputs?.length) throw new Error('Bitcoin replacement inputs are missing');
  const nextFeeRate = Math.ceil(input.feeRateSatVb);
  if (!Number.isFinite(nextFeeRate) || nextFeeRate <= 0) throw new Error('Bitcoin replacement fee rate must be greater than 0 sat/vB');
  if (original.bitcoinFeeRateSatVb != null && nextFeeRate <= original.bitcoinFeeRateSatVb) {
    throw new Error('Bitcoin replacement fee rate must be higher than the original fee rate');
  }
  const result = await replaceBitcoinTransfer({
    apiUrl: network.rpcUrl,
    privateKey: currentBitcoinPrivateKey,
    from: original.from,
    to: original.to,
    amountSats: BigInt(original.value),
    inputs: original.bitcoinInputs,
    feeRateSatVb: nextFeeRate,
  });
  const now = Date.now();
  const replaced = {
    ...original,
    status: 'failed' as const,
    error: `Replaced by ${result.txHash}`,
    replacedByTxHash: result.txHash,
    updatedAt: now,
  };
  const replacement: WalletTxRecord = {
    ...original,
    txHash: result.txHash,
    status: 'pending',
    error: undefined,
    createdAt: now,
    updatedAt: now,
    replacesTxHash: original.txHash,
    replacedByTxHash: null,
    bitcoinInputs: result.inputs,
    bitcoinFeeSats: result.feeSats,
    bitcoinChangeSats: result.changeSats,
    bitcoinFeeRateSatVb: result.feeRateSatVb,
    bitcoinVbytes: result.estimatedVbytes,
    rbfEnabled: result.rbfEnabled,
  };
  await setTxQueue(queue.map((tx) => tx.txHash.toLowerCase() === original.txHash.toLowerCase() ? replaced : tx));
  await upsertTxRecord(replacement);
  await scheduleTxPolling();
  return { txHash: result.txHash };
}

async function bumpBitcoinCpfp(input: { txHash: string; feeRateSatVb: number }): Promise<{ txHash: string }> {
  const network = await getNetwork();
  if (getChainKind(network) !== 'bitcoin') throw new Error('Bitcoin CPFP requires a Bitcoin network');
  const bitcoinNetwork = getBitcoinNetwork(network);
  const currentBitcoinPrivateKey = currentBitcoinPrivateKeys[bitcoinNetwork] ?? null;
  if (!currentBitcoinPrivateKey) throw new Error('Bitcoin key is not available for this account');
  const activeAccount = await getActiveAccount();
  const address = getAccountAddressForNetwork(activeAccount, network);
  if (!address) throw new Error('No Bitcoin address is available for this account');
  const nextFeeRate = Math.ceil(input.feeRateSatVb);
  if (!Number.isFinite(nextFeeRate) || nextFeeRate <= 0) throw new Error('Bitcoin CPFP fee rate must be greater than 0 sat/vB');

  const remote = await getBitcoinTransactionHistory(network.rpcUrl, address, 0);
  const parent = remote.txs.find((tx) => tx.txHash.toLowerCase() === input.txHash.toLowerCase());
  if (!parent) throw new Error('Bitcoin parent transaction not found');
  if (parent.chainKind !== 'bitcoin' || parent.shellType !== 'bitcoinTransfer') throw new Error('Only Bitcoin transfers can be CPFP bumped');
  if (parent.status !== 'pending') throw new Error('Only pending Bitcoin transactions can be CPFP bumped');
  if (parent.source !== 'remote') throw new Error('Only remote incoming Bitcoin transactions can be CPFP bumped');
  if (!parent.bitcoinCpfpInput) throw new Error('Bitcoin transaction has no spendable incoming output for CPFP');
  const cpfpParents = remote.txs.filter((tx) => {
    return tx.chainKind === 'bitcoin' &&
      tx.shellType === 'bitcoinTransfer' &&
      tx.status === 'pending' &&
      tx.source === 'remote' &&
      tx.bitcoinCpfpInput != null;
  });
  if (!cpfpParents.some((tx) => tx.txHash.toLowerCase() === parent.txHash.toLowerCase())) {
    throw new Error('Bitcoin transaction has no spendable incoming output for CPFP');
  }
  const childVbytes = 10 + cpfpParents.length * 68 + 31;
  const cpfpPolicies = await Promise.all(cpfpParents.map((tx) => checkBitcoinCpfpPolicy(network.rpcUrl, tx.bitcoinCpfpInput!, childVbytes)));
  const parentFeeSats = sumNullableBigIntStrings(cpfpParents.map((tx) => tx.bitcoinFeeSats));
  const parentVbytes = sumNullableNumbers(cpfpParents.map((tx) => tx.bitcoinVbytes));

  const result = await sendBitcoinCpfpChild({
    apiUrl: network.rpcUrl,
    privateKey: currentBitcoinPrivateKey,
    address,
    parentInputs: cpfpParents.map((tx) => tx.bitcoinCpfpInput!),
    feeRateSatVb: nextFeeRate,
    parentFeeSats,
    parentVbytes,
  });
  const now = Date.now();
  await upsertTxRecord({
    txHash: result.txHash,
    chainKind: 'bitcoin',
    from: address,
    to: address,
    value: result.amountSats,
    data: '0x',
    createdAt: now,
    updatedAt: now,
    status: 'pending',
    source: 'local',
    shellType: 'bitcoinCpfp',
    rbfEnabled: result.rbfEnabled,
    bitcoinInputs: result.inputs,
    bitcoinFeeSats: result.feeSats,
    bitcoinChangeSats: result.changeSats,
    bitcoinFeeRateSatVb: result.feeRateSatVb,
    bitcoinVbytes: result.estimatedVbytes,
    cpfpParentTxHash: parent.txHash,
    cpfpParentTxHashes: cpfpParents.map((tx) => tx.txHash),
    cpfpTargetFeeRateSatVb: nextFeeRate,
    cpfpPackageFeeRateSatVb: result.packageFeeRateSatVb ?? null,
    cpfpAncestorCount: sumNullableNumbers(cpfpPolicies.map((policy) => policy.ancestorCount)),
    cpfpDescendantCount: sumNullableNumbers(cpfpPolicies.map((policy) => policy.descendantCount)),
  });
  await scheduleTxPolling();
  return { txHash: result.txHash };
}

function sumNullableBigIntStrings(values: Array<string | null | undefined>): string | null {
  let total = 0n;
  for (const value of values) {
    if (value == null) return null;
    total += BigInt(value);
  }
  return total.toString();
}

function sumNullableNumbers(values: Array<number | null | undefined>): number | null {
  let total = 0;
  for (const value of values) {
    if (value == null) return null;
    total += value;
  }
  return total;
}

async function getErc20Info(contractAddress: string) {
  const network = await getNetwork();
  const chainKind = getChainKind(network);
  if (chainKind !== 'shell' && chainKind !== 'evm') throw new Error('ERC20 is only available on Shell/EVM networks');
  const normalizedContract = normalizeRecipient(contractAddress);
  const [decimalsRaw, symbolRaw] = await Promise.all([
    rpcRequest<string>(network.rpcUrl, 'eth_call', [{ to: normalizedContract, data: '0x313ce567' }, 'latest']),
    rpcRequest<string>(network.rpcUrl, 'eth_call', [{ to: normalizedContract, data: '0x95d89b41' }, 'latest']),
  ]);
  return {
    contractAddress: normalizedContract,
    decimals: Number(decodeAbiUint(decimalsRaw)),
    symbol: decodeAbiString(symbolRaw) || 'ERC20',
  };
}

async function addErc20Token(contractAddress: string): Promise<{ ok: boolean }> {
  const network = await getNetwork();
  const chainKind = getChainKind(network);
  if (chainKind !== 'shell' && chainKind !== 'evm') throw new Error('ERC20 is only available on Shell/EVM networks');
  const info = await getErc20Info(contractAddress);
  await addWatchedToken({
    chainKind,
    chainId: network.chainId,
    contractAddress: info.contractAddress,
    symbol: info.symbol,
    decimals: info.decimals,
    addedAt: Date.now(),
  });
  return { ok: true };
}

async function removeErc20Token(contractAddress: string): Promise<{ ok: boolean }> {
  const network = await getNetwork();
  const chainKind = getChainKind(network);
  if (chainKind !== 'shell' && chainKind !== 'evm') throw new Error('ERC20 is only available on Shell/EVM networks');
  await removeWatchedToken(chainKind, network.chainId, normalizeRecipient(contractAddress));
  return { ok: true };
}

async function getErc20TokenBalance(input: {
  contractAddress: string;
  ownerAddress?: string;
  decimals?: number;
  symbol?: string;
}) {
  const network = await getNetwork();
  const chainKind = getChainKind(network);
  if (chainKind !== 'shell' && chainKind !== 'evm') throw new Error('ERC20 is only available on Shell/EVM networks');
  const account = await getActiveAccount();
  const ownerAddress = normalizeRecipient(input.ownerAddress ?? getAccountAddressForChain(account, chainKind) ?? '');
  const contractAddress = normalizeRecipient(input.contractAddress);
  const decimals = input.decimals ?? (await getErc20Info(contractAddress)).decimals;
  const balance = decodeAbiUint(await rpcRequest<string>(
    network.rpcUrl,
    'eth_call',
    [{ to: contractAddress, data: `0x70a08231${encodeShellAbiAddress(ownerAddress)}` }, 'latest'],
  ));
  return {
    balance: balance.toString(),
    formatted: formatTokenAmount(balance, decimals),
    decimals,
    symbol: input.symbol ?? null,
  };
}

async function sendErc20TokenTransfer(input: {
  contractAddress: string;
  to: string;
  amount: string;
  decimals: number;
  symbol?: string;
}): Promise<{ txHash: string }> {
  if (!currentSigner) throw new Error('Wallet is locked');
  const network = await getNetwork();
  const chainKind = getChainKind(network);
  if (chainKind !== 'shell' && chainKind !== 'evm') throw new Error('ERC20 is only available on Shell/EVM networks');
  const contractAddress = normalizeRecipient(input.contractAddress);
  const to = normalizeRecipient(input.to);
  const amountBaseUnits = parseTokenAmount(input.amount, input.decimals);
  const data = `0xa9059cbb${encodeShellAbiAddress(to)}${encodeAbiUint(amountBaseUnits)}`;
  const { txHash } = await sendTransaction({ to: contractAddress, value: '0', data });
  const record = (await getTxQueue()).find((tx) => tx.txHash.toLowerCase() === txHash.toLowerCase());
  if (record) {
    await upsertTxRecord({
      ...record,
      to,
      value: amountBaseUnits.toString(),
      shellType: 'erc20Transfer',
      tokenContract: contractAddress,
      tokenSymbol: input.symbol ?? null,
      tokenDecimals: input.decimals,
    });
  }
  return { txHash };
}

async function revokeErc20Approval(input: { tokenContract: string; spender: string }): Promise<{ txHash: string }> {
  const network = await getNetwork();
  const chainKind = getChainKind(network);
  if (chainKind !== 'shell' && chainKind !== 'evm') throw new Error('ERC20 revoke is only available on Shell/EVM networks');
  const tokenContract = normalizeRecipient(input.tokenContract);
  const spender = normalizeRecipient(input.spender);
  const data = `0x095ea7b3${encodeShellAbiAddress(spender)}${'0'.repeat(64)}`;
  return sendTransaction({
    to: tokenContract,
    value: '0',
    data,
    expectedChainId: network.chainId,
  });
}

async function getSplInfo(contractAddress: string) {
  const network = await getNetwork();
  if (getChainKind(network) !== 'solana') throw new Error('SPL is only available on Solana networks');
  return getSplTokenInfo(network.rpcUrl, contractAddress);
}

async function addSplToken(contractAddress: string): Promise<{ ok: boolean }> {
  const network = await getNetwork();
  if (getChainKind(network) !== 'solana') throw new Error('SPL is only available on Solana networks');
  const info = await getSplInfo(contractAddress);
  await addWatchedToken({
    chainKind: 'solana',
    chainId: network.chainId,
    contractAddress: info.contractAddress,
    symbol: info.symbol,
    decimals: info.decimals,
    addedAt: Date.now(),
  });
  return { ok: true };
}

async function removeSplToken(contractAddress: string): Promise<{ ok: boolean }> {
  const network = await getNetwork();
  if (getChainKind(network) !== 'solana') throw new Error('SPL is only available on Solana networks');
  await removeWatchedToken('solana', network.chainId, contractAddress);
  return { ok: true };
}

async function getSplTokenBalanceForActiveAccount(input: {
  contractAddress: string;
  ownerAddress?: string;
  decimals?: number;
  symbol?: string;
}) {
  const network = await getNetwork();
  if (getChainKind(network) !== 'solana') throw new Error('SPL is only available on Solana networks');
  const account = await getActiveAccount();
  const ownerAddress = input.ownerAddress ?? getAccountAddressForChain(account, 'solana');
  if (!ownerAddress) throw new Error('No Solana address is available for this account');
  return getSplTokenBalance({
    rpcUrl: network.rpcUrl,
    ownerAddress,
    mintAddress: input.contractAddress,
    decimals: input.decimals,
    symbol: input.symbol,
  });
}

async function sendSplTokenTransferForActiveAccount(input: {
  contractAddress: string;
  to: string;
  amount: string;
  decimals: number;
  symbol?: string;
  createRecipientAta?: boolean;
}): Promise<{ txHash: string }> {
  if (!currentSolanaPrivateKey) throw new Error('Solana key is not available for this account');
  const network = await getNetwork();
  if (getChainKind(network) !== 'solana') throw new Error('SPL is only available on Solana networks');
  const account = await getActiveAccount();
  const from = getAccountAddressForChain(account, 'solana');
  if (!from) throw new Error('No Solana address is available for this account');
  const amountBaseUnits = parseTokenAmount(input.amount, input.decimals);
  const { txHash } = await sendSplTokenTransfer({
    rpcUrl: network.rpcUrl,
    privateKey: currentSolanaPrivateKey,
    ownerAddress: from,
    recipientOwnerAddress: input.to,
    mintAddress: input.contractAddress,
    amountBaseUnits,
    decimals: input.decimals,
    createRecipientAta: input.createRecipientAta,
  });
  await upsertTxRecord({
    txHash,
    chainKind: 'solana',
    from,
    to: input.to,
    value: amountBaseUnits.toString(),
    data: '0x',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'pending',
    source: 'local',
    shellType: 'splTransfer',
    tokenContract: input.contractAddress,
    tokenSymbol: input.symbol ?? null,
    tokenDecimals: input.decimals,
  });
  await scheduleTxPolling();
  return { txHash };
}

async function getSplRecipientAccountStatusForActiveAccount(input: {
  contractAddress: string;
  to: string;
  amount: string;
  decimals: number;
}) {
  const network = await getNetwork();
  if (getChainKind(network) !== 'solana') throw new Error('SPL is only available on Solana networks');
  const account = await getActiveAccount();
  const from = getAccountAddressForChain(account, 'solana');
  if (!from) throw new Error('No Solana address is available for this account');
  return getSplRecipientAccountStatus({
    rpcUrl: network.rpcUrl,
    ownerAddress: from,
    recipientOwnerAddress: input.to,
    mintAddress: input.contractAddress,
    amountBaseUnits: parseTokenAmount(input.amount, input.decimals),
  });
}

async function getTrc20Info(contractAddress: string) {
  const network = await getNetwork();
  if (getChainKind(network) !== 'tron') throw new Error('TRC20 is only available on Tron networks');
  const account = await getActiveAccount();
  const ownerAddress = getAccountAddressForChain(account, 'tron');
  if (!ownerAddress) throw new Error('No Tron address is available for this account');
  return getTrc20TokenInfo(network.rpcUrl, ownerAddress, contractAddress);
}

async function addTrc20Token(contractAddress: string): Promise<{ ok: boolean }> {
  const network = await getNetwork();
  if (getChainKind(network) !== 'tron') throw new Error('TRC20 is only available on Tron networks');
  const info = await getTrc20Info(contractAddress);
  await addWatchedToken({
    chainKind: 'tron',
    chainId: network.chainId,
    contractAddress: info.contractAddress,
    symbol: info.symbol ?? 'TRC20',
    decimals: info.decimals,
    addedAt: Date.now(),
  });
  return { ok: true };
}

async function removeTrc20Token(contractAddress: string): Promise<{ ok: boolean }> {
  const network = await getNetwork();
  if (getChainKind(network) !== 'tron') throw new Error('TRC20 is only available on Tron networks');
  await removeWatchedToken('tron', network.chainId, contractAddress);
  return { ok: true };
}

async function getTrc20TokenBalance(input: {
  contractAddress: string;
  ownerAddress?: string;
  decimals?: number;
  symbol?: string;
}) {
  const network = await getNetwork();
  if (getChainKind(network) !== 'tron') throw new Error('TRC20 is only available on Tron networks');
  const account = await getActiveAccount();
  const ownerAddress = input.ownerAddress ?? getAccountAddressForChain(account, 'tron');
  if (!ownerAddress) throw new Error('No Tron address is available for this account');
  return getTrc20Balance({
    rpcUrl: network.rpcUrl,
    ownerAddress,
    contractAddress: input.contractAddress,
    decimals: input.decimals,
    symbol: input.symbol,
  });
}

async function sendTrc20TokenTransfer(input: {
  contractAddress: string;
  to: string;
  amount: string;
  decimals: number;
  symbol?: string;
}): Promise<{ txHash: string }> {
  if (!currentSigner) throw new Error('Wallet is locked');
  if (!currentTronPrivateKey) throw new Error('Tron key is not available for this account');
  const network = await getNetwork();
  if (getChainKind(network) !== 'tron') throw new Error('TRC20 is only available on Tron networks');
  const activeAccount = await getActiveAccount();
  const from = getAccountAddressForChain(activeAccount, 'tron');
  if (!from) throw new Error('No Tron address is available for this account');

  const { txHash, amountBaseUnits } = await sendTrc20Transfer({
    rpcUrl: network.rpcUrl,
    privateKey: currentTronPrivateKey,
    from,
    contractAddress: input.contractAddress,
    to: input.to,
    amount: input.amount,
    decimals: input.decimals,
  });

  await upsertTxRecord({
    txHash,
    chainKind: 'tron',
    from,
    to: input.to,
    value: amountBaseUnits,
    data: '0x',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'pending',
    source: 'local',
    shellType: 'trc20Transfer',
    tokenContract: input.contractAddress,
    tokenSymbol: input.symbol ?? null,
    tokenDecimals: input.decimals,
  });
  await scheduleTxPolling();
  return { txHash };
}

async function getJettonInfo(contractAddress: string) {
  const network = await getNetwork();
  if (getChainKind(network) !== 'ton') throw new Error('Jetton is only available on TON networks');
  const account = await getActiveAccount();
  const ownerAddress = getAccountAddressForChain(account, 'ton');
  if (!ownerAddress) throw new Error('No TON address is available for this account');
  return getTonJettonInfo(network.rpcUrl, contractAddress, ownerAddress);
}

async function addJettonToken(contractAddress: string): Promise<{ ok: boolean }> {
  const network = await getNetwork();
  if (getChainKind(network) !== 'ton') throw new Error('Jetton is only available on TON networks');
  const info = await getJettonInfo(contractAddress);
  await addWatchedToken({
    chainKind: 'ton',
    chainId: network.chainId,
    contractAddress: info.contractAddress,
    symbol: info.symbol,
    decimals: info.decimals,
    addedAt: Date.now(),
  });
  return { ok: true };
}

async function removeJettonToken(contractAddress: string): Promise<{ ok: boolean }> {
  const network = await getNetwork();
  if (getChainKind(network) !== 'ton') throw new Error('Jetton is only available on TON networks');
  await removeWatchedToken('ton', network.chainId, contractAddress);
  return { ok: true };
}

async function getJettonTokenBalance(input: {
  contractAddress: string;
  ownerAddress?: string;
  decimals?: number;
  symbol?: string;
}) {
  const network = await getNetwork();
  if (getChainKind(network) !== 'ton') throw new Error('Jetton is only available on TON networks');
  const account = await getActiveAccount();
  const ownerAddress = input.ownerAddress ?? getAccountAddressForChain(account, 'ton');
  if (!ownerAddress) throw new Error('No TON address is available for this account');
  return getTonJettonBalance({
    apiUrl: network.rpcUrl,
    masterAddress: input.contractAddress,
    ownerAddress,
    decimals: input.decimals,
    symbol: input.symbol,
  });
}

async function getJettonTokenHistory(input: {
  contractAddress: string;
  ownerAddress?: string;
  page?: number;
  limit?: number;
}) {
  const network = await getNetwork();
  if (getChainKind(network) !== 'ton') throw new Error('Jetton is only available on TON networks');
  const account = await getActiveAccount();
  const ownerAddress = input.ownerAddress ?? getAccountAddressForChain(account, 'ton');
  if (!ownerAddress) throw new Error('No TON address is available for this account');
  return getTonJettonTransactionHistoryForMaster(
    network.rpcUrl,
    ownerAddress,
    input.contractAddress,
    input.page ?? 0,
    input.limit ?? 20,
  );
}

async function sendJettonTokenTransfer(input: {
  contractAddress: string;
  to: string;
  amount: string;
  decimals: number;
  symbol?: string;
  jettonTransferTonAmount?: string;
  forwardTonAmount?: string;
}): Promise<{ txHash: string }> {
  if (!currentTonPrivateKey) throw new Error('TON key is not available for this account');
  const network = await getNetwork();
  if (getChainKind(network) !== 'ton') throw new Error('Jetton is only available on TON networks');
  const activeAccount = await getActiveAccount();
  const from = getAccountAddressForChain(activeAccount, 'ton');
  if (!from) throw new Error('No TON address is available for this account');
  const amountBaseUnits = parseTokenAmount(input.amount, input.decimals);
  const result = await sendTonJettonTransfer({
    apiUrl: network.rpcUrl,
    privateKey: currentTonPrivateKey,
    from,
    masterAddress: input.contractAddress,
    to: input.to,
    amountBaseUnits,
    jettonTransferTonAmount: input.jettonTransferTonAmount ? parseTon(input.jettonTransferTonAmount) : undefined,
    forwardTonAmount: input.forwardTonAmount ? parseTon(input.forwardTonAmount) : undefined,
  });
  await upsertTxRecord({
    txHash: result.txHash,
    chainKind: 'ton',
    from,
    to: input.to,
    value: amountBaseUnits.toString(),
    data: '0x',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'pending',
    source: 'local',
    shellType: 'jettonTransfer',
    tokenContract: input.contractAddress,
    tokenSymbol: input.symbol ?? null,
    tokenDecimals: input.decimals,
  });
  await scheduleTxPolling();
  return { txHash: result.txHash };
}

async function rotateActiveKey(password: string): Promise<{ txHash: string; pqAddress: string }> {
  if (!currentSigner) throw new Error('Wallet is locked');

  const network = await getNetwork();
  const provider = buildProvider(network);
  const from = currentSigner.getAddress();
  const { publicKey, secretKey } = generateMlDsa65KeyPair();

  try {
    const onChainNonce = await provider.client.getTransactionCount({ address: asPqAddress(from, 'getTransactionCount') });
    const nonce = await allocateNextNonce(from, onChainNonce);
    const tx = buildRotateKeyTransaction({
      chainId: network.chainId,
      nonce,
      publicKey,
      algorithmId: 1,
    });
    const signed = await currentSigner.buildSignedTransaction({
      tx,
      txHash: hashTransaction(tx),
      includePublicKey: nonce === 0,
    });
    const txHash = await provider.sendTransaction(signed);
    const keystore = await createKeystore(secretKey, publicKey, password, from, 'mldsa65');
    await addPendingKeyRotation({
      txHash,
      pqAddress: from,
      keystoreJson: JSON.stringify(keystore),
      createdAt: Date.now(),
    });
    await upsertTxRecord({
      txHash,
      chainKind: getChainKind(network),
      from,
      to: tx.to ?? from,
      value: '0',
      data: tx.data,
      nonce,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'pending',
      source: 'local',
      shellType: 'keyRotation',
    });
    await scheduleTxPolling();
    return { txHash, pqAddress: from };
  } finally {
    secretKey.fill(0);
  }
}

async function getTxHistory(
  address: string,
  page: number,
): Promise<{ txs: WalletTxRecord[]; total: number }> {
  const network = await getNetwork();
  const localTxs = (await getTxQueue()).filter((tx) => {
    return tx.from.toLowerCase() === address.toLowerCase() || tx.to?.toLowerCase() === address.toLowerCase();
  });

  const nativeChainKind = getNativeChainKind(getChainKind(network));
  if (nativeChainKind) {
    const nativeLocalTxs = localTxs.filter((tx) => tx.chainKind === nativeChainKind);
    const nativeAdapter = getNativeChainAdapter(nativeChainKind);
    const remote = nativeAdapter?.getTransactionHistory
      ? await nativeAdapter.getTransactionHistory(network, address, page).catch(() => ({ txs: [], total: 0 }))
      : { txs: [], total: 0 };
    const merged = new Map<string, WalletTxRecord>();
    for (const tx of remote.txs) merged.set(tx.txHash.toLowerCase(), tx);
    for (const tx of nativeLocalTxs) merged.set(tx.txHash.toLowerCase(), tx);
    const txs = [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    return { txs, total: Math.max(remote.total, txs.length) };
  }

  const provider = buildProvider(network);
  const result = (await provider.getTransactionsByAddress(address, {
    page,
    limit: 20,
  })) as { transactions?: unknown[]; total?: number } | null;

  const remoteTxs = (result?.transactions ?? [])
    .map((tx) => normalizeRemoteTxRecord(tx))
    .filter((tx): tx is WalletTxRecord => tx !== null);

  const merged = new Map<string, WalletTxRecord>();
  for (const tx of remoteTxs) merged.set(tx.txHash.toLowerCase(), tx);
  for (const tx of localTxs) merged.set(tx.txHash.toLowerCase(), tx);

  const txs = [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  return { txs, total: Math.max(result?.total ?? 0, txs.length) };
}

async function pollPendingTransactions(): Promise<void> {
  const txQueue = await getTxQueue();
  const pending = txQueue.filter((tx) => tx.status === 'pending');
  if (pending.length === 0) {
    chrome.alarms.clear(TX_POLL_ALARM);
    return;
  }

  const network = await getNetwork();
  const chainKind = getChainKind(network);
  const nativeAdapter = getNativeChainAdapter(chainKind);
  const provider = nativeAdapter ? null : buildProvider(network);
  let changed = false;

  const next = await Promise.all(txQueue.map(async (tx) => {
    if (tx.status !== 'pending') return tx;
    const txChainKind = tx.chainKind ?? 'shell';
    if (txChainKind !== chainKind) return tx;
    try {
      const txNativeAdapter = getNativeChainAdapter(txChainKind);
      if (txNativeAdapter) {
        const status = await txNativeAdapter.getTransactionStatus(network, tx);
        if (status.status === 'pending') {
          const staleTonPending = txChainKind === 'ton'
            && tx.source === 'local'
            && Date.now() - tx.createdAt > TON_PENDING_TIMEOUT_MS;
          if (!staleTonPending) return tx;
          changed = true;
          return {
            ...tx,
            status: 'failed',
            error: 'TON transaction was not found after 24 hours. Check explorer history before retrying.',
            updatedAt: Date.now(),
          } satisfies WalletTxRecord;
        }
        changed = true;
        return {
          ...tx,
          blockNumber: status.blockNumber ?? null,
          status: status.status,
          error: status.error,
          updatedAt: Date.now(),
        } satisfies WalletTxRecord;
      }
      if (!provider) return tx;
      const receipt = await provider.client.getTransactionReceipt({ hash: tx.txHash as `0x${string}` });
      changed = true;
      return {
        ...tx,
        blockNumber: receipt.blockNumber ? `0x${receipt.blockNumber.toString(16)}` : null,
        status: receipt.status === 'success' ? 'confirmed' : 'failed',
        error: receipt.status === 'reverted' ? 'Transaction reverted on-chain' : undefined,
        updatedAt: Date.now(),
      } satisfies WalletTxRecord;
    } catch {
      return tx;
    }
  }));

  if (changed) {
    await setTxQueue(next);
    await applyPendingKeyRotations(next);
  }
  await scheduleTxPolling();
}

async function applyPendingKeyRotations(txQueue: WalletTxRecord[]): Promise<void> {
  const pending = await getPendingKeyRotations();
  if (pending.length === 0) return;

  const remaining = [];
  let activated = false;
  for (const rotation of pending) {
    const tx = txQueue.find((item) => item.txHash.toLowerCase() === rotation.txHash.toLowerCase());
    if (!tx || tx.status === 'pending') {
      remaining.push(rotation);
      continue;
    }
    if (tx.status === 'confirmed') {
      await replaceAccountKeystore(rotation.pqAddress, rotation.keystoreJson);
      activated = true;
    }
  }

  await setPendingKeyRotations(remaining);
  if (activated) {
    await lockWallet();
  }
}

async function allocateNextNonce(from: string, onChainNonce: number): Promise<number> {
  const key = from.toLowerCase();
  const txQueue = await getTxQueue();
  const pendingNonces = txQueue
    .filter((tx) => tx.status === 'pending' && tx.from.toLowerCase() === key)
    .map((tx) => tx.nonce)
    .filter((nonce): nonce is number => nonce != null)
    .sort((a, b) => b - a);

  // Also consider nonces already handed out this session but not yet in the queue
  // (covers the race window between allocateNextNonce returning and upsertTxRecord writing).
  const inFlight = allocatedNonces.get(key) ?? -1;
  const queueMax = pendingNonces.length > 0 ? pendingNonces[0] : -1;
  const next = Math.max(onChainNonce, queueMax + 1, inFlight + 1);
  allocatedNonces.set(key, next);
  return next;
}

async function getNodeInfoFromNode(rpcUrl: string): Promise<WalletNodeInfo | null> {
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'shell_getNodeInfo', params: [] }),
    });
    const data = await res.json() as { result?: WalletNodeInfo; error?: unknown };
    if (data.error || !data.result) return null;
    return data.result;
  } catch {
    return null;
  }
}

async function rpcRequest<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  if (!res.ok) {
    throw new Error(`rpc request failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json() as { result?: T; error?: { code?: number; message?: string } };
  if (data.error) {
    throw new Error(`[${data.error.code ?? -32000}] ${data.error.message ?? 'RPC error'}`);
  }
  return data.result as T;
}

async function handleDappRequest(message: DappRequestMessage): Promise<unknown> {
  const origin = normalizeOrigin(message.origin);
  const network = await getNetwork();
  if (!getAllowedDappMethodsForNetwork(network).includes(message.method)) {
    throw new Error(`Unsupported dApp method: ${message.method}`);
  }
  const activeAccount = await getActiveAccount();
  const permission = await getConnectedPermission(origin);
  const nativeDappAdapter = getNativeDappAdapter(message.method);
  if (nativeDappAdapter) {
    return handleNativeDappRequest(nativeDappAdapter, message, {
      origin,
      network,
      activeAccount,
      permission,
    });
  }
  if (isShellDappMethod(message.method)) {
    return handleShellDappRequest(message, {
      origin,
      network,
      activeAccount,
      permission,
    });
  }
  const tokenProvider = getTokenProviderAdapterForDappMethod(message.method);
  if (tokenProvider) {
    return handleTokenProviderDappRequest(tokenProvider, message, {
      origin,
      network,
      activeAccount,
      permission,
    });
  }
  if (APTOS_DAPP_METHODS.includes(message.method)) {
    return handleAptosDappRequest(message, {
      origin,
      network,
      activeAccount,
      permission,
    });
  }

  switch (message.method) {
    case 'tonconnect_connect': {
      const request = normalizeTonConnectDappConnectRequest(message.params);
      return approveTonConnectProposal({
        clientId: request.clientId,
        origin,
        manifestUrl: request.manifestUrl,
        requestedItems: request.requestedItems,
        features: request.features,
      });
    }
    case 'tonconnect_restoreConnection': {
      const sessions = (await getTonConnectSessions()).filter((session) => session.origin === origin);
      return { sessions };
    }
    case 'tonconnect_send': {
      const request = normalizeTonConnectDappSendRequest(message.params);
      if (request.method === 'signData') {
        return executeTonConnectSignData({
          origin,
          clientId: request.clientId,
          payload: request.payload,
        });
      }
      if (request.method === 'ton_proof') {
        return executeTonConnectTonProof({
          origin,
          clientId: request.clientId,
          payload: request.payload,
        });
      }
      if (request.method !== 'sendTransaction') throw new Error(`Unsupported TonConnect request method: ${request.method}`);
      return executeTonConnectSendTransaction({
        origin,
        clientId: request.clientId,
        transaction: request.payload,
      });
    }
    default:
      throw new Error(`Unsupported dApp method: ${message.method}`);
  }
}

function normalizeTonConnectDappConnectRequest(params: unknown[] | undefined): {
  clientId: string;
  manifestUrl: string;
  requestedItems: string[];
  features?: TonConnectFeature[];
} {
  const [payload] = normalizeArrayParams(params);
  if (!payload || typeof payload !== 'object') {
    throw new Error('tonconnect_connect requires a request object');
  }
  const candidate = payload as Record<string, unknown>;
  return {
    clientId: requireString(candidate.clientId ?? candidate.appPublicKey, 'clientId'),
    manifestUrl: requireString(candidate.manifestUrl, 'manifestUrl'),
    requestedItems: optionalStringArray(candidate.requestedItems) ?? [],
    features: normalizeTonConnectFeatures(candidate.features),
  };
}

function normalizeTonConnectDappSendRequest(params: unknown[] | undefined): {
  clientId: string;
  method: string;
  payload: Record<string, unknown>;
} {
  const [rawRequest] = normalizeArrayParams(params);
  if (!rawRequest || typeof rawRequest !== 'object') {
    throw new Error('tonconnect_send requires a request object');
  }
  const candidate = rawRequest as Record<string, unknown>;
  const method = requireString(candidate.method, 'method');
  const clientId = requireString(candidate.clientId, 'clientId');
  const rawParams = Array.isArray(candidate.params) ? candidate.params : [];
  const requestPayload = rawParams[0] && typeof rawParams[0] === 'object'
    ? rawParams[0] as Record<string, unknown>
    : candidate.transaction && typeof candidate.transaction === 'object'
      ? candidate.transaction as Record<string, unknown>
      : candidate.payload && typeof candidate.payload === 'object'
        ? candidate.payload as Record<string, unknown>
      : null;
  if (!requestPayload) throw new Error('TonConnect request requires a payload object');
  return { clientId, method, payload: requestPayload };
}

function getNativeDappAdapter(method: string): NativeDappAdapter | null {
  return NATIVE_DAPP_ADAPTERS.find((adapter) =>
    adapter.connectMethods.includes(method) ||
    adapter.accountsMethod === method ||
    adapter.chainIdMethod === method ||
    adapter.balanceMethod === method ||
    adapter.sendMethods.includes(method),
  ) ?? null;
}

function getTokenProviderAdapterForMessage(type: string): TokenProviderAdapter | null {
  return TOKEN_PROVIDER_ADAPTERS.find((adapter) => (
    adapter.messageTypes.includes(type) || adapter.preflightMessageTypes?.includes(type) === true
  )) ?? null;
}

function getTokenProviderAdapterForDappMethod(method: string): TokenProviderAdapter | null {
  return TOKEN_PROVIDER_ADAPTERS.find((adapter) => adapter.dappSendMethod === method) ?? null;
}

function getAllowedDappMethodsForNetwork(network: Network): string[] {
  const chainKind = getChainKind(network);
  const capabilities = getChainCapabilities(chainKind);
  const methods: string[] = [];

  if (capabilities.dappProvider && capabilities.smartContracts && (chainKind === 'shell' || chainKind === 'evm')) {
    methods.push(...SHELL_DAPP_METHODS);
  }

  if (capabilities.dappProvider) {
    for (const adapter of NATIVE_DAPP_ADAPTERS) {
      if (adapter.chainKind !== chainKind) continue;
      methods.push(
        ...adapter.connectMethods,
        adapter.accountsMethod,
        adapter.chainIdMethod,
        adapter.balanceMethod,
        ...adapter.sendMethods,
      );
    }
  }

  if (capabilities.tokenTransfers) {
    for (const adapter of TOKEN_PROVIDER_ADAPTERS) {
      if (adapter.chainKind === chainKind) methods.push(adapter.dappSendMethod);
    }
  }

  if (chainKind === 'ton') {
    methods.push(...TONCONNECT_DAPP_METHODS);
  }

  if (chainKind === 'aptos' && capabilities.dappProvider) {
    methods.push(...APTOS_DAPP_METHODS);
  }

  return [...new Set(methods)];
}

function getAllowedWalletConnectMethodsForNetwork(network: Network): string[] {
  const methods = getAllowedDappMethodsForNetwork(network);
  if (getChainKind(network) === 'cosmos') methods.push(...COSMOS_WALLETCONNECT_SIGN_METHODS);
  return [...new Set(methods)];
}

async function handleAptosDappRequest(
  message: DappRequestMessage,
  context: {
    origin: string;
    network: Network;
    activeAccount: StoredAccount | null;
    permission: ConnectedSitePermission | null;
  },
): Promise<unknown> {
  const { origin, network, activeAccount, permission } = context;
  if (getChainKind(network) !== 'aptos') throw new Error('Aptos dApp methods require an Aptos network');
  if (!activeAccount) throw new Error('No wallet found');
  if (!currentAptosKeyPair) throw new Error('Aptos key is not available for this account');
  const account = getAccountAddressForChain(activeAccount, 'aptos');
  if (!account) throw new Error('No Aptos address is available for this account');

  if (message.method === 'aptos_connect') {
    if (getConnectedActiveAccountAddress(permission, activeAccount, 'aptos') === account) {
      if (!permission) throw new Error(`Site not connected: ${origin}`);
      await addConnectedSite(buildConnectedSite(origin, account, network.chainId, permission.grantedAt, getAccountId(activeAccount)));
      return formatAptosDappAccount(account);
    }
    const approved = await requestUserApproval({
      kind: 'connect',
      origin,
      createdAt: Date.now(),
      payload: {
        account,
        chainId: network.chainId,
        networkName: network.name,
        chainKind: 'aptos',
      },
    });
    if (!approved) throw new Error('Request rejected by user');
    const granted = buildConnectedSite(origin, account, network.chainId, permission?.grantedAt, getAccountId(activeAccount));
    await addConnectedSite(granted);
    return formatAptosDappAccount(account);
  }

  if (message.method === 'aptos_network') {
    return { name: network.name, chainId: network.chainId, url: network.rpcUrl };
  }

  if (message.method === 'aptos_account') {
    const connectedAccount = getConnectedActiveAccountAddress(permission, activeAccount, 'aptos');
    return connectedAccount ? formatAptosDappAccount(connectedAccount) : null;
  }

  if (message.method === 'aptos_getBalance') {
    const activeConnectedAccount = requireConnectedActiveAccount(permission, origin, activeAccount, 'aptos');
    const [candidateAddress] = normalizeArrayParams(message.params);
    const address = typeof candidateAddress === 'string' ? candidateAddress : activeConnectedAccount;
    return getAptosBalance(network.rpcUrl, address);
  }

  if (message.method === 'aptos_signAndSubmitTransaction') {
    const activeConnectedAccount = requireConnectedActiveAccount(permission, origin, activeAccount, 'aptos');
    const payload = normalizeAptosDappSubmitPayload(message.params);
    const preview = previewAptosDappPayload(payload);
    if (preview.knownAction !== 'nativeTransfer' || !preview.recipient || !preview.amountOctas) {
      throw new Error('Only Aptos native transfer dApp payloads are supported.');
    }
    const approved = await requestUserApproval({
      kind: 'aptos-sign-transaction',
      origin,
      createdAt: Date.now(),
      payload: {
        account: activeConnectedAccount,
        chainId: network.chainId,
        ...preview,
      },
    });
    if (!approved) throw new Error('Request rejected by user');
    const result = await sendAptosTransaction(network, {
      to: preview.recipient,
      value: formatApt(BigInt(preview.amountOctas)),
    });
    return { hash: result.txHash };
  }

  throw new Error(`Unsupported dApp method: ${message.method}`);
}

function formatAptosDappAccount(address: string): { address: string; publicKey: string } {
  return {
    address,
    publicKey: currentAptosKeyPair ? `0x${hexFromBytes(currentAptosKeyPair.publicKey)}` : '',
  };
}

function normalizeAptosDappSubmitPayload(params: unknown[] | undefined): unknown {
  const [input] = normalizeArrayParams(params);
  if (!input || typeof input !== 'object') throw new Error('aptos_signAndSubmitTransaction requires a payload object');
  const candidate = input as Record<string, unknown>;
  return candidate.payload && typeof candidate.payload === 'object' ? candidate.payload : candidate;
}

function hexFromBytes(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function getNetworkForChainId(chainId: number, activeNetwork?: Network): Network | null {
  if (activeNetwork?.chainId === chainId) return activeNetwork;
  const known = findKnownNetwork(chainId);
  if (known) return known;
  return null;
}

function getWalletConnectNamespace(network: Network): string {
  const chainKind = getChainKind(network);
  if (chainKind === 'tron') return 'tron';
  if (chainKind === 'solana') return 'solana';
  if (chainKind === 'bitcoin') return 'bip122';
  if (chainKind === 'cosmos') return 'cosmos';
  return 'eip155';
}

function getWalletConnectChainId(network: Network): string {
  return `${getWalletConnectNamespace(network)}:${network.chainId}`;
}

function parseWalletConnectChainId(chain: string): number {
  const [, id] = chain.split(':');
  if (!id) throw new Error(`Unsupported WalletConnect chain id: ${chain}`);
  const chainId = Number(id);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error(`Unsupported WalletConnect chain id: ${chain}`);
  }
  return chainId;
}

function walletConnectAccount(network: Network, address: string): string {
  return `${getWalletConnectChainId(network)}:${address}`;
}

async function startWalletConnectPairing(
  uri: string,
  options: { expirySeconds?: number; useRelay?: boolean; projectId?: string; relayUrl?: string } = {},
): Promise<WalletConnectPairing> {
  const pairing = parseWalletConnectPairingUri(uri, options.expirySeconds);
  if (options.useRelay) {
    const config = await getWalletConnectConfig();
    const bridge = await getWalletConnectBridge({
      projectId: options.projectId ?? config.projectId,
      relayUrl: options.relayUrl ?? config.relayUrl,
    });
    const relayPairing = await bridge.pair(uri, pairing);
    await upsertWalletConnectPairing(relayPairing);
    return relayPairing;
  }
  await upsertWalletConnectPairing(pairing);
  return pairing;
}

async function getWalletConnectRelayStatus(): Promise<WalletConnectRelayStatus> {
  if (!walletConnectBridgePromise) {
    return {
      initialized: false,
      connected: false,
      relayUrl: null,
      projectIdConfigured: false,
      lastError: null,
    };
  }
  const bridge = await walletConnectBridgePromise;
  return bridge.getStatus();
}

async function getWalletConnectBridge(options: { projectId?: string; relayUrl?: string } = {}): Promise<WalletConnectBridge> {
  if (!walletConnectBridgePromise) {
    walletConnectBridgePromise = import('./walletconnect-bridge.js')
      .then((module) => module.initWalletConnectBridge({
        onSessionProposal: async (proposal) => approveWalletConnectProposalForRelay(proposal),
        onSessionApproved: async (session) => {
          await createWalletConnectSessionFromProposal({
            topic: session.sessionTopic,
            origin: session.origin,
            requiredNamespaces: session.requiredNamespaces,
            optionalNamespaces: session.optionalNamespaces,
            expirySeconds: session.expirySeconds,
          });
        },
        onSessionRequest: async (request) => handleWalletConnectRpcEvent({
          id: request.id,
          type: 'session_request',
          topic: request.topic,
          params: {
            chainId: request.chainId,
            request: request.request,
          },
        }),
        onSessionDelete: async (topic) => {
          await removeWalletConnectSession(topic);
        },
      }, options))
      .catch((err) => {
        walletConnectBridgePromise = null;
        throw err;
      });
  }
  return walletConnectBridgePromise;
}

function parseWalletConnectPairingUri(uri: string, expirySeconds?: number): WalletConnectPairing {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error('WalletConnect URI is invalid');
  }
  if (parsed.protocol !== 'wc:') throw new Error('WalletConnect URI must use wc: scheme');
  const [topic, version] = parsed.pathname.split('@');
  if (!topic || version !== '2') throw new Error('WalletConnect URI must be a v2 pairing URI');
  const relayProtocol = parsed.searchParams.get('relay-protocol') ?? '';
  const symKey = parsed.searchParams.get('symKey') ?? '';
  if (!relayProtocol) throw new Error('WalletConnect URI missing relay-protocol');
  if (!symKey) throw new Error('WalletConnect URI missing symKey');
  const ttl = expirySeconds ?? 5 * 60;
  if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > 24 * 60 * 60) {
    throw new Error('expirySeconds must be between 1 second and 1 day');
  }
  const now = Date.now();
  return {
    topic,
    uri,
    relayProtocol,
    symKey,
    createdAt: now,
    expiresAt: now + ttl * 1000,
  };
}

async function createWalletConnectSession(input: {
  topic: string;
  origin: string;
  chainIds?: number[];
  methods?: string[];
  expirySeconds?: number;
}): Promise<WalletConnectSession> {
  const activeAccount = await getActiveAccount();
  if (!activeAccount) throw new Error('No wallet found');
  if (!currentSigner) throw new Error('Wallet is locked');
  const network = await getNetwork();

  const chainIds = [...new Set(input.chainIds?.length ? input.chainIds : [network.chainId])];
  const chainNetworks = chainIds.map((chainId) => {
    const chainNetwork = getNetworkForChainId(chainId, network);
    if (!chainNetwork) throw new Error(`Unsupported WalletConnect chain id: ${chainId}`);
    return chainNetwork;
  });
  const accounts = [...new Set(chainNetworks.map((chainNetwork) => {
    const account = getAccountAddressForNetwork(activeAccount, chainNetwork);
    if (!account) throw new Error(`No address is available for chain ${chainNetwork.chainId}`);
    return account;
  }))];
  const allowedMethods = [...new Set(chainIds.flatMap((chainId) => {
    const chainNetwork = getNetworkForChainId(chainId, network);
    return chainNetwork ? getAllowedWalletConnectMethodsForNetwork(chainNetwork) : [];
  }))];
  if (allowedMethods.length === 0) throw new Error('No dApp methods are available for the requested chains');

  const methods = [...new Set(input.methods?.length ? input.methods : allowedMethods)];
  const invalidMethods = methods.filter((method) => !allowedMethods.includes(method));
  if (invalidMethods.length > 0) {
    throw new Error(`WalletConnect session method is not allowed: ${invalidMethods[0]}`);
  }

  const now = Date.now();
  const expirySeconds = input.expirySeconds ?? 7 * 24 * 60 * 60;
  if (!Number.isSafeInteger(expirySeconds) || expirySeconds <= 0 || expirySeconds > 30 * 24 * 60 * 60) {
    throw new Error('expirySeconds must be between 1 second and 30 days');
  }
  const session: WalletConnectSession = {
    topic: input.topic,
    origin: normalizeOrigin(input.origin),
    accounts,
    chainIds,
    methods,
    grantedAt: now,
    lastUsedAt: now,
    expiresAt: now + expirySeconds * 1000,
  };
  await upsertWalletConnectSession(session);
  await addConnectedSite(buildConnectedSite(session.origin, accounts[0], network.chainId, now, getAccountId(activeAccount)));
  return session;
}

function getDefaultTonConnectFeatures(): TonConnectFeature[] {
  return [
    { name: 'SendTransaction', maxMessages: 4 },
    { name: 'SignData', types: ['text', 'binary', 'cell'] },
    { name: 'ton_proof' },
  ];
}

function normalizeTonConnectFeatures(value: unknown): TonConnectFeature[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('features must be an array');
  const seen = new Set<string>();
  const features = value.map((entry) => {
    if (typeof entry === 'string') return { name: entry };
    if (!entry || typeof entry !== 'object') throw new Error('features must contain objects');
    const candidate = entry as Record<string, unknown>;
    const feature: TonConnectFeature = { name: requireString(candidate.name, 'features.name') };
    if (candidate.maxMessages !== undefined) feature.maxMessages = requireNumber(candidate.maxMessages, 'features.maxMessages');
    if (candidate.types !== undefined) feature.types = optionalStringArray(candidate.types);
    return feature;
  }).filter((feature) => {
    const name = feature.name.trim();
    if (!name || seen.has(name)) return false;
    seen.add(name);
    feature.name = name;
    return true;
  });
  return features.length > 0 ? features : undefined;
}

function getTonConnectNetworkName(network: Network): 'mainnet' | 'testnet' {
  if (network.chainId === KNOWN_NETWORKS.tonMainnet.chainId) return 'mainnet';
  if (network.chainId === KNOWN_NETWORKS.tonTestnet.chainId) return 'testnet';
  throw new Error('TonConnect is only available on TON networks');
}

function normalizeManifestUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('TonConnect manifestUrl must be an HTTP(S) URL');
  }
  return url.toString();
}

async function createTonConnectSession(input: {
  clientId: string;
  origin: string;
  manifestUrl: string;
  features?: TonConnectFeature[];
  expirySeconds?: number;
}): Promise<TonConnectSession> {
  const activeAccount = await getActiveAccount();
  if (!activeAccount) throw new Error('No wallet found');
  if (!currentTonPrivateKey) throw new Error('TON key is not available for this account');
  const network = await getNetwork();
  if (getChainKind(network) !== 'ton') throw new Error('TonConnect is only available on TON networks');
  const account = getAccountAddressForChain(activeAccount, 'ton');
  if (!account) throw new Error('No TON address is available for this account');

  const now = Date.now();
  const expirySeconds = input.expirySeconds ?? 7 * 24 * 60 * 60;
  if (!Number.isSafeInteger(expirySeconds) || expirySeconds <= 0 || expirySeconds > 30 * 24 * 60 * 60) {
    throw new Error('expirySeconds must be between 1 second and 30 days');
  }

  const session: TonConnectSession = {
    clientId: input.clientId.trim(),
    origin: normalizeOrigin(input.origin),
    manifestUrl: normalizeManifestUrl(input.manifestUrl),
    account,
    chainId: network.chainId,
    network: getTonConnectNetworkName(network),
    features: input.features?.length ? input.features : getDefaultTonConnectFeatures(),
    grantedAt: now,
    lastUsedAt: now,
    expiresAt: now + expirySeconds * 1000,
  };
  await upsertTonConnectSession(session);
  return session;
}

async function approveTonConnectProposal(input: {
  clientId: string;
  origin: string;
  manifestUrl: string;
  requestedItems?: string[];
  features?: TonConnectFeature[];
  expirySeconds?: number;
}): Promise<TonConnectSession> {
  const activeAccount = await getActiveAccount();
  if (!activeAccount) throw new Error('No wallet found');
  const network = await getNetwork();
  if (getChainKind(network) !== 'ton') throw new Error('TonConnect is only available on TON networks');
  const account = getAccountAddressForChain(activeAccount, 'ton');
  if (!account) throw new Error('No TON address is available for this account');
  const features = input.features?.length ? input.features : getDefaultTonConnectFeatures();
  const approved = await requestUserApproval({
    kind: 'tonconnect-proposal',
    origin: normalizeOrigin(input.origin),
    createdAt: Date.now(),
    payload: {
      clientId: input.clientId,
      manifestUrl: normalizeManifestUrl(input.manifestUrl),
      account,
      chainId: network.chainId,
      network: getTonConnectNetworkName(network),
      features,
      requestedItems: input.requestedItems ?? [],
    },
  });
  if (!approved) throw new Error('Request rejected by user');
  return createTonConnectSession(input);
}

interface NormalizedTonConnectMessage {
  to: string;
  amountNanotons: bigint;
  payload?: string;
  stateInit?: string;
}

interface NormalizedTonConnectSignData {
  type: 'text' | 'binary' | 'cell';
  text?: string;
  bytes?: Uint8Array;
  cell?: string;
  schema?: string;
  displayPayload: string;
}

async function executeTonConnectSendTransaction(input: {
  origin: string;
  clientId: string;
  transaction: Record<string, unknown>;
}): Promise<{ txHash: string }> {
  const session = await getValidTonConnectSession(input.origin, input.clientId);
  const network = await getNetwork();
  if (getChainKind(network) !== 'ton') throw new Error('TonConnect is only available on TON networks');
  if (network.chainId !== session.chainId) throw new Error('TonConnect session network does not match the active network');
  if (!currentTonPrivateKey) throw new Error('TON key is not available for this account');
  const activeAccount = await getActiveAccount();
  const from = getAccountAddressForChain(activeAccount, 'ton');
  if (!from || from !== session.account) throw new Error('TonConnect session account does not match the active account');

  const validUntil = requireNumber(input.transaction.valid_until ?? input.transaction.validUntil, 'validUntil');
  if (!Number.isSafeInteger(validUntil) || validUntil <= Math.floor(Date.now() / 1000)) {
    throw new Error('TonConnect transaction has expired');
  }
  const messages = normalizeTonConnectMessages(input.transaction.messages);
  const maxMessages = getTonConnectMaxMessages(session);
  if (messages.length > maxMessages) throw new Error(`TonConnect transaction exceeds maxMessages=${maxMessages}`);

  const tonMessages = messages.map((message): TonInternalMessage => ({
    to: message.to,
    amountNanotons: message.amountNanotons,
    body: message.payload ? parseTonPayloadCell(message.payload) : undefined,
    stateInit: message.stateInit ? parseTonPayloadCell(message.stateInit) : undefined,
  }));
  const approved = await requestUserApproval({
    kind: 'tonconnect-request',
    origin: session.origin,
    createdAt: Date.now(),
    payload: {
      clientId: session.clientId,
      account: session.account,
      network: session.network,
      chainId: session.chainId,
      validUntil,
      messages: messages.map((message) => ({
        to: message.to,
        amountNanotons: message.amountNanotons.toString(),
        hasPayload: Boolean(message.payload),
        hasStateInit: Boolean(message.stateInit),
      })),
      totalNanotons: messages.reduce((sum, message) => sum + message.amountNanotons, 0n).toString(),
    },
  });
  if (!approved) throw new Error('Request rejected by user');

  const result = await sendTonInternalMessages({
    apiUrl: network.rpcUrl,
    privateKey: currentTonPrivateKey,
    from,
    messages: tonMessages,
  });
  await upsertTxRecord({
    txHash: result.txHash,
    chainKind: 'ton',
    from,
    to: messages.length === 1 ? messages[0].to : null,
    value: result.amountNanotons,
    data: messages.some((message) => message.payload || message.stateInit) ? 'tonconnect' : '0x',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'pending',
    source: 'local',
    shellType: 'tonConnectSendTransaction',
    nonce: result.seqno,
    tokenSymbol: network.symbol ?? 'TON',
    tokenDecimals: 9,
  });
  await scheduleTxPolling();
  await upsertTonConnectSession({ ...session, lastUsedAt: Date.now() });
  return { txHash: result.txHash };
}

async function getValidTonConnectSession(origin: string, clientId: string): Promise<TonConnectSession> {
  const sessions = await getTonConnectSessions();
  const normalizedOrigin = normalizeOrigin(origin);
  const session = sessions.find((item) => item.clientId === clientId && item.origin === normalizedOrigin);
  if (!session) throw new Error('TonConnect session not found');
  if (session.expiresAt <= Date.now()) {
    await removeTonConnectSession(session.clientId);
    throw new Error('TonConnect session has expired');
  }
  return session;
}

function getTonConnectMaxMessages(session: TonConnectSession): number {
  const feature = session.features.find((item) => item.name === 'SendTransaction');
  return feature?.maxMessages ?? 4;
}

function normalizeTonConnectMessages(value: unknown): NormalizedTonConnectMessage[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('TonConnect transaction messages are required');
  if (value.length > 4) throw new Error('TonConnect transaction cannot contain more than 4 messages');
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('TonConnect messages must contain objects');
    const candidate = entry as Record<string, unknown>;
    const amountNanotons = requireBigIntQuantity(candidate.amount, 'amount');
    if (amountNanotons <= 0n) throw new Error('Amount must be greater than zero');
    return {
      to: requireString(candidate.address ?? candidate.to, 'address'),
      amountNanotons,
      payload: optionalString(candidate.payload),
      stateInit: optionalString(candidate.stateInit ?? candidate.state_init),
    };
  });
}

async function executeTonConnectSignData(input: {
  origin: string;
  clientId: string;
  payload: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const context = await getTonConnectSigningContext(input.origin, input.clientId);
  const signData = normalizeTonConnectSignData(input.payload);
  ensureTonConnectSignDataFeature(context.session, signData.type);
  const approved = await requestUserApproval({
    kind: 'tonconnect-request',
    origin: context.session.origin,
    createdAt: Date.now(),
    payload: {
      method: 'signData',
      clientId: context.session.clientId,
      account: context.session.account,
      network: context.session.network,
      chainId: context.session.chainId,
      type: signData.type,
      payload: signData.displayPayload,
      schema: signData.schema ?? null,
    },
  });
  if (!approved) throw new Error('Request rejected by user');
  const timestamp = Math.floor(Date.now() / 1000);
  const domain = new URL(context.session.origin).hostname;
  const message = buildTonConnectSignDataMessage({
    address: context.session.account,
    domain,
    timestamp,
    signData,
  });
  const digest = sha256(message);
  const signature = ed25519.sign(digest, context.privateKey);
  await upsertTonConnectSession({ ...context.session, lastUsedAt: Date.now() });
  return {
    signature: bytesToBase64(signature),
    timestamp,
    domain,
    address: context.session.account,
    publicKey: bytesToHex(context.publicKey),
    type: signData.type,
  };
}

async function executeTonConnectTonProof(input: {
  origin: string;
  clientId: string;
  payload: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const context = await getTonConnectSigningContext(input.origin, input.clientId);
  const payload = requireString(input.payload.payload, 'payload');
  const domain = optionalString(input.payload.domain) ?? new URL(context.session.origin).hostname;
  if (domain !== new URL(context.session.origin).hostname) throw new Error('TonConnect proof domain must match the connected origin');
  const timestamp = optionalNumber(input.payload.timestamp) ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw new Error('timestamp must be a positive integer');
  const approved = await requestUserApproval({
    kind: 'tonconnect-request',
    origin: context.session.origin,
    createdAt: Date.now(),
    payload: {
      method: 'ton_proof',
      clientId: context.session.clientId,
      account: context.session.account,
      network: context.session.network,
      chainId: context.session.chainId,
      domain,
      timestamp,
      payload,
    },
  });
  if (!approved) throw new Error('Request rejected by user');
  const digest = buildTonProofDigest({
    address: context.session.account,
    domain,
    timestamp,
    payload,
  });
  const signature = ed25519.sign(digest, context.privateKey);
  await upsertTonConnectSession({ ...context.session, lastUsedAt: Date.now() });
  return {
    proof: {
      timestamp,
      domain: {
        lengthBytes: new TextEncoder().encode(domain).length,
        value: domain,
      },
      payload,
      signature: bytesToBase64(signature),
    },
    address: context.session.account,
    network: context.session.network,
    publicKey: bytesToHex(context.publicKey),
  };
}

async function getTonConnectSigningContext(origin: string, clientId: string): Promise<{
  session: TonConnectSession;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}> {
  const session = await getValidTonConnectSession(origin, clientId);
  const network = await getNetwork();
  if (getChainKind(network) !== 'ton') throw new Error('TonConnect is only available on TON networks');
  if (network.chainId !== session.chainId) throw new Error('TonConnect session network does not match the active network');
  if (!currentTonPrivateKey) throw new Error('TON key is not available for this account');
  const activeAccount = await getActiveAccount();
  const from = getAccountAddressForChain(activeAccount, 'ton');
  if (!from || from !== session.account) throw new Error('TonConnect session account does not match the active account');
  return {
    session,
    privateKey: currentTonPrivateKey,
    publicKey: ed25519.getPublicKey(currentTonPrivateKey),
  };
}

function ensureTonConnectSignDataFeature(session: TonConnectSession, type: NormalizedTonConnectSignData['type']): void {
  const feature = session.features.find((item) => item.name === 'SignData');
  if (!feature) throw new Error('TonConnect session does not allow signData');
  if (feature.types?.length && !feature.types.includes(type)) {
    throw new Error(`TonConnect session does not allow signData type: ${type}`);
  }
}

function normalizeTonConnectSignData(payload: Record<string, unknown>): NormalizedTonConnectSignData {
  const type = requireString(payload.type, 'type');
  if (type === 'text') {
    const text = requireString(payload.text, 'text');
    return { type, text, displayPayload: text };
  }
  if (type === 'binary') {
    const raw = requireString(payload.bytes, 'bytes');
    const bytes = base64ToBytes(raw);
    return { type, bytes, displayPayload: `${bytes.length} bytes` };
  }
  if (type === 'cell') {
    const cell = requireString(payload.cell, 'cell');
    parseTonPayloadCell(cell);
    return {
      type,
      cell,
      schema: optionalString(payload.schema),
      displayPayload: optionalString(payload.schema) ?? 'TON cell BOC',
    };
  }
  throw new Error('Unsupported TonConnect signData type');
}

function buildTonConnectSignDataMessage(input: {
  address: string;
  domain: string;
  timestamp: number;
  signData: NormalizedTonConnectSignData;
}): Uint8Array {
  const chunks: Uint8Array[] = [
    utf8Bytes('ton-connect/sign-data/'),
    encodeTonAddressForSigning(input.address),
    utf8Bytes(input.domain),
    uint64Le(BigInt(input.timestamp)),
    utf8Bytes(input.signData.type),
  ];
  if (input.signData.type === 'text') {
    chunks.push(utf8Bytes(input.signData.text ?? ''));
  } else if (input.signData.type === 'binary') {
    chunks.push(input.signData.bytes ?? new Uint8Array());
  } else {
    chunks.push(utf8Bytes(input.signData.schema ?? ''));
    chunks.push(base64ToBytes(input.signData.cell ?? ''));
  }
  return concatBytes(chunks);
}

function buildTonProofDigest(input: {
  address: string;
  domain: string;
  timestamp: number;
  payload: string;
}): Uint8Array {
  const domainBytes = utf8Bytes(input.domain);
  const message = concatBytes([
    utf8Bytes('ton-proof-item-v2/'),
    encodeTonAddressForSigning(input.address),
    uint32Le(domainBytes.length),
    domainBytes,
    uint64Le(BigInt(input.timestamp)),
    utf8Bytes(input.payload),
  ]);
  return sha256(concatBytes([
    Uint8Array.from([0xff, 0xff]),
    utf8Bytes('ton-connect'),
    sha256(message),
  ]));
}

function encodeTonAddressForSigning(address: string): Uint8Array {
  const parsed = parseTonAddress(address);
  const out = new Uint8Array(36);
  const view = new DataView(out.buffer);
  view.setInt32(0, parsed.workchain, false);
  out.set(parsed.hash, 4);
  return out;
}

function uint32Le(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function uint64Le(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let remaining = value;
  for (let i = 0; i < out.length; i++) {
    out[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

async function createWalletConnectSessionFromProposal(input: {
  topic: string;
  origin: string;
  requiredNamespaces: Record<string, WalletConnectNamespaceProposal>;
  optionalNamespaces: Record<string, WalletConnectNamespaceProposal>;
  expirySeconds?: number;
}): Promise<{ session: WalletConnectSession; namespaces: Record<string, WalletConnectApprovedNamespace> }> {
  const preview = await previewWalletConnectProposal(input);
  const session = await createWalletConnectSession({
    topic: input.topic,
    origin: input.origin,
    chainIds: preview.chainIds,
    methods: preview.methods,
    expirySeconds: input.expirySeconds,
  });
  return { session, namespaces: preview.namespaces };
}

async function approveWalletConnectProposal(input: {
  topic: string;
  origin: string;
  requiredNamespaces: Record<string, WalletConnectNamespaceProposal>;
  optionalNamespaces: Record<string, WalletConnectNamespaceProposal>;
  expirySeconds?: number;
}): Promise<{ session: WalletConnectSession; namespaces: Record<string, WalletConnectApprovedNamespace> }> {
  const preview = await previewWalletConnectProposal(input);
  const approved = await requestUserApproval({
    kind: 'walletconnect-proposal',
    origin: preview.origin,
    createdAt: Date.now(),
    payload: {
      topic: input.topic,
      chainIds: preview.chainIds,
      methods: preview.methods,
      namespaces: preview.namespaces,
      accounts: Object.values(preview.namespaces).flatMap((namespace) => namespace.accounts),
    },
  });
  if (!approved) throw new Error('Request rejected by user');
  return createWalletConnectSessionFromProposal(input);
}

async function approveWalletConnectProposalForRelay(input: {
  topic: string;
  origin: string;
  requiredNamespaces: Record<string, WalletConnectNamespaceProposal>;
  optionalNamespaces: Record<string, WalletConnectNamespaceProposal>;
}): Promise<WalletConnectProposalPreview> {
  const preview = await previewWalletConnectProposal(input);
  const approved = await requestUserApproval({
    kind: 'walletconnect-proposal',
    origin: preview.origin,
    createdAt: Date.now(),
    payload: {
      topic: input.topic,
      chainIds: preview.chainIds,
      methods: preview.methods,
      namespaces: preview.namespaces,
      accounts: Object.values(preview.namespaces).flatMap((namespace) => namespace.accounts),
    },
  });
  if (!approved) throw new Error('Request rejected by user');
  return preview;
}

async function previewWalletConnectProposal(input: {
  origin: string;
  requiredNamespaces: Record<string, WalletConnectNamespaceProposal>;
  optionalNamespaces: Record<string, WalletConnectNamespaceProposal>;
}): Promise<WalletConnectProposalPreview> {
  const activeAccount = await getActiveAccount();
  if (!activeAccount) throw new Error('No wallet found');
  if (!currentSigner) throw new Error('Wallet is locked');
  const activeNetwork = await getNetwork();
  const proposalNamespaces = mergeWalletConnectNamespaces(input.requiredNamespaces, input.optionalNamespaces);
  const requestedChains = new Set<string>();
  const requestedMethods = new Set<string>();
  const requestedEvents = new Map<string, string[]>();

  for (const [namespace, proposal] of Object.entries(proposalNamespaces)) {
    for (const chain of proposal.chains ?? [getWalletConnectChainId(activeNetwork)]) {
      if (!chain.startsWith(`${namespace}:`)) {
        throw new Error(`WalletConnect chain ${chain} does not match namespace ${namespace}`);
      }
      requestedChains.add(chain);
    }
    for (const method of proposal.methods) requestedMethods.add(method);
    requestedEvents.set(namespace, proposal.events ?? []);
  }
  if (requestedChains.size === 0) throw new Error('WalletConnect proposal must request at least one chain');

  const chainNetworks = [...requestedChains].map((chain) => {
    const chainId = parseWalletConnectChainId(chain);
    const chainNetwork = getNetworkForChainId(chainId, activeNetwork);
    if (!chainNetwork) throw new Error(`Unsupported WalletConnect chain id: ${chain}`);
    if (getWalletConnectChainId(chainNetwork) !== chain) {
      throw new Error(`Unsupported WalletConnect namespace for chain ${chain}`);
    }
    return chainNetwork;
  });

  const allowedMethods = new Set(chainNetworks.flatMap((chainNetwork) => getAllowedWalletConnectMethodsForNetwork(chainNetwork)));
  for (const method of requestedMethods) {
    if (!allowedMethods.has(method)) throw new Error(`WalletConnect session method is not allowed: ${method}`);
  }

  const namespaces: Record<string, WalletConnectApprovedNamespace> = {};
  for (const chainNetwork of chainNetworks) {
    const namespace = getWalletConnectNamespace(chainNetwork);
    const account = getAccountAddressForNetwork(activeAccount, chainNetwork);
    if (!account) throw new Error(`No address is available for chain ${chainNetwork.chainId}`);
    const existing = namespaces[namespace] ?? { accounts: [], methods: [], events: requestedEvents.get(namespace) ?? [] };
    existing.accounts.push(walletConnectAccount(chainNetwork, account));
    existing.methods = [...requestedMethods].filter((method) => getAllowedWalletConnectMethodsForNetwork(chainNetwork).includes(method));
    namespaces[namespace] = existing;
  }

  return {
    origin: normalizeOrigin(input.origin),
    chainIds: chainNetworks.map((chainNetwork) => chainNetwork.chainId),
    methods: [...requestedMethods],
    namespaces,
  };
}

async function getValidWalletConnectSession(input: {
  topic: string;
  chainId: number;
  method: string;
}): Promise<WalletConnectSession> {
  const sessions = await getWalletConnectSessions();
  const session = sessions.find((entry) => entry.topic === input.topic);
  if (!session) throw new Error('WalletConnect session not found');
  const now = Date.now();
  if (session.expiresAt <= now) {
    await removeWalletConnectSession(session.topic);
    throw new Error('WalletConnect session expired');
  }
  if (!session.chainIds.includes(input.chainId)) {
    throw new Error('WalletConnect chain is not permitted for this session');
  }
  if (!session.methods.includes(input.method)) {
    throw new Error('WalletConnect method is not permitted for this session');
  }
  const updated = { ...session, lastUsedAt: now };
  await upsertWalletConnectSession(updated);
  return updated;
}

async function validateWalletConnectRequest(input: {
  topic: string;
  chainId: number;
  method: string;
}): Promise<{ ok: true; accounts: string[] }> {
  const session = await getValidWalletConnectSession(input);
  return { ok: true, accounts: session.accounts };
}

async function executeWalletConnectRequest(input: {
  topic: string;
  chainId: number;
  method: string;
  params: unknown[];
}): Promise<unknown> {
  const session = await getValidWalletConnectSession(input);
  const network = await getNetwork();
  if (network.chainId !== input.chainId) {
    throw new Error('WalletConnect request chain must match the active network');
  }
  if (input.method === 'cosmos_signDirect') {
    return executeCosmosWalletConnectSignDirect(session, network, input.params);
  }
  if (input.method === 'cosmos_signAmino') {
    return executeCosmosWalletConnectSignAmino(session, network, input.params);
  }
  return executeWalletConnectDappRequest(session, network, {
    origin: session.origin,
    method: input.method,
    params: input.params,
    interactive: true,
  });
}

async function executeWalletConnectDappRequest(
  session: WalletConnectSession,
  network: Network,
  message: DappRequestMessage,
): Promise<unknown> {
  const activeAccount = await getActiveAccount();
  const account = activeAccount ? getAccountAddressForNetwork(activeAccount, network) : null;
  const permittedAccounts = session.accounts
    .map((entry) => entry.split(':').pop() ?? entry)
    .filter((entry) => entry && (!account || entry === account));
  const permission = permittedAccounts.length > 0
    ? {
        origin: session.origin,
        accounts: permittedAccounts,
        chainId: network.chainId,
        grantedAt: session.grantedAt,
        lastUsedAt: Date.now(),
      } satisfies ConnectedSitePermission
    : await getConnectedPermission(session.origin);
  const nativeDappAdapter = getNativeDappAdapter(message.method);
  if (nativeDappAdapter) {
    return handleNativeDappRequest(nativeDappAdapter, message, {
      origin: session.origin,
      network,
      activeAccount,
      permission,
    });
  }
  return handleDappRequest(message);
}

async function executeCosmosWalletConnectSignDirect(
  session: WalletConnectSession,
  network: Network,
  params: unknown[],
): Promise<unknown> {
  if (getChainKind(network) !== 'cosmos') throw new Error('Cosmos signing requires a Cosmos network');
  if (!currentCosmosKeyPair) throw new Error('Cosmos key is not available for this account');
  const activeAccount = await getActiveAccount();
  const account = activeAccount ? getAccountAddressForNetwork(activeAccount, network) : null;
  if (!account) throw new Error('No Cosmos address is available for this account');
  const request = normalizeCosmosSignDirectRequest(params);
  if (request.signerAddress !== account) throw new Error('Cosmos signer does not match the active account');
  if (!session.accounts.includes(account) && !session.accounts.includes(walletConnectAccount(network, account))) {
    throw new Error('Cosmos signer is not permitted for this WalletConnect session');
  }
  if (request.signDoc.chainId !== getCosmosChainId(network)) {
    throw new Error('Cosmos signDoc chainId must match the active network');
  }
  const approved = await requestUserApproval({
    kind: 'cosmos-sign-direct',
    origin: session.origin,
    createdAt: Date.now(),
    payload: {
      account,
      chainId: request.signDoc.chainId,
      accountNumber: request.signDoc.accountNumber,
      signMode: 'SIGN_MODE_DIRECT',
      messages: summarizeCosmosDirectMessages(request.signDoc.bodyBytes),
      messageDetails: summarizeCosmosDirectMessageDetails(request.signDoc.bodyBytes),
      bodyBytes: summarizeBase64Bytes(request.signDoc.bodyBytes),
      authInfoBytes: summarizeBase64Bytes(request.signDoc.authInfoBytes),
    },
  });
  if (!approved) throw new Error('Request rejected by user');
  const signature = signCosmosDirectDoc({
    bodyBytes: bytesFromBase64(request.signDoc.bodyBytes),
    authInfoBytes: bytesFromBase64(request.signDoc.authInfoBytes),
    chainId: request.signDoc.chainId,
    accountNumber: BigInt(request.signDoc.accountNumber),
    privateKey: currentCosmosKeyPair.privateKey,
    publicKey: currentCosmosKeyPair.publicKey,
  });
  return {
    signed: {
      bodyBytes: request.signDoc.bodyBytes,
      authInfoBytes: request.signDoc.authInfoBytes,
      chainId: request.signDoc.chainId,
      accountNumber: request.signDoc.accountNumber,
    },
    signature: {
      pub_key: {
        type: 'tendermint/PubKeySecp256k1',
        value: signature.pubKeyBase64,
      },
      signature: signature.signatureBase64,
    },
  };
}

async function executeCosmosWalletConnectSignAmino(
  session: WalletConnectSession,
  network: Network,
  params: unknown[],
): Promise<unknown> {
  if (getChainKind(network) !== 'cosmos') throw new Error('Cosmos signing requires a Cosmos network');
  if (!currentCosmosKeyPair) throw new Error('Cosmos key is not available for this account');
  const activeAccount = await getActiveAccount();
  const account = activeAccount ? getAccountAddressForNetwork(activeAccount, network) : null;
  if (!account) throw new Error('No Cosmos address is available for this account');
  const request = normalizeCosmosSignAminoRequest(params);
  if (request.signerAddress !== account) throw new Error('Cosmos signer does not match the active account');
  if (!session.accounts.includes(account) && !session.accounts.includes(walletConnectAccount(network, account))) {
    throw new Error('Cosmos signer is not permitted for this WalletConnect session');
  }
  if (request.signDoc.chain_id !== getCosmosChainId(network)) {
    throw new Error('Cosmos signDoc chainId must match the active network');
  }
  const approved = await requestUserApproval({
    kind: 'cosmos-sign-amino',
    origin: session.origin,
    createdAt: Date.now(),
    payload: {
      account,
      chainId: request.signDoc.chain_id,
      accountNumber: request.signDoc.account_number,
      sequence: request.signDoc.sequence,
      signMode: 'SIGN_MODE_LEGACY_AMINO_JSON',
      fee: summarizeCosmosAminoFee(request.signDoc.fee),
      messages: summarizeCosmosAminoMessages(request.signDoc.msgs),
      messageDetails: summarizeCosmosAminoMessageDetails(request.signDoc.msgs),
      memo: request.signDoc.memo ? `${request.signDoc.memo.length} chars` : 'empty',
    },
  });
  if (!approved) throw new Error('Request rejected by user');
  const signature = signCosmosAminoDoc({
    signDoc: request.signDoc,
    privateKey: currentCosmosKeyPair.privateKey,
    publicKey: currentCosmosKeyPair.publicKey,
  });
  return {
    signed: request.signDoc,
    signature: {
      pub_key: {
        type: 'tendermint/PubKeySecp256k1',
        value: signature.pubKeyBase64,
      },
      signature: signature.signatureBase64,
    },
  };
}

async function executeWalletConnectSessionRequest(input: {
  topic: string;
  chainId: string;
  request: { method: string; params: unknown[] };
}): Promise<unknown> {
  const numericChainId = parseWalletConnectChainId(input.chainId);
  const network = await getNetwork();
  const requestNetwork = getNetworkForChainId(numericChainId, network);
  if (!requestNetwork || getWalletConnectChainId(requestNetwork) !== input.chainId) {
    throw new Error(`Unsupported WalletConnect chain id: ${input.chainId}`);
  }
  return executeWalletConnectRequest({
    topic: input.topic,
    chainId: numericChainId,
    method: input.request.method,
    params: input.request.params,
  });
}

async function handleWalletConnectEvent(event: {
  type: 'session_proposal' | 'session_request' | 'session_delete';
  topic?: string;
  origin?: string;
  params?: Record<string, unknown>;
}): Promise<unknown> {
  if (event.type === 'session_proposal') {
    const params = event.params ?? {};
    return approveWalletConnectProposal({
      topic: requireString(params.topic ?? event.topic, 'topic'),
      origin: requireString(params.origin ?? event.origin, 'origin'),
      requiredNamespaces: normalizeWalletConnectNamespaces(params.requiredNamespaces, 'requiredNamespaces'),
      optionalNamespaces: normalizeWalletConnectNamespaces(params.optionalNamespaces, 'optionalNamespaces'),
      expirySeconds: optionalNumber(params.expirySeconds),
    });
  }

  if (event.type === 'session_request') {
    const params = event.params ?? {};
    return executeWalletConnectSessionRequest({
      topic: requireString(event.topic ?? params.topic, 'topic'),
      chainId: requireString(params.chainId, 'chainId'),
      request: normalizeWalletConnectRequestPayload(params.request),
    });
  }

  await removeWalletConnectSession(requireString(event.topic ?? event.params?.topic, 'topic'));
  return { ok: true };
}

async function handleWalletConnectRpcEvent(event: {
  id: number;
  type: 'session_request';
  topic?: string;
  params?: Record<string, unknown>;
}): Promise<{
  id: number;
  jsonrpc: '2.0';
  result?: unknown;
  error?: { code: number; message: string };
}> {
  try {
    const result = await handleWalletConnectEvent(event);
    return { id: event.id, jsonrpc: '2.0', result };
  } catch (err) {
    return {
      id: event.id,
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: (err as Error).message,
      },
    };
  }
}

async function handleTokenProviderMessage(
  adapter: TokenProviderAdapter,
  msg: { type: string; [key: string]: unknown },
): Promise<unknown> {
  switch (msg.type) {
    case 'GET_ERC20_TOKEN_INFO':
    case 'GET_SPL_TOKEN_INFO':
    case 'GET_TRC20_TOKEN_INFO':
    case 'GET_JETTON_TOKEN_INFO':
      return adapter.getInfo(requireString(msg.contractAddress, 'contractAddress'));
    case 'ADD_ERC20_TOKEN':
    case 'ADD_SPL_TOKEN':
    case 'ADD_TRC20_TOKEN':
    case 'ADD_JETTON_TOKEN':
      return adapter.addToken(requireString(msg.contractAddress, 'contractAddress'));
    case 'REMOVE_ERC20_TOKEN':
    case 'REMOVE_SPL_TOKEN':
    case 'REMOVE_TRC20_TOKEN':
    case 'REMOVE_JETTON_TOKEN':
      return adapter.removeToken(requireString(msg.contractAddress, 'contractAddress'));
    case 'GET_ERC20_BALANCE':
    case 'GET_SPL_BALANCE':
    case 'GET_TRC20_BALANCE':
    case 'GET_JETTON_BALANCE':
      return adapter.getBalance({
        contractAddress: requireString(msg.contractAddress, 'contractAddress'),
        ownerAddress: optionalString(msg.ownerAddress),
        decimals: optionalNumber(msg.decimals),
        symbol: optionalString(msg.symbol),
      });
    case 'GET_SPL_RECIPIENT_ACCOUNT_STATUS':
      return getSplRecipientAccountStatusForActiveAccount({
        contractAddress: requireString(msg.contractAddress, 'contractAddress'),
        to: requireString(msg.to, 'to'),
        amount: requireString(msg.amount, 'amount'),
        decimals: requireNumber(msg.decimals, 'decimals'),
      });
    case 'GET_JETTON_HISTORY':
      if (!adapter.getHistory) throw new Error(`${adapter.displayName} history is not supported`);
      return adapter.getHistory({
        contractAddress: requireString(msg.contractAddress, 'contractAddress'),
        ownerAddress: optionalString(msg.ownerAddress),
        page: optionalNumber(msg.page),
        limit: optionalNumber(msg.limit),
      });
    case 'SEND_ERC20_TRANSFER':
    case 'SEND_SPL_TRANSFER':
    case 'SEND_TRC20_TRANSFER':
    case 'SEND_JETTON_TRANSFER':
      return adapter.sendTransfer({
        contractAddress: requireString(msg.contractAddress, 'contractAddress'),
        to: requireString(msg.to, 'to'),
        amount: requireString(msg.amount, 'amount'),
        decimals: requireNumber(msg.decimals, 'decimals'),
        symbol: optionalString(msg.symbol),
        jettonTransferTonAmount: optionalString(msg.jettonTransferTonAmount),
        forwardTonAmount: optionalString(msg.forwardTonAmount),
        createRecipientAta: optionalBoolean(msg.createRecipientAta),
      });
    default:
      throw new Error(`Unsupported ${adapter.displayName} token message: ${msg.type}`);
  }
}

async function handleTokenProviderDappRequest(
  adapter: TokenProviderAdapter,
  message: DappRequestMessage,
  context: {
    origin: string;
    network: Network;
    activeAccount: StoredAccount | null;
    permission: ConnectedSitePermission | null;
  },
): Promise<unknown> {
  const { origin, network, activeAccount, permission } = context;
  if (getChainKind(network) !== adapter.chainKind) {
    throw new Error(`${adapter.chainDisplayName} dApp methods require a ${adapter.chainDisplayName} network`);
  }
  const activeConnectedAccount = requireConnectedActiveAccount(permission, origin, activeAccount, adapter.chainKind);
  if (!currentSigner) throw new Error('Wallet is locked');
  const request = adapter.normalizeDappTransferRequest(message.params);
  const splRecipientStatus = adapter.chainKind === 'solana'
    ? await getSplRecipientAccountStatusForActiveAccount(request)
    : null;
  if (splRecipientStatus?.createRecipientAtaRequired && request.createRecipientAta !== true) {
    throw new Error('Recipient SPL token account not found. Create the recipient ATA first; automatic creation requires rent and an extra instruction.');
  }
  const approved = await requestUserApproval({
    kind: 'send-transaction',
    origin,
    createdAt: Date.now(),
    payload: {
      account: activeConnectedAccount,
      to: request.to,
      value: request.amount,
      tokenContract: request.contractAddress,
      tokenSymbol: request.symbol ?? null,
      chainId: network.chainId,
      chainKind: adapter.chainKind,
      createRecipientAta: request.createRecipientAta === true,
      splRecipientStatus: splRecipientStatus?.createRecipientAtaRequired ? splRecipientStatus : null,
    },
  });
  if (!approved) throw new Error('Request rejected by user');
  return adapter.formatDappSendResponse(await adapter.sendTransfer(request));
}

const SHELL_DAPP_METHODS = new Set([
  'eth_requestAccounts',
  'eth_accounts',
  'eth_chainId',
  'net_version',
  'eth_blockNumber',
  'eth_getBalance',
  'eth_sendTransaction',
  'eth_call',
  'personal_sign',
  'eth_signTypedData_v4',
  'wallet_getPermissions',
  'wallet_requestPermissions',
  'wallet_revokePermissions',
  'wallet_switchEthereumChain',
  'wallet_addEthereumChain',
  'shella_getPqAddress',
  'shella_sendPqTransaction',
]);

function isShellDappMethod(method: string): boolean {
  return SHELL_DAPP_METHODS.has(method);
}

function buildApprovalRiskSummary(
  kind: 'connect' | 'add-chain' | 'switch-chain' | 'send-transaction' | 'sign-message' | 'sign-typed-data',
  input: Record<string, unknown>,
): ApprovalRiskSummary {
  const rows: Array<{ label: string; value: string }> = [];
  const flags: string[] = [];
  const origin = optionalString(input.origin);
  const account = optionalString(input.account);
  const chainId = typeof input.chainId === 'number' ? input.chainId : null;
  const networkName = optionalString(input.networkName);
  if (origin) rows.push({ label: 'Origin', value: origin });
  if (account) rows.push({ label: 'Account', value: account });
  if (networkName) rows.push({ label: 'Network', value: chainId != null ? `${networkName} (${chainId})` : networkName });

  if (kind === 'connect') {
    rows.push({ label: 'Permission', value: 'View account address' });
    return { riskLevel: 'low', riskSummary: 'This site can view your selected account address.', riskFlags: [], displayRows: rows };
  }

  if (kind === 'add-chain' || kind === 'switch-chain') {
    const rpcUrl = optionalString(input.rpcUrl);
    if (rpcUrl) rows.push({ label: 'RPC', value: rpcUrl });
    if (rpcUrl && !rpcUrl.startsWith('https://') && !isLocalRpcUrl(rpcUrl)) flags.push('non-https-rpc');
    return {
      riskLevel: flags.length > 0 ? 'high' : 'medium',
      riskSummary: kind === 'add-chain' ? 'This site wants to add and switch to a network.' : 'This site wants to switch your active network.',
      riskFlags: flags,
      displayRows: rows,
    };
  }

  if (kind === 'send-transaction') {
    const to = optionalString(input.to);
    const value = optionalString(input.value) ?? '0x0';
    const data = normalizeData(optionalString(input.data));
    rows.push({ label: 'Recipient', value: to ?? 'Contract creation' });
    rows.push({ label: 'Value', value });
    rows.push({ label: 'Calldata', value: `${Math.max(0, (data.length - 2) / 2)} bytes` });
    const approval = decodeErc20ApprovalCalldata(data);
    if (approval) {
      rows.push({ label: 'Approval spender', value: approval.spender });
      rows.push({ label: 'Approval amount', value: approval.unlimited ? 'Unlimited' : approval.amount });
      flags.push(approval.unlimited ? 'unlimited-token-approval' : 'token-approval');
    }
    if (!to) flags.push('contract-creation');
    if (data !== '0x') flags.push('calldata-present');
    return {
      riskLevel: approval?.unlimited || !to ? 'high' : data !== '0x' ? 'medium' : 'low',
      riskSummary: approval
        ? approval.unlimited
          ? 'This transaction grants unlimited token approval to a spender.'
          : 'This transaction changes token allowance for a spender.'
        : data !== '0x' ? 'This transaction includes contract calldata.' : 'This is a native asset transfer.',
      riskFlags: flags,
      displayRows: rows,
    };
  }

  if (kind === 'sign-message') {
    const message = optionalString(input.message) ?? '';
    rows.push({ label: 'Message', value: previewSignableMessage(message) });
    flags.push('offchain-signature');
    return {
      riskLevel: 'medium',
      riskSummary: 'This signature proves control of your account to the requesting site.',
      riskFlags: flags,
      displayRows: rows,
    };
  }

  const typedDataSummary = input.typedDataSummary && typeof input.typedDataSummary === 'object'
    ? input.typedDataSummary as Record<string, unknown>
    : {};
  for (const label of ['domain', 'primaryType', 'verifyingContract']) {
    const value = optionalString(typedDataSummary[label]);
    if (value) rows.push({ label, value });
  }
  flags.push('typed-data-signature');
  return {
    riskLevel: optionalString(typedDataSummary.verifyingContract) ? 'medium' : 'high',
    riskSummary: 'This site wants a structured typed-data signature.',
    riskFlags: flags,
    displayRows: rows,
  };
}

function decodeErc20ApprovalCalldata(data: `0x${string}`): { spender: string; amount: string; unlimited: boolean } | null {
  const hex = data.slice(2).toLowerCase();
  if (!hex.startsWith('095ea7b3') || hex.length < 8 + 64 + 64) return null;
  const spenderWord = hex.slice(8, 72);
  const amountWord = hex.slice(72, 136);
  const spender = `0x${spenderWord.slice(24)}`;
  const amount = BigInt(`0x${amountWord}`);
  const unlimited = amount === (1n << 256n) - 1n;
  return { spender, amount: amount.toString(), unlimited };
}

function normalizePersonalSignRequest(params: unknown[] | undefined, activeAccount: string): { message: string } {
  const values = normalizeArrayParams(params);
  const first = optionalString(values[0]);
  const second = optionalString(values[1]);
  if (!first) throw new Error('personal_sign requires a message');
  const activeLower = activeAccount.toLowerCase();
  if (first.toLowerCase() === activeLower) {
    if (!second) throw new Error('personal_sign requires a message');
    return { message: second };
  }
  if (second && second.toLowerCase() !== activeLower) {
    throw new Error('personal_sign account does not match the connected account');
  }
  return { message: first };
}

function normalizeTypedDataSignRequest(params: unknown[] | undefined, activeAccount: string): { typedData: unknown } {
  const values = normalizeArrayParams(params);
  const account = requireString(values[0], 'account');
  if (account.toLowerCase() !== activeAccount.toLowerCase()) {
    throw new Error('eth_signTypedData_v4 account does not match the connected account');
  }
  const typedData = values[1];
  if (typedData == null) throw new Error('eth_signTypedData_v4 requires typed data');
  if (typeof typedData === 'string') {
    try {
      return { typedData: JSON.parse(typedData) };
    } catch {
      throw new Error('eth_signTypedData_v4 typed data must be valid JSON');
    }
  }
  if (typeof typedData !== 'object') throw new Error('eth_signTypedData_v4 typed data must be an object');
  return { typedData };
}

function summarizeTypedDataForApproval(typedData: unknown): Record<string, string> {
  if (!typedData || typeof typedData !== 'object') return {};
  const data = typedData as Record<string, unknown>;
  const domain = data.domain && typeof data.domain === 'object' ? data.domain as Record<string, unknown> : {};
  const summary: Record<string, string> = {};
  const domainName = optionalString(domain.name);
  const domainChainId = optionalString(domain.chainId) ?? (typeof domain.chainId === 'number' ? String(domain.chainId) : null);
  const verifyingContract = optionalString(domain.verifyingContract);
  if (domainName || domainChainId) summary.domain = [domainName, domainChainId ? `chain ${domainChainId}` : null].filter(Boolean).join(' / ');
  if (verifyingContract) summary.verifyingContract = verifyingContract;
  const primaryType = optionalString(data.primaryType);
  if (primaryType) summary.primaryType = primaryType;
  return summary;
}

function previewSignableMessage(message: string): string {
  const normalized = message.startsWith('0x') ? decodeHexMessagePreview(message) : message;
  const compact = normalized.replace(/\s+/g, ' ').trim();
  return compact.length > 96 ? `${compact.slice(0, 96)}...` : compact || '(empty message)';
}

function decodeHexMessagePreview(message: string): string {
  if (!/^0x[0-9a-fA-F]*$/.test(message) || message.length % 2 !== 0) return message;
  const bytes = Buffer.from(message.slice(2), 'hex');
  const text = bytes.toString('utf8');
  return /^[\x09\x0a\x0d\x20-\x7e]*$/.test(text) ? text : `${bytes.length} bytes`;
}

async function signShellDappPayload(method: string, payload: unknown): Promise<string> {
  if (!currentSigner) throw new Error('Wallet is locked');
  const encoded = new TextEncoder().encode(`shella:${method}:${stableJsonStringify(payload)}`);
  const digest = sha256(encoded);
  const signature = await currentSigner.sign(digest);
  return `0x${bytesToHex(signature)}`;
}

function stableJsonStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJsonStringify(object[key])}`).join(',')}}`;
}

async function handleShellDappRequest(
  message: DappRequestMessage,
  context: {
    origin: string;
    network: Network;
    activeAccount: StoredAccount | null;
    permission: ConnectedSitePermission | null;
  },
): Promise<unknown> {
  const { origin, network, activeAccount, permission } = context;
  switch (message.method) {
    case 'eth_requestAccounts': {
      if (!activeAccount) throw new Error('No wallet found');
      if (!currentSigner) throw new Error('Wallet is locked');
      const activeConnectedAccount = getConnectedActiveAccountAddress(permission, activeAccount, getChainKind(network));
      if (permission && activeConnectedAccount) {
        await addConnectedSite(buildConnectedSite(origin, activeConnectedAccount, network.chainId, permission.grantedAt, getAccountId(activeAccount)));
        return [activeConnectedAccount];
      }
      const approved = await requestUserApproval({
        kind: 'connect',
        origin,
        createdAt: Date.now(),
        payload: {
          pqAddress: activeAccount.pqAddress,
          chainId: network.chainId,
          networkName: network.name,
          approvalRisk: buildApprovalRiskSummary('connect', {
            origin,
            account: activeAccount.pqAddress,
            chainId: network.chainId,
            networkName: network.name,
          }),
        },
      });
      if (!approved) throw new Error('Request rejected by user');
      const granted = buildConnectedSite(origin, activeAccount.pqAddress, network.chainId, permission?.grantedAt, getAccountId(activeAccount));
      await addConnectedSite(granted);
      return granted.accounts;
    }
    case 'wallet_requestPermissions': {
      const [permissions] = normalizeArrayParams(message.params);
      if (!permissions || typeof permissions !== 'object') throw new Error('wallet_requestPermissions requires a permissions object');
      if (!Object.prototype.hasOwnProperty.call(permissions, 'eth_accounts')) {
        throw new Error('Only eth_accounts permission is supported');
      }
      const accounts = await handleShellDappRequest({ ...message, method: 'eth_requestAccounts' }, context) as string[];
      return [{ parentCapability: 'eth_accounts', caveats: [{ type: 'restrictReturnedAccounts', value: accounts }] }];
    }
    case 'wallet_getPermissions': {
      const activeConnectedAccount = getConnectedActiveAccountAddress(permission, activeAccount, getChainKind(network));
      return activeConnectedAccount
        ? [{ parentCapability: 'eth_accounts', caveats: [{ type: 'restrictReturnedAccounts', value: [activeConnectedAccount] }] }]
        : [];
    }
    case 'wallet_revokePermissions': {
      const [permissions] = normalizeArrayParams(message.params);
      if (!permissions || typeof permissions !== 'object') throw new Error('wallet_revokePermissions requires a permissions object');
      if (!Object.prototype.hasOwnProperty.call(permissions, 'eth_accounts')) {
        throw new Error('Only eth_accounts permission can be revoked');
      }
      await removeConnectedSite(origin);
      return null;
    }
    case 'eth_accounts': {
      const activeConnectedAccount = getConnectedActiveAccountAddress(permission, activeAccount, getChainKind(network));
      return activeConnectedAccount ? [activeConnectedAccount] : [];
    }
    case 'eth_chainId':
      return `0x${network.chainId.toString(16)}`;
    case 'net_version':
      return String(network.chainId);
    case 'eth_blockNumber': {
      const provider = buildProvider(network);
      const blockNumber = await provider.client.getBlockNumber();
      return `0x${blockNumber.toString(16)}`;
    }
    case 'eth_getBalance': {
      const provider = buildProvider(network);
      const [address] = normalizeArrayParams(message.params);
      if (typeof address !== 'string') throw new Error('eth_getBalance requires an address');
      if (!/^0x[0-9a-fA-F]{64}$/.test(address)) throw new Error('eth_getBalance: address must be 0x + 64-char hex');
      const balance = await provider.client.getBalance({ address: asPqAddress(address, 'eth_getBalance') });
      return `0x${balance.toString(16)}`;
    }
    case 'eth_sendTransaction': {
      const activeConnectedAccount = requireConnectedActiveAccount(permission, origin, activeAccount, getChainKind(network));
      if (!currentSigner) throw new Error('Wallet is locked');
      const [tx] = normalizeArrayParams(message.params);
      if (!tx || typeof tx !== 'object') throw new Error('eth_sendTransaction requires a transaction object');
      const candidate = tx as Record<string, unknown>;
      const from = optionalString(candidate.from);
      if (from && from !== activeConnectedAccount) {
        throw new Error('Requested from account is not permitted for this site');
      }
      const request = {
        to: normalizeDappTransactionTo(candidate.to),
        value: normalizeRpcValue(optionalString(candidate.value)),
        data: optionalString(candidate.data) ?? optionalString(candidate.input),
        gasLimit: optionalRpcNumber(candidate.gas) ?? optionalRpcNumber(candidate.gasLimit),
        maxFeePerGas: optionalRpcNumber(candidate.maxFeePerGas),
        maxPriorityFeePerGas: optionalRpcNumber(candidate.maxPriorityFeePerGas),
      };
      const approved = await requestUserApproval({
        kind: 'send-transaction',
        origin,
        createdAt: Date.now(),
        payload: {
          account: activeConnectedAccount,
          to: request.to,
          value: request.value,
          data: request.data ?? '0x',
          chainId: network.chainId,
          approvalRisk: buildApprovalRiskSummary('send-transaction', {
            origin,
            account: activeConnectedAccount,
            chainId: network.chainId,
            networkName: network.name,
            to: request.to,
            value: request.value,
            data: request.data ?? '0x',
          }),
        },
      });
      if (!approved) throw new Error('Request rejected by user');
      return sendTransaction({ ...request, expectedChainId: network.chainId });
    }
    case 'personal_sign': {
      const activeConnectedAccount = requireConnectedActiveAccount(permission, origin, activeAccount, getChainKind(network));
      if (!currentSigner) throw new Error('Wallet is locked');
      const request = normalizePersonalSignRequest(message.params, activeConnectedAccount);
      const approved = await requestUserApproval({
        kind: 'sign-message',
        origin,
        createdAt: Date.now(),
        payload: {
          account: activeConnectedAccount,
          chainId: network.chainId,
          networkName: network.name,
          message: request.message,
          messagePreview: previewSignableMessage(request.message),
          approvalRisk: buildApprovalRiskSummary('sign-message', {
            origin,
            account: activeConnectedAccount,
            chainId: network.chainId,
            networkName: network.name,
            message: request.message,
          }),
        },
      });
      if (!approved) throw new Error('Request rejected by user');
      return signShellDappPayload('personal_sign', { origin, account: activeConnectedAccount, chainId: network.chainId, message: request.message });
    }
    case 'eth_signTypedData_v4': {
      const activeConnectedAccount = requireConnectedActiveAccount(permission, origin, activeAccount, getChainKind(network));
      if (!currentSigner) throw new Error('Wallet is locked');
      const request = normalizeTypedDataSignRequest(message.params, activeConnectedAccount);
      const typedDataSummary = summarizeTypedDataForApproval(request.typedData);
      const approved = await requestUserApproval({
        kind: 'sign-typed-data',
        origin,
        createdAt: Date.now(),
        payload: {
          account: activeConnectedAccount,
          chainId: network.chainId,
          networkName: network.name,
          typedData: request.typedData,
          typedDataSummary,
          approvalRisk: buildApprovalRiskSummary('sign-typed-data', {
            origin,
            account: activeConnectedAccount,
            chainId: network.chainId,
            networkName: network.name,
            typedDataSummary,
          }),
        },
      });
      if (!approved) throw new Error('Request rejected by user');
      return signShellDappPayload('eth_signTypedData_v4', { origin, account: activeConnectedAccount, chainId: network.chainId, typedData: request.typedData });
    }
    case 'eth_call': {
      const [tx] = normalizeArrayParams(message.params);
      if (!tx || typeof tx !== 'object') throw new Error('eth_call requires a transaction object');
      const candidate = tx as Record<string, unknown>;
      const to = requireString(candidate.to, 'to');
      const data = normalizeData(optionalString(candidate.data) ?? optionalString(candidate.input));
      const value = normalizeOptionalRpcBigInt(optionalString(candidate.value), 'eth_call.value');
      normalizeRecipient(to);
      const callTx: Record<string, string> = { to, data };
      if (value !== undefined) callTx.value = `0x${value.toString(16)}`;
      return rpcRequest<string>(network.rpcUrl, 'eth_call', [callTx, 'latest']);
    }
    case 'wallet_switchEthereumChain': {
      requireConnectedActiveAccount(permission, origin, activeAccount, getChainKind(network));
      if (!currentSigner) throw new Error('Wallet is locked');
      const [chainPayload] = normalizeArrayParams(message.params);
      if (!chainPayload || typeof chainPayload !== 'object') {
        throw new Error('wallet_switchEthereumChain requires a chain payload');
      }
      const chainIdHex = requireString((chainPayload as Record<string, unknown>).chainId, 'chainId');
      const chainIdBig = BigInt(chainIdHex);
      if (chainIdBig > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error(`chainId ${chainIdHex} exceeds safe integer range`);
      }
      const chainId = Number(chainIdBig);
      const nextNetwork = findKnownNetwork(chainId);
      if (!nextNetwork) {
        throw new Error('Unknown chain. Use wallet_addEthereumChain first.');
      }
      const approved = await requestUserApproval({
        kind: 'switch-chain',
        origin,
        createdAt: Date.now(),
        payload: {
          chainId: nextNetwork.chainId,
          networkName: nextNetwork.name,
          rpcUrl: nextNetwork.rpcUrl,
          approvalRisk: buildApprovalRiskSummary('switch-chain', {
            origin,
            chainId: nextNetwork.chainId,
            networkName: nextNetwork.name,
            rpcUrl: nextNetwork.rpcUrl,
          }),
        },
      });
      if (!approved) throw new Error('Request rejected by user');
      await setNetwork(nextNetwork);
      if (!activeAccount) throw new Error('No wallet found');
      const nextAccount = getAccountAddressForChain(activeAccount, getChainKind(nextNetwork));
      if (!nextAccount) throw new Error('Connected account is not available on the requested chain');
      await addConnectedSite(buildConnectedSite(origin, nextAccount, nextNetwork.chainId, permission!.grantedAt, getAccountId(activeAccount)));
      return null;
    }
    case 'wallet_addEthereumChain': {
      requireConnectedActiveAccount(permission, origin, activeAccount, getChainKind(network));
      if (!currentSigner) throw new Error('Wallet is locked');
      const [chainPayload] = normalizeArrayParams(message.params);
      if (!chainPayload || typeof chainPayload !== 'object') {
        throw new Error('wallet_addEthereumChain requires a chain payload');
      }
      const candidate = chainPayload as Record<string, unknown>;
      const chainId = Number(BigInt(requireString(candidate.chainId, 'chainId')));
      const rpcUrls = candidate.rpcUrls;
      if (!Array.isArray(rpcUrls) || typeof rpcUrls[0] !== 'string') {
        throw new Error('wallet_addEthereumChain requires rpcUrls[0]');
      }
      const nextNetwork: Network = {
        name: optionalString(candidate.chainName) ?? `Chain ${chainId}`,
        chainId,
        rpcUrl: validateRpcUrl(rpcUrls[0], 'rpcUrls[0]'),
      };
      const approved = await requestUserApproval({
        kind: 'add-chain',
        origin,
        createdAt: Date.now(),
        payload: {
          chainId: nextNetwork.chainId,
          networkName: nextNetwork.name,
          rpcUrl: nextNetwork.rpcUrl,
          approvalRisk: buildApprovalRiskSummary('add-chain', {
            origin,
            chainId: nextNetwork.chainId,
            networkName: nextNetwork.name,
            rpcUrl: nextNetwork.rpcUrl,
          }),
        },
      });
      if (!approved) throw new Error('Request rejected by user');
      await setNetwork(nextNetwork);
      if (activeAccount) {
        await addConnectedSite(buildConnectedSite(origin, activeAccount.pqAddress, nextNetwork.chainId, permission?.grantedAt, getAccountId(activeAccount)));
      }
      return null;
    }
    case 'shella_getPqAddress':
      return requireConnectedActiveAccount(permission, origin, activeAccount, getChainKind(network));
    case 'shella_sendPqTransaction': {
      const activeConnectedAccount = requireConnectedActiveAccount(permission, origin, activeAccount, getChainKind(network));
      if (!currentSigner) throw new Error('Wallet is locked');
      const [tx] = normalizeArrayParams(message.params);
      if (!tx || typeof tx !== 'object') throw new Error('shella_sendPqTransaction requires a transaction object');
      const candidate = tx as Record<string, unknown>;
      const from = optionalString(candidate.from);
      if (from && from !== activeConnectedAccount) {
        throw new Error('Requested pq sender does not match the unlocked wallet');
      }
      const request = {
        to: normalizeDappTransactionTo(candidate.to),
        value: normalizeRpcValue(optionalString(candidate.value)),
        data: optionalString(candidate.data),
        gasLimit: optionalRpcNumber(candidate.gasLimit),
        maxFeePerGas: optionalRpcNumber(candidate.maxFeePerGas),
        maxPriorityFeePerGas: optionalRpcNumber(candidate.maxPriorityFeePerGas),
      };
      const approved = await requestUserApproval({
        kind: 'send-transaction',
        origin,
        createdAt: Date.now(),
        payload: {
          account: activeConnectedAccount,
          to: request.to,
          value: request.value,
          data: request.data ?? '0x',
          chainId: network.chainId,
          approvalRisk: buildApprovalRiskSummary('send-transaction', {
            origin,
            account: activeConnectedAccount,
            chainId: network.chainId,
            networkName: network.name,
            to: request.to,
            value: request.value,
            data: request.data ?? '0x',
          }),
        },
      });
      if (!approved) throw new Error('Request rejected by user');
      return sendTransaction({ ...request, expectedChainId: network.chainId });
    }
    default:
      throw new Error(`Unsupported dApp method: ${message.method}`);
  }
}

async function handleNativeDappRequest(
  adapter: NativeDappAdapter,
  message: DappRequestMessage,
  context: {
    origin: string;
    network: Network;
    activeAccount: StoredAccount | null;
    permission: ConnectedSitePermission | null;
  },
): Promise<unknown> {
  const { origin, network, activeAccount, permission } = context;
  const chainKind = getChainKind(network);

  if (adapter.connectMethods.includes(message.method)) {
    if (chainKind !== adapter.chainKind) throw new Error(`${adapter.displayName} dApp methods require a ${adapter.displayName} network`);
    if (!activeAccount) throw new Error('No wallet found');
    if (!currentSigner) throw new Error('Wallet is locked');
    const account = adapter.getAccount(activeAccount);
    if (!account) throw new Error(`No ${adapter.displayName} address is available for this account`);
    if (getConnectedActiveAccountAddress(permission, activeAccount, adapter.chainKind) === account) {
      if (!permission) throw new Error(`Site not connected: ${origin}`);
      await addConnectedSite(buildConnectedSite(origin, account, network.chainId, permission.grantedAt, getAccountId(activeAccount)));
      return adapter.formatConnectResponse([account]);
    }
    const approved = await requestUserApproval({
      kind: 'connect',
      origin,
      createdAt: Date.now(),
      payload: {
        account,
        chainId: network.chainId,
        networkName: network.name,
        chainKind: adapter.chainKind,
      },
    });
    if (!approved) throw new Error('Request rejected by user');
    const granted = buildConnectedSite(origin, account, network.chainId, permission?.grantedAt, getAccountId(activeAccount));
    await addConnectedSite(granted);
    return adapter.formatConnectResponse(granted.accounts);
  }

  if (message.method === adapter.accountsMethod) {
    if (chainKind !== adapter.chainKind) return [];
    const activeConnectedAccount = getConnectedActiveAccountAddress(permission, activeAccount, adapter.chainKind);
    return activeConnectedAccount && adapter.isAccount(activeConnectedAccount) ? [activeConnectedAccount] : [];
  }

  if (message.method === adapter.chainIdMethod) {
    if (chainKind !== adapter.chainKind) throw new Error(`${adapter.displayName} dApp methods require a ${adapter.displayName} network`);
    return String(network.chainId);
  }

  if (message.method === adapter.balanceMethod) {
    if (chainKind !== adapter.chainKind) throw new Error(`${adapter.displayName} dApp methods require a ${adapter.displayName} network`);
    const activeConnectedAccount = requireConnectedActiveAccount(permission, origin, activeAccount, adapter.chainKind);
    const [candidateAddress] = normalizeArrayParams(message.params);
    const address = typeof candidateAddress === 'string' ? candidateAddress : activeConnectedAccount;
    const nativeAdapter = getNativeChainAdapter(adapter.chainKind);
    if (!nativeAdapter) throw new Error(`${adapter.displayName} dApp methods require a ${adapter.displayName} network`);
    const balance = await nativeAdapter.getBalance(network, address);
    return balance.balance;
  }

  if (adapter.sendMethods.includes(message.method)) {
    if (chainKind !== adapter.chainKind) throw new Error(`${adapter.displayName} dApp methods require a ${adapter.displayName} network`);
    const activeConnectedAccount = requireConnectedActiveAccount(permission, origin, activeAccount, adapter.chainKind);
    if (!currentSigner) throw new Error('Wallet is locked');
    const request = adapter.normalizeTransferRequest(message.params);
    if (request.from && request.from !== activeConnectedAccount) {
      throw new Error('Requested from account is not permitted for this site');
    }
    const approved = await requestUserApproval({
      kind: 'send-transaction',
      origin,
      createdAt: Date.now(),
      payload: {
        account: activeConnectedAccount,
        to: request.to,
        value: adapter.formatTransferValue(request),
        chainId: network.chainId,
        chainKind: adapter.chainKind,
      },
    });
    if (!approved) throw new Error('Request rejected by user');
    const sent = await adapter.sendTransfer(network, request);
    return adapter.formatSendResponse(sent);
  }

  throw new Error(`Unsupported dApp method: ${message.method}`);
}

function buildProvider(network: Network) {
  const chain = defineChain({
    id: network.chainId,
    name: network.name,
    nativeCurrency: { decimals: 18, name: 'SHELL', symbol: 'SHELL' },
    rpcUrls: { default: { http: [network.rpcUrl] } },
  });
  return createShellProvider({ chain, rpcHttpUrl: network.rpcUrl });
}

function buildConnectedSite(
  origin: string,
  pqAddress: string,
  chainId: number,
  grantedAt: number = Date.now(),
  accountId?: string,
): ConnectedSitePermission {
  const now = Date.now();
  return {
    origin,
    accounts: [pqAddress],
    accountIds: accountId ? [accountId] : [],
    chainId,
    grantedAt,
    lastUsedAt: now,
  };
}

async function getConnectedPermission(origin: string): Promise<ConnectedSitePermission | null> {
  const normalized = normalizeOrigin(origin);
  const sites = await getConnectedSites();
  return sites.find((site) => site.origin === normalized) ?? null;
}

function ensureConnected(
  permission: ConnectedSitePermission | null,
  origin: string,
): asserts permission is ConnectedSitePermission {
  if (!permission) {
    throw new Error(`Site not connected: ${origin}`);
  }
}

function getConnectedActiveAccountAddress(
  permission: ConnectedSitePermission | null,
  activeAccount: StoredAccount | null,
  chainKind: ChainKind,
): string | null {
  if (!permission) return null;
  const activeAddress = getAccountAddressForChain(activeAccount, chainKind);
  if (!activeAddress || !activeAccount) return null;
  const activeAccountId = getAccountId(activeAccount);
  if (permission.accountIds?.includes(activeAccountId)) return activeAddress;
  return permission.accounts.includes(activeAddress) ? activeAddress : null;
}

function requireConnectedActiveAccount(
  permission: ConnectedSitePermission | null,
  origin: string,
  activeAccount: StoredAccount | null,
  chainKind: ChainKind,
): string {
  ensureConnected(permission, origin);
  const activeAddress = getConnectedActiveAccountAddress(permission, activeAccount, chainKind);
  if (!activeAddress) {
    throw new Error(`Connected account is not the currently active ${chainKind} account. Reconnect this site.`);
  }
  return activeAddress;
}

function normalizeOrigin(origin: string): string {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Only http and https origins are supported');
    }
    return parsed.origin;
  } catch {
    throw new Error('Origin must be a valid http(s) URL');
  }
}

function normalizeArrayParams(params: unknown[] | undefined): unknown[] {
  return Array.isArray(params) ? params : [];
}

function normalizeCosmosSignDirectRequest(params: unknown[]): {
  signerAddress: string;
  signDoc: { bodyBytes: string; authInfoBytes: string; chainId: string; accountNumber: string };
} {
  const [first, second] = normalizeArrayParams(params);
  const request = typeof first === 'string'
    ? { signerAddress: first, signDoc: second }
    : first;
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('Cosmos signDirect request must be an object or [signerAddress, signDoc]');
  }
  const record = request as Record<string, unknown>;
  const signerAddress = requireString(record.signerAddress ?? record.signer, 'signerAddress');
  const signDoc = record.signDoc;
  if (!signDoc || typeof signDoc !== 'object' || Array.isArray(signDoc)) {
    throw new Error('Cosmos signDirect signDoc is required');
  }
  const doc = signDoc as Record<string, unknown>;
  const bodyBytes = requireBase64String(doc.bodyBytes, 'bodyBytes');
  const authInfoBytes = requireBase64String(doc.authInfoBytes, 'authInfoBytes');
  const chainId = requireString(doc.chainId, 'chainId');
  const accountNumber = requireIntegerString(doc.accountNumber, 'accountNumber');
  return { signerAddress, signDoc: { bodyBytes, authInfoBytes, chainId, accountNumber } };
}

function normalizeCosmosSignAminoRequest(params: unknown[]): {
  signerAddress: string;
  signDoc: Record<string, JsonValue> & {
    account_number: string;
    chain_id: string;
    fee: Record<string, JsonValue>;
    memo: string;
    msgs: JsonValue[];
    sequence: string;
  };
} {
  const [first, second] = normalizeArrayParams(params);
  const request = typeof first === 'string'
    ? { signerAddress: first, signDoc: second }
    : first;
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('Cosmos signAmino request must be an object or [signerAddress, signDoc]');
  }
  const record = request as Record<string, unknown>;
  const signerAddress = requireString(record.signerAddress ?? record.signer, 'signerAddress');
  const signDoc = record.signDoc;
  if (!signDoc || typeof signDoc !== 'object' || Array.isArray(signDoc)) {
    throw new Error('Cosmos signAmino signDoc is required');
  }
  const doc = signDoc as Record<string, unknown>;
  const accountNumber = requireIntegerString(doc.account_number, 'account_number');
  const chainId = requireString(doc.chain_id, 'chain_id');
  const fee = requireJsonObject(doc.fee, 'fee');
  const memo = doc.memo === undefined ? '' : requireString(doc.memo, 'memo');
  const msgs = requireJsonArray(doc.msgs, 'msgs');
  const sequence = requireIntegerString(doc.sequence, 'sequence');
  return {
    signerAddress,
    signDoc: {
      ...requireJsonObject(doc, 'signDoc'),
      account_number: accountNumber,
      chain_id: chainId,
      fee,
      memo,
      msgs,
      sequence,
    },
  };
}

function requireJsonValue(value: unknown, field: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((entry, index) => requireJsonValue(entry, `${field}[${index}]`));
  if (value && typeof value === 'object') {
    const normalized: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) normalized[key] = requireJsonValue(entry, `${field}.${key}`);
    return normalized;
  }
  throw new Error(`${field} must be JSON-compatible`);
}

function requireJsonObject(value: unknown, field: string): Record<string, JsonValue> {
  const normalized = requireJsonValue(value, field);
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    throw new Error(`${field} must be an object`);
  }
  return normalized;
}

function requireJsonArray(value: unknown, field: string): JsonValue[] {
  const normalized = requireJsonValue(value, field);
  if (!Array.isArray(normalized)) throw new Error(`${field} must be an array`);
  return normalized;
}

function summarizeCosmosAminoFee(fee: Record<string, JsonValue>): string {
  const gas = typeof fee.gas === 'string' || typeof fee.gas === 'number' ? String(fee.gas) : 'unknown gas';
  const amount = Array.isArray(fee.amount)
    ? fee.amount.map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return 'unknown';
        const amountEntry = entry as Record<string, JsonValue>;
        const quantity = typeof amountEntry.amount === 'string' || typeof amountEntry.amount === 'number'
          ? String(amountEntry.amount)
          : '?';
        const denom = typeof amountEntry.denom === 'string' ? amountEntry.denom : '?';
        return `${quantity}${denom}`;
      }).join(', ')
    : 'no amount';
  return `${amount}; gas ${gas}`;
}

function summarizeCosmosAminoMessages(msgs: JsonValue[]): string {
  if (msgs.length === 0) return '0 messages';
  return msgs.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return `#${index + 1}: unknown`;
    const message = entry as Record<string, JsonValue>;
    const type = typeof message.type === 'string'
      ? message.type
      : typeof message['@type'] === 'string'
        ? message['@type']
        : 'unknown';
    return `#${index + 1}: ${type}`;
  }).join(', ');
}

function summarizeCosmosAminoMessageDetails(msgs: JsonValue[]): string[] {
  return msgs.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return `#${index + 1}: unknown`;
    const message = entry as Record<string, JsonValue>;
    const type = getJsonString(message, 'type') ?? getJsonString(message, '@type') ?? 'unknown';
    const value = getJsonObject(message, 'value') ?? message;
    const fields = [
      ['from', getJsonString(value, 'from_address') ?? getJsonString(value, 'from')],
      ['to', getJsonString(value, 'to_address') ?? getJsonString(value, 'to')],
      ['delegator', getJsonString(value, 'delegator_address')],
      ['validator', getJsonString(value, 'validator_address')],
      ['src validator', getJsonString(value, 'validator_src_address')],
      ['dst validator', getJsonString(value, 'validator_dst_address')],
      ['depositor', getJsonString(value, 'depositor')],
      ['proposal', getJsonString(value, 'proposal_id')],
      ['granter', getJsonString(value, 'granter')],
      ['grantee', getJsonString(value, 'grantee')],
      ['msg type', getJsonString(value, 'msg_type_url')],
      ['grant type', summarizeCosmosJsonAny(value.grant)],
      ['allowance type', summarizeCosmosJsonAny(value.allowance)],
      ['inputs', summarizeCosmosJsonMultiSendEntries(value.inputs)],
      ['outputs', summarizeCosmosJsonMultiSendEntries(value.outputs)],
      ['amount', summarizeCosmosJsonAmount(value.amount)],
      ['creation height', getJsonString(value, 'creation_height')],
    ]
      .filter((field): field is [string, string] => typeof field[1] === 'string' && field[1].length > 0)
      .map(([label, valueText]) => `${label}: ${valueText}`);
    return fields.length > 0
      ? `#${index + 1}: ${type} (${fields.join('; ')})`
      : `#${index + 1}: ${type}`;
  });
}

function summarizeCosmosDirectMessages(bodyBytesBase64: string): string {
  const decoded = decodeCosmosDirectMessages(bytesFromBase64(bodyBytesBase64));
  const typeUrls = decoded.length > 0 ? decoded.map((message) => message.typeUrl) : extractCosmosTypeUrls(bytesFromBase64(bodyBytesBase64));
  return typeUrls.length > 0 ? typeUrls.join(', ') : 'unparsed protobuf body';
}

function summarizeCosmosDirectMessageDetails(bodyBytesBase64: string): string[] {
  return decodeCosmosDirectMessages(bytesFromBase64(bodyBytesBase64)).map((message, index) => {
    const fields = [
      ['from', message.from],
      ['to', message.to],
      ['delegator', message.delegator],
      ['validator', message.validator],
      ['src validator', message.sourceValidator],
      ['dst validator', message.destinationValidator],
      ['depositor', message.depositor],
      ['proposal', message.proposalId],
      ['granter', message.granter],
      ['grantee', message.grantee],
      ['msg type', message.msgTypeUrl],
      ['grant type', message.grantType],
      ['allowance type', message.allowanceType],
      ['inputs', message.inputs],
      ['outputs', message.outputs],
      ['port', message.sourcePort],
      ['channel', message.sourceChannel],
      ['amount', message.amount],
      ['creation height', message.creationHeight],
      ['memo', message.memo],
      ['fields', message.customFields],
    ]
      .filter((field): field is [string, string] => typeof field[1] === 'string' && field[1].length > 0)
      .map(([label, valueText]) => `${label}: ${valueText}`);
    return fields.length > 0
      ? `#${index + 1}: ${message.typeUrl} (${fields.join('; ')})`
      : `#${index + 1}: ${message.typeUrl}`;
  });
}

interface CosmosDirectMessageSummary {
  typeUrl: string;
  from?: string;
  to?: string;
  delegator?: string;
  validator?: string;
  sourceValidator?: string;
  destinationValidator?: string;
  depositor?: string;
  proposalId?: string;
  granter?: string;
  grantee?: string;
  msgTypeUrl?: string;
  grantType?: string;
  allowanceType?: string;
  inputs?: string;
  outputs?: string;
  sourcePort?: string;
  sourceChannel?: string;
  amount?: string;
  creationHeight?: string;
  memo?: string;
  customFields?: string;
}

interface ProtoField {
  fieldNumber: number;
  wireType: number;
  value: Uint8Array | bigint;
}

function decodeCosmosDirectMessages(bodyBytes: Uint8Array): CosmosDirectMessageSummary[] {
  try {
    return readProtoFields(bodyBytes)
      .filter((field) => field.fieldNumber === 1 && field.wireType === 2 && field.value instanceof Uint8Array)
      .flatMap((field) => decodeCosmosAnyMessage(field.value as Uint8Array));
  } catch {
    return [];
  }
}

function decodeCosmosAnyMessage(bytes: Uint8Array): CosmosDirectMessageSummary[] {
  const fields = readProtoFields(bytes);
  const typeUrl = readProtoStringField(fields, 1);
  const value = readProtoBytesField(fields, 2);
  if (!typeUrl || !value) return [];
  return [decodeCosmosDirectMessageValue(typeUrl, value)];
}

function decodeCosmosDirectMessageValue(typeUrl: string, bytes: Uint8Array): CosmosDirectMessageSummary {
  const fields = readProtoFields(bytes);
  if (typeUrl === '/cosmos.bank.v1beta1.MsgSend') {
    return {
      typeUrl,
      from: readProtoStringField(fields, 1) ?? undefined,
      to: readProtoStringField(fields, 2) ?? undefined,
      amount: summarizeProtoCoins(fields, 3),
    };
  }
  if (typeUrl === '/cosmos.bank.v1beta1.MsgMultiSend') {
    return {
      typeUrl,
      inputs: summarizeProtoMultiSendEntries(fields, 1),
      outputs: summarizeProtoMultiSendEntries(fields, 2),
    };
  }
  if (typeUrl === '/cosmos.staking.v1beta1.MsgDelegate' || typeUrl === '/cosmos.staking.v1beta1.MsgUndelegate') {
    return {
      typeUrl,
      delegator: readProtoStringField(fields, 1) ?? undefined,
      validator: readProtoStringField(fields, 2) ?? undefined,
      amount: summarizeProtoCoins(fields, 3),
    };
  }
  if (typeUrl === '/cosmos.staking.v1beta1.MsgCancelUnbondingDelegation') {
    return {
      typeUrl,
      delegator: readProtoStringField(fields, 1) ?? undefined,
      validator: readProtoStringField(fields, 2) ?? undefined,
      amount: summarizeProtoCoins(fields, 3),
      creationHeight: readProtoVarintField(fields, 4)?.toString(),
    };
  }
  if (typeUrl === '/cosmos.staking.v1beta1.MsgBeginRedelegate') {
    return {
      typeUrl,
      delegator: readProtoStringField(fields, 1) ?? undefined,
      sourceValidator: readProtoStringField(fields, 2) ?? undefined,
      destinationValidator: readProtoStringField(fields, 3) ?? undefined,
      amount: summarizeProtoCoins(fields, 4),
    };
  }
  if (typeUrl === '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward') {
    return {
      typeUrl,
      delegator: readProtoStringField(fields, 1) ?? undefined,
      validator: readProtoStringField(fields, 2) ?? undefined,
    };
  }
  if (typeUrl === '/ibc.applications.transfer.v1.MsgTransfer') {
    return {
      typeUrl,
      sourcePort: readProtoStringField(fields, 1) ?? undefined,
      sourceChannel: readProtoStringField(fields, 2) ?? undefined,
      amount: summarizeProtoCoins(fields, 3),
      from: readProtoStringField(fields, 4) ?? undefined,
      to: readProtoStringField(fields, 5) ?? undefined,
      memo: readProtoStringField(fields, 8) ?? undefined,
    };
  }
  if (typeUrl === '/cosmos.gov.v1.MsgVote') {
    return {
      typeUrl,
      to: readProtoVarintField(fields, 1)?.toString(),
      from: readProtoStringField(fields, 2) ?? undefined,
      customFields: `option: ${formatCosmosDirectVoteOption(readProtoVarintField(fields, 3))}`,
    };
  }
  if (typeUrl === '/cosmos.gov.v1.MsgDeposit') {
    return {
      typeUrl,
      proposalId: readProtoVarintField(fields, 1)?.toString(),
      depositor: readProtoStringField(fields, 2) ?? undefined,
      amount: summarizeProtoCoins(fields, 3),
    };
  }
  if (typeUrl === '/cosmos.authz.v1beta1.MsgGrant') {
    return {
      typeUrl,
      granter: readProtoStringField(fields, 1) ?? undefined,
      grantee: readProtoStringField(fields, 2) ?? undefined,
      grantType: summarizeProtoGrant(fields, 3),
    };
  }
  if (typeUrl === '/cosmos.authz.v1beta1.MsgRevoke') {
    return {
      typeUrl,
      granter: readProtoStringField(fields, 1) ?? undefined,
      grantee: readProtoStringField(fields, 2) ?? undefined,
      msgTypeUrl: readProtoStringField(fields, 3) ?? undefined,
    };
  }
  if (typeUrl === '/cosmos.feegrant.v1beta1.MsgGrantAllowance') {
    return {
      typeUrl,
      granter: readProtoStringField(fields, 1) ?? undefined,
      grantee: readProtoStringField(fields, 2) ?? undefined,
      allowanceType: summarizeProtoAnyType(fields, 3),
    };
  }
  if (typeUrl === '/cosmos.feegrant.v1beta1.MsgRevokeAllowance') {
    return {
      typeUrl,
      granter: readProtoStringField(fields, 1) ?? undefined,
      grantee: readProtoStringField(fields, 2) ?? undefined,
    };
  }
  return { typeUrl, customFields: summarizeUnknownProtoFields(fields) };
}

function readProtoVarintField(fields: ProtoField[], fieldNumber: number): bigint | null {
  const field = fields.find((entry) => entry.fieldNumber === fieldNumber && entry.wireType === 0 && typeof entry.value === 'bigint');
  return typeof field?.value === 'bigint' ? field.value : null;
}

function formatCosmosDirectVoteOption(option: bigint | null): string {
  if (option === 1n) return 'yes';
  if (option === 2n) return 'abstain';
  if (option === 3n) return 'no';
  if (option === 4n) return 'no_with_veto';
  return option == null ? 'unknown' : option.toString();
}

function extractCosmosTypeUrls(bytes: Uint8Array): string[] {
  const text = new TextDecoder().decode(bytes);
  const matches = text.match(/\/cosmos\.[A-Za-z0-9_.]+\.Msg[A-Za-z0-9_]+/g) ?? [];
  return [...new Set(matches)];
}

function summarizeProtoCoins(fields: ProtoField[], fieldNumber: number): string | undefined {
  const coins = fields
    .filter((field) => field.fieldNumber === fieldNumber && field.wireType === 2 && field.value instanceof Uint8Array)
    .map((field) => {
      const coinFields = readProtoFields(field.value as Uint8Array);
      const denom = readProtoStringField(coinFields, 1) ?? '?';
      const amount = readProtoStringField(coinFields, 2) ?? '?';
      return `${amount}${denom}`;
    });
  return coins.length > 0 ? coins.join(', ') : undefined;
}

function summarizeProtoMultiSendEntries(fields: ProtoField[], fieldNumber: number): string | undefined {
  const entries = fields
    .filter((field) => field.fieldNumber === fieldNumber && field.wireType === 2 && field.value instanceof Uint8Array)
    .map((field) => {
      const entryFields = readProtoFields(field.value as Uint8Array);
      const address = readProtoStringField(entryFields, 1) ?? '?';
      const coins = summarizeProtoCoins(entryFields, 2) ?? '?';
      return `${address}: ${coins}`;
    });
  return entries.length > 0 ? entries.join(', ') : undefined;
}

function summarizeProtoAnyType(fields: ProtoField[], fieldNumber: number): string | undefined {
  const bytes = readProtoBytesField(fields, fieldNumber);
  if (!bytes) return undefined;
  try {
    const anyFields = readProtoFields(bytes);
    return readProtoStringField(anyFields, 1) ?? summarizeUnknownProtoFields(anyFields);
  } catch {
    return `${bytes.length} bytes`;
  }
}

function summarizeProtoGrant(fields: ProtoField[], fieldNumber: number): string | undefined {
  const bytes = readProtoBytesField(fields, fieldNumber);
  if (!bytes) return undefined;
  try {
    const grantFields = readProtoFields(bytes);
    return summarizeProtoAnyType(grantFields, 1) ?? summarizeUnknownProtoFields(grantFields);
  } catch {
    return `${bytes.length} bytes`;
  }
}

function summarizeUnknownProtoFields(fields: ProtoField[], depth = 0): string | undefined {
  const summaries = fields.slice(0, 8).map((field) => summarizeUnknownProtoField(field, depth)).filter(Boolean);
  if (fields.length > 8) summaries.push(`+${fields.length - 8} more`);
  return summaries.length > 0 ? summaries.join('; ') : undefined;
}

function summarizeUnknownProtoField(field: ProtoField, depth: number): string {
  const label = `field${field.fieldNumber}`;
  if (field.wireType === 0) return `${label}: ${String(field.value)}`;
  if (field.value instanceof Uint8Array) {
    if (field.wireType === 2) {
      const text = decodePrintableProtoText(field.value);
      if (text) return `${label}: ${text}`;
      if (depth < 1) {
        try {
          const nested = summarizeUnknownProtoFields(readProtoFields(field.value), depth + 1);
          if (nested) return `${label}: {${nested}}`;
        } catch {
          // Fall through to byte length summary for opaque length-delimited data.
        }
      }
      return `${label}: ${field.value.length} bytes`;
    }
    if (field.wireType === 1 || field.wireType === 5) return `${label}: 0x${bytesToHex(field.value)}`;
  }
  return `${label}: wire${field.wireType}`;
}

function decodePrintableProtoText(bytes: Uint8Array): string | null {
  if (bytes.length === 0 || bytes.length > 160) return null;
  const text = new TextDecoder().decode(bytes);
  if (!/^[\x20-\x7e]+$/.test(text)) return null;
  return text;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    throw new Error('Invalid base64 payload');
  }
}

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function readProtoStringField(fields: ProtoField[], fieldNumber: number): string | null {
  const value = readProtoBytesField(fields, fieldNumber);
  return value ? new TextDecoder().decode(value) : null;
}

function readProtoBytesField(fields: ProtoField[], fieldNumber: number): Uint8Array | null {
  const field = fields.find((entry) => entry.fieldNumber === fieldNumber && entry.wireType === 2 && entry.value instanceof Uint8Array);
  return field?.value instanceof Uint8Array ? field.value : null;
}

function readProtoFields(bytes: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const key = readProtoVarint(bytes, offset);
    offset = key.offset;
    const fieldNumber = Number(key.value >> 3n);
    const wireType = Number(key.value & 7n);
    if (fieldNumber <= 0) throw new Error('Invalid protobuf field number');
    if (wireType === 0) {
      const value = readProtoVarint(bytes, offset);
      offset = value.offset;
      fields.push({ fieldNumber, wireType, value: value.value });
    } else if (wireType === 2) {
      const length = readProtoVarint(bytes, offset);
      offset = length.offset;
      const end = offset + Number(length.value);
      if (!Number.isSafeInteger(end) || end > bytes.length) throw new Error('Invalid protobuf length');
      fields.push({ fieldNumber, wireType, value: bytes.slice(offset, end) });
      offset = end;
    } else if (wireType === 1) {
      const end = offset + 8;
      if (end > bytes.length) throw new Error('Invalid protobuf fixed64');
      fields.push({ fieldNumber, wireType, value: bytes.slice(offset, end) });
      offset = end;
    } else if (wireType === 5) {
      const end = offset + 4;
      if (end > bytes.length) throw new Error('Invalid protobuf fixed32');
      fields.push({ fieldNumber, wireType, value: bytes.slice(offset, end) });
      offset = end;
    } else {
      throw new Error(`Unsupported protobuf wire type ${wireType}`);
    }
  }
  return fields;
}

function readProtoVarint(bytes: Uint8Array, startOffset: number): { value: bigint; offset: number } {
  let value = 0n;
  let shift = 0n;
  let offset = startOffset;
  while (offset < bytes.length) {
    const byte = bytes[offset];
    value |= BigInt(byte & 0x7f) << shift;
    offset += 1;
    if ((byte & 0x80) === 0) return { value, offset };
    shift += 7n;
    if (shift > 63n) throw new Error('Protobuf varint is too large');
  }
  throw new Error('Unexpected end of protobuf varint');
}

function getJsonObject(value: Record<string, JsonValue>, field: string): Record<string, JsonValue> | null {
  const entry = value[field];
  return entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : null;
}

function getJsonString(value: Record<string, JsonValue>, field: string): string | null {
  const entry = value[field];
  if (typeof entry === 'string') return entry;
  if (typeof entry === 'number') return String(entry);
  return null;
}

function summarizeCosmosJsonAmount(value: JsonValue | undefined): string | null {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  const amounts = entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const amount = getJsonString(entry, 'amount') ?? '?';
    const denom = getJsonString(entry, 'denom') ?? '?';
    return `${amount}${denom}`;
  }).filter((entry): entry is string => Boolean(entry));
  return amounts.length > 0 ? amounts.join(', ') : null;
}

function summarizeCosmosJsonAny(value: JsonValue | undefined): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entry = value as Record<string, JsonValue>;
  return getJsonString(entry, '@type') ?? getJsonString(entry, 'type_url') ?? getJsonString(entry, 'typeUrl');
}

function summarizeCosmosJsonMultiSendEntries(value: JsonValue | undefined): string | null {
  if (!Array.isArray(value)) return null;
  const entries = value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const item = entry as Record<string, JsonValue>;
    const address = getJsonString(item, 'address') ?? '?';
    const coins = summarizeCosmosJsonAmount(item.coins) ?? '?';
    return `${address}: ${coins}`;
  }).filter((entry): entry is string => Boolean(entry));
  return entries.length > 0 ? entries.join(', ') : null;
}

function requireBase64String(value: unknown, field: string): string {
  const text = requireString(value, field);
  bytesFromBase64(text);
  return text;
}

function requireIntegerString(value: unknown, field: string): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'bigint' && value >= 0n) return value.toString();
  if (typeof value === 'string' && /^\d+$/.test(value)) return value;
  throw new Error(`${field} must be a non-negative integer`);
}

function bytesFromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function summarizeBase64Bytes(value: string): string {
  return `${bytesFromBase64(value).length} bytes`;
}

function normalizeRpcValue(value: string | undefined): string {
  if (!value) return '0';
  return value;
}

function optionalRpcNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(BigInt(value));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function findKnownNetwork(chainId: number): Network | null {
  return Object.values(KNOWN_NETWORKS).find((network) => network.chainId === chainId) ?? null;
}

function normalizeOptionalRpcBigInt(value: string | undefined, field: string): bigint | undefined {
  if (!value) return undefined;
  try {
    return BigInt(value);
  } catch {
    throw new Error(`${field} must be a valid hex or decimal quantity`);
  }
}

function normalizeDappTransactionTo(value: unknown): string | null {
  if (value == null) return null;
  return requireString(value, 'to');
}

function normalizeTronTransferRequest(params: unknown[] | undefined): { to: string; amountSun: bigint; from?: string } {
  const normalized = normalizeArrayParams(params);
  if (normalized.length === 1 && normalized[0] && typeof normalized[0] === 'object') {
    const candidate = normalized[0] as Record<string, unknown>;
    return {
      to: requireString(candidate.to ?? candidate.toAddress, 'to'),
      amountSun: requireBigIntQuantity(candidate.amountSun ?? candidate.amount ?? candidate.value, 'amount'),
      from: optionalString(candidate.from ?? candidate.ownerAddress),
    };
  }
  return {
    to: requireString(normalized[0], 'to'),
    amountSun: requireBigIntQuantity(normalized[1], 'amount'),
    from: optionalString(normalized[2]),
  };
}

function normalizeTrc20DappTransferRequest(params: unknown[] | undefined): {
  contractAddress: string;
  to: string;
  amount: string;
  decimals: number;
  symbol?: string;
} {
  const [payload] = normalizeArrayParams(params);
  if (!payload || typeof payload !== 'object') {
    throw new Error('tron_sendTrc20Transfer requires a transfer object');
  }
  const candidate = payload as Record<string, unknown>;
  return {
    contractAddress: requireString(candidate.contractAddress, 'contractAddress'),
    to: requireString(candidate.to ?? candidate.toAddress, 'to'),
    amount: requireString(candidate.amount ?? candidate.value, 'amount'),
    decimals: requireNumber(candidate.decimals, 'decimals'),
    symbol: optionalString(candidate.symbol),
  };
}

function normalizeErc20DappTransferRequest(params: unknown[] | undefined): {
  contractAddress: string;
  to: string;
  amount: string;
  decimals: number;
  symbol?: string;
} {
  const [payload] = normalizeArrayParams(params);
  if (!payload || typeof payload !== 'object') {
    throw new Error('shella_sendErc20Transfer requires a transfer object');
  }
  const candidate = payload as Record<string, unknown>;
  return {
    contractAddress: requireString(candidate.contractAddress, 'contractAddress'),
    to: requireString(candidate.to ?? candidate.toAddress, 'to'),
    amount: requireString(candidate.amount ?? candidate.value, 'amount'),
    decimals: requireNumber(candidate.decimals, 'decimals'),
    symbol: optionalString(candidate.symbol),
  };
}

function normalizeSplDappTransferRequest(params: unknown[] | undefined): {
  contractAddress: string;
  to: string;
  amount: string;
  decimals: number;
  symbol?: string;
  createRecipientAta?: boolean;
} {
  const [payload] = normalizeArrayParams(params);
  if (!payload || typeof payload !== 'object') {
    throw new Error('solana_sendSplTransfer requires a transfer object');
  }
  const candidate = payload as Record<string, unknown>;
  return {
    contractAddress: requireString(candidate.contractAddress ?? candidate.mintAddress, 'contractAddress'),
    to: requireString(candidate.to ?? candidate.recipient ?? candidate.toAddress, 'to'),
    amount: requireString(candidate.amount ?? candidate.value, 'amount'),
    decimals: requireNumber(candidate.decimals, 'decimals'),
    symbol: optionalString(candidate.symbol),
    createRecipientAta: optionalBoolean(candidate.createRecipientAta ?? candidate.createAssociatedTokenAccount),
  };
}

function normalizeJettonDappTransferRequest(params: unknown[] | undefined): {
  contractAddress: string;
  to: string;
  amount: string;
  decimals: number;
  symbol?: string;
  jettonTransferTonAmount?: string;
  forwardTonAmount?: string;
} {
  const [payload] = normalizeArrayParams(params);
  if (!payload || typeof payload !== 'object') {
    throw new Error('ton_sendJettonTransfer requires a transfer object');
  }
  const candidate = payload as Record<string, unknown>;
  return {
    contractAddress: requireString(candidate.contractAddress ?? candidate.masterAddress, 'contractAddress'),
    to: requireString(candidate.to ?? candidate.recipient ?? candidate.toAddress, 'to'),
    amount: requireString(candidate.amount ?? candidate.value, 'amount'),
    decimals: requireNumber(candidate.decimals, 'decimals'),
    symbol: optionalString(candidate.symbol),
    jettonTransferTonAmount: optionalString(candidate.jettonTransferTonAmount ?? candidate.transferTonAmount),
    forwardTonAmount: optionalString(candidate.forwardTonAmount),
  };
}

function normalizeSolanaDappTransferRequest(params: unknown[] | undefined): { to: string; lamports: bigint; from?: string } {
  const normalized = normalizeArrayParams(params);
  if (normalized.length === 1 && normalized[0] && typeof normalized[0] === 'object') {
    const candidate = normalized[0] as Record<string, unknown>;
    return {
      to: requireString(candidate.to ?? candidate.recipient, 'to'),
      lamports: requireBigIntQuantity(candidate.lamports ?? candidate.amountLamports ?? candidate.amount ?? candidate.value, 'lamports'),
      from: optionalString(candidate.from ?? candidate.publicKey),
    };
  }
  return {
    to: requireString(normalized[0], 'to'),
    lamports: requireBigIntQuantity(normalized[1], 'lamports'),
    from: optionalString(normalized[2]),
  };
}

function parseKeystorePayload(keystoreJson: string): ShellEncryptedKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(keystoreJson);
  } catch {
    throw new Error('Keystore JSON is invalid');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Keystore payload must be a JSON object');
  }

  const requiredFields = [
    'address',
    'key_type',
    'kdf',
    'kdf_params',
    'cipher',
    'cipher_params',
    'ciphertext',
    'public_key',
  ] as const;

  for (const field of requiredFields) {
    if (!(field in parsed)) {
      throw new Error(`Keystore is missing required field: ${field}`);
    }
  }

  return parsed as ShellEncryptedKey;
}

function normalizeRemoteTxRecord(value: unknown): WalletTxRecord | null {
  if (!value || typeof value !== 'object') return null;
  const tx = value as Record<string, unknown>;
  const txHash = optionalString(tx.hash);
  const from = optionalString(tx.from);
  const to = tx.to == null ? null : optionalString(tx.to);
  const storedValue = optionalString(tx.value);
  if (!txHash || !from || to === undefined || !storedValue) return null;

  // AA bundle info
  const txType = optionalString(tx.type);
  const shellType = optionalString(tx.shellType);
  const rewardKind = optionalString(tx.rewardKind);
  const bundle = tx.aa_bundle as Record<string, unknown> | null | undefined;
  const innerCalls = Array.isArray(bundle?.inner_calls) ? bundle!.inner_calls : null;
  const paymaster = bundle?.paymaster ? optionalString(bundle.paymaster as unknown) : null;

  return {
    txHash,
    from,
    to,
    value: storedValue,
    data: optionalString(tx.input) ?? optionalString(tx.data) ?? '0x',
    createdAt: optionalNumber(tx.timestamp) ?? Date.now(),
    updatedAt: optionalNumber(tx.timestamp) ?? Date.now(),
    status: normalizeRemoteStatus(optionalString(tx.status)),
    blockNumber: optionalString(tx.blockNumber) ?? null,
    source: 'remote',
    txType: txType ?? undefined,
    shellType: shellType ?? null,
    rewardKind: rewardKind ?? null,
    rewardLayer: optionalString(tx.rewardLayer) ?? null,
    rewardSourceHash: optionalString(tx.rewardSourceHash) ?? null,
    originalSize: optionalString(tx.originalSize) ?? null,
    compressedSize: optionalString(tx.compressedSize) ?? null,
    decodedInput: typeof tx.decodedInput === 'object' && tx.decodedInput !== null
      ? tx.decodedInput as WalletTxRecord['decodedInput']
      : null,
    paymaster: paymaster ?? null,
    innerCallCount: innerCalls != null ? innerCalls.length : null,
  };
}

function normalizeRemoteStatus(status: string | undefined): WalletTxRecord['status'] {
  if (status === 'failed' || status === 'reverted') return 'failed';
  if (status === 'pending') return 'pending';
  return 'confirmed';
}

function normalizeRecipient(address: string): string {
  if (!address) throw new Error('Recipient address is required');
  if (!/^0x[0-9a-fA-F]{64}$/.test(address)) throw new Error('Recipient must be a 0x + 64-char hex Shell address');
  return address;
}

function encodeShellAbiAddress(address: string): string {
  return normalizeRecipient(address).slice(2).padStart(64, '0');
}

function encodeAbiUint(value: bigint): string {
  if (value < 0n) throw new Error('ABI uint value must be non-negative');
  return value.toString(16).padStart(64, '0');
}

function decodeAbiUint(value: string): bigint {
  const hex = normalizeData(value);
  if (hex === '0x') return 0n;
  return BigInt(hex);
}

function decodeAbiString(value: string): string {
  const hex = normalizeData(value).slice(2);
  if (hex.length === 64) {
    return Buffer.from(hex.replace(/00+$/, ''), 'hex').toString('utf8').replace(/\0+$/, '');
  }
  if (hex.length >= 128) {
    const offset = Number(BigInt(`0x${hex.slice(0, 64)}`));
    const lengthOffset = offset * 2;
    const byteLength = Number(BigInt(`0x${hex.slice(lengthOffset, lengthOffset + 64)}`));
    return Buffer.from(hex.slice(lengthOffset + 64, lengthOffset + 64 + byteLength * 2), 'hex').toString('utf8');
  }
  return '';
}

function formatTokenAmount(value: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error('Token decimals must be an integer between 0 and 36');
  }
  if (decimals === 0) return value.toString();
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function getChainKind(network: Network): ChainKind {
  return network.kind ?? 'shell';
}

function getNativeChainKind(chainKind: ChainKind): NativeChainKind | null {
  return chainKind === 'tron' || chainKind === 'solana' || chainKind === 'bitcoin' || chainKind === 'cosmos' || chainKind === 'ton' || chainKind === 'aptos' ? chainKind : null;
}

function getNativeChainAdapter(chainKind: ChainKind): NativeChainAdapter | null {
  const nativeChainKind = getNativeChainKind(chainKind);
  return nativeChainKind ? NATIVE_CHAIN_ADAPTERS[nativeChainKind] : null;
}

function getAccountAddressForChain(account: StoredAccount | null | undefined, chainKind: ChainKind): string | null {
  if (!account) return null;
  if (chainKind === 'tron') return account.chainAddresses?.tron ?? null;
  if (chainKind === 'solana') return account.chainAddresses?.solana ?? null;
  if (chainKind === 'bitcoin') return account.chainAddresses?.bitcoin ?? null;
  if (chainKind === 'cosmos') return account.chainAddresses?.cosmos ?? null;
  if (chainKind === 'ton') return account.chainAddresses?.ton ?? null;
  if (chainKind === 'aptos') return account.chainAddresses?.aptos ?? null;
  return account.chainAddresses?.shell ?? account.pqAddress;
}

function getAccountAddressForNetwork(account: StoredAccount | null | undefined, network: Network): string | null {
  if (!account) return null;
  const chainKind = getChainKind(network);
  if (chainKind === 'bitcoin') {
    return getBitcoinNetwork(network) === 'testnet'
      ? account.chainAddresses?.bitcoinTestnet ?? null
      : account.chainAddresses?.bitcoin ?? null;
  }
  if (chainKind === 'cosmos') {
    const address = account.chainAddresses?.cosmos ?? null;
    if (!address) return null;
    return convertCosmosAddressPrefix(address, getCosmosAddressPrefix(network));
  }
  return getAccountAddressForChain(account, chainKind);
}

function getBitcoinNetwork(network: Network): BitcoinNetwork {
  if (network.chainId === 18332 || /testnet/i.test(network.name) || /\/testnet(\/|$)/i.test(network.rpcUrl)) return 'testnet';
  return 'mainnet';
}

function getCosmosChainId(network: Network): string {
  if (/osmosis/i.test(network.name) || /osmosis/i.test(network.rpcUrl)) return 'osmosis-1';
  if (/theta/i.test(network.name) || /theta-testnet/i.test(network.rpcUrl)) return 'theta-testnet-001';
  if (network.chainId === 118) return 'cosmoshub-4';
  return String(network.chainId);
}

function getCosmosAddressPrefix(network: Network): string {
  return network.addressPrefix ?? (/osmosis/i.test(network.name) || /osmosis/i.test(network.rpcUrl) ? 'osmo' : 'cosmos');
}

function getCosmosNativeDenom(network: Network): string {
  return network.nativeDenom ?? (/osmosis/i.test(network.name) || /osmosis/i.test(network.rpcUrl) ? 'uosmo' : 'uatom');
}

function getCosmosNativeDecimals(network: Network): number {
  return network.nativeDecimals ?? 6;
}

function normalizeData(data?: string): `0x${string}` {
  if (!data || data.trim() === '') return '0x';
  const trimmed = data.trim();
  if (!/^0x[0-9a-fA-F]*$/.test(trimmed) || trimmed.length % 2 !== 0) {
    throw new Error('Calldata must be an even-length 0x-prefixed hex string');
  }
  return trimmed as `0x${string}`;
}

function validateNetwork(value: unknown): Network {
  if (!value || typeof value !== 'object') {
    throw new Error('Network payload is invalid');
  }
  const network = value as Record<string, unknown>;
  const kind = optionalChainKind(network.kind);
  const normalized: Network = {
    name: requireString(network.name, 'network.name'),
    chainId: requireNumber(network.chainId, 'network.chainId'),
    rpcUrl: validateRpcUrl(requireString(network.rpcUrl, 'network.rpcUrl'), 'network.rpcUrl'),
    kind,
    symbol: optionalString(network.symbol) ?? (kind === 'tron' ? 'TRX' : kind === 'solana' ? 'SOL' : kind === 'bitcoin' ? 'BTC' : kind === 'cosmos' ? 'ATOM' : kind === 'ton' ? 'TON' : kind === 'aptos' ? 'APT' : 'SHELL'),
  };
  if (kind === 'cosmos') {
    normalized.addressPrefix = optionalString(network.addressPrefix) ?? 'cosmos';
    normalized.nativeDenom = optionalString(network.nativeDenom) ?? 'uatom';
    normalized.nativeDecimals = optionalNumber(network.nativeDecimals) ?? 6;
  }
  return normalized;
}

function optionalChainKind(value: unknown): ChainKind {
  if (value === 'shell' || value === 'evm' || value === 'tron' || value === 'solana' || value === 'bitcoin' || value === 'cosmos' || value === 'ton' || value === 'aptos') return value;
  return 'shell';
}

function requireChainKind(value: unknown, field: string): ChainKind {
  if (value === 'shell' || value === 'evm' || value === 'tron' || value === 'solana' || value === 'bitcoin' || value === 'cosmos' || value === 'ton' || value === 'aptos') return value;
  throw new Error(`${field} is invalid`);
}

// WALLET-H2: Validate that an RPC URL uses an approved scheme and is not a
// private/loopback address (except localhost which is permitted for dev use).
function validateRpcUrl(url: string, field: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${field} must be a valid URL`);
  }

  const { protocol, hostname } = parsed;
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

  if (protocol !== 'https:' && !(protocol === 'http:' && isLocalhost)) {
    throw new Error(`${field} must use https (or http for localhost only)`);
  }

  // Reject private IP ranges that are not localhost.
  if (!isLocalhost) {
    const privateRangePattern =
      /^(10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+)$/;
    if (privateRangePattern.test(hostname)) {
      throw new Error(`${field} must not point to a private IP address`);
    }
  }

  return url;
}

function isLocalRpcUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1');
  } catch {
    return false;
  }
}

function requirePassword(value: unknown): string {
  const password = requireString(value, 'password');
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  return password;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} is required`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function optionalNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return requireString(value, 'target');
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new Error(`${field} must be a valid number`);
  }
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return undefined;
}

function normalizeBitcoinInputs(value: unknown): BitcoinTxInput[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('bitcoinInputs must be an array');
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('bitcoinInputs must contain objects');
    const candidate = entry as Record<string, unknown>;
    return {
      txid: requireString(candidate.txid, 'bitcoinInputs.txid').toLowerCase(),
      vout: requireNumber(candidate.vout, 'bitcoinInputs.vout'),
      valueSats: requireString(candidate.valueSats, 'bitcoinInputs.valueSats'),
      confirmed: candidate.confirmed === true,
    };
  });
}

function normalizeBitcoinUtxoPreference(value: unknown): BitcoinUtxoPreference {
  if (!value || typeof value !== 'object') throw new Error('preference is required');
  const candidate = value as Partial<BitcoinUtxoPreference>;
  const key = requireString(candidate.key, 'preference.key').trim().toLowerCase();
  if (!/^[0-9a-f]{64}:[0-9]+$/i.test(key)) throw new Error('Invalid Bitcoin UTXO key');
  const label = optionalString(candidate.label)?.trim().slice(0, 64);
  return {
    key,
    ...(label ? { label } : {}),
    ...(candidate.locked === true ? { locked: true } : {}),
    updatedAt: Date.now(),
  };
}

function normalizeBitcoinUtxoPreferencesMessage(value: unknown): BitcoinUtxoPreference[] {
  if (!Array.isArray(value)) throw new Error('preferences must be an array');
  return value.map(normalizeBitcoinUtxoPreference);
}

function optionalNumberArray(value: unknown): number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('chainIds must be an array');
  return [...new Set(value.map((item) => {
    if (!Number.isSafeInteger(item) || item <= 0) throw new Error('chainIds must contain positive safe integers');
    return item;
  }))];
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('methods must be an array');
  return [...new Set(value.map((item) => {
    if (typeof item !== 'string' || item.trim() === '') throw new Error('methods must contain non-empty strings');
    return item;
  }))];
}

function normalizeWalletConnectNamespaces(value: unknown, field: string): Record<string, WalletConnectNamespaceProposal> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([namespace, raw]) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`${field}.${namespace} must be an object`);
    }
    const candidate = raw as Record<string, unknown>;
    const chains = candidate.chains === undefined ? undefined : optionalStringArray(candidate.chains);
    const methods = optionalStringArray(candidate.methods);
    if (!methods?.length) throw new Error(`${field}.${namespace}.methods must contain at least one method`);
    const events = candidate.events === undefined ? [] : optionalStringArray(candidate.events) ?? [];
    return [namespace, { chains, methods, events }];
  }));
}

function mergeWalletConnectNamespaces(
  required: Record<string, WalletConnectNamespaceProposal>,
  optional: Record<string, WalletConnectNamespaceProposal>,
): Record<string, WalletConnectNamespaceProposal> {
  const merged: Record<string, WalletConnectNamespaceProposal> = {};
  for (const [namespace, proposal] of [...Object.entries(required), ...Object.entries(optional)]) {
    const current = merged[namespace] ?? { chains: [], methods: [], events: [] };
    merged[namespace] = {
      chains: [...new Set([...(current.chains ?? []), ...(proposal.chains ?? [])])],
      methods: [...new Set([...current.methods, ...proposal.methods])],
      events: [...new Set([...(current.events ?? []), ...(proposal.events ?? [])])],
    };
  }
  return merged;
}

function normalizeWalletConnectRequestPayload(value: unknown): { method: string; params: unknown[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('request must be an object');
  }
  const candidate = value as Record<string, unknown>;
  return {
    method: requireString(candidate.method, 'request.method'),
    params: Array.isArray(candidate.params) ? candidate.params : [],
  };
}

function normalizeWalletConnectEvent(value: unknown): {
  type: 'session_proposal' | 'session_request' | 'session_delete';
  topic?: string;
  origin?: string;
  params?: Record<string, unknown>;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('event must be an object');
  }
  const candidate = value as Record<string, unknown>;
  const type = requireString(candidate.type, 'event.type');
  if (type !== 'session_proposal' && type !== 'session_request' && type !== 'session_delete') {
    throw new Error(`Unsupported WalletConnect event: ${type}`);
  }
  const params = candidate.params;
  if (params !== undefined && (!params || typeof params !== 'object' || Array.isArray(params))) {
    throw new Error('event.params must be an object');
  }
  return {
    type,
    topic: optionalString(candidate.topic),
    origin: optionalString(candidate.origin),
    params: params as Record<string, unknown> | undefined,
  };
}

function normalizeWalletConnectRpcEvent(value: unknown): {
  id: number;
  type: 'session_request';
  topic?: string;
  params?: Record<string, unknown>;
} {
  const event = normalizeWalletConnectEvent(value);
  if (event.type !== 'session_request') {
    throw new Error('WalletConnect RPC event must be a session_request');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('event must be an object');
  }
  const id = (value as Record<string, unknown>).id;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0) {
    throw new Error('event.id must be a non-negative safe integer');
  }
  return {
    id,
    type: 'session_request',
    topic: event.topic,
    params: event.params,
  };
}

function formatEther(wei: bigint): string {
  const eth = Number(wei) / 1e18;
  return eth.toFixed(6);
}

function parseEtherValue(value: string): bigint {
  if (value.startsWith('0x')) return BigInt(value);
  return parseEther(value as `${number}`);
}

function requireBigIntQuantity(value: unknown, field: string): bigint {
  if (typeof value === 'bigint') {
    if (value < 0n) throw new Error(`${field} must be non-negative`);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${field} must be a non-negative safe integer`);
    }
    return BigInt(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed = BigInt(value);
      if (parsed < 0n) throw new Error();
      return parsed;
    } catch {
      throw new Error(`${field} must be a non-negative decimal or hex quantity`);
    }
  }
  throw new Error(`${field} is required`);
}

function parseSigningHash(value: string): Uint8Array {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error('txSigningHash must be 0x + 64 hex characters');
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(value.slice(2 + i * 2, 4 + i * 2), 16);
  }
  return out;
}

/**
 * Assert that an address is a valid 0x Shell address before the cast to `0x${string}` needed by viem.
 * The Shell provider handles 0x hex addresses natively; the cast only satisfies TypeScript types.
 */
function asPqAddress(address: string, context: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(address)) {
    throw new Error(`${context}: expected 0x + 64-char hex Shell address, got "${address.slice(0, 12)}…"`);
  }
  return address as unknown as `0x${string}`;
}

export function toSafeErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : 'Wallet operation failed';
  const lowerMessage = message.toLowerCase();

  if (
    message === 'Password must be at least 8 characters' ||
    message === 'Incorrect password or corrupted keystore' ||
    message === 'Public key mismatch — wrong password or corrupt keystore' ||
    message === 'Keystore address does not match public key' ||
    message === 'Keystore JSON is invalid' ||
    message === 'Keystore payload must be a JSON object' ||
    message.startsWith('Keystore is missing required field:') ||
    message === 'No wallet found' ||
    message === 'No wallet to export' ||
    message === 'Wallet is locked' ||
    message === 'Tron key is not available for this account' ||
    message === 'No Tron address is available for this account' ||
    message === 'Solana key is not available for this account' ||
    message === 'No Solana address is available for this account' ||
    message === 'Cosmos key is not available for this account' ||
    message === 'No Cosmos address is available for this account' ||
    message === 'TON key is not available for this account' ||
    message === 'No TON address is available for this account' ||
    message === 'Aptos key is not available for this account' ||
    message === 'No Aptos address is available for this account' ||
    message === 'Invalid Tron sender address' ||
    message === 'Invalid Tron recipient address' ||
    message === 'Invalid Solana address' ||
    message === 'Invalid Solana sender address' ||
    message === 'Invalid Solana recipient address' ||
    message === 'Invalid Cosmos address' ||
    message === 'Invalid Cosmos sender address' ||
    message === 'Invalid Cosmos recipient address' ||
    message === 'Invalid TON address' ||
    message === 'Invalid TON sender address' ||
    message === 'Invalid TON recipient address' ||
    message === 'Invalid TON owner address' ||
    message === 'Invalid Aptos address' ||
    message === 'Invalid Jetton master address' ||
    message === 'Invalid Tron owner address' ||
    message === 'Invalid TRC20 contract address' ||
    message === 'Amount is required' ||
    message === 'Amount must be non-negative' ||
    message === 'Amount must be greater than zero' ||
    message === 'Amount exceeds supported Tron transfer limit' ||
    message === 'TRX amount must have at most 6 decimal places' ||
    message === 'SOL amount must have at most 9 decimal places' ||
    message === 'Solana blockhash expired. Refresh the transaction and try again.' ||
    message === 'Insufficient SOL for amount, fees, or rent.' ||
    message === 'Solana transaction needs a higher priority fee or compute budget. Retry with priority fee support enabled.' ||
    message === 'Solana account was not found. Check the recipient address and token account before retrying.' ||
    message === 'ATOM amount must have at most 6 decimal places' ||
    message === 'TON amount must have at most 9 decimal places' ||
    message === 'APT amount must have at most 8 decimal places' ||
    message === 'Jetton transfer TON fee must be greater than zero' ||
    message === 'Jetton forward TON amount must be non-negative' ||
    message === 'Jetton transfer TON fee must be greater than forward amount' ||
    message === 'Insufficient TON balance for Jetton transfer fee' ||
    message === 'Amount exceeds supported Solana transfer limit' ||
    message === 'Amount exceeds supported Aptos transfer limit' ||
    message === 'Cosmos fee must be non-negative' ||
    message === 'Cosmos gas limit must be greater than zero' ||
    message === 'Solana blockhash response is invalid' ||
    message === 'TRC20 is only available on Tron networks' ||
    message === 'ERC20 is only available on Shell/EVM networks' ||
    message === 'SPL is only available on Solana networks' ||
    message === 'Jetton is only available on TON networks' ||
    message === 'Tron dApp methods require a Tron network' ||
    message === 'Shell/EVM dApp methods require a Shell/EVM network' ||
    message === 'Solana dApp methods require a Solana network' ||
    message === 'TON dApp methods require a TON network' ||
    message === 'TRC20 decimals response is invalid' ||
    message === 'TRC20 constant call response is invalid' ||
    message === 'TRC20 trigger response is invalid' ||
    message.startsWith('Tron transaction failed:') ||
    message.startsWith('TRC20 contract reverted:') ||
    message === 'Invalid SPL token mint address' ||
    message === 'SPL token mint response is invalid' ||
    message === 'SPL token account response is invalid' ||
    message === 'Insufficient SPL token balance' ||
    message.startsWith('Recipient SPL token account not found.') ||
    message === 'Amount exceeds supported SPL transfer limit' ||
    message === 'solana_sendSplTransfer requires a transfer object' ||
    message === 'ton_sendJettonTransfer requires a transfer object' ||
    message === 'Token decimals must be an integer between 0 and 36' ||
    message === 'Jetton decimals must be an integer between 0 and 36' ||
    message === 'Derived Tron address does not match stored account' ||
    message === 'Derived Solana address does not match stored account' ||
    message === 'Derived TON address does not match stored account' ||
    message === 'Derived Aptos address does not match stored account' ||
    message === 'Tron create transaction response is invalid' ||
    message === 'TON wallet must be active before sending' ||
    message === 'TON seqno response is invalid' ||
    message === 'TON RPC response is invalid' ||
    message === 'Aptos account response is invalid' ||
    message === 'Aptos balance response is invalid' ||
    message === 'Aptos gas price response is invalid' ||
    message === 'Aptos gas price must be greater than zero' ||
    message === 'Aptos submit transaction response is invalid' ||
    message === 'Aptos public key does not match sender address' ||
    message === 'Aptos account is not funded or not created. Fund it before sending.' ||
    message === 'Aptos transaction sequence changed. Refresh wallet state and try again.' ||
    message === 'Insufficient APT balance for amount and gas.' ||
    message === 'Aptos transaction ran out of gas.' ||
    message.startsWith('Aptos transaction failed:') ||
    message === 'Interactive approval required' ||
    message === 'Request rejected by user' ||
    message.startsWith('Connected account is not the currently active ') ||
    message === 'Connected account is not available on the requested chain' ||
    message === 'Recipient address is required' ||
    message === 'Recipient must be a 0x + 64-char hex Shell address' ||
    message === 'Calldata must be an even-length 0x-prefixed hex string' ||
    message === 'Network payload is invalid' ||
    message === 'Approval request not found' ||
    message === 'Approval request has expired' ||
    message === 'Unknown chain. Use wallet_addEthereumChain first.' ||
    message.startsWith('Site not connected:') ||
    message.startsWith('Unsupported dApp method:') ||
    message === 'Origin must be a valid http(s) URL' ||
    message === 'Requested from account is not permitted for this site' ||
    message === 'Requested pq sender does not match the unlocked wallet' ||
    message === 'Bitcoin recipient network does not match sender network' ||
    message === 'Bitcoin key is not available for this account' ||
    message === 'No Bitcoin address is available for this account' ||
    message === 'Insufficient BTC balance' ||
    message === 'Insufficient balance for amount and fees.' ||
    message === 'tron_sendTrc20Transfer requires a transfer object' ||
    message === 'shella_sendErc20Transfer requires a transfer object' ||
    message.endsWith('must be a valid hex or decimal quantity') ||
    message.startsWith('Token amount must have at most') ||
    message.endsWith('is required') ||
    message.endsWith('must be a valid number')
  ) {
    return message;
  }

  if (
    lowerMessage.includes('account sequence mismatch') ||
    lowerMessage.includes('incorrect account sequence') ||
    lowerMessage.includes('sequence mismatch') ||
    lowerMessage.includes('wrong sequence') ||
    lowerMessage.includes('seqno mismatch') ||
    lowerMessage.includes('invalid seqno') ||
    lowerMessage.includes('seqno is too old')
  ) {
    return 'Transaction nonce changed. Refresh wallet state and try again.';
  }

  if (
    lowerMessage.includes('insufficient funds') ||
    lowerMessage.includes('insufficient balance') ||
    lowerMessage.includes('not enough funds') ||
    lowerMessage.includes('not enough balance')
  ) {
    return 'Insufficient balance for amount and fees.';
  }

  if (
    lowerMessage.includes('already in mempool') ||
    lowerMessage.includes('already known') ||
    lowerMessage.includes('tx already exists') ||
    lowerMessage.includes('transaction already exists')
  ) {
    return 'Transaction may already be broadcast. Check history before retrying.';
  }

  if (
    lowerMessage.includes('failed to serialize') ||
    lowerMessage.includes('serialization failed') ||
    lowerMessage.includes('invalid transaction bytes') ||
    lowerMessage.includes('invalid boc')
  ) {
    return 'Transaction could not be serialized. Check transaction details and try again.';
  }

  if (message.startsWith('rpc request failed:') || message.startsWith('tron rpc request failed:') || message.startsWith('solana rpc request failed:') || message.startsWith('bitcoin rpc request failed:') || message.startsWith('cosmos rpc request failed:') || message.startsWith('cosmos account request failed:') || message.startsWith('cosmos broadcast request failed:') || message.startsWith('cosmos simulate request failed:') || message.startsWith('cosmos tx status request failed:') || message.startsWith('ton rpc request failed:') || message.startsWith('aptos rpc request failed:') || message.startsWith('aptos account request failed:') || message.startsWith('aptos gas price request failed:') || message.startsWith('aptos broadcast request failed:') || message.startsWith('aptos tx status request failed:') || message.startsWith('TON RPC failed:') || message.startsWith('Tron broadcast failed:') || message.startsWith('TRC20 constant call failed:') || message.startsWith('[')) {
    return 'RPC request failed. Check network settings and try again.';
  }

  return 'Wallet operation failed.';
}
