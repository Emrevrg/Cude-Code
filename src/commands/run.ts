import readline from 'readline';
import chalk from 'chalk';
import { runAgent } from '../core/agent.js';
import { selectProviderAndModel, type TaskType } from '../core/selector.js';
import { startSpinner, stopSpinner, updateSpinner } from '../ui/spinner.js';
import { showError, showSuccess, showCostInfo, renderMarkdown } from '../ui/display.js';
import type { AgentStep } from '../core/agent.js';

export interface RunCommandOptions {
  provider?: string;
  model?: string;
  free?: boolean;
  task?: TaskType;
  verbose?: boolean;
  yes?: boolean; // Skip confirmation
  maxIterations?: number;
}

function formatStep(step: AgentStep): string {
  switch (step.type) {
    case 'thought':
      return chalk.cyan('  Thinking: ') + chalk.dim(step.content.substring(0, 100)) + (step.content.length > 100 ? '...' : '');
    case 'tool_call':
      return chalk.yellow(`  Tool: ${step.toolName ?? ''}`) + chalk.dim(`(${JSON.stringify(step.toolArgs ?? {}).substring(0, 80)})`);
    case 'tool_result':
      return chalk.green('  Result: ') + chalk.dim(step.content.substring(0, 100)) + (step.content.length > 100 ? '...' : '');
    case 'final':
      return '';
    default:
      return '';
  }
}

async function getUserConfirmation(message: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`  ${chalk.yellow('?')} ${message} ${chalk.dim('[y/N]')}: `, answer => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

export async function runRun(task: string, options: RunCommandOptions = {}): Promise<void> {
  const {
    provider: preferredProvider,
    model: preferredModel,
    free = false,
    task: taskType = 'code',
    verbose = false,
    yes = false,
    maxIterations = 10,
  } = options;

  if (!task || task.trim().length === 0) {
    showError('Please provide a task description.\nExample: cude run "create a React todo app in ./myapp"');
    process.exit(1);
  }

  // Show selected provider
  const { provider, model, reason } = selectProviderAndModel(taskType, {
    free,
    preferredProvider,
    preferredModel,
  });

  console.log();
  console.log(chalk.bold.cyan('  Cude Agent'));
  console.log(chalk.dim('  ─────────────────────────────────'));
  console.log(chalk.dim('  Task:     ') + chalk.white(task));
  console.log(chalk.dim('  Provider: ') + chalk.cyan(provider.displayName));
  console.log(chalk.dim('  Model:    ') + chalk.cyan(model));
  if (reason) console.log(chalk.dim(`  (${reason})`));
  console.log();

  // Ask for confirmation unless --yes flag
  if (!yes) {
    const confirmed = await getUserConfirmation('Proceed with this task?');
    if (!confirmed) {
      console.log(chalk.dim('\n  Task cancelled.\n'));
      return;
    }
    console.log();
  }

  let spinner = startSpinner('Starting agent...');
  let stepCount = 0;

  try {
    const result = await runAgent({
      task,
      taskType,
      free,
      provider: preferredProvider,
      model: preferredModel,
      maxIterations,
      verbose,
      onProgress: (step) => {
        stepCount++;
        updateSpinner(`${step} (${stepCount} steps)`);
      },
      onConfirm: async (message) => {
        stopSpinner(false);
        const confirmed = await getUserConfirmation(message);
        if (confirmed) {
          spinner = startSpinner('Continuing...');
        }
        return confirmed;
      },
    });

    stopSpinner(result.success, result.success ? 'Task completed!' : 'Task failed');

    console.log();

    if (verbose && result.steps.length > 0) {
      console.log(chalk.bold('  Execution Steps:'));
      for (const step of result.steps) {
        const formatted = formatStep(step);
        if (formatted) console.log(formatted);
      }
      console.log();
    }

    if (result.output) {
      console.log(chalk.bold.white('  Result:'));
      console.log();
      // Extract just the meaningful part after "TASK COMPLETE:"
      const cleanOutput = result.output
        .replace(/TASK COMPLETE:\s*/i, '')
        .replace(/Task complete:\s*/i, '');

      const rendered = renderMarkdown(cleanOutput);
      const lines = rendered.split('\n').map(l => '  ' + l).join('\n');
      console.log(lines);
    }

    console.log();
    console.log(chalk.dim('  ─────────────────────────────────'));
    console.log(chalk.dim('  Iterations: ') + result.iterations);
    showCostInfo(result.totalCost, result.totalInputTokens, result.totalOutputTokens);
    console.log();

    if (result.success) {
      showSuccess(`Task completed in ${result.iterations} iteration${result.iterations !== 1 ? 's' : ''}`);
    }

  } catch (err) {
    stopSpinner(false, 'Task failed');
    console.log();
    showError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
