/**
 * Shella Wallet — background service worker.
 * Handles wallet state, signing requests, and RPC proxying.
 */

import { initStore } from './store.js';

chrome.runtime.onInstalled.addListener(() => {
  initStore();
  console.log('[Shella] background service worker installed');
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.type) {
    case 'CREATE_WALLET':
      handleCreateWallet().then(sendResponse);
      return true;
    case 'IMPORT_KEYSTORE':
      // handled in popup flow
      sendResponse({ ok: true });
      break;
    case 'GET_ACCOUNTS':
      getStoredAccounts().then(sendResponse);
      return true;
    default:
      sendResponse({ error: 'unknown message type' });
  }
});

async function handleCreateWallet(): Promise<{ address: string }> {
  const { ml_dsa65 } = await import('@noble/post-quantum/ml-dsa');
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const { secretKey, publicKey } = ml_dsa65.keygen(seed);
  // Derive Shell address: keccak256(publicKey)[12..] with 0xPQ prefix
  const address = await deriveAddress(publicKey);
  await chrome.storage.local.set({ accounts: [address], sk: Array.from(secretKey) });
  return { address };
}

async function deriveAddress(pubkey: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', pubkey);
  const bytes = new Uint8Array(hash).slice(12);
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getStoredAccounts(): Promise<string[]> {
  const { accounts } = await chrome.storage.local.get('accounts');
  return accounts ?? [];
}
