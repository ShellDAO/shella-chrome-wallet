#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outputDir = path.join(root, 'output', 'playwright');

const chain = process.env.LIVE_SMOKE_CHAIN?.trim() || 'solanaDevnet';
const enabled = process.env.LIVE_CHAIN_SMOKE === '1';

const presets = {
  solanaDevnet: {
    chain: 'solana',
    network: 'solanaDevnet',
    rpcUrl: 'https://api.devnet.solana.com',
    rpcProvenance: 'official-public',
    check: checkSolana,
  },
  tronShasta: {
    chain: 'tron',
    network: 'tronShasta',
    rpcUrl: 'https://api.shasta.trongrid.io',
    rpcProvenance: 'official-public',
    check: checkTron,
  },
  aptosTestnet: {
    chain: 'aptos',
    network: 'aptosTestnet',
    rpcUrl: 'https://fullnode.testnet.aptoslabs.com/v1',
    rpcProvenance: 'official-public',
    check: checkAptos,
  },
  aptosDevnet: {
    chain: 'aptos',
    network: 'aptosDevnet',
    rpcUrl: 'https://fullnode.devnet.aptoslabs.com/v1',
    rpcProvenance: 'official-public',
    check: checkAptos,
  },
};

await mkdir(outputDir, { recursive: true });

const preset = presets[chain];
const artifact = {
  status: 'started',
  releaseTrack: 'optional-live-chain',
  startedAt: new Date().toISOString(),
  chain: preset?.chain ?? chain,
  network: preset?.network ?? chain,
  rpcUrl: process.env.LIVE_SMOKE_RPC_URL?.trim() || preset?.rpcUrl || null,
  rpcProvenance: process.env.LIVE_SMOKE_RPC_URL?.trim() ? 'user-custom' : preset?.rpcProvenance ?? 'user-custom',
  txHash: null,
  logs: [],
  error: null,
};

try {
  if (!enabled) {
    artifact.status = 'skipped';
    artifact.error = 'LIVE_CHAIN_SMOKE=1 is required for optional live-chain RPC smoke';
    const artifactPath = await writeArtifact(artifact);
    console.log('↷ Live-chain smoke skipped: set LIVE_CHAIN_SMOKE=1 to check an RPC endpoint');
    console.log(`  ${path.relative(root, artifactPath)}`);
    process.exit(0);
  }

  assert.ok(preset, `Unsupported LIVE_SMOKE_CHAIN "${chain}". Use solanaDevnet, tronShasta, aptosTestnet, or aptosDevnet.`);
  assert.equal(typeof artifact.rpcUrl, 'string', 'rpcUrl must be configured');

  const result = await preset.check(artifact.rpcUrl);
  artifact.status = 'passed';
  artifact.logs.push(result);

  const artifactPath = await writeArtifact(artifact);
  console.log(`✓ Live-chain smoke passed (${artifact.network})`);
  console.log(`  ${path.relative(root, artifactPath)}`);
} catch (err) {
  artifact.status = 'failed';
  artifact.error = err.message;
  const artifactPath = await writeArtifact(artifact).catch(() => null);
  if (artifactPath) console.error(`Live-chain smoke artifact: ${path.relative(root, artifactPath)}`);
  throw err;
}

async function checkSolana(rpcUrl) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
  });
  assert.equal(response.ok, true, `Solana RPC returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`Solana RPC error: ${body.error.message ?? JSON.stringify(body.error)}`);
  assert.equal(body.result, 'ok', `Solana getHealth returned ${body.result}`);
  return 'solana:getHealth=ok';
}

async function checkTron(rpcUrl) {
  const url = new URL('/wallet/getnowblock', rpcUrl);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.ok, true, `Tron RPC returned HTTP ${response.status}`);
  const body = await response.json();
  assert.equal(typeof body.blockID, 'string', 'Tron getnowblock response must include blockID');
  assert.equal(typeof body.block_header?.raw_data?.number, 'number', 'Tron getnowblock response must include block number');
  return `tron:getnowblock=${body.block_header.raw_data.number}`;
}

async function checkAptos(rpcUrl) {
  const health = await fetch(aptosRestUrl(rpcUrl, '-/healthy'));
  assert.equal(health.ok, true, `Aptos RPC health returned HTTP ${health.status}`);
  const healthText = (await health.text()).trim() || String(health.status);

  const ledger = await fetch(aptosRestUrl(rpcUrl, ''));
  assert.equal(ledger.ok, true, `Aptos ledger info returned HTTP ${ledger.status}`);
  const ledgerBody = await ledger.json();
  assert.equal(typeof ledgerBody.chain_id, 'number', 'Aptos ledger info must include numeric chain_id');
  assert.equal(typeof ledgerBody.ledger_version, 'string', 'Aptos ledger info must include ledger_version');
  assert.equal(typeof ledgerBody.ledger_timestamp, 'string', 'Aptos ledger info must include ledger_timestamp');

  const account = await fetch(aptosRestUrl(rpcUrl, 'accounts/0x1'));
  assert.equal(account.ok, true, `Aptos framework account returned HTTP ${account.status}`);
  const accountBody = await account.json();
  assert.equal(typeof accountBody.sequence_number, 'string', 'Aptos framework account must include sequence_number');

  return [
    `aptos:healthy=${healthText}`,
    `aptos:chain_id=${ledgerBody.chain_id}`,
    `aptos:ledger_version=${ledgerBody.ledger_version}`,
    `aptos:framework_sequence=${accountBody.sequence_number}`,
  ].join('; ');
}

function aptosRestUrl(rpcUrl, endpoint) {
  const base = rpcUrl.replace(/\/+$/, '');
  return `${base}/${endpoint.replace(/^\/+/, '')}`;
}

async function writeArtifact(data) {
  const safeNetwork = String(data.network ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-');
  const artifactPath = path.join(outputDir, `shella-wallet-live-chain-${safeNetwork}-smoke.json`);
  await writeFile(artifactPath, JSON.stringify({
    ...data,
    finishedAt: new Date().toISOString(),
  }, null, 2));
  return artifactPath;
}
