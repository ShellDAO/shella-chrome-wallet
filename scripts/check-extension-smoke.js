#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const artifactPath = path.join(root, 'output', 'playwright', 'shella-wallet-extension-smoke.json');

let artifact;
try {
  artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
} catch (err) {
  throw new Error(`Extension smoke artifact is missing or invalid at ${path.relative(root, artifactPath)}: ${err.message}`);
}

assert.equal(artifact.releaseTrack, 'core-extension', 'Extension smoke must be a core-extension release track artifact');
assert.equal(artifact.status, 'passed', `Extension smoke must pass, got ${artifact.status}: ${artifact.error ?? ''}`);
assert.equal(typeof artifact.startedAt, 'string', 'artifact.startedAt must be present');
assert.equal(typeof artifact.finishedAt, 'string', 'artifact.finishedAt must be present');
assert.match(artifact.extensionId ?? '', /^[a-z]{32}$/, 'extensionId must be a Chrome extension id');
assert.equal(artifact.createdWallet, true, 'wallet creation path must complete');
assert.equal(artifact.renderedMainView, true, 'main wallet view must render');
assert.ok(Array.isArray(artifact.screenshots) && artifact.screenshots.length >= 2, 'screenshots must include create and main views');
assert.ok(Array.isArray(artifact.logs), 'artifact.logs must be an array');

console.log('✓ Extension smoke artifact is valid (passed)');
