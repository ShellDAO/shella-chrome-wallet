export type ChainKind = 'shell' | 'evm' | 'tron' | 'solana' | 'bitcoin' | 'cosmos' | 'ton' | 'aptos';
export type ChainAddressKey = ChainKind | 'bitcoinTestnet';
export type AccountSourceKind = 'hd' | 'imported-keystore' | 'imported-private-key' | 'hardware-future';
export type SignatureScheme = 'ml-dsa-65' | 'ed25519' | 'secp256k1' | 'bitcoin-schnorr-or-ecdsa' | 'tron-secp256k1';

export interface MultichainAddress {
  addressKey: ChainAddressKey;
  chainKind: ChainKind;
  address: string;
  derivationPath?: string | null;
  publicKey?: string | null;
  signatureScheme: SignatureScheme;
  isShellAuthority: boolean;
}

export interface ChainCapabilities {
  readBalance: boolean;
  signTransactions: boolean;
  nativeTransfers: boolean;
  tokenTransfers: boolean;
  dappProvider: boolean;
  smartContracts: boolean;
  accountNonce: boolean;
  utxo: boolean;
}

export interface BitcoinTxInput {
  txid: string;
  vout: number;
  valueSats: string;
  confirmed: boolean;
}

export interface BitcoinUtxoPreference {
  key: string;
  label?: string;
  locked?: boolean;
  updatedAt: number;
}

export interface BitcoinTransferPreview {
  amountSats: string;
  feeSats: string;
  feeRateSatVb: number;
  inputCount: number;
  inputs: BitcoinTxInput[];
  inputTotalSats: string;
  changeSats: string;
  dustSats: string;
  estimatedVbytes: number;
  rbfEnabled: boolean;
}

export interface CosmosDenomBalance {
  denom: string;
  amount: string;
  formatted: string;
  symbol: string;
  decimals: number;
  isNative: boolean;
}

export interface CosmosStakingPosition {
  validatorAddress: string;
  validatorMoniker: string;
  amount: string;
  formatted: string;
  denom: string;
  symbol: string;
  decimals: number;
}

export interface CosmosRedelegationEntry {
  sourceValidatorAddress: string;
  destinationValidatorAddress: string;
  creationHeight: string;
  completionTime: string;
  balance: string;
  formatted: string;
  denom: string;
  symbol: string;
  decimals: number;
}

export interface CosmosValidatorSummary {
  validatorAddress: string;
  moniker: string;
  status: string;
  jailed: boolean;
  commissionRate: string;
  commissionPercent: string;
  maxCommissionRate: string;
  maxCommissionPercent: string;
  maxCommissionChangeRate: string;
  maxCommissionChangePercent: string;
  votingPower: string;
  delegatorShares: string;
  minSelfDelegation: string;
  consensusAddress: string;
  missedBlocksCounter: string;
  jailedUntil: string;
  tombstoned: boolean;
  riskFlags: string[];
}

export interface CosmosGovernanceProposal {
  id: string;
  title: string;
  summary: string;
  status: string;
  submitTime: string;
  depositEndTime: string;
  votingStartTime: string;
  votingEndTime: string;
  totalDeposit: string;
  quorum: string;
  threshold: string;
  vetoThreshold: string;
  riskFlags: string[];
  riskSummary: string;
  yesVotes: string;
  noVotes: string;
  abstainVotes: string;
  noWithVetoVotes: string;
  voterVoteOption: string;
  voterVoteWeight: string;
  voterVoteMetadata: string;
}

export interface CosmosIbcDenomTrace {
  denom: string;
  hash: string;
  path: string;
  baseDenom: string;
  riskFlags: string[];
}

export interface CosmosIbcRoutePreset {
  id: string;
  label: string;
  sourceChainId: number;
  destinationChainId: number;
  destinationName: string;
  channel: string;
  port: string;
  receiverPrefix: string;
  memoTemplate: string;
  riskFlags: string[];
}

export interface CosmosIbcContext {
  routes: CosmosIbcRoutePreset[];
  denomTraces: CosmosIbcDenomTrace[];
}

export interface Network {
  name: string;
  chainId: number;
  rpcUrl: string;
  kind?: ChainKind;
  symbol?: string;
  rpcProvenance?: 'owned' | 'official-public' | 'third-party-public' | 'user-custom';
  addressPrefix?: string;
  nativeDenom?: string;
  nativeDecimals?: number;
}

export interface StoredAccount {
  accountId?: string;
  displayName?: string;
  sourceKind?: AccountSourceKind;
  primaryAddress?: string;
  addresses?: MultichainAddress[];
  pqAddress: string;
  keystoreJson: string;
  chainAddresses?: Partial<Record<ChainAddressKey, string>>;
  derivationIndex?: number;
}

export interface PendingKeyRotation {
  txHash: string;
  pqAddress: string;
  keystoreJson: string;
  createdAt: number;
}

export interface ConnectedSitePermission {
  origin: string;
  accounts: string[];
  accountIds?: string[];
  chainId: number;
  grantedAt: number;
  lastUsedAt: number;
}

export interface WalletConnectSession {
  topic: string;
  origin: string;
  accounts: string[];
  chainIds: number[];
  methods: string[];
  grantedAt: number;
  lastUsedAt: number;
  expiresAt: number;
}

export interface TonConnectFeature {
  name: string;
  maxMessages?: number;
  types?: string[];
}

export interface TonConnectSession {
  clientId: string;
  origin: string;
  manifestUrl: string;
  account: string;
  chainId: number;
  network: 'mainnet' | 'testnet';
  walletPublicKey?: string;
  features: TonConnectFeature[];
  grantedAt: number;
  lastUsedAt: number;
  expiresAt: number;
}

export interface WalletConnectNamespaceProposal {
  chains?: string[];
  methods: string[];
  events?: string[];
}

export interface WalletConnectApprovedNamespace {
  accounts: string[];
  methods: string[];
  events: string[];
}

export interface WalletConnectProposalPreview {
  origin: string;
  chainIds: number[];
  methods: string[];
  namespaces: Record<string, WalletConnectApprovedNamespace>;
}

export interface WalletConnectPairing {
  topic: string;
  uri: string;
  relayProtocol: string;
  symKey: string;
  createdAt: number;
  expiresAt: number;
}

export interface WalletConnectRelayStatus {
  initialized: boolean;
  connected: boolean;
  relayUrl: string | null;
  projectIdConfigured: boolean;
  lastError: string | null;
}

export interface WalletConnectConfig {
  projectId: string;
  relayUrl: string;
}

export interface WatchedToken {
  chainKind: ChainKind;
  chainId: number;
  contractAddress: string;
  symbol: string;
  decimals: number;
  addedAt: number;
  hidden?: boolean;
}

export interface PortfolioAsset {
  chainKind: ChainKind;
  chainId: number;
  networkName: string;
  address: string;
  assetType: 'native' | 'token' | 'cosmos-denom';
  symbol: string;
  name?: string | null;
  contractAddress?: string | null;
  rawBalance: string | null;
  formattedBalance: string | null;
  decimals: number;
  status: 'ok' | 'unavailable';
  error?: string | null;
}

export interface PortfolioNetworkAsset {
  chainKind: ChainKind;
  chainId: number;
  networkName: string;
  rpcProvenance: NonNullable<Network['rpcProvenance']>;
  address: string | null;
  symbol: string;
  nativeAsset: PortfolioAsset | null;
  watchedTokenCount: number;
  status: 'ok' | 'stale' | 'unavailable';
  error?: string | null;
  updatedAt: number;
}

export interface PortfolioSnapshot {
  accountId: string | null;
  generatedAt: number;
  networks: PortfolioNetworkAsset[];
}

export interface UnifiedDappSession {
  id: string;
  kind: 'connected-site' | 'walletconnect' | 'tonconnect';
  origin: string;
  protocol: 'EIP-1193' | 'WalletConnect' | 'TonConnect';
  accounts: string[];
  chains: string[];
  methods: string[];
  grantedAt: number;
  lastUsedAt: number;
  expiresAt: number | null;
  riskFlags: string[];
}

export interface DappSessionsSnapshot {
  generatedAt: number;
  sessions: UnifiedDappSession[];
}

export interface ApprovalRiskSummary {
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  riskSummary: string;
  riskFlags: string[];
  displayRows: Array<{ label: string; value: string }>;
}

export type WalletTxStatus = 'pending' | 'confirmed' | 'failed';

export interface WalletTxRecord {
  txHash: string;
  chainKind?: ChainKind;
  from: string;
  to: string | null;
  value: string;
  data?: string;
  nonce?: number;
  createdAt: number;
  updatedAt: number;
  status: WalletTxStatus;
  error?: string;
  blockNumber?: string | null;
  source: 'local' | 'remote';
  /** tx_type value (0x2 = standard, 0x7e = AA batch) */
  txType?: string;
  /** Product-level Shell RPC type, e.g. transfer, aaBatch, blockGasReward. */
  shellType?: string | null;
  /** System reward kind when this is a reward transaction. */
  rewardKind?: string | null;
  /** STARK layer for prover rewards, hex encoded by RPC. */
  rewardLayer?: string | null;
  /** Block/range/artifact hash used to derive a system reward. */
  rewardSourceHash?: string | null;
  /** Original byte size used for STARK compression accounting. */
  originalSize?: string | null;
  /** Compressed byte size used for STARK compression accounting. */
  compressedSize?: string | null;
  /** Decoded proof amendment payload for starkReward txs (v0.22+). */
  decodedInput?: {
    layer: number;
    blockNumber: number;
    startBlock: number;
    endBlock: number;
    nSigs: number;
    compressedSize: number;
    originalSize: number;
    settlementTxHash?: string | null;
  } | null;
  /** Paymaster address if this was a sponsored tx */
  paymaster?: string | null;
  /** Number of inner calls if this is an AA batch tx */
  innerCallCount?: number | null;
  /** Token contract address for token transfers on non-native assets. */
  tokenContract?: string | null;
  /** Token symbol, when known. */
  tokenSymbol?: string | null;
  /** Token decimal precision, when known. */
  tokenDecimals?: number | null;
  /** Bitcoin opt-in Replace-By-Fee marker, when known. */
  rbfEnabled?: boolean | null;
  /** Bitcoin inputs used by a local transaction, retained for RBF fee bump. */
  bitcoinInputs?: BitcoinTxInput[] | null;
  /** Spendable unconfirmed Bitcoin output from a remote incoming tx, used for receiver-side CPFP. */
  bitcoinCpfpInput?: BitcoinTxInput | null;
  bitcoinFeeSats?: string | null;
  bitcoinChangeSats?: string | null;
  bitcoinFeeRateSatVb?: number | null;
  bitcoinVbytes?: number | null;
  replacedByTxHash?: string | null;
  replacesTxHash?: string | null;
  cpfpParentTxHash?: string | null;
  cpfpParentTxHashes?: string[] | null;
  cpfpChildTxHash?: string | null;
  cpfpTargetFeeRateSatVb?: number | null;
  cpfpPackageFeeRateSatVb?: number | null;
  cpfpAncestorCount?: number | null;
  cpfpDescendantCount?: number | null;
  /** Cosmos SDK fee in uatom, when known for a local transfer. */
  cosmosFeeUatom?: string | null;
  /** Cosmos SDK gas limit used for a local transfer. */
  cosmosGasLimit?: string | null;
  /** Cosmos SDK account number used in SIGN_MODE_DIRECT. */
  cosmosAccountNumber?: string | null;
  /** Cosmos SDK memo attached to a local transfer, including IBC route memo JSON. */
  cosmosMemo?: string | null;
  /** Aptos max gas amount used by a local transfer. */
  aptosMaxGasAmount?: string | null;
  /** Aptos gas unit price used by a local transfer. */
  aptosGasUnitPrice?: string | null;
  /** Aptos expiration timestamp seconds used by a local transfer. */
  aptosExpirationTimestampSecs?: string | null;
}

export interface WalletState {
  accountModelVersion?: 2;
  accounts: StoredAccount[];
  network: Network;
  autoLockMinutes: number;
  connectedSites: ConnectedSitePermission[];
  walletConnectConfig: WalletConnectConfig;
  walletConnectSessions: WalletConnectSession[];
  tonConnectSessions: TonConnectSession[];
  walletConnectPairings: WalletConnectPairing[];
  txQueue: WalletTxRecord[];
  watchedTokens: WatchedToken[];
  bitcoinUtxoPreferences: BitcoinUtxoPreference[];
}

export interface SessionState {
  unlockedPqAddress: string;
  unlockedAt: number;
}

export interface WalletSnapshot {
  locked: boolean;
  wallet: WalletState;
  primaryAccount: StoredAccount | null;
  activeAccountId?: string | null;
  activeMultichainAccount?: StoredAccount | null;
  activeAddress: string | null;
  activeChainKind: ChainKind;
  balance: {
    raw: string;
    formatted: string;
  } | null;
  cosmosBalances?: CosmosDenomBalance[] | null;
  cosmosStaking?: CosmosStakingPosition[] | null;
  cosmosRedelegations?: CosmosRedelegationEntry[] | null;
  cosmosValidators?: CosmosValidatorSummary[] | null;
  cosmosGovernanceProposals?: CosmosGovernanceProposal[] | null;
  cosmosIbcContext?: CosmosIbcContext | null;
  nonce: number | null;
  detectedChainId: number | null;
  nodeInfo?: WalletNodeInfo | null;
  portfolioAssets?: PortfolioAsset[];
  portfolioSnapshot?: PortfolioSnapshot | null;
}

/**
 * Node connection info returned by background's `getNodeInfo` message.
 * Mirrors ShellNodeInfo from shell-sdk.
 */
export interface WalletNodeInfo {
  version: string;
  chain_id: string;
  block_height: number;
  peer_count: number;
  storage_profile?: 'archive' | 'full' | 'light';
}

export interface SendTransactionParams {
  to: string | null;
  value: string;
  data?: string;
  gasLimit?: number;
  maxFeePerGas?: number;
  maxPriorityFeePerGas?: number;
  feeRateSatVb?: number;
  bitcoinInputs?: BitcoinTxInput[];
  cosmosMemo?: string;
  expectedChainId?: number;
}

export interface DappRequestMessage {
  origin: string;
  method: string;
  params?: unknown[];
  interactive?: boolean;
}

/** Represents one inner call inside an AA batch tx approval request. */
export interface AaBatchInnerCall {
  to: string;
  value: string;
  data: string;
  /** Gas limit — may be a decimal number or a hex string (0x…) from the SDK. */
  gas_limit: number | string;
}

export interface ApprovalRequest {
  id: string;
  kind: 'connect' | 'add-chain' | 'switch-chain' | 'send-transaction' | 'sign-message' | 'sign-typed-data' | 'walletconnect-proposal' | 'tonconnect-proposal' | 'tonconnect-request' | 'cosmos-sign-direct' | 'cosmos-sign-amino' | 'aptos-sign-transaction';
  origin: string;
  createdAt: number;
  payload: Record<string, unknown>;
}
