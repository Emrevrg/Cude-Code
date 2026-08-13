import chalk from 'chalk';
import { runIsolatedWorkers } from '../core/workers.js';
export async function runTaskWorkers(tasks: string[], json = false): Promise<void> {
  const results = await runIsolatedWorkers(tasks);
  if (json) { process.stdout.write(JSON.stringify({ workers: results }) + '\n'); return; }
  console.log(chalk.bold.cyan('\n  Cude isolated workers'));
  for (const item of results) { console.log(`  ${chalk.cyan(item.id)} ${chalk.dim(item.worktree)}`); if (item.error) console.log(chalk.red(`    failed: ${item.error}`)); else console.log(chalk.green('    completed; changes remain isolated in the worktree')); }
  console.log(chalk.dim('\n  No worker changes were merged automatically. Review and merge deliberately.\n'));
}
