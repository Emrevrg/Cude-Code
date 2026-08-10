import readline from 'readline';
import chalk from 'chalk';
import { runAgent } from '../core/agent.js';
import { runTeamAgent, type TeamAgentResult } from '../core/team.js';
import { selectProviderAndModel, type TaskType } from '../core/selector.js';
import { showError, showSuccess, showCostInfo, renderMarkdown } from '../ui/display.js';
import { agentAnim, printAgentHeader, stopAnimator, startTimer, registerCtrlC } from '../ui/animate.js';

export interface RunCommandOptions {
  provider?: string;
  model?: string;
  free?: boolean;
  task?: TaskType;
  verbose?: boolean;
  yes?: boolean;
  maxIterations?: number;
  autoCommit?: boolean;
  git?: boolean;
  team?: boolean;
}

async function getUserConfirmation(message: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`\n  ${chalk.yellow('?')} ${message} ${chalk.dim('[y/N]')}: `, answer => {
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
    autoCommit = false,
    git: showGit = false,
    team = false,
  } = options;

  if (!task || task.trim().length === 0) {
    showError('Please provide a task description.\nExample: cude run "Fix TypeScript errors in src/"');
    process.exit(1);
  }

  if (team) { await runTeamMode(task, options); return; }

  // ── Provider selection ─────────────────────────────────────────────────────
  let provider: Awaited<ReturnType<typeof selectProviderAndModel>>['provider'];
  let model: string;
  let reason: string;
  try {
    const sel = selectProviderAndModel(taskType, { free, preferredProvider, preferredModel });
    provider = sel.provider;
    model    = sel.model;
    reason   = sel.reason;
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  printAgentHeader({
    task, provider: provider.displayName, model,
    maxIter: maxIterations, autoCommit,
  });

  if (reason) console.log(chalk.dim(`  ↳ ${reason}\n`));

  if (!yes) {
    const ok = await getUserConfirmation('Proceed with this task?');
    if (!ok) { console.log(chalk.dim('\n  Task cancelled.\n')); return; }
  }

  startTimer();
  const unregisterCtrlC = registerCtrlC(() => stopAnimator());

  let stepCount = 0;
  agentAnim.think(++stepCount, maxIterations);

  try {
    const result = await runAgent({
      task, taskType, free,
      provider: provider.name, model,
      maxIterations, verbose, autoCommit,

      onProgress: (msg) => {
        if (!msg.includes('running ')) agentAnim.think(stepCount, maxIterations);
      },

      onToolCall: (name, args) => {
        agentAnim.toolStart(name, args);
      },

      onToolResult: (name, success, output) => {
        agentAnim.toolDone(name, success, output);
        agentAnim.think(++stepCount, maxIterations);
      },

      onConfirm: async (message) => {
        stopAnimator();
        const ok = await getUserConfirmation(message);
        if (ok) agentAnim.think(stepCount, maxIterations);
        return ok;
      },
    });

    unregisterCtrlC();

    agentAnim.finish(result.success, result.output, {
      cost:   result.totalCost,
      tokens: result.totalInputTokens + result.totalOutputTokens,
      steps:  stepCount,
    });

    if ((showGit || autoCommit) && result.gitSummary) {
      console.log();
      console.log(chalk.dim('  ─── Git ' + '─'.repeat(Math.max(8, Math.min(40, (process.stdout.columns ?? 72) - 12)))));
      result.gitSummary.split('\n').forEach(l => console.log(chalk.dim('  ') + chalk.hex('#3b82f6')(l)));
    }

    console.log();
    if (result.success) showSuccess(`Completed in ${result.iterations} iteration${result.iterations !== 1 ? 's' : ''}`);

  } catch (err) {
    stopAnimator(false, 'Task failed');
    console.log();
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED')) {
      showError(
        `Connection failed for ${provider.displayName}.\n\n` +
        (provider.name === 'ollama'
          ? 'Ollama is not running. Start it with:  ollama serve\nOr use a different provider:  cude setup'
          : `Check your internet connection or try:\n  cude run --provider groq "${task}"`)
      );
    } else {
      showError(msg);
    }
    process.exit(1);
  }
}

// ── Team mode ─────────────────────────────────────────────────────────────────

async function runTeamMode(task: string, options: RunCommandOptions): Promise<void> {
  const { free = false, verbose = false, yes = false, maxIterations = 10, autoCommit = false, git: showGit = false } = options;

  const W = 56;
  const border = chalk.hex('#7c3aed');
  console.log();
  console.log(border('  ┌' + '─'.repeat(W + 2) + '┐'));
  console.log(border('  │ ') + chalk.bold.hex('#7c3aed')('◈ Codiente Team Agent'.padEnd(W))      + border(' │'));
  console.log(border('  │ ') + chalk.dim('─'.repeat(W))                                           + border(' │'));
  console.log(border('  │ ') + chalk.white(('Task: ' + task).slice(0, W).padEnd(W))               + border(' │'));
  console.log(border('  │ ') + chalk.hex('#10b981')('Mode: Planner → Executor → Reviewer'.padEnd(W)) + border(' │'));
  console.log(border('  └' + '─'.repeat(W + 2) + '┘'));
  console.log();

  if (!yes) {
    const ok = await getUserConfirmation('Run in team mode? (uses multiple models)');
    if (!ok) { console.log(chalk.dim('\n  Cancelled.\n')); return; }
  }

  let stepCount = 0;
  agentAnim.think(++stepCount);

  try {
    const result = await runTeamAgent({
      task, free, preferredProvider: options.provider, preferredModel: options.model,
      maxIterations, verbose, autoCommit,
      onProgress: (msg) => {
        stopAnimator();
        console.log(chalk.dim('  › ') + chalk.hex('#06b6d4')(msg));
        agentAnim.think(++stepCount);
      },
      onConfirm: async (message) => {
        stopAnimator();
        const ok = await getUserConfirmation(message);
        if (ok) agentAnim.think(stepCount);
        return ok;
      },
    });

    stopAnimator(result.success, result.success ? 'Team task complete!' : 'Finished with issues');

    // Team details
    console.log();
    console.log(chalk.dim('  Planner:  ') + chalk.hex('#06b6d4')(result.plannerModel));
    console.log(chalk.dim('  Executor: ') + chalk.hex('#3b82f6')(result.executorModel));
    console.log(chalk.dim('  Reviewer: ') + chalk.hex('#10b981')(result.reviewerModel));

    if (result.plan.length > 1) {
      console.log();
      console.log(chalk.bold('  Execution plan:'));
      result.plan.forEach((step, i) => {
        const r    = result.stepResults[i];
        const icon = r?.success ? chalk.green('✓') : chalk.red('✗');
        console.log(`  ${icon} ${chalk.dim(`${i + 1}.`)} ${chalk.white(step.slice(0, 80))}${step.length > 80 ? '…' : ''}`);
      });
    }

    if (result.output) {
      console.log();
      console.log(chalk.bold.white('  Review & Summary:'));
      console.log();
      const rendered = renderMarkdown(result.output);
      rendered.split('\n').forEach(l => console.log('  ' + l));
    }

    if ((showGit || autoCommit) && result.gitSummary) {
      console.log();
      console.log(chalk.dim('  ─── Git ' + '─'.repeat(Math.max(8, Math.min(40, (process.stdout.columns ?? 72) - 12)))));
      result.gitSummary.split('\n').forEach(l => console.log(chalk.dim('  ') + chalk.hex('#3b82f6')(l)));
    }

    console.log();
    console.log(chalk.dim('  Steps:  ') + `${result.stepResults.filter(r => r.success).length}/${result.plan.length} completed`);
    showCostInfo(result.totalCost, result.totalInputTokens, result.totalOutputTokens);
    console.log();

    if (result.success) showSuccess('Team task completed successfully');

  } catch (err) {
    stopAnimator(false, 'Team task failed');
    console.log();
    showError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
