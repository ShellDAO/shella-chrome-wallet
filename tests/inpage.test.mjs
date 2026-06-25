import assert from 'node:assert/strict';
import { describe, test, before } from 'node:test';

const listeners = new Map();
const postedMessages = [];
const standardWallets = [];

Object.defineProperty(globalThis, 'crypto', {
  value: {
  getRandomValues(bytes) {
    bytes.fill(7);
    return bytes;
  },
  randomUUID() {
    return 'test-provider-uuid';
  },
  },
  configurable: true,
});

globalThis.CustomEvent = class CustomEvent extends Event {
  constructor(type, init = {}) {
    super(type);
    this.detail = init.detail;
  }
};

globalThis.window = {
  location: { origin: 'https://dapp.example.com' },
  addEventListener(type, listener) {
    const set = listeners.get(type) ?? new Set();
    set.add(listener);
    listeners.set(type, set);
  },
  dispatchEvent(event) {
    for (const listener of listeners.get(event.type) ?? []) listener(event);
    return true;
  },
  postMessage(message) {
    postedMessages.push(message);
    if (message.target !== 'shella-contentscript') return;
    const result = message.method === 'solana_connect'
      ? { publicKey: 'So11111111111111111111111111111111111111112' }
      : message.method === 'solana_signAndSendTransaction'
        ? { signature: 'solsig' }
        : message.method === 'tonconnect_connect'
          ? {
              clientId: message.params[0].clientId,
              account: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c',
              chainId: 607,
              network: 'mainnet',
              features: message.params[0].features,
            }
          : message.method === 'tonconnect_restoreConnection'
            ? { sessions: [] }
      : message.method === 'tonconnect_send'
              ? { txHash: 'tonhash' }
              : message.method === 'aptos_connect'
                ? { address: '0x' + '1'.repeat(64), publicKey: '0x' + '2'.repeat(64) }
                : message.method === 'aptos_account'
                  ? { address: '0x' + '1'.repeat(64), publicKey: '0x' + '2'.repeat(64) }
                  : message.method === 'aptos_network'
                    ? { name: 'Aptos Testnet', chainId: 2, url: 'https://fullnode.testnet.aptoslabs.com/v1' }
                    : message.method === 'aptos_getBalance'
                      ? { balance: '123456789', formatted: '1.23456789' }
                      : message.method === 'aptos_signAndSubmitTransaction'
                        ? { hash: '0x' + 'a'.repeat(64) }
        : null;
    queueMicrotask(() => {
      const event = {
        source: globalThis.window,
        data: { target: 'shella-inpage', id: message.id, result },
      };
      for (const listener of listeners.get('message') ?? []) listener(event);
    });
  },
};

describe('inpage provider', () => {
  before(async () => {
    globalThis.window.addEventListener('wallet-standard:register-wallet', (event) => {
      event.detail({
        register(...wallets) {
          standardWallets.push(...wallets);
          return () => undefined;
        },
      });
    });
    await import('../dist/inpage.js');
  });

  test('announces EIP-6963 provider discovery metadata without WalletConnect', async () => {
    const announcements = [];
    globalThis.window.addEventListener('eip6963:announceProvider', (event) => announcements.push(event.detail));
    globalThis.window.dispatchEvent(new Event('eip6963:requestProvider'));

    assert.equal(announcements.length, 1);
    assert.equal(announcements[0].provider, globalThis.window.shella);
    assert.equal(announcements[0].provider.isShella, true);
    assert.deepEqual(announcements[0].info, {
      uuid: 'b7d5f1b4-7e0d-4e57-9448-6f2f4d3d4f2d',
      name: 'Shella Wallet',
      icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOCIgZmlsbD0iIzFhNmVmNSIvPjxwYXRoIGQ9Ik0xNiA2bDcgNHY1YzAgNS40LTMuNCA5LjktNyAxMS0zLjYtMS4xLTctNS42LTctMTF2LTVsNy00eiIgZmlsbD0id2hpdGUiLz48L3N2Zz4=',
      rdns: 'network.shella.wallet',
    });
  });

  test('registers a Solana Wallet Standard provider without third-party relay', async () => {
    assert.equal(standardWallets.length, 1);
    const wallet = standardWallets[0];
    assert.equal(wallet.version, '1.0.0');
    assert.equal(wallet.name, 'Shella Wallet');
    assert.deepEqual(wallet.chains, ['solana:mainnet', 'solana:devnet', 'solana:testnet']);
    assert.deepEqual(Object.keys(wallet.features).sort(), [
      'solana:signAndSendTransaction',
      'standard:connect',
      'standard:disconnect',
      'standard:events',
    ]);

    const changes = [];
    const off = wallet.features['standard:events'].on('change', (payload) => changes.push(payload));
    const connected = await wallet.features['standard:connect'].connect();
    assert.equal(connected.accounts.length, 1);
    assert.equal(connected.accounts[0].address, 'So11111111111111111111111111111111111111112');
    assert.deepEqual(connected.accounts[0].chains, wallet.chains);
    assert.deepEqual(connected.accounts[0].features, ['solana:signAndSendTransaction']);
    assert.equal(changes.some((payload) => payload.accounts?.[0]?.address === connected.accounts[0].address), true);

    const signed = await wallet.features['solana:signAndSendTransaction'].signAndSendTransaction({
      account: connected.accounts[0],
      chain: 'solana:devnet',
      transaction: new Uint8Array([1, 2, 3]),
    });
    assert.equal(signed.length, 1);
    assert.equal(signed[0].signature instanceof Uint8Array, true);
    assert.equal(postedMessages.some((message) => message.method === 'solana_signAndSendTransaction'), true);

    off();
    await wallet.features['standard:disconnect'].disconnect();
    assert.deepEqual(wallet.accounts, []);
  });

  test('exposes Solana provider and forwards connect/sign requests', async () => {
    assert.equal(globalThis.window.solana.isPhantom, true);
    const connected = await globalThis.window.solana.connect();
    assert.equal(connected.publicKey.toString(), 'So11111111111111111111111111111111111111112');
    assert.equal(globalThis.window.solana.publicKey.toBase58(), 'So11111111111111111111111111111111111111112');

    const sent = await globalThis.window.solana.signAndSendTransaction({ to: connected.publicKey.toString(), lamports: 1 });
    assert.deepEqual(sent, { signature: 'solsig' });
    assert.equal(postedMessages.some((message) => message.method === 'solana_connect'), true);
    assert.equal(postedMessages.some((message) => message.method === 'solana_signAndSendTransaction'), true);
  });

  test('exposes TON Connect discovery bridge and forwards connect requests', async () => {
    assert.equal(globalThis.window.ton.isShella, true);
    assert.equal(globalThis.window.ton.tonconnect.deviceInfo.maxProtocolVersion, 2);
    assert.equal(
      globalThis.window.ton.tonconnect.deviceInfo.features.some((feature) =>
        typeof feature === 'object' && feature.name === 'SendTransaction' && feature.maxMessages === 4,
      ),
      true,
    );
    const connected = await globalThis.window.ton.tonconnect.connect(2, {
      clientId: 'ton-client-inpage',
      manifestUrl: 'https://dapp.example.com/tonconnect-manifest.json',
      items: ['ton_addr', { name: 'ton_proof' }],
    });
    assert.equal(connected.clientId, 'ton-client-inpage');
    assert.equal(connected.account, 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c');
    assert.equal(connected.network, 'mainnet');
    assert.equal(postedMessages.some((message) => message.method === 'tonconnect_connect'), true);
    const forwarded = postedMessages.find((message) => message.method === 'tonconnect_connect');
    assert.deepEqual(forwarded.params[0].requestedItems, ['ton_addr', 'ton_proof']);

    const restored = await globalThis.window.ton.tonconnect.restoreConnection();
    assert.deepEqual(restored, { sessions: [] });

    const sent = await globalThis.window.ton.tonconnect.send({
      method: 'sendTransaction',
      params: [{ valid_until: Math.floor(Date.now() / 1000) + 60, messages: [{ address: connected.account, amount: '1' }] }],
    });
    assert.deepEqual(sent, { txHash: 'tonhash' });
    assert.equal(postedMessages.some((message) => message.method === 'tonconnect_send'), true);

    const signed = await globalThis.window.ton.tonconnect.send({
      method: 'signData',
      params: [{ type: 'text', text: 'hello' }],
    });
    assert.deepEqual(signed, { txHash: 'tonhash' });
  });

  test('exposes Aptos provider and forwards gated account, network, balance, and submit requests', async () => {
    assert.equal(globalThis.window.aptos.isShella, true);

    const connected = await globalThis.window.aptos.connect();
    assert.equal(connected.address, '0x' + '1'.repeat(64));
    assert.equal(connected.publicKey, '0x' + '2'.repeat(64));

    const account = await globalThis.window.aptos.account();
    assert.equal(account.address, connected.address);

    const network = await globalThis.window.aptos.network();
    assert.deepEqual(network, {
      name: 'Aptos Testnet',
      chainId: 2,
      url: 'https://fullnode.testnet.aptoslabs.com/v1',
    });

    const balance = await globalThis.window.aptos.getBalance(connected.address);
    assert.deepEqual(balance, { balance: '123456789', formatted: '1.23456789' });

    const submitted = await globalThis.window.aptos.signAndSubmitTransaction({
      type: 'entry_function_payload',
      function: '0x1::aptos_account::transfer',
      arguments: [connected.address, '10000000'],
    });
    assert.deepEqual(submitted, { hash: '0x' + 'a'.repeat(64) });
    assert.equal(postedMessages.some((message) => message.method === 'aptos_connect'), true);
    assert.equal(postedMessages.some((message) => message.method === 'aptos_account'), true);
    assert.equal(postedMessages.some((message) => message.method === 'aptos_network'), true);
    assert.equal(postedMessages.some((message) => message.method === 'aptos_getBalance'), true);
    assert.equal(postedMessages.some((message) => message.method === 'aptos_signAndSubmitTransaction'), true);
  });
});
