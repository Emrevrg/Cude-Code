import chalk from 'chalk';
import boxen from 'boxen';
import figlet from 'figlet';
import gradientString from 'gradient-string';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import type { Provider } from '../providers/types.js';
import type { Session } from '../storage/sessions.js';
import { termWidth } from './animate.js';

marked.use(markedTerminal() as Parameters<typeof marked.use>[0]);

const VERSION = '1.0.0';

const brandGrad   = gradientString('#7c3aed', '#3b82f6', '#06b6d4');
const accentGrad  = gradientString('#7c3aed', '#06b6d4');
const warmGrad    = gradientString('#f59e0b', '#ef4444');

// ─── BANNER ────────────────────────────────────────────────────────────────

export function showBanner(): void {
  let art: string;
  try {
    art = figlet.textSync('Cude Code', { font: 'Slant', horizontalLayout: 'default' });
  } catch {
    art = figlet.textSync('Cude Code', { font: 'Standard', horizontalLayout: 'default' });
  }

  console.log();
  console.log(brandGrad(art));

  const tags = [
    chalk.hex('#7c3aed')('⬡') + chalk.dim(' AI Coding Assistant'),
    chalk.hex('#3b82f6')('⬡') + chalk.dim(' 23+ Providers'),
    chalk.hex('#06b6d4')('⬡') + chalk.dim(' Autonomous Agent'),
    chalk.dim('v' + VERSION),
  ].join(chalk.dim('  '));
  console.log('  ' + tags);

  console.log(chalk.dim('  ' + '─'.repeat(Math.min(termWidth() - 4, 72))));
  console.log();
}

// ─── CHAT HEADER ───────────────────────────────────────────────────────────

export function showChatHeader(opts: {
  provider: string;
  model: string;
  mode: 'free' | 'paid';
  language?: string;
  session?: string;
  budget?: string;
  memory?: string;
}): void {
  const modeLabel = opts.mode === 'free'
    ? chalk.green('Free')
    : chalk.hex('#3b82f6')('Paid');

  const langLabel = opts.language && opts.language !== 'auto'
    ? chalk.dim('  ·  Lang: ') + chalk.hex('#7c3aed')(opts.language.toUpperCase())
    : '';

  const sessionLabel = opts.session
    ? chalk.dim('  ·  Session: ') + chalk.cyan(opts.session)
    : '';

  const budgetLabel = opts.budget
    ? chalk.dim('  ·  Budget: ') + chalk.yellow(opts.budget)
    : '';

  const memoryLabel = opts.memory
    ? chalk.dim('  ·  ') + chalk.hex('#7c3aed')(opts.memory)
    : '';

  const line1 = accentGrad('  ◈  ') +
    chalk.white(opts.provider) +
    chalk.dim('  ›  ') +
    chalk.hex('#06b6d4')(opts.model) +
    chalk.dim('  ·  Mode: ') + modeLabel +
    langLabel + sessionLabel + budgetLabel + memoryLabel;

  const cmdHint = chalk.dim('  /help') + chalk.dim(' commands  ·  ') +
    chalk.dim('/exit') + chalk.dim(' quit  ·  ') +
    chalk.dim('/lang <code>') + chalk.dim(' language  ·  ') +
    chalk.dim('/model <name>') + chalk.dim(' switch model');

  const sep = chalk.dim('  ' + '─'.repeat(Math.min(termWidth() - 4, 72)));
  console.log(sep);
  console.log(line1);
  console.log(sep);
  console.log(cmdHint);
  console.log(sep);
  console.log();
}

// ─── PROMPTS ───────────────────────────────────────────────────────────────

export const USER_PROMPT   = accentGrad('  ✦') + chalk.white(' You') + chalk.dim(' › ');
export const AI_PROMPT     = chalk.hex('#3b82f6')('  ◆') + chalk.hex('#06b6d4')(' Cude Code') + chalk.dim(' › ');

// ─── COST / TOKEN INFO ─────────────────────────────────────────────────────

export function showCostInfo(cost: number, inputTokens: number, outputTokens: number): void {
  const totalTokens = inputTokens + outputTokens;
  const costStr = cost === 0
    ? chalk.green('Free')
    : chalk.yellow('$' + cost.toFixed(6));

  console.log(
    chalk.dim('  ▸ ') + costStr +
    chalk.dim(` · ${totalTokens.toLocaleString()} tokens`) +
    chalk.dim(` (${inputTokens} in / ${outputTokens} out)`)
  );
}

// ─── BOXES ─────────────────────────────────────────────────────────────────

export function showError(message: string): void {
  console.error(
    boxen(chalk.red(message), {
      padding: { top: 0, bottom: 0, left: 2, right: 2 },
      margin: { top: 0, bottom: 0, left: 2, right: 0 },
      borderColor: 'red',
      borderStyle: 'round',
      title: chalk.red.bold(' ✗ Error '),
      titleAlignment: 'left',
    })
  );
}

export function showWarning(message: string): void {
  console.warn(
    boxen(chalk.yellow(message), {
      padding: { top: 0, bottom: 0, left: 2, right: 2 },
      margin: { top: 0, bottom: 0, left: 2, right: 0 },
      borderColor: 'yellow',
      borderStyle: 'round',
      title: chalk.yellow.bold(' ⚠ Warning '),
      titleAlignment: 'left',
    })
  );
}

export function showSuccess(message: string): void {
  console.log(
    boxen(chalk.green(message), {
      padding: { top: 0, bottom: 0, left: 2, right: 2 },
      margin: { top: 0, bottom: 0, left: 2, right: 0 },
      borderColor: 'green',
      borderStyle: 'round',
      title: chalk.green.bold(' ✓ '),
      titleAlignment: 'left',
    })
  );
}

export function showInfo(message: string): void {
  console.log(chalk.hex('#3b82f6')('  ℹ ') + chalk.white(message));
}

// ─── FIRST RUN WELCOME ─────────────────────────────────────────────────────

export function showWelcome(): void {
  showBanner();

  console.log(
    boxen(
      chalk.bold.white('Welcome to Cude Code CLI! 🎉\n\n') +
      chalk.dim('First time running? Get started:\n\n') +

      chalk.hex('#7c3aed')('  cude setup          ') +
      chalk.dim('Configure API keys (interactive wizard)\n') +

      chalk.hex('#3b82f6')('  cude chat --free    ') +
      chalk.dim('Chat instantly for free (Groq / Gemini)\n') +

      chalk.hex('#06b6d4')('  cude run "<görev>"  ') +
      chalk.dim('Run autonomous AI agent\n') +

      chalk.hex('#7c3aed')('  cude providers list ') +
      chalk.dim('See all 13 AI providers\n') +

      chalk.hex('#3b82f6')('  cude desktop        ') +
      chalk.dim('Launch desktop app (GUI)'),
      {
        padding: 1,
        margin: { top: 0, bottom: 0, left: 1, right: 0 },
        borderStyle: 'round',
        borderColor: 'magenta',
        title: chalk.magenta.bold(' Getting Started '),
        titleAlignment: 'center',
      }
    )
  );
  console.log();
}

// ─── MARKDOWN ──────────────────────────────────────────────────────────────

export function renderMarkdown(text: string): string {
  try {
    const result = marked(text);
    return typeof result === 'string' ? result : text;
  } catch {
    return text;
  }
}

// ─── PROVIDER TABLE ────────────────────────────────────────────────────────

const PROVIDER_ICONS: Record<string, string> = {
  anthropic:   '🧠',
  openai:      '⚡',
  gemini:      '♊',
  groq:        '🚀',
  ollama:      '🦙',
  openrouter:  '🔀',
  nvidia:      '🎮',
  mistral:     '🌊',
  together:    '🤝',
  perplexity:  '🌐',
  deepseek:    '🔍',
  xai:         '✖️',
  cohere:      '⚙️',
};

export function showProviderTable(
  providers: Array<{ provider: Provider; available: boolean }>
): void {
  const nameW   = 28;
  const statusW = 16;

  console.log();
  console.log(
    '  ' +
    chalk.bold.hex('#06b6d4')('Provider'.padEnd(nameW)) +
    chalk.bold.hex('#06b6d4')('Status'.padEnd(statusW)) +
    chalk.bold.hex('#06b6d4')('Type')
  );
  console.log(chalk.dim('  ' + '─'.repeat(nameW + statusW + 12)));

  for (const { provider, available } of providers) {
    const icon = PROVIDER_ICONS[provider.name] ?? '◈';
    const rawName = `${icon} ${provider.displayName}`;
    const namePadded = rawName.padEnd(nameW - 1) + ' ';

    let statusStr: string;
    if (provider.name === 'ollama') {
      statusStr = available
        ? chalk.green('● Running').padEnd(statusW)
        : chalk.dim('○ Not running').padEnd(statusW);
    } else if (provider.isConfigured()) {
      statusStr = available
        ? chalk.green('● Online').padEnd(statusW)
        : chalk.yellow('◐ Unreachable').padEnd(statusW);
    } else {
      statusStr = chalk.dim('○ Not set up').padEnd(statusW);
    }

    const isLocal  = provider.name === 'ollama';
    const isFree   = provider.name === 'groq';
    const typeStr  = isLocal
      ? chalk.hex('#06b6d4').bold('Local')
      : isFree
      ? chalk.green.bold('Free')
      : chalk.dim('Paid');

    console.log('  ' + chalk.white(namePadded) + statusStr + typeStr);
  }
  console.log();
}

// ─── SESSION TABLE ─────────────────────────────────────────────────────────

export function showSessionTable(sessions: Session[]): void {
  if (sessions.length === 0) {
    console.log(chalk.dim('  ○ No sessions yet. Start one with: cude chat --session <name>'));
    return;
  }

  const idW   = 10;
  const nameW = 24;
  const provW = 14;
  const dateW = 18;

  console.log();
  console.log(
    '  ' +
    chalk.bold.hex('#06b6d4')('ID'.padEnd(idW)) +
    chalk.bold.hex('#06b6d4')('Name'.padEnd(nameW)) +
    chalk.bold.hex('#06b6d4')('Provider'.padEnd(provW)) +
    chalk.bold.hex('#06b6d4')('Updated'.padEnd(dateW)) +
    chalk.bold.hex('#06b6d4')('Cost')
  );
  console.log(chalk.dim('  ' + '─'.repeat(idW + nameW + provW + dateW + 10)));

  for (const session of sessions) {
    const shortId   = session.id.split('-')[0].padEnd(idW);
    const name      = session.name.substring(0, nameW - 2).padEnd(nameW);
    const prov      = session.provider.padEnd(provW);
    const date      = new Date(session.updatedAt)
      .toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      .padEnd(dateW);
    const cost      = session.totalCost === 0
      ? chalk.green('Free')
      : chalk.yellow('$' + session.totalCost.toFixed(4));

    console.log(
      '  ' +
      chalk.hex('#7c3aed')(shortId) +
      chalk.white(name) +
      chalk.hex('#3b82f6')(prov) +
      chalk.dim(date) +
      cost
    );
  }
  console.log();
}

// ─── MODEL TABLE ───────────────────────────────────────────────────────────

export function showModelTable(
  models: Array<{
    id: string; name: string; provider: string;
    free: boolean; local: boolean;
    pricing?: { inputPerMillion: number; outputPerMillion: number };
  }>
): void {
  console.log();
  console.log(chalk.bold.hex('#06b6d4')('  Available Models'));
  console.log(chalk.dim('  ' + '─'.repeat(72)));

  const byProvider: Record<string, typeof models> = {};
  for (const m of models) {
    if (!byProvider[m.provider]) byProvider[m.provider] = [];
    byProvider[m.provider].push(m);
  }

  for (const [prov, list] of Object.entries(byProvider)) {
    const icon = PROVIDER_ICONS[prov] ?? '◈';
    console.log('\n  ' + accentGrad(`${icon} ${prov.toUpperCase()}`));
    for (const m of list) {
      const badge = m.local
        ? chalk.hex('#06b6d4')('[local]')
        : m.free
        ? chalk.green('[free] ')
        : chalk.dim('[paid] ');
      const price = m.pricing
        ? chalk.dim(` $${m.pricing.inputPerMillion}/$${m.pricing.outputPerMillion}/MTok`)
        : chalk.dim(' —');
      console.log('    ' + badge + ' ' + chalk.white(m.id.padEnd(40)) + price);
    }
  }
  console.log();
}

// ─── BUDGET BAR ────────────────────────────────────────────────────────────

export function showBudgetBar(spent: number, limit: number, label: string): void {
  const pct     = Math.min(spent / limit, 1);
  const filled  = Math.round(pct * 20);
  const empty   = 20 - filled;
  const color   = pct > 0.85 ? chalk.red : pct > 0.6 ? chalk.yellow : chalk.green;
  const bar     = color('█'.repeat(filled)) + chalk.dim('░'.repeat(empty));
  const pctStr  = (pct * 100).toFixed(1) + '%';

  console.log(
    chalk.dim(`  ${label.padEnd(16)}`) +
    bar +
    chalk.dim(` ${pctStr.padStart(6)}  `) +
    chalk.yellow(`$${spent.toFixed(4)}`) +
    chalk.dim(` / $${limit}`)
  );
}

// ─── APP TABLE ─────────────────────────────────────────────────────────────

export function showAppTable(apps: Array<{ id: string; name: string; icon: string; description: string; tags: string[]; builtin: boolean }>): void {
  console.log();
  console.log(chalk.bold.hex('#06b6d4')('  Apps & Skills'));
  console.log(chalk.dim('  ' + '─'.repeat(72)));
  console.log();

  for (const app of apps) {
    const badge = app.builtin
      ? chalk.hex('#7c3aed')('builtin')
      : chalk.yellow('custom ');
    const tagsStr = app.tags.slice(0, 3).join(chalk.dim(' · '));

    console.log(
      `  ${app.icon}  ` +
      chalk.white.bold(app.name.padEnd(20)) +
      chalk.dim(app.id.padEnd(18)) +
      badge
    );
    console.log(
      `     ` +
      chalk.dim(app.description) +
      (tagsStr ? chalk.dim('  [' + tagsStr + ']') : '')
    );
    console.log();
  }

  console.log(chalk.dim('  ' + '─'.repeat(72)));
  console.log(
    chalk.dim(`  ${apps.length} apps  ·  `) +
    chalk.hex('#7c3aed')('cude apps use <id>') +
    chalk.dim('  activate  ·  ') +
    chalk.hex('#3b82f6')('cude apps info <id>') +
    chalk.dim('  details')
  );
  console.log();
}

// ─── MISC UTILITIES ────────────────────────────────────────────────────────

export function printKeyValue(
  key: string,
  value: string,
  color: 'green' | 'yellow' | 'cyan' | 'white' | 'magenta' = 'white'
): void {
  console.log(chalk.dim(`  ${key.padEnd(22)}: `) + chalk[color](value));
}

export function printSeparator(char = '─', width?: number): void {
  const w = width ?? Math.min(termWidth() - 4, 72);
  console.log(chalk.dim('  ' + char.repeat(w)));
}

export function formatCost(cost: number): string {
  if (cost === 0)       return chalk.green('Free');
  if (cost < 0.0001)   return chalk.yellow(`${(cost * 1_000_000).toFixed(1)}µ¢`);
  if (cost < 0.01)     return chalk.yellow(`$${cost.toFixed(5)}`);
  return chalk.yellow(`$${cost.toFixed(4)}`);
}
