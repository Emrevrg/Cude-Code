import { Command } from 'commander';
import chalk from 'chalk';
import { showBanner } from './ui/display.js';
import { isFirstRun, markFirstRunDone } from './config/index.js';

/** Commander repeatable option collector. */
function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/** Commander hands every option through as a string; the harness wants numbers. */
function parseBenchOptions(options: Record<string, string | boolean | undefined>) {
  const number = (value: string | boolean | undefined): number | undefined => {
    if (typeof value !== 'string') return undefined;
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  return {
    provider: options.provider as string | undefined,
    model: options.model as string | undefined,
    mode: options.mode as string | undefined,
    free: options.free === true,
    filter: options.filter as string | undefined,
    limit: number(options.limit),
    maxIterations: number(options.maxIterations),
    selfVerify: options.selfVerify === true,
    keepSandbox: options.keepSandbox === true,
    json: options.json === true,
    out: options.out as string | undefined,
  };
}

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
        if (['chat', 'run', 'claw'].includes(name)) {
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
    .option('--mode <name>', 'Agent mode: code|architect|ask|debug|orchestrator', 'code')
    .action(async (task: string, options: {
      provider?: string;
      model?: string;
      free?: boolean;
      taskType?: string;
      verbose?: boolean;
      yes?: boolean;
      maxIterations?: string;
      mode?: string;
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
        mode: options.mode,
      });
    });

  // ─── CLAW COMMAND ─────────────────────────────────────────────────────────
  program
    .command('claw [task]')
    .description('Interactive agent session — keeps context between turns and shows every edit before it happens')
    .option('-p, --provider <name>', 'AI provider to use')
    .option('-m, --model <name>', 'Model to use')
    .option('--mode <name>', 'Agent mode: code|architect|ask|debug|orchestrator', 'code')
    .option('--free', 'Use only free providers')
    .option('-y, --yes', 'Apply edits without asking')
    .option('--max-iterations <n>', 'Maximum steps per turn (default: 12)', '12')
    .action(async (task: string | undefined, options: {
      provider?: string;
      model?: string;
      mode?: string;
      free?: boolean;
      yes?: boolean;
      maxIterations?: string;
    }) => {
      const { runClaw } = await import('./commands/claw.js');
      await runClaw(task, {
        provider: options.provider,
        model: options.model,
        mode: options.mode,
        free: options.free ?? false,
        yes: options.yes ?? false,
        maxIterations: parseInt(options.maxIterations ?? '12', 10),
      });
    });

  // ─── MODES COMMAND ────────────────────────────────────────────────────────
  const modesCmd = program
    .command('modes')
    .description('Agent modes: what the agent does, and what it may touch');

  modesCmd
    .command('list', { isDefault: true })
    .description('List available agent modes')
    .action(async () => {
      const { runModesList } = await import('./commands/modes.js');
      runModesList();
    });

  modesCmd
    .command('show <name>')
    .description('Show the system prompt and tool budget for a mode')
    .action(async (name: string) => {
      const { runModesShow } = await import('./commands/modes.js');
      runModesShow(name);
    });

  // ─── RULES COMMAND ────────────────────────────────────────────────────────
  program
    .command('rules')
    .description('Show the project rule files the agent will follow')
    .action(async () => {
      const { runRulesList } = await import('./commands/modes.js');
      runRulesList();
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
    .description('Set a configuration value (default-provider, default-model, workspace-root, <provider>-endpoint)')
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
    .command('unset')
    .description('Remove spending limits (reset only clears counters)')
    .option('--total', 'Remove the total spending limit')
    .option('--monthly', 'Remove the monthly spending limit')
    .option('--alert', 'Remove the alert threshold')
    .option('--all', 'Remove all limits and the alert threshold')
    .action(async (options: { total?: boolean; monthly?: boolean; alert?: boolean; all?: boolean }) => {
      const { runBudgetUnset } = await import('./commands/budget.js');
      await runBudgetUnset(options);
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

  // ─── MCP COMMAND ──────────────────────────────────────────────────────────
  const mcpCmd = program
    .command('mcp')
    .description('Model Context Protocol servers — extend the agent with external tools');

  mcpCmd
    .command('list', { isDefault: true })
    .description('List configured MCP servers')
    .action(async () => {
      const { runMcpList } = await import('./commands/mcp.js');
      runMcpList();
    });

  mcpCmd
    .command('test')
    .description('Connect to every server and list the tools it offers')
    .action(async () => {
      const { runMcpTest } = await import('./commands/mcp.js');
      await runMcpTest();
    });

  mcpCmd
    .command('add <name> [args...]')
    .description('Add a server (verified before it is saved)')
    .option('--command <cmd>', 'Executable to run for a stdio server')
    .option('--url <url>', 'Endpoint for an HTTP server')
    .option('--env <KEY=VALUE...>', 'Environment variable for a stdio server', collect, [])
    .option('--header <KEY=VALUE...>', 'HTTP header for an HTTP server', collect, [])
    .option('--cwd <dir>', 'Working directory for a stdio server')
    .action(async (name: string, args: string[], options: {
      command?: string;
      url?: string;
      env?: string[];
      header?: string[];
      cwd?: string;
    }) => {
      const { runMcpAdd } = await import('./commands/mcp.js');
      await runMcpAdd(name, { ...options, args });
    });

  mcpCmd
    .command('remove <name>')
    .description('Remove a server')
    .action(async (name: string) => {
      const { runMcpRemove } = await import('./commands/mcp.js');
      await runMcpRemove(name);
    });

  mcpCmd
    .command('enable <name>')
    .description('Re-enable a disabled server')
    .action(async (name: string) => {
      const { runMcpToggle } = await import('./commands/mcp.js');
      runMcpToggle(name, false);
    });

  mcpCmd
    .command('disable <name>')
    .description('Keep a server configured but stop loading it')
    .action(async (name: string) => {
      const { runMcpToggle } = await import('./commands/mcp.js');
      runMcpToggle(name, true);
    });

  // ─── CHECKPOINT COMMAND ───────────────────────────────────────────────────
  const checkpointCmd = program
    .command('checkpoint')
    .alias('checkpoints')
    .description('Undo agent file edits');

  checkpointCmd
    .command('list', { isDefault: true })
    .description('List checkpoints, grouped by agent run')
    .action(async () => {
      const { runCheckpointList } = await import('./commands/checkpoint.js');
      runCheckpointList();
    });

  checkpointCmd
    .command('show <id>')
    .description('Show what a checkpoint captured')
    .action(async (id: string) => {
      const { runCheckpointShow } = await import('./commands/checkpoint.js');
      runCheckpointShow(id);
    });

  checkpointCmd
    .command('restore <id>')
    .description('Undo a single tool call')
    .action(async (id: string) => {
      const { runCheckpointRestore } = await import('./commands/checkpoint.js');
      runCheckpointRestore(id);
    });

  checkpointCmd
    .command('restore-run <runId>')
    .description('Undo every file change made by an agent run')
    .action(async (runId: string) => {
      const { runCheckpointRestoreRun } = await import('./commands/checkpoint.js');
      runCheckpointRestoreRun(runId);
    });

  checkpointCmd
    .command('clear')
    .description('Delete all checkpoints')
    .action(async () => {
      const { runCheckpointClear } = await import('./commands/checkpoint.js');
      await runCheckpointClear();
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

  // ─── BENCH COMMAND ────────────────────────────────────────────────────────
  const benchCmd = program
    .command('bench')
    .description('Run the agent against a task suite and grade it independently');

  const benchCommonOptions = (command: Command): Command =>
    command
      .option('-p, --provider <name>', 'AI provider to use')
      .option('-m, --model <name>', 'Model to use')
      .option('--mode <name>', 'Agent mode', 'code')
      .option('--free', 'Use only free providers')
      .option('--filter <pattern>', 'Only tasks matching this pattern')
      .option('--limit <n>', 'Stop after this many tasks')
      .option('--max-iterations <n>', 'Agent steps per task')
      .option('--self-verify', 'Let the agent run the task\'s own check before it stops')
      .option('--keep-sandbox', 'Leave each task directory behind for inspection')
      .option('--json', 'Print the run as JSON')
      .option('--out <dir>', 'Where to write the report');

  benchCommonOptions(
    benchCmd
      .command('local', { isDefault: true })
      .description('Cude\'s own suite — no Docker, no dataset, no network')
  ).action(async (options: Record<string, string | boolean | undefined>) => {
    const { runBenchLocal } = await import('./commands/bench.js');
    await runBenchLocal(parseBenchOptions(options));
  });

  benchCommonOptions(
    benchCmd
      .command('swebench')
      .description('Run SWE-bench instances and emit predictions.jsonl for the official evaluator')
      .requiredOption('--dataset <file>', 'SWE-bench (Verified) .jsonl or .json file')
      .option('--repo-cache <dir>', 'Directory of pre-cloned repositories, to avoid re-cloning')
  ).action(async (options: Record<string, string | boolean | undefined>) => {
    const { runBenchSweBench } = await import('./commands/bench.js');
    await runBenchSweBench(options.dataset as string, {
      ...parseBenchOptions(options),
      repoCache: options.repoCache as string | undefined,
    });
  });

  benchCommonOptions(
    benchCmd
      .command('terminal-bench')
      .description('Run Terminal-Bench task directories locally (never an official score)')
      .requiredOption('--tasks <dir>', 'Terminal-Bench tasks directory')
  ).action(async (options: Record<string, string | boolean | undefined>) => {
    const { runBenchTerminal } = await import('./commands/bench.js');
    await runBenchTerminal(options.tasks as string, parseBenchOptions(options));
  });

  benchCmd
    .command('list')
    .description('Show the suites and what each one needs')
    .action(async () => {
      const { runBenchList } = await import('./commands/bench.js');
      runBenchList();
    });

  // ─── SECURITY COMMAND ─────────────────────────────────────────────────────
  const securityCmd = program
    .command('security')
    .alias('sec')
    .description('Scan for leaked credentials and audit what this agent is allowed to do');

  securityCmd
    .command('scan [directory]')
    .description('Find hardcoded credentials in a project (defaults to the workspace root)')
    .option('--json', 'Machine-readable output')
    .option('--strict', 'Exit non-zero when anything is found (for CI)')
    .action(async (directory: string | undefined, options: { json?: boolean; strict?: boolean }) => {
      const { runSecurityScan } = await import('./commands/security.js');
      runSecurityScan(directory, options);
    });

  securityCmd
    .command('audit', { isDefault: true })
    .description('Report key storage, MCP trust, file permissions and which protections are off')
    .action(async () => {
      const { runSecurityAudit } = await import('./commands/security.js');
      runSecurityAudit();
    });

  securityCmd
    .command('log')
    .description('Show the audit log of tool calls')
    .option('-n, --lines <count>', 'How many entries to show (default: 40)', '40')
    .action(async (options: { lines?: string }) => {
      const { runSecurityLog } = await import('./commands/security.js');
      runSecurityLog({ lines: parseInt(options.lines ?? '40', 10) });
    });

  securityCmd
    .command('check <path>')
    .description('Say whether the agent is allowed to read a path, and why')
    .action(async (path: string) => {
      const { runSecurityCheck } = await import('./commands/security.js');
      runSecurityCheck(path);
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
