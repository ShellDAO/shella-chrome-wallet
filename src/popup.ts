/**
 * Shella Wallet — popup entry point.
 * Renders the wallet UI inside the Chrome extension popup.
 */

import { getAccounts, getNetwork } from './store.js';

async function main() {
  const app = document.getElementById('app');
  if (!app) return;

  const [accounts, network] = await Promise.all([getAccounts(), getNetwork()]);

  if (accounts.length === 0) {
    app.innerHTML = `
      <div class="welcome">
        <h1>Shella Wallet</h1>
        <p>Post-quantum wallet for Shell Chain</p>
        <button id="create-btn">Create Wallet</button>
        <button id="import-btn">Import Keystore</button>
      </div>
    `;
    document.getElementById('create-btn')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'CREATE_WALLET' });
    });
    document.getElementById('import-btn')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'IMPORT_KEYSTORE' });
    });
    return;
  }

  const address = accounts[0];
  app.innerHTML = `
    <div class="wallet">
      <div class="network">${network.name} (chainId: ${network.chainId})</div>
      <div class="address" title="${address}">${address.slice(0, 10)}…${address.slice(-8)}</div>
      <button id="send-btn">Send</button>
      <button id="receive-btn">Receive</button>
    </div>
  `;
}

main().catch(console.error);
