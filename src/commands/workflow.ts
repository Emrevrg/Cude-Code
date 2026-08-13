import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, statSync, readFileSync } from 'node:fs';
import chalk from 'chalk';
import { selectProviderAndModel, type TaskType } from '../core/selector.js';
import { loadProjectContext, formatProjectContext, loadProjectSkills, formatProjectSkills } from '../core/context.js';
import { formatMemory, listMemory } from '../core/memory.js';
import { renderMarkdown, showError } from '../ui/display.js';
import type { Message } from '../providers/types.js';
import { runRun, type RunCommandOptions } from './run.js';
import { runReview } from './review.js';

const execFileAsync = promisify(execFile);
const SNAPSHOT_LIMIT = 16000;

export interface WorkflowOptions extends RunCommandOptions {
  json?: boolean;
}

export async function runWrite(task: string, options: WorkflowOptions = {}): Promise<void> {
  await runRun(
    `WRITE MODE: implement the requested change in the workspace. Keep the change focused, explain what you changed, and verify it with the most relevant tests.\n\nRequest: ${task}`,
    { ...options, task: 'code' as TaskType }
  );
}

async function projectSnapshot(target?: string): Promise<string> {
  let files = '';
  try {
    const result = await execFileAsync('git', ['ls-files'], { cwd: process.cwd(), windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
    files = result.stdout.split(/\r?\n/).filter(Boolean).slice(0, 300).join('\n');
  } catch {
    files = 'Git file listing unavailable.';
  }

  let selected = '';
  if (target) {
    const absolute = target;
    if (existsSync(absolute) && statSync(absolute).isFile()) {
      selected = readFileSync(absolute, 'utf8').slice(0, SNAPSHOT_LIMIT);
    } else {
      selected = `Target not found as a file: ${target}`;
    }
  }
  return `Project files:\n${files}${selected ? `\n\nTarget content (${target}):\n${selected}` : ''}`;
}

export async function runUnderstand(target: string | undefined, options: { provider?: string; model?: string; free?: boolean; json?: boolean } = {}): Promise<void> {
  const selected = selectProviderAndModel('analysis' as TaskType, {
    free: options.free ?? false,
    preferredProvider: options.provider,
    preferredModel: options.model,
  });
  const snapshot = await projectSnapshot(target);
  const systemPrompt = `You are Cude Code Understand mode. You are read-only: do not edit files, run commands, or claim to have changed anything.\n` +
    `Explain the architecture, important data flows, risks, and the next three highest-value actions. Distinguish observed facts from inferences.\n` +
    formatProjectContext(loadProjectContext()) + formatProjectSkills(loadProjectSkills()) +
    `\n--- Explicit project memory ---\n${formatMemory(listMemory())}`;
  const messages: Message[] = [{ role: 'user', content: `${target ? `Understand ${target}` : 'Understand this project'}:\n\n${snapshot}` }];
  try {
    const response = await selected.provider.chat(messages, selected.model, { systemPrompt, maxTokens: 4096 });
    if (options.json) {
      process.stdout.write(JSON.stringify({ mode: 'understand', target: target ?? null, provider: selected.provider.name, model: selected.model, summary: response.content }) + '\n');
      return;
    }
    console.log(chalk.bold.cyan(`\n  Cude Understand · ${selected.provider.displayName} / ${selected.model}\n`));
    console.log(renderMarkdown(response.content));
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export async function runProduce(task: string, options: WorkflowOptions = {}): Promise<void> {
  console.log(chalk.bold.cyan('\n  Cude Produce · implement, verify, review\n'));
  await runRun(
    `PRODUCE MODE: deliver a complete, reviewable result. Implement the request, run relevant verification, and leave a concise completion summary. Do not stop at a plan.\n\nRequest: ${task}`,
    { ...options, task: 'complex' as TaskType }
  );
  if (process.exitCode && process.exitCode !== 0) return;
  console.log(chalk.bold.cyan('\n  Cude Produce · final change review\n'));
  await runReview({ provider: options.provider, model: options.model, free: options.free, json: false });
}
