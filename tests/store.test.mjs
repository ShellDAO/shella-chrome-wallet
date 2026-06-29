/**
 * Tests for the store module (chrome.storage-backed persistence).
 * Mocks chrome.storage.local and chrome.storage.session with in-memory Maps.
 */
import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'node:test';

function createStorageArea() {
  const store = new Map();
  return {
    async get(keys) {
      if (keys == null) return Object.fromEntries(store);
      if (typeof keys === 'string') return { [keys]: store.get(keys) };
      if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, store.get(k)]));
      return Object.fromEntries(
        Object.entries(keys).map(([k, fallback]) => [k, store.has(k) ? store.get(k) : fallback]),
      );
    },
    async set(value) {
      for (const [k, v] of Object.entries(value)) store.set(k, v);
    },
    async remove(keys) {
      (Array.isArray(keys) ? keys : [keys]).forEach((k) => store.delete(k));
    },
    async clear() { store.clear(); },
    _store: store,
  };
}

const localArea = createStorageArea();
const sessionArea = createStorageArea();

globalThis.chrome = {
  storage: { local: localArea, session: sessionArea },
};

const {
  initStore,
  getWalletState,
  getAccounts,
  addAccount,
  replaceAccountKeystore,
  getNetwork,
  setNetwork,
  getTxQueue,
  setTxQueue,
  upsertTxRecord,
  getAutoLockMinutes,
  setAutoLockMinutes,
  getWalletConnectConfig,
  setWalletConnectConfig,
  getSessionState,
  setSessionState,
  clearSessionState,
  clearAllData,
  getConnectedSites,
  addConnectedSite,
  removeConnectedSite,
  getWalletConnectSessions,
  upsertWalletConnectSession,
  removeWalletConnectSession,
  getTonConnectSessions,
  upsertTonConnectSession,
  removeTonConnectSession,
  getWalletConnectPairings,
  upsertWalletConnectPairing,
  removeWalletConnectPairing,
  getPendingKeyRotations,
  addPendingKeyRotation,
  setPendingKeyRotations,
  getWatchedTokens,
  addWatchedToken,
  removeWatchedToken,
  getBitcoinUtxoPreferences,
  upsertBitcoinUtxoPreference,
  upsertBitcoinUtxoPreferences,
  setWatchedTokenHidden,
  getAccountId,
  getPortfolioSnapshotCache,
  setPortfolioSnapshotCache,
  clearPortfolioSnapshotCache,
} = await import('../dist/store.js');

describe('store', () => {
  beforeEach(async () => {
    localArea._store.clear();
    sessionArea._store.clear();
    await initStore();
  });

  test('initStore creates default wallet state', async () => {
    const state = await getWalletState();
    assert.deepEqual(state.accounts, []);
    assert.equal(state.autoLockMinutes, 15);
    assert.equal(state.network.name, 'Shell Devnet');
    assert.equal(state.network.chainId, 424242);
    assert.equal(state.network.kind, 'shell');
    assert.equal(state.network.symbol, 'SHELL');
    assert.deepEqual(state.connectedSites, []);
    assert.deepEqual(state.walletConnectConfig, { projectId: '', relayUrl: '' });
    assert.deepEqual(state.walletConnectSessions, []);
    assert.deepEqual(state.tonConnectSessions, []);
    assert.deepEqual(state.walletConnectPairings, []);
    assert.deepEqual(state.txQueue, []);
    assert.deepEqual(state.watchedTokens, []);
    assert.deepEqual(state.bitcoinUtxoPreferences, []);
  });

  test('addAccount persists account and deduplicates by pqAddress', async () => {
    const account = { pqAddress: 'pq1abc', hexAddress: '0x123', keystoreJson: '{}' };
    await addAccount(account);
    await addAccount(account); // duplicate
    const accounts = await getAccounts();
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].pqAddress, 'pq1abc');
    assert.equal(accounts[0].accountId, 'imported:pq1abc');
    assert.equal(accounts[0].primaryAddress, 'pq1abc');
    assert.equal(accounts[0].addresses[0].signatureScheme, 'ml-dsa-65');
    assert.equal(accounts[0].addresses[0].isShellAuthority, true);
  });

  test('legacy multichain account migration preserves Shell PQ root and mirrors addresses', async () => {
    localArea._store.clear();
    sessionArea._store.clear();
    const pqAddress = `0x${'aa'.repeat(32)}`;
    await localArea.set({
      network: { name: 'Shell Devnet', chainId: 424242, rpcUrl: 'http://127.0.0.1:8545' },
      accounts: [{
        pqAddress,
        keystoreJson: '{"crypto":"pq"}',
        derivationIndex: 1,
        primaryAddress: `0x${'bb'.repeat(32)}`,
        chainAddresses: {
          tron: 'TTest1111111111111111111111111111111',
          solana: 'So11111111111111111111111111111111111111112',
        },
      }],
      connectedSites: [{
        origin: 'https://dapp.example',
        accounts: [pqAddress],
        chainId: 424242,
        grantedAt: 1,
        lastUsedAt: 1,
      }],
      autoLockMinutes: 15,
      txQueue: [],
    });

    await initStore();
    const state = await getWalletState();
    const account = state.accounts[0];
    assert.equal(state.accountModelVersion, 2);
    assert.equal(account.accountId, 'hd:1');
    assert.equal(getAccountId(account), 'hd:1');
    assert.equal(account.primaryAddress, pqAddress, 'primaryAddress must remain the Shell/PQ authority');
    assert.equal(account.keystoreJson, '{"crypto":"pq"}');
    assert.equal(account.addresses.find((entry) => entry.addressKey === 'shell').address, pqAddress);
    assert.equal(account.addresses.find((entry) => entry.addressKey === 'shell').isShellAuthority, true);
    assert.equal(account.addresses.find((entry) => entry.addressKey === 'tron').signatureScheme, 'tron-secp256k1');
    assert.equal(account.addresses.find((entry) => entry.addressKey === 'solana').signatureScheme, 'ed25519');
    assert.deepEqual(state.connectedSites[0].accountIds, ['hd:1']);
  });

  test('imported keystore migration does not fabricate non-Shell addresses', async () => {
    const pqAddress = `0x${'cc'.repeat(32)}`;
    await addAccount({ pqAddress, keystoreJson: '{"imported":true}' });
    const [account] = await getAccounts();
    assert.equal(account.accountId, `imported:${pqAddress}`);
    assert.equal(account.primaryAddress, pqAddress);
    assert.deepEqual(account.addresses.map((entry) => entry.addressKey), ['shell']);
    assert.equal(account.addresses[0].signatureScheme, 'ml-dsa-65');
  });

  test('replaceAccountKeystore updates an existing account only', async () => {
    await addAccount({ pqAddress: `0x${'aa'.repeat(32)}`, keystoreJson: '{"old":true}' });
    await replaceAccountKeystore(`0x${'aa'.repeat(32)}`, '{"new":true}');
    const accounts = await getAccounts();
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].keystoreJson, '{"new":true}');

    await assert.rejects(
      () => replaceAccountKeystore(`0x${'bb'.repeat(32)}`, '{}'),
      /Account not found/,
    );
  });

  test('pending key rotations can be added, replaced, and cleared', async () => {
    const rotation = {
      txHash: `0x${'12'.repeat(32)}`,
      pqAddress: `0x${'aa'.repeat(32)}`,
      keystoreJson: '{"rotation":1}',
      createdAt: 1,
    };
    await addPendingKeyRotation(rotation);
    await addPendingKeyRotation({ ...rotation, keystoreJson: '{"rotation":2}', createdAt: 2 });
    let pending = await getPendingKeyRotations();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].keystoreJson, '{"rotation":2}');

    await setPendingKeyRotations([]);
    pending = await getPendingKeyRotations();
    assert.deepEqual(pending, []);
  });

  test('setNetwork persists and getNetwork retrieves', async () => {
    const testnet = { name: 'Shell Testnet', chainId: 12345, rpcUrl: 'https://rpc.testnet.shell.network', kind: 'shell', symbol: 'SHELL', rpcProvenance: 'owned' };
    await setNetwork(testnet);
    const net = await getNetwork();
    assert.deepEqual(net, testnet);
  });

  test('upsertTxRecord inserts new records at head', async () => {
    const tx = {
      txHash: '0x' + 'aa'.repeat(32),
      from: '0x1',
      to: '0x2',
      value: '1000',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'pending',
      source: 'local',
    };
    await upsertTxRecord(tx);
    const queue = await getTxQueue();
    assert.equal(queue.length, 1);
    assert.equal(queue[0].txHash, tx.txHash);
  });

  test('upsertTxRecord updates existing record by txHash (case-insensitive)', async () => {
    const hash = '0x' + 'bb'.repeat(32);
    await upsertTxRecord({ txHash: hash, from: '0x1', to: '0x2', value: '1', createdAt: 1, updatedAt: 1, status: 'pending', source: 'local' });
    await upsertTxRecord({ txHash: hash.toUpperCase(), from: '0x1', to: '0x2', value: '1', createdAt: 1, updatedAt: 2, status: 'confirmed', source: 'local' });
    const queue = await getTxQueue();
    assert.equal(queue.length, 1);
    assert.equal(queue[0].status, 'confirmed');
  });

  test('upsertTxRecord caps history at 50 records', async () => {
    for (let i = 0; i < 55; i++) {
      await upsertTxRecord({
        txHash: `0x${i.toString(16).padStart(64, '0')}`,
        from: '0x1', to: '0x2', value: '1',
        createdAt: i, updatedAt: i,
        status: 'confirmed', source: 'local',
      });
    }
    const queue = await getTxQueue();
    assert.ok(queue.length <= 50, `expected ≤50 records, got ${queue.length}`);
  });

  test('autoLockMinutes can be get and set', async () => {
    assert.equal(await getAutoLockMinutes(), 15);
    await setAutoLockMinutes(30);
    assert.equal(await getAutoLockMinutes(), 30);
  });

  test('walletconnect config can be get and set', async () => {
    assert.deepEqual(await getWalletConnectConfig(), { projectId: '', relayUrl: '' });
    await setWalletConnectConfig({
      projectId: ' project-123 ',
      relayUrl: ' wss://relay.walletconnect.com ',
    });
    assert.deepEqual(await getWalletConnectConfig(), {
      projectId: 'project-123',
      relayUrl: 'wss://relay.walletconnect.com',
    });
    const state = await getWalletState();
    assert.deepEqual(state.walletConnectConfig, {
      projectId: 'project-123',
      relayUrl: 'wss://relay.walletconnect.com',
    });
  });

  test('session state can be set, retrieved, and cleared', async () => {
    await setSessionState({ unlockedPqAddress: 'pq1test', unlockedAt: 12345 });
    const s = await getSessionState();
    assert.equal(s.unlockedPqAddress, 'pq1test');
    assert.equal(s.unlockedAt, 12345);

    await clearSessionState();
    assert.equal(await getSessionState(), null);
  });

  test('connected sites can be added and removed', async () => {
    await addConnectedSite({
      origin: 'https://app.shell.network',
      accounts: [`0x${'aa'.repeat(32)}`],
      chainId: 424242,
      grantedAt: 1,
      lastUsedAt: 2,
    });
    await addConnectedSite({
      origin: 'https://dapp.example.com',
      accounts: [`0x${'bb'.repeat(32)}`],
      chainId: 12345,
      grantedAt: 3,
      lastUsedAt: 4,
    });
    await addConnectedSite({
      origin: 'https://app.shell.network',
      accounts: [`0x${'cc'.repeat(32)}`],
      chainId: 424242,
      grantedAt: 1,
      lastUsedAt: 5,
    }); // replace duplicate by origin
    const sites = await getConnectedSites();
    assert.equal(sites.length, 2);
    assert.equal(sites.find((site) => site.origin === 'https://app.shell.network').accounts[0], `0x${'cc'.repeat(32)}`);

    await removeConnectedSite('https://dapp.example.com');
    assert.equal((await getConnectedSites()).length, 1);
  });

  test('walletconnect sessions can be added, replaced, removed, and expire', async () => {
    const session = {
      topic: 'topic-1',
      origin: 'https://walletconnect.example',
      accounts: [`0x${'aa'.repeat(32)}`],
      chainIds: [424242],
      methods: ['eth_chainId'],
      grantedAt: 1,
      lastUsedAt: 2,
      expiresAt: Date.now() + 60_000,
    };
    await upsertWalletConnectSession(session);
    await upsertWalletConnectSession({ ...session, methods: ['eth_chainId', 'eth_call'], lastUsedAt: 3 });
    let sessions = await getWalletConnectSessions();
    assert.equal(sessions.length, 1);
    assert.deepEqual(sessions[0].methods, ['eth_chainId', 'eth_call']);
    assert.equal(sessions[0].lastUsedAt, 3);

    await upsertWalletConnectSession({ ...session, topic: 'expired', expiresAt: Date.now() - 1 });
    sessions = await getWalletConnectSessions();
    assert.equal(sessions.length, 1);

    await removeWalletConnectSession('topic-1');
    assert.deepEqual(await getWalletConnectSessions(), []);
  });

  test('tonconnect sessions can be added, replaced, removed, and expire', async () => {
    const session = {
      clientId: 'ton-client-1',
      origin: 'https://ton.example',
      manifestUrl: 'https://ton.example/tonconnect-manifest.json',
      account: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c',
      chainId: 607,
      network: 'mainnet',
      features: [
        { name: 'SendTransaction', maxMessages: 4 },
        { name: 'SignData', types: ['text', 'binary', 'cell'] },
      ],
      grantedAt: 1,
      lastUsedAt: 2,
      expiresAt: Date.now() + 60_000,
    };
    await upsertTonConnectSession(session);
    await upsertTonConnectSession({ ...session, features: [{ name: 'SendTransaction', maxMessages: 2 }], lastUsedAt: 3 });
    let sessions = await getTonConnectSessions();
    assert.equal(sessions.length, 1);
    assert.deepEqual(sessions[0].features, [{ name: 'SendTransaction', maxMessages: 2 }]);
    assert.equal(sessions[0].lastUsedAt, 3);

    await upsertTonConnectSession({ ...session, clientId: 'expired', expiresAt: Date.now() - 1 });
    sessions = await getTonConnectSessions();
    assert.equal(sessions.length, 1);

    await removeTonConnectSession('ton-client-1');
    assert.deepEqual(await getTonConnectSessions(), []);
  });

  test('walletconnect pairings can be added, replaced, removed, and expire', async () => {
    const pairing = {
      topic: 'pairing-topic',
      uri: 'wc:pairing-topic@2?relay-protocol=irn&symKey=abc',
      relayProtocol: 'irn',
      symKey: 'abc',
      createdAt: 1,
      expiresAt: Date.now() + 60_000,
    };
    await upsertWalletConnectPairing(pairing);
    await upsertWalletConnectPairing({ ...pairing, symKey: 'def', createdAt: 2 });
    let pairings = await getWalletConnectPairings();
    assert.equal(pairings.length, 1);
    assert.equal(pairings[0].symKey, 'def');

    await upsertWalletConnectPairing({ ...pairing, topic: 'expired', expiresAt: Date.now() - 1 });
    pairings = await getWalletConnectPairings();
    assert.equal(pairings.length, 1);

    await removeWalletConnectPairing('pairing-topic');
    assert.deepEqual(await getWalletConnectPairings(), []);
  });

  test('portfolio snapshot cache can be stored, read, and cleared', async () => {
    assert.equal(await getPortfolioSnapshotCache(), null);
    const snapshot = {
      accountId: 'hd:0',
      generatedAt: 123,
      networks: [{
        chainKind: 'shell',
        chainId: 424242,
        networkName: 'Shell Devnet',
        rpcProvenance: 'owned',
        address: `0x${'aa'.repeat(32)}`,
        symbol: 'SHELL',
        nativeAsset: null,
        watchedTokenCount: 0,
        status: 'ok',
        error: null,
        updatedAt: 123,
      }],
    };
    await setPortfolioSnapshotCache(snapshot);
    assert.deepEqual(await getPortfolioSnapshotCache(), snapshot);
    await clearPortfolioSnapshotCache();
    assert.equal(await getPortfolioSnapshotCache(), null);
  });

  test('watched tokens can be added, replaced, and removed', async () => {
    const token = {
      chainKind: 'tron',
      chainId: 2494104990,
      contractAddress: 'TToken1111111111111111111111111111111',
      symbol: 'USDT',
      decimals: 6,
      addedAt: 1,
    };
    await addWatchedToken(token);
    await addWatchedToken({ ...token, symbol: 'USDTx', addedAt: 2 });
    let tokens = await getWatchedTokens();
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].symbol, 'USDTx');
    assert.equal(tokens[0].addedAt, 2);

    const state = await getWalletState();
    assert.equal(state.watchedTokens.length, 1);

    await setWatchedTokenHidden('tron', 2494104990, token.contractAddress, true);
    tokens = await getWatchedTokens();
    assert.equal(tokens[0].hidden, true);
    await setWatchedTokenHidden('tron', 2494104990, token.contractAddress, false);
    tokens = await getWatchedTokens();
    assert.equal(tokens[0].hidden, undefined);

    await removeWatchedToken('tron', 2494104990, token.contractAddress);
    tokens = await getWatchedTokens();
    assert.deepEqual(tokens, []);
  });

  test('bitcoin UTXO preferences can be added, replaced, and pruned when empty', async () => {
    const key = `${'a'.repeat(64)}:1`;
    await upsertBitcoinUtxoPreference({
      key: key.toUpperCase(),
      label: '  savings coin  ',
      locked: true,
      updatedAt: 1,
    });
    let preferences = await getBitcoinUtxoPreferences();
    assert.equal(preferences.length, 1);
    assert.equal(preferences[0].key, key);
    assert.equal(preferences[0].label, 'savings coin');
    assert.equal(preferences[0].locked, true);

    await upsertBitcoinUtxoPreference({
      key,
      label: '',
      locked: false,
      updatedAt: 2,
    });
    preferences = await getBitcoinUtxoPreferences();
    assert.deepEqual(preferences, []);
  });

  test('bitcoin UTXO preferences can be batch locked, unlocked, and imported', async () => {
    const first = `${'b'.repeat(64)}:0`;
    const second = `${'c'.repeat(64)}:1`;
    await upsertBitcoinUtxoPreferences([
      { key: first, label: 'cold', locked: true, updatedAt: 1 },
      { key: second, label: 'change', locked: false, updatedAt: 1 },
    ]);
    let preferences = await getBitcoinUtxoPreferences();
    assert.equal(preferences.length, 2);
    assert.equal(preferences.find((item) => item.key === first).locked, true);
    assert.equal(preferences.find((item) => item.key === second).label, 'change');

    await upsertBitcoinUtxoPreferences([
      { key: first, label: 'cold', locked: false, updatedAt: 2 },
      { key: second, label: '', locked: false, updatedAt: 2 },
    ]);
    preferences = await getBitcoinUtxoPreferences();
    assert.deepEqual(preferences.map((item) => item.key), [first]);
    assert.equal(preferences[0].label, 'cold');
    assert.equal(preferences[0].locked, undefined);
  });

  test('clearAllData resets everything to defaults', async () => {
    await addAccount({ pqAddress: 'pq1x', hexAddress: '0x1', keystoreJson: '{}' });
    await setNetwork({ name: 'Shell Testnet', chainId: 12345, rpcUrl: 'https://rpc.testnet.shell.network' });
    await clearAllData();
    const state = await getWalletState();
    assert.deepEqual(state.accounts, []);
    assert.equal(state.network.name, 'Shell Devnet');
  });

  test('initStore migrates legacy connectedSites strings into stable objects', async () => {
    localArea._store.clear();
    sessionArea._store.clear();
    await localArea.set({
      network: { name: 'Shell Devnet', chainId: 424242, rpcUrl: 'http://127.0.0.1:8545' },
      accounts: [],
      autoLockMinutes: 15,
      connectedSites: ['https://legacy.example'],
      txQueue: [],
    });

    await initStore();
    const sites = await getConnectedSites();
    assert.equal(sites.length, 1);
    assert.equal(sites[0].origin, 'https://legacy.example');
    assert.equal(Array.isArray(sites[0].accounts), true);
    assert.equal(typeof sites[0].grantedAt, 'number');

    const stored = await localArea.get('connectedSites');
    assert.equal(typeof stored.connectedSites[0], 'object');
    assert.equal(stored.connectedSites[0].origin, 'https://legacy.example');
  });

  test('getNetwork normalizes legacy networks to Shell kind', async () => {
    await setNetwork({ name: 'Legacy Shell', chainId: 7, rpcUrl: 'https://legacy.shell.example' });
    const network = await getNetwork();
    assert.equal(network.kind, 'shell');
    assert.equal(network.symbol, 'SHELL');
    assert.equal(network.rpcProvenance, 'user-custom');
  });

  test('getNetwork preserves Solana networks and default symbol', async () => {
    await setNetwork({ name: 'Solana Devnet', chainId: 103, rpcUrl: 'https://api.devnet.solana.com', kind: 'solana' });
    const network = await getNetwork();
    assert.equal(network.kind, 'solana');
    assert.equal(network.symbol, 'SOL');
    assert.equal(network.rpcProvenance, 'official-public');
  });

  test('getNetwork preserves Bitcoin networks and default symbol', async () => {
    await setNetwork({ name: 'Bitcoin Mainnet', chainId: 8332, rpcUrl: 'https://blockstream.info/api', kind: 'bitcoin' });
    const network = await getNetwork();
    assert.equal(network.kind, 'bitcoin');
    assert.equal(network.symbol, 'BTC');
    assert.equal(network.rpcProvenance, 'third-party-public');
  });

  test('getNetwork preserves Bitcoin Testnet networks and default symbol', async () => {
    await setNetwork({ name: 'Bitcoin Testnet', chainId: 18332, rpcUrl: 'https://blockstream.info/testnet/api', kind: 'bitcoin' });
    const network = await getNetwork();
    assert.equal(network.kind, 'bitcoin');
    assert.equal(network.symbol, 'BTC');
  });

  test('getNetwork preserves Cosmos networks and default symbol', async () => {
    await setNetwork({ name: 'Cosmos Hub', chainId: 118, rpcUrl: 'https://rest.cosmos.directory/cosmoshub', kind: 'cosmos' });
    const network = await getNetwork();
    assert.equal(network.kind, 'cosmos');
    assert.equal(network.symbol, 'ATOM');
    assert.equal(network.addressPrefix, 'cosmos');
    assert.equal(network.nativeDenom, 'uatom');
    assert.equal(network.nativeDecimals, 6);
  });

  test('getNetwork preserves TON networks and default symbol', async () => {
    await setNetwork({ name: 'TON Mainnet', chainId: 607, rpcUrl: 'https://toncenter.com/api/v2', kind: 'ton' });
    const network = await getNetwork();
    assert.equal(network.kind, 'ton');
    assert.equal(network.symbol, 'TON');
    assert.equal(network.rpcProvenance, 'third-party-public');
  });

  test('getNetwork preserves Aptos networks and official RPC provenance', async () => {
    await setNetwork({ name: 'Aptos Testnet', chainId: 2, rpcUrl: 'https://fullnode.testnet.aptoslabs.com/v1', kind: 'aptos' });
    const network = await getNetwork();
    assert.equal(network.kind, 'aptos');
    assert.equal(network.symbol, 'APT');
    assert.equal(network.rpcProvenance, 'official-public');
  });

  test('getNetwork preserves Osmosis metadata', async () => {
    await setNetwork({
      name: 'Osmosis Mainnet',
      chainId: 118007,
      rpcUrl: 'https://rest.cosmos.directory/osmosis',
      kind: 'cosmos',
      symbol: 'OSMO',
      addressPrefix: 'osmo',
      nativeDenom: 'uosmo',
      nativeDecimals: 6,
    });
    const network = await getNetwork();
    assert.equal(network.kind, 'cosmos');
    assert.equal(network.symbol, 'OSMO');
    assert.equal(network.addressPrefix, 'osmo');
    assert.equal(network.nativeDenom, 'uosmo');
    assert.equal(network.nativeDecimals, 6);
  });
});
