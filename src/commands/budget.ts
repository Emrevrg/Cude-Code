import chalk from 'chalk';
import {
  loadBudget,
  setTotalLimit,
  setMonthlyLimit,
  setAlertThreshold,
  resetSpending,
  getRemainingBudget,
  unsetLimits,
} from '../storage/budget.js';
import { showSuccess, showInfo, showError, printKeyValue, printSeparator } from '../ui/display.js';
import { format } from 'date-fns';

export async function runBudgetSet(amount: string, options: { monthly?: boolean } = {}): Promise<void> {
  const value = parseFloat(amount);
  if (isNaN(value) || value < 0) {
    showError('Invalid amount. Please provide a positive number.\nExample: cude budget set 10');
    process.exit(1);
  }

  if (options.monthly) {
    setMonthlyLimit(value);
    showSuccess(`Monthly budget limit set to $${value}`);
  } else {
    setTotalLimit(value);
    showSuccess(`Total budget limit set to $${value}`);
  }
}

export async function runBudgetStatus(): Promise<void> {
  const budget = loadBudget();
  const remaining = getRemainingBudget();

  console.log();
  console.log(chalk.bold.cyan('  Budget Status'));
  printSeparator();

  console.log();
  console.log(chalk.bold('  Spending:'));
  printKeyValue('Total spent', `$${budget.totalSpent.toFixed(6)}`, 'yellow');
  printKeyValue('This month', `$${budget.monthlySpent.toFixed(6)}`, 'yellow');
  printKeyValue('This session', `$${budget.sessionSpent.toFixed(6)}`, 'yellow');

  if (budget.totalLimit !== undefined || budget.monthlyLimit !== undefined) {
    console.log();
    console.log(chalk.bold('  Limits:'));
    if (budget.totalLimit !== undefined) {
      const pct = usedPercentage(budget.totalSpent, budget.totalLimit);
      const bar = createProgressBar(pct);
      printKeyValue('Total limit', `$${budget.totalLimit} ${bar} ${pct.toFixed(1)}%`, 'cyan');
      if (remaining.total !== undefined) {
        printKeyValue('Remaining', `$${remaining.total.toFixed(6)}`, remaining.total < 1 ? 'yellow' : 'green');
      }
    }
    if (budget.monthlyLimit !== undefined) {
      const pct = usedPercentage(budget.monthlySpent, budget.monthlyLimit);
      const bar = createProgressBar(pct);
      printKeyValue('Monthly limit', `$${budget.monthlyLimit} ${bar} ${pct.toFixed(1)}%`, 'cyan');
      if (remaining.monthly !== undefined) {
        printKeyValue('Monthly remaining', `$${remaining.monthly.toFixed(6)}`, remaining.monthly < 1 ? 'yellow' : 'green');
      }
    }
  } else {
    console.log();
    showInfo('No budget limits set. Use "cude budget set <amount>" to set one.');
  }

  if (Object.keys(budget.perProviderSpent).length > 0) {
    console.log();
    console.log(chalk.bold('  By Provider:'));
    for (const [prov, spent] of Object.entries(budget.perProviderSpent)) {
      printKeyValue(prov, `$${spent.toFixed(6)}`, 'white');
    }
  }

  if (budget.history.length > 0) {
    console.log();
    console.log(chalk.bold('  Recent Transactions:'));
    const recent = budget.history.slice(-5).reverse();
    for (const record of recent) {
      const date = format(new Date(record.timestamp), 'MMM d HH:mm');
      const cost = record.cost === 0 ? chalk.green('FREE') : chalk.yellow(`$${record.cost.toFixed(6)}`);
      console.log(
        chalk.dim(`  ${date.padEnd(16)}`) +
        chalk.cyan(record.provider.padEnd(12)) +
        chalk.dim(record.model.substring(0, 25).padEnd(27)) +
        cost
      );
    }
  }

  const monthStart = format(new Date(budget.monthStart), 'MMMM d, yyyy');
  console.log();
  console.log(chalk.dim(`  Month started: ${monthStart}`));
  console.log();
}

export async function runBudgetReset(): Promise<void> {
  const { default: inquirer } = await import('inquirer');
  const answer = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Reset all spending data? (limits will be preserved)',
      default: false,
    },
  ]) as { confirm: boolean };

  if (answer.confirm) {
    resetSpending();
    showSuccess('Spending data reset successfully');
  } else {
    showInfo('Reset cancelled');
  }
}

export interface BudgetUnsetOptions {
  total?: boolean;
  monthly?: boolean;
  alert?: boolean;
  all?: boolean;
}

export async function runBudgetUnset(options: BudgetUnsetOptions = {}): Promise<void> {
  const { all = false } = options;
  const which = {
    total: all || options.total === true,
    monthly: all || options.monthly === true,
    alert: all || options.alert === true,
  };

  if (!which.total && !which.monthly && !which.alert) {
    showError(
      'Nothing to unset. Choose what to clear:\n' +
      '  cude budget unset --total     Remove the total spending limit\n' +
      '  cude budget unset --monthly   Remove the monthly limit\n' +
      '  cude budget unset --alert     Remove the alert threshold\n' +
      '  cude budget unset --all       Remove all three'
    );
    process.exit(1);
  }

  const cleared = unsetLimits(which);
  const names: string[] = [];
  if (cleared.total) names.push('total limit');
  if (cleared.monthly) names.push('monthly limit');
  if (cleared.alert) names.push('alert threshold');

  if (names.length === 0) {
    showInfo('Nothing to clear — none of the selected limits were set.');
    return;
  }

  showSuccess(`Cleared: ${names.join(', ')}`);
}

export async function runBudgetAlert(amount: string): Promise<void> {
  const value = parseFloat(amount);
  if (isNaN(value) || value < 0) {
    showError('Invalid amount.\nExample: cude budget alert 8');
    process.exit(1);
  }

  setAlertThreshold(value);
  showSuccess(`Budget alert threshold set to $${value}`);
}

/**
 * A limit of 0 made `spent / limit` produce NaN, rendering "$0  NaN%".
 * Nothing is left of a zero budget, so it reads as fully used.
 */
export function usedPercentage(spent: number, limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return 100;
  return Math.min(100, (spent / limit) * 100);
}

function createProgressBar(percentage: number, width = 15): string {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  const color = percentage >= 90 ? chalk.red : percentage >= 70 ? chalk.yellow : chalk.green;
  return color('█'.repeat(filled)) + chalk.dim('░'.repeat(empty));
}
