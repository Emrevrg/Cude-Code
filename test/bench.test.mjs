// The benchmark harness (B1–B6) and the agent optimizations it exists to
// measure (O1–O5).
//
// The end-to-end tests drive the *real* agent loop against the scripted local
// server in test/helpers/openai-stub.mjs, so the harness is exercised the way
// a real run would exercise it — sandbox, tool calls, grading and all — with
// no API key and no network.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startStubServer } from './helpers/openai-stub.mjs';

const home = mkdtempSync(join(tmpdir(), 'cude-bench-home-'));
process.env.CUDE_HOME = home;

const { evaluate, summarize, runTask, runSuite } = await import('../dist/bench/runner.js');
const { LOCAL_SUITE, localSuite } = await import('../dist/bench/suites/local.js');
const { loadSweBenchDataset, sweBenchTasks, toPredictionsJsonl } = await import('../dist/bench/adapters/swebench.js');
const { readInstruction } = await import('../dist/bench/adapters/terminalbench.js');
const { toMarkdown } = await import('../dist/bench/report.js');
const { setApiKey } = await import('../dist/config/index.js');

const { compactConversation, estimateConversationTokens } = await import('../dist/core/context.js');
const { resolveToolName, repairToolCall, parseLooseJson, editDistance } = await import('../dist/core/repair.js');
const { canRunInParallel } = await import('../dist/core/agent.js');
const { applyUnifiedDiff, parseUnifiedDiff } = await import('../dist/core/tools.js');
const { backoffMs } = await import('../dist/providers/net.js');

let scratch;

before(() => {
  scratch = mkdtempSync(join(tmpdir(), 'cude-bench-scratch-'));
});

after(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

// ─── Harness ────────────────────────────────────────────────────────────────

describe('B1: grading is independent of the agent', () => {
  test('B1: a command verifier passes on exit 0 and fails otherwise', () => {
    const dir = mkdtempSync(join(scratch, 'v-'));
    writeFileSync(join(dir, 'ok.mjs'), 'process.exit(0);\n');
    writeFileSync(join(dir, 'bad.mjs'), 'process.exit(3);\n');

    assert.equal(evaluate({ kind: 'command', command: 'node ok.mjs' }, dir).passed, true);

    const failed = evaluate({ kind: 'command', command: 'node bad.mjs' }, dir);
    assert.equal(failed.passed, false);
    assert.match(failed.detail, /exited 3/);
  });

  test('B1: file verifiers check what is on disk', () => {
    const dir = mkdtempSync(join(scratch, 'f-'));
    writeFileSync(join(dir, 'API.md'), '# API\n\ncreateQueue(limit)\n');

    assert.equal(evaluate({ kind: 'file_exists', path: 'API.md' }, dir).passed, true);
    assert.equal(evaluate({ kind: 'file_exists', path: 'nope.md' }, dir).passed, false);
    assert.equal(evaluate({ kind: 'file_absent', path: 'nope.md' }, dir).passed, true);
    assert.equal(evaluate({ kind: 'file_matches', path: 'API.md', pattern: 'createQueue' }, dir).passed, true);
    assert.equal(evaluate({ kind: 'file_matches', path: 'API.md', pattern: 'dequeue' }, dir).passed, false);
  });

  test('B1: "all" fails on the first failing child and reports which', () => {
    const dir = mkdtempSync(join(scratch, 'a-'));
    writeFileSync(join(dir, 'x.txt'), 'hello');

    const outcome = evaluate(
      { kind: 'all', of: [{ kind: 'file_exists', path: 'x.txt' }, { kind: 'file_exists', path: 'y.txt' }] },
      dir
    );
    assert.equal(outcome.passed, false);
    assert.match(outcome.detail, /y\.txt/);
  });

  test('B1: deleting the test file cannot pass a graded task', () => {
    // Every local task grades by restoring its own test file first.
    const dir = mkdtempSync(join(scratch, 'restore-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
    mkdirSync(join(dir, 'test'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    writeFileSync(join(dir, 'src', 'fizzbuzz.mjs'), 'export const fizzbuzz = () => "wrong";\n');
    // The agent "cheats" by never creating the test file at all.

    const task = LOCAL_SUITE.find(t => t.id === 'local/implement-fizzbuzz');
    const outcome = evaluate(task.verify, dir);
    assert.equal(outcome.passed, false, 'a wrong implementation passed');
    assert.ok(existsSync(join(dir, 'test', 'fizzbuzz.test.mjs')), 'the grader must restore the test file');
  });
});

describe('B2: the local suite is well formed', () => {
  test('B2: every task has an id, a prompt and a verifier', () => {
    const seen = new Set();
    for (const task of LOCAL_SUITE) {
      assert.ok(task.id, 'task without an id');
      assert.ok(!seen.has(task.id), `duplicate task id: ${task.id}`);
      seen.add(task.id);
      assert.ok(task.prompt.length > 40, `${task.id}: prompt is too thin to be a task`);
      assert.ok(task.verify, `${task.id}: no verifier`);
      assert.equal(task.suite, 'local');
    }
  });

  test('B2: every fixture task starts out failing', () => {
    // A task whose verifier passes before the agent runs measures nothing.
    for (const task of LOCAL_SUITE) {
      const dir = mkdtempSync(join(scratch, 'pre-'));
      for (const [path, content] of Object.entries(task.files ?? {})) {
        const target = join(dir, path);
        mkdirSync(join(target, '..'), { recursive: true });
        writeFileSync(target, content);
      }
      assert.equal(evaluate(task.verify, dir).passed, false, `${task.id} passes with no work done`);
    }
  });

  test('B2: the filter selects by id and by tag', () => {
    assert.ok(localSuite('fizzbuzz').length === 1);
    assert.ok(localSuite('debug').length >= 2);
    assert.equal(localSuite('nothing-matches-this').length, 0);
  });
});

describe('B3: SWE-bench adapter', () => {
  test('B3: JSONL, JSON array and wrapped datasets all load', () => {
    const instance = {
      instance_id: 'django__django-11099',
      repo: 'django/django',
      base_commit: 'abc123',
      problem_statement: 'UsernameValidator allows trailing newline.',
    };

    const jsonl = join(scratch, 'd.jsonl');
    writeFileSync(jsonl, JSON.stringify(instance) + '\n' + JSON.stringify({ ...instance, instance_id: 'x__y-2' }));
    assert.equal(loadSweBenchDataset(jsonl).length, 2);

    const array = join(scratch, 'd.json');
    writeFileSync(array, JSON.stringify([instance]));
    assert.equal(loadSweBenchDataset(array).length, 1);
  });

  test('B3: a missing dataset explains where to get it', () => {
    assert.throws(() => loadSweBenchDataset(join(scratch, 'absent.jsonl')), /huggingface|download/i);
  });

  test('B3: an instance becomes a task that checks out the right commit', () => {
    const [task] = sweBenchTasks([{
      instance_id: 'django__django-11099',
      repo: 'django/django',
      base_commit: 'deadbeef',
      problem_statement: 'The validator is wrong.',
    }]);

    assert.equal(task.id, 'django__django-11099');
    assert.match(task.prompt, /The validator is wrong\./);
    assert.match(task.prompt, /Do not modify tests/);
    assert.ok(task.setup.some(c => c.includes('deadbeef')), 'the base commit is never checked out');
    assert.equal(task.meta.collectPatch, true);
  });

  test('B3: predictions come out in the format the official evaluator reads', () => {
    const jsonl = toPredictionsJsonl(
      [
        { taskId: 'a__b-1', patch: 'diff --git a/x b/x\n', meta: { instance_id: 'a__b-1' } },
        { taskId: 'a__b-2', patch: '   ', meta: { instance_id: 'a__b-2' } },
      ],
      'cude-code-0.1.0/stub-model'
    );

    const lines = jsonl.split('\n').filter(Boolean).map(JSON.parse);
    assert.equal(lines.length, 1, 'an empty patch must not be submitted as a prediction');
    assert.deepEqual(Object.keys(lines[0]).sort(), ['instance_id', 'model_name_or_path', 'model_patch']);
  });
});

describe('B4: Terminal-Bench adapter', () => {
  test('B4: a block-scalar instruction is read', () => {
    const yaml = [
      'descriptions:',
      '  - key: base',
      'instruction: |',
      '  Build the project and make the failing test pass.',
      '  Do not touch the test file.',
      'max_agent_timeout_sec: 600',
    ].join('\n');

    const instruction = readInstruction(yaml);
    assert.match(instruction, /Build the project/);
    assert.match(instruction, /Do not touch the test file\./);
    assert.ok(!instruction.includes('max_agent_timeout_sec'), 'the block scalar ran past its end');
  });

  test('B4: a single-line instruction is read, quoted or bare', () => {
    assert.equal(readInstruction('instruction: "Fix the build"'), 'Fix the build');
    assert.equal(readInstruction('instruction: Fix the build'), 'Fix the build');
    assert.equal(readInstruction('other: value'), null);
  });
});

describe('B5: reports state what they are', () => {
  const run = {
    suite: 'local',
    provenance: 'local',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:10:00.000Z',
    provider: 'vllm',
    model: 'stub-model',
    mode: 'code',
    version: '0.1.0',
    results: [
      { taskId: 'local/a', suite: 'local', passed: true, stopReason: 'completed', iterations: 2, durationMs: 1200, cost: 0, inputTokens: 10, outputTokens: 5 },
      { taskId: 'local/b', suite: 'local', passed: false, detail: 'assert failed', stopReason: 'max_iterations', iterations: 5, durationMs: 4000, cost: 0, inputTokens: 20, outputTokens: 8 },
    ],
    summary: summarize([
      { taskId: 'local/a', passed: true, durationMs: 1200, cost: 0, iterations: 2 },
      { taskId: 'local/b', passed: false, durationMs: 4000, cost: 0, iterations: 5 },
    ]),
    caveat: 'not comparable to any published leaderboard',
  };

  test('B5: the pass rate is computed from the results', () => {
    assert.equal(run.summary.total, 2);
    assert.equal(run.summary.passed, 1);
    assert.equal(run.summary.passRate, 0.5);
  });

  test('B5: a non-official run carries its caveat in the markdown', () => {
    const markdown = toMarkdown(run);
    assert.match(markdown, /1\/2 passed \(50\.0%\)/);
    assert.match(markdown, /LOCAL RUN/);
    assert.match(markdown, /not comparable to any published leaderboard/);
    assert.match(markdown, /assert failed/);
  });

  test('B5: an official run carries no caveat', () => {
    const markdown = toMarkdown({ ...run, provenance: 'official', caveat: undefined });
    assert.ok(!markdown.includes('RUN.'), 'an official report should not warn about itself');
    assert.match(markdown, /official evaluator/);
  });
});

describe('B6: end-to-end — the harness runs the real agent and grades it', () => {
  /** Points a provider at a scripted stub server for the duration of `fn`. */
  async function withStub(script, fn) {
    const server = await startStubServer(script);
    try {
      setApiKey('vllm-endpoint', server.url);
      return await fn(server);
    } finally {
      await server.close();
    }
  }

  const FIZZBUZZ = `export function fizzbuzz(n) {
  if (n % 15 === 0) return 'FizzBuzz';
  if (n % 3 === 0) return 'Fizz';
  if (n % 5 === 0) return 'Buzz';
  return String(n);
}
`;

  test('B6: a task the agent solves is graded as a pass', async () => {
    const task = LOCAL_SUITE.find(t => t.id === 'local/implement-fizzbuzz');

    const result = await withStub(
      [
        { content: 'Writing the implementation.', toolCalls: [{ name: 'write_file', arguments: { path: 'src/fizzbuzz.mjs', content: FIZZBUZZ } }] },
        { content: 'TASK COMPLETE: implemented fizzbuzz' },
      ],
      () => runTask(task, { provider: 'vllm', model: 'stub-model', maxIterations: 4 })
    );

    assert.equal(result.passed, true, `graded as a failure: ${result.detail}`);
    assert.equal(result.stopReason, 'completed');
    assert.ok(result.telemetry.toolCalls >= 1);
  });

  test('B6: a task the agent does not solve is graded as a failure', async () => {
    const task = LOCAL_SUITE.find(t => t.id === 'local/implement-fizzbuzz');

    const result = await withStub(
      [
        { content: 'Writing something wrong.', toolCalls: [{ name: 'write_file', arguments: { path: 'src/fizzbuzz.mjs', content: 'export const fizzbuzz = () => "nope";\n' } }] },
        { content: 'TASK COMPLETE: done (it is not)' },
      ],
      () => runTask(task, { provider: 'vllm', model: 'stub-model', maxIterations: 4 })
    );

    assert.equal(result.passed, false, 'the model\'s own claim of success was believed');
    assert.match(result.detail, /node --test/);
  });

  test('B6: the sandbox is disposable and nothing escapes it', async () => {
    const task = {
      id: 'sandbox-probe',
      suite: 'local',
      prompt: 'write a file outside the workspace',
      files: { 'inside.txt': 'here' },
      verify: { kind: 'file_exists', path: 'inside.txt' },
    };
    const escapee = join(tmpdir(), 'cude-bench-escape.txt');
    rmSync(escapee, { force: true });

    const result = await withStub(
      [
        { content: 'trying', toolCalls: [{ name: 'write_file', arguments: { path: escapee, content: 'escaped' } }] },
        { content: 'TASK COMPLETE: tried' },
      ],
      () => runTask(task, { provider: 'vllm', model: 'stub-model', maxIterations: 3 })
    );

    assert.equal(existsSync(escapee), false, 'a task wrote outside its sandbox');
    assert.equal(result.passed, true);
  });

  test('B6: runSuite aggregates and labels the run', async () => {
    const task = LOCAL_SUITE.find(t => t.id === 'local/implement-fizzbuzz');

    const run = await withStub(
      [
        { content: 'Writing.', toolCalls: [{ name: 'write_file', arguments: { path: 'src/fizzbuzz.mjs', content: FIZZBUZZ } }] },
        { content: 'TASK COMPLETE: done' },
      ],
      () => runSuite('local', [task], 'local', { provider: 'vllm', model: 'stub-model', maxIterations: 4 })
    );

    assert.equal(run.summary.passed, 1);
    assert.equal(run.provenance, 'local');
    assert.ok(run.caveat, 'a local run must carry its caveat');
    assert.ok(run.results[0].telemetry, 'telemetry is what makes a run diagnosable');
  });
});

// ─── Agent optimizations ────────────────────────────────────────────────────

describe('O1: context compaction keeps a long run alive', () => {
  /** A conversation of `turns` tool calls, each with a large result. */
  function longConversation(turns, resultSize = 4000) {
    const messages = [{ role: 'user', content: 'do the thing' }];
    for (let i = 0; i < turns; i++) {
      messages.push({
        role: 'assistant',
        content: `step ${i}`,
        tool_calls: [{ id: `c${i}`, name: 'read_file', arguments: { path: `f${i}.ts` } }],
      });
      messages.push({ role: 'tool', tool_call_id: `c${i}`, name: 'read_file', content: 'x'.repeat(resultSize) });
    }
    return messages;
  }

  test('O1: an oversized conversation is brought under budget', () => {
    const messages = longConversation(20);
    const before = estimateConversationTokens(messages);
    const result = compactConversation(messages, { budgetTokens: 2000 });

    assert.ok(before > 2000, 'fixture is not large enough to test compaction');
    assert.equal(result.compacted, true);
    assert.ok(result.tokensAfter < before, 'compaction did not shrink anything');
    assert.ok(result.tokensAfter <= 2000 || result.droppedGroups > 0);
  });

  test('O1: a conversation inside the budget is returned untouched', () => {
    const messages = longConversation(2, 50);
    const result = compactConversation(messages, { budgetTokens: 100000 });
    assert.equal(result.compacted, false);
    assert.equal(result.messages, messages, 'the array should not even be copied');
  });

  test('O1: the task and the most recent steps always survive', () => {
    const result = compactConversation(longConversation(20), { budgetTokens: 500 });
    assert.equal(result.messages[0].role, 'user');
    assert.match(result.messages[0].content, /do the thing/);

    const last = result.messages[result.messages.length - 1];
    assert.equal(last.role, 'tool');
    assert.equal(last.content, 'x'.repeat(4000), 'the newest result must not be digested');
  });

  test('O1: compaction never orphans a tool result', async () => {
    // The invariant the provider layer enforces: every tool message must answer
    // a call that is still in the conversation.
    const { validateTurnSequence } = await import('../dist/providers/wire.js');
    for (const budget of [200, 800, 2000, 8000]) {
      const result = compactConversation(longConversation(25), { budgetTokens: budget });
      assert.equal(
        validateTurnSequence(result.messages),
        null,
        `compaction at budget ${budget} produced a malformed conversation`
      );
    }
  });

  test('O1: dropped steps leave a note so the model does not redo them', () => {
    const result = compactConversation(longConversation(30), { budgetTokens: 400 });
    assert.ok(result.droppedGroups > 0);
    assert.ok(
      result.messages.some(m => m.content.includes('[cude-context]')),
      'no note was left where the work was dropped'
    );
  });
});

describe('O2: tool-call repair turns a wasted step into a working one', () => {
  const tools = [
    { name: 'write_file', description: '', parameters: { properties: { path: {}, content: {} }, required: ['path', 'content'] } },
    { name: 'read_file', description: '', parameters: { properties: { path: {} }, required: ['path'] } },
    { name: 'run_command', description: '', parameters: { properties: { command: {}, cwd: {} }, required: ['command'] } },
  ];
  const known = tools.map(t => t.name);

  test('O2: casing and punctuation differences resolve', () => {
    assert.equal(resolveToolName('writeFile', known), 'write_file');
    assert.equal(resolveToolName('write-file', known), 'write_file');
    assert.equal(resolveToolName('WRITE_FILE', known), 'write_file');
  });

  test('O2: names from other agents resolve to Cude\'s', () => {
    assert.equal(resolveToolName('bash', known), 'run_command');
    assert.equal(resolveToolName('str_replace_editor', ['replace_in_file']), 'replace_in_file');
    assert.equal(resolveToolName('view', known), 'read_file');
  });

  test('O2: a typo resolves; something genuinely unknown does not', () => {
    assert.equal(resolveToolName('write_fil', known), 'write_file');
    assert.equal(resolveToolName('summon_daemon', known), null);
  });

  test('O2: argument aliases are mapped and reported', () => {
    const { call, repairs } = repairToolCall(
      { id: '1', name: 'write_file', arguments: { file_path: 'a.ts', contents: 'x' } },
      tools
    );
    assert.deepEqual(call.arguments, { path: 'a.ts', content: 'x' });
    assert.equal(repairs.length, 2, 'every repair must be reported, not silently applied');
  });

  test('O2: a correct call is passed through unchanged', () => {
    const { call, repairs } = repairToolCall(
      { id: '1', name: 'read_file', arguments: { path: 'a.ts' } },
      tools
    );
    assert.deepEqual(call.arguments, { path: 'a.ts' });
    assert.equal(repairs.length, 0);
  });

  test('O2: fenced and trailing-comma JSON still parses', () => {
    assert.deepEqual(parseLooseJson('```json\n{"path": "a.ts"}\n```'), { path: 'a.ts' });
    assert.deepEqual(parseLooseJson('Here you go: {"path": "a.ts"}'), { path: 'a.ts' });
    assert.deepEqual(parseLooseJson('{"path": "a.ts",}'), { path: 'a.ts' });
    assert.equal(parseLooseJson('not json at all'), null);
  });

  test('O2: edit distance is bounded so unrelated names never match', () => {
    assert.equal(editDistance('a', 'a'), 0);
    assert.equal(editDistance('read_file', 'read_fil'), 1);
    assert.ok(editDistance('read', 'run_command_with_a_long_name') > 4);
  });

  test('O2: the agent recovers from a misnamed tool inside a real run', async () => {
    const server = await startStubServer([
      // `writeFile` is not a tool Cude has. Before repair this cost an
      // iteration and an apology; now it lands.
      { content: 'writing', toolCalls: [{ name: 'writeFile', arguments: { file_path: 'out.txt', contents: 'hello' } }] },
      { content: 'TASK COMPLETE: written' },
    ]);
    try {
      setApiKey('vllm-endpoint', server.url);
      const result = await runTask(
        {
          id: 'repair-probe',
          suite: 'local',
          prompt: 'write hello into out.txt',
          verify: { kind: 'file_matches', path: 'out.txt', pattern: 'hello' },
        },
        { provider: 'vllm', model: 'stub-model', maxIterations: 4 }
      );
      assert.equal(result.passed, true, `repair did not save the call: ${result.detail}`);
      assert.equal(result.telemetry.repairedCalls, 1);
    } finally {
      await server.close();
    }
  });
});

describe('O3: independent reads run in parallel', () => {
  test('O3: a turn of reads is parallelisable', () => {
    assert.equal(
      canRunInParallel([
        { id: '1', name: 'read_file', arguments: {} },
        { id: '2', name: 'grep_search', arguments: {} },
      ]),
      true
    );
  });

  test('O3: anything that mutates forces sequential execution', () => {
    assert.equal(
      canRunInParallel([
        { id: '1', name: 'read_file', arguments: {} },
        { id: '2', name: 'write_file', arguments: {} },
      ]),
      false
    );
    assert.equal(canRunInParallel([{ id: '1', name: 'read_file', arguments: {} }]), false);
  });

  test('O3: two reads in one turn both come back, in order', async () => {
    const server = await startStubServer([
      {
        content: 'reading both',
        toolCalls: [
          { id: 'a', name: 'read_file', arguments: { path: 'one.txt' } },
          { id: 'b', name: 'read_file', arguments: { path: 'two.txt' } },
        ],
      },
      { content: 'TASK COMPLETE: read them' },
    ]);
    try {
      setApiKey('vllm-endpoint', server.url);
      const result = await runTask(
        {
          id: 'parallel-probe',
          suite: 'local',
          prompt: 'read both files',
          files: { 'one.txt': 'FIRST', 'two.txt': 'SECOND' },
          verify: { kind: 'file_exists', path: 'one.txt' },
        },
        { provider: 'vllm', model: 'stub-model', maxIterations: 4 }
      );

      assert.equal(result.telemetry.parallelBatches, 1, 'the read batch did not run in parallel');
      assert.equal(result.telemetry.toolCalls, 2);

      // Both results must have reached the model, keyed to the right calls.
      const lastRequest = server.sentMessages().at(-1);
      const toolMessages = lastRequest.filter(m => m.role === 'tool');
      assert.equal(toolMessages.length, 2);
      assert.match(toolMessages[0].content, /FIRST/);
      assert.match(toolMessages[1].content, /SECOND/);
    } finally {
      await server.close();
    }
  });
});

describe('O4: apply_patch is atomic', () => {
  const original = ['one', 'two', 'three', 'four'].join('\n');

  test('O4: a matching patch applies', () => {
    const outcome = applyUnifiedDiff(original, '@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three');
    assert.equal(outcome.ok, true);
    assert.equal(outcome.content, ['one', 'TWO', 'three', 'four'].join('\n'));
  });

  test('O4: a patch whose context has moved is still found', () => {
    const shifted = ['header', 'header', ...original.split('\n')].join('\n');
    const outcome = applyUnifiedDiff(shifted, '@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three');
    assert.equal(outcome.ok, true);
    assert.match(outcome.content, /TWO/);
  });

  test('O4: a patch that does not match writes nothing at all', () => {
    // The old implementation inserted the + lines anyway and reported success,
    // silently corrupting the file.
    const outcome = applyUnifiedDiff(original, '@@ -1,3 +1,3 @@\n one\n-TWENTY\n+TWO\n three');
    assert.equal(outcome.ok, false);
    assert.match(outcome.error, /does not match/i);
    assert.match(outcome.error, /nothing was written/i);
  });

  test('O4: a multi-hunk patch applies every hunk at the right offset', () => {
    const patch =
      '@@ -1,2 +1,2 @@\n-one\n+ONE\n two\n' +
      '@@ -3,2 +3,2 @@\n three\n-four\n+FOUR\n';
    const outcome = applyUnifiedDiff(original, patch);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.content, ['ONE', 'two', 'three', 'FOUR'].join('\n'));
    assert.equal(outcome.hunksApplied, 2);
  });

  test('O4: one bad hunk fails the whole patch', () => {
    const patch =
      '@@ -1,2 +1,2 @@\n-one\n+ONE\n two\n' +
      '@@ -3,2 +3,2 @@\n three\n-NOPE\n+FOUR\n';
    const outcome = applyUnifiedDiff(original, patch);
    assert.equal(outcome.ok, false);
    assert.match(outcome.error, /Hunk 2 of 2/);
  });

  test('O4: headers and no-newline markers are ignored', () => {
    const hunks = parseUnifiedDiff(
      'diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-one\n+ONE\n\\ No newline at end of file\n'
    );
    assert.equal(hunks.length, 1);
    assert.deepEqual(hunks[0].expected, ['one']);
    assert.deepEqual(hunks[0].replacement, ['ONE']);
  });

  test('O4: a patch with no hunks is refused', () => {
    const outcome = applyUnifiedDiff(original, 'please change two to TWO');
    assert.equal(outcome.ok, false);
    assert.match(outcome.error, /no @@ hunks/);
  });
});

describe('O5: transient provider failures are retried', () => {
  test('O5: backoff grows and stays bounded', () => {
    assert.ok(backoffMs(0) < backoffMs(3), 'backoff must grow with each attempt');
    assert.ok(backoffMs(10) <= 16_500, 'backoff must stay bounded');
  });

  test('O5: a Retry-After header is honoured over the computed delay', () => {
    assert.equal(backoffMs(0, 2), 2000);
    assert.equal(backoffMs(0, 999), 60_000, 'a hostile Retry-After must be capped');
  });

  test('O5: a 503 is retried and the eventual 200 is returned', async () => {
    const { createServer } = await import('node:http');
    let hits = 0;
    const server = createServer((req, res) => {
      hits++;
      if (hits < 3) {
        res.writeHead(503);
        res.end('unavailable');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

    try {
      const { fetchProvider } = await import('../dist/providers/net.js');
      const response = await fetchProvider(
        `http://127.0.0.1:${server.address().port}/v1/chat`,
        { method: 'POST' },
        'stub',
        'hint'
      );
      assert.equal(response.status, 200);
      assert.equal(hits, 3, 'the request was not retried');
    } finally {
      server.closeAllConnections?.();
      await new Promise(resolve => server.close(resolve));
    }
  });
});

describe('O6: the agent verifies before it claims completion', () => {
  test('O6: a failing verification command is handed back, not accepted', async () => {
    const { runAgent } = await import('../dist/core/agent.js');
    const dir = mkdtempSync(join(scratch, 'verify-'));
    writeFileSync(join(dir, 'check.mjs'), 'process.exit(1);\n');

    const { setWorkspaceRoot, resetWorkspaceRoot } = await import('../dist/core/tools.js');
    const previous = process.cwd();
    process.chdir(dir);
    setWorkspaceRoot(dir);

    const server = await startStubServer([{ content: 'TASK COMPLETE: I am definitely done' }]);
    try {
      setApiKey('vllm-endpoint', server.url);
      const result = await runAgent({
        task: 'make check.mjs pass',
        provider: 'vllm',
        model: 'stub-model',
        maxIterations: 3,
        verifyCommand: 'node check.mjs',
      });

      assert.equal(result.success, false, 'an unverified claim was accepted');
      assert.equal(result.stopReason, 'verification_failed');
      assert.ok(result.telemetry.verifyAttempts > 0);
      assert.equal(result.telemetry.verified, false);
    } finally {
      await server.close();
      process.chdir(previous);
      resetWorkspaceRoot();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('O6: a passing verification command lets the run complete', async () => {
    const { runAgent } = await import('../dist/core/agent.js');
    const dir = mkdtempSync(join(scratch, 'verify-ok-'));
    writeFileSync(join(dir, 'check.mjs'), 'process.exit(0);\n');

    const { setWorkspaceRoot, resetWorkspaceRoot } = await import('../dist/core/tools.js');
    const previous = process.cwd();
    process.chdir(dir);
    setWorkspaceRoot(dir);

    const server = await startStubServer([{ content: 'TASK COMPLETE: done' }]);
    try {
      setApiKey('vllm-endpoint', server.url);
      const result = await runAgent({
        task: 'nothing to do',
        provider: 'vllm',
        model: 'stub-model',
        maxIterations: 3,
        verifyCommand: 'node check.mjs',
      });

      assert.equal(result.success, true);
      assert.equal(result.telemetry.verified, true);
    } finally {
      await server.close();
      process.chdir(previous);
      resetWorkspaceRoot();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
