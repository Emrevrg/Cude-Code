import chalk from 'chalk';
import { cancelClawJob, enqueueClawJob, listClawJobs, runClawDaemon } from '../core/claw.js';
import type { TaskType } from '../core/selector.js';

export function runClawList(): void {
  const jobs = listClawJobs();
  console.log(chalk.bold.cyan('\n  CudeClaw durable queue'));
  if (!jobs.length) console.log(chalk.dim('  No jobs. Queue one with: cude claw add "task"'));
  for (const job of jobs) console.log('  ' + chalk.cyan(job.id.slice(0, 8)) + '  ' + job.status.padEnd(10) + '  ' + job.task.slice(0, 100));
  console.log();
}
export function runClawAdd(task: string, options: { provider?: string; model?: string; taskType?: string; maxIterations?: string }): void {
  const job = enqueueClawJob({ task, provider: options.provider, model: options.model, taskType: options.taskType as TaskType | undefined, maxIterations: Number(options.maxIterations ?? 10) });
  console.log(chalk.green('  Queued CudeClaw job ' + job.id));
  console.log(chalk.dim('  Start worker: cude claw worker'));
}
export function runClawCancel(id: string): void { console.log(cancelClawJob(id) ? chalk.green('  Job cancelled') : chalk.yellow('  Job not found or already running/completed')); }
export async function runClawWorker(options: { interval?: string; once?: boolean }): Promise<void> {
  console.log(chalk.cyan('  CudeClaw worker started. Jobs persist under ~/.cude/claw-jobs.json'));
  await runClawDaemon({ intervalMs: Math.max(1000, Number(options.interval ?? 15) * 1000), once: options.once });
}
