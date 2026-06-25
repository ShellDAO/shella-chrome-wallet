#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const artifactPath = path.join(root, 'output', 'playwright', 'shella-wallet-walletconnect-smoke.json');
const requireReal = process.env.REQUIRE_WC_REAL_SMOKE === '1';

let artifact;
try {
  artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
} catch (err) {
  throw new Error(`WalletConnect smoke artifact is missing or invalid at ${path.relative(root, artifactPath)}: ${(err).message}`);
}

assert.ok(['passed', 'skipped', 'failed'].includes(artifact.status), 'artifact.status must be passed, skipped, or failed');
assert.equal(artifact.releaseTrack, 'optional-walletconnect-qr', 'WalletConnect smoke must be an optional-walletconnect-qr release track artifact');
assert.equal(typeof artifact.startedAt, 'string', 'artifact.startedAt must be present');
assert.equal(typeof artifact.finishedAt, 'string', 'artifact.finishedAt must be present');
assert.equal(typeof artifact.projectIdConfigured, 'boolean', 'artifact.projectIdConfigured must be boolean');
assert.ok(Array.isArray(artifact.logs), 'artifact.logs must be an array');

if (artifact.status === 'failed') {
  throw new Error(`WalletConnect smoke failed: ${artifact.error ?? 'unknown error'}`);
}

if (artifact.status === 'skipped') {
  assert.equal(artifact.projectIdConfigured, false, 'skipped artifact must have projectIdConfigured=false');
  assert.match(artifact.error ?? '', /WC_PROJECT_ID/i, 'skipped artifact must explain missing WC_PROJECT_ID');
  if (requireReal) {
    throw new Error('WalletConnect real smoke is required but artifact is skipped. Set WC_PROJECT_ID and rerun npm run smoke:walletconnect.');
  }
  console.log('✓ WalletConnect smoke artifact is valid (skipped; real smoke not required)');
  process.exit(0);
}

assert.equal(artifact.status, 'passed');
assert.equal(artifact.projectIdConfigured, true, 'passed artifact must have projectIdConfigured=true');
assert.match(artifact.extensionId ?? '', /^[a-z]{32}$/, 'extensionId must be a Chrome extension id');
assert.equal(typeof artifact.pairingTopic, 'string', 'pairingTopic must be present');
assert.equal(typeof artifact.sessionTopic, 'string', 'sessionTopic must be present');
assert.ok(Array.isArray(artifact.approvedAccounts) && artifact.approvedAccounts.length > 0, 'approvedAccounts must be non-empty');
assert.match(artifact.approvedAccounts[0], /^eip155:424242:0x[0-9a-fA-F]{64}$/, 'approved account must be Shell/EIP-155 CAIP account');
assert.equal(artifact.chainId, '0x67932', 'eth_chainId response must match Shell Devnet');
assert.match(artifact.txRejection ?? '', /rejected|Request rejected by user/i, 'txRejection must record user rejection');
assert.equal(artifact.disconnected, true, 'disconnect must complete');
assert.equal(typeof artifact.screenshot, 'string', 'screenshot path must be present');

console.log('✓ WalletConnect smoke artifact is valid (passed)');
