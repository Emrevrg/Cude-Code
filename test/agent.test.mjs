// Agent-level regression tests for defects F1–F6.
//
// A tiny local OpenAI-compatible server (test/helpers/stub-server.mjs) stands
// in for a real provider so the agent loop runs with no API key and no network.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startStubServer, hasConsecutiveAssistants, rolesOf } from './helpers/stub-server.mjs';

const { runAgent } = await import('../dist/core/agent.js');

const ENDPOINT_ENV = 'CUDE_VLLM-ENDPOINT_KEY';

let dir;
let stub;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cude-agent-'));
  stub = await startStubServer([
    { content: 'Thinking about the task.', tool_calls: [{ name: 'write_file', arguments: { path: join(dir, 'out.txt'), content: 'hello' } }] },
    { content: 'Thinking again.', tool_calls: [{ name: 'write_file', arguments: { path: join(dir, 'out2.txt'), content: 'world' } }] },
    { content: 'Thinking again.', tool_calls: [{ name: 'write_file', arguments: { path: join(dir, 'out3.txt'), content: '!' } }] },
  ]);
  process.env[ENDPOINT_ENV] = `http://127.0.0.1:${stub.port}`;
  const { resetSpending } = await import('../dist/storage/budget.js');
  resetSpending();
});

after(async () => {
  await stub.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('F1 — agent reports failure correctly', () => {
  test('F1: a never-finishing agent returns success=false with stopReason=max_iterations', async () => {
    process.env[ENDPOINT_ENV] = `http://127.0.0.1:${stub.port}`;
    const { resetSpending } = await import('../dist/storage/budget.js');
    resetSpending();

    const result = await runAgent({
      task: 'do something that never completes',
      provider: 'vllm',
      model: 'stub-model',
      maxIterations: 3,
    });

    assert.equal(result.success, false, 'should be unsuccessful');
    assert.equal(result.stopReason, 'max_iterations');
    assert.equal(result.iterations, 3);
  });

  test('F1: a budget-exceeded agent returns success=false with stopReason=budget_exceeded', async () => {
    const doneStub = await startStubServer(['TASK COMPLETE: I did it']);
    process.env[ENDPOINT_ENV] = `http://127.0.0.1:${doneStub.port}`;
    try {
      const { setTotalLimit, resetSpending, loadBudget, saveBudget } = await import('../dist/storage/budget.js');
      resetSpending();
      setTotalLimit(0);

      const result = await runAgent({
        task: 'complete this',
        provider: 'vllm',
        model: 'stub-model',
        maxIterations: 5,
      });

      assert.equal(result.success, false);
      assert.equal(result.stopReason, 'budget_exceeded');

      const b = loadBudget();
      b.totalLimit = undefined;
      saveBudget(b);
    } finally {
      await doneStub.close();
      process.env[ENDPOINT_ENV] = `http://127.0.0.1:${stub.port}`;
    }
  });

  test('F1: a completed agent returns success=true with stopReason=completed', async () => {
    const doneStub = await startStubServer([
      { content: 'Let me write a file.', tool_calls: [{ name: 'write_file', arguments: { path: join(dir, 'done.txt'), content: 'done' } }] },
      'TASK COMPLETE: I wrote the file',
    ]);
    const prev = process.env[ENDPOINT_ENV];
    process.env[ENDPOINT_ENV] = `http://127.0.0.1:${doneStub.port}`;
    try {
      const { resetSpending } = await import('../dist/storage/budget.js');
      resetSpending();
      const result = await runAgent({
        task: 'write a file',
        provider: 'vllm',
        model: 'stub-model',
        maxIterations: 5,
      });

      assert.equal(result.success, true);
      assert.equal(result.stopReason, 'completed');
      assert.match(result.output, /TASK COMPLETE/);
      assert.ok(existsSync(join(dir, 'done.txt')), 'tool actually ran');
    } finally {
      await doneStub.close();
      process.env[ENDPOINT_ENV] = prev;
    }
  });
});

describe('F2 — tool results travel through the tool-call protocol', () => {
  test('F2: the assistant message carries tool_calls and each result is a role:tool message with the matching tool_call_id', async () => {
    process.env[ENDPOINT_ENV] = `http://127.0.0.1:${stub.port}`;
    const { resetSpending } = await import('../dist/storage/budget.js');
    resetSpending();

    const result = await runAgent({
      task: 'use a tool',
      provider: 'vllm',
      model: 'stub-model',
      maxIterations: 2,
    });

    // After a tool round-trip the agent issues a second request whose message
    // history must include the prior assistant tool_calls and the role:'tool'
    // reply keyed by tool_call_id.
    assert.ok(stub.requests.length >= 2, 'expected at least two requests (one per iteration)');
    const last = stub.requests[stub.requests.length - 1];
    const msgs = last.body.messages;

    const assistantWithTools = [...msgs].reverse().find((m) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0);
    assert.ok(assistantWithTools, 'an assistant message must carry tool_calls');

    const toolMessages = msgs.filter((m) => m.role === 'tool');
    assert.ok(toolMessages.length > 0, 'at least one role:tool message must be present');
    for (const tm of toolMessages) {
      assert.ok(tm.tool_call_id, 'every tool message must carry a tool_call_id');
      assert.ok(
        assistantWithTools.tool_calls.some((tc) => tc.id === tm.tool_call_id),
        `tool message tool_call_id "${tm.tool_call_id}" does not match any assistant tool_call`
      );
    }
  });

  test('F2: no outbound request ever contains two consecutive assistant messages', async () => {
    process.env[ENDPOINT_ENV] = `http://127.0.0.1:${stub.port}`;
    const { resetSpending } = await import('../dist/storage/budget.js');
    resetSpending();

    await runAgent({
      task: 'keep using tools',
      provider: 'vllm',
      model: 'stub-model',
      maxIterations: 3,
    });

    assert.ok(stub.requests.length > 0, 'expected requests');
    for (const req of stub.requests) {
      assert.equal(
        hasConsecutiveAssistants(req),
        false,
        'a request contained two consecutive assistant messages'
      );
      // Invariant: never ends on an assistant message before a request is sent
      const roles = rolesOf(req);
      assert.notEqual(roles[roles.length - 1], 'assistant', 'request must not end on an assistant message');
    }
  });
});
