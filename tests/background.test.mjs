import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function convertTestBech32Prefix(address, prefix) {
  const separator = address.lastIndexOf('1');
  const words = [...address.slice(separator + 1)].map((char) => BECH32_CHARSET.indexOf(char)).slice(0, -6);
  const data = convertTestBits(words, 5, 8, false);
  return testBech32Encode(prefix, convertTestBits(data, 8, 5, true));
}

function convertTestBech32PrefixWithTweak(address, prefix, tweak) {
  const separator = address.lastIndexOf('1');
  const words = [...address.slice(separator + 1)].map((char) => BECH32_CHARSET.indexOf(char)).slice(0, -6);
  const data = convertTestBits(words, 5, 8, false);
  data[0] ^= tweak;
  return testBech32Encode(prefix, convertTestBits(data, 8, 5, true));
}

function testBech32Encode(prefix, words) {
  const checksum = testBech32Checksum(prefix, words);
  return `${prefix}1${[...words, ...checksum].map((value) => BECH32_CHARSET[value]).join('')}`;
}

function testConsensusAddress(prefix, pubkeyBytes) {
  const hashed = createHash('ripemd160').update(createHash('sha256').update(pubkeyBytes).digest()).digest();
  return testBech32Encode(prefix, convertTestBits([...hashed], 8, 5, true));
}

function testProtoPubkeyBase64(pubkeyBytes) {
  return Buffer.from([0x0a, pubkeyBytes.length, ...pubkeyBytes]).toString('base64');
}

function testEncodeCosmosTransferTxBody(input) {
  return testEncodeMessage([
    testFieldBytes(1, testEncodeAny('/cosmos.bank.v1beta1.MsgSend', testEncodeMessage([
      testFieldString(1, input.from),
      testFieldString(2, input.to),
      testFieldBytes(3, testEncodeCoin(input.denom, input.amount)),
    ]))),
    input.memo ? testFieldString(2, input.memo) : new Uint8Array(),
  ]);
}

function testEncodeCosmosIbcTransferTxBody(input) {
  return testEncodeMessage([
    testFieldBytes(1, testEncodeAny('/ibc.applications.transfer.v1.MsgTransfer', testEncodeMessage([
      testFieldString(1, input.sourcePort),
      testFieldString(2, input.sourceChannel),
      testFieldBytes(3, testEncodeCoin(input.denom, input.amount)),
      testFieldString(4, input.sender),
      testFieldString(5, input.receiver),
      input.memo ? testFieldString(8, input.memo) : new Uint8Array(),
    ]))),
  ]);
}

function testEncodeCosmosCustomTxBody(input) {
  return testEncodeMessage([
    testFieldBytes(1, testEncodeAny('/shell.custom.v1.MsgDoThing', testEncodeMessage([
      testFieldString(1, input.signer),
      testFieldString(2, input.target),
      testFieldVarint(3, 42n),
      testFieldBytes(4, testEncodeMessage([
        testFieldString(1, 'note'),
        testFieldVarint(2, 7n),
      ])),
    ]))),
  ]);
}

function testEncodeCosmosExpandedTxBody(input) {
  return testEncodeMessage([
    testFieldBytes(1, testEncodeAny('/cosmos.bank.v1beta1.MsgMultiSend', testEncodeMessage([
      testFieldBytes(1, testEncodeCosmosMultiSendEntry(input.from, input.denom, '3')),
      testFieldBytes(2, testEncodeCosmosMultiSendEntry(input.to, input.denom, '3')),
    ]))),
    testFieldBytes(1, testEncodeAny('/cosmos.gov.v1.MsgDeposit', testEncodeMessage([
      testFieldVarint(1, 42n),
      testFieldString(2, input.from),
      testFieldBytes(3, testEncodeCoin(input.denom, '4')),
    ]))),
    testFieldBytes(1, testEncodeAny('/cosmos.authz.v1beta1.MsgGrant', testEncodeMessage([
      testFieldString(1, input.from),
      testFieldString(2, input.to),
      testFieldBytes(3, testEncodeMessage([
        testFieldBytes(1, testEncodeAny('/cosmos.authz.v1beta1.GenericAuthorization', testEncodeMessage([
          testFieldString(1, '/cosmos.bank.v1beta1.MsgSend'),
        ]))),
      ])),
    ]))),
    testFieldBytes(1, testEncodeAny('/cosmos.authz.v1beta1.MsgRevoke', testEncodeMessage([
      testFieldString(1, input.from),
      testFieldString(2, input.to),
      testFieldString(3, '/cosmos.bank.v1beta1.MsgSend'),
    ]))),
    testFieldBytes(1, testEncodeAny('/cosmos.feegrant.v1beta1.MsgGrantAllowance', testEncodeMessage([
      testFieldString(1, input.from),
      testFieldString(2, input.to),
      testFieldBytes(3, testEncodeAny('/cosmos.feegrant.v1beta1.BasicAllowance', new Uint8Array())),
    ]))),
    testFieldBytes(1, testEncodeAny('/cosmos.feegrant.v1beta1.MsgRevokeAllowance', testEncodeMessage([
      testFieldString(1, input.from),
      testFieldString(2, input.to),
    ]))),
    testFieldBytes(1, testEncodeAny('/cosmos.staking.v1beta1.MsgCancelUnbondingDelegation', testEncodeMessage([
      testFieldString(1, input.from),
      testFieldString(2, input.validator),
      testFieldBytes(3, testEncodeCoin(input.denom, '5')),
      testFieldVarint(4, 123n),
    ]))),
  ]);
}

function testEncodeCosmosMultiSendEntry(address, denom, amount) {
  return testEncodeMessage([
    testFieldString(1, address),
    testFieldBytes(2, testEncodeCoin(denom, amount)),
  ]);
}

function testEncodeCoin(denom, amount) {
  return testEncodeMessage([
    testFieldString(1, denom),
    testFieldString(2, amount),
  ]);
}

function testEncodeAny(typeUrl, value) {
  return testEncodeMessage([
    testFieldString(1, typeUrl),
    testFieldBytes(2, value),
  ]);
}

function testEncodeMessage(fields) {
  return testConcatBytes(fields.filter((field) => field.length > 0));
}

function testFieldString(fieldNumber, value) {
  return testFieldBytes(fieldNumber, new TextEncoder().encode(value));
}

function testFieldBytes(fieldNumber, value) {
  return testConcatBytes([
    testEncodeVarint(BigInt((fieldNumber << 3) | 2)),
    testEncodeVarint(BigInt(value.length)),
    value,
  ]);
}

function testFieldVarint(fieldNumber, value) {
  return testConcatBytes([
    testEncodeVarint(BigInt(fieldNumber << 3)),
    testEncodeVarint(value),
  ]);
}

function testEncodeVarint(value) {
  const bytes = [];
  let remaining = value;
  while (remaining >= 0x80n) {
    bytes.push(Number((remaining & 0x7fn) | 0x80n));
    remaining >>= 7n;
  }
  bytes.push(Number(remaining));
  return Uint8Array.from(bytes);
}

function testConcatBytes(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function testBech32Checksum(prefix, words) {
  const values = [...testBech32HrpExpand(prefix), ...words, 0, 0, 0, 0, 0, 0];
  const polymod = testBech32Polymod(values) ^ 1;
  return Array.from({ length: 6 }, (_, index) => (polymod >> (5 * (5 - index))) & 31);
}

function testBech32HrpExpand(prefix) {
  return [...prefix].map((char) => char.charCodeAt(0) >> 5).concat(0, [...prefix].map((char) => char.charCodeAt(0) & 31));
}

function testBech32Polymod(values) {
  let chk = 1;
  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i += 1) {
      if ((top >> i) & 1) chk ^= BECH32_GENERATORS[i];
    }
  }
  return chk;
}

function convertTestBits(data, fromBits, toBits, pad) {
  let value = 0;
  let bits = 0;
  const maxV = (1 << toBits) - 1;
  const result = [];
  for (const item of data) {
    value = (value << fromBits) | item;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((value >> bits) & maxV);
    }
  }
  if (pad && bits > 0) result.push((value << (toBits - bits)) & maxV);
  return result;
}

function createStorageArea() {
  const store = new Map();
  return {
    async get(keys) {
      if (keys == null) {
        return Object.fromEntries(store);
      }
      if (typeof keys === 'string') {
        return { [keys]: store.get(keys) };
      }
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.map((key) => [key, store.get(key)]));
      }
      return Object.fromEntries(
        Object.entries(keys).map(([key, fallback]) => [key, store.has(key) ? store.get(key) : fallback]),
      );
    },
    async set(value) {
      for (const [key, entry] of Object.entries(value)) {
        store.set(key, entry);
      }
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) {
        store.delete(key);
      }
    },
    async clear() {
      store.clear();
    },
  };
}

const listeners = {
  onInstalled: [],
  onStartup: [],
  onMessage: [],
  onAlarm: [],
};
let txCounter = 0;
const createdAlarms = [];
const clearedAlarms = [];
const createdWindows = [];
const COSMOS_ACTIVE_CONSENSUS_PUBKEY = Uint8Array.from({ length: 32 }, (_entry, index) => index + 1);
const COSMOS_RISKY_CONSENSUS_PUBKEY = Uint8Array.from({ length: 32 }, (_entry, index) => 64 - index);
const COSMOS_ACTIVE_CONSENSUS_ADDRESS = testConsensusAddress('cosmosvalcons', COSMOS_ACTIVE_CONSENSUS_PUBKEY);
const COSMOS_RISKY_CONSENSUS_ADDRESS = testConsensusAddress('cosmosvalcons', COSMOS_RISKY_CONSENSUS_PUBKEY);
const OSMOSIS_ACTIVE_CONSENSUS_ADDRESS = testConsensusAddress('osmovalcons', COSMOS_ACTIVE_CONSENSUS_PUBKEY);
const TON_TEP64_METADATA_BOC = 'te6ccgEBBgEAXQABAwDAAQIDgDgCBAFCv7dqfKFTwkZxZYM1u9CJRjUP/GIfocUW5xIwldT/1cWBAwAIAE9OQwFCv66A/S8eA0gOIoI2NZbudS17sn9Qd2uVCGoCeRiWdZI+BQAEADc=';
const rpcRequests = [];
const tronRequests = [];
const solanaRequests = [];
const bitcoinRequests = [];
const cosmosRequests = [];
const aptosRequests = [];
let cosmosBroadcastCounter = 0;
let tronFailureMode = 'ok';
let solanaFailureMode = 'ok';
let bitcoinHistoryMode = 'default';
let bitcoinCpfpPolicyMode = 'ok';
let aptosStatusMode = 'confirmed';
let aptosAccountMode = 'ok';
let aptosBalanceValue = '123456789';
let aptosLedgerChainId = 2;
let shellTxHistoryResult = { transactions: [], total: 0 };
let tonTransactionLookupHash = null;
let tonWalletInformationState = 'active';
let tonCenterTransactionsFail = false;
let tonJettonHistoryEnabled = false;
let tonBalanceResult = '1234567890';
let tonJettonMetadataFail = false;
let lastTonBocLength = 0;

globalThis.chrome = {
  runtime: {
    id: 'test',
    onInstalled: { addListener(fn) { listeners.onInstalled.push(fn); } },
    onStartup: { addListener(fn) { listeners.onStartup.push(fn); } },
    onMessage: { addListener(fn) { listeners.onMessage.push(fn); } },
    getURL(path) { return `chrome-extension://test/${path}`; },
  },
  alarms: {
    create(name, options) {
      createdAlarms.push({ name, options });
    },
    clear(name) {
      clearedAlarms.push(name);
    },
    onAlarm: { addListener(fn) { listeners.onAlarm.push(fn); } },
  },
  windows: {
    create(options, callback) {
      createdWindows.push(options);
      callback?.({ id: createdWindows.length });
    },
  },
  storage: {
    local: createStorageArea(),
    session: createStorageArea(),
  },
};

globalThis.fetch = async (url, init) => {
  const urlText = String(url);
  const isAptosRpc = urlText.includes('fullnode.testnet.aptoslabs.com') || urlText.includes('fullnode.devnet.aptoslabs.com');
  if (isAptosRpc && /\/v1\/?$/.test(urlText)) {
    aptosRequests.push({ url, kind: 'ledger' });
    return new Response(
      JSON.stringify({ chain_id: aptosLedgerChainId, ledger_version: '12345' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (isAptosRpc && urlText.includes('/accounts/') && urlText.includes('CoinStore')) {
    aptosRequests.push({ url, kind: 'balance' });
    if (aptosAccountMode === 'not-found') {
      return new Response(JSON.stringify({ message: 'account not found' }), { status: 404 });
    }
    return new Response(
      JSON.stringify({ data: { coin: { value: aptosBalanceValue } } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (isAptosRpc && urlText.includes('/accounts/')) {
    aptosRequests.push({ url, kind: 'account' });
    if (aptosAccountMode === 'not-found') {
      return new Response(JSON.stringify({ message: 'account not found' }), { status: 404 });
    }
    return new Response(
      JSON.stringify({ sequence_number: '9', authentication_key: '0x' + '1'.repeat(64) }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (isAptosRpc && urlText.endsWith('/estimate_gas_price')) {
    aptosRequests.push({ url, kind: 'gas' });
    return new Response(
      JSON.stringify({ gas_estimate: '100' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (isAptosRpc && urlText.includes('/transactions/by_hash/')) {
    aptosRequests.push({ url, kind: 'status', mode: aptosStatusMode });
    if (aptosStatusMode === 'not-found') {
      return new Response(JSON.stringify({ message: 'transaction not found' }), { status: 404 });
    }
    if (aptosStatusMode === 'failed-sequence') {
      return new Response(
        JSON.stringify({ type: 'user_transaction', success: false, version: '44', vm_status: 'SEQUENCE_NUMBER_TOO_OLD' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (aptosStatusMode === 'failed-gas') {
      return new Response(
        JSON.stringify({ type: 'user_transaction', success: false, version: '45', vm_status: 'OUT_OF_GAS' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({ type: 'user_transaction', success: true, version: '42', vm_status: 'Executed successfully' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (isAptosRpc && urlText.endsWith('/transactions') && init?.method === 'POST') {
    const body = init.body instanceof ArrayBuffer ? new Uint8Array(init.body) : init.body instanceof Uint8Array ? init.body : new Uint8Array();
    aptosRequests.push({ url, kind: 'broadcast', contentType: init.headers?.['content-type'], byteLength: body.length, rawTransactionChainId: readAptosRawTransactionChainId(body) });
    assert.ok(body.length > 200);
    return new Response(
      JSON.stringify({ hash: '0x' + 'a'.repeat(64) }),
      { status: 202, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).includes('/cosmos/auth/v1beta1/accounts/')) {
    cosmosRequests.push({ url, kind: 'account' });
    return new Response(
      JSON.stringify({ account: { account_number: '7', sequence: '3' } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).includes('/getAddressBalance')) {
    return new Response(
      JSON.stringify({ ok: true, result: tonBalanceResult }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).includes('/getWalletInformation')) {
    const result = tonWalletInformationState === 'uninitialized'
      ? { wallet: false, account_state: 'uninitialized' }
      : { wallet: true, account_state: 'active', seqno: 7 };
    return new Response(
      JSON.stringify({ ok: true, result }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).includes('/runGetMethod')) {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const parsed = new URL(String(url));
    const method = body.method ?? parsed.searchParams.get('method');
    const address = body.address ?? parsed.searchParams.get('address') ?? 'UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJKZ';
    const stack = method === 'get_wallet_address'
      ? [['slice', address]]
      : method === 'get_wallet_data'
        ? [['num', '1234500'], ['slice', address], ['slice', address], ['cell', '']]
        : method === 'get_jetton_data'
          ? [['num', '0'], ['num', '0'], ['slice', address], ['cell', TON_TEP64_METADATA_BOC], ['cell', '']]
        : [];
    return new Response(
      JSON.stringify({ ok: true, result: { stack } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).includes('/sendBoc')) {
    const parsed = new URL(String(url));
    const boc = parsed.searchParams.get('boc');
    assert.equal(typeof boc, 'string');
    assert.ok(boc.length > 100);
    lastTonBocLength = boc.length;
    return new Response(
      JSON.stringify({ ok: true, result: { '@type': 'ok' } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).includes('/history') && (String(url).includes('/v2/jettons/') || /\/v2\/accounts\/.+\/jettons\/.+\/history/.test(String(url)))) {
    return new Response(
      JSON.stringify({
        operations: [{
          operation: 'transfer',
          transaction_hash: '8'.repeat(64),
          utime: 1_780_000_003,
          lt: '323450',
          amount: '99000000',
          source: { address: '0:' + '5'.repeat(64) },
          destination: { address: '0:' + '6'.repeat(64) },
          jetton: { address: '0:' + '6'.repeat(64), symbol: 'JET', decimals: 6 },
        }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).includes('/v2/jettons/')) {
    if (tonJettonMetadataFail) {
      return new Response(
        JSON.stringify({ error: 'metadata unavailable' }),
        { status: 502, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({ metadata: { symbol: 'JET', decimals: '6' } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).includes('/v2/accounts/') && String(url).includes('/jettons/history')) {
    const account = decodeURIComponent(String(url).split('/v2/accounts/')[1].split('/jettons/history')[0]);
    return new Response(
      JSON.stringify({
        events: tonJettonHistoryEnabled
          ? [{
            event_id: '7'.repeat(64),
            timestamp: 1_780_000_002,
            actions: [{
              type: 'JettonTransfer',
              status: 'ok',
              JettonTransfer: {
                amount: '42000000',
                sender: { address: '0:' + '5'.repeat(64) },
                recipient: { address: account },
                jetton: { address: '0:' + '6'.repeat(64), symbol: 'JET', decimals: 6 },
              },
            }],
          }]
          : [],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).includes('/getTransactions')) {
    if (tonCenterTransactionsFail) {
      return new Response(
        JSON.stringify({ ok: false, error: 'toncenter unavailable' }),
        { status: 502, headers: { 'content-type': 'application/json' } },
      );
    }
    const remoteIncomingHash = '1'.repeat(64);
    const parsed = new URL(String(url));
    const address = parsed.searchParams.get('address') ?? '';
    return new Response(
      JSON.stringify({
        ok: true,
        result: [
          ...(tonTransactionLookupHash
            ? [{
              transaction_id: { hash: 'remote-hash', lt: '123456' },
              in_msg: { hash: tonTransactionLookupHash },
              success: true,
              compute_ph: { success: true, exit_code: 0 },
              action: { success: true },
            }]
            : []),
          {
            transaction_id: { hash: Buffer.from(remoteIncomingHash, 'hex').toString('base64'), lt: '123450' },
            utime: 1_780_000_000,
            in_msg: {
              hash: remoteIncomingHash,
              source: '0:' + '2'.repeat(64),
              destination: address,
              value: '250000000',
            },
            success: true,
            compute_ph: { success: true, exit_code: 0 },
            action: { success: true },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).includes('/v2/blockchain/accounts/') && String(url).includes('/transactions')) {
    const remoteIncomingHash = '3'.repeat(64);
    const address = decodeURIComponent(String(url).split('/v2/blockchain/accounts/')[1].split('/transactions')[0]);
    return new Response(
      JSON.stringify({
        transactions: [
          ...(tonTransactionLookupHash
            ? [{
              transaction_id: { hash: 'tonapi-remote-hash', lt: '223456' },
              in_msg: { hash: tonTransactionLookupHash },
              success: true,
              compute_ph: { success: true, exit_code: 0 },
              action: { success: true },
            }]
            : []),
          {
            transaction_id: { hash: Buffer.from(remoteIncomingHash, 'hex').toString('base64'), lt: '223450' },
            utime: 1_780_000_001,
            in_msg: {
              hash: remoteIncomingHash,
              source: '0:' + '4'.repeat(64),
              destination: address,
              value: '350000000',
            },
            success: true,
            compute_ph: { success: true, exit_code: 0 },
            action: { success: true },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).endsWith('/cosmos/tx/v1beta1/simulate') && init?.method === 'POST') {
    const body = JSON.parse(init.body);
    cosmosRequests.push({ url, kind: 'simulate', body });
    assert.equal(typeof body.tx_bytes, 'string');
    assert.ok(body.tx_bytes.length > 100);
    return new Response(
      JSON.stringify({ gas_info: { gas_used: '80000' } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).endsWith('/cosmos/tx/v1beta1/txs') && init?.method === 'POST') {
    const body = JSON.parse(init.body);
    cosmosRequests.push({ url, kind: 'broadcast', body });
    assert.equal(body.mode, 'BROADCAST_MODE_SYNC');
    assert.equal(typeof body.tx_bytes, 'string');
    assert.ok(body.tx_bytes.length > 100);
    const txHashChar = String.fromCharCode('C'.charCodeAt(0) + cosmosBroadcastCounter);
    cosmosBroadcastCounter += 1;
    return new Response(
      JSON.stringify({ tx_response: { txhash: txHashChar.repeat(64), code: 0 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (/\/cosmos\/tx\/v1beta1\/txs\/[0-9A-F]{64}$/i.test(String(url))) {
    cosmosRequests.push({ url, kind: 'status' });
    if (String(url).endsWith('F'.repeat(64))) {
      return new Response(
        JSON.stringify({
          tx_response: {
            txhash: 'F'.repeat(64),
            height: '12346',
            code: 5,
            raw_log: 'failed to execute message; message index: 0: 1500000uatom is smaller than 2500000uatom: insufficient funds',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({ tx_response: { txhash: 'C'.repeat(64), height: '12345', code: 0 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).endsWith('/utxo')) {
    bitcoinRequests.push({ url, kind: 'utxo' });
    return new Response(
      JSON.stringify([
        {
          txid: 'd'.repeat(64),
          vout: 1,
          value: 100000000,
          status: { confirmed: true },
        },
        {
          txid: 'b'.repeat(64),
          vout: 0,
          value: 20000000,
          status: { confirmed: true },
        },
      ]),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).endsWith('/fee-estimates')) {
    bitcoinRequests.push({ url, kind: 'fee' });
    return new Response(
      JSON.stringify({ 1: 5, 3: 3, 6: 2 }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).endsWith('/tx') && init?.method === 'POST') {
    const broadcastIndex = bitcoinRequests.filter((entry) => entry.kind === 'broadcast').length;
    bitcoinRequests.push({ url, kind: 'broadcast', body: init.body });
    assert.equal(typeof init.body, 'string');
    assert.match(init.body, /^020000000001/);
    assert.match(init.body, /fdffffff/);
    assert.ok(init.body.length > 300);
    const hashChar = String(url).includes('/testnet/') ? 'c' : broadcastIndex === 0 ? 'c' : 'f';
    return new Response(hashChar.repeat(64), { status: 200, headers: { 'content-type': 'text/plain' } });
  }
  if (/\/tx\/[0-9a-f]{64}\/outspend\/\d+$/i.test(String(url))) {
    bitcoinRequests.push({ url, kind: 'outspend' });
    if (bitcoinCpfpPolicyMode === 'spent') {
      return new Response(
        JSON.stringify({ spent: true, txid: '8'.repeat(64), vin: 0, status: { confirmed: false } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({ spent: false }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (/\/api\/v1\/cpfp\/[0-9a-f]{64}$/i.test(String(url))) {
    bitcoinRequests.push({ url, kind: 'cpfp' });
    const ancestors = bitcoinCpfpPolicyMode === 'ancestor-limit'
      ? Array.from({ length: 25 }, (_entry, index) => ({ txid: String(index).repeat(64).slice(0, 64), vsize: 100 }))
      : [{ txid: '9'.repeat(64), vsize: 200 }];
    const descendants = bitcoinCpfpPolicyMode === 'descendant-limit'
      ? Array.from({ length: 25 }, (_entry, index) => ({ txid: String(index).repeat(64).slice(0, 64), vsize: 100 }))
      : [];
    return new Response(
      JSON.stringify({
        ancestors,
        descendants,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (/\/tx\/[0-9a-f]{64}\/status$/i.test(String(url))) {
    bitcoinRequests.push({ url, kind: 'status' });
    return new Response(
      JSON.stringify({ confirmed: true, block_height: 840000 }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).endsWith('/txs') && String(url).includes('/address/')) {
    bitcoinRequests.push({ url, kind: 'history' });
    const address = decodeURIComponent(String(url).match(/\/address\/([^/]+)\/txs$/)?.[1] ?? '');
    if (bitcoinHistoryMode === 'cpfp') {
      return new Response(
        JSON.stringify([
          {
            txid: '9'.repeat(64),
            fee: 200,
            weight: 800,
            status: { confirmed: false },
            vin: [{
              sequence: 0xffffffff,
              prevout: {
                scriptpubkey_address: 'bc1qcounterparty000000000000000000000000000000',
                value: 30000000,
              },
            }],
            vout: [{
              scriptpubkey_address: address,
              value: 30000000,
            }],
          },
          {
            txid: 'a'.repeat(64),
            fee: 300,
            vsize: 150,
            status: { confirmed: false },
            vin: [{
              sequence: 0xffffffff,
              prevout: {
                scriptpubkey_address: 'bc1qcounterparty111111111111111111111111111111',
                value: 30000000,
              },
            }],
            vout: [{
              scriptpubkey_address: address,
              value: 30000000,
            }],
          },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify([{
        txid: 'e'.repeat(64),
        status: { confirmed: true, block_height: 839999, block_time: 1700000000 },
        vin: [{
          sequence: 0xfffffffd,
          prevout: {
            scriptpubkey_address: 'bc1qcounterparty000000000000000000000000000000',
            value: 20000000,
          },
        }],
        vout: [{
          scriptpubkey_address: address,
          value: 20000000,
        }],
      }]),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).includes('/address/')) {
    bitcoinRequests.push({ url, kind: 'balance' });
    return new Response(
      JSON.stringify({
        chain_stats: { funded_txo_sum: 100000000, spent_txo_sum: 25000000 },
        mempool_stats: { funded_txo_sum: 5000000, spent_txo_sum: 0 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).includes('/cosmos/bank/v1beta1/balances/')) {
    cosmosRequests.push({ url, kind: 'balance' });
    if (String(url).includes('/osmosis/')) {
      return new Response(
        JSON.stringify({ balances: [{ denom: 'uosmo', amount: '7654321' }, { denom: 'uatom', amount: '1' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({ balances: [{ denom: 'uatom', amount: '1234567' }, { denom: 'ibc/' + 'A'.repeat(64), amount: '42' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).includes('/ibc/apps/transfer/v1/denom_traces/')) {
    cosmosRequests.push({ url, kind: 'denomTrace' });
    return new Response(
      JSON.stringify({
        denom_trace: {
          path: 'transfer/channel-141',
          base_denom: 'uosmo',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).includes('/cosmos/staking/v1beta1/delegations/')) {
    cosmosRequests.push({ url, kind: 'delegations' });
    return new Response(
      JSON.stringify({
        delegation_responses: [{
          delegation: { validator_address: 'cosmosvaloper1validator000000000000000000000000000' },
          balance: { denom: String(url).includes('/osmosis/') ? 'uosmo' : 'uatom', amount: String(url).includes('/osmosis/') ? '2000000' : '3000000' },
        }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).includes('/cosmos/staking/v1beta1/delegators/') && String(url).includes('/redelegations')) {
    cosmosRequests.push({ url, kind: 'redelegations' });
    return new Response(
      JSON.stringify({
        redelegation_responses: [{
          redelegation: {
            validator_src_address: 'cosmosvaloper1source00000000000000000000000000000',
            validator_dst_address: 'cosmosvaloper1dest0000000000000000000000000000000',
          },
          entries: [{
            redelegation_entry: {
              creation_height: '1234',
              completion_time: '2026-07-01T00:00:00Z',
              initial_balance: String(url).includes('/osmosis/') ? '750000' : '1500000',
            },
            balance: String(url).includes('/osmosis/') ? '750000' : '1500000',
          }],
        }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).includes('/cosmos/staking/v1beta1/validators?')) {
    cosmosRequests.push({ url, kind: 'validators' });
    return new Response(
      JSON.stringify({
        validators: [
          {
            operator_address: 'cosmosvaloper1active000000000000000000000000000000',
            consensus_pubkey: {
              type_url: '/cosmos.crypto.ed25519.PubKey',
              value: testProtoPubkeyBase64(COSMOS_ACTIVE_CONSENSUS_PUBKEY),
            },
            description: { moniker: String(url).includes('/osmosis/') ? 'Osmosis Active' : 'Cosmos Active' },
            status: 'BOND_STATUS_BONDED',
            jailed: false,
            tokens: '1000000000',
            delegator_shares: '1000000000.000000000000000000',
            min_self_delegation: '1000000',
            commission: {
              commission_rates: {
                rate: '0.050000000000000000',
                max_rate: '0.100000000000000000',
                max_change_rate: '0.010000000000000000',
              },
            },
          },
          {
            operator_address: 'cosmosvaloper1risky0000000000000000000000000000000',
            consensus_pubkey: {
              type_url: '/cosmos.crypto.ed25519.PubKey',
              value: testProtoPubkeyBase64(COSMOS_RISKY_CONSENSUS_PUBKEY),
            },
            description: { moniker: 'Risky Validator' },
            status: 'BOND_STATUS_UNBONDING',
            jailed: true,
            tokens: '1',
            delegator_shares: '1.000000000000000000',
            min_self_delegation: '1',
            commission: {
              commission_rates: {
                rate: '0.250000000000000000',
                max_rate: '1.000000000000000000',
                max_change_rate: '0.500000000000000000',
              },
            },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).includes('/cosmos/slashing/v1beta1/signing_infos')) {
    cosmosRequests.push({ url, kind: 'signingInfos' });
    return new Response(
      JSON.stringify({
        info: [
          {
            address: String(url).includes('/osmosis/') ? OSMOSIS_ACTIVE_CONSENSUS_ADDRESS : COSMOS_ACTIVE_CONSENSUS_ADDRESS,
            start_height: '10',
            index_offset: '250',
            jailed_until: '1970-01-01T00:00:00Z',
            tombstoned: false,
            missed_blocks_counter: '0',
          },
          {
            address: COSMOS_RISKY_CONSENSUS_ADDRESS,
            start_height: '20',
            index_offset: '500',
            jailed_until: '2026-07-02T00:00:00Z',
            tombstoned: true,
            missed_blocks_counter: '42',
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).includes('/cosmos/gov/v1/params/tallying')) {
    cosmosRequests.push({ url, kind: 'governanceParams' });
    return new Response(
      JSON.stringify({
        params: {
          quorum: '0.334000000000000000',
          threshold: '0.500000000000000000',
          veto_threshold: '0.334000000000000000',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).includes('/cosmos/gov/v1/proposals/12/tally')) {
    cosmosRequests.push({ url, kind: 'governanceTally' });
    return new Response(
      JSON.stringify({
        tally: {
          yes_count: '300',
          no_count: '600',
          abstain_count: '50',
          no_with_veto_count: '400',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).includes('/cosmos/gov/v1/proposals/11/tally')) {
    cosmosRequests.push({ url, kind: 'governanceTally' });
    return new Response(
      JSON.stringify({
        tally: {
          yes_count: '1000',
          no_count: '0',
          abstain_count: '25',
          no_with_veto_count: '0',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).includes('/cosmos/gov/v1/proposals/12/votes/')) {
    cosmosRequests.push({ url, kind: 'governanceVote' });
    return new Response(
      JSON.stringify({
        vote: {
          options: [{ option: 'VOTE_OPTION_YES', weight: '1.000000000000000000' }],
          metadata: 'wallet vote note',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).includes('/cosmos/gov/v1/proposals/11/votes/')) {
    cosmosRequests.push({ url, kind: 'governanceVote' });
    return new Response(
      JSON.stringify({ message: 'vote not found' }),
      { status: 404, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).includes('/cosmos/gov/v1/proposals')) {
    cosmosRequests.push({ url, kind: 'governanceProposals' });
    return new Response(
      JSON.stringify({
        proposals: [
          {
            id: '12',
            title: 'Increase community pool spend limit',
            summary: 'Raises the spend limit after community review.',
            status: 'PROPOSAL_STATUS_VOTING_PERIOD',
            submit_time: '2026-06-01T00:00:00Z',
            deposit_end_time: '2026-06-15T00:00:00Z',
            voting_start_time: '2026-06-19T00:00:00Z',
            voting_end_time: '2026-07-03T00:00:00Z',
            total_deposit: [{ denom: String(url).includes('/osmosis/') ? 'uosmo' : 'uatom', amount: '1000000' }],
          },
          {
            id: '11',
            messages: [{
              content: {
                title: 'Legacy text proposal',
                description: 'Legacy proposal body',
              },
            }],
            status: 'PROPOSAL_STATUS_PASSED',
            voting_end_time: '2026-06-01T00:00:00Z',
            total_deposit: [],
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).includes('/cosmos/staking/v1beta1/validators/')) {
    cosmosRequests.push({ url, kind: 'validator' });
    return new Response(
      JSON.stringify({ validator: { description: { moniker: String(url).includes('/osmosis/') ? 'Osmosis Validator' : 'Cosmos Validator' } } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  const body = JSON.parse(init.body);
  if (String(url).endsWith('/wallet/getaccount')) {
    tronRequests.push({ url, body });
    return new Response(
      JSON.stringify({ balance: 123456789 }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).endsWith('/wallet/createtransaction')) {
    tronRequests.push({ url, body });
    return new Response(
      JSON.stringify({
        txID: 'a'.repeat(64),
        raw_data: { contract: [] },
        raw_data_hex: '0a02',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).endsWith('/wallet/triggerconstantcontract')) {
    tronRequests.push({ url, body });
    const resultBySelector = {
      'decimals()': '0'.repeat(63) + '6',
      'symbol()': '0'.repeat(62) + '20' + '0'.repeat(63) + '4' + Buffer.from('USDT').toString('hex').padEnd(64, '0'),
      'balanceOf(address)': '0'.repeat(58) + '12d644',
    };
    if (!(body.function_selector in resultBySelector)) {
      throw new Error(`Unexpected Tron constant selector: ${body.function_selector}`);
    }
    return new Response(
      JSON.stringify({ result: { result: true }, constant_result: [resultBySelector[body.function_selector]] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).endsWith('/wallet/triggersmartcontract')) {
    tronRequests.push({ url, body });
    if (tronFailureMode === 'trigger-revert') {
      return new Response(
        JSON.stringify({
          result: {
            result: false,
            code: 'CONTRACT_VALIDATE_ERROR',
            message: Buffer.from('REVERT opcode executed').toString('hex'),
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({
        txID: 'b'.repeat(64),
        raw_data: { contract: [] },
        raw_data_hex: '0a03',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).endsWith('/wallet/broadcasttransaction')) {
    tronRequests.push({ url, body });
    assert.match(body.txID, /^[ab]{64}$/);
    assert.equal(body.signature.length, 1);
    assert.match(body.signature[0], /^[0-9a-f]{128}$/);
    if (tronFailureMode === 'broadcast-energy') {
      return new Response(
        JSON.stringify({
          result: false,
          code: 'OUT_OF_ENERGY',
          message: Buffer.from('Not enough Energy for transaction').toString('hex'),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (tronFailureMode === 'broadcast-bandwidth') {
      return new Response(
        JSON.stringify({
          result: false,
          code: 'BANDWIDTH_ERROR',
          message: Buffer.from('Account bandwidth is insufficient').toString('hex'),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({ result: true, txid: body.txID }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (String(url).endsWith('/wallet/gettransactioninfobyid')) {
    tronRequests.push({ url, body });
    if (tronFailureMode === 'status-revert') {
      return new Response(
        JSON.stringify({
          id: body.value,
          blockNumber: 43,
          receipt: { result: 'REVERT' },
          resMessage: Buffer.from('execution reverted: TRC20 transfer amount exceeds balance').toString('hex'),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({ id: body.value, blockNumber: 42, receipt: { result: 'SUCCESS' } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  rpcRequests.push({ url, body });
  const solanaResultByMethod = {
    getBalance: { value: 1234567890 },
    getLatestBlockhash: { value: { blockhash: '11111111111111111111111111111111' } },
    sendTransaction: 'solsig111111111111111111111111111111111111111111111111111111111111',
    getSignatureStatuses: { value: [{ confirmationStatus: 'confirmed', err: null }] },
    getMinimumBalanceForRentExemption: { value: 2039280 },
    getParsedAccountInfo: {
      value: {
        data: {
          parsed: {
            info: {
              decimals: 6,
            },
          },
        },
      },
    },
    getTokenAccountsByOwner: {
      value: [
        {
          pubkey: 'So11111111111111111111111111111111111111112',
          account: {
            data: {
              parsed: {
                info: {
                  tokenAmount: {
                    amount: '1234500',
                    decimals: 6,
                  },
                },
              },
            },
          },
        },
      ],
    },
  };
  if (body.method in solanaResultByMethod) {
    solanaRequests.push({ url, body });
    if (body.method === 'sendTransaction') {
      assert.equal(body.params[1].encoding, 'base64');
      assert.equal(typeof body.params[0], 'string');
      assert.ok(body.params[0].length > 100);
      if (solanaFailureMode === 'blockhash-expired') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            error: { code: -32002, message: 'Transaction simulation failed: Blockhash not found' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (solanaFailureMode === 'priority-fee') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            error: { code: -32002, message: 'Transaction simulation failed: ComputationalBudgetExceeded' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
    }
    if (body.method === 'getSignatureStatuses' && solanaFailureMode === 'status-blockhash-expired') {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: { value: [{ confirmationStatus: 'confirmed', err: { InstructionError: [0, 'BlockhashNotFound'] } }] },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (
      body.method === 'getTokenAccountsByOwner' &&
      solanaFailureMode === 'missing-recipient-token-account' &&
      body.params[0] === '11111111111111111111111111111111'
    ) {
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { value: [] } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: solanaResultByMethod[body.method],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (body.method === 'eth_call') {
    const data = String(body.params?.[0]?.data ?? '').toLowerCase();
    const erc20ResultBySelector = {
      '0x313ce567': '0x' + '12'.padStart(64, '0'),
      '0x95d89b41': '0x' + '20'.padStart(64, '0') + '8'.padStart(64, '0') + Buffer.from('SHELLUSD').toString('hex').padEnd(64, '0'),
      [`0x70a08231${'0'.repeat(64)}`]: '0x' + '112210f47de98115'.padStart(64, '0'),
    };
    if (data.startsWith('0x70a08231')) {
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: body.id, result: erc20ResultBySelector[`0x70a08231${'0'.repeat(64)}`] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (data in erc20ResultBySelector) {
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: body.id, result: erc20ResultBySelector[data] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
  }
  const resultByMethod = {
    eth_getBalance: '0xde0b6b3a7640000',
    eth_getTransactionCount: '0x0',
    eth_chainId: '0x67932',
    eth_blockNumber: '0x2a',
    eth_call: '0x' + '0'.repeat(63) + '7',
    shell_getTransactionsByAddress: shellTxHistoryResult,
  };

  if (body.method === 'shell_sendTransaction') {
    txCounter += 1;
    resultByMethod.shell_sendTransaction = `0x${txCounter.toString(16).padStart(64, '0')}`;
  }

  if (!(body.method in resultByMethod)) {
    throw new Error(`Unexpected RPC method: ${body.method} (${url})`);
  }

  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: body.id,
      result: resultByMethod[body.method],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
};

function readAptosRawTransactionChainId(body) {
  // RawTransaction.chain_id is the final raw-transaction byte. The current
  // wallet signs with Ed25519, whose authenticator tail is fixed length:
  // variant(1) + public_key_len(1) + public_key(32) + sig_len(1) + sig(64).
  return body[body.length - 100];
}

const { handleMessage, toSafeErrorMessage } = await import('../dist/background.js');
const { getTxQueue, setTxQueue, upsertTxRecord } = await import('../dist/store.js');

function resetAlarmState() {
  createdAlarms.length = 0;
  clearedAlarms.length = 0;
  createdWindows.length = 0;
  rpcRequests.length = 0;
  tronRequests.length = 0;
  solanaRequests.length = 0;
  bitcoinRequests.length = 0;
  cosmosRequests.length = 0;
  aptosRequests.length = 0;
  cosmosBroadcastCounter = 0;
  tronFailureMode = 'ok';
  solanaFailureMode = 'ok';
  tonTransactionLookupHash = null;
  tonWalletInformationState = 'active';
  tonCenterTransactionsFail = false;
  tonJettonHistoryEnabled = false;
  tonBalanceResult = '1234567890';
  tonJettonMetadataFail = false;
  lastTonBocLength = 0;
  bitcoinHistoryMode = 'default';
  bitcoinCpfpPolicyMode = 'ok';
  aptosStatusMode = 'confirmed';
  aptosAccountMode = 'ok';
  aptosBalanceValue = '123456789';
  aptosLedgerChainId = 2;
}

function dispatchRuntimeMessage(message) {
  return new Promise((resolve) => {
    listeners.onMessage[0](message, undefined, resolve);
  });
}

async function resolveLatestApproval(approved = true, previousCount = 0) {
  for (let i = 0; i < 10 && createdWindows.length <= previousCount; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.ok(createdWindows.length > previousCount, 'expected an approval popup to be created');
  const latest = createdWindows[createdWindows.length - 1];
  const url = new URL(latest.url);
  const requestId = url.searchParams.get('approvalId');
  assert.ok(requestId, 'approval popup URL should contain requestId');
  const request = await handleMessage({ type: 'GET_APPROVAL_REQUEST', requestId });
  assert.equal(typeof request.kind, 'string');
  await handleMessage({ type: 'RESOLVE_APPROVAL', requestId, approved });
  return request;
}

describe('background e2e', () => {

test('create wallet -> snapshot -> export -> reset -> import', async () => {
  txCounter = 0;
  resetAlarmState();
  await handleMessage({ type: 'RESET_WALLET' });

  const created = await handleMessage({ type: 'CREATE_WALLET', password: 'correct horse battery' });
  assert.match(created.pqAddress, /^0x[0-9a-f]{64}$/);

  const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
  assert.equal(snapshot.locked, false);
  assert.equal(snapshot.primaryAccount.pqAddress, created.pqAddress);
  assert.equal(snapshot.activeAccountId, `imported:${created.pqAddress}`);
  assert.equal(snapshot.activeMultichainAccount.primaryAddress, created.pqAddress);
  assert.equal(snapshot.activeMultichainAccount.addresses.find((entry) => entry.addressKey === 'shell').signatureScheme, 'ml-dsa-65');
  assert.equal(snapshot.activeMultichainAccount.addresses.find((entry) => entry.addressKey === 'shell').isShellAuthority, true);
  assert.equal(snapshot.balance.raw, '1000000000000000000');
  assert.equal(snapshot.nonce, 0);
  assert.equal(snapshot.detectedChainId, 424242);

  const exported = await handleMessage({ type: 'EXPORT_KEYSTORE' });
  assert.match(exported.keystoreJson, /"cipher":"xchacha20-poly1305"/);

  await handleMessage({ type: 'RESET_WALLET' });
  const afterReset = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
  assert.equal(afterReset.primaryAccount, null);

  const imported = await handleMessage({
    type: 'IMPORT_KEYSTORE',
    keystoreJson: exported.keystoreJson,
    password: 'correct horse battery',
  });
  assert.equal(imported.pqAddress, created.pqAddress);
});

test('send transaction records local pending activity', async () => {
  txCounter = 0;
  shellTxHistoryResult = { transactions: [], total: 0 };
  resetAlarmState();
  await handleMessage({ type: 'RESET_WALLET' });
  const created = await handleMessage({ type: 'CREATE_WALLET', password: 'correct horse battery' });

  const sent = await handleMessage({
    type: 'SEND_TX',
    to: created.pqAddress,
    value: '1.25',
    data: '0x',
  });
  const sentSecond = await handleMessage({
    type: 'SEND_TX',
    to: created.pqAddress,
    value: '0.5',
    data: '0x',
  });

  assert.match(sent.txHash, /^0x[0-9a-f]+$/);
  assert.match(sentSecond.txHash, /^0x[0-9a-f]+$/);

  const history = await handleMessage({
    type: 'GET_TX_HISTORY',
    address: created.pqAddress,
    page: 0,
  });

  assert.equal(history.txs.length, 2);
  assert.equal(history.txs[0].status, 'pending');
  assert.equal(history.txs[0].source, 'local');
  assert.equal(history.txs[1].source, 'local');
  assert.deepEqual(history.txs.map((tx) => tx.nonce).sort((a, b) => a - b), [0, 1]);
});

test('remote transaction history preserves reward metadata', async () => {
  txCounter = 0;
  resetAlarmState();
  await handleMessage({ type: 'RESET_WALLET' });
  const created = await handleMessage({ type: 'CREATE_WALLET', password: 'correct horse battery' });

  shellTxHistoryResult = {
    total: 1,
    transactions: [{
      hash: '0x' + 'a'.repeat(64),
      from: 'pq1prover',
      to: created.pqAddress,
      value: '50000000000000000000',
      input: '0x',
      timestamp: 1234,
      status: 'confirmed',
      blockNumber: '0x2a',
      type: '0x0',
      shellType: 'starkReward',
      rewardKind: 'starkReward',
      rewardLayer: '0x2',
      rewardSourceHash: '0x' + 'b'.repeat(64),
      originalSize: '0x2710',
      compressedSize: '0x80',
    }],
  };

  const history = await handleMessage({
    type: 'GET_TX_HISTORY',
    address: created.pqAddress,
    page: 0,
  });

  assert.equal(history.total, 1);
  assert.equal(history.txs.length, 1);
  assert.deepEqual({
    shellType: history.txs[0].shellType,
    rewardKind: history.txs[0].rewardKind,
    rewardLayer: history.txs[0].rewardLayer,
    rewardSourceHash: history.txs[0].rewardSourceHash,
    originalSize: history.txs[0].originalSize,
    compressedSize: history.txs[0].compressedSize,
  }, {
    shellType: 'starkReward',
    rewardKind: 'starkReward',
    rewardLayer: '0x2',
    rewardSourceHash: '0x' + 'b'.repeat(64),
    originalSize: '0x2710',
    compressedSize: '0x80',
  });
});

test('wrong password is reported safely and without internal details', async () => {
  txCounter = 0;
  resetAlarmState();
  await handleMessage({ type: 'RESET_WALLET' });
  const exported = await dispatchRuntimeMessage({
    type: 'CREATE_WALLET',
    password: 'correct horse battery',
  });
  assert.equal(exported.ok, undefined);

  await handleMessage({ type: 'LOCK_WALLET' });
  const response = await dispatchRuntimeMessage({
    type: 'UNLOCK_WALLET',
    password: 'wrong password',
  });

  assert.equal(response.ok, false);
  assert.equal(response.error, 'Incorrect password or corrupted keystore');
  assert.equal(response.error.includes('ciphertext'), false);
  assert.equal(response.error.includes('kdf_params'), false);
});

test('native chain failures are mapped to recoverable safe messages', () => {
  assert.equal(
    toSafeErrorMessage(new Error('ton rpc request failed: 503 Service Unavailable')),
    'RPC request failed. Check network settings and try again.',
  );
  assert.equal(
    toSafeErrorMessage(new Error('cosmos simulate request failed: 502 Bad Gateway')),
    'RPC request failed. Check network settings and try again.',
  );
  assert.equal(
    toSafeErrorMessage(new Error('account sequence mismatch, expected 42, got 41')),
    'Transaction nonce changed. Refresh wallet state and try again.',
  );
  assert.equal(
    toSafeErrorMessage(new Error('seqno is too old for this wallet')),
    'Transaction nonce changed. Refresh wallet state and try again.',
  );
  assert.equal(
    toSafeErrorMessage(new Error('insufficient funds for gas * price + amount')),
    'Insufficient balance for amount and fees.',
  );
  assert.equal(
    toSafeErrorMessage(new Error('tx already exists in cache')),
    'Transaction may already be broadcast. Check history before retrying.',
  );
  assert.equal(
    toSafeErrorMessage(new Error('invalid BOC: exotic cell is not supported')),
    'Transaction could not be serialized. Check transaction details and try again.',
  );
  assert.equal(
    toSafeErrorMessage(new Error('Insufficient TON balance for Jetton transfer fee')),
    'Insufficient TON balance for Jetton transfer fee',
  );
  assert.equal(
    toSafeErrorMessage(new Error('Solana blockhash expired. Refresh the transaction and try again.')),
    'Solana blockhash expired. Refresh the transaction and try again.',
  );
  assert.equal(
    toSafeErrorMessage(new Error('Solana transaction needs a higher priority fee or compute budget. Retry with priority fee support enabled.')),
    'Solana transaction needs a higher priority fee or compute budget. Retry with priority fee support enabled.',
  );
  assert.equal(
    toSafeErrorMessage(new Error('Recipient SPL token account not found. Create the recipient ATA first; automatic creation requires rent and an extra instruction.')),
    'Recipient SPL token account not found. Create the recipient ATA first; automatic creation requires rent and an extra instruction.',
  );
  assert.equal(
    toSafeErrorMessage(new Error('aptos tx status request failed: 500 Internal Server Error')),
    'RPC request failed. Check network settings and try again.',
  );
  assert.equal(
    toSafeErrorMessage(new Error('Aptos transaction ran out of gas.')),
    'Aptos transaction ran out of gas.',
  );
  assert.equal(
    toSafeErrorMessage(new Error('Aptos account is not funded or not created. Fund it before sending.')),
    'Aptos account is not funded or not created. Fund it before sending.',
  );
});

test('tampered keystore and startup relock are enforced', async () => {
  txCounter = 0;
  resetAlarmState();
  await handleMessage({ type: 'RESET_WALLET' });

  await handleMessage({ type: 'CREATE_WALLET', password: 'correct horse battery' });
  const exported = await handleMessage({ type: 'EXPORT_KEYSTORE' });
  const tampered = JSON.parse(exported.keystoreJson);
  tampered.public_key = tampered.public_key.replace(/.$/, tampered.public_key.endsWith('0') ? '1' : '0');

  await handleMessage({ type: 'RESET_WALLET' });
  const tamperedResponse = await dispatchRuntimeMessage({
    type: 'IMPORT_KEYSTORE',
    keystoreJson: JSON.stringify(tampered),
    password: 'correct horse battery',
  });
  assert.equal(tamperedResponse.ok, false);
  assert.equal(tamperedResponse.error, 'Keystore address does not match public key');

  await handleMessage({ type: 'CREATE_WALLET', password: 'correct horse battery' });
  assert.equal((await handleMessage({ type: 'CHECK_LOCKED' })).locked, false);
  await listeners.onStartup[0]();
  assert.equal((await handleMessage({ type: 'CHECK_LOCKED' })).locked, true);
});

test('auto-lock can be configured and is triggered by alarm', async () => {
  txCounter = 0;
  resetAlarmState();
  await handleMessage({ type: 'RESET_WALLET' });
  await handleMessage({ type: 'CREATE_WALLET', password: 'correct horse battery' });
  await handleMessage({ type: 'SET_AUTO_LOCK', minutes: 3 });

  assert.equal(createdAlarms.some((alarm) => alarm.name === 'shella-auto-lock'), true);
  await listeners.onAlarm[0]({ name: 'shella-auto-lock' });
  assert.equal((await handleMessage({ type: 'CHECK_LOCKED' })).locked, true);
  assert.equal(clearedAlarms.includes('shella-auto-lock'), true);
});

test('disabling auto-lock clears any existing alarm', async () => {
  txCounter = 0;
  resetAlarmState();
  await handleMessage({ type: 'RESET_WALLET' });
  await handleMessage({ type: 'CREATE_WALLET', password: 'correct horse battery' });
  await handleMessage({ type: 'SET_AUTO_LOCK', minutes: 5 });
  await handleMessage({ type: 'SET_AUTO_LOCK', minutes: 0 });

  assert.equal(clearedAlarms.includes('shella-auto-lock'), true);
});

test('manifest permissions remain minimal', async () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.permissions, ['storage', 'alarms']);
  assert.deepEqual(manifest.host_permissions, ['http://*/*', 'https://*/*']);
});

test('native key lifecycle clears Aptos key material with other native keys', async () => {
  const source = readFileSync(new URL('../src/background.ts', import.meta.url), 'utf8');
  const clearHelper = source.match(/function clearNativeChainKeys\(\): void \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(clearHelper, /replaceCurrentTronKey\(null\)/);
  assert.match(clearHelper, /replaceCurrentSolanaKey\(null\)/);
  assert.match(clearHelper, /replaceCurrentBitcoinKeys\(\{\}\)/);
  assert.match(clearHelper, /replaceCurrentCosmosKeyPair\(null\)/);
  assert.match(clearHelper, /replaceCurrentTonKey\(null\)/);
  assert.match(clearHelper, /replaceCurrentAptosKeyPair\(null\)/);
});

test('dapp provider grants site access and proxies read methods', async () => {
  txCounter = 0;
  resetAlarmState();
  await handleMessage({ type: 'RESET_WALLET' });
  const created = await handleMessage({ type: 'CREATE_WALLET', password: 'correct horse battery' });

  const approvalsBeforeConnect = createdWindows.length;
  const accountsPromise = handleMessage({
    type: 'DAPP_REQUEST',
    origin: 'https://app.shell.org',
    method: 'eth_requestAccounts',
    params: [],
  });
  await resolveLatestApproval(true, approvalsBeforeConnect);
  const accounts = await accountsPromise;
  assert.deepEqual(accounts, [created.pqAddress]);

  const connected = await handleMessage({ type: 'GET_CONNECTED_SITES' });
  assert.equal(connected.sites.length, 1);
  assert.equal(connected.sites[0].origin, 'https://app.shell.org');
  assert.deepEqual(connected.sites[0].accounts, [created.pqAddress]);

  const chainId = await handleMessage({
    type: 'DAPP_REQUEST',
    origin: 'https://app.shell.org',
    method: 'eth_chainId',
    params: [],
  });
  assert.equal(chainId, '0x67932');

  const netVersion = await handleMessage({
    type: 'DAPP_REQUEST',
    origin: 'https://app.shell.org',
    method: 'net_version',
    params: [],
  });
  assert.equal(netVersion, '424242');

  const blockNumber = await handleMessage({
    type: 'DAPP_REQUEST',
    origin: 'https://app.shell.org',
    method: 'eth_blockNumber',
    params: [],
  });
  assert.equal(blockNumber, '0x2a');

  const pqAddress = await handleMessage({
    type: 'DAPP_REQUEST',
    origin: 'https://app.shell.org',
    method: 'shella_getPqAddress',
    params: [],
  });
  assert.equal(pqAddress, created.pqAddress);

  await handleMessage({ type: 'REMOVE_CONNECTED_SITE', origin: 'https://app.shell.org' });
  const noAccounts = await handleMessage({
    type: 'DAPP_REQUEST',
    origin: 'https://app.shell.org',
    method: 'eth_accounts',
    params: [],
  });
  assert.deepEqual(noAccounts, []);
});

test('dapp provider supports permissions, revocation, and Shell message signing approvals', async () => {
  txCounter = 0;
  resetAlarmState();
  await handleMessage({ type: 'RESET_WALLET' });
  const created = await handleMessage({ type: 'CREATE_WALLET', password: 'correct horse battery' });

  const approvalsBeforeRequest = createdWindows.length;
  const permissionsPromise = handleMessage({
    type: 'DAPP_REQUEST',
    origin: 'https://sign.example.com',
    method: 'wallet_requestPermissions',
    params: [{ eth_accounts: {} }],
  });
  const connectRequest = await resolveLatestApproval(true, approvalsBeforeRequest);
  assert.equal(connectRequest.payload.approvalRisk.riskLevel, 'low');
  const permissions = await permissionsPromise;
  assert.equal(permissions[0].parentCapability, 'eth_accounts');
  assert.deepEqual(permissions[0].caveats[0].value, [created.pqAddress]);

  const currentPermissions = await handleMessage({
    type: 'DAPP_REQUEST',
    origin: 'https://sign.example.com',
    method: 'wallet_getPermissions',
    params: [],
  });
  assert.deepEqual(currentPermissions[0].caveats[0].value, [created.pqAddress]);
  const permissionSnapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
  const connected = permissionSnapshot.wallet.connectedSites.find((site) => site.origin === 'https://sign.example.com');
  assert.deepEqual(connected.accountIds, [`imported:${created.pqAddress}`]);
  assert.deepEqual(connected.accounts, [created.pqAddress], 'provider-facing accounts must remain Shell/PQ addresses');

  const approvalsBeforeSign = createdWindows.length;
  const signPromise = handleMessage({
    type: 'DAPP_REQUEST',
    origin: 'https://sign.example.com',
    method: 'personal_sign',
    params: ['Shell login challenge', created.pqAddress],
  });
  const signRequest = await resolveLatestApproval(true, approvalsBeforeSign);
  assert.equal(signRequest.kind, 'sign-message');
  assert.equal(signRequest.payload.approvalRisk.riskLevel, 'medium');
  assert.match(await signPromise, /^0x[0-9a-f]+$/);

  const approvalsBeforeTyped = createdWindows.length;
  const typedPromise = handleMessage({
    type: 'DAPP_REQUEST',
    origin: 'https://sign.example.com',
    method: 'eth_signTypedData_v4',
    params: [created.pqAddress, JSON.stringify({
      domain: { name: 'Shell dApp', chainId: 424242, verifyingContract: '0x' + '12'.repeat(32) },
      primaryType: 'Permit',
      types: { Permit: [{ name: 'spender', type: 'address' }] },
      message: { spender: '0x' + '34'.repeat(32) },
    })],
  });
  const typedRequest = await resolveLatestApproval(true, approvalsBeforeTyped);
  assert.equal(typedRequest.kind, 'sign-typed-data');
  assert.equal(typedRequest.payload.typedDataSummary.primaryType, 'Permit');
  assert.match(await typedPromise, /^0x[0-9a-f]+$/);

  await handleMessage({
    type: 'DAPP_REQUEST',
    origin: 'https://sign.example.com',
    method: 'wallet_revokePermissions',
    params: [{ eth_accounts: {} }],
  });
  const accountsAfterRevoke = await handleMessage({
    type: 'DAPP_REQUEST',
    origin: 'https://sign.example.com',
    method: 'eth_accounts',
    params: [],
  });
  assert.deepEqual(accountsAfterRevoke, []);
});

test('dapp sessions snapshot unifies local, WalletConnect, and TonConnect revocation', async () => {
  resetAlarmState();
  await handleMessage({ type: 'RESET_WALLET' });
  await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art', password: 'correct horse battery' });

  const approvalsBeforeConnect = createdWindows.length;
  const accountsPromise = handleMessage({
    type: 'DAPP_REQUEST',
    origin: 'https://sessions.example',
    method: 'eth_requestAccounts',
    params: [],
  });
  await resolveLatestApproval(true, approvalsBeforeConnect);
  await accountsPromise;

  await handleMessage({
    type: 'CREATE_WALLETCONNECT_SESSION',
    topic: 'wc-unified',
    origin: 'https://wc-unified.example',
    chainIds: [424242],
    methods: ['eth_chainId', 'eth_sendTransaction'],
    expirySeconds: 3600,
  });
  await handleMessage({
    type: 'SET_NETWORK',
    network: { name: 'TON Mainnet', chainId: 607, rpcUrl: 'https://toncenter.com/api/v2', kind: 'ton', symbol: 'TON', rpcProvenance: 'third-party-public' },
  });
  await handleMessage({
    type: 'CREATE_TONCONNECT_SESSION',
    clientId: 'ton-unified',
    origin: 'https://ton-unified.example',
    manifestUrl: 'https://ton-unified.example/tonconnect-manifest.json',
    features: [{ name: 'SendTransaction', maxMessages: 4 }],
    expirySeconds: 3600,
  });

  const snapshot = await handleMessage({ type: 'GET_DAPP_SESSIONS_SNAPSHOT' });
  assert.ok(snapshot.sessions.length >= 3);
  assert.ok(snapshot.sessions.some((session) => session.id === 'connected-site:https://sessions.example' && session.protocol === 'EIP-1193'));
  assert.ok(snapshot.sessions.some((session) => session.id === 'walletconnect:wc-unified' && session.riskFlags.includes('can request signing')));
  assert.ok(snapshot.sessions.some((session) => session.id === 'tonconnect:ton-unified' && session.protocol === 'TonConnect'));

  await handleMessage({ type: 'REVOKE_DAPP_SESSION', sessionId: 'walletconnect:wc-unified' });
  const afterWalletConnectRevoke = await handleMessage({ type: 'GET_DAPP_SESSIONS_SNAPSHOT' });
  assert.equal(afterWalletConnectRevoke.sessions.some((session) => session.id === 'walletconnect:wc-unified'), false);

  await handleMessage({ type: 'REVOKE_DAPP_SESSION', sessionId: 'connected-site:https://sessions.example' });
  const afterLocalRevoke = await handleMessage({ type: 'GET_CONNECTED_SITES' });
  assert.equal(afterLocalRevoke.sites.some((site) => site.origin === 'https://sessions.example'), false);
});

test('disconnect all clears dApp, WalletConnect, and TonConnect sessions without deleting wallet data', async () => {
  const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';
  const password = 'hdwallet-test-password!';
  await handleMessage({ type: 'RESET_WALLET' });
  const created = await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic, password });
  await handleMessage({ type: 'ADD_CONNECTED_SITE', origin: 'https://dapp.example' });
  await handleMessage({
    type: 'CREATE_WALLETCONNECT_SESSION',
    topic: 'wc-disconnect-all',
    origin: 'https://wc-disconnect.example',
    chainIds: [424242],
    methods: ['eth_chainId'],
    expirySeconds: 60,
  });
  await handleMessage({
    type: 'SET_NETWORK',
    network: {
      name: 'TON Mainnet',
      chainId: 607,
      rpcUrl: 'https://toncenter.com/api/v2',
      kind: 'ton',
      symbol: 'TON',
    },
  });
  await handleMessage({
    type: 'CREATE_TONCONNECT_SESSION',
    clientId: 'ton-disconnect-all',
    origin: 'https://ton-disconnect.example',
    manifestUrl: 'https://ton-disconnect.example/tonconnect-manifest.json',
    features: [{ name: 'SendTransaction', maxMessages: 4 }],
    expirySeconds: 60,
  });

  assert.equal((await handleMessage({ type: 'GET_CONNECTED_SITES' })).sites.length > 0, true);
  assert.equal((await handleMessage({ type: 'GET_WALLETCONNECT_SESSIONS' })).sessions.length, 1);
  assert.equal((await handleMessage({ type: 'GET_TONCONNECT_SESSIONS' })).sessions.length, 1);

  await handleMessage({ type: 'DISCONNECT_ALL_SITES' });

  assert.deepEqual((await handleMessage({ type: 'GET_CONNECTED_SITES' })).sites, []);
  assert.deepEqual((await handleMessage({ type: 'GET_WALLETCONNECT_SESSIONS' })).sessions, []);
  assert.deepEqual((await handleMessage({ type: 'GET_TONCONNECT_SESSIONS' })).sessions, []);
  const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
  assert.equal(snapshot.wallet.accounts.length, 1);
  assert.equal(snapshot.wallet.accounts[0].pqAddress, created.pqAddress);
});

test('walletconnect sessions enforce chain, method, and expiry allowlists', async () => {
  resetAlarmState();
  await handleMessage({ type: 'RESET_WALLET' });
  const created = await handleMessage({ type: 'CREATE_WALLET', password: 'correct horse battery' });

  const relayStatus = await handleMessage({ type: 'GET_WALLETCONNECT_RELAY_STATUS' });
  assert.equal(relayStatus.initialized, false);
  assert.equal(relayStatus.connected, false);
  assert.deepEqual(await handleMessage({ type: 'GET_WALLETCONNECT_CONFIG' }), { projectId: '', relayUrl: '' });
  assert.deepEqual(await handleMessage({
    type: 'SET_WALLETCONNECT_CONFIG',
    projectId: ' project-abc ',
    relayUrl: ' wss://relay.walletconnect.com ',
  }), {
    projectId: 'project-abc',
    relayUrl: 'wss://relay.walletconnect.com',
  });

  const pairing = await handleMessage({
    type: 'START_WALLETCONNECT_PAIRING',
    uri: 'wc:pairingtopic123@2?relay-protocol=irn&symKey=abcdef',
    expirySeconds: 60,
  });
  assert.equal(pairing.topic, 'pairingtopic123');
  assert.equal(pairing.relayProtocol, 'irn');
  assert.equal(pairing.symKey, 'abcdef');
  assert.ok(pairing.expiresAt > Date.now());
  const pairings = await handleMessage({ type: 'GET_WALLETCONNECT_PAIRINGS' });
  assert.equal(pairings.pairings.length, 1);
  await assert.rejects(
    handleMessage({
      type: 'START_WALLETCONNECT_PAIRING',
      uri: 'https://walletconnect.example',
    }),
    /WalletConnect URI must use wc: scheme|WalletConnect URI is invalid/,
  );
  await handleMessage({ type: 'REMOVE_WALLETCONNECT_PAIRING', topic: 'pairingtopic123' });
  assert.equal((await handleMessage({ type: 'GET_WALLETCONNECT_PAIRINGS' })).pairings.length, 0);

  const session = await handleMessage({
    type: 'CREATE_WALLETCONNECT_SESSION',
    topic: 'wc-topic-1',
    origin: 'https://wc.example',
    chainIds: [424242],
    methods: ['eth_chainId', 'eth_call'],
    expirySeconds: 60,
  });
  assert.equal(session.topic, 'wc-topic-1');
  assert.equal(session.origin, 'https://wc.example');
  assert.deepEqual(session.accounts, [created.pqAddress]);
  assert.deepEqual(session.chainIds, [424242]);
  assert.deepEqual(session.methods, ['eth_chainId', 'eth_call']);
  assert.ok(session.expiresAt > Date.now());

  const listed = await handleMessage({ type: 'GET_WALLETCONNECT_SESSIONS' });
  assert.equal(listed.sessions.length, 1);
  const connected = await handleMessage({ type: 'GET_CONNECTED_SITES' });
  assert.equal(connected.sites.some((site) => site.origin === 'https://wc.example' && site.accounts[0] === created.pqAddress), true);

  const valid = await handleMessage({
    type: 'VALIDATE_WALLETCONNECT_REQUEST',
    topic: 'wc-topic-1',
    chainId: 424242,
    method: 'eth_call',
  });
  assert.deepEqual(valid, { ok: true, accounts: [created.pqAddress] });

  const chainId = await handleMessage({
    type: 'EXECUTE_WALLETCONNECT_REQUEST',
    topic: 'wc-topic-1',
    chainId: 424242,
    method: 'eth_chainId',
    params: [],
  });
  assert.equal(chainId, '0x67932');

  const caipChainId = await handleMessage({
    type: 'EXECUTE_WALLETCONNECT_SESSION_REQUEST',
    topic: 'wc-topic-1',
    chainId: 'eip155:424242',
    request: { method: 'eth_chainId', params: [] },
  });
  assert.equal(caipChainId, '0x67932');

  await assert.rejects(
    handleMessage({
      type: 'CREATE_WALLETCONNECT_SESSION',
      topic: 'wc-topic-invalid',
      origin: 'https://wc.example',
      chainIds: [424242],
      methods: ['tron_sendTransaction'],
      expirySeconds: 60,
    }),
    /WalletConnect session method is not allowed: tron_sendTransaction/,
  );

  const preview = await handleMessage({
    type: 'PREVIEW_WALLETCONNECT_PROPOSAL',
    origin: 'https://proposal.example',
    requiredNamespaces: {
      eip155: {
        chains: ['eip155:424242'],
        methods: ['eth_chainId', 'eth_call'],
        events: ['accountsChanged', 'chainChanged'],
      },
    },
    expirySeconds: 60,
  });
  assert.deepEqual(preview.chainIds, [424242]);
  assert.deepEqual(preview.methods, ['eth_chainId', 'eth_call']);
  assert.deepEqual(preview.namespaces.eip155.methods, ['eth_chainId', 'eth_call']);
  assert.deepEqual(preview.namespaces.eip155.events, ['accountsChanged', 'chainChanged']);
  assert.deepEqual(preview.namespaces.eip155.accounts, [`eip155:424242:${created.pqAddress}`]);

  const listedAfterPreview = await handleMessage({ type: 'GET_WALLETCONNECT_SESSIONS' });
  assert.equal(listedAfterPreview.sessions.some((item) => item.topic === 'wc-topic-proposal'), false);

  const proposal = await handleMessage({
    type: 'CREATE_WALLETCONNECT_SESSION_FROM_PROPOSAL',
    topic: 'wc-topic-proposal',
    origin: 'https://proposal.example',
    requiredNamespaces: {
      eip155: {
        chains: ['eip155:424242'],
        methods: ['eth_chainId', 'eth_call'],
        events: ['accountsChanged', 'chainChanged'],
      },
    },
    expirySeconds: 60,
  });
  assert.equal(proposal.session.topic, 'wc-topic-proposal');
  assert.deepEqual(proposal.session.methods, ['eth_chainId', 'eth_call']);
  assert.deepEqual(proposal.namespaces.eip155.methods, ['eth_chainId', 'eth_call']);
  assert.deepEqual(proposal.namespaces.eip155.events, ['accountsChanged', 'chainChanged']);
  assert.deepEqual(proposal.namespaces.eip155.accounts, [`eip155:424242:${created.pqAddress}`]);

  const approvalsBeforeReject = createdWindows.length;
  const rejectedApproval = handleMessage({
    type: 'APPROVE_WALLETCONNECT_PROPOSAL',
    topic: 'wc-topic-rejected',
    origin: 'https://proposal.example',
    requiredNamespaces: {
      eip155: {
        chains: ['eip155:424242'],
        methods: ['eth_chainId'],
        events: [],
      },
    },
    expirySeconds: 60,
  });
  for (let i = 0; i < 10 && createdWindows.length <= approvalsBeforeReject; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const rejectedRequestId = new URL(createdWindows.at(-1).url).searchParams.get('approvalId');
  const rejectedRequest = await handleMessage({ type: 'GET_APPROVAL_REQUEST', requestId: rejectedRequestId });
  assert.equal(rejectedRequest.kind, 'walletconnect-proposal');
  assert.deepEqual(rejectedRequest.payload.methods, ['eth_chainId']);
  await handleMessage({ type: 'RESOLVE_APPROVAL', requestId: rejectedRequestId, approved: false });
  await assert.rejects(rejectedApproval, /Request rejected by user/);
  const afterRejectedApproval = await handleMessage({ type: 'GET_WALLETCONNECT_SESSIONS' });
  assert.equal(afterRejectedApproval.sessions.some((item) => item.topic === 'wc-topic-rejected'), false);

  const approvalsBeforeApprove = createdWindows.length;
  const approvedApproval = handleMessage({
    type: 'APPROVE_WALLETCONNECT_PROPOSAL',
    topic: 'wc-topic-approved',
    origin: 'https://proposal.example',
    requiredNamespaces: {
      eip155: {
        chains: ['eip155:424242'],
        methods: ['eth_chainId'],
        events: ['chainChanged'],
      },
    },
    expirySeconds: 60,
  });
  await resolveLatestApproval(true, approvalsBeforeApprove);
  const approvedProposal = await approvedApproval;
  assert.equal(approvedProposal.session.topic, 'wc-topic-approved');
  assert.deepEqual(approvedProposal.session.methods, ['eth_chainId']);
  assert.deepEqual(approvedProposal.namespaces.eip155.events, ['chainChanged']);

  await assert.rejects(
    handleMessage({
      type: 'CREATE_WALLETCONNECT_SESSION_FROM_PROPOSAL',
      topic: 'wc-topic-bad-proposal',
      origin: 'https://proposal.example',
      requiredNamespaces: {
        eip155: {
          chains: ['eip155:424242'],
          methods: ['tron_sendTransaction'],
          events: [],
        },
      },
      expirySeconds: 60,
    }),
    /WalletConnect session method is not allowed: tron_sendTransaction/,
  );

  await assert.rejects(
    handleMessage({
      type: 'VALIDATE_WALLETCONNECT_REQUEST',
      topic: 'wc-topic-1',
      chainId: 424242,
      method: 'eth_sendTransaction',
    }),
    /WalletConnect method is not permitted/,
  );
  await assert.rejects(
    handleMessage({
      type: 'EXECUTE_WALLETCONNECT_REQUEST',
      topic: 'wc-topic-1',
      chainId: 424242,
      method: 'eth_sendTransaction',
      params: [],
    }),
    /WalletConnect method is not permitted/,
  );
  await assert.rejects(
    handleMessage({
      type: 'VALIDATE_WALLETCONNECT_REQUEST',
      topic: 'wc-topic-1',
      chainId: 2494104990,
      method: 'eth_call',
    }),
    /WalletConnect chain is not permitted/,
  );
  await assert.rejects(
    handleMessage({
      type: 'EXECUTE_WALLETCONNECT_REQUEST',
      topic: 'wc-topic-1',
      chainId: 10,
      method: 'eth_chainId',
      params: [],
    }),
    /WalletConnect chain is not permitted|WalletConnect request chain must match the active network/,
  );
  await assert.rejects(
    handleMessage({
      type: 'EXECUTE_WALLETCONNECT_SESSION_REQUEST',
      topic: 'wc-topic-1',
      chainId: 'tron:424242',
      request: { method: 'eth_chainId', params: [] },
    }),
    /Unsupported WalletConnect chain id: tron:424242/,
  );

  const approvalsBeforeEvent = createdWindows.length;
  const proposalEventPromise = handleMessage({
    type: 'HANDLE_WALLETCONNECT_EVENT',
    event: {
      type: 'session_proposal',
      params: {
        topic: 'wc-topic-event',
        origin: 'https://event.example',
        requiredNamespaces: {
          eip155: {
            chains: ['eip155:424242'],
            methods: ['eth_chainId'],
            events: ['chainChanged'],
          },
        },
        expirySeconds: 60,
      },
    },
  });
  await resolveLatestApproval(true, approvalsBeforeEvent);
  const eventProposal = await proposalEventPromise;
  assert.equal(eventProposal.session.topic, 'wc-topic-event');
  assert.deepEqual(eventProposal.session.methods, ['eth_chainId']);

  const eventRequest = await handleMessage({
    type: 'HANDLE_WALLETCONNECT_EVENT',
    event: {
      type: 'session_request',
      topic: 'wc-topic-event',
      params: {
        chainId: 'eip155:424242',
        request: { method: 'eth_chainId', params: [] },
      },
    },
  });
  assert.equal(eventRequest, '0x67932');

  const rpcEvent = await handleMessage({
    type: 'HANDLE_WALLETCONNECT_RPC_EVENT',
    event: {
      id: 99,
      type: 'session_request',
      topic: 'wc-topic-event',
      params: {
        chainId: 'eip155:424242',
        request: { method: 'eth_chainId', params: [] },
      },
    },
  });
  assert.deepEqual(rpcEvent, { id: 99, jsonrpc: '2.0', result: '0x67932' });

  const rpcError = await handleMessage({
    type: 'HANDLE_WALLETCONNECT_RPC_EVENT',
    event: {
      id: 100,
      type: 'session_request',
      topic: 'wc-topic-event',
      params: {
        chainId: 'eip155:424242',
        request: { method: 'eth_sendTransaction', params: [] },
      },
    },
  });
  assert.equal(rpcError.id, 100);
  assert.equal(rpcError.jsonrpc, '2.0');
  assert.equal(rpcError.error.code, -32000);
  assert.match(rpcError.error.message, /WalletConnect method is not permitted/);

  const deleted = await handleMessage({
    type: 'HANDLE_WALLETCONNECT_EVENT',
    event: {
      type: 'session_delete',
      topic: 'wc-topic-event',
    },
  });
  assert.deepEqual(deleted, { ok: true });
  const afterDelete = await handleMessage({ type: 'GET_WALLETCONNECT_SESSIONS' });
  assert.equal(afterDelete.sessions.some((item) => item.topic === 'wc-topic-event'), false);

  const stored = await chrome.storage.local.get('walletConnectSessions');
  await chrome.storage.local.set({
    walletConnectSessions: stored.walletConnectSessions.map((entry) =>
      entry.topic === 'wc-topic-1' ? { ...entry, expiresAt: Date.now() - 1 } : entry,
    ),
  });
  await assert.rejects(
    handleMessage({
      type: 'VALIDATE_WALLETCONNECT_REQUEST',
      topic: 'wc-topic-1',
      chainId: 424242,
      method: 'eth_call',
    }),
    /WalletConnect session not found|WalletConnect session expired/,
  );
});

test('dapp provider can send a transaction for a connected site', async () => {
  txCounter = 0;
  resetAlarmState();
  await handleMessage({ type: 'RESET_WALLET' });
  const created = await handleMessage({ type: 'CREATE_WALLET', password: 'correct horse battery' });

  const approvalsBeforeConnect = createdWindows.length;
  const connectPromise = handleMessage({
    type: 'DAPP_REQUEST',
    origin: 'https://swap.example.com',
    method: 'eth_requestAccounts',
    params: [],
  });
  await resolveLatestApproval(true, approvalsBeforeConnect);
  await connectPromise;

  const approvalsBeforeSend = createdWindows.length;
  const sentPromise = handleMessage({
    type: 'DAPP_REQUEST',
    origin: 'https://swap.example.com',
    method: 'eth_sendTransaction',
    params: [{
      from: created.pqAddress,
      to: created.pqAddress,
      value: '0xde0b6b3a7640000',
      data: '0x',
    }],
  });
  await resolveLatestApproval(true, approvalsBeforeSend);
  const sent = await sentPromise;

  assert.match(sent.txHash, /^0x[0-9a-f]+$/);
});

test('dapp provider can deploy, call, and read a smart contract', async () => {
  txCounter = 0;
  shellTxHistoryResult = { transactions: [], total: 0 };
  resetAlarmState();
  await handleMessage({ type: 'RESET_WALLET' });
  const created = await handleMessage({ type: 'CREATE_WALLET', password: 'correct horse battery' });

  const approvalsBeforeConnect = createdWindows.length;
  const connectPromise = handleMessage({
    type: 'DAPP_REQUEST',
    origin: 'https://contracts.example.com',
    method: 'eth_requestAccounts',
    params: [],
  });
  await resolveLatestApproval(true, approvalsBeforeConnect);
  await connectPromise;

  const bytecode = '0x6080604052348015600f57600080fd5b506001600055';
  const approvalsBeforeDeploy = createdWindows.length;
  const deployPromise = handleMessage({
    type: 'DAPP_REQUEST',
    origin: 'https://contracts.example.com',
    method: 'eth_sendTransaction',
    params: [{
      from: created.pqAddress,
      to: null,
      value: '0x0',
      data: bytecode,
      gas: '0x16e360',
    }],
  });
  await resolveLatestApproval(true, approvalsBeforeDeploy);
  const deployed = await deployPromise;
  assert.match(deployed.txHash, /^0x[0-9a-f]+$/);

  const contractAddress = '0x' + '12'.repeat(32);
  const setNumberData = '0x3fb5c1cb' + '0'.repeat(63) + '7';
  const approvalsBeforeCall = createdWindows.length;
  const callPromise = handleMessage({
    type: 'DAPP_REQUEST',
    origin: 'https://contracts.example.com',
    method: 'shella_sendPqTransaction',
    params: [{
      from: created.pqAddress,
      to: contractAddress,
      value: '0x0',
      data: setNumberData,
      gasLimit: '0x1d4c0',
    }],
  });
  await resolveLatestApproval(true, approvalsBeforeCall);
  const called = await callPromise;
  assert.match(called.txHash, /^0x[0-9a-f]+$/);

  const getNumberData = '0xf2c9ecd8';
  const readResult = await handleMessage({
    type: 'DAPP_REQUEST',
    origin: 'https://contracts.example.com',
    method: 'eth_call',
    params: [{ to: contractAddress, data: getNumberData }, 'latest'],
  });
  assert.equal(readResult, '0x' + '0'.repeat(63) + '7');

  const history = await handleMessage({ type: 'GET_TX_HISTORY', address: created.pqAddress, page: 0 });
  assert.equal(history.txs.length, 2);
  assert.equal(history.txs[1].to, null);
  assert.equal(history.txs[1].shellType, 'contractCreate');
  assert.equal(history.txs[1].data, bytecode);
  assert.equal(history.txs[0].to, contractAddress);
  assert.equal(history.txs[0].shellType, 'contractCall');
  assert.equal(history.txs[0].data, setNumberData);

  const callRequest = rpcRequests.find((entry) => entry.body.method === 'eth_call');
  assert.deepEqual(callRequest.body.params, [{ to: contractAddress, data: getNumberData }, 'latest']);
});

test('Shell ERC20 info, balance, and transfer are supported through token provider registry', async () => {
  txCounter = 0;
  shellTxHistoryResult = { transactions: [], total: 0 };
  resetAlarmState();
  await handleMessage({ type: 'RESET_WALLET' });
  const created = await handleMessage({ type: 'CREATE_WALLET', password: 'correct horse battery' });
  const tokenAddress = '0x' + '34'.repeat(32);

  await handleMessage({ type: 'ADD_ERC20_TOKEN', contractAddress: tokenAddress });
  const snapshotWithToken = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
  assert.equal(snapshotWithToken.wallet.watchedTokens.length, 1);
  assert.equal(snapshotWithToken.wallet.watchedTokens[0].chainKind, 'shell');
  assert.equal(snapshotWithToken.wallet.watchedTokens[0].contractAddress, tokenAddress);
  assert.equal(snapshotWithToken.wallet.watchedTokens[0].symbol, 'SHELLUSD');
  assert.equal(snapshotWithToken.wallet.watchedTokens[0].decimals, 18);
  assert.ok(snapshotWithToken.portfolioAssets.some((asset) =>
    asset.assetType === 'native' &&
    asset.chainKind === 'shell' &&
    asset.symbol === 'SHELL' &&
    asset.status === 'ok',
  ));
  assert.ok(snapshotWithToken.portfolioAssets.some((asset) =>
    asset.assetType === 'token' &&
    asset.contractAddress === tokenAddress &&
    asset.symbol === 'SHELLUSD' &&
    asset.formattedBalance === '1.234567890123456789',
  ));

  const info = await handleMessage({ type: 'GET_ERC20_TOKEN_INFO', contractAddress: tokenAddress });
  assert.deepEqual(info, { contractAddress: tokenAddress, decimals: 18, symbol: 'SHELLUSD' });

  const balance = await handleMessage({
    type: 'GET_ERC20_BALANCE',
    contractAddress: tokenAddress,
    ownerAddress: created.pqAddress,
    decimals: 18,
    symbol: 'SHELLUSD',
  });
  assert.deepEqual(balance, {
    balance: '1234567890123456789',
    formatted: '1.234567890123456789',
    decimals: 18,
    symbol: 'SHELLUSD',
  });

  const sent = await handleMessage({
    type: 'SEND_ERC20_TRANSFER',
    contractAddress: tokenAddress,
    to: created.pqAddress,
    amount: '1.5',
    decimals: 18,
    symbol: 'SHELLUSD',
  });
  assert.match(sent.txHash, /^0x[0-9a-f]{64}$/);

  const history = await handleMessage({ type: 'GET_TX_HISTORY', address: created.pqAddress, page: 0 });
  assert.equal(history.txs[0].chainKind, 'shell');
  assert.equal(history.txs[0].shellType, 'erc20Transfer');
  assert.equal(history.txs[0].tokenContract, tokenAddress);
  assert.equal(history.txs[0].tokenSymbol, 'SHELLUSD');
  assert.equal(history.txs[0].tokenDecimals, 18);
  assert.equal(history.txs[0].value, '1500000000000000000');
  assert.equal(history.txs[0].to, created.pqAddress);
  assert.match(history.txs[0].data, new RegExp(`^0xa9059cbb${created.pqAddress.slice(2)}`));

  const revoke = await handleMessage({
    type: 'REVOKE_ERC20_APPROVAL',
    tokenContract: tokenAddress,
    spender: created.pqAddress,
  });
  assert.match(revoke.txHash, /^0x[0-9a-f]{64}$/);
  const revokeHistory = await handleMessage({ type: 'GET_TX_HISTORY', address: created.pqAddress, page: 0 });
  assert.equal(revokeHistory.txs[0].to, tokenAddress);
  assert.match(revokeHistory.txs[0].data, /^0x095ea7b3/);
  assert.equal(revokeHistory.txs[0].data.endsWith('0'.repeat(64)), true);
});

test('Shell dApp provider can submit ERC20 transfers through token provider registry', async () => {
  txCounter = 0;
  shellTxHistoryResult = { transactions: [], total: 0 };
  resetAlarmState();
  await handleMessage({ type: 'RESET_WALLET' });
  const created = await handleMessage({ type: 'CREATE_WALLET', password: 'correct horse battery' });
  const tokenAddress = '0x' + '56'.repeat(32);

  const approvalsBeforeConnect = createdWindows.length;
  const connectPromise = handleMessage({
    type: 'DAPP_REQUEST',
    origin: 'https://tokens.example.com',
    method: 'eth_requestAccounts',
    params: [],
  });
  await resolveLatestApproval(true, approvalsBeforeConnect);
  await connectPromise;

  const approvalsBeforeSend = createdWindows.length;
  const sendPromise = handleMessage({
    type: 'DAPP_REQUEST',
    origin: 'https://tokens.example.com',
    method: 'shella_sendErc20Transfer',
    params: [{
      contractAddress: tokenAddress,
      to: created.pqAddress,
      amount: '2',
      decimals: 18,
      symbol: 'SHELLUSD',
    }],
  });
  await resolveLatestApproval(true, approvalsBeforeSend);
  const sent = await sendPromise;
  assert.match(sent.txHash, /^0x[0-9a-f]{64}$/);

  const history = await handleMessage({ type: 'GET_TX_HISTORY', address: created.pqAddress, page: 0 });
  assert.equal(history.txs[0].shellType, 'erc20Transfer');
  assert.equal(history.txs[0].tokenContract, tokenAddress);
  assert.equal(history.txs[0].value, '2000000000000000000');

  const unlimitedApprovalData = `0x095ea7b3${created.pqAddress.slice(2)}${'f'.repeat(64)}`;
  const approvalsBeforeApproval = createdWindows.length;
  const approvalPromise = handleMessage({
    type: 'DAPP_REQUEST',
    origin: 'https://tokens.example.com',
    method: 'eth_sendTransaction',
    params: [{
      from: created.pqAddress,
      to: tokenAddress,
      value: '0x0',
      data: unlimitedApprovalData,
    }],
  });
  const approvalRequest = await resolveLatestApproval(false, approvalsBeforeApproval);
  assert.equal(approvalRequest.payload.approvalRisk.riskLevel, 'high');
  assert.ok(approvalRequest.payload.approvalRisk.riskFlags.includes('unlimited-token-approval'));
  assert.ok(approvalRequest.payload.approvalRisk.displayRows.some((row) => row.label === 'Approval spender'));
  await assert.rejects(approvalPromise, /Request rejected by user/);
});

test('Shell dApp permissions are bound to the currently active account after account switch', async () => {
  txCounter = 0;
  shellTxHistoryResult = { transactions: [], total: 0 };
  resetAlarmState();
  await handleMessage({ type: 'RESET_WALLET' });
  const first = await handleMessage({ type: 'CREATE_WALLET', password: 'correct horse battery' });
  const second = await handleMessage({ type: 'ADD_ACCOUNT', password: 'different horse battery' });
  const origin = 'https://account-switch.example.com';

  const approvalsBeforeConnect = createdWindows.length;
  const connectPromise = handleMessage({
    type: 'DAPP_REQUEST',
    origin,
    method: 'eth_requestAccounts',
    params: [],
  });
  await resolveLatestApproval(true, approvalsBeforeConnect);
  assert.deepEqual(await connectPromise, [first.pqAddress]);

  await handleMessage({ type: 'SWITCH_ACCOUNT', password: 'different horse battery', address: second.pqAddress });

  const accounts = await handleMessage({
    type: 'DAPP_REQUEST',
    origin,
    method: 'eth_accounts',
    params: [],
  });
  assert.deepEqual(accounts, []);

  const approvalsBeforeSend = createdWindows.length;
  await assert.rejects(
    handleMessage({
      type: 'DAPP_REQUEST',
      origin,
      method: 'eth_sendTransaction',
      params: [{
        from: first.pqAddress,
        to: first.pqAddress,
        value: '0x1',
        data: '0x',
      }],
    }),
    /Connected account is not the currently active shell account/,
  );
  assert.equal(createdWindows.length, approvalsBeforeSend);

  await assert.rejects(
    handleMessage({
      type: 'DAPP_REQUEST',
      origin,
      method: 'shella_sendErc20Transfer',
      params: [{
        contractAddress: '0x' + '56'.repeat(32),
        to: first.pqAddress,
        amount: '1',
        decimals: 18,
        symbol: 'SHELLUSD',
      }],
    }),
    /Connected account is not the currently active shell account/,
  );
  assert.equal(createdWindows.length, approvalsBeforeSend);
});

test('wallet_addEthereumChain requires an existing connection and approval', async () => {
  txCounter = 0;
  resetAlarmState();
  await handleMessage({ type: 'RESET_WALLET' });
  await handleMessage({ type: 'CREATE_WALLET', password: 'correct horse battery' });

  const denied = await dispatchRuntimeMessage({
    type: 'DAPP_REQUEST',
    origin: 'https://newchain.example',
    method: 'wallet_addEthereumChain',
    params: [{
      chainId: '0x1234',
      chainName: 'Example Chain',
      rpcUrls: ['https://rpc.example'],
    }],
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.error, 'Site not connected: https://newchain.example');

  const approvalsBeforeConnect = createdWindows.length;
  const connectPromise = handleMessage({
    type: 'DAPP_REQUEST',
    origin: 'https://newchain.example',
    method: 'eth_requestAccounts',
    params: [],
  });
  await resolveLatestApproval(true, approvalsBeforeConnect);
  await connectPromise;

  const approvalsBeforeAddChain = createdWindows.length;
  const addChainPromise = handleMessage({
    type: 'DAPP_REQUEST',
    origin: 'https://newchain.example',
    method: 'wallet_addEthereumChain',
    params: [{
      chainId: '0x1234',
      chainName: 'Example Chain',
      rpcUrls: ['https://rpc.example'],
    }],
  });
  await resolveLatestApproval(true, approvalsBeforeAddChain);
  await addChainPromise;

  const network = await handleMessage({ type: 'GET_NETWORK' });
  assert.equal(network.network.chainId, 0x1234);
});

test('WALLET-H1: signing works after create/unlock (key not zeroed inside adapter)', async () => {
  txCounter = 0;
  resetAlarmState();
  await handleMessage({ type: 'RESET_WALLET' });

  // Create wallet — H1 bug would zero the adapter key here
  const created = await handleMessage({ type: 'CREATE_WALLET', password: 'correct horse battery' });
  assert.ok(created.pqAddress, 'CREATE_WALLET must return a pqAddress');

  // If the signer's key were zeroed, SEND_TX would produce a zero-key signature
  // that the RPC mock would reject or return a wrong txHash.
  const sent = await handleMessage({
    type: 'SEND_TX',
    to: created.pqAddress,
    value: '0.1',
    data: '0x',
  });
  assert.match(sent.txHash, /^0x[0-9a-f]+$/, 'SEND_TX after CREATE_WALLET should return a valid txHash');

  // Lock then re-unlock and sign again — H1 also affects unlockWallet path.
  await handleMessage({ type: 'LOCK_WALLET' });
  const unlocked = await handleMessage({ type: 'UNLOCK_WALLET', password: 'correct horse battery' });
  assert.equal(unlocked.ok, true);

  const sentAfterUnlock = await handleMessage({
    type: 'SEND_TX',
    to: created.pqAddress,
    value: '0.1',
    data: '0x',
  });
  assert.match(sentAfterUnlock.txHash, /^0x[0-9a-f]+$/, 'SEND_TX after UNLOCK_WALLET should return a valid txHash');
});

test('WALLET-H2: wallet_addEthereumChain rejects non-https and private IP RPC URLs', async () => {
  txCounter = 0;
  resetAlarmState();
  await handleMessage({ type: 'RESET_WALLET' });
  await handleMessage({ type: 'CREATE_WALLET', password: 'correct horse battery' });

  // Connect site first
  const approvalsBeforeConnect = createdWindows.length;
  const connectPromise = handleMessage({
    type: 'DAPP_REQUEST',
    origin: 'https://evil.example',
    method: 'eth_requestAccounts',
    params: [],
  });
  await resolveLatestApproval(true, approvalsBeforeConnect);
  await connectPromise;

  const badUrls = [
    'http://192.168.1.1:8545',
    'http://10.0.0.1',
    'http://172.16.0.1',
    'ftp://rpc.example',
    'javascript:alert(1)',
    'not-a-url',
  ];

  for (const rpcUrl of badUrls) {
    const response = await dispatchRuntimeMessage({
      type: 'DAPP_REQUEST',
      origin: 'https://evil.example',
      method: 'wallet_addEthereumChain',
      params: [{ chainId: '0x9999', chainName: 'Evil Chain', rpcUrls: [rpcUrl] }],
    });
    assert.equal(response.ok, false, `Expected rejection for rpcUrl: ${rpcUrl}`);
  }
});

test('WALLET-H2: wallet_addEthereumChain accepts https and localhost http URLs', async () => {
  txCounter = 0;
  resetAlarmState();
  await handleMessage({ type: 'RESET_WALLET' });
  await handleMessage({ type: 'CREATE_WALLET', password: 'correct horse battery' });

  const approvalsBeforeConnect = createdWindows.length;
  const connectPromise = handleMessage({
    type: 'DAPP_REQUEST',
    origin: 'https://good.example',
    method: 'eth_requestAccounts',
    params: [],
  });
  await resolveLatestApproval(true, approvalsBeforeConnect);
  await connectPromise;

  const approvalsBeforeAdd = createdWindows.length;
  const addPromise = handleMessage({
    type: 'DAPP_REQUEST',
    origin: 'https://good.example',
    method: 'wallet_addEthereumChain',
    params: [{ chainId: '0xabcd', chainName: 'Good Chain', rpcUrls: ['https://rpc.good.example'] }],
  });
  await resolveLatestApproval(true, approvalsBeforeAdd);
  const result = await addPromise;
  assert.equal(result, null);
});

test('WALLET-M2: privileged messages from content scripts are blocked', async () => {
  const privilegedTypes = [
    'CREATE_WALLET',
    'CREATE_HD_WALLET',
    'RESTORE_HD_WALLET',
    'REVEAL_MNEMONIC',
    'EXPORT_KEYSTORE',
    'SEND_TX',
    'UNLOCK_WALLET',
    'LOCK_WALLET',
    'ADD_ACCOUNT',
    'SWITCH_ACCOUNT',
    'AUTHORIZE_SESSION_KEY',
    'ROTATE_KEY',
    'IMPORT_KEYSTORE',
    'SET_NETWORK',
    'SET_AUTO_LOCK',
    'RESET_WALLET',
  ];

  for (const type of privilegedTypes) {
    const response = await new Promise((resolve) => {
      // Simulate a content script sender by providing a sender with .tab set
      listeners.onMessage[0]({ type }, { id: 'test', url: 'https://app.example', tab: { id: 1 } }, resolve);
    });
    assert.equal(response.ok, false, `${type} should be blocked from content scripts`);
    assert.equal(response.error, 'Unauthorized', `${type} should return Unauthorized`);
  }
});

test('WALLET-M2: extension pages opened in tabs can invoke internal messages', async () => {
  const response = await new Promise((resolve) => {
    listeners.onMessage[0](
      { type: 'LOCK_WALLET' },
      { id: 'test', url: 'chrome-extension://test/popup.html', tab: { id: 1 } },
      resolve,
    );
  });
  assert.deepEqual(response, { ok: true });
});

}); // describe('background e2e')

// ──────── Multi-account tests ────────

describe('multi-account', () => {
  const PASSWORD = 'correct horse battery';
  const PASSWORD2 = 'different horse battery';

  async function resetAndCreate() {
    await handleMessage({ type: 'RESET_WALLET' });
    return handleMessage({ type: 'CREATE_WALLET', password: PASSWORD });
  }

  test('ADD_ACCOUNT creates a second account without changing active signer', async () => {
    const first = await resetAndCreate();
    const signerAddressBefore = (await handleMessage({ type: 'GET_WALLET_SNAPSHOT' })).activeAddress;

    const second = await handleMessage({ type: 'ADD_ACCOUNT', password: PASSWORD2 });
    assert.ok(second.pqAddress, 'ADD_ACCOUNT must return a pqAddress');
    assert.notEqual(second.pqAddress, first.pqAddress, 'Second account must have a different address');

    // Active signer must remain unchanged
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    assert.equal(snapshot.activeAddress, signerAddressBefore, 'Active account must not change after ADD_ACCOUNT');
    assert.equal(snapshot.wallet.accounts.length, 2, 'Wallet must now have two accounts');
  });

  test('SWITCH_ACCOUNT changes the active signer to the target account', async () => {
    const first = await resetAndCreate();
    const second = await handleMessage({ type: 'ADD_ACCOUNT', password: PASSWORD2 });

    const switched = await handleMessage({ type: 'SWITCH_ACCOUNT', password: PASSWORD2, address: second.pqAddress });
    assert.ok(switched.ok, 'SWITCH_ACCOUNT must return ok: true');
    assert.equal(switched.pqAddress, second.pqAddress, 'SWITCH_ACCOUNT must return the new address');
    assert.equal(switched.accountId, `imported:${second.pqAddress}`);

    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    assert.equal(snapshot.activeAddress, second.pqAddress, 'Active address must be the switched-to account');
    assert.equal(snapshot.activeAccountId, `imported:${second.pqAddress}`, 'Active accountId must be the switched-to account');
    assert.equal(snapshot.activeMultichainAccount.primaryAddress, second.pqAddress, 'primaryAddress must remain Shell/PQ root');
    assert.notEqual(snapshot.activeAddress, first.pqAddress, 'Must no longer be the first account');
  });

  test('SWITCH_ACCOUNT accepts accountId without weakening Shell PQ authority', async () => {
    await resetAndCreate();
    const second = await handleMessage({ type: 'ADD_ACCOUNT', password: PASSWORD2 });
    const targetAccountId = `imported:${second.pqAddress}`;

    const switched = await handleMessage({ type: 'SWITCH_ACCOUNT', password: PASSWORD2, accountId: targetAccountId });
    assert.equal(switched.accountId, targetAccountId);
    assert.equal(switched.pqAddress, second.pqAddress);

    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    assert.equal(snapshot.activeAccountId, targetAccountId);
    assert.equal(snapshot.activeMultichainAccount.primaryAddress, second.pqAddress);
    const shellAddress = snapshot.activeMultichainAccount.addresses.find((entry) => entry.addressKey === 'shell');
    assert.equal(shellAddress.address, second.pqAddress);
    assert.equal(shellAddress.signatureScheme, 'ml-dsa-65');
    assert.equal(shellAddress.isShellAuthority, true);
  });

  test('SWITCH_ACCOUNT with wrong password throws and leaves signer unchanged', async () => {
    await resetAndCreate();
    const second = await handleMessage({ type: 'ADD_ACCOUNT', password: PASSWORD2 });

    const snapshotBefore = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    let threw = false;
    try {
      await handleMessage({ type: 'SWITCH_ACCOUNT', password: 'wrongpassword', address: second.pqAddress });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'SWITCH_ACCOUNT with wrong password must throw');

    const snapshotAfter = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    assert.equal(snapshotAfter.activeAddress, snapshotBefore.activeAddress, 'Signer must be unchanged after failed switch');
  });

  test('SWITCH_ACCOUNT with unknown address throws', async () => {
    await resetAndCreate();

    let threw = false;
    try {
      await handleMessage({ type: 'SWITCH_ACCOUNT', password: PASSWORD, address: '0x' + 'ab'.repeat(32) });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'SWITCH_ACCOUNT with unknown address must throw');
  });

  test('EXPORT_KEYSTORE exports the currently active account', async () => {
    const first = await resetAndCreate();
    const second = await handleMessage({ type: 'ADD_ACCOUNT', password: PASSWORD2 });

    // Before switch — should export first account
    const exportedFirst = await handleMessage({ type: 'EXPORT_KEYSTORE' });
    const parsedFirst = JSON.parse(exportedFirst.keystoreJson);
    assert.equal(parsedFirst.address, first.pqAddress, 'EXPORT_KEYSTORE must export the active (first) account');

    // After switch — should export second account
    await handleMessage({ type: 'SWITCH_ACCOUNT', password: PASSWORD2, address: second.pqAddress });
    const exportedSecond = await handleMessage({ type: 'EXPORT_KEYSTORE' });
    const parsedSecond = JSON.parse(exportedSecond.keystoreJson);
    assert.equal(parsedSecond.address, second.pqAddress, 'EXPORT_KEYSTORE must export the switched-to account');
  });

  test('UNLOCK_WALLET with explicit address unlocks that specific account', async () => {
    await resetAndCreate();
    const second = await handleMessage({ type: 'ADD_ACCOUNT', password: PASSWORD2 });

    await handleMessage({ type: 'LOCK_WALLET' });

    const unlocked = await handleMessage({ type: 'UNLOCK_WALLET', password: PASSWORD2, address: second.pqAddress });
    assert.ok(unlocked.ok, 'UNLOCK_WALLET with address must return ok: true');
    assert.equal(unlocked.pqAddress, second.pqAddress, 'Must unlock the specified account');
  });
});

describe('HD wallet', () => {
  const PASSWORD = 'hdwallet-test-password!';
  // Standard BIP-39 test mnemonic ("abandon" x23 + "art").
  const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

  async function resetHd() {
    resetAlarmState();
    await handleMessage({ type: 'RESET_WALLET' });
  }

  test('GET_CHAIN_CAPABILITIES reports explicit per-chain feature flags', async () => {
    const shell = await handleMessage({
      type: 'GET_CHAIN_CAPABILITIES',
      network: { name: 'Shell Devnet', chainId: 424242, rpcUrl: 'http://127.0.0.1:8545', kind: 'shell' },
    });
    assert.equal(shell.smartContracts, true);
    assert.equal(shell.accountNonce, true);
    assert.equal(shell.tokenTransfers, true);
    assert.equal(shell.dappProvider, true);

    const tron = await handleMessage({
      type: 'GET_CHAIN_CAPABILITIES',
      network: { name: 'Tron Shasta', chainId: 2494104990, rpcUrl: 'https://api.shasta.trongrid.io', kind: 'tron' },
    });
    assert.equal(tron.tokenTransfers, true);
    assert.equal(tron.nativeTransfers, true);
    assert.equal(tron.dappProvider, true);
    assert.equal(tron.accountNonce, false);

    const solana = await handleMessage({
      type: 'GET_CHAIN_CAPABILITIES',
      network: { name: 'Solana Devnet', chainId: 103, rpcUrl: 'https://api.devnet.solana.com', kind: 'solana' },
    });
    assert.equal(solana.tokenTransfers, true);
    assert.equal(solana.nativeTransfers, true);
    assert.equal(solana.dappProvider, true);
    assert.equal(solana.accountNonce, false);

    const bitcoin = await handleMessage({
      type: 'GET_CHAIN_CAPABILITIES',
      network: { name: 'Bitcoin Testnet', chainId: 18332, rpcUrl: 'https://blockstream.info/testnet/api', kind: 'bitcoin' },
    });
    assert.equal(bitcoin.utxo, true);
    assert.equal(bitcoin.dappProvider, false);
    assert.equal(bitcoin.smartContracts, false);

    const cosmos = await handleMessage({
      type: 'GET_CHAIN_CAPABILITIES',
      network: { name: 'Cosmos Hub', chainId: 118, rpcUrl: 'https://rest.cosmos.directory/cosmoshub', kind: 'cosmos' },
    });
    assert.equal(cosmos.readBalance, true);
    assert.equal(cosmos.signTransactions, true);
    assert.equal(cosmos.nativeTransfers, true);
    assert.equal(cosmos.tokenTransfers, false);
    assert.equal(cosmos.dappProvider, true);
    assert.equal(cosmos.smartContracts, false);

    const ton = await handleMessage({
      type: 'GET_CHAIN_CAPABILITIES',
      network: { name: 'TON Mainnet', chainId: 607, rpcUrl: 'https://toncenter.com/api/v2', kind: 'ton' },
    });
    assert.equal(ton.readBalance, true);
    assert.equal(ton.signTransactions, true);
    assert.equal(ton.nativeTransfers, true);
    assert.equal(ton.tokenTransfers, true);
    assert.equal(ton.dappProvider, false);

    const aptos = await handleMessage({
      type: 'GET_CHAIN_CAPABILITIES',
      network: { name: 'Aptos Testnet', chainId: 2, rpcUrl: 'https://fullnode.testnet.aptoslabs.com/v1', kind: 'aptos' },
    });
    assert.equal(aptos.readBalance, true);
    assert.equal(aptos.signTransactions, true);
    assert.equal(aptos.nativeTransfers, true);
    assert.equal(aptos.tokenTransfers, false);
    assert.equal(aptos.dappProvider, true);
    assert.equal(aptos.accountNonce, true);
  });

  test('GET_DAPP_METHODS derives exposed methods from chain capabilities', async () => {
    const shell = await handleMessage({
      type: 'GET_DAPP_METHODS',
      network: { name: 'Shell Devnet', chainId: 424242, rpcUrl: 'http://127.0.0.1:8545', kind: 'shell' },
    });
    assert.ok(shell.methods.includes('eth_requestAccounts'));
    assert.ok(shell.methods.includes('eth_call'));
    assert.ok(shell.methods.includes('wallet_addEthereumChain'));
    assert.ok(shell.methods.includes('shella_sendErc20Transfer'));
    assert.equal(shell.methods.includes('tron_sendTransaction'), false);

    const tron = await handleMessage({
      type: 'GET_DAPP_METHODS',
      network: { name: 'Tron Shasta', chainId: 2494104990, rpcUrl: 'https://api.shasta.trongrid.io', kind: 'tron' },
    });
    assert.ok(tron.methods.includes('tron_requestAccounts'));
    assert.ok(tron.methods.includes('tron_sendTransaction'));
    assert.ok(tron.methods.includes('tron_sendTrc20Transfer'));
    assert.equal(tron.methods.includes('eth_call'), false);

    const solana = await handleMessage({
      type: 'GET_DAPP_METHODS',
      network: { name: 'Solana Devnet', chainId: 103, rpcUrl: 'https://api.devnet.solana.com', kind: 'solana' },
    });
    assert.ok(solana.methods.includes('solana_connect'));
    assert.ok(solana.methods.includes('solana_signAndSendTransaction'));
    assert.ok(solana.methods.includes('solana_sendSplTransfer'));
    assert.equal(solana.methods.includes('eth_call'), false);

    const bitcoin = await handleMessage({
      type: 'GET_DAPP_METHODS',
      network: { name: 'Bitcoin Testnet', chainId: 18332, rpcUrl: 'https://blockstream.info/testnet/api', kind: 'bitcoin' },
    });
    assert.deepEqual(bitcoin.methods, []);

    const cosmos = await handleMessage({
      type: 'GET_DAPP_METHODS',
      network: { name: 'Cosmos Hub', chainId: 118, rpcUrl: 'https://rest.cosmos.directory/cosmoshub', kind: 'cosmos' },
    });
    assert.deepEqual(cosmos.methods, ['cosmos_accounts', 'cosmos_chainId', 'cosmos_getBalance']);

    const aptos = await handleMessage({
      type: 'GET_DAPP_METHODS',
      network: { name: 'Aptos Testnet', chainId: 2, rpcUrl: 'https://fullnode.testnet.aptoslabs.com/v1', kind: 'aptos' },
    });
    assert.deepEqual(aptos.methods, [
      'aptos_connect',
      'aptos_account',
      'aptos_network',
      'aptos_getBalance',
      'aptos_signAndSubmitTransaction',
    ]);
  });

  test('Aptos dApp payload preview decodes entry functions before gated dApp submission', async () => {
    const transfer = await handleMessage({
      type: 'PREVIEW_APTOS_DAPP_PAYLOAD',
      payload: {
        type: 'entry_function_payload',
        function: '0x1::aptos_account::transfer',
        type_arguments: [],
        arguments: ['0xabcd', '123456789'],
      },
    });

    assert.equal(transfer.type, 'entry_function_payload');
    assert.equal(
      transfer.functionId,
      '0x0000000000000000000000000000000000000000000000000000000000000001::aptos_account::transfer',
    );
    assert.equal(transfer.moduleAddress, '0x0000000000000000000000000000000000000000000000000000000000000001');
    assert.equal(transfer.moduleName, 'aptos_account');
    assert.equal(transfer.functionName, 'transfer');
    assert.equal(transfer.knownAction, 'nativeTransfer');
    assert.equal(transfer.riskLevel, 'low');
    assert.equal(transfer.riskSummary, 'Recognized native APT transfer.');
    assert.deepEqual(transfer.riskFlags, ['recognized-native-transfer']);
    assert.equal(transfer.recipient, '0x000000000000000000000000000000000000000000000000000000000000abcd');
    assert.equal(transfer.amountOctas, '123456789');
    assert.deepEqual(transfer.argumentsSummary, [
      '0x000000000000000000000000000000000000000000000000000000000000abcd',
      '123456789',
    ]);
    assert.deepEqual(transfer.warnings, []);

    const unknown = await handleMessage({
      type: 'PREVIEW_APTOS_DAPP_PAYLOAD',
      payload: {
        function_id: '0x42::market::fill_order',
        typeArguments: ['0x1::aptos_coin::AptosCoin'],
        args: ['order-123', { limit: '10' }],
      },
    });
    assert.equal(unknown.knownAction, 'unknown');
    assert.equal(unknown.functionId, '0x0000000000000000000000000000000000000000000000000000000000000042::market::fill_order');
    assert.deepEqual(unknown.typeArguments, ['0x1::aptos_coin::AptosCoin']);
    assert.deepEqual(unknown.argumentsSummary, ['order-123', 'object']);
    assert.equal(unknown.riskLevel, 'high');
    assert.equal(unknown.riskSummary, 'Move function references asset-like types or sensitive actions.');
    assert.deepEqual(unknown.riskFlags, ['third-party-module', 'type-argument-asset']);
    assert.deepEqual(unknown.warnings, []);

    const malformed = await handleMessage({
      type: 'PREVIEW_APTOS_DAPP_PAYLOAD',
      payload: {
        type: 'script_payload',
        function: 'not-a-function-id',
        arguments: Array.from({ length: 9 }, (_item, index) => index),
      },
    });
    assert.equal(malformed.riskLevel, 'critical');
    assert.equal(malformed.riskSummary, 'Aptos payload cannot be safely decoded.');
    assert.deepEqual(malformed.riskFlags, ['unsupported-payload-type', 'invalid-entry-function', 'many-arguments']);
    assert.deepEqual(malformed.warnings, [
      'Unsupported Aptos payload type: script_payload',
      'Aptos entry function is missing or invalid.',
      'Aptos payload has many arguments; inspect carefully before signing.',
    ]);

    await assert.rejects(
      handleMessage({ type: 'PREVIEW_APTOS_DAPP_PAYLOAD', payload: null }),
      /Aptos payload must be an object/,
    );

    const aptos = await handleMessage({
      type: 'GET_DAPP_METHODS',
      network: { name: 'Aptos Testnet', chainId: 2, rpcUrl: 'https://fullnode.testnet.aptoslabs.com/v1', kind: 'aptos' },
    });
    assert.ok(aptos.methods.includes('aptos_signAndSubmitTransaction'));
  });

  test('DAPP_REQUEST rejects methods not exposed by the active chain capabilities', async () => {
    await resetHd();
    await handleMessage({
      type: 'SET_NETWORK',
      network: { name: 'Bitcoin Testnet', chainId: 18332, rpcUrl: 'https://blockstream.info/testnet/api', kind: 'bitcoin', symbol: 'BTC' },
    });
    await assert.rejects(
      handleMessage({
        type: 'DAPP_REQUEST',
        origin: 'https://dapp.example',
        method: 'eth_chainId',
      }),
      /Unsupported dApp method: eth_chainId/,
    );
  });

  test('GENERATE_MNEMONIC returns a 24-word BIP-39 phrase', async () => {
    const res = await handleMessage({ type: 'GENERATE_MNEMONIC' });
    assert.ok(typeof res.mnemonic === 'string', 'mnemonic must be a string');
    const words = res.mnemonic.trim().split(/\s+/);
    assert.equal(words.length, 24, 'default mnemonic must be 24 words');
    // Two calls must produce different mnemonics (probabilistic, but sound).
    const res2 = await handleMessage({ type: 'GENERATE_MNEMONIC' });
    assert.notEqual(res.mnemonic, res2.mnemonic, 'Successive mnemonics must differ');
  });

  test('CREATE_HD_WALLET derives a deterministic address from the canonical mnemonic', async () => {
    await resetHd();
    const res = await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    assert.match(res.pqAddress, /^0x[0-9a-f]{64}$/, 'address must be 0x+64 hex');
    // Re-create with same mnemonic — must yield same address.
    await resetHd();
    const res2 = await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    assert.equal(res.pqAddress, res2.pqAddress, 'Same mnemonic must produce identical address');
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    assert.match(snapshot.wallet.accounts[0].chainAddresses.tron, /^T[1-9A-HJ-NP-Za-km-z]{33}$/);
    assert.match(snapshot.wallet.accounts[0].chainAddresses.solana, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    assert.match(snapshot.wallet.accounts[0].chainAddresses.bitcoin, /^bc1[ac-hj-np-z02-9]{11,87}$/);
    assert.match(snapshot.wallet.accounts[0].chainAddresses.bitcoinTestnet, /^tb1[ac-hj-np-z02-9]{11,87}$/);
    assert.match(snapshot.wallet.accounts[0].chainAddresses.cosmos, /^cosmos1[ac-hj-np-z02-9]{38}$/);
    assert.match(snapshot.wallet.accounts[0].chainAddresses.aptos, /^0x[0-9a-f]{64}$/);
  });

  test('CREATE_HD_WALLET rejects an invalid mnemonic', async () => {
    await resetHd();
    let threw = false;
    try {
      await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: 'this is not a valid mnemonic at all', password: PASSWORD });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'Invalid mnemonic must throw');
  });

  test('RESTORE_HD_WALLET matches CREATE_HD_WALLET for the same mnemonic', async () => {
    await resetHd();
    const created = await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await resetHd();
    const restored = await handleMessage({ type: 'RESTORE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    assert.equal(created.pqAddress, restored.pqAddress, 'Restore must produce the same address as create');
  });

  test('CREATE_HD_WALLET wallet is immediately unlocked', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    assert.equal(snapshot.locked, false, 'HD wallet must be unlocked right after creation');
  });

  test('GET_PORTFOLIO_SNAPSHOT limits default reads to active and explicitly watched networks', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });

    const portfolio = await handleMessage({ type: 'GET_PORTFOLIO_SNAPSHOT' });
    assert.equal(portfolio.accountId, 'hd:0');
    assert.ok(portfolio.generatedAt > 0);
    assert.equal(portfolio.networks.length, 1);
    assert.ok(portfolio.networks.some((network) =>
      network.chainKind === 'shell' &&
      network.networkName === 'Shell Devnet' &&
      network.status === 'ok' &&
      network.nativeAsset.formattedBalance === '1.000000',
    ));
    assert.equal(portfolio.networks.some((network) => network.chainKind === 'bitcoin'), false);
    assert.equal(portfolio.networks.some((network) => network.chainKind === 'aptos'), false);

    await chrome.storage.local.set({
      watchedTokens: [{
        chainKind: 'aptos',
        chainId: 2,
        contractAddress: '0x1::aptos_coin::AptosCoin',
        symbol: 'APT',
        decimals: 8,
        addedAt: Date.now(),
      }],
    });
    const watchedPortfolio = await handleMessage({ type: 'GET_PORTFOLIO_SNAPSHOT' });
    assert.ok(watchedPortfolio.networks.some((network) =>
      network.chainKind === 'aptos' &&
      network.networkName === 'Aptos Testnet' &&
      network.status === 'ok' &&
      network.nativeAsset.formattedBalance === '1.23456789',
    ));
    assert.equal(watchedPortfolio.networks.every((network) => typeof network.updatedAt === 'number'), true);

    aptosBalanceValue = 'not-a-number';
    const degraded = await handleMessage({ type: 'GET_PORTFOLIO_SNAPSHOT' });
    const aptos = degraded.networks.find((network) => network.chainKind === 'aptos');
    const shell = degraded.networks.find((network) => network.chainKind === 'shell');
    assert.equal(aptos.status, 'unavailable');
    assert.match(aptos.error, /not found|unavailable|failed/i);
    assert.equal(shell.status, 'ok');
  });

  test('ADD_ACCOUNT on HD wallet derives deterministic second account', async () => {
    await resetHd();
    const first = await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    const second = await handleMessage({ type: 'ADD_ACCOUNT', password: PASSWORD });
    assert.match(second.pqAddress, /^0x[0-9a-f]{64}$/, 'Second HD account must have a valid address');
    assert.notEqual(second.pqAddress, first.pqAddress, 'Second HD account must differ from the first');

    // Restore + add account again — must get the same second address.
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    const second2 = await handleMessage({ type: 'ADD_ACCOUNT', password: PASSWORD });
    assert.equal(second.pqAddress, second2.pqAddress, 'ADD_ACCOUNT on HD wallet must be deterministic');
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    assert.match(snapshot.wallet.accounts[1].chainAddresses.tron, /^T[1-9A-HJ-NP-Za-km-z]{33}$/);
    assert.match(snapshot.wallet.accounts[1].chainAddresses.solana, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    assert.match(snapshot.wallet.accounts[1].chainAddresses.bitcoin, /^bc1[ac-hj-np-z02-9]{11,87}$/);
    assert.match(snapshot.wallet.accounts[1].chainAddresses.bitcoinTestnet, /^tb1[ac-hj-np-z02-9]{11,87}$/);
    assert.match(snapshot.wallet.accounts[1].chainAddresses.cosmos, /^cosmos1[ac-hj-np-z02-9]{38}$/);
    assert.match(snapshot.wallet.accounts[1].chainAddresses.aptos, /^0x[0-9a-f]{64}$/);
    assert.notEqual(snapshot.wallet.accounts[0].chainAddresses.tron, snapshot.wallet.accounts[1].chainAddresses.tron);
    assert.notEqual(snapshot.wallet.accounts[0].chainAddresses.solana, snapshot.wallet.accounts[1].chainAddresses.solana);
    assert.notEqual(snapshot.wallet.accounts[0].chainAddresses.bitcoin, snapshot.wallet.accounts[1].chainAddresses.bitcoin);
    assert.notEqual(snapshot.wallet.accounts[0].chainAddresses.bitcoinTestnet, snapshot.wallet.accounts[1].chainAddresses.bitcoinTestnet);
    assert.notEqual(snapshot.wallet.accounts[0].chainAddresses.cosmos, snapshot.wallet.accounts[1].chainAddresses.cosmos);
    assert.notEqual(snapshot.wallet.accounts[0].chainAddresses.aptos, snapshot.wallet.accounts[1].chainAddresses.aptos);
  });

  test('Tron network uses derived Tron address and balance adapter', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Tron Shasta',
        chainId: 2494104990,
        rpcUrl: 'https://api.shasta.trongrid.io',
        kind: 'tron',
        symbol: 'TRX',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    assert.equal(snapshot.activeChainKind, 'tron');
    assert.match(snapshot.activeAddress, /^T[1-9A-HJ-NP-Za-km-z]{33}$/);
    assert.deepEqual(snapshot.balance, { raw: '123456789', formatted: '123.456789' });
    assert.equal(snapshot.nonce, null);

    const sent = await handleMessage({ type: 'SEND_TX', to: snapshot.activeAddress, value: '1.25' });
    assert.deepEqual(sent, { txHash: 'a'.repeat(64) });
    assert.equal(tronRequests.at(-2).body.amount, 1250000);
    assert.equal(tronRequests.at(-2).body.owner_address, snapshot.activeAddress);
    assert.equal(tronRequests.at(-2).body.to_address, snapshot.activeAddress);

    const history = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    assert.equal(history.total, 1);
    assert.equal(history.txs[0].chainKind, 'tron');
    assert.equal(history.txs[0].value, '1250000');
    assert.equal(history.txs[0].shellType, 'tronTransfer');
  });

  test('Tron send rejects invalid TRX precision', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Tron Shasta',
        chainId: 2494104990,
        rpcUrl: 'https://api.shasta.trongrid.io',
        kind: 'tron',
        symbol: 'TRX',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    await assert.rejects(
      () => handleMessage({ type: 'SEND_TX', to: snapshot.activeAddress, value: '0.0000001' }),
      /TRX amount must have at most 6 decimal places/,
    );
  });

  test('Tron TRC20 info, balance, and transfer are supported', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Tron Shasta',
        chainId: 2494104990,
        rpcUrl: 'https://api.shasta.trongrid.io',
        kind: 'tron',
        symbol: 'TRX',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    const tokenAddress = snapshot.activeAddress;

    await handleMessage({ type: 'ADD_TRC20_TOKEN', contractAddress: tokenAddress });
    const snapshotWithToken = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    assert.equal(snapshotWithToken.wallet.watchedTokens.length, 1);
    assert.equal(snapshotWithToken.wallet.watchedTokens[0].contractAddress, tokenAddress);
    assert.equal(snapshotWithToken.wallet.watchedTokens[0].symbol, 'USDT');
    assert.equal(snapshotWithToken.wallet.watchedTokens[0].decimals, 6);

    const info = await handleMessage({ type: 'GET_TRC20_TOKEN_INFO', contractAddress: tokenAddress });
    assert.deepEqual(info, { contractAddress: tokenAddress, decimals: 6, symbol: 'USDT' });

    const balance = await handleMessage({
      type: 'GET_TRC20_BALANCE',
      contractAddress: tokenAddress,
      decimals: 6,
      symbol: 'USDT',
    });
    assert.deepEqual(balance, { balance: '1234500', formatted: '1.2345', decimals: 6, symbol: 'USDT' });
    const balanceRequest = tronRequests.find((entry) => entry.body.function_selector === 'balanceOf(address)');
    assert.equal(balanceRequest.body.parameter.length, 64);

    const sent = await handleMessage({
      type: 'SEND_TRC20_TRANSFER',
      contractAddress: tokenAddress,
      to: snapshot.activeAddress,
      amount: '1.5',
      decimals: 6,
      symbol: 'USDT',
    });
    assert.deepEqual(sent, { txHash: 'b'.repeat(64) });

    const triggerRequest = tronRequests.find((entry) => entry.body.function_selector === 'transfer(address,uint256)');
    assert.equal(triggerRequest.body.contract_address, tokenAddress);
    assert.equal(triggerRequest.body.parameter.length, 128);
    assert.equal(triggerRequest.body.parameter.slice(64), '0'.repeat(58) + '16e360');

    const history = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    assert.equal(history.txs[0].chainKind, 'tron');
    assert.equal(history.txs[0].shellType, 'trc20Transfer');
    assert.equal(history.txs[0].tokenContract, tokenAddress);
    assert.equal(history.txs[0].tokenSymbol, 'USDT');
    assert.equal(history.txs[0].tokenDecimals, 6);
    assert.equal(history.txs[0].value, '1500000');

    await handleMessage({ type: 'REMOVE_TRC20_TOKEN', contractAddress: tokenAddress });
    const snapshotWithoutToken = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    assert.equal(snapshotWithoutToken.wallet.watchedTokens.length, 0);
  });

  test('Tron resource and contract failures surface actionable errors', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Tron Shasta',
        chainId: 2494104990,
        rpcUrl: 'https://api.shasta.trongrid.io',
        kind: 'tron',
        symbol: 'TRX',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    const tokenAddress = snapshot.activeAddress;

    tronFailureMode = 'trigger-revert';
    await assert.rejects(
      () => handleMessage({
        type: 'SEND_TRC20_TRANSFER',
        contractAddress: tokenAddress,
        to: snapshot.activeAddress,
        amount: '1.5',
        decimals: 6,
        symbol: 'USDT',
      }),
      /TRC20 contract reverted: REVERT opcode executed/,
    );

    tronFailureMode = 'broadcast-energy';
    await assert.rejects(
      () => handleMessage({ type: 'SEND_TX', to: snapshot.activeAddress, value: '1.25' }),
      /Energy is insufficient; freeze or rent Energy/,
    );

    tronFailureMode = 'broadcast-bandwidth';
    await assert.rejects(
      () => handleMessage({ type: 'SEND_TX', to: snapshot.activeAddress, value: '1.25' }),
      /Bandwidth is insufficient; freeze TRX for bandwidth/,
    );

    tronFailureMode = 'ok';
    const sent = await handleMessage({ type: 'SEND_TX', to: snapshot.activeAddress, value: '1.25' });
    tronFailureMode = 'status-revert';
    await listeners.onAlarm[0]({ name: 'shella-tx-poll' });
    const history = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    assert.equal(history.txs[0].txHash, sent.txHash);
    assert.equal(history.txs[0].status, 'failed');
    assert.match(history.txs[0].error, /TRC20 contract reverted: execution reverted: TRC20 transfer amount exceeds balance/);
  });

  test('Tron dApp provider connects and submits TRX/TRC20 transfers', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Tron Shasta',
        chainId: 2494104990,
        rpcUrl: 'https://api.shasta.trongrid.io',
        kind: 'tron',
        symbol: 'TRX',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    const origin = 'https://tron-dapp.example.com';

    const approvalsBeforeConnect = createdWindows.length;
    const connectPromise = handleMessage({
      type: 'DAPP_REQUEST',
      origin,
      method: 'tron_requestAccounts',
      params: [],
    });
    await resolveLatestApproval(true, approvalsBeforeConnect);
    const connected = await connectPromise;
    assert.deepEqual(connected, { code: 200, message: 'ok', accounts: [snapshot.activeAddress] });

    const accounts = await handleMessage({
      type: 'DAPP_REQUEST',
      origin,
      method: 'tron_accounts',
      params: [],
    });
    assert.deepEqual(accounts, [snapshot.activeAddress]);

    const chainId = await handleMessage({
      type: 'DAPP_REQUEST',
      origin,
      method: 'tron_chainId',
      params: [],
    });
    assert.equal(chainId, '2494104990');

    const balance = await handleMessage({
      type: 'DAPP_REQUEST',
      origin,
      method: 'tron_getBalance',
      params: [snapshot.activeAddress],
    });
    assert.equal(balance, '123456789');

    const approvalsBeforeTrx = createdWindows.length;
    const trxPromise = handleMessage({
      type: 'DAPP_REQUEST',
      origin,
      method: 'tron_sendTransaction',
      params: [{ to: snapshot.activeAddress, amountSun: 1250000 }],
    });
    await resolveLatestApproval(true, approvalsBeforeTrx);
    const trxSent = await trxPromise;
    assert.deepEqual(trxSent, { txHash: 'a'.repeat(64) });

    const approvalsBeforeToken = createdWindows.length;
    const tokenPromise = handleMessage({
      type: 'DAPP_REQUEST',
      origin,
      method: 'tron_sendTrc20Transfer',
      params: [{
        contractAddress: snapshot.activeAddress,
        to: snapshot.activeAddress,
        amount: '1.5',
        decimals: 6,
        symbol: 'USDT',
      }],
    });
    await resolveLatestApproval(true, approvalsBeforeToken);
    const tokenSent = await tokenPromise;
    assert.deepEqual(tokenSent, { txHash: 'b'.repeat(64) });

    const history = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    assert.equal(history.txs[0].shellType, 'trc20Transfer');
    assert.equal(history.txs[1].shellType, 'tronTransfer');
  });

  test('Solana network uses derived address, balance adapter, and transfer signing', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Solana Devnet',
        chainId: 103,
        rpcUrl: 'https://api.devnet.solana.com',
        kind: 'solana',
        symbol: 'SOL',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    assert.equal(snapshot.activeChainKind, 'solana');
    assert.match(snapshot.activeAddress, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    assert.deepEqual(snapshot.balance, { raw: '1234567890', formatted: '1.23456789' });
    assert.equal(snapshot.nonce, null);

    const sent = await handleMessage({ type: 'SEND_TX', to: snapshot.activeAddress, value: '0.5' });
    assert.deepEqual(sent, { txHash: 'solsig111111111111111111111111111111111111111111111111111111111111' });
    assert.equal(solanaRequests.some((entry) => entry.body.method === 'getLatestBlockhash'), true);
    assert.equal(solanaRequests.some((entry) => entry.body.method === 'sendTransaction'), true);

    const history = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    assert.equal(history.total, 1);
    assert.equal(history.txs[0].chainKind, 'solana');
    assert.equal(history.txs[0].value, '500000000');
    assert.equal(history.txs[0].shellType, 'solanaTransfer');
  });

  test('TON network uses derived wallet address and balance adapter', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'TON Mainnet',
        chainId: 607,
        rpcUrl: 'https://toncenter.com/api/v2',
        kind: 'ton',
        symbol: 'TON',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    assert.equal(snapshot.activeChainKind, 'ton');
    assert.match(snapshot.activeAddress, /^[A-Za-z0-9_-]{48}$/);
    assert.deepEqual(snapshot.balance, { raw: '1234567890', formatted: '1.23456789' });
    assert.equal(snapshot.nonce, null);

    const remoteHistory = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    assert.equal(remoteHistory.total, 1);
    assert.equal(remoteHistory.txs[0].source, 'remote');
    assert.equal(remoteHistory.txs[0].chainKind, 'ton');
    assert.equal(remoteHistory.txs[0].value, '250000000');
    assert.equal(remoteHistory.txs[0].status, 'confirmed');
    assert.equal(remoteHistory.txs[0].blockNumber, '123450');

    const sent = await handleMessage({ type: 'SEND_TX', to: snapshot.activeAddress, value: '0.1' });
    assert.match(sent.txHash, /^[0-9a-f]{64}$/);
    const history = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    assert.equal(history.total, 2);
    assert.equal(history.txs[0].chainKind, 'ton');
    assert.equal(history.txs[0].value, '100000000');
    assert.equal(history.txs[0].nonce, 7);
    assert.equal(history.txs[0].shellType, 'tonTransfer');

    tonTransactionLookupHash = sent.txHash;
    await listeners.onAlarm[0]({ name: 'shella-tx-poll' });
    const confirmed = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    assert.equal(confirmed.txs[0].status, 'confirmed');
    assert.equal(confirmed.txs[0].blockNumber, '123456');
  });

  test('Aptos network uses derived address, balance adapter, and native transfer with gated dApp methods', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Aptos Testnet',
        chainId: 2,
        rpcUrl: 'https://fullnode.testnet.aptoslabs.com/v1',
        kind: 'aptos',
        symbol: 'APT',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    assert.equal(snapshot.activeChainKind, 'aptos');
    assert.match(snapshot.activeAddress, /^0x[0-9a-f]{64}$/);
    assert.equal(snapshot.activeAddress, snapshot.wallet.accounts[0].chainAddresses.aptos);
    assert.deepEqual(snapshot.balance, { raw: '123456789', formatted: '1.23456789' });
    assert.equal(snapshot.nonce, 9);

    const capabilities = await handleMessage({ type: 'GET_CHAIN_CAPABILITIES' });
    assert.equal(capabilities.readBalance, true);
    assert.equal(capabilities.nativeTransfers, true);
    assert.equal(capabilities.signTransactions, true);
    assert.equal(capabilities.dappProvider, true);

    const dappMethods = await handleMessage({ type: 'GET_DAPP_METHODS' });
    assert.ok(dappMethods.methods.includes('aptos_connect'));
    assert.ok(dappMethods.methods.includes('aptos_signAndSubmitTransaction'));
    const sent = await handleMessage({ type: 'SEND_TX', to: snapshot.activeAddress, value: '0.1' });
    assert.deepEqual(sent, { txHash: '0x' + 'a'.repeat(64) });
    assert.equal(aptosRequests.some((entry) => entry.kind === 'account'), true);
    assert.equal(aptosRequests.some((entry) => entry.kind === 'gas'), true);
    assert.equal(aptosRequests.some((entry) => entry.kind === 'ledger'), true);
    const broadcast = aptosRequests.find((entry) => entry.kind === 'broadcast');
    assert.equal(broadcast.contentType, 'application/x.aptos.signed_transaction+bcs');
    assert.ok(broadcast.byteLength > 200);
    assert.equal(broadcast.rawTransactionChainId, 2);

    const history = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    assert.equal(history.total, 1);
    assert.equal(history.txs[0].chainKind, 'aptos');
    assert.equal(history.txs[0].value, '10000000');
    assert.equal(history.txs[0].nonce, 9);
    assert.equal(history.txs[0].shellType, 'aptosTransfer');
    assert.equal(history.txs[0].aptosMaxGasAmount, '2000');
    assert.equal(history.txs[0].aptosGasUnitPrice, '100');
    assert.match(history.txs[0].aptosExpirationTimestampSecs, /^\d+$/);

    await listeners.onAlarm[0]({ name: 'shella-tx-poll' });
    const confirmed = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    assert.equal(confirmed.txs[0].status, 'confirmed');
    assert.equal(confirmed.txs[0].blockNumber, '42');
    assert.equal(aptosRequests.some((entry) => entry.kind === 'status'), true);
  });

  test('Aptos dApp provider connects and submits only previewed native transfer payloads', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Aptos Testnet',
        chainId: 2,
        rpcUrl: 'https://fullnode.testnet.aptoslabs.com/v1',
        kind: 'aptos',
        symbol: 'APT',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    const approvalsBeforeConnect = createdWindows.length;
    const connectPromise = handleMessage({
      type: 'DAPP_REQUEST',
      origin: 'https://aptos-dapp.example/path',
      method: 'aptos_connect',
      params: [],
    });
    const connectApproval = await resolveLatestApproval(true, approvalsBeforeConnect);
    assert.equal(connectApproval.kind, 'connect');
    assert.equal(connectApproval.payload.chainKind, 'aptos');
    const connected = await connectPromise;
    assert.equal(connected.address, snapshot.activeAddress);
    assert.match(connected.publicKey, /^0x[0-9a-f]{64}$/);

    const account = await handleMessage({
      type: 'DAPP_REQUEST',
      origin: 'https://aptos-dapp.example/path',
      method: 'aptos_account',
      params: [],
    });
    assert.equal(account.address, snapshot.activeAddress);

    const network = await handleMessage({
      type: 'DAPP_REQUEST',
      origin: 'https://aptos-dapp.example/path',
      method: 'aptos_network',
      params: [],
    });
    assert.equal(network.chainId, 2);
    assert.equal(network.name, 'Aptos Testnet');

    const balance = await handleMessage({
      type: 'DAPP_REQUEST',
      origin: 'https://aptos-dapp.example/path',
      method: 'aptos_getBalance',
      params: [],
    });
    assert.deepEqual(balance, { balance: '123456789', formatted: '1.23456789' });

    aptosRequests.length = 0;
    const approvalsBeforeSubmit = createdWindows.length;
    const submitPromise = handleMessage({
      type: 'DAPP_REQUEST',
      origin: 'https://aptos-dapp.example/path',
      method: 'aptos_signAndSubmitTransaction',
      params: [{
        type: 'entry_function_payload',
        function: '0x1::aptos_account::transfer',
        arguments: [snapshot.activeAddress, '10000000'],
      }],
    });
    const submitApproval = await resolveLatestApproval(true, approvalsBeforeSubmit);
    assert.equal(submitApproval.kind, 'aptos-sign-transaction');
    assert.equal(submitApproval.payload.account, snapshot.activeAddress);
    assert.equal(submitApproval.payload.knownAction, 'nativeTransfer');
    assert.equal(submitApproval.payload.recipient, snapshot.activeAddress);
    assert.equal(submitApproval.payload.amountOctas, '10000000');
    const submitted = await submitPromise;
    assert.deepEqual(submitted, { hash: '0x' + 'a'.repeat(64) });
    assert.equal(aptosRequests.some((entry) => entry.kind === 'broadcast'), true);

    const approvalsBeforeUnknown = createdWindows.length;
    await assert.rejects(
      handleMessage({
        type: 'DAPP_REQUEST',
        origin: 'https://aptos-dapp.example/path',
        method: 'aptos_signAndSubmitTransaction',
        params: [{ function: '0x1::coin::transfer', arguments: [snapshot.activeAddress, '1'] }],
      }),
      /Only Aptos native transfer dApp payloads are supported/,
    );
    assert.equal(createdWindows.length, approvalsBeforeUnknown);
  });

  test('native dApp permissions are bound to the currently active HD account after account switch', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({ type: 'ADD_ACCOUNT', password: PASSWORD });

    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Tron Shasta',
        chainId: 2494104990,
        rpcUrl: 'https://api.shasta.trongrid.io',
        kind: 'tron',
        symbol: 'TRX',
      },
    });
    const firstTronSnapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    const firstTronAddress = firstTronSnapshot.activeAddress;
    const tronOrigin = 'https://stale-tron.example.com';
    const tronConnectBefore = createdWindows.length;
    const tronConnectPromise = handleMessage({
      type: 'DAPP_REQUEST',
      origin: tronOrigin,
      method: 'tron_requestAccounts',
      params: [],
    });
    await resolveLatestApproval(true, tronConnectBefore);
    assert.deepEqual(await tronConnectPromise, { code: 200, message: 'ok', accounts: [firstTronAddress] });

    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Solana Devnet',
        chainId: 103,
        rpcUrl: 'https://api.devnet.solana.com',
        kind: 'solana',
        symbol: 'SOL',
      },
    });
    const firstSolanaSnapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    const firstSolanaAddress = firstSolanaSnapshot.activeAddress;
    const solanaOrigin = 'https://stale-solana.example.com';
    const solanaConnectBefore = createdWindows.length;
    const solanaConnectPromise = handleMessage({
      type: 'DAPP_REQUEST',
      origin: solanaOrigin,
      method: 'solana_connect',
      params: [],
    });
    await resolveLatestApproval(true, solanaConnectBefore);
    assert.deepEqual(await solanaConnectPromise, { publicKey: firstSolanaAddress });

    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Aptos Testnet',
        chainId: 2,
        rpcUrl: 'https://fullnode.testnet.aptoslabs.com/v1',
        kind: 'aptos',
        symbol: 'APT',
      },
    });
    const firstAptosSnapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    const firstAptosAddress = firstAptosSnapshot.activeAddress;
    const aptosOrigin = 'https://stale-aptos.example.com';
    const aptosConnectBefore = createdWindows.length;
    const aptosConnectPromise = handleMessage({
      type: 'DAPP_REQUEST',
      origin: aptosOrigin,
      method: 'aptos_connect',
      params: [],
    });
    await resolveLatestApproval(true, aptosConnectBefore);
    assert.equal((await aptosConnectPromise).address, firstAptosAddress);

    const secondShellAddress = firstAptosSnapshot.wallet.accounts[1].pqAddress;
    await handleMessage({ type: 'SWITCH_ACCOUNT', password: PASSWORD, address: secondShellAddress });

    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Tron Shasta',
        chainId: 2494104990,
        rpcUrl: 'https://api.shasta.trongrid.io',
        kind: 'tron',
        symbol: 'TRX',
      },
    });
    assert.deepEqual(await handleMessage({
      type: 'DAPP_REQUEST',
      origin: tronOrigin,
      method: 'tron_accounts',
      params: [],
    }), []);
    const approvalsBeforeStaleNative = createdWindows.length;
    await assert.rejects(
      handleMessage({
        type: 'DAPP_REQUEST',
        origin: tronOrigin,
        method: 'tron_sendTransaction',
        params: [{ to: firstTronAddress, amountSun: 1000 }],
      }),
      /Connected account is not the currently active tron account/,
    );
    await assert.rejects(
      handleMessage({
        type: 'DAPP_REQUEST',
        origin: tronOrigin,
        method: 'tron_sendTrc20Transfer',
        params: [{
          contractAddress: firstTronAddress,
          to: firstTronAddress,
          amount: '1',
          decimals: 6,
          symbol: 'USDT',
        }],
      }),
      /Connected account is not the currently active tron account/,
    );
    assert.equal(createdWindows.length, approvalsBeforeStaleNative);

    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Solana Devnet',
        chainId: 103,
        rpcUrl: 'https://api.devnet.solana.com',
        kind: 'solana',
        symbol: 'SOL',
      },
    });
    assert.deepEqual(await handleMessage({
      type: 'DAPP_REQUEST',
      origin: solanaOrigin,
      method: 'solana_accounts',
      params: [],
    }), []);
    await assert.rejects(
      handleMessage({
        type: 'DAPP_REQUEST',
        origin: solanaOrigin,
        method: 'solana_signAndSendTransaction',
        params: [{ to: firstSolanaAddress, lamports: 1000 }],
      }),
      /Connected account is not the currently active solana account/,
    );
    await assert.rejects(
      handleMessage({
        type: 'DAPP_REQUEST',
        origin: solanaOrigin,
        method: 'solana_sendSplTransfer',
        params: [{
          contractAddress: firstSolanaAddress,
          to: firstSolanaAddress,
          amount: '1',
          decimals: 6,
          symbol: 'SPL',
        }],
      }),
      /Connected account is not the currently active solana account/,
    );
    assert.equal(createdWindows.length, approvalsBeforeStaleNative);

    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Aptos Testnet',
        chainId: 2,
        rpcUrl: 'https://fullnode.testnet.aptoslabs.com/v1',
        kind: 'aptos',
        symbol: 'APT',
      },
    });
    assert.equal(await handleMessage({
      type: 'DAPP_REQUEST',
      origin: aptosOrigin,
      method: 'aptos_account',
      params: [],
    }), null);
    await assert.rejects(
      handleMessage({
        type: 'DAPP_REQUEST',
        origin: aptosOrigin,
        method: 'aptos_signAndSubmitTransaction',
        params: [{
          type: 'entry_function_payload',
          function: '0x1::aptos_account::transfer',
          arguments: [firstAptosAddress, '10000000'],
        }],
      }),
      /Connected account is not the currently active aptos account/,
    );
    assert.equal(createdWindows.length, approvalsBeforeStaleNative);
  });

  test('Aptos Devnet transfer signs with live ledger chain id instead of stale preset chain id', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Aptos Devnet',
        chainId: 35,
        rpcUrl: 'https://fullnode.devnet.aptoslabs.com/v1',
        kind: 'aptos',
        symbol: 'APT',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    aptosRequests.length = 0;
    aptosLedgerChainId = 240;

    const sent = await handleMessage({ type: 'SEND_TX', to: snapshot.activeAddress, value: '0.1' });
    assert.deepEqual(sent, { txHash: '0x' + 'a'.repeat(64) });
    const broadcast = aptosRequests.find((entry) => entry.kind === 'broadcast');
    assert.equal(aptosRequests.some((entry) => entry.kind === 'ledger'), true);
    assert.equal(broadcast.rawTransactionChainId, 240);
  });

  test('Aptos transaction status failures are stored with VM-safe errors', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Aptos Testnet',
        chainId: 2,
        rpcUrl: 'https://fullnode.testnet.aptoslabs.com/v1',
        kind: 'aptos',
        symbol: 'APT',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    const txHash = '0x' + 'b'.repeat(64);
    await upsertTxRecord({
      txHash,
      from: snapshot.activeAddress,
      to: snapshot.activeAddress,
      value: '1',
      data: '0x',
      nonce: 10,
      chainKind: 'aptos',
      status: 'pending',
      source: 'local',
      shellType: 'aptosTransfer',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    aptosStatusMode = 'failed-gas';
    await listeners.onAlarm[0]({ name: 'shella-tx-poll' });
    const history = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    const failed = history.txs.find((tx) => tx.txHash === txHash);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.blockNumber, '45');
    assert.equal(failed.error, 'Aptos transaction ran out of gas.');
  });

  test('Aptos transfer prechecks APT balance for amount plus max gas before broadcast', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Aptos Testnet',
        chainId: 2,
        rpcUrl: 'https://fullnode.testnet.aptoslabs.com/v1',
        kind: 'aptos',
        symbol: 'APT',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    aptosRequests.length = 0;
    aptosBalanceValue = '10000000';

    await assert.rejects(
      handleMessage({ type: 'SEND_TX', to: snapshot.activeAddress, value: '0.1' }),
      /Insufficient APT balance for amount and gas/,
    );
    assert.equal(aptosRequests.some((entry) => entry.kind === 'account'), true);
    assert.equal(aptosRequests.some((entry) => entry.kind === 'gas'), true);
    assert.equal(aptosRequests.some((entry) => entry.kind === 'balance'), true);
    assert.equal(aptosRequests.some((entry) => entry.kind === 'broadcast'), false);
  });

  test('Aptos transfer reports unfunded account before broadcast', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Aptos Testnet',
        chainId: 2,
        rpcUrl: 'https://fullnode.testnet.aptoslabs.com/v1',
        kind: 'aptos',
        symbol: 'APT',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    aptosRequests.length = 0;
    aptosAccountMode = 'not-found';

    await assert.rejects(
      handleMessage({ type: 'SEND_TX', to: snapshot.activeAddress, value: '0.1' }),
      /Aptos account is not funded or not created/,
    );
    assert.equal(aptosRequests.some((entry) => entry.kind === 'account'), true);
    assert.equal(aptosRequests.some((entry) => entry.kind === 'broadcast'), false);
  });

  test('TonConnect sessions use active TON account and proposal approval', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await assert.rejects(
      handleMessage({
        type: 'CREATE_TONCONNECT_SESSION',
        clientId: 'ton-client-wrong-network',
        origin: 'https://ton-dapp.example',
        manifestUrl: 'https://ton-dapp.example/tonconnect-manifest.json',
        expirySeconds: 60,
      }),
      /TonConnect is only available on TON networks/,
    );
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'TON Mainnet',
        chainId: 607,
        rpcUrl: 'https://toncenter.com/api/v2',
        kind: 'ton',
        symbol: 'TON',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });

    const session = await handleMessage({
      type: 'CREATE_TONCONNECT_SESSION',
      clientId: 'ton-client-1',
      origin: 'https://ton-dapp.example/path',
      manifestUrl: 'https://ton-dapp.example/tonconnect-manifest.json',
      expirySeconds: 60,
    });
    assert.equal(session.clientId, 'ton-client-1');
    assert.equal(session.origin, 'https://ton-dapp.example');
    assert.equal(session.account, snapshot.activeAddress);
    assert.equal(session.chainId, 607);
    assert.equal(session.network, 'mainnet');
    assert.deepEqual(session.features.map((feature) => feature.name), ['SendTransaction', 'SignData', 'ton_proof']);

    let listed = await handleMessage({ type: 'GET_TONCONNECT_SESSIONS' });
    assert.equal(listed.sessions.length, 1);
    assert.equal(listed.sessions[0].clientId, 'ton-client-1');

    const approvalsBeforeReject = createdWindows.length;
    const rejected = handleMessage({
      type: 'APPROVE_TONCONNECT_PROPOSAL',
      clientId: 'ton-client-rejected',
      origin: 'https://ton-dapp.example',
      manifestUrl: 'https://ton-dapp.example/tonconnect-manifest.json',
      requestedItems: ['ton_addr', 'ton_proof'],
      expirySeconds: 60,
    });
    const rejectedRequest = await resolveLatestApproval(false, approvalsBeforeReject);
    assert.equal(rejectedRequest.kind, 'tonconnect-proposal');
    assert.equal(rejectedRequest.payload.account, snapshot.activeAddress);
    assert.equal(rejectedRequest.payload.network, 'mainnet');
    assert.deepEqual(rejectedRequest.payload.requestedItems, ['ton_addr', 'ton_proof']);
    await assert.rejects(rejected, /Request rejected by user/);
    listed = await handleMessage({ type: 'GET_TONCONNECT_SESSIONS' });
    assert.equal(listed.sessions.some((item) => item.clientId === 'ton-client-rejected'), false);

    const approvalsBeforeApprove = createdWindows.length;
    const approved = handleMessage({
      type: 'APPROVE_TONCONNECT_PROPOSAL',
      clientId: 'ton-client-approved',
      origin: 'https://ton-dapp.example',
      manifestUrl: 'https://ton-dapp.example/tonconnect-manifest.json',
      features: [{ name: 'SendTransaction', maxMessages: 4 }],
      expirySeconds: 60,
    });
    const approvedRequest = await resolveLatestApproval(true, approvalsBeforeApprove);
    assert.equal(approvedRequest.kind, 'tonconnect-proposal');
    const approvedSession = await approved;
    assert.equal(approvedSession.clientId, 'ton-client-approved');
    assert.deepEqual(approvedSession.features, [{ name: 'SendTransaction', maxMessages: 4 }]);

    listed = await handleMessage({ type: 'GET_TONCONNECT_SESSIONS' });
    assert.equal(listed.sessions.some((item) => item.clientId === 'ton-client-approved'), true);
    await handleMessage({ type: 'REMOVE_TONCONNECT_SESSION', clientId: 'ton-client-approved' });
    listed = await handleMessage({ type: 'GET_TONCONNECT_SESSIONS' });
    assert.equal(listed.sessions.some((item) => item.clientId === 'ton-client-approved'), false);

    const approvalsBeforeDapp = createdWindows.length;
    const dappConnect = handleMessage({
      type: 'DAPP_REQUEST',
      origin: 'https://ton-dapp.example/page',
      method: 'tonconnect_connect',
      params: [{
        clientId: 'ton-client-dapp',
        manifestUrl: 'https://ton-dapp.example/tonconnect-manifest.json',
        requestedItems: ['ton_addr'],
      }],
    });
    const dappRequest = await resolveLatestApproval(true, approvalsBeforeDapp);
    assert.equal(dappRequest.kind, 'tonconnect-proposal');
    assert.equal(dappRequest.origin, 'https://ton-dapp.example');
    const dappSession = await dappConnect;
    assert.equal(dappSession.clientId, 'ton-client-dapp');
    assert.equal(dappSession.origin, 'https://ton-dapp.example');

    const restored = await handleMessage({
      type: 'DAPP_REQUEST',
      origin: 'https://ton-dapp.example/page',
      method: 'tonconnect_restoreConnection',
      params: [],
    });
    assert.equal(restored.sessions.some((item) => item.clientId === 'ton-client-dapp'), true);

    const approvalsBeforeRejectTx = createdWindows.length;
    const rejectedTx = handleMessage({
      type: 'DAPP_REQUEST',
      origin: 'https://ton-dapp.example/page',
      method: 'tonconnect_send',
      params: [{
        clientId: 'ton-client-dapp',
        method: 'sendTransaction',
        params: [{
          valid_until: Math.floor(Date.now() / 1000) + 60,
          messages: [{ address: snapshot.activeAddress, amount: '100000000' }],
        }],
      }],
    });
    const rejectedTxRequest = await resolveLatestApproval(false, approvalsBeforeRejectTx);
    assert.equal(rejectedTxRequest.kind, 'tonconnect-request');
    assert.equal(rejectedTxRequest.payload.totalNanotons, '100000000');
    await assert.rejects(rejectedTx, /Request rejected by user/);

    const approvalsBeforeSend = createdWindows.length;
    const sent = handleMessage({
      type: 'DAPP_REQUEST',
      origin: 'https://ton-dapp.example/page',
      method: 'tonconnect_send',
      params: [{
        clientId: 'ton-client-dapp',
        method: 'sendTransaction',
        params: [{
          valid_until: Math.floor(Date.now() / 1000) + 60,
          messages: [{ address: snapshot.activeAddress, amount: '100000000' }],
        }],
      }],
    });
    const sendRequest = await resolveLatestApproval(true, approvalsBeforeSend);
    assert.equal(sendRequest.kind, 'tonconnect-request');
    assert.equal(sendRequest.payload.messages[0].to, snapshot.activeAddress);
    const sentResult = await sent;
    assert.match(sentResult.txHash, /^[0-9a-f]{64}$/);
    const history = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    assert.equal(history.txs[0].shellType, 'tonConnectSendTransaction');
    assert.equal(history.txs[0].value, '100000000');

    const approvalsBeforeSignReject = createdWindows.length;
    const rejectedSign = handleMessage({
      type: 'DAPP_REQUEST',
      origin: 'https://ton-dapp.example/page',
      method: 'tonconnect_send',
      params: [{
        clientId: 'ton-client-dapp',
        method: 'signData',
        params: [{ type: 'text', text: 'Reject this message' }],
      }],
    });
    const rejectedSignRequest = await resolveLatestApproval(false, approvalsBeforeSignReject);
    assert.equal(rejectedSignRequest.kind, 'tonconnect-request');
    assert.equal(rejectedSignRequest.payload.method, 'signData');
    assert.equal(rejectedSignRequest.payload.type, 'text');
    await assert.rejects(rejectedSign, /Request rejected by user/);

    const approvalsBeforeSign = createdWindows.length;
    const signed = handleMessage({
      type: 'DAPP_REQUEST',
      origin: 'https://ton-dapp.example/page',
      method: 'tonconnect_send',
      params: [{
        clientId: 'ton-client-dapp',
        method: 'signData',
        params: [{ type: 'text', text: 'Confirm account ownership' }],
      }],
    });
    const signRequest = await resolveLatestApproval(true, approvalsBeforeSign);
    assert.equal(signRequest.kind, 'tonconnect-request');
    assert.equal(signRequest.payload.payload, 'Confirm account ownership');
    const signedResult = await signed;
    assert.match(signedResult.signature, /^[A-Za-z0-9+/]+={0,2}$/);
    assert.equal(signedResult.address, snapshot.activeAddress);
    assert.equal(signedResult.type, 'text');
    assert.match(signedResult.publicKey, /^[0-9a-f]{64}$/);

    const approvalsBeforeProof = createdWindows.length;
    const proof = handleMessage({
      type: 'DAPP_REQUEST',
      origin: 'https://ton-dapp.example/page',
      method: 'tonconnect_send',
      params: [{
        clientId: 'ton-client-dapp',
        method: 'ton_proof',
        params: [{ payload: 'server-nonce-123', timestamp: 1_700_000_000 }],
      }],
    });
    const proofRequest = await resolveLatestApproval(true, approvalsBeforeProof);
    assert.equal(proofRequest.kind, 'tonconnect-request');
    assert.equal(proofRequest.payload.method, 'ton_proof');
    assert.equal(proofRequest.payload.domain, 'ton-dapp.example');
    assert.equal(proofRequest.payload.payload, 'server-nonce-123');
    const proofResult = await proof;
    assert.equal(proofResult.proof.timestamp, 1_700_000_000);
    assert.deepEqual(proofResult.proof.domain, { lengthBytes: 16, value: 'ton-dapp.example' });
    assert.equal(proofResult.proof.payload, 'server-nonce-123');
    assert.match(proofResult.proof.signature, /^[A-Za-z0-9+/]+={0,2}$/);
    assert.match(proofResult.publicKey, /^[0-9a-f]{64}$/);

    await assert.rejects(
      handleMessage({
        type: 'DAPP_REQUEST',
        origin: 'https://ton-dapp.example/page',
        method: 'tonconnect_send',
        params: [{
          clientId: 'ton-client-dapp',
          method: 'ton_proof',
          params: [{ payload: 'server-nonce-123', domain: 'evil.example' }],
        }],
      }),
      /TonConnect proof domain must match the connected origin/,
    );
  });

  test('TON remote history merges TonAPI Jetton transfer labels', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'TON Mainnet',
        chainId: 607,
        rpcUrl: 'https://toncenter.com/api/v2',
        kind: 'ton',
        symbol: 'TON',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    tonJettonHistoryEnabled = true;

    const history = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    const jetton = history.txs.find((tx) => tx.shellType === 'jettonTransfer');
    assert.equal(history.total, 2);
    assert.equal(jetton?.chainKind, 'ton');
    assert.equal(jetton?.source, 'remote');
    assert.equal(jetton?.value, '42000000');
    assert.equal(jetton?.tokenSymbol, 'JET');
    assert.equal(jetton?.tokenDecimals, 6);
    assert.match(jetton?.tokenContract ?? '', /^[A-Za-z0-9_-]{48}$/);
  });

  test('TON pending transactions expire after the long pending window', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'TON Mainnet',
        chainId: 607,
        rpcUrl: 'https://toncenter.com/api/v2',
        kind: 'ton',
        symbol: 'TON',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    const sent = await handleMessage({ type: 'SEND_TX', to: snapshot.activeAddress, value: '0.1' });
    tonTransactionLookupHash = null;
    const staleCreatedAt = Date.now() - 25 * 60 * 60 * 1000;
    await setTxQueue((await getTxQueue()).map((tx) => tx.txHash === sent.txHash
      ? { ...tx, createdAt: staleCreatedAt, updatedAt: staleCreatedAt }
      : tx));

    await listeners.onAlarm[0]({ name: 'shella-tx-poll' });
    const history = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    const expired = history.txs.find((tx) => tx.txHash === sent.txHash);
    assert.equal(expired?.status, 'failed');
    assert.equal(expired?.error, 'TON transaction was not found after 24 hours. Check explorer history before retrying.');
  });

  test('TON history and status fall back to tonapi when toncenter transactions fail', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'TON Mainnet',
        chainId: 607,
        rpcUrl: 'https://toncenter.com/api/v2',
        kind: 'ton',
        symbol: 'TON',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    tonCenterTransactionsFail = true;
    const remoteHistory = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    assert.equal(remoteHistory.total, 1);
    assert.equal(remoteHistory.txs[0].value, '350000000');
    assert.equal(remoteHistory.txs[0].blockNumber, '223450');

    const sent = await handleMessage({ type: 'SEND_TX', to: snapshot.activeAddress, value: '0.1' });
    tonTransactionLookupHash = sent.txHash;
    await listeners.onAlarm[0]({ name: 'shella-tx-poll' });
    const confirmed = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    const local = confirmed.txs.find((tx) => tx.txHash === sent.txHash);
    assert.equal(local?.status, 'confirmed');
    assert.equal(local?.blockNumber, '223456');
  });

  test('TON uninitialized wallet sends first transfer with StateInit', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'TON Mainnet',
        chainId: 607,
        rpcUrl: 'https://toncenter.com/api/v2',
        kind: 'ton',
        symbol: 'TON',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    tonWalletInformationState = 'uninitialized';

    const sent = await handleMessage({ type: 'SEND_TX', to: snapshot.activeAddress, value: '0.1' });
    assert.match(sent.txHash, /^[0-9a-f]{64}$/);
    assert.ok(lastTonBocLength > 1000, 'StateInit sendBoc should include Wallet V4R2 code and data');
    const history = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    assert.equal(history.txs[0].nonce, 0);
    assert.equal(history.txs[0].shellType, 'tonTransfer');
  });

  test('TON Jetton info, add, balance, and transfer are supported through token provider registry', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'TON Mainnet',
        chainId: 607,
        rpcUrl: 'https://toncenter.com/api/v2',
        kind: 'ton',
        symbol: 'TON',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    const masterAddress = snapshot.activeAddress;

    const info = await handleMessage({ type: 'GET_JETTON_TOKEN_INFO', contractAddress: masterAddress });
    assert.equal(info.contractAddress, masterAddress);
    assert.equal(info.walletAddress, masterAddress);
    assert.equal(info.decimals, 6);
    assert.equal(info.symbol, 'JET');

    await handleMessage({ type: 'ADD_JETTON_TOKEN', contractAddress: masterAddress });
    const snapshotWithToken = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    assert.equal(snapshotWithToken.wallet.watchedTokens.length, 1);
    assert.equal(snapshotWithToken.wallet.watchedTokens[0].chainKind, 'ton');
    assert.equal(snapshotWithToken.wallet.watchedTokens[0].symbol, 'JET');

    const balance = await handleMessage({
      type: 'GET_JETTON_BALANCE',
      contractAddress: masterAddress,
      decimals: 6,
      symbol: 'JET',
    });
    assert.deepEqual(balance, { balance: '1234500', formatted: '1.2345', decimals: 6, symbol: 'JET' });

    const sent = await handleMessage({
      type: 'SEND_JETTON_TRANSFER',
      contractAddress: masterAddress,
      to: snapshot.activeAddress,
      amount: '0.5',
      decimals: 6,
      symbol: 'JET',
      jettonTransferTonAmount: '0.02',
      forwardTonAmount: '0.000000002',
    });
    assert.match(sent.txHash, /^[0-9a-f]{64}$/);
    assert.ok(lastTonBocLength > 100);

    const history = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    assert.equal(history.txs[0].chainKind, 'ton');
    assert.equal(history.txs[0].value, '500000');
    assert.equal(history.txs[0].shellType, 'jettonTransfer');
    assert.equal(history.txs[0].tokenSymbol, 'JET');
  });

  test('TON Jetton transfer prechecks attached TON fee balance', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'TON Mainnet',
        chainId: 607,
        rpcUrl: 'https://toncenter.com/api/v2',
        kind: 'ton',
        symbol: 'TON',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    tonBalanceResult = '1000';

    await assert.rejects(
      handleMessage({
        type: 'SEND_JETTON_TRANSFER',
        contractAddress: snapshot.activeAddress,
        to: snapshot.activeAddress,
        amount: '0.5',
        decimals: 6,
        symbol: 'JET',
      }),
      /Insufficient TON balance for Jetton transfer fee/,
    );
    assert.equal(lastTonBocLength, 0);
  });

  test('TON Jetton info falls back to TEP-64 on-chain metadata when TonAPI metadata fails', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'TON Mainnet',
        chainId: 607,
        rpcUrl: 'https://toncenter.com/api/v2',
        kind: 'ton',
        symbol: 'TON',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    tonJettonMetadataFail = true;

    const info = await handleMessage({ type: 'GET_JETTON_TOKEN_INFO', contractAddress: snapshot.activeAddress });
    assert.equal(info.symbol, 'ONC');
    assert.equal(info.decimals, 7);
  });

  test('TON Jetton history can be queried for a single master token', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'TON Mainnet',
        chainId: 607,
        rpcUrl: 'https://toncenter.com/api/v2',
        kind: 'ton',
        symbol: 'TON',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });

    const history = await handleMessage({
      type: 'GET_JETTON_HISTORY',
      contractAddress: snapshot.activeAddress,
      ownerAddress: snapshot.activeAddress,
      page: 0,
      limit: 20,
    });
    assert.equal(history.total, 1);
    assert.equal(history.txs[0].chainKind, 'ton');
    assert.equal(history.txs[0].shellType, 'jettonTransfer');
    assert.equal(history.txs[0].value, '99000000');
    assert.equal(history.txs[0].blockNumber, '323450');
    assert.equal(history.txs[0].tokenSymbol, 'JET');
    assert.equal(history.txs[0].tokenDecimals, 6);
  });

  test('TON Jetton pending status can confirm from single master token history', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'TON Mainnet',
        chainId: 607,
        rpcUrl: 'https://toncenter.com/api/v2',
        kind: 'ton',
        symbol: 'TON',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    const txHash = '8'.repeat(64);
    await upsertTxRecord({
      txHash,
      chainKind: 'ton',
      from: snapshot.activeAddress,
      to: snapshot.activeAddress,
      value: '99000000',
      data: '0x',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'pending',
      source: 'local',
      shellType: 'jettonTransfer',
      tokenContract: snapshot.activeAddress,
      tokenSymbol: 'JET',
      tokenDecimals: 6,
    });

    await listeners.onAlarm[0]({ name: 'shella-tx-poll' });
    const history = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    const confirmed = history.txs.find((tx) => tx.txHash === txHash);
    assert.equal(confirmed?.status, 'confirmed');
    assert.equal(confirmed?.blockNumber, '323450');
  });

  test('Solana SPL token info, add, balance, and transfer are supported', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Solana Devnet',
        chainId: 103,
        rpcUrl: 'https://api.devnet.solana.com',
        kind: 'solana',
        symbol: 'SOL',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    const mintAddress = snapshot.activeAddress;

    const info = await handleMessage({ type: 'GET_SPL_TOKEN_INFO', contractAddress: mintAddress });
    assert.deepEqual(info, { contractAddress: mintAddress, decimals: 6, symbol: 'SPL' });

    await handleMessage({ type: 'ADD_SPL_TOKEN', contractAddress: mintAddress });
    const snapshotWithToken = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    assert.equal(snapshotWithToken.wallet.watchedTokens.length, 1);
    assert.equal(snapshotWithToken.wallet.watchedTokens[0].chainKind, 'solana');
    assert.equal(snapshotWithToken.wallet.watchedTokens[0].contractAddress, mintAddress);
    assert.equal(snapshotWithToken.wallet.watchedTokens[0].symbol, 'SPL');
    assert.equal(snapshotWithToken.wallet.watchedTokens[0].decimals, 6);

    const balance = await handleMessage({
      type: 'GET_SPL_BALANCE',
      contractAddress: mintAddress,
      ownerAddress: snapshot.activeAddress,
      decimals: 6,
      symbol: 'SPL',
    });
    assert.deepEqual(balance, { balance: '1234500', formatted: '1.2345', decimals: 6, symbol: 'SPL' });
    assert.equal(solanaRequests.some((entry) => entry.body.method === 'getParsedAccountInfo'), true);
    assert.equal(solanaRequests.some((entry) => entry.body.method === 'getTokenAccountsByOwner'), true);

    const sent = await handleMessage({
      type: 'SEND_SPL_TRANSFER',
      contractAddress: mintAddress,
      to: snapshot.activeAddress,
      amount: '1',
      decimals: 6,
      symbol: 'SPL',
    });
    assert.deepEqual(sent, { txHash: 'solsig111111111111111111111111111111111111111111111111111111111111' });
    assert.equal(solanaRequests.some((entry) => entry.body.method === 'getLatestBlockhash'), true);
    assert.equal(solanaRequests.some((entry) => entry.body.method === 'sendTransaction'), true);

    const history = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    assert.equal(history.txs[0].chainKind, 'solana');
    assert.equal(history.txs[0].shellType, 'splTransfer');
    assert.equal(history.txs[0].tokenContract, mintAddress);
    assert.equal(history.txs[0].tokenSymbol, 'SPL');
    assert.equal(history.txs[0].tokenDecimals, 6);
    assert.equal(history.txs[0].value, '1000000');
  });

  test('Solana transfer failures surface blockhash, priority fee, ATA, and status errors', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Solana Devnet',
        chainId: 103,
        rpcUrl: 'https://api.devnet.solana.com',
        kind: 'solana',
        symbol: 'SOL',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    const mintAddress = snapshot.activeAddress;

    solanaFailureMode = 'blockhash-expired';
    await assert.rejects(
      handleMessage({ type: 'SEND_TX', to: snapshot.activeAddress, value: '0.1' }),
      /Solana blockhash expired. Refresh the transaction and try again./,
    );

    solanaFailureMode = 'priority-fee';
    await assert.rejects(
      handleMessage({ type: 'SEND_TX', to: snapshot.activeAddress, value: '0.1' }),
      /Solana transaction needs a higher priority fee or compute budget. Retry with priority fee support enabled./,
    );

    solanaFailureMode = 'missing-recipient-token-account';
    const recipientStatus = await handleMessage({
      type: 'GET_SPL_RECIPIENT_ACCOUNT_STATUS',
      contractAddress: mintAddress,
      to: '11111111111111111111111111111111',
      amount: '1',
      decimals: 6,
    });
    assert.equal(recipientStatus.createRecipientAtaRequired, true);
    assert.equal(recipientStatus.rentLamports, '2039280');
    assert.equal(recipientStatus.extraInstruction, 'Create Associated Token Account before SPL TransferChecked');
    assert.match(recipientStatus.expectedAssociatedTokenAccount, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

    await assert.rejects(
      handleMessage({
        type: 'SEND_SPL_TRANSFER',
        contractAddress: mintAddress,
        to: '11111111111111111111111111111111',
        amount: '1',
        decimals: 6,
        symbol: 'SPL',
      }),
      /Recipient SPL token account not found. Create the recipient ATA first; automatic creation requires rent and an extra instruction./,
    );
    const createdAtaTransfer = await handleMessage({
      type: 'SEND_SPL_TRANSFER',
      contractAddress: mintAddress,
      to: '11111111111111111111111111111111',
      amount: '1',
      decimals: 6,
      symbol: 'SPL',
      createRecipientAta: true,
    });
    assert.deepEqual(createdAtaTransfer, { txHash: 'solsig111111111111111111111111111111111111111111111111111111111111' });

    solanaFailureMode = 'ok';
    const sent = await handleMessage({ type: 'SEND_TX', to: snapshot.activeAddress, value: '0.1' });
    solanaFailureMode = 'status-blockhash-expired';
    await listeners.onAlarm[0]({ name: 'shella-tx-poll' });
    const history = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    const failed = history.txs.find((tx) => tx.txHash === sent.txHash);
    assert.equal(failed?.status, 'failed');
    assert.equal(failed?.error, 'Solana blockhash expired. Refresh the transaction and try again.');
  });

  test('Bitcoin network uses derived address and Esplora balance adapter', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Bitcoin Mainnet',
        chainId: 8332,
        rpcUrl: 'https://blockstream.info/api',
        kind: 'bitcoin',
        symbol: 'BTC',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    assert.equal(snapshot.activeChainKind, 'bitcoin');
    assert.match(snapshot.activeAddress, /^bc1[ac-hj-np-z02-9]{11,87}$/);
    assert.deepEqual(snapshot.balance, { raw: '80000000', formatted: '0.8' });
    assert.equal(snapshot.nonce, null);
    assert.equal(bitcoinRequests.filter((entry) => entry.kind === 'balance').length, 1);
    assert.equal(bitcoinRequests[0].url, `https://blockstream.info/api/address/${snapshot.activeAddress}`);

    const utxos = await handleMessage({ type: 'GET_BITCOIN_UTXOS', address: snapshot.activeAddress });
    assert.deepEqual(utxos.inputs, [
      { txid: 'd'.repeat(64), vout: 1, valueSats: '100000000', confirmed: true },
      { txid: 'b'.repeat(64), vout: 0, valueSats: '20000000', confirmed: true },
    ]);
    const batchPreferences = await handleMessage({
      type: 'SET_BITCOIN_UTXO_PREFERENCES',
      preferences: [
        { key: `${'d'.repeat(64)}:1`, label: 'savings', locked: true },
        { key: `${'b'.repeat(64)}:0`, label: 'change', locked: false },
      ],
    });
    assert.equal(batchPreferences.preferences.length, 2);
    assert.equal(batchPreferences.preferences.find((item) => item.key === `${'d'.repeat(64)}:1`).locked, true);

    const preview = await handleMessage({ type: 'PREVIEW_SEND_TX', to: snapshot.activeAddress, value: '0.1' });
    assert.deepEqual(preview, {
      amountSats: '10000000',
      feeSats: '280',
      feeRateSatVb: 2,
      inputCount: 1,
      inputs: [{ txid: 'd'.repeat(64), vout: 1, valueSats: '100000000', confirmed: true }],
      inputTotalSats: '100000000',
      changeSats: '89999720',
      dustSats: '0',
      estimatedVbytes: 140,
      rbfEnabled: true,
    });

    const dustPreview = await handleMessage({ type: 'PREVIEW_SEND_TX', to: snapshot.activeAddress, value: '0.99999682' });
    assert.deepEqual(dustPreview, {
      amountSats: '99999682',
      feeSats: '318',
      feeRateSatVb: 2,
      inputCount: 1,
      inputs: [{ txid: 'd'.repeat(64), vout: 1, valueSats: '100000000', confirmed: true }],
      inputTotalSats: '100000000',
      changeSats: '0',
      dustSats: '100',
      estimatedVbytes: 109,
      rbfEnabled: true,
    });

    const feeRequestsBeforeManualPreview = bitcoinRequests.filter((entry) => entry.kind === 'fee').length;
    const manualPreview = await handleMessage({ type: 'PREVIEW_SEND_TX', to: snapshot.activeAddress, value: '0.1', feeRateSatVb: 10 });
    assert.deepEqual(manualPreview, {
      amountSats: '10000000',
      feeSats: '1400',
      feeRateSatVb: 10,
      inputCount: 1,
      inputs: [{ txid: 'd'.repeat(64), vout: 1, valueSats: '100000000', confirmed: true }],
      inputTotalSats: '100000000',
      changeSats: '89998600',
      dustSats: '0',
      estimatedVbytes: 140,
      rbfEnabled: true,
    });
    assert.equal(bitcoinRequests.filter((entry) => entry.kind === 'fee').length, feeRequestsBeforeManualPreview);

    const feeRequestsBeforeManualSend = bitcoinRequests.filter((entry) => entry.kind === 'fee').length;
    const sent = await handleMessage({ type: 'SEND_TX', to: snapshot.activeAddress, value: '0.1', feeRateSatVb: 10 });
    assert.deepEqual(sent, { txHash: 'c'.repeat(64) });
    assert.equal(bitcoinRequests.some((entry) => entry.kind === 'utxo'), true);
    assert.equal(bitcoinRequests.some((entry) => entry.kind === 'fee'), true);
    assert.equal(bitcoinRequests.some((entry) => entry.kind === 'broadcast'), true);
    assert.equal(bitcoinRequests.filter((entry) => entry.kind === 'fee').length, feeRequestsBeforeManualSend);

    const history = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    assert.equal(history.total, 2);
    assert.equal(history.txs[0].chainKind, 'bitcoin');
    assert.equal(history.txs[0].value, '10000000');
    assert.equal(history.txs[0].shellType, 'bitcoinTransfer');
    assert.equal(history.txs[0].rbfEnabled, true);
    assert.equal(history.txs[0].bitcoinFeeRateSatVb, 10);
    assert.equal(history.txs[0].bitcoinFeeSats, '1400');
    assert.equal(history.txs[0].bitcoinChangeSats, '89998600');
    assert.deepEqual(history.txs[0].bitcoinInputs, [{ txid: 'd'.repeat(64), vout: 1, valueSats: '100000000', confirmed: true }]);
    assert.equal(history.txs[1].txHash, 'e'.repeat(64));
    assert.equal(history.txs[1].chainKind, 'bitcoin');
    assert.equal(history.txs[1].value, '20000000');
    assert.equal(history.txs[1].status, 'confirmed');
    assert.equal(history.txs[1].source, 'remote');
    assert.equal(history.txs[1].blockNumber, '839999');
    assert.equal(history.txs[1].rbfEnabled, true);
    assert.equal(bitcoinRequests.some((entry) => entry.kind === 'history'), true);

    await assert.rejects(
      () => handleMessage({ type: 'BUMP_BITCOIN_FEE', txHash: sent.txHash, feeRateSatVb: 10 }),
      /replacement fee rate must be higher/i,
    );
    const bumped = await handleMessage({ type: 'BUMP_BITCOIN_FEE', txHash: sent.txHash, feeRateSatVb: 20 });
    assert.deepEqual(bumped, { txHash: 'f'.repeat(64) });
    const bumpedHistory = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    const replacement = bumpedHistory.txs.find((tx) => tx.txHash === bumped.txHash);
    const replaced = bumpedHistory.txs.find((tx) => tx.txHash === sent.txHash);
    assert.equal(replacement.status, 'pending');
    assert.equal(replacement.replacesTxHash, sent.txHash);
    assert.equal(replacement.bitcoinFeeRateSatVb, 20);
    assert.equal(replacement.bitcoinFeeSats, '2800');
    assert.equal(replacement.bitcoinChangeSats, '89997200');
    assert.equal(replaced.status, 'failed');
    assert.equal(replaced.replacedByTxHash, bumped.txHash);

    await listeners.onAlarm[0]({ name: 'shella-tx-poll' });
    const confirmed = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    assert.equal(confirmed.txs[0].status, 'confirmed');
    assert.equal(confirmed.txs[0].blockNumber, '840000');
  });

  test('Cosmos network uses derived address, REST balance adapter, and transfer signing', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Cosmos Hub',
        chainId: 118,
        rpcUrl: 'https://rest.cosmos.directory/cosmoshub',
        kind: 'cosmos',
        symbol: 'ATOM',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    assert.equal(snapshot.activeChainKind, 'cosmos');
    assert.match(snapshot.activeAddress, /^cosmos1[ac-hj-np-z02-9]{38}$/);
    assert.deepEqual(snapshot.balance, { raw: '1234567', formatted: '1.234567' });
    assert.deepEqual(snapshot.cosmosBalances, [
      { denom: 'uatom', amount: '1234567', formatted: '1.234567', symbol: 'ATOM', decimals: 6, isNative: true },
      { denom: 'ibc/' + 'A'.repeat(64), amount: '42', formatted: '42', symbol: 'ibc/' + 'A'.repeat(64), decimals: 0, isNative: false },
    ]);
    assert.equal(snapshot.cosmosIbcContext.routes[0].id, 'cosmoshub-osmosis-pfm');
    assert.equal(snapshot.cosmosIbcContext.routes[0].channel, 'channel-141');
    assert.equal(snapshot.cosmosIbcContext.routes[0].receiverPrefix, 'osmo');
    assert.equal(snapshot.cosmosIbcContext.routes[0].memoTemplate, '{"forward":{"receiver":"osmo1...","port":"transfer","channel":"channel-141"}}');
    assert.deepEqual(snapshot.cosmosIbcContext.denomTraces, [{
      denom: 'ibc/' + 'A'.repeat(64),
      hash: 'A'.repeat(64),
      path: 'transfer/channel-141',
      baseDenom: 'uosmo',
      riskFlags: [],
    }]);
    assert.deepEqual(snapshot.cosmosStaking, [{
      validatorAddress: 'cosmosvaloper1validator000000000000000000000000000',
      validatorMoniker: 'Cosmos Validator',
      amount: '3000000',
      formatted: '3',
      denom: 'uatom',
      symbol: 'ATOM',
      decimals: 6,
    }]);
    assert.deepEqual(snapshot.cosmosRedelegations, [{
      sourceValidatorAddress: 'cosmosvaloper1source00000000000000000000000000000',
      destinationValidatorAddress: 'cosmosvaloper1dest0000000000000000000000000000000',
      creationHeight: '1234',
      completionTime: '2026-07-01T00:00:00Z',
      balance: '1500000',
      formatted: '1.5',
      denom: 'uatom',
      symbol: 'ATOM',
      decimals: 6,
    }]);
    assert.equal(snapshot.cosmosValidators.length, 2);
    assert.equal(snapshot.cosmosValidators[0].moniker, 'Cosmos Active');
    assert.equal(snapshot.cosmosValidators[0].commissionPercent, '5%');
    assert.equal(snapshot.cosmosValidators[0].maxCommissionPercent, '10%');
    assert.equal(snapshot.cosmosValidators[0].maxCommissionChangePercent, '1%');
    assert.equal(snapshot.cosmosValidators[0].minSelfDelegation, '1000000');
    assert.equal(snapshot.cosmosValidators[0].delegatorShares, '1000000000.000000000000000000');
    assert.equal(snapshot.cosmosValidators[0].consensusAddress, COSMOS_ACTIVE_CONSENSUS_ADDRESS);
    assert.equal(snapshot.cosmosValidators[0].missedBlocksCounter, '0');
    assert.equal(snapshot.cosmosValidators[0].tombstoned, false);
    assert.deepEqual(snapshot.cosmosValidators[0].riskFlags, []);
    assert.equal(snapshot.cosmosValidators[1].consensusAddress, COSMOS_RISKY_CONSENSUS_ADDRESS);
    assert.equal(snapshot.cosmosValidators[1].missedBlocksCounter, '42');
    assert.equal(snapshot.cosmosValidators[1].jailedUntil, '2026-07-02T00:00:00Z');
    assert.equal(snapshot.cosmosValidators[1].tombstoned, true);
    assert.deepEqual(snapshot.cosmosValidators[1].riskFlags, ['jailed', 'tombstoned', 'not bonded', 'missed blocks', 'high commission', 'high max commission', 'high daily commission change', 'low self delegation']);
    assert.deepEqual(snapshot.cosmosGovernanceProposals, [{
      id: '12',
      title: 'Increase community pool spend limit',
      summary: 'Raises the spend limit after community review.',
      status: 'PROPOSAL_STATUS_VOTING_PERIOD',
      submitTime: '2026-06-01T00:00:00Z',
      depositEndTime: '2026-06-15T00:00:00Z',
      votingStartTime: '2026-06-19T00:00:00Z',
      votingEndTime: '2026-07-03T00:00:00Z',
      totalDeposit: '1000000uatom',
      quorum: '0.334000000000000000',
      threshold: '0.500000000000000000',
      vetoThreshold: '0.334000000000000000',
      riskFlags: [
        'Quorum requires 33.4% bonded participation',
        'Yes ratio is below 50% threshold',
        'No-with-veto is near 33.4% veto threshold',
        'Voting closes 2026-07-03T00:00:00Z',
      ],
      riskSummary: 'Quorum requires 33.4% bonded participation; Yes ratio is below 50% threshold; No-with-veto is near 33.4% veto threshold; Voting closes 2026-07-03T00:00:00Z',
      yesVotes: '300',
      noVotes: '600',
      abstainVotes: '50',
      noWithVetoVotes: '400',
      voterVoteOption: 'VOTE_OPTION_YES',
      voterVoteWeight: '1.000000000000000000',
      voterVoteMetadata: 'wallet vote note',
    }, {
      id: '11',
      title: 'Legacy text proposal',
      summary: 'Legacy proposal body',
      status: 'PROPOSAL_STATUS_PASSED',
      submitTime: '',
      depositEndTime: '',
      votingStartTime: '',
      votingEndTime: '2026-06-01T00:00:00Z',
      totalDeposit: 'none',
      quorum: '0.334000000000000000',
      threshold: '0.500000000000000000',
      vetoThreshold: '0.334000000000000000',
      riskFlags: [],
      riskSummary: 'No immediate governance risk flags',
      yesVotes: '1000',
      noVotes: '0',
      abstainVotes: '25',
      noWithVetoVotes: '0',
      voterVoteOption: 'not voted',
      voterVoteWeight: '',
      voterVoteMetadata: '',
    }]);
    assert.equal(snapshot.nonce, null);
    assert.equal(
      cosmosRequests.some((entry) => entry.url === `https://rest.cosmos.directory/cosmoshub/cosmos/bank/v1beta1/balances/${snapshot.activeAddress}`),
      true,
    );
    const denomBalances = await handleMessage({ type: 'GET_COSMOS_BALANCES', address: snapshot.activeAddress });
    assert.equal(denomBalances.balances.length, 2);
    assert.equal(denomBalances.balances[0].symbol, 'ATOM');
    const ibcContext = await handleMessage({ type: 'GET_COSMOS_IBC_CONTEXT', address: snapshot.activeAddress });
    assert.equal(ibcContext.routes[0].destinationName, 'Osmosis');
    assert.equal(ibcContext.denomTraces[0].baseDenom, 'uosmo');
    assert.equal(cosmosRequests.some((entry) => entry.kind === 'denomTrace'), true);
    const staking = await handleMessage({ type: 'GET_COSMOS_STAKING', address: snapshot.activeAddress });
    assert.equal(staking.positions.length, 1);
    assert.equal(staking.positions[0].validatorMoniker, 'Cosmos Validator');
    const redelegations = await handleMessage({ type: 'GET_COSMOS_REDELEGATIONS', address: snapshot.activeAddress });
    assert.equal(redelegations.redelegations.length, 1);
    assert.equal(redelegations.redelegations[0].completionTime, '2026-07-01T00:00:00Z');
    const validators = await handleMessage({ type: 'GET_COSMOS_VALIDATORS' });
    assert.equal(validators.validators[0].moniker, 'Cosmos Active');
    const proposals = await handleMessage({ type: 'GET_COSMOS_GOVERNANCE_PROPOSALS', address: snapshot.activeAddress });
    assert.equal(proposals.proposals[0].status, 'PROPOSAL_STATUS_VOTING_PERIOD');
    assert.equal(proposals.proposals[0].yesVotes, '300');
    assert.equal(proposals.proposals[0].voterVoteOption, 'VOTE_OPTION_YES');
    assert.equal(proposals.proposals[0].quorum, '0.334000000000000000');
    assert.equal(proposals.proposals[0].riskFlags.includes('No-with-veto is near 33.4% veto threshold'), true);

    const ibcMemo = JSON.stringify({
      forward: {
        receiver: snapshot.activeAddress,
        channel: 'channel-0',
        timeout: '600000000000',
      },
    });
    const sent = await handleMessage({ type: 'SEND_TX', to: snapshot.activeAddress, value: '1.25', cosmosMemo: ibcMemo });
    assert.deepEqual(sent, { txHash: 'C'.repeat(64) });
    assert.equal(cosmosRequests.some((entry) => entry.kind === 'account'), true);
    assert.equal(cosmosRequests.some((entry) => entry.kind === 'simulate'), true);
    const broadcast = cosmosRequests.find((entry) => entry.kind === 'broadcast');
    assert.equal(broadcast.url, 'https://rest.cosmos.directory/cosmoshub/cosmos/tx/v1beta1/txs');
    assert.equal(broadcast.body.mode, 'BROADCAST_MODE_SYNC');
    assert.ok(cosmosRequests.findIndex((entry) => entry.kind === 'simulate') < cosmosRequests.findIndex((entry) => entry.kind === 'broadcast'));

    const history = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    assert.equal(history.total, 1);
    assert.equal(history.txs[0].chainKind, 'cosmos');
    assert.equal(history.txs[0].value, '1250000');
    assert.equal(history.txs[0].shellType, 'cosmosTransfer');
    assert.equal(history.txs[0].nonce, 3);
    assert.equal(history.txs[0].cosmosGasLimit, '96000');
    assert.equal(history.txs[0].cosmosFeeUatom, '2400');
    assert.equal(history.txs[0].cosmosAccountNumber, '7');
    assert.equal(history.txs[0].cosmosMemo, ibcMemo);

    await listeners.onAlarm[0]({ name: 'shella-tx-poll' });
    const confirmed = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    assert.equal(confirmed.txs[0].status, 'confirmed');
    assert.equal(confirmed.txs[0].blockNumber, '12345');

    const validatorAddress = convertTestBech32Prefix(snapshot.activeAddress, 'cosmosvaloper');
    const destinationValidatorAddress = convertTestBech32PrefixWithTweak(snapshot.activeAddress, 'cosmosvaloper', 1);
    const delegated = await handleMessage({ type: 'DELEGATE_COSMOS_STAKE', validatorAddress, amount: '0.5' });
    assert.deepEqual(delegated, { txHash: 'D'.repeat(64) });
    const undelegated = await handleMessage({ type: 'UNDELEGATE_COSMOS_STAKE', validatorAddress, amount: '0.25' });
    assert.deepEqual(undelegated, { txHash: 'E'.repeat(64) });
    const rewards = await handleMessage({ type: 'WITHDRAW_COSMOS_REWARDS', validatorAddress });
    assert.deepEqual(rewards, { txHash: 'F'.repeat(64) });
    const broadcastsBeforeBlockedRedelegation = cosmosRequests.filter((entry) => entry.kind === 'broadcast').length;
    await assert.rejects(
      handleMessage({
        type: 'REDELEGATE_COSMOS_STAKE',
        sourceValidatorAddress: 'cosmosvaloper1dest0000000000000000000000000000000',
        destinationValidatorAddress: validatorAddress,
        amount: '0.125',
      }),
      /redelegation is cooling down/i,
    );
    assert.equal(cosmosRequests.filter((entry) => entry.kind === 'broadcast').length, broadcastsBeforeBlockedRedelegation);
    const redelegated = await handleMessage({
      type: 'REDELEGATE_COSMOS_STAKE',
      sourceValidatorAddress: validatorAddress,
      destinationValidatorAddress,
      amount: '0.125',
    });
    assert.deepEqual(redelegated, { txHash: 'G'.repeat(64) });
    const voted = await handleMessage({ type: 'VOTE_COSMOS_GOVERNANCE', proposalId: '12', option: 'no_with_veto' });
    assert.deepEqual(voted, { txHash: 'H'.repeat(64) });
    await assert.rejects(
      handleMessage({ type: 'VOTE_COSMOS_GOVERNANCE', proposalId: '12', option: 'maybe' }),
      /vote option/i,
    );
    const stakingHistory = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    assert.equal(stakingHistory.txs[0].shellType, 'cosmosVote');
    assert.equal(stakingHistory.txs[0].to, '12');
    assert.equal(stakingHistory.txs[0].value, '12');
    assert.equal(stakingHistory.txs[0].data, 'no_with_veto');
    assert.equal(stakingHistory.txs[0].cosmosGasLimit, '96000');
    assert.equal(stakingHistory.txs[0].cosmosFeeUatom, '2400');
    assert.equal(stakingHistory.txs[1].shellType, 'cosmosRedelegate');
    assert.equal(stakingHistory.txs[1].to, destinationValidatorAddress);
    assert.equal(stakingHistory.txs[1].value, '125000');
    assert.equal(stakingHistory.txs[2].shellType, 'cosmosWithdrawRewards');
    assert.equal(stakingHistory.txs[2].to, validatorAddress);
    assert.equal(stakingHistory.txs[2].value, '0');
    assert.equal(stakingHistory.txs[3].shellType, 'cosmosUndelegate');
    assert.equal(stakingHistory.txs[3].value, '250000');
    assert.equal(stakingHistory.txs[4].shellType, 'cosmosDelegate');
    assert.equal(stakingHistory.txs[4].value, '500000');
  });

  test('Cosmos failed status preserves readable raw_log in history', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Cosmos Hub',
        chainId: 118,
        rpcUrl: 'https://rest.cosmos.directory/cosmoshub',
        kind: 'cosmos',
        symbol: 'ATOM',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    await upsertTxRecord({
      txHash: 'F'.repeat(64),
      chainKind: 'cosmos',
      from: snapshot.activeAddress,
      to: snapshot.activeAddress,
      value: '1500000',
      data: '0x',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'pending',
      source: 'local',
      shellType: 'cosmosTransfer',
      tokenSymbol: 'ATOM',
      tokenDecimals: 6,
    });

    await listeners.onAlarm[0]({ name: 'shella-tx-poll' });
    const history = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    assert.equal(history.txs[0].status, 'failed');
    assert.equal(history.txs[0].blockNumber, '12346');
    assert.equal(
      history.txs[0].error,
      'Cosmos transaction failed: 1500000uatom is smaller than 2500000uatom: insufficient funds',
    );
  });

  test('Cosmos IBC route memo precheck rejects invalid forward channel before RPC signing', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Cosmos Hub',
        chainId: 118,
        rpcUrl: 'https://rest.cosmos.directory/cosmoshub',
        kind: 'cosmos',
        symbol: 'ATOM',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    const accountRequestsBefore = cosmosRequests.filter((entry) => entry.kind === 'account').length;
    await assert.rejects(
      () => handleMessage({
        type: 'SEND_TX',
        to: snapshot.activeAddress,
        value: '1.25',
        cosmosMemo: JSON.stringify({ forward: { receiver: snapshot.activeAddress, channel: 'bad-channel' } }),
      }),
      /IBC forward channel must match channel-<number>/,
    );
    assert.equal(cosmosRequests.filter((entry) => entry.kind === 'account').length, accountRequestsBefore);
  });

  test('Osmosis network reuses Cosmos key material with osmo prefix and uosmo denom', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Osmosis Mainnet',
        chainId: 118007,
        rpcUrl: 'https://rest.cosmos.directory/osmosis',
        kind: 'cosmos',
        symbol: 'OSMO',
        addressPrefix: 'osmo',
        nativeDenom: 'uosmo',
        nativeDecimals: 6,
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    assert.equal(snapshot.activeChainKind, 'cosmos');
    assert.match(snapshot.wallet.accounts[0].chainAddresses.cosmos, /^cosmos1[ac-hj-np-z02-9]{38}$/);
    assert.match(snapshot.activeAddress, /^osmo1[ac-hj-np-z02-9]{38}$/);
    assert.deepEqual(snapshot.balance, { raw: '7654321', formatted: '7.654321' });
    assert.deepEqual(snapshot.cosmosBalances, [
      { denom: 'uosmo', amount: '7654321', formatted: '7.654321', symbol: 'OSMO', decimals: 6, isNative: true },
      { denom: 'uatom', amount: '1', formatted: '1', symbol: 'uatom', decimals: 0, isNative: false },
    ]);
    assert.deepEqual(snapshot.cosmosStaking, [{
      validatorAddress: 'cosmosvaloper1validator000000000000000000000000000',
      validatorMoniker: 'Osmosis Validator',
      amount: '2000000',
      formatted: '2',
      denom: 'uosmo',
      symbol: 'OSMO',
      decimals: 6,
    }]);
    assert.equal(snapshot.cosmosValidators[0].moniker, 'Osmosis Active');
    assert.equal(
      cosmosRequests.some((entry) => entry.url === `https://rest.cosmos.directory/osmosis/cosmos/bank/v1beta1/balances/${snapshot.activeAddress}`),
      true,
    );

    const sent = await handleMessage({ type: 'SEND_TX', to: snapshot.activeAddress, value: '2.5' });
    assert.match(sent.txHash, /^[A-Z]{64}$/);
    const history = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    assert.equal(history.txs[0].chainKind, 'cosmos');
    assert.equal(history.txs[0].value, '2500000');
    assert.equal(history.txs[0].tokenSymbol, 'OSMO');
    assert.equal(history.txs[0].tokenDecimals, 6);
    assert.equal(history.txs[0].cosmosGasLimit, '96000');
    assert.equal(history.txs[0].cosmosFeeUatom, '2400');
  });

  test('Bitcoin Testnet uses tb1 address, testnet key, and testnet Esplora endpoints', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Bitcoin Testnet',
        chainId: 18332,
        rpcUrl: 'https://blockstream.info/testnet/api',
        kind: 'bitcoin',
        symbol: 'BTC',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    assert.equal(snapshot.activeChainKind, 'bitcoin');
    assert.match(snapshot.wallet.accounts[0].chainAddresses.bitcoin, /^bc1[ac-hj-np-z02-9]{11,87}$/);
    assert.match(snapshot.wallet.accounts[0].chainAddresses.bitcoinTestnet, /^tb1[ac-hj-np-z02-9]{11,87}$/);
    assert.equal(snapshot.activeAddress, snapshot.wallet.accounts[0].chainAddresses.bitcoinTestnet);
    assert.match(snapshot.activeAddress, /^tb1[ac-hj-np-z02-9]{11,87}$/);
    assert.equal(bitcoinRequests.at(-1).url, `https://blockstream.info/testnet/api/address/${snapshot.activeAddress}`);

    const sent = await handleMessage({ type: 'SEND_TX', to: snapshot.activeAddress, value: '0.1' });
    assert.deepEqual(sent, { txHash: 'c'.repeat(64) });
    const broadcast = bitcoinRequests.findLast((entry) => entry.kind === 'broadcast');
    assert.equal(broadcast.url, 'https://blockstream.info/testnet/api/tx');
  });

  test('Bitcoin coin control previews and sends with selected UTXOs only', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Bitcoin Mainnet',
        chainId: 8332,
        rpcUrl: 'https://blockstream.info/api',
        kind: 'bitcoin',
        symbol: 'BTC',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    const selectedInputs = [{ txid: 'b'.repeat(64), vout: 0, valueSats: '20000000', confirmed: true }];

    const preview = await handleMessage({
      type: 'PREVIEW_SEND_TX',
      to: snapshot.activeAddress,
      value: '0.1',
      feeRateSatVb: 10,
      bitcoinInputs: selectedInputs,
    });
    assert.deepEqual(preview, {
      amountSats: '10000000',
      feeSats: '1400',
      feeRateSatVb: 10,
      inputCount: 1,
      inputs: selectedInputs,
      inputTotalSats: '20000000',
      changeSats: '9998600',
      dustSats: '0',
      estimatedVbytes: 140,
      rbfEnabled: true,
    });

    const sent = await handleMessage({
      type: 'SEND_TX',
      to: snapshot.activeAddress,
      value: '0.1',
      feeRateSatVb: 10,
      bitcoinInputs: selectedInputs,
    });
    assert.match(sent.txHash, /^[cf]{64}$/);
    const history = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    assert.deepEqual(history.txs[0].bitcoinInputs, selectedInputs);
    assert.equal(history.txs[0].bitcoinFeeSats, '1400');
    assert.equal(history.txs[0].bitcoinChangeSats, '9998600');
  });

  test('Bitcoin CPFP spends remote pending incoming output as a child transaction', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Bitcoin Mainnet',
        chainId: 8332,
        rpcUrl: 'https://mempool.space/api',
        kind: 'bitcoin',
        symbol: 'BTC',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    bitcoinHistoryMode = 'cpfp';

    const history = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    assert.equal(history.total, 2);
    const firstParent = history.txs.find((tx) => tx.txHash === '9'.repeat(64));
    const secondParent = history.txs.find((tx) => tx.txHash === 'a'.repeat(64));
    assert.ok(firstParent);
    assert.ok(secondParent);
    assert.equal(firstParent.status, 'pending');
    assert.equal(firstParent.source, 'remote');
    assert.deepEqual(firstParent.bitcoinCpfpInput, {
      txid: '9'.repeat(64),
      vout: 0,
      valueSats: '30000000',
      confirmed: false,
    });
    assert.equal(firstParent.bitcoinFeeSats, '200');
    assert.equal(firstParent.bitcoinVbytes, 200);
    assert.deepEqual(secondParent.bitcoinCpfpInput, {
      txid: 'a'.repeat(64),
      vout: 0,
      valueSats: '30000000',
      confirmed: false,
    });

    const bumped = await handleMessage({ type: 'BUMP_BITCOIN_CPFP', txHash: firstParent.txHash, feeRateSatVb: 10 });
    assert.match(bumped.txHash, /^[cf]{64}$/);
    const broadcast = bitcoinRequests.findLast((entry) => entry.kind === 'broadcast');
    assert.equal(broadcast.url, 'https://mempool.space/api/tx');
    assert.equal(bitcoinRequests.some((entry) => entry.kind === 'outspend'), true);
    assert.equal(bitcoinRequests.some((entry) => entry.kind === 'cpfp'), true);

    const cpfpHistory = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    const child = cpfpHistory.txs.find((tx) => tx.txHash === bumped.txHash);
    assert.equal(child.shellType, 'bitcoinCpfp');
    assert.equal(child.status, 'pending');
    assert.equal(child.cpfpParentTxHash, '9'.repeat(64));
    assert.deepEqual(child.cpfpParentTxHashes, ['9'.repeat(64), 'a'.repeat(64)]);
    assert.equal(child.value, '59995230');
    assert.equal(child.bitcoinFeeRateSatVb, 27);
    assert.equal(child.bitcoinFeeSats, '4770');
    assert.equal(child.bitcoinChangeSats, '0');
    assert.equal(child.bitcoinVbytes, 177);
    assert.equal(child.cpfpTargetFeeRateSatVb, 10);
    assert.equal(child.cpfpPackageFeeRateSatVb, 10);
    assert.equal(child.cpfpAncestorCount, 2);
    assert.equal(child.cpfpDescendantCount, 0);
    assert.deepEqual(child.bitcoinInputs, [
      {
        txid: '9'.repeat(64),
        vout: 0,
        valueSats: '30000000',
        confirmed: false,
      },
      {
        txid: 'a'.repeat(64),
        vout: 0,
        valueSats: '30000000',
        confirmed: false,
      },
    ]);
  });

  test('Bitcoin CPFP rejects already-spent parent outputs', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Bitcoin Mainnet',
        chainId: 8332,
        rpcUrl: 'https://mempool.space/api',
        kind: 'bitcoin',
        symbol: 'BTC',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    bitcoinHistoryMode = 'cpfp';
    bitcoinCpfpPolicyMode = 'spent';
    const history = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    const broadcastsBefore = bitcoinRequests.filter((entry) => entry.kind === 'broadcast').length;

    await assert.rejects(
      () => handleMessage({ type: 'BUMP_BITCOIN_CPFP', txHash: history.txs[0].txHash, feeRateSatVb: 10 }),
      /parent output is already spent/i,
    );
    assert.equal(bitcoinRequests.filter((entry) => entry.kind === 'broadcast').length, broadcastsBefore);
  });

  test('Bitcoin CPFP rejects mempool descendant chain limit breaches', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Bitcoin Mainnet',
        chainId: 8332,
        rpcUrl: 'https://mempool.space/api',
        kind: 'bitcoin',
        symbol: 'BTC',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    bitcoinHistoryMode = 'cpfp';
    bitcoinCpfpPolicyMode = 'descendant-limit';
    const history = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    const broadcastsBefore = bitcoinRequests.filter((entry) => entry.kind === 'broadcast').length;

    await assert.rejects(
      () => handleMessage({ type: 'BUMP_BITCOIN_CPFP', txHash: history.txs[0].txHash, feeRateSatVb: 10 }),
      /descendant limits/i,
    );
    assert.equal(bitcoinRequests.filter((entry) => entry.kind === 'broadcast').length, broadcastsBefore);
  });

  test('Bitcoin CPFP rejects mempool ancestor chain limit breaches', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Bitcoin Mainnet',
        chainId: 8332,
        rpcUrl: 'https://mempool.space/api',
        kind: 'bitcoin',
        symbol: 'BTC',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    bitcoinHistoryMode = 'cpfp';
    bitcoinCpfpPolicyMode = 'ancestor-limit';
    const history = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    const broadcastsBefore = bitcoinRequests.filter((entry) => entry.kind === 'broadcast').length;

    await assert.rejects(
      () => handleMessage({ type: 'BUMP_BITCOIN_CPFP', txHash: history.txs[0].txHash, feeRateSatVb: 10 }),
      /ancestor limits/i,
    );
    assert.equal(bitcoinRequests.filter((entry) => entry.kind === 'broadcast').length, broadcastsBefore);
  });

  test('Solana dApp provider connects and submits transfers', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Solana Devnet',
        chainId: 103,
        rpcUrl: 'https://api.devnet.solana.com',
        kind: 'solana',
        symbol: 'SOL',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    const origin = 'https://solana-dapp.example.com';

    const approvalsBeforeConnect = createdWindows.length;
    const connectPromise = handleMessage({
      type: 'DAPP_REQUEST',
      origin,
      method: 'solana_connect',
      params: [],
    });
    await resolveLatestApproval(true, approvalsBeforeConnect);
    const connected = await connectPromise;
    assert.deepEqual(connected, { publicKey: snapshot.activeAddress });

    const accounts = await handleMessage({
      type: 'DAPP_REQUEST',
      origin,
      method: 'solana_accounts',
      params: [],
    });
    assert.deepEqual(accounts, [snapshot.activeAddress]);

    const chainId = await handleMessage({
      type: 'DAPP_REQUEST',
      origin,
      method: 'solana_chainId',
      params: [],
    });
    assert.equal(chainId, '103');

    const balance = await handleMessage({
      type: 'DAPP_REQUEST',
      origin,
      method: 'solana_getBalance',
      params: [snapshot.activeAddress],
    });
    assert.equal(balance, '1234567890');

    const approvalsBeforeSend = createdWindows.length;
    const sendPromise = handleMessage({
      type: 'DAPP_REQUEST',
      origin,
      method: 'solana_signAndSendTransaction',
      params: [{ to: snapshot.activeAddress, lamports: 250000000 }],
    });
    await resolveLatestApproval(true, approvalsBeforeSend);
    const sent = await sendPromise;
    assert.deepEqual(sent, { signature: 'solsig111111111111111111111111111111111111111111111111111111111111' });

    const approvalsBeforeSpl = createdWindows.length;
    const splPromise = handleMessage({
      type: 'DAPP_REQUEST',
      origin,
      method: 'solana_sendSplTransfer',
      params: [{
        contractAddress: snapshot.activeAddress,
        to: snapshot.activeAddress,
        amount: '1.2',
        decimals: 6,
        symbol: 'SPL',
      }],
    });
    await resolveLatestApproval(true, approvalsBeforeSpl);
    const splSent = await splPromise;
    assert.deepEqual(splSent, { txHash: 'solsig111111111111111111111111111111111111111111111111111111111111' });

    const history = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    assert.equal(history.txs[0].chainKind, 'solana');
    assert.equal(history.txs[0].value, '1200000');
    assert.equal(history.txs[0].shellType, 'splTransfer');

    solanaFailureMode = 'missing-recipient-token-account';
    await assert.rejects(
      handleMessage({
        type: 'DAPP_REQUEST',
        origin,
        method: 'solana_sendSplTransfer',
        params: [{
          contractAddress: snapshot.activeAddress,
          to: '11111111111111111111111111111111',
          amount: '1.2',
          decimals: 6,
          symbol: 'SPL',
        }],
      }),
      /Recipient SPL token account not found. Create the recipient ATA first; automatic creation requires rent and an extra instruction./,
    );
    const approvalsBeforeCreateAta = createdWindows.length;
    const createAtaPromise = handleMessage({
      type: 'DAPP_REQUEST',
      origin,
      method: 'solana_sendSplTransfer',
      params: [{
        contractAddress: snapshot.activeAddress,
        to: '11111111111111111111111111111111',
        amount: '1.2',
        decimals: 6,
        symbol: 'SPL',
        createRecipientAta: true,
      }],
    });
    const createAtaApproval = await resolveLatestApproval(true, approvalsBeforeCreateAta);
    assert.equal(createAtaApproval.payload.createRecipientAta, true);
    assert.equal(createAtaApproval.payload.splRecipientStatus.createRecipientAtaRequired, true);
    assert.equal(createAtaApproval.payload.splRecipientStatus.rentLamports, '2039280');
    const createAtaSent = await createAtaPromise;
    assert.deepEqual(createAtaSent, { txHash: 'solsig111111111111111111111111111111111111111111111111111111111111' });
    solanaFailureMode = 'ok';
  });

  test('WalletConnect Solana namespace can approve and execute native and SPL requests', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Solana Devnet',
        chainId: 103,
        rpcUrl: 'https://api.devnet.solana.com',
        kind: 'solana',
        symbol: 'SOL',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    const methods = ['solana_chainId', 'solana_signAndSendTransaction', 'solana_sendSplTransfer'];
    const requiredNamespaces = {
      solana: {
        chains: ['solana:103'],
        methods,
        events: ['accountsChanged'],
      },
    };

    const preview = await handleMessage({
      type: 'PREVIEW_WALLETCONNECT_PROPOSAL',
      origin: 'https://solana-wc.example',
      requiredNamespaces,
      expirySeconds: 60,
    });
    assert.deepEqual(preview.chainIds, [103]);
    assert.deepEqual(preview.methods, methods);
    assert.deepEqual(preview.namespaces.solana.methods, methods);
    assert.deepEqual(preview.namespaces.solana.events, ['accountsChanged']);
    assert.deepEqual(preview.namespaces.solana.accounts, [`solana:103:${snapshot.activeAddress}`]);

    const proposal = await handleMessage({
      type: 'CREATE_WALLETCONNECT_SESSION_FROM_PROPOSAL',
      topic: 'wc-solana-topic',
      origin: 'https://solana-wc.example',
      requiredNamespaces,
      expirySeconds: 60,
    });
    assert.equal(proposal.session.topic, 'wc-solana-topic');
    assert.deepEqual(proposal.session.chainIds, [103]);
    assert.deepEqual(proposal.session.methods, methods);
    assert.deepEqual(proposal.namespaces.solana.accounts, [`solana:103:${snapshot.activeAddress}`]);

    const chainId = await handleMessage({
      type: 'EXECUTE_WALLETCONNECT_SESSION_REQUEST',
      topic: 'wc-solana-topic',
      chainId: 'solana:103',
      request: { method: 'solana_chainId', params: [] },
    });
    assert.equal(chainId, '103');

    const approvalsBeforeSend = createdWindows.length;
    const solPromise = handleMessage({
      type: 'EXECUTE_WALLETCONNECT_SESSION_REQUEST',
      topic: 'wc-solana-topic',
      chainId: 'solana:103',
      request: {
        method: 'solana_signAndSendTransaction',
        params: [{ to: snapshot.activeAddress, lamports: 250000000 }],
      },
    });
    await resolveLatestApproval(true, approvalsBeforeSend);
    const solSent = await solPromise;
    assert.deepEqual(solSent, { signature: 'solsig111111111111111111111111111111111111111111111111111111111111' });

    const approvalsBeforeSpl = createdWindows.length;
    const splPromise = handleMessage({
      type: 'EXECUTE_WALLETCONNECT_SESSION_REQUEST',
      topic: 'wc-solana-topic',
      chainId: 'solana:103',
      request: {
        method: 'solana_sendSplTransfer',
        params: [{
          contractAddress: snapshot.activeAddress,
          to: snapshot.activeAddress,
          amount: '1.2',
          decimals: 6,
          symbol: 'SPL',
        }],
      },
    });
    await resolveLatestApproval(true, approvalsBeforeSpl);
    const splSent = await splPromise;
    assert.deepEqual(splSent, { txHash: 'solsig111111111111111111111111111111111111111111111111111111111111' });

    const history = await handleMessage({ type: 'GET_TX_HISTORY', address: snapshot.activeAddress, page: 0 });
    assert.equal(history.txs[0].chainKind, 'solana');
    assert.equal(history.txs[0].shellType, 'splTransfer');
    assert.equal(history.txs[0].value, '1200000');

    solanaFailureMode = 'missing-recipient-token-account';
    const approvalsBeforeWcCreateAta = createdWindows.length;
    const wcCreateAtaPromise = handleMessage({
      type: 'EXECUTE_WALLETCONNECT_SESSION_REQUEST',
      topic: 'wc-solana-topic',
      chainId: 'solana:103',
      request: {
        method: 'solana_sendSplTransfer',
        params: [{
          contractAddress: snapshot.activeAddress,
          to: '11111111111111111111111111111111',
          amount: '1.2',
          decimals: 6,
          symbol: 'SPL',
          createRecipientAta: true,
        }],
      },
    });
    const wcCreateAtaApproval = await resolveLatestApproval(true, approvalsBeforeWcCreateAta);
    assert.equal(wcCreateAtaApproval.payload.createRecipientAta, true);
    assert.equal(wcCreateAtaApproval.payload.splRecipientStatus.createRecipientAtaRequired, true);
    assert.equal(wcCreateAtaApproval.payload.splRecipientStatus.extraInstruction, 'Create Associated Token Account before SPL TransferChecked');
    const wcCreateAtaSent = await wcCreateAtaPromise;
    assert.deepEqual(wcCreateAtaSent, { txHash: 'solsig111111111111111111111111111111111111111111111111111111111111' });
    solanaFailureMode = 'ok';

    await assert.rejects(
      handleMessage({
        type: 'PREVIEW_WALLETCONNECT_PROPOSAL',
        origin: 'https://bad-solana-wc.example',
        requiredNamespaces: {
          eip155: {
            chains: ['solana:103'],
            methods: ['solana_chainId'],
            events: [],
          },
        },
        expirySeconds: 60,
      }),
      /does not match namespace/,
    );
    await assert.rejects(
      handleMessage({
        type: 'EXECUTE_WALLETCONNECT_SESSION_REQUEST',
        topic: 'wc-solana-topic',
        chainId: 'solana:103',
        request: { method: 'eth_call', params: [] },
      }),
      /WalletConnect method is not permitted/,
    );
  });

  test('WalletConnect Cosmos namespace can approve read-only and signing requests', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'Cosmos Hub',
        chainId: 118,
        rpcUrl: 'https://rest.cosmos.directory/cosmoshub',
        kind: 'cosmos',
        symbol: 'ATOM',
      },
    });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    const methods = ['cosmos_chainId', 'cosmos_accounts', 'cosmos_getBalance', 'cosmos_signDirect', 'cosmos_signAmino'];
    const requiredNamespaces = {
      cosmos: {
        chains: ['cosmos:118'],
        methods,
        events: ['accountsChanged'],
      },
    };

    const preview = await handleMessage({
      type: 'PREVIEW_WALLETCONNECT_PROPOSAL',
      origin: 'https://cosmos-wc.example',
      requiredNamespaces,
      expirySeconds: 60,
    });
    assert.deepEqual(preview.chainIds, [118]);
    assert.deepEqual(preview.methods, methods);
    assert.deepEqual(preview.namespaces.cosmos.methods, methods);
    assert.deepEqual(preview.namespaces.cosmos.accounts, [`cosmos:118:${snapshot.activeAddress}`]);

    const proposal = await handleMessage({
      type: 'CREATE_WALLETCONNECT_SESSION_FROM_PROPOSAL',
      topic: 'wc-cosmos-topic',
      origin: 'https://cosmos-wc.example',
      requiredNamespaces,
      expirySeconds: 60,
    });
    assert.equal(proposal.session.topic, 'wc-cosmos-topic');
    assert.deepEqual(proposal.session.chainIds, [118]);
    assert.deepEqual(proposal.session.methods, methods);

    const chainId = await handleMessage({
      type: 'EXECUTE_WALLETCONNECT_SESSION_REQUEST',
      topic: 'wc-cosmos-topic',
      chainId: 'cosmos:118',
      request: { method: 'cosmos_chainId', params: [] },
    });
    assert.equal(chainId, '118');

    const accounts = await handleMessage({
      type: 'EXECUTE_WALLETCONNECT_SESSION_REQUEST',
      topic: 'wc-cosmos-topic',
      chainId: 'cosmos:118',
      request: { method: 'cosmos_accounts', params: [] },
    });
    assert.deepEqual(accounts, [snapshot.activeAddress]);

    const balance = await handleMessage({
      type: 'EXECUTE_WALLETCONNECT_SESSION_REQUEST',
      topic: 'wc-cosmos-topic',
      chainId: 'cosmos:118',
      request: { method: 'cosmos_getBalance', params: [] },
    });
    assert.equal(balance, '1234567');

    const bodyBytes = Buffer.from(testEncodeCosmosTransferTxBody({
      from: snapshot.activeAddress,
      to: snapshot.activeAddress,
      amount: '1',
      denom: 'uatom',
      memo: '',
    })).toString('base64');
    const authInfoBytes = Buffer.from([0x12, 0x01, 0x01]).toString('base64');
    const approvalsBeforeSign = createdWindows.length;
    const signPromise = handleMessage({
      type: 'EXECUTE_WALLETCONNECT_SESSION_REQUEST',
      topic: 'wc-cosmos-topic',
      chainId: 'cosmos:118',
      request: {
        method: 'cosmos_signDirect',
        params: [{
          signerAddress: snapshot.activeAddress,
          signDoc: {
            bodyBytes,
            authInfoBytes,
            chainId: 'cosmoshub-4',
            accountNumber: '7',
          },
        }],
      },
    });
    const signApproval = await resolveLatestApproval(true, approvalsBeforeSign);
    assert.equal(signApproval.kind, 'cosmos-sign-direct');
    assert.equal(signApproval.payload.signMode, 'SIGN_MODE_DIRECT');
    assert.equal(signApproval.payload.messages, '/cosmos.bank.v1beta1.MsgSend');
    assert.deepEqual(signApproval.payload.messageDetails, [
      `#1: /cosmos.bank.v1beta1.MsgSend (from: ${snapshot.activeAddress}; to: ${snapshot.activeAddress}; amount: 1uatom)`,
    ]);
    assert.equal(signApproval.payload.authInfoBytes, '3 bytes');
    const signed = await signPromise;
    assert.deepEqual(signed.signed, {
      bodyBytes,
      authInfoBytes,
      chainId: 'cosmoshub-4',
      accountNumber: '7',
    });
    assert.equal(signed.signature.pub_key.type, 'tendermint/PubKeySecp256k1');
    assert.equal(typeof signed.signature.pub_key.value, 'string');
    assert.equal(typeof signed.signature.signature, 'string');

    const ibcBodyBytes = Buffer.from(testEncodeCosmosIbcTransferTxBody({
      sourcePort: 'transfer',
      sourceChannel: 'channel-141',
      denom: 'uatom',
      amount: '2',
      sender: snapshot.activeAddress,
      receiver: 'osmo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqdx2zz4',
      memo: '{"forward":{"receiver":"cosmos1receiver","port":"transfer","channel":"channel-0"}}',
    })).toString('base64');
    const approvalsBeforeIbc = createdWindows.length;
    const ibcSignPromise = handleMessage({
      type: 'EXECUTE_WALLETCONNECT_SESSION_REQUEST',
      topic: 'wc-cosmos-topic',
      chainId: 'cosmos:118',
      request: {
        method: 'cosmos_signDirect',
        params: [{
          signerAddress: snapshot.activeAddress,
          signDoc: {
            bodyBytes: ibcBodyBytes,
            authInfoBytes,
            chainId: 'cosmoshub-4',
            accountNumber: '7',
          },
        }],
      },
    });
    const ibcApproval = await resolveLatestApproval(true, approvalsBeforeIbc);
    assert.equal(ibcApproval.payload.messages, '/ibc.applications.transfer.v1.MsgTransfer');
    assert.deepEqual(ibcApproval.payload.messageDetails, [
      `#1: /ibc.applications.transfer.v1.MsgTransfer (from: ${snapshot.activeAddress}; to: osmo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqdx2zz4; port: transfer; channel: channel-141; amount: 2uatom; memo: {"forward":{"receiver":"cosmos1receiver","port":"transfer","channel":"channel-0"}})`,
    ]);
    const ibcSigned = await ibcSignPromise;
    assert.equal(ibcSigned.signed.bodyBytes, ibcBodyBytes);

    const expandedBodyBytes = Buffer.from(testEncodeCosmosExpandedTxBody({
      from: snapshot.activeAddress,
      to: convertTestBech32PrefixWithTweak(snapshot.activeAddress, 'cosmos', 1),
      validator: 'cosmosvaloper1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a',
      denom: 'uatom',
    })).toString('base64');
    const approvalsBeforeExpanded = createdWindows.length;
    const expandedSignPromise = handleMessage({
      type: 'EXECUTE_WALLETCONNECT_SESSION_REQUEST',
      topic: 'wc-cosmos-topic',
      chainId: 'cosmos:118',
      request: {
        method: 'cosmos_signDirect',
        params: [{
          signerAddress: snapshot.activeAddress,
          signDoc: {
            bodyBytes: expandedBodyBytes,
            authInfoBytes,
            chainId: 'cosmoshub-4',
            accountNumber: '7',
          },
        }],
      },
    });
    const expandedApproval = await resolveLatestApproval(true, approvalsBeforeExpanded);
    assert.equal(expandedApproval.payload.messages, [
      '/cosmos.bank.v1beta1.MsgMultiSend',
      '/cosmos.gov.v1.MsgDeposit',
      '/cosmos.authz.v1beta1.MsgGrant',
      '/cosmos.authz.v1beta1.MsgRevoke',
      '/cosmos.feegrant.v1beta1.MsgGrantAllowance',
      '/cosmos.feegrant.v1beta1.MsgRevokeAllowance',
      '/cosmos.staking.v1beta1.MsgCancelUnbondingDelegation',
    ].join(', '));
    assert.deepEqual(expandedApproval.payload.messageDetails, [
      `#1: /cosmos.bank.v1beta1.MsgMultiSend (inputs: ${snapshot.activeAddress}: 3uatom; outputs: ${convertTestBech32PrefixWithTweak(snapshot.activeAddress, 'cosmos', 1)}: 3uatom)`,
      `#2: /cosmos.gov.v1.MsgDeposit (depositor: ${snapshot.activeAddress}; proposal: 42; amount: 4uatom)`,
      `#3: /cosmos.authz.v1beta1.MsgGrant (granter: ${snapshot.activeAddress}; grantee: ${convertTestBech32PrefixWithTweak(snapshot.activeAddress, 'cosmos', 1)}; grant type: /cosmos.authz.v1beta1.GenericAuthorization)`,
      `#4: /cosmos.authz.v1beta1.MsgRevoke (granter: ${snapshot.activeAddress}; grantee: ${convertTestBech32PrefixWithTweak(snapshot.activeAddress, 'cosmos', 1)}; msg type: /cosmos.bank.v1beta1.MsgSend)`,
      `#5: /cosmos.feegrant.v1beta1.MsgGrantAllowance (granter: ${snapshot.activeAddress}; grantee: ${convertTestBech32PrefixWithTweak(snapshot.activeAddress, 'cosmos', 1)}; allowance type: /cosmos.feegrant.v1beta1.BasicAllowance)`,
      `#6: /cosmos.feegrant.v1beta1.MsgRevokeAllowance (granter: ${snapshot.activeAddress}; grantee: ${convertTestBech32PrefixWithTweak(snapshot.activeAddress, 'cosmos', 1)})`,
      `#7: /cosmos.staking.v1beta1.MsgCancelUnbondingDelegation (delegator: ${snapshot.activeAddress}; validator: cosmosvaloper1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a; amount: 5uatom; creation height: 123)`,
    ]);
    const expandedSigned = await expandedSignPromise;
    assert.equal(expandedSigned.signed.bodyBytes, expandedBodyBytes);

    const customBodyBytes = Buffer.from(testEncodeCosmosCustomTxBody({
      signer: snapshot.activeAddress,
      target: 'custom-module',
    })).toString('base64');
    const approvalsBeforeCustom = createdWindows.length;
    const customSignPromise = handleMessage({
      type: 'EXECUTE_WALLETCONNECT_SESSION_REQUEST',
      topic: 'wc-cosmos-topic',
      chainId: 'cosmos:118',
      request: {
        method: 'cosmos_signDirect',
        params: [{
          signerAddress: snapshot.activeAddress,
          signDoc: {
            bodyBytes: customBodyBytes,
            authInfoBytes,
            chainId: 'cosmoshub-4',
            accountNumber: '7',
          },
        }],
      },
    });
    const customApproval = await resolveLatestApproval(true, approvalsBeforeCustom);
    assert.equal(customApproval.payload.messages, '/shell.custom.v1.MsgDoThing');
    assert.deepEqual(customApproval.payload.messageDetails, [
      `#1: /shell.custom.v1.MsgDoThing (fields: field1: ${snapshot.activeAddress}; field2: custom-module; field3: 42; field4: {field1: note; field2: 7})`,
    ]);
    const customSigned = await customSignPromise;
    assert.equal(customSigned.signed.bodyBytes, customBodyBytes);

    await assert.rejects(
      handleMessage({
        type: 'EXECUTE_WALLETCONNECT_SESSION_REQUEST',
        topic: 'wc-cosmos-topic',
        chainId: 'cosmos:118',
        request: {
          method: 'cosmos_signDirect',
          params: [{
            signerAddress: snapshot.activeAddress,
            signDoc: {
              bodyBytes,
              authInfoBytes,
              chainId: 'wrong-chain',
              accountNumber: '7',
            },
          }],
        },
      }),
      /chainId must match/,
    );

    const aminoSignDoc = {
      account_number: '7',
      chain_id: 'cosmoshub-4',
      fee: {
        amount: [{ amount: '2500', denom: 'uatom' }],
        gas: '200000',
      },
      memo: 'walletconnect amino test',
      msgs: [{
        type: 'cosmos-sdk/MsgSend',
        value: {
          from_address: snapshot.activeAddress,
          to_address: snapshot.activeAddress,
          amount: [{ amount: '1', denom: 'uatom' }],
        },
      }, {
        type: 'cosmos-sdk/MsgMultiSend',
        value: {
          inputs: [{ address: snapshot.activeAddress, coins: [{ amount: '3', denom: 'uatom' }] }],
          outputs: [{ address: convertTestBech32PrefixWithTweak(snapshot.activeAddress, 'cosmos', 1), coins: [{ amount: '3', denom: 'uatom' }] }],
        },
      }, {
        type: 'cosmos-sdk/MsgDeposit',
        value: {
          proposal_id: '42',
          depositor: snapshot.activeAddress,
          amount: [{ amount: '4', denom: 'uatom' }],
        },
      }, {
        type: 'cosmos-sdk/MsgGrant',
        value: {
          granter: snapshot.activeAddress,
          grantee: convertTestBech32PrefixWithTweak(snapshot.activeAddress, 'cosmos', 1),
          grant: { '@type': '/cosmos.authz.v1beta1.GenericAuthorization' },
        },
      }, {
        type: 'cosmos-sdk/MsgRevoke',
        value: {
          granter: snapshot.activeAddress,
          grantee: convertTestBech32PrefixWithTweak(snapshot.activeAddress, 'cosmos', 1),
          msg_type_url: '/cosmos.bank.v1beta1.MsgSend',
        },
      }, {
        type: 'cosmos-sdk/MsgGrantAllowance',
        value: {
          granter: snapshot.activeAddress,
          grantee: convertTestBech32PrefixWithTweak(snapshot.activeAddress, 'cosmos', 1),
          allowance: { '@type': '/cosmos.feegrant.v1beta1.BasicAllowance' },
        },
      }, {
        type: 'cosmos-sdk/MsgRevokeAllowance',
        value: {
          granter: snapshot.activeAddress,
          grantee: convertTestBech32PrefixWithTweak(snapshot.activeAddress, 'cosmos', 1),
        },
      }, {
        type: 'cosmos-sdk/MsgCancelUnbondingDelegation',
        value: {
          delegator_address: snapshot.activeAddress,
          validator_address: 'cosmosvaloper1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a',
          amount: { amount: '5', denom: 'uatom' },
          creation_height: '123',
        },
      }],
      sequence: '3',
    };
    const approvalsBeforeAmino = createdWindows.length;
    const aminoPromise = handleMessage({
      type: 'EXECUTE_WALLETCONNECT_SESSION_REQUEST',
      topic: 'wc-cosmos-topic',
      chainId: 'cosmos:118',
      request: {
        method: 'cosmos_signAmino',
        params: [snapshot.activeAddress, aminoSignDoc],
      },
    });
    const aminoApproval = await resolveLatestApproval(true, approvalsBeforeAmino);
    assert.equal(aminoApproval.kind, 'cosmos-sign-amino');
    assert.equal(aminoApproval.payload.signMode, 'SIGN_MODE_LEGACY_AMINO_JSON');
    assert.equal(aminoApproval.payload.fee, '2500uatom; gas 200000');
    assert.equal(aminoApproval.payload.messages, [
      '#1: cosmos-sdk/MsgSend',
      '#2: cosmos-sdk/MsgMultiSend',
      '#3: cosmos-sdk/MsgDeposit',
      '#4: cosmos-sdk/MsgGrant',
      '#5: cosmos-sdk/MsgRevoke',
      '#6: cosmos-sdk/MsgGrantAllowance',
      '#7: cosmos-sdk/MsgRevokeAllowance',
      '#8: cosmos-sdk/MsgCancelUnbondingDelegation',
    ].join(', '));
    assert.deepEqual(aminoApproval.payload.messageDetails, [
      `#1: cosmos-sdk/MsgSend (from: ${snapshot.activeAddress}; to: ${snapshot.activeAddress}; amount: 1uatom)`,
      `#2: cosmos-sdk/MsgMultiSend (inputs: ${snapshot.activeAddress}: 3uatom; outputs: ${convertTestBech32PrefixWithTweak(snapshot.activeAddress, 'cosmos', 1)}: 3uatom)`,
      `#3: cosmos-sdk/MsgDeposit (depositor: ${snapshot.activeAddress}; proposal: 42; amount: 4uatom)`,
      `#4: cosmos-sdk/MsgGrant (granter: ${snapshot.activeAddress}; grantee: ${convertTestBech32PrefixWithTweak(snapshot.activeAddress, 'cosmos', 1)}; grant type: /cosmos.authz.v1beta1.GenericAuthorization)`,
      `#5: cosmos-sdk/MsgRevoke (granter: ${snapshot.activeAddress}; grantee: ${convertTestBech32PrefixWithTweak(snapshot.activeAddress, 'cosmos', 1)}; msg type: /cosmos.bank.v1beta1.MsgSend)`,
      `#6: cosmos-sdk/MsgGrantAllowance (granter: ${snapshot.activeAddress}; grantee: ${convertTestBech32PrefixWithTweak(snapshot.activeAddress, 'cosmos', 1)}; allowance type: /cosmos.feegrant.v1beta1.BasicAllowance)`,
      `#7: cosmos-sdk/MsgRevokeAllowance (granter: ${snapshot.activeAddress}; grantee: ${convertTestBech32PrefixWithTweak(snapshot.activeAddress, 'cosmos', 1)})`,
      `#8: cosmos-sdk/MsgCancelUnbondingDelegation (delegator: ${snapshot.activeAddress}; validator: cosmosvaloper1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a; amount: 5uatom; creation height: 123)`,
    ]);
    const aminoSigned = await aminoPromise;
    assert.deepEqual(aminoSigned.signed, aminoSignDoc);
    assert.equal(aminoSigned.signature.pub_key.type, 'tendermint/PubKeySecp256k1');
    assert.equal(typeof aminoSigned.signature.pub_key.value, 'string');
    assert.equal(typeof aminoSigned.signature.signature, 'string');

    await assert.rejects(
      handleMessage({
        type: 'EXECUTE_WALLETCONNECT_SESSION_REQUEST',
        topic: 'wc-cosmos-topic',
        chainId: 'cosmos:118',
        request: {
          method: 'cosmos_signAmino',
          params: [{
            signerAddress: snapshot.activeAddress,
            signDoc: { ...aminoSignDoc, chain_id: 'wrong-chain' },
          }],
        },
      }),
      /chainId must match/,
    );
  });

  test('ADD_ACCOUNT reserves HD indices across concurrent requests', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });

    const [second, third] = await Promise.all([
      handleMessage({ type: 'ADD_ACCOUNT', password: PASSWORD }),
      handleMessage({ type: 'ADD_ACCOUNT', password: PASSWORD }),
    ]);

    assert.notEqual(second.pqAddress, third.pqAddress, 'Concurrent HD account derivation must not reuse an index');
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    assert.equal(snapshot.wallet.accounts.length, 3, 'Two concurrent account additions must persist two distinct accounts');
  });

  test('AUTHORIZE_SESSION_KEY derives and signs a deterministic HD session key', async () => {
    await resetHd();
    const root = await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    const txSigningHash = `0x${'11'.repeat(32)}`;

    const auth = await handleMessage({
      type: 'AUTHORIZE_SESSION_KEY',
      password: PASSWORD,
      sessionIndex: 7,
      rootAccountIndex: 0,
      expiryBlock: 1234,
      valueCap: '0xde0b6b3a7640000',
      target: null,
      txSigningHash,
    });

    assert.equal(auth.rootAddress, root.pqAddress, 'Root address must match account 0');
    assert.equal(auth.sessionPath, "m/1'/1'/7'", 'Session path must match PQ-HD session subtree');
    assert.match(auth.sessionAddress, /^0x[0-9a-f]{64}$/, 'Session key must have a Shell address');
    assert.notEqual(auth.sessionAddress, root.pqAddress, 'Session address must not equal root account');
    assert.equal(auth.sessionAuth.session_algo, 1, 'Wallet session keys use ML-DSA-65');
    assert.equal(auth.sessionAuth.expiry_block, 1234, 'Expiry block must be preserved');
    assert.equal(auth.sessionAuth.value_cap, '0xde0b6b3a7640000', 'Value cap must be canonical hex');
    assert.equal(auth.sessionAuth.target, null, 'Null target means unrestricted target');
    assert.equal(auth.sessionAuth.session_pubkey.length, 1952, 'Session public key length');
    assert.ok(auth.sessionAuth.root_signature.length > 0, 'Root signature must be present');
    assert.ok(auth.sessionAuth.session_signature.length > 0, 'Session signature must be present when txSigningHash is provided');

    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    const auth2 = await handleMessage({
      type: 'AUTHORIZE_SESSION_KEY',
      password: PASSWORD,
      sessionIndex: 7,
      rootAccountIndex: 0,
      expiryBlock: 1234,
      valueCap: '0xde0b6b3a7640000',
      target: null,
    });
    assert.equal(auth.sessionAddress, auth2.sessionAddress, 'Same mnemonic and session index must derive same session address');
    assert.equal(auth2.sessionAuth.session_signature.length, 0, 'Unsigned session auth must leave session_signature empty');
  });

  test('REVEAL_MNEMONIC returns the original phrase after correct password', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    const res = await handleMessage({ type: 'REVEAL_MNEMONIC', password: PASSWORD });
    assert.equal(res.mnemonic, TEST_MNEMONIC, 'Revealed mnemonic must match original');
  });

  test('REVEAL_MNEMONIC rejects wrong password', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    let threw = false;
    try {
      await handleMessage({ type: 'REVEAL_MNEMONIC', password: 'wrongpassword' });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'REVEAL_MNEMONIC with wrong password must throw');
  });

  test('REVEAL_MNEMONIC throws on non-HD wallet', async () => {
    await resetHd();
    await handleMessage({ type: 'CREATE_WALLET', password: PASSWORD });
    let threw = false;
    try {
      await handleMessage({ type: 'REVEAL_MNEMONIC', password: PASSWORD });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'REVEAL_MNEMONIC must throw when no HD wallet is present');
  });

  test('HD wallet survives lock/unlock cycle', async () => {
    await resetHd();
    const created = await handleMessage({ type: 'CREATE_HD_WALLET', mnemonic: TEST_MNEMONIC, password: PASSWORD });
    await handleMessage({ type: 'LOCK_WALLET' });
    const snapshot = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    assert.equal(snapshot.locked, true, 'Wallet must be locked');
    await handleMessage({ type: 'UNLOCK_WALLET', password: PASSWORD });
    const snapshot2 = await handleMessage({ type: 'GET_WALLET_SNAPSHOT' });
    assert.equal(snapshot2.locked, false, 'Wallet must be unlocked again');
    assert.equal(snapshot2.activeAddress, created.pqAddress, 'Active address must be preserved after lock/unlock');
  });
});
