// Endpoint configuration (F4).
//
// `config set-key` validated the whole key name against the provider list, so
// every `<provider>-endpoint` name came back as "Unknown provider". Azure was
// dead as a result: its isConfigured() requires azure-endpoint, which could
// never be set.

import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startStubServer } from './helpers/openai-stub.mjs';

const home = mkdtempSync(join(tmpdir(), 'cude-home-'));
process.env.CUDE_HOME = home;

const { runConfigSetKey, runConfigSetEndpoint, parseConfigKeyName, ENDPOINT_PROVIDERS } =
  await import('../dist/commands/config.js');
const { getApiKey } = await import('../dist/config/index.js');
const { getProvider } = await import('../dist/providers/index.js');

after(() => rmSync(home, { recursive: true, force: true }));

/** `showSuccess` boxes output to stdout; keep the test log readable. */
function quietly(fn) {
  const log = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
  }
}

describe('F4: endpoint config keys are reachable', () => {
  test('F4: config set-key accepts all four <provider>-endpoint names', async () => {
    for (const provider of ['vllm', 'litellm', 'gguf', 'azure']) {
      const url = `https://${provider}.example.com`;
      await quietly(() => runConfigSetKey(`${provider}-endpoint`, url));
      assert.equal(
        getApiKey(`${provider}-endpoint`),
        url,
        `${provider}-endpoint was not stored`
      );
    }
  });

  test('F4: every provider that reads an endpoint is listed as accepting one', () => {
    assert.deepEqual([...ENDPOINT_PROVIDERS].sort(), ['azure', 'gguf', 'litellm', 'vllm']);
  });

  test('F4: azure becomes configured once its key and endpoint are set', async () => {
    // isConfigured() requires azure-endpoint, so before this fix Azure could
    // never report itself configured no matter what the user did.
    await quietly(() => runConfigSetKey('azure', 'test-key'));
    await quietly(() => runConfigSetEndpoint('azure', 'https://example.openai.azure.com'));

    assert.equal(getProvider('azure').isConfigured(), true);
  });

  test('F4: a trailing slash is normalised away', async () => {
    await quietly(() => runConfigSetEndpoint('vllm', 'http://localhost:8000/'));
    assert.equal(getApiKey('vllm-endpoint'), 'http://localhost:8000');
  });

  test('every config key a provider reads can actually be set from the CLI', async () => {
    // litellm.ts read getApiKey('litellm-key'), but `config set-key litellm`
    // stores under "litellm" and the CLI rejects "litellm-key" outright — so
    // setting a LiteLLM key silently did nothing. This is the same shape as F4,
    // and it can recur in any provider, so check them all rather than just the
    // one that had it.
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const providerDir = fileURLToPath(new URL('../src/providers/', import.meta.url));

    // Names kept only so previously hand-edited configs keep working. A new
    // entry here should be a deliberate decision, not an accident.
    const LEGACY_FALLBACKS = new Set(['litellm-key']);

    const unreachable = [];
    for (const file of readdirSync(providerDir).filter(f => f.endsWith('.ts'))) {
      const source = readFileSync(join(providerDir, file), 'utf8');
      for (const match of source.matchAll(/getApiKey\('([^']+)'\)/g)) {
        const name = match[1];
        if (LEGACY_FALLBACKS.has(name)) continue;
        if (parseConfigKeyName(name) === null) {
          unreachable.push(`${file}: getApiKey('${name}')`);
        }
      }
    }

    assert.deepEqual(
      unreachable,
      [],
      'these settings are read at runtime but cannot be set with "cude config set-key"'
    );
  });

  test('a LiteLLM key set the documented way is actually sent on the request', async () => {
    // isConfigured() always returns true for LiteLLM, so it proves nothing.
    // The only real evidence is the Authorization header on the wire.
    const { LiteLLMProvider } = await import('../dist/providers/litellm.js');
    const server = await startStubServer([{ content: 'hello' }]);
    try {
      await quietly(() => runConfigSetKey('litellm', 'litellm-secret'));
      await quietly(() => runConfigSetEndpoint('litellm', server.url));

      await new LiteLLMProvider().chat([{ role: 'user', content: 'hi' }], 'some-model');

      assert.equal(
        server.requests[0].headers.authorization,
        'Bearer litellm-secret',
        'the key set with "config set-key litellm" never reached the request'
      );
    } finally {
      await server.close();
    }
  });

  test('F4: genuinely unknown names are still rejected', () => {
    assert.equal(parseConfigKeyName('not-a-provider'), null);
    assert.equal(parseConfigKeyName('openai-endpoint'), null, 'OpenAI reads no endpoint setting');
    assert.deepEqual(parseConfigKeyName('groq'), { kind: 'api-key', provider: 'groq' });
    assert.deepEqual(parseConfigKeyName('vllm-endpoint'), { kind: 'endpoint', provider: 'vllm' });
  });
});
