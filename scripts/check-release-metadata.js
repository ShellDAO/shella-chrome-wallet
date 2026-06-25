#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
const requireWalletConnectQr = process.env.REQUIRE_WC_REAL_SMOKE === '1';

const version = pkg.version;
const versionHeading = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}]`, 'm');

if (manifest.version !== version) {
  console.error(`Version mismatch: package.json=${version}, manifest.json=${manifest.version}`);
  process.exit(1);
}

if (!versionHeading.test(changelog)) {
  console.error(`CHANGELOG.md is missing a release heading for version ${version}`);
  process.exit(1);
}

const extensionSmoke = readArtifact('shella-wallet-extension-smoke.json');
const tonConnectSmoke = readArtifact('shella-wallet-tonconnect-smoke.json');
const walletConnectSmoke = readArtifact('shella-wallet-walletconnect-smoke.json');

assertTrack(extensionSmoke, {
  filename: 'shella-wallet-extension-smoke.json',
  releaseTrack: 'core-extension',
  requiredStatus: 'passed',
});
assertTrack(tonConnectSmoke, {
  filename: 'shella-wallet-tonconnect-smoke.json',
  releaseTrack: 'core-extension',
  requiredStatus: 'passed',
});
assertTrack(walletConnectSmoke, {
  filename: 'shella-wallet-walletconnect-smoke.json',
  releaseTrack: 'optional-walletconnect-qr',
  requiredStatus: requireWalletConnectQr ? 'passed' : null,
});

console.log(`✓ Release metadata verified for v${version}`);
console.log(`  core-extension: extension=${extensionSmoke.status}, tonconnect=${tonConnectSmoke.status}`);
console.log(`  optional-walletconnect-qr: walletconnect=${walletConnectSmoke.status}${requireWalletConnectQr ? ' (required)' : ' (not required)'}`);

function readArtifact(filename) {
  const artifactPath = join(root, 'output', 'playwright', filename);
  try {
    return JSON.parse(readFileSync(artifactPath, 'utf8'));
  } catch (err) {
    console.error(`Release artifact is missing or invalid at output/playwright/${filename}: ${err.message}`);
    process.exit(1);
  }
}

function assertTrack(artifact, { filename, releaseTrack, requiredStatus }) {
  if (artifact.releaseTrack !== releaseTrack) {
    console.error(`${filename} releaseTrack mismatch: expected ${releaseTrack}, got ${artifact.releaseTrack ?? '<missing>'}`);
    process.exit(1);
  }
  if (!['passed', 'skipped', 'failed'].includes(artifact.status)) {
    console.error(`${filename} has invalid status: ${artifact.status ?? '<missing>'}`);
    process.exit(1);
  }
  if (artifact.status === 'failed') {
    console.error(`${filename} failed: ${artifact.error ?? 'unknown error'}`);
    process.exit(1);
  }
  if (requiredStatus && artifact.status !== requiredStatus) {
    console.error(`${filename} must be ${requiredStatus}, got ${artifact.status}`);
    process.exit(1);
  }
}
