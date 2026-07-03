#!/usr/bin/env node

import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const budgets = [
  ['background.js', Number(process.env.MAX_BACKGROUND_BUNDLE_BYTES ?? 1048576)],
  ['walletconnect-bridge.js', Number(process.env.MAX_WALLETCONNECT_BRIDGE_BUNDLE_BYTES ?? 1415578)],
  ['popup.js', Number(process.env.MAX_POPUP_BUNDLE_BYTES ?? 262144)],
  ['inpage.js', Number(process.env.MAX_INPAGE_BUNDLE_BYTES ?? 32768)],
  ['content.js', Number(process.env.MAX_CONTENT_BUNDLE_BYTES ?? 10240)],
];

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

let failed = false;
for (const [filename, maxBytes] of budgets) {
  const bundlePath = join(root, 'dist', filename);
  if (!existsSync(bundlePath)) {
    console.error(`Missing bundle: ${bundlePath}. Run "npm run build:prod" first.`);
    failed = true;
    continue;
  }

  const size = statSync(bundlePath).size;
  console.log(`${filename} size: ${formatBytes(size)} (limit ${formatBytes(maxBytes)})`);
  if (size > maxBytes) {
    console.error(
      `${filename} exceeds the allowed limit by ${formatBytes(size - maxBytes)}. ` +
        'Investigate new dependencies or split non-critical code paths before merging.',
    );
    failed = true;
  }
}

if (failed) process.exit(1);

console.log('✓ extension bundles are within the allowed production budgets');
