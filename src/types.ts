export interface Network {
  name: string;
  chainId: number;
  rpcUrl: string;
}

export interface StoredAccount {
  pqAddress: string;
  hexAddress: string;
  keystoreJson: string;
}

export type WalletTxStatus = 'pending' | 'confirmed' | 'failed';

export interface WalletTxRecord {
  txHash: string;
  from: string;
  to: string;
  value: string;
  data?: string;
  nonce?: number;
  createdAt: number;
  updatedAt: number;
  status: WalletTxStatus;
  error?: string;
  blockNumber?: string | null;
  source: 'local' | 'remote';
}

export interface WalletState {
  accounts: StoredAccount[];
  network: Network;
  autoLockMinutes: number;
  connectedSites: string[];
  txQueue: WalletTxRecord[];
}

export interface SessionState {
  unlockedPqAddress: string;
  unlockedAt: number;
}

export interface WalletSnapshot {
  locked: boolean;
  wallet: WalletState;
  primaryAccount: StoredAccount | null;
  balance: {
    raw: string;
    formatted: string;
  } | null;
  nonce: number | null;
  detectedChainId: number | null;
}

export interface SendTransactionParams {
  to: string;
  value: string;
  data?: string;
  gasLimit?: number;
  maxFeePerGas?: number;
  maxPriorityFeePerGas?: number;
}
