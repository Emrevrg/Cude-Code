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

describe('F3: truncated tool output says so', () => {
  test('F3: oversized tool output carries an explicit truncation marker', async () => {
    // package-lock.json is comfortably over the limit. The old code cut at 500
    // chars and said nothing, so the model could not tell a short result from a
    // clipped one.
    const { server } = await runAgainstStub([
      { content: 'reading a big file', toolCalls: [{ name: 'read_file', arguments: { path: 'package-lock.json' } }] },
      { content: 'TASK COMPLETE: done' },
    ]);

    const toolMessage = server.sentMessages()[1].find(m => m.role === 'tool');
    assert.match(
      toolMessage.content,
      /\.\.\. \[truncated, showed \d+ of \d+ chars\]/,
      'a clipped result must announce that it was clipped'
    );
    assert.ok(
      toolMessage.content.length > 4000,
      `the limit must be workable, got ${toolMessage.content.length} chars`
    );
  });

  test('F3: output within the limit is passed through untouched', async () => {
    const { server } = await runAgainstStub([
      { content: 'reading', toolCalls: [readPkg] },
      { content: 'TASK COMPLETE: done' },
    ]);

    const toolMessage = server.sentMessages()[1].find(m => m.role === 'tool');
    assert.doesNotMatch(toolMessage.content, /truncated/);
  });
});

describe('F2: tool results travel inside the tool-call protocol', () => {
  test('F2: the assistant message carries tool_calls and each result is a tool message with the matching tool_call_id', async () => {
    // Previously the loop appended "Tool Results: ..." into the assistant's own
    // message text, so the model never saw the arguments it had called with.
    const { server } = await runAgainstStub([
      { content: 'reading', toolCalls: [readPkg] },
      { content: 'TASK COMPLETE: done' },
    ]);

    const sent = server.sentMessages();
    assert.ok(sent.length >= 2, 'expected a follow-up request carrying the tool result');

    const second = sent[1];
    const assistant = second.find(m => m.role === 'assistant');
    assert.ok(assistant, 'the history must contain the assistant turn');
    assert.ok(Array.isArray(assistant.tool_calls), 'assistant message must carry tool_calls');
    assert.equal(assistant.tool_calls.length, 1);
    assert.equal(assistant.tool_calls[0].function.name, 'read_file');
    assert.deepEqual(
      JSON.parse(assistant.tool_calls[0].function.arguments),
      { path: 'package.json' },
      'the arguments the model chose must be visible to it on the next turn'
    );

    const toolMessages = second.filter(m => m.role === 'tool');
    assert.equal(toolMessages.length, 1, 'each call needs its own tool message');
    assert.equal(
      toolMessages[0].tool_call_id,
      assistant.tool_calls[0].id,
      'the result must be keyed by the id of the call it answers'
    );
    assert.match(toolMessages[0].content, /cude-code/, 'the tool message carries the result');
  });

  test('F2: no request contains two consecutive assistant messages, and none ends on one', async () => {
    const { server } = await runAgainstStub([
      { content: 'step one', toolCalls: [readPkg] },
      { content: 'step two', toolCalls: [readPkg] },
      { content: 'step three', toolCalls: [readPkg] },
    ]);

    const sent = server.sentMessages();
    assert.ok(sent.length >= 3, 'expected several turns');

    for (const [i, messages] of sent.entries()) {
      const roles = messages.map(m => m.role);
      for (let j = 1; j < roles.length; j++) {
        assert.ok(
          !(roles[j] === 'assistant' && roles[j - 1] === 'assistant'),
          `request ${i} has consecutive assistant messages: ${roles.join(', ')}`
        );
      }
      assert.notEqual(
        roles[roles.length - 1],
        'assistant',
        `request ${i} ends on an assistant message (Anthropic reads that as prefill): ${roles.join(', ')}`
      );
    }
  });

  test('F2: several calls in one turn each get their own tool message', async () => {
    const { server } = await runAgainstStub([
      {
        content: 'reading twice',
        toolCalls: [readPkg, { name: 'read_file', arguments: { path: 'tsconfig.json' } }],
      },
      { content: 'TASK COMPLETE: done' },
    ]);

    const second = server.sentMessages()[1];
    const assistant = second.find(m => m.role === 'assistant');
    const toolMessages = second.filter(m => m.role === 'tool');

    assert.equal(assistant.tool_calls.length, 2);
    assert.equal(toolMessages.length, 2);
    assert.deepEqual(
      toolMessages.map(m => m.tool_call_id).sort(),
      assistant.tool_calls.map(tc => tc.id).sort()
    );
  });
});
