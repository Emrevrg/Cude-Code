import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const budget = await import('../dist/storage/budget.js');
const commands = await import('../dist/commands/budget.js');

after(() => {
  const b = budget.loadBudget();
  b.totalLimit = undefined;
  b.monthlyLimit = undefined;
  b.alertThreshold = undefined;
  budget.saveBudget(b);
});

test('F7: budget unset --all clears all configured limits', async () => {
  budget.setTotalLimit(10);
  budget.setMonthlyLimit(5);
  budget.setAlertThreshold(2);
  await commands.runBudgetUnset({ all: true });
  const b = budget.loadBudget();
  assert.equal(b.totalLimit, undefined);
  assert.equal(b.monthlyLimit, undefined);
  assert.equal(b.alertThreshold, undefined);
});

test('F8: zero budget limits never render NaN', async () => {
  budget.setTotalLimit(0);
  budget.setMonthlyLimit(0);
  const original = console.log;
  let output = '';
  console.log = (...args) => { output += args.join(' ') + '\n'; };
  try { await commands.runBudgetStatus(); } finally { console.log = original; }
  assert.doesNotMatch(output, /NaN/);
});
