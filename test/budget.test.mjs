// Budget limits (F7) and status rendering (F8).

import { test, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'cude-home-'));
process.env.CUDE_HOME = home;

const { runBudgetUnset } = await import('../dist/commands/budget.js');
const { loadBudget, setTotalLimit, setMonthlyLimit, setAlertThreshold, resetSpending } =
  await import('../dist/storage/budget.js');

after(() => rmSync(home, { recursive: true, force: true }));

beforeEach(() => {
  resetSpending();
});

/** Captures everything written to stdout while `fn` runs. */
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

describe('F7: a budget limit can be removed', () => {
  test('F7: budget unset --all clears both limits and the alert threshold', async () => {
    setTotalLimit(10);
    setMonthlyLimit(5);
    setAlertThreshold(8);

    const output = await capture(() => runBudgetUnset({ all: true }));

    const budget = loadBudget();
    assert.equal(budget.totalLimit, undefined, 'total limit was not cleared');
    assert.equal(budget.monthlyLimit, undefined, 'monthly limit was not cleared');
    assert.equal(budget.alertThreshold, undefined, 'alert threshold was not cleared');
    assert.match(output, /total limit/i, 'the command must confirm what it cleared');
    assert.match(output, /monthly limit/i);
  });

  test('F7: individual flags clear only what they name', async () => {
    setTotalLimit(10);
    setMonthlyLimit(5);

    await capture(() => runBudgetUnset({ total: true }));

    const budget = loadBudget();
    assert.equal(budget.totalLimit, undefined);
    assert.equal(budget.monthlyLimit, 5, 'the monthly limit must survive --total');
  });

  test('F7: unsetting a limit that is not set says so rather than claiming success', async () => {
    await capture(() => runBudgetUnset({ all: true }));
    const output = await capture(() => runBudgetUnset({ all: true }));
    assert.match(output, /nothing to clear/i);
  });

  test('F7: reset still preserves limits, which is why unset had to exist', async () => {
    setTotalLimit(10);
    resetSpending();
    assert.equal(loadBudget().totalLimit, 10);
  });
});
