import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

let importCounter = 0;

async function loadContentScript(disabledOrigins = []) {
  const appendedScripts = [];
  const listeners = [];
  const documentElement = {
    appendChild(node) {
      appendedScripts.push(node);
      node.onload?.();
    },
  };

  globalThis.window = {
    location: { origin: 'https://dapp.example' },
    addEventListener(type, listener) {
      listeners.push({ type, listener });
    },
    postMessage() {},
  };
  globalThis.document = {
    head: documentElement,
    documentElement,
    createElement(tagName) {
      return {
        tagName,
        remove() {
          this.removed = true;
        },
      };
    },
  };
  globalThis.chrome = {
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
      sendMessage() {},
    },
    storage: {
      local: {
        async get(key) {
          assert.equal(key, 'providerDisabledOrigins');
          return { providerDisabledOrigins: disabledOrigins };
        },
      },
    },
  };

  importCounter += 1;
  await import(`../dist/content.js?case=${importCounter}`);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { appendedScripts, listeners };
}

describe('content script provider injection policy', () => {
  test('injects inpage provider and registers bridge when origin is enabled', async () => {
    const { appendedScripts, listeners } = await loadContentScript([]);
    assert.equal(appendedScripts.length, 1);
    assert.equal(appendedScripts[0].src, 'chrome-extension://test/dist/inpage.js');
    assert.equal(listeners.some((entry) => entry.type === 'message'), true);
  });

  test('does not inject or register message bridge when origin is disabled', async () => {
    const { appendedScripts, listeners } = await loadContentScript(['https://dapp.example']);
    assert.equal(appendedScripts.length, 0);
    assert.equal(listeners.length, 0);
  });
});
