import { mkdirSync } from 'fs';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);
export interface WorkerTask { id: string; task: string; worktree: string; result?: unknown; error?: string; }

/** Run independent Cude agents in detached git worktrees. No automatic merge. */
export async function runIsolatedWorkers(tasks: string[], cwd = process.cwd()): Promise<WorkerTask[]> {
  const root = join(cwd, '.cude', 'worktrees'); mkdirSync(root, { recursive: true });
  return Promise.all(tasks.map(async (task, index): Promise<WorkerTask> => {
    const id = `worker-${Date.now()}-${index + 1}`; const worktree = join(root, id); const item: WorkerTask = { id, task, worktree };
    try {
      await execFileAsync('git', ['worktree', 'add', '--detach', worktree, 'HEAD'], { cwd, windowsHide: true });
      const output = await execFileAsync(process.execPath, [join(cwd, 'dist', 'index.js'), '--no-banner', 'run', task, '--yes', '--json'], { cwd: worktree, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
      const line = output.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1); item.result = line ? JSON.parse(line) : { output: output.stdout };
    } catch (error) { item.error = error instanceof Error ? error.message : String(error); }
    return item;
  }));
}
