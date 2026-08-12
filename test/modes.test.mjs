// Agent modes and project rules.
//
// The point of a mode is its tool budget, so these tests care most about what
// each mode is *prevented* from doing — a restriction that exists only in the
// system prompt is not a restriction.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startStubServer } from './helpers/openai-stub.mjs';

const home = mkdtempSync(join(tmpdir(), 'cude-home-'));
process.env.CUDE_HOME = home;

const { getMode, listModes, toolsForMode, checkToolCall, isToolAllowed } =
  await import('../dist/core/modes.js');
const { findRuleFiles, buildRulesPrompt } = await import('../dist/core/rules.js');
const { setWorkspaceRoot, resetWorkspaceRoot } = await import('../dist/core/tools.js');
const { runAgent, buildSystemPrompt } = await import('../dist/core/agent.js');
const { setApiKey } = await import('../dist/config/index.js');

let dir;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'cude-modes-'));
  setWorkspaceRoot(dir);
});
after(() => {
  resetWorkspaceRoot();
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe('modes: tool budgets are enforced, not just described', () => {
  test('ask mode cannot reach any mutating tool', () => {
    const ask = getMode('ask');
    for (const tool of ['write_file', 'delete_file', 'run_command', 'apply_patch', 'move_file', 'npm_command']) {
      assert.equal(isToolAllowed(ask, tool), false, `ask mode should not allow ${tool}`);
      assert.match(checkToolCall(ask, tool, { path: 'x.ts' }), /not available in Ask mode/);
    }
    assert.equal(checkToolCall(ask, 'read_file', { path: 'x.ts' }), null);
  });

  test('the restricted tool list is what the model is shown', () => {
    const askTools = toolsForMode(getMode('ask')).map(t => t.name);
    assert.ok(!askTools.includes('write_file'));
    assert.ok(askTools.includes('read_file'));
    assert.ok(toolsForMode(getMode('code')).length > askTools.length);
  });

  test('architect mode writes Markdown and refuses source files', () => {
    const architect = getMode('architect');
    assert.equal(checkToolCall(architect, 'write_file', { path: 'docs/plan.md' }), null);
    assert.match(
      checkToolCall(architect, 'write_file', { path: 'src/index.ts' }),
      /may only write files matching/
    );
    // Every other route to a source file is closed off by the tool budget.
    for (const tool of ['replace_in_file', 'apply_patch', 'move_file', 'delete_file', 'run_command']) {
      assert.ok(
        checkToolCall(architect, tool, { path: 'src/index.ts', destination: 'src/index.ts' }),
        `architect mode should refuse ${tool}`
      );
    }
  });

  test('every mode declares a prompt, a description and a tool budget', () => {
    for (const mode of listModes()) {
      assert.ok(mode.systemPrompt.length > 40, `${mode.name}: thin system prompt`);
      assert.ok(mode.description, `${mode.name}: missing description`);
      assert.ok(toolsForMode(mode).length > 0, `${mode.name}: no tools at all`);
    }
  });

  test('an unknown mode names the valid ones', () => {
    assert.throws(() => getMode('nonsense'), /Unknown mode.*code/s);
  });

  test('regression: a blocked call is refused at execution, not just omitted', async () => {
    // A model can ask for a tool that was never offered to it. Ask mode must
    // refuse the call rather than run it.
    const server = await startStubServer([
      { content: 'writing', toolCalls: [{ name: 'write_file', arguments: { path: join(dir, 'sneaky.txt'), content: 'x' } }] },
      { content: 'TASK COMPLETE: could not write' },
    ]);
    try {
      setApiKey('vllm-endpoint', server.url);
      await runAgent({ task: 'try to write', provider: 'vllm', model: 'stub', mode: 'ask', maxIterations: 2 });

      const toolMessage = server.sentMessages()[1].find(m => m.role === 'tool');
      assert.match(toolMessage.content, /not available in Ask mode/);
      assert.equal(
        (await import('node:fs')).existsSync(join(dir, 'sneaky.txt')),
        false,
        'ask mode wrote a file'
      );
    } finally {
      await server.close();
    }
  });
});

describe('rules: repository instructions reach the system prompt', () => {
  test('AGENTS.md is discovered and included', () => {
    writeFileSync(join(dir, 'AGENTS.md'), '# House rules\nAlways use tabs.');
    const files = findRuleFiles(dir);
    assert.ok(files.some(f => f.path.endsWith('AGENTS.md')), 'AGENTS.md was not found');
    assert.match(buildRulesPrompt(findRuleFiles(dir)), /Always use tabs/);
  });

  test('.cude/rules/*.md files are included in sorted order', () => {
    mkdirSync(join(dir, '.cude', 'rules'), { recursive: true });
    writeFileSync(join(dir, '.cude', 'rules', '20-second.md'), 'second rule');
    writeFileSync(join(dir, '.cude', 'rules', '10-first.md'), 'first rule');

    const prompt = buildRulesPrompt(findRuleFiles(dir));
    assert.ok(prompt.indexOf('first rule') < prompt.indexOf('second rule'), 'rules are not sorted');
  });

  test('rules are appended to the agent system prompt', () => {
    const prompt = buildSystemPrompt(getMode('code'));
    assert.match(prompt, /Project rules/);
    assert.match(prompt, /Always use tabs/);
    assert.match(prompt, /You are in Code mode/, 'the mode prompt must still be there');
  });

  test('no rule files means no rules block', () => {
    const empty = mkdtempSync(join(tmpdir(), 'cude-norules-'));
    try {
      // A parent directory could still carry rules; assert on the explicit list.
      assert.equal(buildRulesPrompt([]), '');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
