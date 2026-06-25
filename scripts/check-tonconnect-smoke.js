#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const artifactPath = path.join(root, 'output', 'playwright', 'shella-wallet-tonconnect-smoke.json');

let artifact;
try {
  artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
} catch (err) {
  throw new Error(`TonConnect smoke artifact is missing or invalid at ${path.relative(root, artifactPath)}: ${err.message}`);
}

assert.equal(artifact.status, 'passed', `TonConnect smoke must pass, got ${artifact.status}: ${artifact.error ?? ''}`);
assert.equal(artifact.releaseTrack, 'core-extension', 'TonConnect smoke must be a core-extension release track artifact');
assert.equal(typeof artifact.startedAt, 'string', 'artifact.startedAt must be present');
assert.equal(typeof artifact.finishedAt, 'string', 'artifact.finishedAt must be present');
assert.match(artifact.extensionId ?? '', /^[a-z]{32}$/, 'extensionId must be a Chrome extension id');
assert.match(artifact.dappOrigin ?? '', /^http:\/\/127\.0\.0\.1:\d+$/, 'dappOrigin must be a local HTTP origin');
assert.equal(artifact.discovered, true, 'TonConnect discovery must complete');
assert.equal(artifact.connected, true, 'TonConnect connect approval must complete');
assert.equal(artifact.restored, true, 'TonConnect restoreConnection must return the session');
assert.equal(artifact.txRejected, true, 'TonConnect sendTransaction rejection path must complete');
assert.equal(artifact.disconnected, true, 'TonConnect session removal must complete');
assert.equal(typeof artifact.screenshot, 'string', 'screenshot path must be present');
assert.ok(Array.isArray(artifact.logs), 'artifact.logs must be an array');

console.log('✓ TonConnect smoke artifact is valid (passed)');
