import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { startOfMonth } from 'date-fns';
import { getDataDir } from '../config/index.js';

export interface BudgetData {
  totalLimit?: number;
  monthlyLimit?: number;
  alertThreshold?: number;
  totalSpent: number;
  monthlySpent: number;
  monthStart: string;
  sessionSpent: number;
  perProviderSpent: Record<string, number>;
  history: SpendingRecord[];
}

export interface SpendingRecord {
  timestamp: string;
  provider: string;
  model: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  sessionId?: string;
}

function getBudgetPath(): string {
  const dir = getDataDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return join(dir, 'budget.json');
}

function getDefaultBudget(): BudgetData {
  return {
    totalLimit: undefined,
    monthlyLimit: undefined,
    alertThreshold: undefined,
    totalSpent: 0,
    monthlySpent: 0,
    monthStart: startOfMonth(new Date()).toISOString(),
    sessionSpent: 0,
    perProviderSpent: {},
    history: [],
  };
}

export function loadBudget(): BudgetData {
  const path = getBudgetPath();
  if (!existsSync(path)) {
    return getDefaultBudget();
  }
  try {
    const data = readFileSync(path, 'utf-8');
    const budget = JSON.parse(data) as BudgetData;

    // Reset monthly spending if new month
    const savedMonthStart = new Date(budget.monthStart);
    const currentMonthStart = startOfMonth(new Date());
    if (savedMonthStart < currentMonthStart) {
      budget.monthlySpent = 0;
      budget.monthStart = currentMonthStart.toISOString();
    }

    return budget;
  } catch {
    return getDefaultBudget();
  }
}

export function saveBudget(budget: BudgetData): void {
  writeFileSync(getBudgetPath(), JSON.stringify(budget, null, 2), 'utf-8');
}

export function recordSpending(
  provider: string,
  model: string,
  cost: number,
  inputTokens: number,
  outputTokens: number,
  sessionId?: string
): void {
  const budget = loadBudget();

  budget.totalSpent += cost;
  budget.monthlySpent += cost;
  budget.sessionSpent += cost;
  budget.perProviderSpent[provider] = (budget.perProviderSpent[provider] ?? 0) + cost;

  budget.history.push({
    timestamp: new Date().toISOString(),
    provider,
    model,
    cost,
    inputTokens,
    outputTokens,
    sessionId,
  });

  // Keep history to last 1000 records
  if (budget.history.length > 1000) {
    budget.history = budget.history.slice(-1000);
  }

  saveBudget(budget);
}

export function setTotalLimit(amount: number): void {
  const budget = loadBudget();
  budget.totalLimit = amount;
  saveBudget(budget);
}

export function setMonthlyLimit(amount: number): void {
  const budget = loadBudget();
  budget.monthlyLimit = amount;
  saveBudget(budget);
}

export function setAlertThreshold(amount: number): void {
  const budget = loadBudget();
  budget.alertThreshold = amount;
  saveBudget(budget);
}

/**
 * Removing a limit used to require hand-editing ~/.cude/budget.json: `reset`
 * only zeroes the counters and deliberately preserves the limits.
 */
export function unsetLimits(
  which: { total?: boolean; monthly?: boolean; alert?: boolean }
): { total: boolean; monthly: boolean; alert: boolean } {
  const budget = loadBudget();
  const cleared = {
    total: which.total === true && budget.totalLimit !== undefined,
    monthly: which.monthly === true && budget.monthlyLimit !== undefined,
    alert: which.alert === true && budget.alertThreshold !== undefined,
  };

  if (which.total) delete budget.totalLimit;
  if (which.monthly) delete budget.monthlyLimit;
  if (which.alert) delete budget.alertThreshold;

  saveBudget(budget);
  return cleared;
}

export function unsetTotalLimit(): void {
  unsetLimits({ total: true });
}

export function unsetMonthlyLimit(): void {
  unsetLimits({ monthly: true });
}

export function unsetAlertThreshold(): void {
  unsetLimits({ alert: true });
}

export function resetSpending(): void {
  const budget = loadBudget();
  budget.totalSpent = 0;
  budget.monthlySpent = 0;
  budget.sessionSpent = 0;
  budget.perProviderSpent = {};
  budget.history = [];
  saveBudget(budget);
}

export function resetSessionSpending(): void {
  const budget = loadBudget();
  budget.sessionSpent = 0;
  saveBudget(budget);
}

export function getRemainingBudget(): { total: number | undefined; monthly: number | undefined } {
  const budget = loadBudget();
  return {
    total: budget.totalLimit !== undefined ? Math.max(0, budget.totalLimit - budget.totalSpent) : undefined,
    monthly: budget.monthlyLimit !== undefined ? Math.max(0, budget.monthlyLimit - budget.monthlySpent) : undefined,
  };
}

export function checkBudgetAlert(): { exceeded: boolean; nearAlert: boolean; message?: string } {
  const budget = loadBudget();

  if (budget.totalLimit !== undefined && budget.totalSpent >= budget.totalLimit) {
    return {
      exceeded: true,
      nearAlert: true,
      message: `Total budget limit of $${budget.totalLimit} exceeded! Spent: $${budget.totalSpent.toFixed(4)}`,
    };
  }

  if (budget.monthlyLimit !== undefined && budget.monthlySpent >= budget.monthlyLimit) {
    return {
      exceeded: true,
      nearAlert: true,
      message: `Monthly budget limit of $${budget.monthlyLimit} exceeded! Spent this month: $${budget.monthlySpent.toFixed(4)}`,
    };
  }

  if (budget.alertThreshold !== undefined && budget.totalSpent >= budget.alertThreshold) {
    return {
      exceeded: false,
      nearAlert: true,
      message: `Alert: You've spent $${budget.totalSpent.toFixed(4)} (threshold: $${budget.alertThreshold})`,
    };
  }

  return { exceeded: false, nearAlert: false };
}
