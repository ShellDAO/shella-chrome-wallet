#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const network = process.env.LIVE_SMOKE_CHAIN?.trim() || 'solanaDevnet';
const safeNetwork = network.replace(/[^a-zA-Z0-9_-]/g, '-');
const artifactPath = path.join(root, 'output', 'playwright', `shella-wallet-live-chain-${safeNetwork}-smoke.json`);
const requireLive = process.env.REQUIRE_LIVE_CHAIN_SMOKE === '1';
const expectedChains = {
  solanaDevnet: 'solana',
  tronShasta: 'tron',
  aptosTestnet: 'aptos',
  aptosDevnet: 'aptos',
};

let artifact;
try {
  artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
} catch (err) {
  throw new Error(`Live-chain smoke artifact is missing or invalid at ${path.relative(root, artifactPath)}: ${err.message}`);
}

assert.ok(['passed', 'skipped', 'failed'].includes(artifact.status), 'artifact.status must be passed, skipped, or failed');
assert.equal(artifact.releaseTrack, 'optional-live-chain', 'live-chain smoke must be an optional-live-chain release track artifact');
assert.equal(typeof artifact.startedAt, 'string', 'artifact.startedAt must be present');
assert.equal(typeof artifact.finishedAt, 'string', 'artifact.finishedAt must be present');
assert.equal(typeof artifact.chain, 'string', 'artifact.chain must be present');
assert.equal(typeof artifact.network, 'string', 'artifact.network must be present');
assert.equal(artifact.network, network, 'artifact.network must match LIVE_SMOKE_CHAIN');
assert.equal(artifact.chain, expectedChains[network], 'artifact.chain must match LIVE_SMOKE_CHAIN');
assert.ok(['owned', 'official-public', 'third-party-public', 'user-custom'].includes(artifact.rpcProvenance), 'artifact.rpcProvenance must be valid');
assert.ok(Array.isArray(artifact.logs), 'artifact.logs must be an array');

if (artifact.status === 'failed') {
  throw new Error(`Live-chain smoke failed: ${artifact.error ?? 'unknown error'}`);
}

if (artifact.status === 'skipped') {
  assert.match(artifact.error ?? '', /LIVE_CHAIN_SMOKE/i, 'skipped artifact must explain missing LIVE_CHAIN_SMOKE=1');
  if (requireLive) {
    throw new Error('Live-chain smoke is required but artifact is skipped. Set LIVE_CHAIN_SMOKE=1 and rerun npm run smoke:live-chain.');
  }
  console.log('✓ Live-chain smoke artifact is valid (skipped; live RPC not required)');
  process.exit(0);
}

assert.equal(artifact.status, 'passed');
assert.equal(typeof artifact.rpcUrl, 'string', 'passed artifact must include rpcUrl');
assert.ok(artifact.logs.length > 0, 'passed artifact must include RPC check logs');
validateChainLogs(artifact);

console.log('✓ Live-chain smoke artifact is valid (passed)');

function validateChainLogs(artifact) {
  const joinedLogs = artifact.logs.join('\n');
  if (artifact.chain === 'solana') {
    assert.match(joinedLogs, /solana:getHealth=ok/, 'Solana live-chain smoke must include getHealth=ok');
    return;
  }
  if (artifact.chain === 'tron') {
    assert.match(joinedLogs, /tron:getnowblock=\d+/, 'Tron live-chain smoke must include getnowblock height');
    return;
  }
  if (artifact.chain === 'aptos') {
    assert.match(joinedLogs, /aptos:healthy=/, 'Aptos live-chain smoke must include health check');
    assert.match(joinedLogs, /aptos:chain_id=\d+/, 'Aptos live-chain smoke must include ledger chain_id');
    assert.match(joinedLogs, /aptos:ledger_version=\d+/, 'Aptos live-chain smoke must include ledger_version');
    assert.match(joinedLogs, /aptos:framework_sequence=\d+/, 'Aptos live-chain smoke must include framework account sequence');
    const chainId = Number(joinedLogs.match(/aptos:chain_id=(\d+)/)?.[1]);
    assert.ok(Number.isInteger(chainId) && chainId >= 0 && chainId <= 255, 'Aptos live-chain smoke chain_id must be a valid u8');
    const expectedChainId = artifact.network === 'aptosTestnet' ? 2 : null;
    if (expectedChainId != null) {
      assert.equal(chainId, expectedChainId, `Aptos live-chain smoke chain_id must match ${artifact.network}`);
    }
  }
}
