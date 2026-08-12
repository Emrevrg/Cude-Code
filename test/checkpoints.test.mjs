// Checkpoints: agent file edits must be reversible.
//
// The workspace boundary (F5) stops the agent writing where it shouldn't. It
// does nothing about a wrong edit inside the boundary — that is what this is
// for.

import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startStubServer } from './helpers/openai-stub.mjs';

const home = mkdtempSync(join(tmpdir(), 'cude-home-'));
process.env.CUDE_HOME = home;

const {
  recordCheckpoint,
  loadCheckpoint,
  listCheckpoints,
  restoreCheckpoint,
  restoreRun,
  clearCheckpoints,
  MUTATING_TOOLS,
} = await import('../dist/core/checkpoints.js');
const { executeTool, setWorkspaceRoot, resetWorkspaceRoot, setConfirmCallback, clearConfirmCallback } =
  await import('../dist/core/tools.js');
const { runAgent } = await import('../dist/core/agent.js');
const { setApiKey } = await import('../dist/config/index.js');

let dir;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'cude-ckpt-'));
  setWorkspaceRoot(dir);
  setConfirmCallback(async () => true);
});
after(() => {
  resetWorkspaceRoot();
  clearConfirmCallback();
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

beforeEach(() => clearCheckpoints());

describe('checkpoints capture the state before a change', () => {
  test('an edit to an existing file is reversible', async () => {
    const file = join(dir, 'edit-me.txt');
    writeFileSync(file, 'original content');

    const checkpoint = recordCheckpoint('run1', 'a task', 'write_file', { path: file });
    await executeTool('write_file', { path: file, content: 'ruined' });
    assert.equal(readFileSync(file, 'utf-8'), 'ruined');

    const result = restoreCheckpoint(checkpoint);
    assert.deepEqual(result.restored, [file]);
    assert.equal(readFileSync(file, 'utf-8'), 'original content');
  });

  test('a file the agent created is removed on restore, not left behind', async () => {
    const file = join(dir, 'brand-new.txt');
    const checkpoint = recordCheckpoint('run2', 'a task', 'write_file', { path: file });
    await executeTool('write_file', { path: file, content: 'new' });
    assert.equal(existsSync(file), true);

    const result = restoreCheckpoint(checkpoint);
    assert.deepEqual(result.removed, [file]);
    assert.equal(existsSync(file), false, 'a created file must not survive the undo');
  });

  test('a delete is reversible', async () => {
    const file = join(dir, 'delete-me.txt');
    writeFileSync(file, 'do not lose me');

    const checkpoint = recordCheckpoint('run3', 'a task', 'delete_file', { path: file });
    await executeTool('delete_file', { path: file });
    assert.equal(existsSync(file), false);

    restoreCheckpoint(checkpoint);
    assert.equal(readFileSync(file, 'utf-8'), 'do not lose me');
  });

  test('move_file captures both ends', () => {
    const source = join(dir, 'from.txt');
    const dest = join(dir, 'to.txt');
    writeFileSync(source, 'moving');

    const checkpoint = recordCheckpoint('run4', 'a task', 'move_file', { source, destination: dest });
    assert.equal(checkpoint.files.length, 2, 'a move changes two paths');
    assert.ok(checkpoint.files.some(f => f.path === source && f.content === 'moving'));
    assert.ok(checkpoint.files.some(f => f.path === dest && f.content === null));
  });

  test('a read-only tool records nothing', () => {
    assert.equal(recordCheckpoint('run5', 'a task', 'read_file', { path: 'x' }), null);
    assert.equal(recordCheckpoint('run5', 'a task', 'grep_search', { pattern: 'x' }), null);
    assert.equal(recordCheckpoint('run5', 'a task', 'run_command', { command: 'ls' }), null);
  });

  test('every mutating file tool is covered', async () => {
    // A tool that changes files but is missing from MUTATING_TOOLS produces an
    // unreversible edit, silently.
    const { TOOL_DEFINITIONS } = await import('../dist/core/tools.js');
    const known = new Set(Object.keys(MUTATING_TOOLS));
    for (const name of ['write_file', 'replace_in_file', 'apply_patch', 'delete_file', 'move_file', 'copy_file']) {
      assert.ok(known.has(name), `${name} changes files but is not checkpointed`);
      assert.ok(TOOL_DEFINITIONS.some(t => t.name === name), `${name} is not a registered tool`);
    }
  });
});

describe('checkpoints undo a whole agent run', () => {
  test('restore-run puts back every file the run touched', async () => {
    const a = join(dir, 'run-a.txt');
    const b = join(dir, 'run-b.txt');
    writeFileSync(a, 'A before');
    writeFileSync(b, 'B before');

    const server = await startStubServer([
      { content: 'editing a', toolCalls: [{ name: 'write_file', arguments: { path: a, content: 'A after' } }] },
      { content: 'editing b', toolCalls: [{ name: 'write_file', arguments: { path: b, content: 'B after' } }] },
      { content: 'TASK COMPLETE: edited both' },
    ]);

    try {
      setApiKey('vllm-endpoint', server.url);
      const result = await runAgent({
        task: 'edit two files',
        provider: 'vllm',
        model: 'stub',
        maxIterations: 4,
      });

      assert.equal(result.success, true);
      assert.ok(result.runId, 'the run must expose an id to undo by');
      assert.equal(readFileSync(a, 'utf-8'), 'A after');
      assert.equal(readFileSync(b, 'utf-8'), 'B after');

      const checkpoints = listCheckpoints().filter(c => c.runId === result.runId);
      assert.equal(checkpoints.length, 2, 'one checkpoint per mutating call');

      restoreRun(result.runId);
      assert.equal(readFileSync(a, 'utf-8'), 'A before');
      assert.equal(readFileSync(b, 'utf-8'), 'B before');
    } finally {
      await server.close();
    }
  });

  test('a checkpoint survives a reload from disk', () => {
    const file = join(dir, 'persisted.txt');
    writeFileSync(file, 'persisted content');
    const checkpoint = recordCheckpoint('run6', 'a task', 'write_file', { path: file });

    const reloaded = loadCheckpoint(checkpoint.id);
    assert.equal(reloaded.files[0].content, 'persisted content');
    assert.equal(reloaded.toolName, 'write_file');
  });
});
