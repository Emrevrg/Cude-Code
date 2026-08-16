import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { BenchTask } from '../types.js';

/**
 * Terminal-Bench adapter, local mode.
 *
 * Terminal-Bench grades inside Docker containers it builds itself, driven by
 * its own `tb` runner. This adapter does something narrower and says so: it
 * reads a task directory, hands the instruction to the agent in a sandbox, and
 * runs whatever test script the task ships. That is useful for development —
 * it exercises the same instructions against the same expectations — and it is
 * not a Terminal-Bench score. Runs made this way are labelled `unofficial` and
 * the report repeats the caveat.
 *
 * For a number that can be quoted, run the official harness with Cude as the
 * agent under test.
 */

export interface TerminalBenchTaskFile {
  instruction?: string;
  /** Some versions nest it. */
  task?: { instruction?: string };
  descriptions?: Array<{ description?: string }>;
  max_agent_timeout_sec?: number;
}

/**
 * Minimal YAML reading for the two fields that matter. A full parser is not
 * worth a dependency here, and anything this cannot read is reported rather
 * than guessed at.
 */
export function readInstruction(yamlText: string): string | null {
  // Block scalar: `instruction: |` followed by an indented body.
  const block = yamlText.match(/^instruction:\s*[|>][-+]?\s*\n((?:[ \t]+.*\n?)+)/m);
  if (block) {
    const lines = block[1].split('\n');
    const indent = lines.find(l => l.trim())?.match(/^[ \t]*/)?.[0].length ?? 0;
    return lines.map(l => l.slice(indent)).join('\n').trim();
  }

  // Single line, quoted or bare.
  const inline = yamlText.match(/^instruction:\s*(?:"([^"]*)"|'([^']*)'|(.+))$/m);
  if (inline) return (inline[1] ?? inline[2] ?? inline[3] ?? '').trim();

  return null;
}

/** The test command a task ships, in the order Terminal-Bench tasks tend to use. */
function testCommandFor(dir: string): string | null {
  if (existsSync(join(dir, 'run-tests.sh'))) return 'sh run-tests.sh';
  if (existsSync(join(dir, 'tests', 'run-tests.sh'))) return 'sh tests/run-tests.sh';
  if (existsSync(join(dir, 'tests'))) return 'python -m pytest tests -q';
  return null;
}

/** Copies a task directory into the sandbox and stages its instruction. */
export function terminalBenchTasks(
  tasksDir: string,
  options: { limit?: number; filter?: string } = {}
): BenchTask[] {
  if (!existsSync(tasksDir)) {
    throw new Error(
      `No such directory: ${tasksDir}\n` +
      `Point --tasks at a Terminal-Bench "tasks" directory ` +
      `(git clone https://github.com/laude-institute/terminal-bench).`
    );
  }

  const entries = readdirSync(tasksDir)
    .filter(name => {
      try {
        return statSync(join(tasksDir, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .filter(name => !options.filter || new RegExp(options.filter, 'i').test(name))
    .sort();

  const tasks: BenchTask[] = [];

  for (const name of entries) {
    if (options.limit && tasks.length >= options.limit) break;

    const dir = join(tasksDir, name);
    const yamlPath = ['task.yaml', 'task.yml'].map(f => join(dir, f)).find(existsSync);
    if (!yamlPath) continue;

    const instruction = readInstruction(readFileSync(yamlPath, 'utf-8'));
    if (!instruction) continue;

    const testCommand = testCommandFor(dir);
    const posixDir = dir.replace(/\\/g, '/');

    tasks.push({
      id: `terminal-bench/${name}`,
      suite: 'terminal-bench',
      prompt: instruction,
      // Copy the task's own files in, minus the tests it is graded by where
      // that separation exists in the task layout.
      setup: [
        `node -e "require('fs').cpSync(${JSON.stringify(posixDir)}, '.', { recursive: true })"`,
      ],
      verify: testCommand
        ? { kind: 'command', command: testCommand, timeoutMs: 300_000 }
        : { kind: 'file_exists', path: '.' },
      maxIterations: 40,
      timeoutMs: 15 * 60 * 1000,
      tags: ['terminal-bench', 'unofficial'],
      meta: { source: dir, hasTests: Boolean(testCommand) },
    });
  }

  if (tasks.length === 0) {
    throw new Error(`No readable Terminal-Bench tasks found in ${tasksDir}.`);
  }

  return tasks;
}
