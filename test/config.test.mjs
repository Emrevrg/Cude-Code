// Regression tests for the configuration commands.
//
// F4: `<provider>-endpoint` keys (azure-endpoint, vllm-endpoint,
// litellm-endpoint, gguf-endpoint) used to be rejected as "Unknown provider"
// because runConfigSetKey validated the key name against the bare provider
// list. They are now accepted and stored, and Azure can finally become
// "configured" once both its key and endpoint are set.

import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';

const { runConfigSetKey } = await import('../dist/commands/config.js');
const { getApiKey, setApiKey, removeApiKey } = await import('../dist/config/index.js');
const { getProvider } = await import('../dist/providers/index.js');

const ENDPOINT_KEYS = [
  ['azure-endpoint', 'https://example.openai.azure.com'],
  ['vllm-endpoint', 'https://vllm.local:8000'],
  ['litellm-endpoint', 'https://litellm.local:4000'],
  ['gguf-endpoint', 'https://gguf.local:8080'],
];

const touchedKeys = new Set();

after(() => {
  for (const k of touchedKeys) {
    try { removeApiKey(k); } catch { /* ignore */ }
  }
});

describe('F4 — endpoint config keys are reachable', () => {
  for (const [name, url] of ENDPOINT_KEYS) {
    test(`F4: cude config set-key ${name} <url> succeeds`, async () => {
      // runConfigSetKey calls process.exit(1) on an unknown key, which would
      // throw in the test process. Providing the value arg skips the inquirer
      // prompt, so this exercises only the validation + storage path.
      await runConfigSetKey(name, url);
      touchedKeys.add(name);
      assert.equal(getApiKey(name), url, `${name} was not stored`);
    });
  }

  test('F4: Azure becomes configured once key and endpoint are both set', () => {
    setApiKey('azure', 'fake-azure-key-for-test');
    setApiKey('azure-endpoint', 'https://example.openai.azure.com');
    touchedKeys.add('azure');
    touchedKeys.add('azure-endpoint');
    const azure = getProvider('azure');
    assert.equal(azure.isConfigured(), true, 'Azure should be configured with key + endpoint');
  });
});
