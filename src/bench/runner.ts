import { execSync, execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { tmpdir } from 'os';
import { runAgent, type AgentResult } from '../core/agent.js';
import { setWorkspaceRoot, resetWorkspaceRoot, setConfirmCallback, clearConfirmCallback } from '../core/tools.js';
import { scrubbedEnv } from '../core/security.js';
import type { BenchRun, BenchSummary, BenchTask, BenchTaskResult, Provenance, Verifier } from './types.js';

/**
 * Runs tasks and grades them.
 *
 * Tasks run one at a time. The workspace root and the process working
 * directory are both global, and the whole point of the sandbox is that a task
 * cannot see anything outside its own directory — running two at once would
 * mean one task's `run_command` executing in another's tree. Throughput comes
 * from the agent being faster per task, not from overlapping them.
 */

export interface BenchRunOptions {
  provider?: string;
  model?: string;
  mode?: string;
  free?: boolean;
  maxIterations?: number;
  /** Per-task wall-clock limit. Default 10 minutes. */
  timeoutMs?: number;
  /** Keep the sandbox directories for inspection. */
  keepSandbox?: boolean;
  /** Hand each task's verifier to the agent as its own check. */
  selfVerify?: boolean;
  onTaskStart?: (task: BenchTask, index: number, total: number) => void;
  onTaskEnd?: (result: BenchTaskResult, index: number, total: number) => void;
}

const DEFAULT_TASK_TIMEOUT_MS = 10 * 60 * 1000;

/** Runs a shell command in the sandbox, returning output and exit status. */
function shell(
  command: string,
  cwd: string,
  timeoutMs: number
): { code: number; output: string } {
  try {
    const output = execSync(command, {
      cwd,
      timeout: timeoutMs,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
      // The graders get the same scrubbed environment the agent's own commands
      // do, so a task cannot pass by reading a key out of the environment.
      env: scrubbedEnv(),
      windowsHide: true,
    });
    return { code: 0, output: output ?? '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string; message?: string };
    return {
      code: typeof e.status === 'number' ? e.status : 1,
      output: `${e.stdout ?? ''}${e.stderr ?? ''}` || (e.message ?? 'command failed'),
    };
  }
}

/** Grades one task. Independent of the agent: the shell decides, not the model. */
export function evaluate(verifier: Verifier, cwd: string): { passed: boolean; detail: string } {
  switch (verifier.kind) {
    case 'command': {
      const { code, output } = shell(verifier.command, cwd, verifier.timeoutMs ?? 120_000);
      return {
        passed: code === 0,
        detail: code === 0 ? '' : `\`${verifier.command}\` exited ${code}\n${output.slice(-2000)}`,
      };
    }
    case 'file_exists': {
      const there = existsSync(join(cwd, verifier.path));
      return { passed: there, detail: there ? '' : `${verifier.path} was never created` };
    }
    case 'file_absent': {
      const there = existsSync(join(cwd, verifier.path));
      return { passed: !there, detail: there ? `${verifier.path} still exists` : '' };
    }
    case 'restore_file': {
      const target = join(cwd, verifier.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, verifier.content, 'utf-8');
      return { passed: true, detail: '' };
    }
    case 'file_matches': {
      const path = join(cwd, verifier.path);
      if (!existsSync(path)) return { passed: false, detail: `${verifier.path} does not exist` };
      const content = readFileSync(path, 'utf-8');
      const matched = new RegExp(verifier.pattern, verifier.flags ?? '').test(content);
      return { passed: matched, detail: matched ? '' : `${verifier.path} does not match /${verifier.pattern}/` };
    }
    case 'all': {
      for (const child of verifier.of) {
        const outcome = evaluate(child, cwd);
        if (!outcome.passed) return outcome;
      }
      return { passed: true, detail: '' };
    }
  }
}

/** The verifier as a single shell command, when it is one — for `--self-verify`. */
function asCommand(verifier: Verifier): string | undefined {
  if (verifier.kind === 'command') return verifier.command;
  if (verifier.kind === 'all') {
    const commands = verifier.of.map(asCommand);
    if (commands.every(Boolean)) return commands.join(' && ');
  }
  return undefined;
}

function prepareSandbox(task: BenchTask): string {
  const dir = mkdtempSync(join(tmpdir(), `cude-bench-${task.id.replace(/[^\w.-]/g, '_')}-`));

  for (const [relativePath, contents] of Object.entries(task.files ?? {})) {
    const target = join(dir, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents, 'utf-8');
  }

  for (const command of task.setup ?? []) {
    const { code, output } = shell(command, dir, 5 * 60 * 1000);
    if (code !== 0) {
      throw new Error(`setup failed: \`${command}\` exited ${code}\n${output.slice(-1000)}`);
    }
  }

  return dir;
}

/** `git diff` for tasks that track a patch (SWE-bench). Empty when not a repo. */
function collectPatch(dir: string): string | undefined {
  try {
    return execFileSync('git', ['diff'], {
      cwd: dir,
      encoding: 'utf-8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return undefined;
  }
}

/** Rejects with a timeout rather than letting one task hang the sweep. */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${Math.round(ms / 1000)}s`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runTask(task: BenchTask, options: BenchRunOptions): Promise<BenchTaskResult> {
  const started = Date.now();
  const previousCwd = process.cwd();
  let sandbox: string | undefined;

  const base: BenchTaskResult = {
    taskId: task.id,
    suite: task.suite,
    passed: false,
    stopReason: 'error',
    iterations: 0,
    durationMs: 0,
    cost: 0,
    inputTokens: 0,
    outputTokens: 0,
    meta: task.meta,
  };

  try {
    sandbox = prepareSandbox(task);

    // The agent works inside the sandbox and nowhere else: the workspace root
    // confines its writes, and cwd is what its shell commands inherit.
    process.chdir(sandbox);
    setWorkspaceRoot(sandbox);
    // A benchmark run is unattended. Anything that would ask a human is
    // declined rather than silently approved.
    setConfirmCallback(async () => false);

    let agent: AgentResult;
    try {
      agent = await withTimeout(
        runAgent({
          task: task.prompt,
          mode: options.mode,
          provider: options.provider,
          model: options.model,
          free: options.free,
          maxIterations: task.maxIterations ?? options.maxIterations ?? 25,
          verifyCommand: options.selfVerify
            ? (task.agentVerifyCommand ?? asCommand(task.verify))
            : task.agentVerifyCommand,
        }),
        task.timeoutMs ?? options.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS,
        `task ${task.id}`
      );
    } catch (err) {
      const timedOut = err instanceof Error && /exceeded \d+s$/.test(err.message);
      // A task that timed out is still graded: the agent may well have
      // finished the work and then kept going.
      const outcome = evaluate(task.verify, sandbox);
      return {
        ...base,
        passed: outcome.passed,
        stopReason: timedOut ? 'timeout' : 'error',
        detail: outcome.passed ? undefined : `${err instanceof Error ? err.message : String(err)}\n${outcome.detail}`,
        durationMs: Date.now() - started,
      };
    }

    const outcome = evaluate(task.verify, sandbox);
    const patch = task.meta?.collectPatch ? collectPatch(sandbox) : undefined;

    return {
      ...base,
      passed: outcome.passed,
      detail: outcome.passed ? undefined : outcome.detail,
      stopReason: agent.stopReason,
      iterations: agent.iterations,
      durationMs: Date.now() - started,
      cost: agent.totalCost,
      inputTokens: agent.totalInputTokens,
      outputTokens: agent.totalOutputTokens,
      telemetry: agent.telemetry,
      patch,
    };
  } catch (err) {
    return {
      ...base,
      detail: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
  } finally {
    process.chdir(previousCwd);
    resetWorkspaceRoot();
    clearConfirmCallback();
    if (sandbox && !options.keepSandbox) {
      rmSync(sandbox, { recursive: true, force: true });
    }
  }
}

export function summarize(results: BenchTaskResult[]): BenchSummary {
  const durations = results.map(r => r.durationMs).sort((a, b) => a - b);
  const passed = results.filter(r => r.passed).length;

  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: results.length === 0 ? 0 : passed / results.length,
    totalCost: results.reduce((sum, r) => sum + r.cost, 0),
    totalIterations: results.reduce((sum, r) => sum + r.iterations, 0),
    medianDurationMs: durations.length === 0 ? 0 : durations[Math.floor(durations.length / 2)],
    toolCalls: results.reduce((sum, r) => sum + (r.telemetry?.toolCalls ?? 0), 0),
    toolErrors: results.reduce((sum, r) => sum + (r.telemetry?.toolErrors ?? 0), 0),
    repairedCalls: results.reduce((sum, r) => sum + (r.telemetry?.repairedCalls ?? 0), 0),
    compactions: results.reduce((sum, r) => sum + (r.telemetry?.compactions ?? 0), 0),
  };
}

export const PROVENANCE_CAVEAT: Record<Provenance, string | undefined> = {
  local: 'Cude\'s own suite, graded by this harness. Reproducible, but not comparable to any published leaderboard.',
  unofficial:
    'A public dataset run through Cude\'s harness rather than its official evaluator. ' +
    'Indicative only — do not quote it as a leaderboard result.',
  official: undefined,
};

export async function runSuite(
  suiteName: string,
  tasks: BenchTask[],
  provenance: Provenance,
  options: BenchRunOptions = {}
): Promise<BenchRun> {
  const startedAt = new Date().toISOString();
  const results: BenchTaskResult[] = [];

  for (let i = 0; i < tasks.length; i++) {
    options.onTaskStart?.(tasks[i], i, tasks.length);
    const result = await runTask(tasks[i], options);
    results.push(result);
    options.onTaskEnd?.(result, i, tasks.length);
  }

  return {
    suite: suiteName,
    provenance,
    startedAt,
    finishedAt: new Date().toISOString(),
    provider: options.provider ?? 'auto',
    model: options.model ?? 'auto',
    mode: options.mode ?? 'code',
    version: readVersion(),
    results,
    summary: summarize(results),
    caveat: PROVENANCE_CAVEAT[provenance],
  };
}

function readVersion(): string {
  try {
    const path = resolve(new URL('../../package.json', import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1'));
    return (JSON.parse(readFileSync(path, 'utf-8')) as { version?: string }).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
