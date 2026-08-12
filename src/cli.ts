import { Command } from 'commander';
import chalk from 'chalk';
import { showBanner } from './ui/display.js';
import { isFirstRun, markFirstRunDone } from './config/index.js';

export function createCLI(): Command {
  const program = new Command();

  program
    .name('cude')
    .description(chalk.cyan('Cude Code — autonomous AI development CLI for your terminal'))
    .version('0.1.0')
    .option('--no-banner', 'Skip the banner display')
    .hook('preAction', (thisCommand) => {
      const opts = program.opts() as { banner: boolean };
      if (opts.banner !== false) {
        // Only show banner on top-level commands, not sub-commands
        const name = thisCommand.name();
        if (['chat', 'run'].includes(name)) {
          showBanner();
        }
      }
    });

  // ─── CHAT COMMAND ─────────────────────────────────────────────────────────
  program
    .command('chat')
    .description('Start an interactive AI chat session')
    .option('-p, --provider <name>', 'AI provider: anthropic|openai|gemini|groq|ollama|openrouter|nvidia|mistral|together|perplexity|deepseek|xai|cohere|azure|litellm|huggingface|vllm|replicate|gguf')
    .option('-m, --model <name>', 'Model to use')
    .option('-s, --session <name>', 'Session name to continue or create')
    .option('--free', 'Use only free providers (Groq, Gemini flash, Ollama)')
    .option('-t, --task <type>', 'Task type hint: code|quick|complex|general|analysis|writing', 'general')
    .option('--system <prompt>', 'System prompt to set the AI behavior')
    .option('--no-history', 'Don\'t save chat history')
    .action(async (options: {
      provider?: string;
      model?: string;
      session?: string;
      free?: boolean;
      task?: string;
      system?: string;
      history?: boolean;
    }) => {
      const { runChat } = await import('./commands/chat.js');
      await runChat({
        provider: options.provider,
        model: options.model,
        session: options.session,
        free: options.free ?? false,
        task: options.task as import('./core/selector.js').TaskType,
        system: options.system,
        noHistory: options.history === false,
      });
    });

  // ─── RUN COMMAND ──────────────────────────────────────────────────────────
  program
    .command('run <task>')
    .description('Run an autonomous agent to complete a task')
    .option('-p, --provider <name>', 'AI provider to use')
    .option('-m, --model <name>', 'Model to use')
    .option('--free', 'Use only free providers')
    .option('-t, --task-type <type>', 'Task type: code|quick|complex|general', 'code')
    .option('-v, --verbose', 'Show detailed execution steps')
    .option('-y, --yes', 'Skip confirmation prompt')
    .option('--max-iterations <n>', 'Maximum agent iterations (default: 10)', '10')
    .action(async (task: string, options: {
      provider?: string;
      model?: string;
      free?: boolean;
      taskType?: string;
      verbose?: boolean;
      yes?: boolean;
      maxIterations?: string;
    }) => {
      const { runRun } = await import('./commands/run.js');
      await runRun(task, {
        provider: options.provider,
        model: options.model,
        free: options.free ?? false,
        task: options.taskType as import('./core/selector.js').TaskType,
        verbose: options.verbose ?? false,
        yes: options.yes ?? false,
        maxIterations: parseInt(options.maxIterations ?? '10', 10),
      });
    });

  // ─── CONFIG COMMAND ───────────────────────────────────────────────────────
  const configCmd = program
    .command('config')
    .description('Manage configuration and API keys');

  configCmd
    .command('set-key <provider> [key]')
    .description('Set an API key, or a <provider>-endpoint URL (azure-endpoint|litellm-endpoint|vllm-endpoint|gguf-endpoint)')
    .action(async (provider: string, key?: string) => {
      const { runConfigSetKey } = await import('./commands/config.js');
      await runConfigSetKey(provider, key);
    });

  configCmd
    .command('set-endpoint <provider> [url]')
    .description('Set the endpoint URL for a self-hosted provider (azure|litellm|vllm|gguf)')
    .action(async (provider: string, url?: string) => {
      const { runConfigSetEndpoint } = await import('./commands/config.js');
      await runConfigSetEndpoint(provider, url);
    });

  configCmd
    .command('remove-key <provider>')
    .description('Remove an API key or endpoint for a provider')
    .action(async (provider: string) => {
      const { runConfigRemoveKey } = await import('./commands/config.js');
      await runConfigRemoveKey(provider);
    });

  configCmd
    .command('list-keys')
    .alias('list')
    .description('List configured API keys (masked), endpoints and defaults')
    .action(async () => {
      const { runConfigListKeys } = await import('./commands/config.js');
      runConfigListKeys();
    });

  configCmd
    .command('set <setting> <value>')
    .description('Set a configuration value (default-provider, default-model, <provider>-endpoint)')
    .action(async (setting: string, value: string) => {
      const { runConfigSet } = await import('./commands/config.js');
      await runConfigSet(setting, value);
    });

  configCmd
    .command('setup')
    .description('Run the interactive setup wizard')
    .action(async () => {
      const { runConfigWizard } = await import('./commands/config.js');
      await runConfigWizard();
    });

  // ─── BUDGET COMMAND ───────────────────────────────────────────────────────
  const budgetCmd = program
    .command('budget')
    .description('Manage spending limits and view costs');

  budgetCmd
    .command('set <amount>')
    .description('Set spending limit in USD')
    .option('--monthly', 'Set as monthly limit instead of total')
    .action(async (amount: string, options: { monthly?: boolean }) => {
      const { runBudgetSet } = await import('./commands/budget.js');
      await runBudgetSet(amount, { monthly: options.monthly });
    });

  budgetCmd
    .command('status')
    .description('View current spending and budget status')
    .action(async () => {
      const { runBudgetStatus } = await import('./commands/budget.js');
      await runBudgetStatus();
    });

  budgetCmd
    .command('reset')
    .description('Reset spending counters (preserves limits)')
    .action(async () => {
      const { runBudgetReset } = await import('./commands/budget.js');
      await runBudgetReset();
    });

  budgetCmd
    .command('alert <amount>')
    .description('Set an alert threshold in USD')
    .action(async (amount: string) => {
      const { runBudgetAlert } = await import('./commands/budget.js');
      await runBudgetAlert(amount);
    });

  // ─── SESSIONS COMMAND ─────────────────────────────────────────────────────
  const sessionsCmd = program
    .command('sessions')
    .description('Manage chat sessions');

  sessionsCmd
    .command('list')
    .description('List all chat sessions')
    .action(async () => {
      const { runSessionsList } = await import('./commands/sessions.js');
      await runSessionsList();
    });

  sessionsCmd
    .command('continue <id>')
    .description('Continue a previous session by ID or name')
    .action(async (id: string) => {
      const { runSessionsContinue } = await import('./commands/sessions.js');
      await runSessionsContinue(id);
    });

  sessionsCmd
    .command('delete <id>')
    .description('Delete a session by ID or name')
    .action(async (id: string) => {
      const { runSessionsDelete } = await import('./commands/sessions.js');
      await runSessionsDelete(id);
    });

  sessionsCmd
    .command('export <id> [output]')
    .description('Export a session to markdown')
    .action(async (id: string, output?: string) => {
      const { runSessionsExport } = await import('./commands/sessions.js');
      await runSessionsExport(id, output);
    });

  // ─── PROVIDERS COMMAND ────────────────────────────────────────────────────
  const providersCmd = program
    .command('providers')
    .description('Manage and view AI providers');

  providersCmd
    .command('list')
    .description('List all providers with their status')
    .action(async () => {
      const { runProvidersList } = await import('./commands/providers.js');
      await runProvidersList();
    });

  providersCmd
    .command('test')
    .description('Test all configured providers')
    .action(async () => {
      const { runProvidersTest } = await import('./commands/providers.js');
      await runProvidersTest();
    });

  providersCmd
    .command('models [provider]')
    .description('List available models (optionally filtered by provider)')
    .action(async (provider?: string) => {
      const { runProvidersModels } = await import('./commands/providers.js');
      await runProvidersModels(provider);
    });

  // ─── SETUP COMMAND (shorthand) ────────────────────────────────────────────
  program
    .command('setup')
    .description('Run the interactive setup wizard (alias for config setup)')
    .action(async () => {
      showBanner();
      const { runConfigWizard } = await import('./commands/config.js');
      await runConfigWizard();
    });

  return program;
}

export async function checkFirstRun(): Promise<void> {
  if (isFirstRun()) {
    markFirstRunDone();
    console.log();
    console.log(chalk.bold.cyan('  Welcome to Cude Code! 🚀'));
    console.log(chalk.dim('  The professional open-source AI Development CLI'));
    console.log();
    console.log(chalk.dim('  Quick start:'));
    console.log(chalk.cyan('    cude setup          ') + chalk.dim('# Configure API keys & providers'));
    console.log(chalk.cyan('    cude chat --free    ') + chalk.dim('# Chat for free (Groq/Gemini/Ollama)'));
    console.log(chalk.cyan('    cude run "task"     ') + chalk.dim('# Run an autonomous agent'));
    console.log(chalk.cyan('    cude providers list ') + chalk.dim('# See available providers'));
    console.log();
  }
}
