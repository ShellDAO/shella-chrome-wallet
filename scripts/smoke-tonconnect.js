#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outputDir = path.join(root, 'output', 'playwright');

await mkdir(outputDir, { recursive: true });

const logs = [];
const artifact = {
  status: 'started',
  releaseTrack: 'core-extension',
  startedAt: new Date().toISOString(),
  extensionId: null,
  dappOrigin: null,
  discovered: false,
  connected: false,
  restored: false,
  txRejected: false,
  disconnected: false,
  screenshot: null,
  logs,
  error: null,
};

const server = createServer((req, res) => {
  if (req.url === '/tonconnect-manifest.json') {
    res.writeHead(200, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    });
    res.end(JSON.stringify({
      url: artifact.dappOrigin,
      name: 'Shella TonConnect Smoke dApp',
      iconUrl: `${artifact.dappOrigin}/icon.png`,
    }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html>
    <html>
      <head><meta charset="utf-8"><title>Shella TonConnect Smoke</title></head>
      <body>
        <h1>Shella TonConnect Smoke</h1>
        <div id="status">ready</div>
      </body>
    </html>`);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const dappOrigin = `http://127.0.0.1:${port}`;
artifact.dappOrigin = dappOrigin;

const userDataDir = await mkdtemp(path.join(tmpdir(), 'shella-wallet-tonconnect-smoke-'));
let context;

try {
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

  const popupPage = await context.newPage();
  popupPage.on('console', (msg) => logs.push(`popup:${msg.type()}:${msg.text()}`));
  popupPage.on('pageerror', (err) => logs.push(`popup-pageerror:${err.message}`));
  await createHdWallet(popupPage, extensionId);
  await setTonNetwork(popupPage);

  const dappPage = await context.newPage();
  dappPage.on('console', (msg) => logs.push(`dapp:${msg.type()}:${msg.text()}`));
  dappPage.on('pageerror', (err) => logs.push(`dapp-pageerror:${err.message}`));
  await dappPage.goto(dappOrigin);
  await dappPage.waitForFunction(() => Boolean(window.ton?.tonconnect), null, { timeout: 15000 });
  const deviceInfo = await dappPage.evaluate(() => window.ton.tonconnect.deviceInfo);
  assert.equal(deviceInfo.maxProtocolVersion, 2);
  assert.equal(deviceInfo.features.some((feature) => typeof feature === 'object' && feature.name === 'SendTransaction'), true);
  artifact.discovered = true;

  const connectApprovalPromise = context.waitForEvent('page', { timeout: 45000 });
  const connectPromise = dappPage.evaluate(async (origin) => window.ton.tonconnect.connect(2, {
    clientId: 'ton-smoke-client',
    manifestUrl: `${origin}/tonconnect-manifest.json`,
    items: ['ton_addr', { name: 'ton_proof' }],
  }), dappOrigin);
  const connectApproval = await connectApprovalPromise;
  await connectApproval.waitForSelector('#btn-approval-approve', { timeout: 45000 });
  await openApprovalDetails(connectApproval);
  const connectText = await connectApproval.locator('body').innerText();
  assert.match(connectText, /tonconnect-proposal/);
  assert.match(connectText, /ton-smoke-client/);
  await connectApproval.click('#btn-approval-approve');

  const connected = await connectPromise;
  assert.equal(connected.clientId, 'ton-smoke-client');
  assert.match(connected.account, /^[A-Za-z0-9_-]{48}$/);
  assert.equal(connected.network, 'mainnet');
  artifact.connected = true;

  const restored = await dappPage.evaluate(async () => window.ton.tonconnect.restoreConnection());
  assert.equal(restored.sessions.some((session) => session.clientId === 'ton-smoke-client'), true);
  artifact.restored = true;

  const txApprovalPromise = context.waitForEvent('page', { timeout: 45000 });
  const txPromise = dappPage.evaluate(async (account) => window.ton.tonconnect.send({
    method: 'sendTransaction',
    params: [{
      valid_until: Math.floor(Date.now() / 1000) + 120,
      messages: [{ address: account, amount: '100000000' }],
    }],
  }), connected.account);
  const txApproval = await txApprovalPromise;
  await txApproval.waitForSelector('#btn-approval-reject', { timeout: 45000 });
  await openApprovalDetails(txApproval);
  const txText = await txApproval.locator('body').innerText();
  assert.match(txText, /tonconnect-request/);
  assert.match(txText, /100000000/);
  await txApproval.click('#btn-approval-reject');
  await txPromise.then(
    () => {
      throw new Error('TonConnect sendTransaction unexpectedly resolved after rejection');
    },
    (err) => {
      assert.match(err.message, /rejected|Request rejected by user/i);
      artifact.txRejected = true;
    },
  );

  await removeTonConnectSession(popupPage, 'ton-smoke-client');
  const afterDisconnect = await dappPage.evaluate(async () => window.ton.tonconnect.restoreConnection());
  assert.equal(afterDisconnect.sessions.some((session) => session.clientId === 'ton-smoke-client'), false);
  artifact.disconnected = true;

  const screenshot = path.join(outputDir, 'shella-wallet-tonconnect-smoke.png');
  await dappPage.screenshot({ path: screenshot, fullPage: true });
  artifact.screenshot = path.relative(root, screenshot);
  artifact.status = 'passed';

  if (logs.length > 0) {
    console.warn(`Browser console messages:\n${logs.join('\n')}`);
  }

  const artifactPath = await writeArtifact(artifact);
  console.log(`✓ TonConnect smoke passed (${extensionId})`);
  console.log(`  ${path.relative(root, screenshot)}`);
  console.log(`  ${path.relative(root, artifactPath)}`);
} catch (err) {
  artifact.status = 'failed';
  artifact.error = err.message;
  const artifactPath = await writeArtifact(artifact).catch(() => null);
  if (artifactPath) console.error(`TonConnect smoke artifact: ${path.relative(root, artifactPath)}`);
  if (String(err).includes('Executable doesn')) {
    console.error('Playwright Chromium is not installed. Run: npx playwright install chromium');
  }
  throw err;
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
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
  await page.waitForSelector('#btn-send', { timeout: 20000 });
}

async function setTonNetwork(page) {
  await page.evaluate(() => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: 'SET_NETWORK',
      network: {
        name: 'TON Mainnet',
        chainId: 607,
        rpcUrl: 'https://toncenter.com/api/v2',
        kind: 'ton',
        symbol: 'TON',
      },
    }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response?.error) {
        reject(new Error(response.error));
        return;
      }
      resolve(response);
    });
  }));
}

async function removeTonConnectSession(page, clientId) {
  await page.evaluate((id) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'REMOVE_TONCONNECT_SESSION', clientId: id }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response?.error) {
        reject(new Error(response.error));
        return;
      }
      resolve(response);
    });
  }), clientId);
}

async function openApprovalDetails(page) {
  const details = page.locator('.approval-details');
  if (await details.count() === 0) return;
  await details.evaluate((node) => {
    if (node instanceof HTMLDetailsElement) node.open = true;
  });
}

async function writeArtifact(data) {
  const artifactPath = path.join(outputDir, 'shella-wallet-tonconnect-smoke.json');
  await writeFile(artifactPath, JSON.stringify({
    ...data,
    finishedAt: new Date().toISOString(),
  }, null, 2));
  return artifactPath;
}
