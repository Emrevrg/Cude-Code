import chalk from 'chalk';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { printSeparator } from '../ui/display.js';
import { runSuite, type BenchRunOptions } from '../bench/runner.js';
import { localSuite, LOCAL_SUITE } from '../bench/suites/local.js';
import { loadSweBenchDataset, sweBenchTasks, toPredictionsJsonl } from '../bench/adapters/swebench.js';
import { terminalBenchTasks } from '../bench/adapters/terminalbench.js';
import { writeReport } from '../bench/report.js';
import type { BenchRun, BenchTask, BenchTaskResult, Provenance } from '../bench/types.js';

/**
 * `cude bench` — the command that can produce a score.
 *
 * It prints the caveat before the number, every time, because the point of
 * building this was to stop the project from being one where a benchmark
 * figure appears with nothing behind it.
 */

export interface BenchCommandOptions {
  provider?: string;
  model?: string;
  mode?: string;
  free?: boolean;
  filter?: string;
  limit?: number;
  maxIterations?: number;
  timeoutMs?: number;
  selfVerify?: boolean;
  keepSandbox?: boolean;
  json?: boolean;
  out?: string;
}

function progressOptions(options: BenchCommandOptions): BenchRunOptions {
  return {
    provider: options.provider,
    model: options.model,
    mode: options.mode,
    free: options.free,
    maxIterations: options.maxIterations,
    timeoutMs: options.timeoutMs,
    selfVerify: options.selfVerify,
    keepSandbox: options.keepSandbox,
    onTaskStart: (task, index, total) => {
      process.stdout.write(
        chalk.dim(`  [${String(index + 1).padStart(2)}/${total}] `) + chalk.white(task.id) + chalk.dim(' … ')
      );
    },
    onTaskEnd: result => {
      const mark = result.passed ? chalk.green('pass') : chalk.red('fail');
      const detail = chalk.dim(
        ` ${result.iterations} steps, ${(result.durationMs / 1000).toFixed(1)}s` +
        (result.cost > 0 ? `, $${result.cost.toFixed(4)}` : '') +
        (result.passed ? '' : ` — ${result.stopReason}`)
      );
      console.log(mark + detail);
    },
  };
}

function printSummary(run: BenchRun, written: { markdownPath: string }): void {
  const { summary } = run;
  console.log();
  printSeparator();
  console.log(
    `  ${chalk.bold(`${summary.passed}/${summary.total}`)} passed ` +
    chalk.bold(summary.passRate >= 0.8 ? chalk.green(`(${(summary.passRate * 100).toFixed(1)}%)`) : chalk.yellow(`(${(summary.passRate * 100).toFixed(1)}%)`))
  );
  console.log(
    chalk.dim(
      `  ${summary.toolCalls} tool calls, ${summary.toolErrors} errors, ` +
      `${summary.repairedCalls} repaired, ${summary.compactions} compactions` +
      (summary.totalCost > 0 ? `, $${summary.totalCost.toFixed(4)}` : '')
    )
  );

  if (run.caveat) {
    console.log();
    console.log(chalk.yellow(`  ${run.provenance.toUpperCase()} RUN — ${run.caveat}`));
  }

  console.log();
  console.log(chalk.dim(`  Report: ${written.markdownPath}`));
  console.log();
}

async function execute(
  suiteName: string,
  tasks: BenchTask[],
  provenance: Provenance,
  options: BenchCommandOptions
): Promise<BenchRun> {
  console.log();
  console.log(chalk.bold.cyan(`  Benchmark — ${suiteName}`));
  printSeparator();
  console.log(chalk.dim(`  ${tasks.length} task(s), one at a time, each in its own sandbox`));
  console.log();

  const run = await runSuite(suiteName, tasks, provenance, progressOptions(options));
  const written = writeReport(run, options.out);

  if (options.json) {
    console.log(JSON.stringify(run, null, 2));
  } else {
    printSummary(run, written);
  }

  if (run.summary.failed > 0) process.exitCode = 1;
  return run;
}

/** Cude's own suite: no Docker, no dataset, no network. */
export async function runBenchLocal(options: BenchCommandOptions = {}): Promise<BenchRun> {
  const tasks = localSuite(options.filter).slice(0, options.limit ?? LOCAL_SUITE.length);
  return execute('local', tasks, 'local', options);
}

/** SWE-bench: run the agent, emit predictions for the official evaluator. */
export async function runBenchSweBench(
  datasetPath: string,
  options: BenchCommandOptions & { repoCache?: string } = {}
): Promise<BenchRun> {
  const instances = loadSweBenchDataset(datasetPath);
  const tasks = sweBenchTasks(instances, {
    limit: options.limit,
    filter: options.filter,
    repoCache: options.repoCache,
  });

  console.log();
  console.log(chalk.yellow('  This produces predictions, not a score.'));
  console.log(chalk.dim('  Grading SWE-bench requires its official Docker harness; run it on the'));
  console.log(chalk.dim('  predictions.jsonl this writes, and publish the number that comes back.'));

  const run = await execute('swebench', tasks, 'unofficial', { ...options, json: false });

  const predictions = toPredictionsJsonl(run.results, `cude-code-${run.version}/${run.model}`);
  const directory = options.out ?? join(process.cwd(), '.cude-bench');
  const path = join(directory, 'predictions.jsonl');
  writeFileSync(path, predictions, 'utf-8');

  const withPatch = run.results.filter((r: BenchTaskResult) => r.patch?.trim()).length;
  console.log(chalk.bold(`  ${withPatch}/${run.results.length} instances produced a patch.`));
  console.log(chalk.dim(`  Predictions: ${path}`));
  console.log();
  console.log(chalk.dim('  Grade them with:'));
  console.log(chalk.cyan(
    `    python -m swebench.harness.run_evaluation --predictions_path ${path} \\\n` +
    `      --dataset_name princeton-nlp/SWE-bench_Verified --run_id cude`
  ));
  console.log();

  return run;
}

/** Terminal-Bench task directories, run locally. Never an official score. */
export async function runBenchTerminal(
  tasksDir: string,
  options: BenchCommandOptions = {}
): Promise<BenchRun> {
  const tasks = terminalBenchTasks(tasksDir, { limit: options.limit, filter: options.filter });
  return execute('terminal-bench', tasks, 'unofficial', options);
}

/** Lists what can be run without downloading anything. */
export function runBenchList(): void {
  console.log();
  console.log(chalk.bold.cyan('  Benchmark suites'));
  printSeparator();
  console.log();
  console.log(`  ${chalk.bold.white('local')}          ${chalk.dim(`${LOCAL_SUITE.length} tasks, graded by node --test — no Docker, no network`)}`);
  for (const task of LOCAL_SUITE) {
    console.log(`    ${chalk.dim('·')} ${task.id.replace('local/', '')} ${chalk.dim(`[${(task.tags ?? []).join(', ')}]`)}`);
  }
  console.log();
  console.log(`  ${chalk.bold.white('swebench')}       ${chalk.dim('needs the dataset file; emits predictions.jsonl for the official harness')}`);
  console.log(`  ${chalk.bold.white('terminal-bench')} ${chalk.dim('needs a checkout of the task directory; local mode only, never an official score')}`);
  console.log();
  console.log(chalk.dim('  Run:  ') + chalk.cyan('cude bench local --provider ollama --model qwen2.5-coder'));
  console.log(chalk.dim('        ') + chalk.cyan('cude bench swebench --dataset swe-bench-verified.jsonl --limit 25'));
  console.log();
}
