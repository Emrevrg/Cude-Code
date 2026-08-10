import chalk from 'chalk';
import {
  loadBudget,
  setTotalLimit,
  setMonthlyLimit,
  setAlertThreshold,
  resetSpending,
  getRemainingBudget,
} from '../storage/budget.js';
import { showSuccess, showInfo, showError, printKeyValue, printSeparator, showBudgetBar } from '../ui/display.js';
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
  console.log(chalk.bold.hex('#06b6d4')('  ◈ Budget Status'));
  printSeparator();
  console.log();

  // Spending row
  console.log(chalk.bold('  Spending'));
  printKeyValue('Total spent',   `$${budget.totalSpent.toFixed(6)}`,   'yellow');
  printKeyValue('This month',    `$${budget.monthlySpent.toFixed(6)}`,  'yellow');
  printKeyValue('This session',  `$${budget.sessionSpent.toFixed(6)}`,  'yellow');

  if (budget.totalLimit !== undefined || budget.monthlyLimit !== undefined) {
    console.log();
    console.log(chalk.bold('  Limits'));
    if (budget.totalLimit !== undefined) {
      showBudgetBar(budget.totalSpent, budget.totalLimit, 'Total');
    }
    if (budget.monthlyLimit !== undefined) {
      showBudgetBar(budget.monthlySpent, budget.monthlyLimit, 'Monthly');
    }
  } else {
    console.log();
    showInfo('No limits set.  cude budget set 10');
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

export async function runBudgetAlert(amount: string): Promise<void> {
  const value = parseFloat(amount);
  if (isNaN(value) || value < 0) {
    showError('Invalid amount.\nExample: cude budget alert 8');
    process.exit(1);
  }

  setAlertThreshold(value);
  showSuccess(`Budget alert threshold set to $${value}`);
}

function createProgressBar(percentage: number, width = 15): string {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  const color = percentage >= 90 ? chalk.red : percentage >= 70 ? chalk.yellow : chalk.green;
  return color('█'.repeat(filled)) + chalk.dim('░'.repeat(empty));
}
