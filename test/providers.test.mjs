// Provider cost labelling and self-hosted model discovery (F9).
//
// `cude providers list` showed vLLM as "Paid" while vllm.ts hardcodes cost = 0,
// and `cude providers models vllm` printed "No models found" — making -m
// mandatory but undiscoverable.

import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startStubServer } from './helpers/openai-stub.mjs';

const home = mkdtempSync(join(tmpdir(), 'cude-home-'));
process.env.CUDE_HOME = home;

const { getProvider, classifyProvider, isSelfHosted, listProviders } =
  await import('../dist/providers/index.js');
const { showSelfHostedModels } = await import('../dist/commands/providers.js');
const { setApiKey } = await import('../dist/config/index.js');

after(() => rmSync(home, { recursive: true, force: true }));

async function capture(fn) {
  const log = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.log = log;
  }
  return lines.join('\n');
}

describe('F9: the Free/Local column reads provider metadata', () => {
  test('F9: self-hosted providers are labelled local, not paid', () => {
    for (const name of ['vllm', 'gguf', 'ollama']) {
      assert.equal(classifyProvider(getProvider(name)), 'local', `${name} was mislabelled`);
    }
  });

  test('F9: groq is free and openai is paid', () => {
    assert.equal(classifyProvider(getProvider('groq')), 'free');
    assert.equal(classifyProvider(getProvider('openai')), 'paid');
    assert.equal(classifyProvider(getProvider('anthropic')), 'paid');
  });

  test('F9: every provider resolves to a cost class', () => {
    // The label used to come from a two-name lookup in display.ts; now it comes
    // from the providers themselves, so all of them must answer.
    for (const provider of listProviders()) {
      assert.ok(
        ['free', 'local', 'paid', 'mixed'].includes(classifyProvider(provider)),
        `${provider.name} has no cost class`
      );
    }
  });
});

describe('F9: self-hosted model discovery', () => {
  test('F9: providers models vllm lists what the running server serves', async () => {
    const server = await startStubServer([]);
    try {
      setApiKey('vllm-endpoint', server.url);
      const output = await capture(() => showSelfHostedModels('vllm'));

      assert.match(output, /stub-model/, 'the served model id should be listed');
      assert.match(output, /-m stub-model/, 'the output should show how to select it');
    } finally {
      await server.close();
    }
  });

  test('F9: an unreachable server explains where the model name comes from', async () => {
    setApiKey('vllm-endpoint', 'http://127.0.0.1:1');
    const output = await capture(() => showSelfHostedModels('vllm'));

    assert.match(output, /no fixed model catalog/i);
    assert.match(output, /config set-endpoint vllm/);
    assert.doesNotMatch(output, /No models found/);
  });

  test('F9: only self-hosted providers take this path', async () => {
    assert.equal(isSelfHosted(getProvider('vllm')), true);
    assert.equal(isSelfHosted(getProvider('litellm')), true);
    assert.equal(isSelfHosted(getProvider('gguf')), true);
    assert.equal(isSelfHosted(getProvider('openai')), false);
    assert.equal(await showSelfHostedModels('openai'), false);
  });
});
