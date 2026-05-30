import chalk from 'chalk';
import boxen from 'boxen';
import figlet from 'figlet';
import gradientString from 'gradient-string';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import type { Provider } from '../providers/types.js';
import type { Session } from '../storage/sessions.js';

// Configure marked with terminal renderer
marked.use(markedTerminal() as Parameters<typeof marked.use>[0]);

export function showBanner(): void {
  const art = figlet.textSync('Codiente', {
    font: 'Standard',
    horizontalLayout: 'default',
  });

  const gradient = gradientString('cyan', 'magenta', 'blue');
  console.log(gradient(art));
  console.log(chalk.dim('  AI-powered CLI for coding, automation & productivity'));
  console.log(chalk.dim('  v1.0.0 | Anthropic · OpenAI · Gemini · Groq · Ollama'));
  console.log();
}

export function renderMarkdown(text: string): string {
  try {
    const result = marked(text);
    return typeof result === 'string' ? result : text;
  } catch {
    return text;
  }
}

export function showCostInfo(cost: number, inputTokens: number, outputTokens: number): void {
  if (cost === 0) {
    console.log(chalk.dim(`  [Free · ${inputTokens} in / ${outputTokens} out tokens]`));
  } else {
    console.log(
      chalk.dim(`  [$${cost.toFixed(6)} · ${inputTokens} in / ${outputTokens} out tokens]`)
    );
  }
}

export function showError(message: string): void {
  console.error(
    boxen(chalk.red(message), {
      padding: 1,
      borderColor: 'red',
      borderStyle: 'round',
      title: chalk.red('Error'),
      titleAlignment: 'left',
    })
  );
}

export function showWarning(message: string): void {
  console.warn(
    boxen(chalk.yellow(message), {
      padding: { top: 0, bottom: 0, left: 1, right: 1 },
      borderColor: 'yellow',
      borderStyle: 'round',
      title: chalk.yellow('Warning'),
      titleAlignment: 'left',
    })
  );
}

export function showSuccess(message: string): void {
  console.log(
    boxen(chalk.green(message), {
      padding: { top: 0, bottom: 0, left: 1, right: 1 },
      borderColor: 'green',
      borderStyle: 'round',
      title: chalk.green('Success'),
      titleAlignment: 'left',
    })
  );
}

export function showInfo(message: string): void {
  console.log(chalk.cyan('  ℹ ') + message);
}

export function showProviderTable(providers: Array<{ provider: Provider; available: boolean }>): void {
  const nameWidth = 22;
  const statusWidth = 14;
  const freeWidth = 8;

  const header =
    chalk.bold.cyan('Provider'.padEnd(nameWidth)) +
    chalk.bold.cyan('Status'.padEnd(statusWidth)) +
    chalk.bold.cyan('Free/Local');

  console.log();
  console.log(header);
  console.log(chalk.dim('─'.repeat(nameWidth + statusWidth + freeWidth)));

  for (const { provider, available } of providers) {
    const name = provider.displayName.padEnd(nameWidth);
    let status: string;
    if (provider.isConfigured()) {
      status = available ? chalk.green('✓ Available').padEnd(statusWidth + 9) : chalk.yellow('⚠ Unreachable').padEnd(statusWidth + 9);
    } else if (provider.name === 'ollama') {
      status = available ? chalk.green('✓ Running').padEnd(statusWidth + 9) : chalk.dim('○ Not running').padEnd(statusWidth + 9);
    } else {
      status = chalk.dim('○ Not configured').padEnd(statusWidth + 9);
    }
    const isFree = provider.name === 'groq' || provider.name === 'ollama';
    const isLocal = provider.name === 'ollama';
    const freeLabel = isLocal ? chalk.cyan('Local') : isFree ? chalk.green('Free') : chalk.dim('Paid');

    console.log(chalk.white(name) + status + freeLabel);
  }
  console.log();
}

export function showSessionTable(sessions: Session[]): void {
  if (sessions.length === 0) {
    console.log(chalk.dim('  No sessions found.'));
    return;
  }

  const idWidth = 10;
  const nameWidth = 24;
  const providerWidth = 14;
  const dateWidth = 20;
  const costWidth = 12;

  const header =
    chalk.bold.cyan('ID'.padEnd(idWidth)) +
    chalk.bold.cyan('Name'.padEnd(nameWidth)) +
    chalk.bold.cyan('Provider'.padEnd(providerWidth)) +
    chalk.bold.cyan('Updated'.padEnd(dateWidth)) +
    chalk.bold.cyan('Cost');

  console.log();
  console.log(header);
  console.log(chalk.dim('─'.repeat(idWidth + nameWidth + providerWidth + dateWidth + costWidth)));

  for (const session of sessions) {
    const shortId = session.id.split('-')[0];
    const name = session.name.substring(0, nameWidth - 2).padEnd(nameWidth);
    const provider = session.provider.padEnd(providerWidth);
    const date = new Date(session.updatedAt).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    }).padEnd(dateWidth);
    const cost = session.totalCost === 0 ? chalk.green('Free') : chalk.yellow(`$${session.totalCost.toFixed(4)}`);

    console.log(
      chalk.dim(shortId.padEnd(idWidth)) +
      chalk.white(name) +
      chalk.cyan(provider) +
      chalk.dim(date) +
      cost
    );
  }
  console.log();
}

export function showModelTable(
  models: Array<{ id: string; name: string; provider: string; free: boolean; local: boolean; pricing?: { inputPerMillion: number; outputPerMillion: number } }>
): void {
  console.log();
  console.log(chalk.bold.cyan('Available Models'));
  console.log(chalk.dim('─'.repeat(80)));

  const byProvider: Record<string, typeof models> = {};
  for (const m of models) {
    if (!byProvider[m.provider]) byProvider[m.provider] = [];
    byProvider[m.provider].push(m);
  }

  for (const [provider, providerModels] of Object.entries(byProvider)) {
    console.log(chalk.bold.white(`\n  ${provider.toUpperCase()}`));
    for (const m of providerModels) {
      const badge = m.local
        ? chalk.cyan('[local]')
        : m.free
        ? chalk.green('[free]')
        : chalk.dim('[paid]');
      const pricing = m.pricing
        ? chalk.dim(` $${m.pricing.inputPerMillion}/$${m.pricing.outputPerMillion} per M tokens`)
        : '';
      console.log(`    ${chalk.white(m.id.padEnd(35))} ${badge}${pricing}`);
    }
  }
  console.log();
}

export function printKeyValue(key: string, value: string, color: 'green' | 'yellow' | 'cyan' | 'white' = 'white'): void {
  console.log(chalk.dim(`  ${key.padEnd(22)}: `) + chalk[color](value));
}

export function printSeparator(char = '─', width = 60): void {
  console.log(chalk.dim(char.repeat(width)));
}

export function formatCost(cost: number): string {
  if (cost === 0) return chalk.green('Free');
  if (cost < 0.001) return chalk.yellow(`$${(cost * 1000).toFixed(4)}m`);
  return chalk.yellow(`$${cost.toFixed(6)}`);
}
