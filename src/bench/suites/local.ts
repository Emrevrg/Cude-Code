import type { BenchTask } from '../types.js';

/**
 * Cude's own suite: small, real, and dependency-free.
 *
 * Every task is graded by running `node --test`, which is present wherever
 * Cude runs — no Docker, no dataset download, no network. That is what makes
 * it the suite you can actually run on every change, and the reason its tasks
 * are shaped like the work the agent is asked to do rather than like puzzles:
 * make a failing test pass, fix a bug that a test already catches, change
 * something across several files without breaking the rest.
 *
 * The tests are written before the agent starts and it is told not to modify
 * them. If it does anyway, the graded run is the one that counts — and the
 * grader re-runs the *original* test file, which the sandbox restores from
 * this definition, so deleting the test cannot pass a task.
 */

/** Restores the original test file, then runs it. */
function gradeWith(testPath: string, testSource: string): BenchTask['verify'] {
  return {
    kind: 'all',
    of: [
      { kind: 'restore_file', path: testPath, content: testSource },
      { kind: 'command', command: `node --test ${testPath}` },
    ],
  };
}

const FIZZBUZZ_TEST = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fizzbuzz } from '../src/fizzbuzz.mjs';

test('numbers pass through as strings', () => {
  assert.equal(fizzbuzz(1), '1');
  assert.equal(fizzbuzz(2), '2');
});

test('multiples of three are Fizz', () => {
  assert.equal(fizzbuzz(3), 'Fizz');
  assert.equal(fizzbuzz(9), 'Fizz');
});

test('multiples of five are Buzz', () => {
  assert.equal(fizzbuzz(5), 'Buzz');
  assert.equal(fizzbuzz(10), 'Buzz');
});

test('multiples of both are FizzBuzz', () => {
  assert.equal(fizzbuzz(15), 'FizzBuzz');
  assert.equal(fizzbuzz(45), 'FizzBuzz');
});
`;

const SLUGIFY_TEST = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/slugify.mjs';

test('lowercases and hyphenates', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
});

test('collapses repeated separators', () => {
  assert.equal(slugify('a   b---c'), 'a-b-c');
});

test('trims leading and trailing separators', () => {
  assert.equal(slugify('  --Hello--  '), 'hello');
});

test('drops punctuation', () => {
  assert.equal(slugify("It's a Test!"), 'its-a-test');
});
`;

const BUDGET_TEST = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { percentUsed } from '../src/budget.mjs';

test('reports the share of the limit that is spent', () => {
  assert.equal(percentUsed(25, 100), 25);
  assert.equal(percentUsed(0, 100), 0);
});

test('a zero limit is not a division by zero', () => {
  // A limit of zero means "no spending allowed": anything spent is 100%.
  assert.equal(percentUsed(0, 0), 0);
  assert.equal(percentUsed(5, 0), 100);
});

test('never reports more than 100', () => {
  assert.equal(percentUsed(300, 100), 100);
});
`;

const PARSER_TEST = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/args.mjs';

test('parses long flags with values', () => {
  assert.deepEqual(parseArgs(['--name', 'cude']), { name: 'cude' });
});

test('parses --key=value', () => {
  assert.deepEqual(parseArgs(['--name=cude']), { name: 'cude' });
});

test('a flag with no value is true', () => {
  assert.deepEqual(parseArgs(['--verbose']), { verbose: true });
});

test('positional arguments collect under _', () => {
  assert.deepEqual(parseArgs(['run', '--verbose', 'task']), { _: ['run', 'task'], verbose: true });
});
`;

const RETRY_TEST = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retry } from '../src/retry.mjs';

test('returns the first successful result', async () => {
  let calls = 0;
  const value = await retry(async () => { calls++; return 'ok'; }, 3);
  assert.equal(value, 'ok');
  assert.equal(calls, 1);
});

test('retries until it succeeds', async () => {
  let calls = 0;
  const value = await retry(async () => {
    calls++;
    if (calls < 3) throw new Error('boom');
    return 'ok';
  }, 5);
  assert.equal(value, 'ok');
  assert.equal(calls, 3);
});

test('gives up after the limit and rethrows the last error', async () => {
  let calls = 0;
  await assert.rejects(
    () => retry(async () => { calls++; throw new Error('always'); }, 2),
    /always/
  );
  assert.equal(calls, 2);
});
`;

const PACKAGE_JSON = JSON.stringify({ name: 'bench-task', type: 'module', private: true }, null, 2);

export const LOCAL_SUITE: BenchTask[] = [
  {
    id: 'local/implement-fizzbuzz',
    suite: 'local',
    tags: ['implement', 'single-file'],
    prompt:
      'The file test/fizzbuzz.test.mjs exists and fails because src/fizzbuzz.mjs does not. ' +
      'Create src/fizzbuzz.mjs exporting a named function `fizzbuzz(n)` so that `node --test test/fizzbuzz.test.mjs` ' +
      'passes. Do not modify the test file.',
    files: {
      'package.json': PACKAGE_JSON,
      'test/fizzbuzz.test.mjs': FIZZBUZZ_TEST,
    },
    verify: gradeWith('test/fizzbuzz.test.mjs', FIZZBUZZ_TEST),
    agentVerifyCommand: 'node --test test/fizzbuzz.test.mjs',
  },

  {
    id: 'local/fix-slugify',
    suite: 'local',
    tags: ['debug', 'existing-code'],
    prompt:
      'Run `node --test test/slugify.test.mjs`. Some tests fail. Fix src/slugify.mjs so every test passes, ' +
      'without changing the test file.',
    files: {
      'package.json': PACKAGE_JSON,
      // Three real bugs: no trimming, separators not collapsed, punctuation kept.
      'src/slugify.mjs': `export function slugify(input) {
  return String(input)
    .toLowerCase()
    .replace(/\\s/g, '-');
}
`,
      'test/slugify.test.mjs': SLUGIFY_TEST,
    },
    verify: gradeWith('test/slugify.test.mjs', SLUGIFY_TEST),
    agentVerifyCommand: 'node --test test/slugify.test.mjs',
  },

  {
    id: 'local/fix-divide-by-zero',
    suite: 'local',
    tags: ['debug', 'edge-case'],
    prompt:
      'src/budget.mjs returns NaN when the limit is zero. Run `node --test test/budget.test.mjs` to see the ' +
      'failures and fix the implementation so all of them pass. Do not modify the test file.',
    files: {
      'package.json': PACKAGE_JSON,
      'src/budget.mjs': `export function percentUsed(spent, limit) {
  return (spent / limit) * 100;
}
`,
      'test/budget.test.mjs': BUDGET_TEST,
    },
    verify: gradeWith('test/budget.test.mjs', BUDGET_TEST),
    agentVerifyCommand: 'node --test test/budget.test.mjs',
  },

  {
    id: 'local/implement-arg-parser',
    suite: 'local',
    tags: ['implement', 'spec-from-tests'],
    prompt:
      'Create src/args.mjs exporting `parseArgs(argv)`. The expected behaviour is fully specified by ' +
      'test/args.test.mjs — read it first, then implement against it. `node --test test/args.test.mjs` must pass. ' +
      'Do not modify the test file.',
    files: {
      'package.json': PACKAGE_JSON,
      'test/args.test.mjs': PARSER_TEST,
    },
    verify: gradeWith('test/args.test.mjs', PARSER_TEST),
    agentVerifyCommand: 'node --test test/args.test.mjs',
  },

  {
    id: 'local/implement-retry',
    suite: 'local',
    tags: ['implement', 'async'],
    prompt:
      'Create src/retry.mjs exporting `async retry(fn, attempts)`: call fn, and on a thrown error try again ' +
      'until it succeeds or `attempts` calls have been made, rethrowing the last error. ' +
      '`node --test test/retry.test.mjs` must pass. Do not modify the test file.',
    files: {
      'package.json': PACKAGE_JSON,
      'test/retry.test.mjs': RETRY_TEST,
    },
    verify: gradeWith('test/retry.test.mjs', RETRY_TEST),
    agentVerifyCommand: 'node --test test/retry.test.mjs',
  },

  {
    id: 'local/multi-file-rename',
    suite: 'local',
    tags: ['refactor', 'multi-file', 'search'],
    prompt:
      'The constant MAX_RETRIES is defined in src/config.mjs and used in src/client.mjs and src/worker.mjs. ' +
      'Rename it to MAX_ATTEMPTS everywhere, keeping the value and every import working. ' +
      '`node --test test/wiring.test.mjs` must pass afterwards.',
    files: {
      'package.json': PACKAGE_JSON,
      'src/config.mjs': `export const MAX_RETRIES = 5;
export const TIMEOUT_MS = 30000;
`,
      'src/client.mjs': `import { MAX_RETRIES, TIMEOUT_MS } from './config.mjs';

export function clientSettings() {
  return { retries: MAX_RETRIES, timeout: TIMEOUT_MS };
}
`,
      'src/worker.mjs': `import { MAX_RETRIES } from './config.mjs';

export function workerLimit() {
  return MAX_RETRIES * 2;
}
`,
      'test/wiring.test.mjs': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientSettings } from '../src/client.mjs';
import { workerLimit } from '../src/worker.mjs';
import * as config from '../src/config.mjs';

test('the constant was renamed, not duplicated', () => {
  assert.equal(config.MAX_ATTEMPTS, 5);
  assert.equal(config.MAX_RETRIES, undefined);
});

test('both consumers still work', () => {
  assert.deepEqual(clientSettings(), { retries: 5, timeout: 30000 });
  assert.equal(workerLimit(), 10);
});
`,
    },
    verify: {
      kind: 'all',
      of: [
        { kind: 'command', command: 'node --test test/wiring.test.mjs' },
        // A rename that leaves the old name behind is not a rename.
        { kind: 'file_absent', path: 'src/config.mjs.bak' },
      ],
    },
    agentVerifyCommand: 'node --test test/wiring.test.mjs',
  },

  {
    id: 'local/patch-precise-edit',
    suite: 'local',
    tags: ['edit', 'precision'],
    prompt:
      'In src/format.mjs, change only the `formatCost` function so it renders four decimal places instead of two. ' +
      'Every other function must be left exactly as it is. `node --test test/format.test.mjs` must pass.',
    files: {
      'package.json': PACKAGE_JSON,
      'src/format.mjs': `export function formatCost(cost) {
  return '$' + cost.toFixed(2);
}

export function formatTokens(count) {
  return count.toLocaleString('en-US');
}

export function formatPercent(value) {
  return value.toFixed(1) + '%';
}
`,
      'test/format.test.mjs': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCost, formatTokens, formatPercent } from '../src/format.mjs';

test('cost gets four decimals', () => {
  assert.equal(formatCost(1.23456), '$1.2346');
  assert.equal(formatCost(0), '$0.0000');
});

test('the other formatters are untouched', () => {
  assert.equal(formatTokens(1234567), '1,234,567');
  assert.equal(formatPercent(12.34), '12.3%');
});
`,
    },
    verify: {
      kind: 'command',
      command: 'node --test test/format.test.mjs',
    },
    agentVerifyCommand: 'node --test test/format.test.mjs',
  },

  {
    id: 'local/document-module',
    suite: 'local',
    tags: ['writing', 'reading'],
    prompt:
      'Read src/queue.mjs and write API.md documenting every exported function: its name, its parameters, ' +
      'what it returns, and one example call. Do not change the source.',
    files: {
      'package.json': PACKAGE_JSON,
      'src/queue.mjs': `export function createQueue(limit = 10) {
  return { items: [], limit };
}

export function enqueue(queue, item) {
  if (queue.items.length >= queue.limit) return false;
  queue.items.push(item);
  return true;
}

export function dequeue(queue) {
  return queue.items.shift();
}

export function queueDepth(queue) {
  return queue.items.length;
}
`,
    },
    verify: {
      kind: 'all',
      of: [
        { kind: 'file_exists', path: 'API.md' },
        { kind: 'file_matches', path: 'API.md', pattern: 'createQueue', flags: 'i' },
        { kind: 'file_matches', path: 'API.md', pattern: 'enqueue', flags: 'i' },
        { kind: 'file_matches', path: 'API.md', pattern: 'dequeue', flags: 'i' },
        { kind: 'file_matches', path: 'API.md', pattern: 'queueDepth', flags: 'i' },
        // The source must survive documentation.
        { kind: 'file_matches', path: 'src/queue.mjs', pattern: 'queue\\.items\\.shift\\(\\)' },
      ],
    },
  },
];

export function localSuite(filter?: string): BenchTask[] {
  if (!filter) return LOCAL_SUITE;
  const pattern = new RegExp(filter, 'i');
  return LOCAL_SUITE.filter(task => pattern.test(task.id) || task.tags?.some(tag => pattern.test(tag)));
}
