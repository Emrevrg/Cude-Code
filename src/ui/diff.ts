import chalk from 'chalk';

/**
 * A compact line diff for the approval prompt.
 *
 * Trims the common prefix and suffix and shows what is left with a little
 * context. That is not a minimal edit script — a change in the middle of a file
 * shows as one block rather than several — but for "is this the edit I meant?"
 * it is legible and, unlike an LCS implementation, cannot be slow on a large
 * file.
 */

export interface DiffSummary {
  added: number;
  removed: number;
  text: string;
}

const CONTEXT_LINES = 2;
const MAX_SHOWN = 40;

export function renderDiff(before: string, after: string, maxLines = MAX_SHOWN): DiffSummary {
  // An empty string splits to [''] — one blank line — which would report a new
  // file as removing a line it never had.
  const a = before === '' ? [] : before.split('\n');
  const b = after === '' ? [] : after.split('\n');

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;

  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const removed = a.slice(start, endA);
  const added = b.slice(start, endB);

  if (removed.length === 0 && added.length === 0) {
    return { added: 0, removed: 0, text: chalk.dim('  (no change)') };
  }

  const lines: string[] = [];
  const contextBefore = a.slice(Math.max(0, start - CONTEXT_LINES), start);
  const contextAfter = a.slice(endA, Math.min(a.length, endA + CONTEXT_LINES));

  for (const line of contextBefore) lines.push(chalk.dim(`   ${line}`));

  let shown = 0;
  for (const line of removed) {
    if (shown >= maxLines) break;
    lines.push(chalk.red(`  -${line}`));
    shown++;
  }
  for (const line of added) {
    if (shown >= maxLines) break;
    lines.push(chalk.green(`  +${line}`));
    shown++;
  }

  const hidden = removed.length + added.length - shown;
  if (hidden > 0) {
    lines.push(chalk.dim(`  … ${hidden} more changed line${hidden !== 1 ? 's' : ''}`));
  }

  for (const line of contextAfter) lines.push(chalk.dim(`   ${line}`));

  return {
    added: added.length,
    removed: removed.length,
    text: lines.join('\n'),
  };
}

/** `+12 -3` style summary for a one-line status. */
export function diffStat(summary: DiffSummary): string {
  return chalk.green(`+${summary.added}`) + ' ' + chalk.red(`-${summary.removed}`);
}
