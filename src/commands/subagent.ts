import chalk from 'chalk';
import { loadSubagents, runSubagent } from '../core/subagents.js';
import { renderMarkdown, showError } from '../ui/display.js';

export function listSubagents(): void {
  const agents = loadSubagents();
  if (agents.length === 0) {
    console.log('No project subagents found. Add Markdown definitions under .cude/agents/.');
    return;
  }
  for (const agent of agents) console.log(`${chalk.cyan(agent.name)}  ${agent.description}`);
}

export async function executeSubagent(name: string, task: string, options: { provider?: string; model?: string; free?: boolean; maxIterations?: string; verbose?: boolean; json?: boolean }): Promise<void> {
  try {
    const result = await runSubagent(name, task, {
      provider: options.provider,
      model: options.model,
      free: options.free,
      maxIterations: parseInt(options.maxIterations ?? '10', 10),
      verbose: options.verbose,
    });
    if (options.json) {
      process.stdout.write(JSON.stringify({ subagent: name, ...result }) + '\n');
      if (!result.success) process.exitCode = 1;
      return;
    }
    console.log(chalk.bold.cyan(`\n  Subagent: ${name}\n`));
    console.log(renderMarkdown(result.output || 'Subagent returned no output.'));
    if (!result.success) process.exitCode = 1;
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
