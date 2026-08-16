import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { BenchRun } from './types.js';

/**
 * Reports.
 *
 * The one rule these follow: a report must state what it is. A `local` run
 * says on its face that it is Cude's own suite, an `unofficial` run says it is
 * not a leaderboard result, and only a grade produced by a dataset's own
 * evaluator is written without a caveat. That is the whole reason there is a
 * `provenance` field — the failure mode this project is guarding against is a
 * plausible-looking number in a README that nobody can reproduce.
 */

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function duration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

export function toMarkdown(run: BenchRun): string {
  const { summary } = run;
  const lines: string[] = [];

  lines.push(`# Cude Code — ${run.suite}`);
  lines.push('');
  lines.push(`**${summary.passed}/${summary.total} passed (${percent(summary.passRate)})**`);
  lines.push('');

  if (run.caveat) {
    lines.push(`> ⚠️ **${run.provenance.toUpperCase()} RUN.** ${run.caveat}`);
    lines.push('');
  }

  lines.push('| | |');
  lines.push('| --- | --- |');
  lines.push(`| Provider / model | ${run.provider} / ${run.model} |`);
  lines.push(`| Mode | ${run.mode} |`);
  lines.push(`| Cude version | ${run.version} |`);
  lines.push(`| Started | ${run.startedAt} |`);
  lines.push(`| Total cost | $${summary.totalCost.toFixed(4)} |`);
  lines.push(`| Median task time | ${duration(summary.medianDurationMs)} |`);
  lines.push(`| Agent iterations | ${summary.totalIterations} |`);
  lines.push(`| Tool calls (errors) | ${summary.toolCalls} (${summary.toolErrors}) |`);
  lines.push(`| Calls repaired | ${summary.repairedCalls} |`);
  lines.push(`| Context compactions | ${summary.compactions} |`);
  lines.push('');

  lines.push('## Tasks');
  lines.push('');
  lines.push('| Task | Result | Steps | Time | Cost | Stopped because |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const result of run.results) {
    lines.push(
      `| \`${result.taskId}\` | ${result.passed ? '✅ pass' : '❌ fail'} | ${result.iterations} | ` +
      `${duration(result.durationMs)} | $${result.cost.toFixed(4)} | ${result.stopReason} |`
    );
  }
  lines.push('');

  const failures = run.results.filter(r => !r.passed && r.detail);
  if (failures.length > 0) {
    lines.push('## Failures');
    lines.push('');
    for (const failure of failures) {
      lines.push(`### \`${failure.taskId}\``);
      lines.push('');
      lines.push('```');
      lines.push((failure.detail ?? '').slice(0, 2000));
      lines.push('```');
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('');
  lines.push(
    run.provenance === 'official'
      ? 'Graded by the dataset\'s official evaluator.'
      : 'Reproduce with `cude bench` — see BENCHMARKS.md for the exact command.'
  );
  lines.push('');

  return lines.join('\n');
}

export interface WrittenReport {
  directory: string;
  jsonPath: string;
  markdownPath: string;
}

/** Writes `run.json` and `report.md` under `.cude-bench/<timestamp>/`. */
export function writeReport(run: BenchRun, outputDir?: string): WrittenReport {
  const stamp = run.startedAt.replace(/[:.]/g, '-');
  const directory = outputDir ?? join(process.cwd(), '.cude-bench', `${run.suite.replace(/\W+/g, '-')}-${stamp}`);
  mkdirSync(directory, { recursive: true });

  const jsonPath = join(directory, 'run.json');
  const markdownPath = join(directory, 'report.md');

  writeFileSync(jsonPath, JSON.stringify(run, null, 2), 'utf-8');
  writeFileSync(markdownPath, toMarkdown(run), 'utf-8');

  return { directory, jsonPath, markdownPath };
}
