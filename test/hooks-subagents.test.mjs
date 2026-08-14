import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadHooks, runHooks } from '../dist/core/hooks.js';
import { loadSubagents } from '../dist/core/subagents.js';

test('hooks load from project configuration and expose tool context', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cude-hooks-'));
  const previous = process.env.CUDE_HOOKS_FILE;
  const outputFile = join(directory, 'hook-output.txt');
  process.env.CUDE_HOOKS_FILE = join(directory, 'hooks.json');
  writeFileSync(process.env.CUDE_HOOKS_FILE, JSON.stringify({ hooks: {
    pre_tool_use: [{ command: `node -e "require('fs').writeFileSync('${outputFile.replaceAll('\\', '/')}', process.env.CUDE_TOOL_NAME)"` }],
  } }));
  try {
    assert.equal(loadHooks().pre_tool_use.length, 1);
    const result = await runHooks('pre_tool_use', { toolName: 'read_file' });
    assert.equal(result.blocked, false);
    assert.equal(readFileSync(outputFile, 'utf8'), 'read_file');
  } finally {
    if (previous === undefined) delete process.env.CUDE_HOOKS_FILE;
    else process.env.CUDE_HOOKS_FILE = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('named subagents discover Markdown definitions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cude-agents-'));
  const agentsDirectory = join(directory, '.cude', 'agents');
  mkdirSync(agentsDirectory, { recursive: true });
  writeFileSync(join(agentsDirectory, 'reviewer.md'), '---\nname: reviewer\ndescription: Reviews code\n---\nReview only correctness and security.');
  try {
    const agents = loadSubagents(directory);
    assert.deepEqual(agents.map(agent => agent.name), ['reviewer']);
    assert.match(agents[0].prompt, /correctness and security/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
