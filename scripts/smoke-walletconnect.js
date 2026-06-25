#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import SignClient from '@walletconnect/sign-client';
import { getSdkError } from '@walletconnect/utils';

const projectId = process.env.WC_PROJECT_ID?.trim() ?? '';
const relayUrl = process.env.WC_RELAY_URL?.trim() ?? '';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outputDir = path.join(root, 'output', 'playwright');

await mkdir(outputDir, { recursive: true });

const logs = [];
const artifact = {
  status: 'started',
  releaseTrack: 'optional-walletconnect-qr',
  startedAt: new Date().toISOString(),
  projectIdConfigured: Boolean(projectId),
  relayUrl: relayUrl || 'default',
  extensionId: null,
  pairingTopic: null,
  sessionTopic: null,
  approvedAccounts: [],
  chainId: null,
  txRejection: null,
  disconnected: false,
  screenshot: null,
  logs,
  error: null,
};

if (!projectId) {
  artifact.status = 'skipped';
  artifact.error = 'WC_PROJECT_ID is required for real relay pairing';
  const artifactPath = await writeArtifact(artifact);
  console.log('↷ WalletConnect smoke skipped: set WC_PROJECT_ID to run real relay pairing');
  console.log(`  ${path.relative(root, artifactPath)}`);
  process.exit(0);
}

const userDataDir = await mkdtemp(path.join(tmpdir(), 'shella-wallet-wc-smoke-'));
let context;
let dappClient;

try {
  dappClient = await SignClient.init({
    projectId,
    relayUrl: relayUrl || undefined,
    logger: 'error',
    metadata: {
      name: 'Shella Wallet Smoke dApp',
      description: 'Local WalletConnect smoke test dApp',
      url: 'https://smoke.shella.local',
      icons: [],
    },
  });

  const { uri, approval } = await dappClient.connect({
    requiredNamespaces: {
      eip155: {
        chains: ['eip155:424242'],
        methods: ['eth_chainId', 'eth_accounts', 'eth_sendTransaction'],
        events: [],
      },
    },
  });
  assert.equal(typeof uri, 'string');
  assert.match(uri, /^wc:/);
  artifact.pairingTopic = uri.slice(3).split('@')[0] || null;

  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 420, height: 720 },
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

  await createHdWallet(page, extensionId);
  await openSettings(page);
  await page.fill('#wc-project-id', projectId);
  if (relayUrl) await page.fill('#wc-relay-url', relayUrl);
  await page.click('#btn-save-wc-config');
  await page.waitForTimeout(500);

  const approvalPagePromise = context.waitForEvent('page', { timeout: 45000 });
  await page.fill('#wc-pairing-uri', uri);
  await page.click('#btn-wc-pair');

  const approvalPage = await approvalPagePromise;
  await approvalPage.waitForSelector('#btn-approval-approve', { timeout: 45000 });
  const approvalText = await approvalPage.locator('body').innerText();
  assert.match(approvalText, /walletconnect-proposal/);
  assert.match(approvalText, /424242/);
  await approvalPage.click('#btn-approval-approve');

  const session = await approval();
  assert.equal(session.namespaces.eip155.accounts.length, 1);
  artifact.sessionTopic = session.topic;
  artifact.approvedAccounts = session.namespaces.eip155.accounts;
  const account = session.namespaces.eip155.accounts[0].split(':').at(-1);
  assert.match(account, /^0x[0-9a-fA-F]{64}$/);

  const chainId = await dappClient.request({
    topic: session.topic,
    chainId: 'eip155:424242',
    request: { method: 'eth_chainId', params: [] },
  });
  assert.equal(chainId, '0x67932');
  artifact.chainId = chainId;

  const txApprovalPagePromise = context.waitForEvent('page', { timeout: 45000 });
  const txRejection = dappClient.request({
    topic: session.topic,
    chainId: 'eip155:424242',
    request: {
      method: 'eth_sendTransaction',
      params: [{
        from: account,
        to: account,
        value: '0x0',
        data: '0x',
      }],
    },
  });
  const txApprovalPage = await txApprovalPagePromise;
  await txApprovalPage.waitForSelector('#btn-approval-reject', { timeout: 45000 });
  const txApprovalText = await txApprovalPage.locator('body').innerText();
  assert.match(txApprovalText, /send-transaction/);
  await txApprovalPage.click('#btn-approval-reject');
  await txRejection.then(
    () => {
      throw new Error('eth_sendTransaction unexpectedly resolved after rejection');
    },
    (err) => {
      assert.match(err.message, /rejected|Request rejected by user/i);
      artifact.txRejection = err.message;
    },
  );

  await dappClient.disconnect({
    topic: session.topic,
    reason: getSdkError('USER_DISCONNECTED'),
  });
  artifact.disconnected = true;

  await openSettings(page);
  const settingsText = await page.locator('body').innerText();
  assert.match(settingsText, /Relay ready|Relay not initialized/);
  assert.match(settingsText, /Project ID set/);

  const screenshot = path.join(outputDir, 'shella-wallet-walletconnect-smoke.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  artifact.screenshot = path.relative(root, screenshot);
  artifact.status = 'passed';

  if (logs.length > 0) {
    console.warn(`Browser console messages:\n${logs.join('\n')}`);
  }

  const artifactPath = await writeArtifact(artifact);
  console.log(`✓ WalletConnect smoke passed (${extensionId})`);
  console.log(`  ${path.relative(root, screenshot)}`);
  console.log(`  ${path.relative(root, artifactPath)}`);
} catch (err) {
  artifact.status = 'failed';
  artifact.error = err.message;
  const artifactPath = await writeArtifact(artifact).catch(() => null);
  if (artifactPath) console.error(`WalletConnect smoke artifact: ${path.relative(root, artifactPath)}`);
  if (String(err).includes('Executable doesn')) {
    console.error('Playwright Chromium is not installed. Run: npx playwright install chromium');
  }
  throw err;
} finally {
  await dappClient?.core?.relayer?.transportClose?.().catch?.(() => undefined);
  await context?.close();
}

async function createHdWallet(page, extensionId) {
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.waitForSelector('#btn-create-hd', { timeout: 15000 });
  await page.click('#btn-create-hd');
  await page.waitForSelector('#btn-hd-phrase-next', { timeout: 15000 });
  await page.click('#btn-hd-phrase-next');
  await page.waitForSelector('#hd-confirm-check', { timeout: 10000 });
  await page.check('#hd-confirm-check');
  await page.click('#btn-hd-confirm-next');
  await page.waitForSelector('#hd-pwd1', { timeout: 10000 });
  await page.fill('#hd-pwd1', 'playwright-password-123');
  await page.fill('#hd-pwd2', 'playwright-password-123');
  await page.click('#btn-hd-create-confirm');
  await page.waitForSelector('#addr-display', { timeout: 45000 });
  await page.click('#btn-goto-wallet');
  await page.waitForSelector('#btn-settings', { timeout: 20000 });
}

async function openSettings(page) {
  await page.goto(page.url().split('?')[0]);
  await page.waitForSelector('#btn-settings', { timeout: 20000 });
  await page.click('#btn-settings');
  await page.waitForSelector('#wc-pairing-uri', { timeout: 10000 });
}

async function writeArtifact(data) {
  const artifactPath = path.join(outputDir, 'shella-wallet-walletconnect-smoke.json');
  await writeFile(artifactPath, JSON.stringify({
    ...data,
    finishedAt: new Date().toISOString(),
  }, null, 2));
  return artifactPath;
}
