// Agent-loop regression tests, driven end-to-end against a scripted local
// OpenAI-compatible server (test/helpers/openai-stub.mjs) — no API key needed.
//
// Each `F<n>:` test below corresponds to a defect from the audit.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startStubServer } from './helpers/openai-stub.mjs';

// Redirect all persisted state before anything imports the config module, so
// these tests never read or clobber the real ~/.cude.
const home = mkdtempSync(join(tmpdir(), 'cude-home-'));
process.env.CUDE_HOME = home;

const { runAgent } = await import('../dist/core/agent.js');
const { setApiKey } = await import('../dist/config/index.js');
const { setTotalLimit, loadBudget, saveBudget } = await import('../dist/storage/budget.js');

/** Clears the total limit without depending on the F7 command surface. */
function clearTotalLimit() {
  const budget = loadBudget();
  delete budget.totalLimit;
  saveBudget(budget);
}

after(() => rmSync(home, { recursive: true, force: true }));

/** A tool call that always succeeds and mutates nothing. */
const readPkg = { name: 'read_file', arguments: { path: 'package.json' } };

/** Runs the agent against `script`, wired to the given provider. */
async function runAgainstStub(script, { provider = 'vllm', model = 'stub-model', ...options } = {}) {
  const server = await startStubServer(script);
  try {
    setApiKey(`${provider}-endpoint`, server.url);
    const result = await runAgent({
      task: 'do the thing',
      provider,
      model,
      maxIterations: 3,
      ...options,
    });
    return { result, server };
  } finally {
    await server.close();
  }
}

describe('F1: the agent must not report success when it failed', () => {
  test('F1: an agent that never finishes fails with stopReason max_iterations', async () => {
    // Every turn asks for another tool call, so the loop can only end by
    // exhausting --max-iterations. This used to return success: true.
    const { result } = await runAgainstStub([{ content: 'still working', toolCalls: [readPkg] }]);

    assert.equal(result.success, false, 'an exhausted loop must not report success');
    assert.equal(result.stopReason, 'max_iterations');
    assert.equal(result.iterations, 3);
  });

  test('F1: a completed agent reports success with stopReason completed', async () => {
    const { result } = await runAgainstStub([
      { content: 'looking at the file', toolCalls: [readPkg] },
      { content: 'TASK COMPLETE: read the manifest' },
    ]);

    assert.equal(result.success, true);
    assert.equal(result.stopReason, 'completed');
    assert.match(result.output, /TASK COMPLETE/);
  });

  test('F1: a budget-exceeded agent fails with stopReason budget_exceeded', async () => {
    // LiteLLM fronting a paid catalog model, so the budget gate applies (F6
    // deliberately exempts free/local providers).
    setTotalLimit(0);
    try {
      const { result } = await runAgainstStub([{ content: 'TASK COMPLETE: done' }], {
        provider: 'litellm',
        model: 'gpt-4o',
      });

      assert.equal(result.success, false);
      assert.equal(result.stopReason, 'budget_exceeded');
    } finally {
      clearTotalLimit();
    }
  });

  test('F1: a model that finishes with no output is not a success', async () => {
    const { result } = await runAgainstStub([{ content: '' }]);

    assert.equal(result.success, false);
    assert.equal(result.stopReason, 'empty_output');
  });
});
