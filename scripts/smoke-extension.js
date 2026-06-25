#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outputDir = path.join(root, 'output', 'playwright');

await mkdir(outputDir, { recursive: true });

const userDataDir = await mkdtemp(path.join(tmpdir(), 'shella-wallet-smoke-'));
const logs = [];
const artifact = {
  status: 'started',
  releaseTrack: 'core-extension',
  startedAt: new Date().toISOString(),
  extensionId: null,
  createdWallet: false,
  renderedMainView: false,
  screenshots: [],
  logs,
  error: null,
};
let context;

try {
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 420, height: 680 },
    args: [
      `--disable-extensions-except=${root}`,
      `--load-extension=${root}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  }

  const extensionId = new URL(serviceWorker.url()).host;
  assert.match(extensionId, /^[a-z]{32}$/);
  artifact.extensionId = extensionId;

  const page = await context.newPage();
  page.on('console', (msg) => logs.push(`console:${msg.type()}:${msg.text()}`));
  page.on('pageerror', (err) => logs.push(`pageerror:${err.message}`));

  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.waitForSelector('#btn-create-hd', { timeout: 15000 });
  assert.match(await page.locator('body').innerText(), /Shella Wallet/);

  await page.click('#btn-create-hd');
  await page.waitForSelector('#btn-hd-phrase-next', { timeout: 15000 });
  assert.equal(await page.locator('.phrase-word').count(), 24);

  await page.click('#btn-hd-phrase-next');
  await page.waitForSelector('#hd-confirm-check', { timeout: 10000 });
  await page.check('#hd-confirm-check');
  await page.click('#btn-hd-confirm-next');

  await page.waitForSelector('#hd-pwd1', { timeout: 10000 });
  await page.fill('#hd-pwd1', 'playwright-password-123');
  await page.fill('#hd-pwd2', 'playwright-password-123');
  await page.click('#btn-hd-create-confirm');

  await page.waitForSelector('#addr-display', { timeout: 45000 });
  const successText = await page.locator('body').innerText();
  assert.match(successText, /Wallet Created!/);
  assert.match(await page.locator('#addr-display').innerText(), /^0x[0-9a-f]{8}.*[0-9a-f]{8}$/);

  const successShot = path.join(outputDir, 'shella-wallet-create-success.png');
  await page.screenshot({ path: successShot, fullPage: true });
  artifact.createdWallet = true;
  artifact.screenshots.push(path.relative(root, successShot));

  await page.click('#btn-goto-wallet');
  await page.waitForSelector('#btn-send', { timeout: 20000 });
  const walletText = await page.locator('body').innerText();
  assert.match(walletText, /Send/);
  assert.match(walletText, /Receive/);
  assert.match(walletText, /History/);

  const mainShot = path.join(outputDir, 'shella-wallet-main.png');
  await page.screenshot({ path: mainShot, fullPage: true });
  artifact.renderedMainView = true;
  artifact.screenshots.push(path.relative(root, mainShot));
  artifact.status = 'passed';

  if (logs.length > 0) {
    console.warn(`Browser console messages:\n${logs.join('\n')}`);
  }

  const artifactPath = await writeArtifact(artifact);
  console.log(`✓ Extension smoke passed (${extensionId})`);
  console.log(`  ${path.relative(root, successShot)}`);
  console.log(`  ${path.relative(root, mainShot)}`);
  console.log(`  ${path.relative(root, artifactPath)}`);
} catch (err) {
  artifact.status = 'failed';
  artifact.error = err.message;
  const artifactPath = await writeArtifact(artifact).catch(() => null);
  if (artifactPath) console.error(`Extension smoke artifact: ${path.relative(root, artifactPath)}`);
  if (String(err).includes('Executable doesn')) {
    console.error('Playwright Chromium is not installed. Run: npx playwright install chromium');
  }
  throw err;
} finally {
  await context?.close();
}

async function writeArtifact(data) {
  const artifactPath = path.join(outputDir, 'shella-wallet-extension-smoke.json');
  await writeFile(artifactPath, JSON.stringify({
    ...data,
    finishedAt: new Date().toISOString(),
  }, null, 2));
  return artifactPath;
}
