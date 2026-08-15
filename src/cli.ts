import { Command } from 'commander';
import chalk from 'chalk';
import { showBanner } from './ui/display.js';
import { isFirstRun, markFirstRunDone } from './config/index.js';

export function createCLI(): Command {
  const program = new Command();

  program
    .name('cude')
    .description(chalk.cyan('Cude Code — autonomous AI development CLI for your terminal'))
    .version('0.2.0')
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
    .option('--json', 'Print one machine-readable JSON result')
    .action(async (task: string, options: {
      provider?: string;
      model?: string;
      free?: boolean;
      taskType?: string;
      verbose?: boolean;
      yes?: boolean;
      maxIterations?: string;
      json?: boolean;
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
        json: options.json ?? false,
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
  sessionsCmd.command('show <id>')
    .description('View the full transcript of a session without entering chat')
    .action(async (id: string) => { const { runSessionsShow } = await import('./commands/sessions.js'); await runSessionsShow(id); });

  program
    .command('write <task>')
    .description('Yaz: implement a focused change in the workspace')
    .option('-p, --provider <name>', 'AI provider to use')
    .option('-m, --model <name>', 'Model to use')
    .option('--free', 'Use only free providers')
    .option('-v, --verbose', 'Show detailed execution steps')
    .option('-y, --yes', 'Skip confirmation prompt')
    .option('--max-iterations <n>', 'Maximum agent iterations', '10')
    .option('--json', 'Print one machine-readable JSON result')
    .action(async (task: string, options: { provider?: string; model?: string; free?: boolean; verbose?: boolean; yes?: boolean; maxIterations?: string; json?: boolean }) => {
      const { runWrite } = await import('./commands/workflow.js');
      await runWrite(task, { ...options, maxIterations: parseInt(options.maxIterations ?? '10', 10) });
    });

  program
    .command('understand [target]')
    .description('Anla: read-only architecture and risk summary for the project or target file')
    .option('-p, --provider <name>', 'AI provider to use')
    .option('-m, --model <name>', 'Model to use')
    .option('--free', 'Use only free providers')
    .option('--json', 'Print the summary as JSON')
    .action(async (target: string | undefined, options: { provider?: string; model?: string; free?: boolean; json?: boolean }) => {
      const { runUnderstand } = await import('./commands/workflow.js');
      await runUnderstand(target, options);
    });

  program
    .command('produce <task>')
    .description('Üret: implement, verify, and review a complete change')
    .option('-p, --provider <name>', 'AI provider to use')
    .option('-m, --model <name>', 'Model to use')
    .option('--free', 'Use only free providers')
    .option('-v, --verbose', 'Show detailed execution steps')
    .option('-y, --yes', 'Skip confirmation prompt')
    .option('--max-iterations <n>', 'Maximum agent iterations', '10')
    .option('--json', 'Print the agent result as JSON')
    .action(async (task: string, options: { provider?: string; model?: string; free?: boolean; verbose?: boolean; yes?: boolean; maxIterations?: string; json?: boolean }) => {
      const { runProduce } = await import('./commands/workflow.js');
      await runProduce(task, { ...options, maxIterations: parseInt(options.maxIterations ?? '10', 10) });
    });

  program
    .command('plan <task>')
    .description('Create a read-only implementation plan without changing files')
    .option('-p, --provider <name>', 'AI provider to use')
    .option('-m, --model <name>', 'Model to use')
    .option('--free', 'Use only free providers')
    .option('--json', 'Print the plan as JSON')
    .action(async (task: string, options: { provider?: string; model?: string; free?: boolean; json?: boolean }) => {
      const { runPlan } = await import('./commands/plan.js');
      await runPlan(task, options);
    });

  program
    .command('review')
    .description('Review uncommitted changes without modifying files')
    .option('-p, --provider <name>', 'AI provider to use')
    .option('-m, --model <name>', 'Model to use')
    .option('--free', 'Use only free providers')
    .option('--json', 'Print the review as JSON')
    .action(async (options: { provider?: string; model?: string; free?: boolean; json?: boolean }) => {
      const { runReview } = await import('./commands/review.js');
      await runReview(options);
    });

  program
    .command('doctor')
    .description('Check available LSP, debugger, and upstream bridge executables')
    .option('--json', 'Print capability data as JSON')
    .action(async (options: { json?: boolean }) => {
      const { runDoctor } = await import('./commands/doctor.js');
      await runDoctor(options.json ?? false);
    });

  sessionsCmd
    .command('fork <id> <name>')
    .description('Create a new branch from an existing session')
    .action(async (id: string, name: string) => {
      const { runSessionsFork } = await import('./commands/sessions.js');
      await runSessionsFork(id, name);
    });

  const lspCmd = program.command('lsp').description('Use installed Language Server Protocol tools');
  lspCmd.command('diagnostics <file>')
    .description('Request real diagnostics from a language server')
    .option('--server <command>', 'LSP server executable')
    .option('--args <args>', 'Space-separated server arguments')
    .option('--json', 'Print diagnostics as JSON')
    .action(async (file: string, options: { server?: string; args?: string; json?: boolean }) => {
      const { runLspDiagnostics } = await import('./commands/lsp.js');
      await runLspDiagnostics(file, options);
    });

  program.command('task')
    .description('Run multiple tasks concurrently in isolated git worktrees')
    .requiredOption('--task <task>', 'Worker task; repeat this option for parallel workers', (value: string, previous: string[]) => [...(previous ?? []), value], [])
    .option('--json', 'Print worker results as JSON')
    .action(async (options: { task: string[]; json?: boolean }) => {
      const { runTaskWorkers } = await import('./commands/task.js');
      await runTaskWorkers(options.task, options.json ?? false);
    });

  const memoryCmd = program.command('memory').description('Manage explicit project memories used by the agent');
  memoryCmd.command('add <text>')
    .description('Save a project fact or reusable lesson')
    .option('--tags <tags>', 'Comma-separated tags')
    .action(async (text: string, options: { tags?: string }) => {
      const { runMemoryAdd } = await import('./commands/memory.js');
      runMemoryAdd(text, options.tags);
    });
  memoryCmd.command('list [query]')
    .description('List memories, optionally filtered by a search query')
    .action((query?: string) => {
      import('./commands/memory.js').then(({ runMemoryList }) => runMemoryList(query));
    });

  const subagentCmd = program.command('subagent').description('Manage specialized project subagents');
  subagentCmd.command('list')
    .description('List subagents from .cude/agents')
    .action(async () => {
      const { listSubagents } = await import('./commands/subagent.js');
      listSubagents();
    });
  subagentCmd.command('run <name> <task>')
    .description('Run a named subagent with an isolated specialist prompt')
    .option('-p, --provider <name>', 'AI provider to use')
    .option('-m, --model <name>', 'Model to use')
    .option('--free', 'Use only free providers')
    .option('-v, --verbose', 'Show detailed execution steps')
    .option('--max-iterations <n>', 'Maximum agent iterations', '10')
    .option('--json', 'Print the result as JSON')
    .action(async (name: string, task: string, options: { provider?: string; model?: string; free?: boolean; verbose?: boolean; maxIterations?: string; json?: boolean }) => {
      const { executeSubagent } = await import('./commands/subagent.js');
      await executeSubagent(name, task, options);
    });

  const mcpCmd = program.command('mcp').description('Discover and call configured Model Context Protocol servers');
  mcpCmd.command('list')
    .description('List tools exposed by .cude/mcp.json servers')
    .action(async () => {
      const { discoverMcpTools } = await import('./core/mcp.js');
      const tools = await discoverMcpTools();
      if (tools.length === 0) console.log('No MCP tools discovered. Configure servers in .cude/mcp.json.');
      for (const tool of tools) console.log(`${tool.name}  ${tool.description}`);
    });
  mcpCmd.command('call <tool> [args]')
    .description('Call an MCP tool with a JSON argument object')
    .action(async (tool: string, args?: string) => {
      const { callMcpTool } = await import('./core/mcp.js');
      const result = await callMcpTool(tool, args ? JSON.parse(args) as Record<string, unknown> : {});
      process.stdout.write(JSON.stringify(result) + '\n');
      if (!result.success) process.exitCode = 1;
    });

  const clawCmd = program.command('claw').description('Durable CudeClaw queue for long-running work');
  clawCmd.command('add <task>').description('Queue a task for a persistent worker').option('-p, --provider <name>').option('-m, --model <name>').option('-t, --task-type <type>', 'Task type', 'code').option('--max-iterations <n>', 'Maximum iterations', '10').action(async (task: string, options: { provider?: string; model?: string; taskType?: string; maxIterations?: string }) => { const { runClawAdd } = await import('./commands/claw.js'); runClawAdd(task, options); });
  clawCmd.command('list').description('List queued and completed jobs').action(async () => { const { runClawList } = await import('./commands/claw.js'); runClawList(); });
  clawCmd.command('cancel <id>').description('Cancel a queued job').action(async (id: string) => { const { runClawCancel } = await import('./commands/claw.js'); runClawCancel(id); });
  clawCmd.command('worker').description('Run the durable worker until interrupted').option('--interval <seconds>', 'Polling interval', '15').option('--once', 'Process one queued job and exit').action(async (options: { interval?: string; once?: boolean }) => { const { runClawWorker } = await import('./commands/claw.js'); await runClawWorker(options); });

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

  providersCmd.command('custom-list')
    .description('List saved OpenAI-compatible custom providers')
    .action(async () => { const { runCustomProvidersList } = await import('./commands/providers.js'); runCustomProvidersList(); });
  providersCmd.command('add <name>')
    .description('Add an OpenAI-compatible or local provider')
    .requiredOption('--base-url <url>', 'Chat completions base URL')
    .requiredOption('--model <id>', 'Default model id')
    .option('--display-name <name>', 'Friendly display name')
    .option('--api-key-env <name>', 'Environment variable containing the API key')
    .option('--api-key <key>', 'API key (prefer --api-key-env for safety)')
    .option('--local', 'Mark this provider as local and zero-cost')
    .action(async (name: string, options: { baseUrl: string; model: string; displayName?: string; apiKeyEnv?: string; apiKey?: string; local?: boolean }) => { const { runCustomProviderAdd } = await import('./commands/providers.js'); runCustomProviderAdd(name, options); });
  providersCmd.command('remove <name>')
    .description('Remove a saved custom provider')
    .action(async (name: string) => { const { runCustomProviderRemove } = await import('./commands/providers.js'); runCustomProviderRemove(name); });

  program
    .command('context')
    .description('Show project instruction files loaded by the agent')
    .action(async () => {
      const { loadProjectContext, loadProjectSkills } = await import('./core/context.js');
      const files = loadProjectContext();
      const skills = loadProjectSkills();
      if (files.length > 0) {
        console.log('Project context files:');
        for (const file of files) console.log(`- ${file.path}${file.truncated ? ' (truncated)' : ''}`);
      } else {
        console.log('No AGENTS.md, CLAUDE.md, or .cude-context.md found.');
      }
      if (skills.length > 0) {
        console.log('Agent Skills:');
        for (const skill of skills) console.log(`- ${skill.name}: ${skill.path}${skill.truncated ? ' (truncated)' : ''}`);
      }
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
