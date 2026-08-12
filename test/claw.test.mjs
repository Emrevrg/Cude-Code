// Cude Claw: the interactive agent session.
//
// The session object is driven directly here — the REPL around it is a thin
// readline shell, but everything that decides what happens to the user's files
// lives in ClawSession and is testable without a terminal.

import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startStubServer } from './helpers/openai-stub.mjs';

const home = mkdtempSync(join(tmpdir(), 'cude-home-'));
process.env.CUDE_HOME = home;

const { ClawSession } = await import('../dist/core/claw.js');
const { setWorkspaceRoot, resetWorkspaceRoot, setConfirmCallback, clearConfirmCallback } =
  await import('../dist/core/tools.js');
const { setApiKey } = await import('../dist/config/index.js');
const { listCheckpoints, restoreRun, clearCheckpoints } = await import('../dist/core/checkpoints.js');
const { renderDiff } = await import('../dist/ui/diff.js');

let dir;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'cude-claw-'));
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

/** A session wired to a scripted stub server. */
async function session(script, options = {}) {
  const server = await startStubServer(script);
  setApiKey('vllm-endpoint', server.url);
  return {
    server,
    session: new ClawSession({ provider: 'vllm', model: 'stub', autoApprove: true, ...options }),
  };
}

describe('claw keeps context between turns', () => {
  test('the second turn sees the first', async () => {
    const { server, session: claw } = await session([{ content: 'noted' }]);
    try {
      await claw.send('remember the number 41');
      await claw.send('what number?');

      const second = server.sentMessages()[1];
      const userTurns = second.filter(m => m.role === 'user');
      assert.equal(userTurns.length, 2, 'the earlier turn must still be in context');
      assert.match(userTurns[0].content, /41/);
      assert.equal(claw.turns, 2);
    } finally {
      await server.close();
    }
  });

  test('/clear forgets the conversation but keeps the cost tally', async () => {
    const { server, session: claw } = await session([{ content: 'ok' }]);
    try {
      await claw.send('first');
      const costAfterFirst = claw.totalCost;
      claw.clear();
      await claw.send('second');

      const second = server.sentMessages()[1];
      assert.equal(second.filter(m => m.role === 'user').length, 1, 'the conversation was not cleared');
      assert.equal(claw.turns, 2, 'the turn count is a session tally, not a conversation one');
      assert.equal(claw.totalCost >= costAfterFirst, true);
    } finally {
      await server.close();
    }
  });

  test('@file mentions are expanded into the message', async () => {
    const file = join(dir, 'mentioned.txt');
    writeFileSync(file, 'the contents of the mentioned file');

    const { server, session: claw } = await session([{ content: 'read it' }]);
    try {
      await claw.send(`explain @${file}`);
      const sent = server.sentMessages()[0].find(m => m.role === 'user');
      assert.match(sent.content, /the contents of the mentioned file/);
      assert.match(sent.content, /Referenced files/);
    } finally {
      await server.close();
    }
  });

  test('a missing @file says so instead of failing the turn', async () => {
    const { server, session: claw } = await session([{ content: 'ok' }]);
    try {
      const result = await claw.send('explain @definitely/not/here.txt');
      assert.equal(result.stopReason, 'completed');
      const sent = server.sentMessages()[0].find(m => m.role === 'user');
      assert.match(sent.content, /no such file/);
    } finally {
      await server.close();
    }
  });
});

describe('claw asks before it edits', () => {
  const editCall = (path, content) => ({ name: 'write_file', arguments: { path, content } });

  test('a declined edit is not applied, and the model is told', async () => {
    const file = join(dir, 'declined.txt');
    writeFileSync(file, 'original');

    const { server, session: claw } = await session(
      [
        { content: 'editing', toolCalls: [editCall(file, 'replaced')] },
        { content: 'TASK COMPLETE: you declined' },
      ],
      { autoApprove: false }
    );

    try {
      await claw.send('change the file', { onApproval: async () => 'no' });

      assert.equal(readFileSync(file, 'utf-8'), 'original', 'a declined edit was applied anyway');
      const toolMessage = server.sentMessages()[1].find(m => m.role === 'tool');
      assert.match(toolMessage.content, /declined/i);
      assert.match(toolMessage.content, /Do not retry/i, 'the model needs to know not to loop on it');
    } finally {
      await server.close();
    }
  });

  test('an approved edit is applied', async () => {
    const file = join(dir, 'approved.txt');
    writeFileSync(file, 'original');

    const { server, session: claw } = await session(
      [
        { content: 'editing', toolCalls: [editCall(file, 'replaced')] },
        { content: 'TASK COMPLETE: done' },
      ],
      { autoApprove: false }
    );

    try {
      await claw.send('change the file', { onApproval: async () => 'yes' });
      assert.equal(readFileSync(file, 'utf-8'), 'replaced');
    } finally {
      await server.close();
    }
  });

  test('"always" stops asking for that tool', async () => {
    const a = join(dir, 'always-a.txt');
    const b = join(dir, 'always-b.txt');

    const { server, session: claw } = await session(
      [
        { content: 'first', toolCalls: [editCall(a, 'A')] },
        { content: 'second', toolCalls: [editCall(b, 'B')] },
        { content: 'TASK COMPLETE: both written' },
      ],
      { autoApprove: false }
    );

    try {
      let asked = 0;
      await claw.send('write two files', {
        onApproval: async () => {
          asked++;
          return 'always';
        },
      });

      assert.equal(asked, 1, 'it kept asking after "always"');
      assert.equal(readFileSync(a, 'utf-8'), 'A');
      assert.equal(readFileSync(b, 'utf-8'), 'B');
    } finally {
      await server.close();
    }
  });

  test('stopping mid-turn still answers every tool call the model made', async () => {
    // Leaving a tool_call unanswered makes the next request malformed, which
    // the F2 invariant would reject.
    const file = join(dir, 'aborted.txt');

    const { server, session: claw } = await session(
      [{ content: 'editing', toolCalls: [editCall(file, 'nope')] }],
      { autoApprove: false }
    );

    try {
      const result = await claw.send('change it', { onApproval: async () => 'abort' });

      assert.equal(result.stopReason, 'aborted');
      assert.equal(existsSync(file), false, 'the edit happened despite the abort');

      const { validateTurnSequence } = await import('../dist/providers/wire.js');
      assert.equal(
        validateTurnSequence(claw.messages),
        null,
        'the conversation was left malformed after aborting'
      );
    } finally {
      await server.close();
    }
  });

  test('a read-only tool is not put through the approval prompt', async () => {
    const { server, session: claw } = await session(
      [
        { content: 'reading', toolCalls: [{ name: 'read_file', arguments: { path: 'package.json' } }] },
        { content: 'TASK COMPLETE: read it' },
      ],
      { autoApprove: false }
    );

    try {
      let asked = 0;
      await claw.send('read the manifest', { onApproval: async () => { asked++; return 'yes'; } });
      assert.equal(asked, 0, 'reads should not need approval');
    } finally {
      await server.close();
    }
  });
});

describe('claw records and undoes its own edits', () => {
  test('every applied edit is checkpointed under the session id', async () => {
    const file = join(dir, 'undoable.txt');
    writeFileSync(file, 'before claw');

    const { server, session: claw } = await session([
      { content: 'editing', toolCalls: [{ name: 'write_file', arguments: { path: file, content: 'after claw' } }] },
      { content: 'TASK COMPLETE: done' },
    ]);

    try {
      await claw.send('edit it');
      assert.equal(readFileSync(file, 'utf-8'), 'after claw');

      const mine = listCheckpoints().filter(c => c.runId === claw.runId);
      assert.equal(mine.length, 1);

      restoreRun(claw.runId);
      assert.equal(readFileSync(file, 'utf-8'), 'before claw');
    } finally {
      await server.close();
    }
  });
});

describe('claw respects modes mid-session', () => {
  test('switching to ask mode takes the write tools away', async () => {
    const { server, session: claw } = await session([{ content: 'ok' }]);
    try {
      claw.setMode('ask');
      assert.equal(claw.mode.name, 'ask');

      const file = join(dir, 'not-in-ask-mode.txt');
      const scripted = await startStubServer([
        { content: 'trying', toolCalls: [{ name: 'write_file', arguments: { path: file, content: 'x' } }] },
        { content: 'TASK COMPLETE: refused' },
      ]);
      try {
        setApiKey('vllm-endpoint', scripted.url);
        const asker = new ClawSession({ provider: 'vllm', model: 'stub', mode: 'ask', autoApprove: true });
        await asker.send('write a file');

        const toolMessage = scripted.sentMessages()[1].find(m => m.role === 'tool');
        assert.match(toolMessage.content, /not available in Ask mode/);
        assert.equal(existsSync(file), false);
      } finally {
        await scripted.close();
      }
    } finally {
      await server.close();
    }
  });
});

describe('diff rendering for the approval prompt', () => {
  test('a changed line shows as a removal and an addition', () => {
    const diff = renderDiff('one\ntwo\nthree\n', 'one\nTWO\nthree\n');
    assert.equal(diff.added, 1);
    assert.equal(diff.removed, 1);
    assert.match(diff.text, /-two/);
    assert.match(diff.text, /\+TWO/);
  });

  test('a new file is all additions', () => {
    const diff = renderDiff('', 'line one\nline two');
    assert.equal(diff.removed, 0);
    assert.equal(diff.added, 2);
  });

  test('identical content reports no change', () => {
    const diff = renderDiff('same\ncontent', 'same\ncontent');
    assert.equal(diff.added, 0);
    assert.equal(diff.removed, 0);
    assert.match(diff.text, /no change/);
  });

  test('a very large change is capped rather than flooding the terminal', () => {
    const big = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
    const diff = renderDiff('', big, 10);
    assert.ok(diff.text.split('\n').length < 20, 'the preview was not capped');
    assert.match(diff.text, /more changed lines/);
  });
});
