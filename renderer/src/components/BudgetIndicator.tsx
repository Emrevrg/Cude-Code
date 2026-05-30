import React, { useEffect, useState } from 'react';
import type { BudgetStatus } from '../types/ipc';

interface BudgetIndicatorProps {
  sessionCost?: number;
}

export default function BudgetIndicator({ sessionCost = 0 }: BudgetIndicatorProps) {
  const [budget, setBudget] = useState<BudgetStatus | null>(null);

  useEffect(() => {
    window.codiente.budget.status().then(setBudget).catch(() => {});
  }, [sessionCost]); // Refresh when session cost changes

  if (!budget) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          {sessionCost > 0 ? `$${sessionCost.toFixed(4)}` : 'No budget set'}
        </span>
      </div>
    );
  }

  const limit = budget.monthlyLimit ?? budget.totalLimit;
  const spent = budget.monthlyLimit ? budget.monthlySpent : budget.totalSpent;
  const hasLimit = limit !== undefined && limit > 0;
  const pct = hasLimit ? Math.min(100, (spent / limit!) * 100) : 0;

  const barColor = pct > 85 ? 'var(--error)' : pct > 60 ? 'var(--warning)' : 'var(--success)';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {sessionCost > 0 && (
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
          ${sessionCost.toFixed(4)} session
        </span>
      )}
      {hasLimit ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div
            style={{
              width: 80,
              height: 4,
              background: 'var(--border)',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: '100%',
                background: barColor,
                borderRadius: 2,
                transition: 'width 0.3s ease',
              }}
            />
          </div>
          <span style={{ color: 'var(--text-muted)', fontSize: 11, whiteSpace: 'nowrap' }}>
            ${spent.toFixed(2)} / ${limit!.toFixed(2)}
          </span>
        </div>
      ) : (
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
          ${(budget.totalSpent).toFixed(4)} total spent
        </span>
      )}
    </div>
  );
}
