import chalk from 'chalk';
import { selectProviderAndModel, type TaskType } from '../core/selector.js';
import { loadProjectContext, formatProjectContext, loadProjectSkills, formatProjectSkills } from '../core/context.js';
import { renderMarkdown, showError } from '../ui/display.js';
import type { Message } from '../providers/types.js';

export interface PlanOptions {
  provider?: string;
  model?: string;
  free?: boolean;
  json?: boolean;
}

export async function runPlan(task: string, options: PlanOptions = {}): Promise<void> {
  if (!task.trim()) {
    showError('Please provide a task to plan.');
    process.exitCode = 1;
    return;
  }
  const selected = selectProviderAndModel('complex' as TaskType, {
    free: options.free ?? false,
    preferredProvider: options.provider,
    preferredModel: options.model,
  });
  const systemPrompt = `You are Cude Code Plan mode. Do not edit files, run commands, or claim work is complete.\n` +
    `Produce an actionable implementation plan with phases, files likely involved, risks, and verification commands.\n` +
    formatProjectContext(loadProjectContext()) + formatProjectSkills(loadProjectSkills());
  const messages: Message[] = [{ role: 'user', content: task }];
  try {
    const response = await selected.provider.chat(messages, selected.model, { systemPrompt, maxTokens: 4096 });
    if (options.json) {
      process.stdout.write(JSON.stringify({ task, provider: selected.provider.name, model: selected.model, plan: response.content }) + '\n');
      return;
    }
    console.log(chalk.bold.cyan(`\n  Cude Plan · ${selected.provider.displayName} / ${selected.model}`));
    console.log(chalk.dim(`  Task: ${task}\n`));
    console.log(renderMarkdown(response.content));
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
