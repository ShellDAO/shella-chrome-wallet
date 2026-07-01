/**
 * Tests for the popup module — utility functions and view rendering.
 * Mocks chrome.runtime and a minimal DOM to let popup.js boot and render.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test, before } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Minimal DOM mock ──────────────────────────────────────────────────────────

const domElements = new Map();

function makeEl(id = '') {
  return {
    id,
    innerHTML: '',
    textContent: '',
    className: '',
    style: { display: '' },
    value: '',
    files: null,
    children: [],
    _listeners: {},
    addEventListener(ev, fn) { this._listeners[ev] = fn; },
    appendChild(child) {
      this.children.push(child);
      if (child.id) domElements.set(child.id, child);
      this.innerHTML += child.id
        ? `<div id="${child.id}" class="${child.className ?? ''}">${child.innerHTML ?? ''}</div>`
        : (child.innerHTML ?? '');
    },
    dispatchEvent() {},
  };
}

const appEl = makeEl('app');
const toastEl = makeEl('toast');
domElements.set('app', appEl);
domElements.set('toast', toastEl);

globalThis.document = {
  getElementById: (id) => domElements.get(id) ?? null,
  querySelectorAll: () => [],
  createElement: () => ({
    style: {}, href: '', download: '', tagName: 'a',
    click() {}, select() {}, value: '',
    addEventListener() {},
    appendChild() {},
  }),
  body: { appendChild() {}, removeChild() {} },
};

globalThis.window = {
  location: { search: '' },
  close() {},
};

Object.defineProperty(globalThis, 'navigator', {
  value: { clipboard: { writeText: async () => {} } },
  writable: true,
  configurable: true,
});
globalThis.URL = { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} };
globalThis.Blob = class Blob {};

// ── Chrome mock ───────────────────────────────────────────────────────────────

const noWalletSnapshot = {
  locked: false,
  wallet: {
    network: { name: 'Shell Devnet', chainId: 424242, rpcUrl: 'http://127.0.0.1:8545' },
    accounts: [],
    autoLockMinutes: 15,
    connectedSites: [],
    walletConnectConfig: { projectId: '', relayUrl: '' },
    walletConnectPairings: [],
    txQueue: [],
  },
  primaryAccount: null,
  balance: null,
  nonce: null,
  detectedChainId: null,
};

globalThis.chrome = {
  runtime: {
    sendMessage(msg, cb) {
      if (msg.type === 'GET_WALLET_SNAPSHOT') {
        cb(noWalletSnapshot);
      } else if (msg.type === 'GET_WALLETCONNECT_RELAY_STATUS') {
        cb({
          initialized: false,
          connected: false,
          relayUrl: null,
          projectIdConfigured: false,
          lastError: null,
        });
      } else {
        cb({ ok: true });
      }
    },
    lastError: null,
  },
};

// ── Import popup (triggers boot()) ───────────────────────────────────────────

describe('popup', async () => {
  before(async () => {
    await import('../dist/popup.js');
    // Give boot() one event-loop tick to complete (sendMessage is sync in our mock)
    await new Promise((r) => setTimeout(r, 50));
  });

  test('renders welcome view when no wallet is set up', () => {
    const html = appEl.innerHTML;
    assert.ok(html.includes('Create New Wallet'), 'should show Create New Wallet button');
    assert.ok(html.includes('Import Keystore'), 'should show Import Keystore button');
    assert.ok(html.includes('Shella Wallet'), 'should show the wallet name');
  });

  test('rendered HTML contains a toast placeholder', () => {
    const html = appEl.innerHTML;
    assert.ok(html.includes('toast'), 'toast element should be present in rendered output');
  });

  test('popup view rendering uses the Trusted Types sink wrapper only', () => {
    const source = readFileSync(join(__dirname, '../src/popup.ts'), 'utf8');
    const rawInnerHtmlWrites = [...source.matchAll(/\.innerHTML\s*=/g)].length;
    assert.equal(rawInnerHtmlWrites, 1);
    assert.match(source, /function setTrustedViewHtml/);
    assert.match(source, /popupTrustedTypes\?\.createPolicy\('shella-popup'/);
  });

  test('truncate shortens long addresses with ellipsis', async () => {
    // Import the exported utility function from the popup module
    const mod = await import('../dist/popup.js');
    const { truncate } = mod;
    if (typeof truncate !== 'function') return; // not exported in this build

    const addr = 'pq1' + 'a'.repeat(60);
    const result = truncate(addr);
    assert.ok(result.includes('…'), 'truncated address should contain ellipsis');
    assert.ok(result.length < addr.length, 'truncated address should be shorter');
    assert.ok(result.startsWith('pq1'), 'should preserve beginning of address');
  });

  test('formatDisplayValue converts wei string to decimal SHELL', async () => {
    const mod = await import('../dist/popup.js');
    const { formatDisplayValue } = mod;
    if (typeof formatDisplayValue !== 'function') return;

    // 1 ETH = 1e18 wei → "1.000000"
    assert.equal(formatDisplayValue('1000000000000000000'), '1.000000');
    // 0 wei → "0.000000"
    assert.equal(formatDisplayValue('0'), '0.000000');
  });

  test('network options include Cosmos, TON, and Aptos networks', async () => {
    const mod = await import('../dist/popup.js');
    const { renderNetworkOptions } = mod;
    if (typeof renderNetworkOptions !== 'function') return;

    const html = renderNetworkOptions();
    assert.ok(html.includes('Cosmos Hub'));
    assert.ok(html.includes('value="cosmosHub"'));
    assert.ok(html.includes('value="osmosisMainnet"'));
    assert.ok(html.includes('TON'));
    assert.ok(html.includes('value="tonMainnet"'));
    assert.ok(html.includes('value="tonTestnet"'));
    assert.ok(html.includes('Aptos'));
    assert.ok(html.includes('value="aptosTestnet"'));
    assert.ok(html.includes('value="aptosDevnet"'));
    assert.equal(html.includes('value="cosmosTheta"'), false);
  });

  test('formatRpcProvenance labels endpoint ownership', async () => {
    const mod = await import('../dist/popup.js');
    const { formatRpcProvenance } = mod;
    if (typeof formatRpcProvenance !== 'function') return;

    assert.equal(formatRpcProvenance({ name: 'Shell', chainId: 1, rpcUrl: 'https://rpc.mainnet.shell.network', rpcProvenance: 'owned' }), 'Shell-owned/local RPC');
    assert.equal(formatRpcProvenance({ name: 'Solana', chainId: 103, rpcUrl: 'https://api.devnet.solana.com', rpcProvenance: 'official-public' }), 'Official public RPC');
    assert.equal(formatRpcProvenance({ name: 'Bitcoin', chainId: 8332, rpcUrl: 'https://blockstream.info/api', rpcProvenance: 'third-party-public' }), 'Third-party public RPC');
    assert.equal(formatRpcProvenance({ name: 'Custom', chainId: 1, rpcUrl: 'https://rpc.example', rpcProvenance: 'user-custom' }), 'User custom RPC');
  });

  test('wallet main view renders the upgraded action grid, chain health, and token empty state', async () => {
    const mod = await import('../dist/popup.js');
    const { __setPopupStateForTest, renderWallet } = mod;
    if (typeof __setPopupStateForTest !== 'function' || typeof renderWallet !== 'function') return;

    __setPopupStateForTest({
      pqAddress: '0x' + 'a'.repeat(64),
      balanceFormatted: '1.250000',
      detectedChainId: null,
      network: { name: 'Shell Devnet', chainId: 424242, rpcUrl: 'http://127.0.0.1:8545', kind: 'shell', symbol: 'SHELL', rpcProvenance: 'owned' },
      activeAccountId: 'hd:0',
      accounts: [{
        accountId: 'hd:0',
        displayName: 'Account 1',
        primaryAddress: '0x' + 'a'.repeat(64),
        pqAddress: '0x' + 'a'.repeat(64),
        keystoreJson: '{}',
        addresses: [{
          addressKey: 'shell',
          chainKind: 'shell',
          address: '0x' + 'a'.repeat(64),
          signatureScheme: 'ml-dsa-65',
          isShellAuthority: true,
        }],
      }],
      watchedTokens: [{
        chainKind: 'shell',
        chainId: 424242,
        contractAddress: '0x' + 'b'.repeat(20),
        symbol: 'HIDE',
        decimals: 18,
        addedAt: 1,
        hidden: true,
      }],
      tokenBalances: {},
      portfolioAssets: [
        {
          chainKind: 'shell',
          chainId: 424242,
          networkName: 'Shell Devnet',
          address: '0x' + 'a'.repeat(64),
          assetType: 'native',
          symbol: 'SHELL',
          name: 'Shell Devnet',
          contractAddress: null,
          rawBalance: '1250000000000000000',
          formattedBalance: '1.250000',
          decimals: 18,
          status: 'ok',
          error: null,
        },
      ],
      portfolioSnapshot: {
        accountId: 'hd:0',
        generatedAt: Date.UTC(2026, 5, 28, 3, 12, 0),
        networks: [
          {
            chainKind: 'shell',
            chainId: 424242,
            networkName: 'Shell Devnet',
            rpcProvenance: 'owned',
            address: '0x' + 'a'.repeat(64),
            symbol: 'SHELL',
            nativeAsset: {
              chainKind: 'shell',
              chainId: 424242,
              networkName: 'Shell Devnet',
              address: '0x' + 'a'.repeat(64),
              assetType: 'native',
              symbol: 'SHELL',
              name: 'Shell Devnet',
              contractAddress: null,
              rawBalance: '1250000000000000000',
              formattedBalance: '1.250000',
              decimals: 18,
              status: 'ok',
              error: null,
            },
            watchedTokenCount: 1,
            status: 'ok',
            error: null,
            updatedAt: Date.UTC(2026, 5, 28, 3, 12, 0),
          },
          {
            chainKind: 'aptos',
            chainId: 2,
            networkName: 'Aptos Testnet',
            rpcProvenance: 'official-public',
            address: '0x' + '1'.repeat(64),
            symbol: 'APT',
            nativeAsset: null,
            watchedTokenCount: 0,
            status: 'unavailable',
            error: 'Balance request timed out',
            updatedAt: Date.UTC(2026, 5, 28, 3, 12, 0),
          },
        ],
      },
      txQueue: [],
      nodeInfo: null,
    });

    const html = renderWallet();
    assert.ok(html.includes('action-grid'));
    assert.ok(html.includes('Chain health'));
    assert.ok(html.includes('Chain health needs attention') || html.includes('RPC status pending'));
    assert.ok(html.includes('section-header-title'));
    assert.ok(html.includes('Portfolio Guard'));
    assert.ok(html.includes('1/2 online'));
    assert.ok(html.includes('btn-refresh-portfolio'));
    assert.ok(html.includes('Shell Devnet'));
    assert.ok(html.includes('Aptos Testnet'));
    assert.ok(html.includes('Balance request timed out'));
    assert.ok(html.includes('Assets'));
    assert.ok(html.includes('portfolio-assets'));
    assert.ok(html.includes('No ERC20 tokens added'));
    assert.ok(html.includes('Hidden ERC20 (1)'));
    assert.ok(html.includes('btn-token-show'));
    assert.ok(html.includes('Copy'));
  });

  test('wallet main view shows portfolio not-checked state without cached snapshot', async () => {
    const mod = await import('../dist/popup.js');
    const { __setPopupStateForTest, renderWallet } = mod;
    if (typeof __setPopupStateForTest !== 'function' || typeof renderWallet !== 'function') return;

    __setPopupStateForTest({
      pqAddress: '0x' + 'a'.repeat(64),
      balanceFormatted: '1.250000',
      detectedChainId: 424242,
      network: { name: 'Shell Devnet', chainId: 424242, rpcUrl: 'http://127.0.0.1:8545', kind: 'shell', symbol: 'SHELL', rpcProvenance: 'owned' },
      accounts: [],
      watchedTokens: [],
      portfolioAssets: [],
      portfolioSnapshot: null,
      portfolioRefreshing: false,
      portfolioRefreshError: '',
      txQueue: [],
      nodeInfo: null,
    });

    const html = renderWallet();
    assert.ok(html.includes('Portfolio Guard'));
    assert.ok(html.includes('Not checked yet'));
    assert.ok(html.includes('btn-refresh-portfolio'));
  });

  test('locked view uses accountId-first selector while preserving Shell PQ root label', async () => {
    const mod = await import('../dist/popup.js');
    const { __setPopupStateForTest, renderLocked } = mod;
    if (typeof __setPopupStateForTest !== 'function' || typeof renderLocked !== 'function') return;

    __setPopupStateForTest({
      pqAddress: '0x' + 'a'.repeat(64),
      activeAccountId: 'hd:1',
      accounts: [{
        accountId: 'hd:0',
        displayName: 'Trading',
        primaryAddress: '0x' + 'a'.repeat(64),
        pqAddress: '0x' + 'a'.repeat(64),
        keystoreJson: '{}',
      }, {
        accountId: 'hd:1',
        displayName: 'Vault',
        primaryAddress: '0x' + 'c'.repeat(64),
        pqAddress: '0x' + 'c'.repeat(64),
        keystoreJson: '{}',
      }],
    });

    const html = renderLocked();
    assert.ok(html.includes('value="hd:0"'));
    assert.ok(html.includes('value="hd:1"'));
    assert.ok(html.includes('data-address="0x'));
    assert.ok(html.includes('Vault'));
    assert.ok(html.includes('selected'));
  });

  test('accounts view renders multichain account identity without replacing Shell PQ root', async () => {
    const mod = await import('../dist/popup.js');
    const { __setPopupStateForTest, renderAccounts } = mod;
    if (typeof __setPopupStateForTest !== 'function' || typeof renderAccounts !== 'function') return;

    __setPopupStateForTest({
      pqAddress: '0x' + 'a'.repeat(64),
      activeAccountId: 'hd:0',
      network: { name: 'Tron Nile', chainId: 3448148188, rpcUrl: 'https://nile.trongrid.io', kind: 'tron', symbol: 'TRX', rpcProvenance: 'official-public' },
      accounts: [{
        accountId: 'hd:0',
        displayName: 'Trading',
        primaryAddress: '0x' + 'a'.repeat(64),
        pqAddress: '0x' + 'a'.repeat(64),
        keystoreJson: '{}',
        addresses: [
          { addressKey: 'shell', chainKind: 'shell', address: '0x' + 'a'.repeat(64), signatureScheme: 'ml-dsa-65', isShellAuthority: true },
          { addressKey: 'tron', chainKind: 'tron', address: 'TWallet111111111111111111111111111111', signatureScheme: 'tron-secp256k1', isShellAuthority: false },
        ],
      }, {
        accountId: 'hd:1',
        displayName: 'Vault',
        primaryAddress: '0x' + 'c'.repeat(64),
        pqAddress: '0x' + 'c'.repeat(64),
        keystoreJson: '{}',
        addresses: [{ addressKey: 'shell', chainKind: 'shell', address: '0x' + 'c'.repeat(64), signatureScheme: 'ml-dsa-65', isShellAuthority: true }],
      }],
    });

    const html = renderAccounts();
    assert.ok(html.includes('Trading'));
    assert.ok(html.includes('hd:0'));
    assert.ok(html.includes('Shell/PQ root'));
    assert.ok(html.includes('PQ authority'));
    assert.ok(html.includes('Current tron'));
    assert.ok(html.includes('data-account-id="hd:1"'));
  });

  test('send view separates Basic, Fees & Advanced, and Chain Preview sections', async () => {
    const mod = await import('../dist/popup.js');
    const { __setPopupStateForTest, renderSend } = mod;
    if (typeof __setPopupStateForTest !== 'function' || typeof renderSend !== 'function') return;

    __setPopupStateForTest({
      pqAddress: 'tb1qwallet',
      sendTo: 'tb1qrecipient',
      sendValue: '0.01',
      sendBitcoinFeePreset: 'custom',
      sendBitcoinFeeRate: '12',
      sendPreview: {
        amountSats: '1000000',
        feeSats: '1200',
        feeRateSatVb: 12,
        inputCount: 1,
        inputs: [{ txid: 'b'.repeat(64), vout: 0, valueSats: '1001200', confirmed: true }],
        inputTotalSats: '1001200',
        changeSats: '0',
        dustSats: '0',
        estimatedVbytes: 100,
        rbfEnabled: true,
      },
      bitcoinUtxoPreferences: [],
      sendBitcoinSelectedInputs: ['b'.repeat(64) + ':0'],
      network: { name: 'Bitcoin Testnet', chainId: 18332, rpcUrl: 'https://blockstream.info/testnet/api', kind: 'bitcoin', symbol: 'BTC', rpcProvenance: 'third-party-public' },
      detectedChainId: 18332,
    });

    const html = renderSend();
    assert.ok(html.includes('data-section="send-basic"'));
    assert.ok(html.includes('Fees & Advanced'));
    assert.ok(html.includes('Chain Preview'));
    assert.ok(html.includes('send-preview-panel'));
    assert.ok(html.includes('send-fee-rate'));
    assert.ok(html.includes('btn-preview-send'));
  });

  test('approval view renders origin, summary, details, and sticky approve controls', async () => {
    const mod = await import('../dist/popup.js');
    const { __setPopupStateForTest, renderApprovalRequest } = mod;
    if (typeof __setPopupStateForTest !== 'function' || typeof renderApprovalRequest !== 'function') return;

    __setPopupStateForTest({
      approvalRequest: {
        id: 'approval-1',
        origin: 'https://dapp.example',
        kind: 'send-transaction',
        createdAt: Date.now(),
        payload: {
          account: '0x' + 'a'.repeat(64),
          to: '0x' + 'b'.repeat(64),
          value: '1000000000000000000',
          chainKind: 'shell',
          chainId: 424242,
          approvalRisk: {
            riskLevel: 'medium',
            riskSummary: 'This transaction includes contract calldata.',
            riskFlags: ['calldata-present'],
            displayRows: [{ label: 'Origin', value: 'https://dapp.example' }],
          },
        },
      },
    });

    const html = renderApprovalRequest();
    assert.ok(html.includes('approval-hero'));
    assert.ok(html.includes('https://dapp.example'));
    assert.ok(html.includes('approval-summary-grid'));
    assert.ok(html.includes('This transaction includes contract calldata.'));
    assert.ok(html.includes('Risk medium'));
    assert.ok(html.includes('approval-details'));
    assert.ok(html.includes('sticky-actions approval-actions'));
    assert.ok(html.includes('btn-approval-approve'));
    assert.ok(html.includes('btn-approval-reject'));
  });

  test('approval view requires explicit confirmation for high-risk requests', async () => {
    const mod = await import('../dist/popup.js');
    const { __setPopupStateForTest, renderApprovalRequest } = mod;
    if (typeof __setPopupStateForTest !== 'function' || typeof renderApprovalRequest !== 'function') return;

    __setPopupStateForTest({
      approvalRequest: {
        id: 'approval-risky',
        origin: 'https://spender.example',
        kind: 'send-transaction',
        createdAt: Date.now(),
        payload: {
          account: '0x' + 'a'.repeat(64),
          to: '0x' + 'b'.repeat(64),
          value: '0',
          chainKind: 'shell',
          chainId: 424242,
          approvalRisk: {
            riskLevel: 'high',
            riskSummary: 'This grants an unlimited token approval.',
            riskFlags: ['unlimited-token-approval'],
            displayRows: [{ label: 'Approval spender', value: '0x' + 'b'.repeat(64) }],
          },
        },
      },
    });

    const html = renderApprovalRequest();
    assert.ok(html.includes('Risk high'));
    assert.ok(html.includes('risk-confirmation'));
    assert.ok(html.includes('approval-risk-confirm'));
    assert.ok(html.includes('btn-approval-approve" class="btn-primary" disabled'));
    assert.ok(html.includes('Approve risky request'));
  });

  test('settings view groups Network, Security, Connected dApps, WalletConnect, and Danger Zone', async () => {
    const mod = await import('../dist/popup.js');
    const { __setPopupStateForTest, renderSettings } = mod;
    if (typeof __setPopupStateForTest !== 'function' || typeof renderSettings !== 'function') return;

    __setPopupStateForTest({
      connectedSites: [{
        origin: 'https://dapp.example',
        accounts: ['0x' + 'a'.repeat(64)],
        chainId: 424242,
        grantedAt: Date.now(),
        lastUsedAt: Date.now(),
      }],
      walletConnectSessions: [{
        topic: 'wc-topic',
        origin: 'https://wc.example',
        accounts: ['eip155:424242:0x' + 'a'.repeat(64)],
        chainIds: [424242],
        methods: ['eth_chainId'],
        grantedAt: Date.now(),
        lastUsedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      }],
      tonConnectSessions: [{
        clientId: 'ton-client',
        origin: 'https://ton.example',
        manifestUrl: 'https://ton.example/tonconnect-manifest.json',
        account: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c',
        chainId: 607,
        network: 'mainnet',
        features: [{ name: 'SendTransaction', maxMessages: 4 }],
        grantedAt: Date.now(),
        lastUsedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      }],
      dappSessions: [{
        id: 'connected-site:https://dapp.example',
        kind: 'connected-site',
        origin: 'https://dapp.example',
        protocol: 'EIP-1193',
        accounts: ['0x' + 'a'.repeat(64)],
        chains: ['Chain 424242'],
        methods: ['eth_accounts', 'eth_sendTransaction'],
        grantedAt: Date.now(),
        lastUsedAt: Date.now(),
        expiresAt: null,
        riskFlags: ['can request transactions'],
      }, {
        id: 'walletconnect:wc-topic',
        kind: 'walletconnect',
        origin: 'https://wc.example',
        protocol: 'WalletConnect',
        accounts: ['eip155:424242:0x' + 'a'.repeat(64)],
        chains: ['Chain 424242'],
        methods: ['eth_chainId', 'eth_sendTransaction'],
        grantedAt: Date.now(),
        lastUsedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        riskFlags: ['can request signing'],
      }, {
        id: 'tonconnect:ton-client',
        kind: 'tonconnect',
        origin: 'https://ton.example',
        protocol: 'TonConnect',
        accounts: ['EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c'],
        chains: ['mainnet / Chain 607'],
        methods: ['SendTransaction'],
        grantedAt: Date.now(),
        lastUsedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        riskFlags: ['can request signing'],
      }],
      walletConnectPairings: [],
      walletConnectRelayStatus: { initialized: false, projectIdConfigured: false, relayUrl: '', lastError: null },
      walletConnectProjectId: '',
      walletConnectRelayUrl: '',
      walletConnectUri: '',
      autoLockMinutes: 15,
    });

    const html = renderSettings();
    for (const label of ['Network', 'Security', 'Connected dApps', 'WalletConnect', 'Danger Zone']) {
      assert.ok(html.includes(label), `expected ${label} section`);
    }
    assert.ok(html.includes('custom-rpc-panel'));
    assert.ok(html.includes('Relay not initialized'));
    assert.ok(html.includes('https://dapp.example'));
    assert.ok(html.includes('https://wc.example'));
    assert.ok(html.includes('https://ton.example'));
    assert.ok(html.includes('EIP-1193'));
    assert.ok(html.includes('btn-dapp-session-revoke'));
    assert.ok(html.includes('can request signing'));
    assert.ok(html.includes('btn-disconnect-all-sites'));
    assert.ok(html.includes('Reset deletes local wallet data'));
  });

  test('renderAptosApprovalPayload shows auditable Aptos signing details', async () => {
    const mod = await import('../dist/popup.js');
    const { renderAptosApprovalPayload } = mod;
    if (typeof renderAptosApprovalPayload !== 'function') return;

    const html = renderAptosApprovalPayload({
      account: '0x' + '1'.repeat(64),
      chainId: 2,
      type: 'entry_function_payload',
      knownAction: 'nativeTransfer',
      riskLevel: 'low',
      riskSummary: 'Recognized native APT transfer.',
      riskFlags: ['recognized-native-transfer'],
      functionId: '0x0000000000000000000000000000000000000000000000000000000000000001::aptos_account::transfer',
      moduleAddress: '0x0000000000000000000000000000000000000000000000000000000000000001',
      moduleName: 'aptos_account',
      functionName: 'transfer',
      recipient: '0x' + '2'.repeat(64),
      amountOctas: '123456789',
      typeArguments: [],
      argumentsSummary: ['0x' + '2'.repeat(64), '123456789'],
      warnings: [],
    });

    assert.ok(html.includes('Payload type'));
    assert.ok(html.includes('entry_function_payload'));
    assert.ok(html.includes('nativeTransfer'));
    assert.ok(html.includes('Risk'));
    assert.ok(html.includes('Recognized native APT transfer.'));
    assert.ok(html.includes('recognized-native-transfer'));
    assert.ok(html.includes('aptos_account::transfer'));
    assert.ok(html.includes('Recipient'));
    assert.ok(html.includes('123456789 octas'));
  });

  test('renderAptosApprovalPayload shows unknown Aptos function args and warnings', async () => {
    const mod = await import('../dist/popup.js');
    const { renderAptosApprovalPayload } = mod;
    if (typeof renderAptosApprovalPayload !== 'function') return;

    const html = renderAptosApprovalPayload({
      account: '0x' + '1'.repeat(64),
      chainId: 240,
      type: 'script_payload',
      knownAction: 'unknown',
      riskLevel: 'critical',
      riskSummary: 'Aptos payload cannot be safely decoded.',
      riskFlags: ['unsupported-payload-type', 'invalid-entry-function'],
      functionId: 'not-a-function-id',
      moduleAddress: '',
      moduleName: '',
      typeArguments: ['0x1::aptos_coin::AptosCoin'],
      argumentsSummary: ['order-123', 'object'],
      warnings: ['Unsupported Aptos payload type: script_payload', 'Aptos entry function is missing or invalid.'],
    });

    assert.ok(html.includes('unknown'));
    assert.ok(html.includes('critical'));
    assert.ok(html.includes('Aptos payload cannot be safely decoded.'));
    assert.ok(html.includes('unsupported-payload-type, invalid-entry-function'));
    assert.ok(html.includes('0x1::aptos_coin::AptosCoin'));
    assert.ok(html.includes('Arg #1'));
    assert.ok(html.includes('order-123'));
    assert.ok(html.includes('Warning'));
    assert.ok(html.includes('Unsupported Aptos payload type: script_payload'));
  });

  test('renderAptosApprovalPayload escapes untrusted Aptos approval strings', async () => {
    const mod = await import('../dist/popup.js');
    const { renderAptosApprovalPayload } = mod;
    if (typeof renderAptosApprovalPayload !== 'function') return;

    const html = renderAptosApprovalPayload({
      account: '<img src=x onerror=alert(1)>',
      chainId: '<script>alert(1)</script>',
      type: 'entry_function_payload',
      knownAction: 'unknown',
      riskLevel: 'critical',
      riskSummary: '<b>danger</b>',
      riskFlags: ['<svg onload=alert(1)>'],
      functionId: '0x1::evil::<script>',
      moduleAddress: '<script>',
      moduleName: 'bad<img>',
      recipient: '<iframe srcdoc=x>',
      amountOctas: '<math href=javascript:alert(1)>',
      typeArguments: ['<script>alert(2)</script>'],
      argumentsSummary: ['<img src=x onerror=alert(3)>'],
      warnings: ['<script>alert(4)</script>'],
    });

    assert.equal(html.includes('<img src=x onerror=alert(1)>'), false);
    assert.equal(html.includes('<script>alert(1)</script>'), false);
    assert.equal(html.includes('<svg onload=alert(1)>'), false);
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  });

  test('summarizeCosmosValidatorRisk reports actionable validator guidance', async () => {
    const mod = await import('../dist/popup.js');
    const { summarizeCosmosValidatorRisk } = mod;
    if (typeof summarizeCosmosValidatorRisk !== 'function') return;

    const baseValidator = {
      validatorAddress: 'cosmosvaloper1validator',
      moniker: 'Validator',
      status: 'BOND_STATUS_BONDED',
      jailed: false,
      commissionRate: '0.05',
      commissionPercent: '5%',
      maxCommissionRate: '0.1',
      maxCommissionPercent: '10%',
      maxCommissionChangeRate: '0.01',
      maxCommissionChangePercent: '1%',
      votingPower: '1000000',
      delegatorShares: '1000000.000000000000000000',
      minSelfDelegation: '1000000',
      consensusAddress: 'cosmosvalcons1validator',
      missedBlocksCounter: '0',
      jailedUntil: '',
      tombstoned: false,
      riskFlags: [],
    };

    assert.deepEqual(summarizeCosmosValidatorRisk(baseValidator), {
      level: 'OK',
      guidance: 'bonded with no detected slashing or commission warnings',
    });
    assert.deepEqual(summarizeCosmosValidatorRisk({ ...baseValidator, tombstoned: true, riskFlags: ['tombstoned'] }), {
      level: 'Critical',
      guidance: 'do not delegate; validator is permanently slashed',
    });
    assert.deepEqual(summarizeCosmosValidatorRisk({ ...baseValidator, status: 'BOND_STATUS_UNBONDED', riskFlags: ['not bonded'] }), {
      level: 'High',
      guidance: 'avoid new delegation until validator is bonded',
    });
    assert.deepEqual(summarizeCosmosValidatorRisk({ ...baseValidator, riskFlags: ['high commission'] }), {
      level: 'Warning',
      guidance: 'review commission terms before delegating',
    });
  });

  test('formatCosmosProposalStatus formats governance enum labels', async () => {
    const mod = await import('../dist/popup.js');
    const { formatCosmosProposalStatus, formatCosmosVoteCount, formatCosmosVoterVote } = mod;
    if (
      typeof formatCosmosProposalStatus !== 'function' ||
      typeof formatCosmosVoteCount !== 'function' ||
      typeof formatCosmosVoterVote !== 'function'
    ) return;

    assert.equal(formatCosmosProposalStatus('PROPOSAL_STATUS_VOTING_PERIOD'), 'Voting Period');
    assert.equal(formatCosmosProposalStatus('PROPOSAL_STATUS_PASSED'), 'Passed');
    assert.equal(formatCosmosProposalStatus(''), 'Unknown');
    assert.equal(formatCosmosVoteCount('1234567'), '1,234,567');
    assert.equal(formatCosmosVoteCount('not-a-number'), '0');
    assert.equal(formatCosmosVoterVote('VOTE_OPTION_YES', '1.000000000000000000'), 'Yes 100%');
    assert.equal(formatCosmosVoterVote('VOTE_OPTION_YES, VOTE_OPTION_NO', '0.750000000000000000, 0.250000000000000000'), 'Yes 75%, No 25%');
    assert.equal(formatCosmosVoterVote('not voted', ''), 'Not voted');
  });

  test('parseOptionalNumber parses numeric strings and rejects empty/invalid', async () => {
    const mod = await import('../dist/popup.js');
    const { parseOptionalNumber } = mod;
    if (typeof parseOptionalNumber !== 'function') return;

    assert.equal(parseOptionalNumber('21000'), 21000);
    assert.equal(parseOptionalNumber(''), undefined);
    assert.equal(parseOptionalNumber('abc'), undefined);
    assert.equal(parseOptionalNumber('0'), 0);
  });

  test('parseOptionalPositiveNumber accepts only positive fee rates', async () => {
    const mod = await import('../dist/popup.js');
    const { parseOptionalPositiveNumber } = mod;
    if (typeof parseOptionalPositiveNumber !== 'function') return;

    assert.equal(parseOptionalPositiveNumber(''), undefined);
    assert.equal(parseOptionalPositiveNumber('10'), 10);
    assert.equal(parseOptionalPositiveNumber('2.5'), 2.5);
    assert.throws(() => parseOptionalPositiveNumber('0'), /greater than 0/);
    assert.throws(() => parseOptionalPositiveNumber('-1'), /greater than 0/);
    assert.throws(() => parseOptionalPositiveNumber('abc'), /greater than 0/);
  });

  test('resolveBitcoinFeePreset maps fee tiers to sat/vB values', async () => {
    const mod = await import('../dist/popup.js');
    const { resolveBitcoinFeePreset } = mod;
    if (typeof resolveBitcoinFeePreset !== 'function') return;

    assert.equal(resolveBitcoinFeePreset('auto', ''), '');
    assert.equal(resolveBitcoinFeePreset('slow', ''), '2');
    assert.equal(resolveBitcoinFeePreset('normal', ''), '5');
    assert.equal(resolveBitcoinFeePreset('fast', ''), '10');
    assert.equal(resolveBitcoinFeePreset('custom', '17'), '17');
  });

  test('sortBitcoinInputs supports value, confirmation, and label order', async () => {
    const mod = await import('../dist/popup.js');
    const { sortBitcoinInputs } = mod;
    if (typeof sortBitcoinInputs !== 'function') return;

    const inputs = [
      { txid: 'b'.repeat(64), vout: 1, valueSats: '2000', confirmed: false },
      { txid: 'a'.repeat(64), vout: 0, valueSats: '5000', confirmed: true },
      { txid: 'c'.repeat(64), vout: 2, valueSats: '1000', confirmed: true },
    ];

    assert.deepEqual(sortBitcoinInputs(inputs, 'value-desc').map((input) => input.txid[0]), ['a', 'b', 'c']);
    assert.deepEqual(sortBitcoinInputs(inputs, 'value-asc').map((input) => input.txid[0]), ['c', 'b', 'a']);
    assert.deepEqual(sortBitcoinInputs(inputs, 'confirmed-first').map((input) => input.txid[0]), ['a', 'c', 'b']);
    assert.deepEqual(sortBitcoinInputs(inputs, 'label', [
      { key: `${'b'.repeat(64)}:1`, label: 'beta', updatedAt: 1 },
      { key: `${'a'.repeat(64)}:0`, label: 'alpha', updatedAt: 1 },
      { key: `${'c'.repeat(64)}:2`, label: 'gamma', updatedAt: 1 },
    ]).map((input) => input.txid[0]), ['a', 'b', 'c']);
  });

  test('previewRequiresConfirmation flags Bitcoin change and dust', async () => {
    const mod = await import('../dist/popup.js');
    const { previewRequiresConfirmation } = mod;
    if (typeof previewRequiresConfirmation !== 'function') return;

    const base = {
      amountSats: '1000',
      feeSats: '100',
      feeRateSatVb: 1,
      inputCount: 1,
      inputs: [],
      inputTotalSats: '1100',
      changeSats: '0',
      dustSats: '0',
      estimatedVbytes: 109,
      rbfEnabled: true,
    };
    assert.equal(previewRequiresConfirmation(base), false);
    assert.equal(previewRequiresConfirmation({ ...base, changeSats: '1' }), true);
    assert.equal(previewRequiresConfirmation({ ...base, dustSats: '1' }), true);
    assert.equal(previewRequiresConfirmation({ ...base, changeSats: 'not-a-number' }), true);
  });

  test('formatWalletConnectExpiry reports relative expiry windows', async () => {
    const mod = await import('../dist/popup.js');
    const { formatWalletConnectExpiry } = mod;
    if (typeof formatWalletConnectExpiry !== 'function') return;

    assert.equal(formatWalletConnectExpiry(Date.now() - 1000), 'expired');
    assert.match(formatWalletConnectExpiry(Date.now() + 60 * 1000), /^[12]m$/);
    assert.match(formatWalletConnectExpiry(Date.now() + 2 * 60 * 60 * 1000), /^[23]h$/);
  });

  test('transaction history labels display reward, batch, and transfer types', async () => {
    const mod = await import('../dist/popup.js');
    const { formatTxHistoryType, formatTxHistoryLabel } = mod;

    assert.equal(formatTxHistoryType({
      txHash: '0x1',
      from: 'pq1from',
      to: 'pq1to',
      value: '0',
      data: '0x',
      createdAt: 1,
      updatedAt: 1,
      status: 'confirmed',
      source: 'remote',
      shellType: 'blockGasReward',
    }), 'Block Reward');
    assert.equal(formatTxHistoryLabel({
      txHash: '0x2',
      from: 'pq1from',
      to: 'pq1to',
      value: '0',
      data: '0x',
      createdAt: 1,
      updatedAt: 1,
      status: 'confirmed',
      source: 'remote',
      shellType: 'starkReward',
    }), 'STARK Reward');
    assert.equal(formatTxHistoryType({
      txHash: '0x3',
      from: 'pq1from',
      to: 'pq1to',
      value: '0',
      data: '0x',
      createdAt: 1,
      updatedAt: 1,
      status: 'confirmed',
      source: 'remote',
      txType: '0x7e',
      innerCallCount: 2,
    }), '⚡ Batch (2 calls)');
    assert.equal(formatTxHistoryLabel({
      txHash: '0x4',
      from: 'pq1from',
      to: 'pq1to',
      value: '1000000000000000000',
      data: '0x',
      createdAt: 1,
      updatedAt: 1,
      status: 'confirmed',
      source: 'remote',
    }), '1.000000 SHELL');
    assert.equal(formatTxHistoryLabel({
      txHash: 'b'.repeat(64),
      chainKind: 'tron',
      from: 'Tfrom',
      to: 'Tto',
      value: '1500000',
      data: '0x',
      createdAt: 1,
      updatedAt: 1,
      status: 'pending',
      source: 'local',
      shellType: 'trc20Transfer',
      tokenSymbol: 'USDT',
      tokenDecimals: 6,
    }), '1.5 USDT');
    assert.equal(formatTxHistoryLabel({
      txHash: 'solsig',
      chainKind: 'solana',
      from: 'solfrom',
      to: 'solto',
      value: '500000000',
      data: '0x',
      createdAt: 1,
      updatedAt: 1,
      status: 'pending',
      source: 'local',
      shellType: 'solanaTransfer',
    }), '0.5 SOL');
    assert.equal(formatTxHistoryLabel({
      txHash: 'btctx',
      chainKind: 'bitcoin',
      from: 'bc1from',
      to: 'bc1to',
      value: '12345678',
      data: '0x',
      createdAt: 1,
      updatedAt: 1,
      status: 'pending',
      source: 'local',
      shellType: 'bitcoinTransfer',
    }), '0.12345678 BTC');
    assert.equal(formatTxHistoryLabel({
      txHash: 'cosmostx',
      chainKind: 'cosmos',
      from: 'cosmos1from',
      to: 'cosmos1to',
      value: '1250000',
      data: '0x',
      createdAt: 1,
      updatedAt: 1,
      status: 'pending',
      source: 'local',
      shellType: 'cosmosTransfer',
    }), '1.25 ATOM');
    assert.equal(formatTxHistoryLabel({
      txHash: 'tontx',
      chainKind: 'ton',
      from: 'UQfrom',
      to: 'UQto',
      value: '1250000000',
      data: '0x',
      createdAt: 1,
      updatedAt: 1,
      status: 'pending',
      source: 'local',
      shellType: 'tonTransfer',
    }), '1.25 TON');
    assert.equal(formatTxHistoryType({
      txHash: 'aptostx',
      chainKind: 'aptos',
      from: '0x' + '1'.repeat(64),
      to: '0x' + '2'.repeat(64),
      value: '125000000',
      data: '0x',
      createdAt: 1,
      updatedAt: 1,
      status: 'pending',
      source: 'local',
      shellType: 'aptosTransfer',
    }), 'APT Transfer');
    assert.equal(formatTxHistoryLabel({
      txHash: 'aptostx',
      chainKind: 'aptos',
      from: '0x' + '1'.repeat(64),
      to: '0x' + '2'.repeat(64),
      value: '125000000',
      data: '0x',
      createdAt: 1,
      updatedAt: 1,
      status: 'pending',
      source: 'local',
      shellType: 'aptosTransfer',
    }), '1.25 APT');
    assert.equal(formatTxHistoryType({
      txHash: 'cosmosdelegate',
      chainKind: 'cosmos',
      from: 'cosmos1from',
      to: 'cosmosvaloper1to',
      value: '500000',
      data: '0x',
      createdAt: 1,
      updatedAt: 1,
      status: 'pending',
      source: 'local',
      shellType: 'cosmosDelegate',
    }), 'ATOM Delegate');
    assert.equal(formatTxHistoryLabel({
      txHash: 'cosmosundelegate',
      chainKind: 'cosmos',
      from: 'cosmos1from',
      to: 'cosmosvaloper1to',
      value: '250000',
      data: '0x',
      createdAt: 1,
      updatedAt: 1,
      status: 'pending',
      source: 'local',
      shellType: 'cosmosUndelegate',
    }), '0.25 ATOM');
    assert.equal(formatTxHistoryLabel({
      txHash: 'cosmosredelegate',
      chainKind: 'cosmos',
      from: 'cosmos1from',
      to: 'cosmosvaloper1dst',
      value: '125000',
      data: '0x',
      createdAt: 1,
      updatedAt: 1,
      status: 'pending',
      source: 'local',
      shellType: 'cosmosRedelegate',
    }), '0.125 ATOM');
    assert.equal(formatTxHistoryLabel({
      txHash: 'cosmosrewards',
      chainKind: 'cosmos',
      from: 'cosmos1from',
      to: 'cosmosvaloper1to',
      value: '0',
      data: '0x',
      createdAt: 1,
      updatedAt: 1,
      status: 'pending',
      source: 'local',
      shellType: 'cosmosWithdrawRewards',
    }), 'ATOM Rewards');
    const cosmosVoteTx = {
      txHash: 'cosmosvote',
      chainKind: 'cosmos',
      from: 'cosmos1from',
      to: '12',
      value: '12',
      data: 'no_with_veto',
      createdAt: 1,
      updatedAt: 1,
      status: 'pending',
      source: 'local',
      shellType: 'cosmosVote',
    };
    assert.equal(formatTxHistoryType(cosmosVoteTx), 'ATOM Vote');
    assert.equal(formatTxHistoryLabel(cosmosVoteTx), 'Proposal #12 No With Veto');
    assert.equal(formatTxHistoryType({
      txHash: 'btcchild',
      chainKind: 'bitcoin',
      from: 'bc1from',
      to: 'bc1from',
      value: '29998910',
      data: '0x',
      createdAt: 1,
      updatedAt: 1,
      status: 'pending',
      source: 'local',
      shellType: 'bitcoinCpfp',
    }), 'BTC CPFP');
  });

  test('formatTxExplorerUrl returns supported chain explorer links only', async () => {
    const mod = await import('../dist/popup.js');
    const { formatTxExplorerUrl } = mod;
    if (typeof formatTxExplorerUrl !== 'function') return;

    const txHash = 'A'.repeat(64);
    const tx = {
      txHash,
      chainKind: 'bitcoin',
      from: 'bc1from',
      to: 'bc1to',
      value: '12345678',
      data: '0x',
      createdAt: 1,
      updatedAt: 1,
      status: 'pending',
      source: 'local',
      shellType: 'bitcoinTransfer',
    };
    assert.equal(
      formatTxExplorerUrl(tx, { name: 'Bitcoin Mainnet', chainId: 8332, rpcUrl: 'https://blockstream.info/api', kind: 'bitcoin' }),
      `https://blockstream.info/tx/${txHash.toLowerCase()}`,
    );
    assert.equal(
      formatTxExplorerUrl(tx, { name: 'Bitcoin Testnet', chainId: 18332, rpcUrl: 'https://blockstream.info/testnet/api', kind: 'bitcoin' }),
      `https://blockstream.info/testnet/tx/${txHash.toLowerCase()}`,
    );
    assert.equal(
      formatTxExplorerUrl(tx, { name: 'Shell Devnet', chainId: 424242, rpcUrl: 'http://127.0.0.1:8545', kind: 'shell' }),
      null,
    );
    assert.equal(
      formatTxExplorerUrl({ ...tx, txHash: 'not-a-bitcoin-hash' }, { name: 'Bitcoin Mainnet', chainId: 8332, rpcUrl: 'https://blockstream.info/api', kind: 'bitcoin' }),
      null,
    );
    const aptosTx = {
      txHash: '0x' + 'B'.repeat(64),
      chainKind: 'aptos',
      from: '0x' + '1'.repeat(64),
      to: '0x' + '2'.repeat(64),
      value: '1',
      data: '0x',
      createdAt: 1,
      updatedAt: 1,
      status: 'pending',
      source: 'local',
      shellType: 'aptosTransfer',
    };
    assert.equal(
      formatTxExplorerUrl(aptosTx, { name: 'Aptos Testnet', chainId: 2, rpcUrl: 'https://fullnode.testnet.aptoslabs.com/v1', kind: 'aptos' }),
      `https://explorer.aptoslabs.com/txn/${'0x' + 'b'.repeat(64)}?network=testnet`,
    );
    assert.equal(
      formatTxExplorerUrl(aptosTx, { name: 'Aptos Devnet', chainId: 35, rpcUrl: 'https://fullnode.devnet.aptoslabs.com/v1', kind: 'aptos' }),
      `https://explorer.aptoslabs.com/txn/${'0x' + 'b'.repeat(64)}?network=devnet`,
    );
    assert.equal(
      formatTxExplorerUrl(aptosTx, { name: 'Aptos Mainnet', chainId: 1, rpcUrl: 'https://fullnode.mainnet.aptoslabs.com/v1', kind: 'aptos' }),
      `https://explorer.aptoslabs.com/txn/${'0x' + 'b'.repeat(64)}?network=mainnet`,
    );
    assert.equal(
      formatTxExplorerUrl({ ...aptosTx, txHash: 'not-an-aptos-hash' }, { name: 'Aptos Testnet', chainId: 2, rpcUrl: 'https://fullnode.testnet.aptoslabs.com/v1', kind: 'aptos' }),
      null,
    );
  });

  test('canBumpBitcoinFee gates pending local RBF transactions', async () => {
    const mod = await import('../dist/popup.js');
    const { canBumpBitcoinFee } = mod;
    if (typeof canBumpBitcoinFee !== 'function') return;

    const tx = {
      txHash: 'c'.repeat(64),
      chainKind: 'bitcoin',
      from: 'bc1from',
      to: 'bc1to',
      value: '10000000',
      data: '0x',
      createdAt: 1,
      updatedAt: 1,
      status: 'pending',
      source: 'local',
      shellType: 'bitcoinTransfer',
      rbfEnabled: true,
      bitcoinInputs: [{ txid: 'd'.repeat(64), vout: 1, valueSats: '100000000', confirmed: true }],
    };
    assert.equal(canBumpBitcoinFee(tx), true);
    assert.equal(canBumpBitcoinFee({ ...tx, status: 'confirmed' }), false);
    assert.equal(canBumpBitcoinFee({ ...tx, source: 'remote' }), false);
    assert.equal(canBumpBitcoinFee({ ...tx, rbfEnabled: false }), false);
    assert.equal(canBumpBitcoinFee({ ...tx, bitcoinInputs: [] }), false);
  });

  test('canCpfpBitcoinTx gates remote pending incoming outputs', async () => {
    const mod = await import('../dist/popup.js');
    const { canCpfpBitcoinTx } = mod;
    if (typeof canCpfpBitcoinTx !== 'function') return;

    const tx = {
      txHash: '9'.repeat(64),
      chainKind: 'bitcoin',
      from: 'bc1counterparty',
      to: 'bc1wallet',
      value: '30000000',
      data: '0x',
      createdAt: 1,
      updatedAt: 1,
      status: 'pending',
      source: 'remote',
      shellType: 'bitcoinTransfer',
      bitcoinCpfpInput: { txid: '9'.repeat(64), vout: 0, valueSats: '30000000', confirmed: false },
    };
    assert.equal(canCpfpBitcoinTx(tx), true);
    assert.equal(canCpfpBitcoinTx({ ...tx, status: 'confirmed' }), false);
    assert.equal(canCpfpBitcoinTx({ ...tx, source: 'local' }), false);
    assert.equal(canCpfpBitcoinTx({ ...tx, bitcoinCpfpInput: null }), false);
    assert.equal(canCpfpBitcoinTx({ ...tx, bitcoinCpfpInput: { ...tx.bitcoinCpfpInput, confirmed: true } }), false);
  });
});
