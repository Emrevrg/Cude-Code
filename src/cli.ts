import { Command } from 'commander';
import chalk from 'chalk';
import { showBanner, showWelcome } from './ui/display.js';
import { isFirstRun, markFirstRunDone } from './config/index.js';

export function createCLI(): Command {
  const program = new Command();

  program
    .name('cude')
    .description(chalk.cyan('AI-powered coding agent — code, automate, and ship faster'))
    .version('1.0.0')
    .option('--no-banner', 'Skip the banner display')
    .hook('preAction', (thisCommand) => {
      const opts = program.opts() as { banner: boolean };
      if (opts.banner !== false) {
        const name = thisCommand.name();
        if (['chat', 'run', 'setup', 'desktop'].includes(name)) {
          showBanner();
        }
      }
    });

  // ─── CHAT COMMAND ─────────────────────────────────────────────────────────
  program
    .command('chat')
    .description('Start an interactive AI chat session')
    .option('-p, --provider <name>', 'AI provider: anthropic|openai|gemini|groq|ollama|openrouter|nvidia|mistral|together|perplexity|deepseek|xai|cohere|azure|glm|lmstudio|vllm|litellm|replicate|huggingface|sglang|bedrock|openai-compatible')
    .option('-m, --model <name>', 'Model to use')
    .option('-s, --session <name>', 'Session name to continue or create')
    .option('--free', 'Use only free providers (Groq, Gemini flash, Ollama)')
    .option('-t, --task <type>', 'Task type hint: code|quick|complex|general|analysis|writing|research|reasoning|cheap', 'general')
    .option('-l, --lang <code>', 'Response language: tr|en|de|fr|es|it|pt|nl|pl|ru|ar|zh|ja|ko|sv  (overrides config)')
    .option('--system <prompt>', 'System prompt to set the AI behavior')
    .option('--no-history', 'Don\'t save chat history')
    .option('-c, --continue', 'Continue the most recent session')
    .action(async (options: {
      provider?: string;
      model?: string;
      session?: string;
      free?: boolean;
      task?: string;
      lang?: string;
      system?: string;
      history?: boolean;
      continue?: boolean;
    }) => {
      const { runChat } = await import('./commands/chat.js');
      await runChat({
        provider: options.provider,
        model: options.model,
        session: options.session,
        free: options.free ?? false,
        task: options.task as import('./core/selector.js').TaskType,
        lang: options.lang,
        system: options.system,
        noHistory: options.history === false,
        continue: options.continue ?? false,
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
    .option('--auto-commit', 'Auto git commit changes after task completes')
    .option('--git', 'Show git diff summary after task')
    .option('--team', 'Team mode: Planner → Executor → Reviewer (uses multiple models)')
    .action(async (task: string, options: {
      provider?: string;
      model?: string;
      free?: boolean;
      taskType?: string;
      verbose?: boolean;
      yes?: boolean;
      maxIterations?: string;
      autoCommit?: boolean;
      git?: boolean;
      team?: boolean;
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
        autoCommit: options.autoCommit ?? false,
        git: options.git ?? false,
        team: options.team ?? false,
      });
    });

  // ─── CONFIG COMMAND ───────────────────────────────────────────────────────
  const configCmd = program
    .command('config')
    .description('Manage configuration and API keys');

  configCmd
    .command('set-key <provider> [key]')
    .description('Set API key for provider (anthropic|openai|gemini|...) or tool: brave (web search)')
    .action(async (provider: string, key?: string) => {
      const { runConfigSetKey } = await import('./commands/config.js');
      await runConfigSetKey(provider, key);
    });

  configCmd
    .command('remove-key <provider>')
    .description('Remove API key for a provider')
    .action(async (provider: string) => {
      const { runConfigRemoveKey } = await import('./commands/config.js');
      await runConfigRemoveKey(provider);
    });

  configCmd
    .command('list-keys')
    .description('List all configured API keys (masked)')
    .action(async () => {
      const { runConfigListKeys } = await import('./commands/config.js');
      runConfigListKeys();
    });

  configCmd
    .command('set <setting> <value>')
    .description('Set a config value: default-provider | default-model | language')
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

  // ─── SETUP COMMAND (shorthand) ──────────────────────────────────────────
  program
    .command('setup')
    .description('Run the interactive setup wizard (alias for config setup)')
    .action(async () => {
      showBanner();
      const { runConfigWizard } = await import('./commands/config.js');
      await runConfigWizard();
    });

  // ─── DESKTOP COMMAND ──────────────────────────────────────────────────────
  program
    .command('desktop')
    .alias('gui')
    .description('Launch the Codiente Desktop GUI application (shares config with CLI)')
    .action(async () => {
      const { desktopCommand } = await import('./commands/desktop.js');
      await desktopCommand();
    });

  // ─── APPS COMMAND ─────────────────────────────────────────────────────────
  const appsCmd = program
    .command('apps')
    .description('Manage and use specialized AI apps / skills');

  appsCmd
    .command('list [query]')
    .description('List all available apps (optionally filter by query)')
    .action(async (query?: string) => {
      const { runAppsList } = await import('./commands/apps.js');
      await runAppsList(query);
    });

  appsCmd
    .command('info <id>')
    .description('Show detailed information about an app')
    .action(async (id: string) => {
      const { runAppsInfo } = await import('./commands/apps.js');
      await runAppsInfo(id);
    });

  appsCmd
    .command('install <id>')
    .description('Install an app (for future remote apps)')
    .action(async (id: string) => {
      const { runAppsInstall } = await import('./commands/apps.js');
      await runAppsInstall(id);
    });

  appsCmd
    .command('uninstall <id>')
    .description('Uninstall a custom app')
    .action(async (id: string) => {
      const { runAppsUninstall } = await import('./commands/apps.js');
      await runAppsUninstall(id);
    });

  appsCmd
    .command('use <id>')
    .description('Start a chat session with a specific app activated')
    .option('-p, --provider <name>', 'AI provider to use')
    .option('-m, --model <name>', 'Model to use')
    .option('--free', 'Use only free providers')
    .action(async (id: string, options: { provider?: string; model?: string; free?: boolean }) => {
      const { runAppsUse } = await import('./commands/apps.js');
      await runAppsUse(id, options);
    });

  appsCmd
    .command('create')
    .description('Interactive wizard to create a custom app')
    .action(async () => {
      const { runAppsCreate } = await import('./commands/apps.js');
      await runAppsCreate();
    });

  // ─── SERVE COMMAND ────────────────────────────────────────────────────────
  program
    .command('serve')
    .description('Start an OpenAI-compatible HTTP API server')
    .option('--port <number>', 'Port to listen on (default: 3141)', '3141')
    .option('-p, --provider <name>', 'AI provider to use')
    .option('-m, --model <name>', 'Model to use')
    .action(async (options: { port?: string; provider?: string; model?: string }) => {
      const { runServe } = await import('./commands/serve.js');
      await runServe({
        port: options.port ? parseInt(options.port, 10) : 3141,
        provider: options.provider,
        model: options.model,
      });
    });

  return program;
}

export async function checkFirstRun(): Promise<void> {
  if (isFirstRun()) {
    markFirstRunDone();
    showWelcome();
    if (process.argv.length <= 2) {
      process.exit(0);
    }
  }
}
