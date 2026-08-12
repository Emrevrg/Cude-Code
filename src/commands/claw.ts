import readline from 'readline';
import chalk from 'chalk';
import { ClawSession, type PendingEdit, type ApprovalDecision } from '../core/claw.js';
import { listModes, getMode, toolsForMode } from '../core/modes.js';
import { renderDiff, diffStat } from '../ui/diff.js';
import { renderMarkdown, showError, showInfo, printSeparator } from '../ui/display.js';
import { startSpinner, stopSpinner, updateSpinner } from '../ui/spinner.js';
import { setConfirmCallback } from '../core/tools.js';
import { initializeMcp, shutdownMcp } from '../mcp/registry.js';
import { listCheckpoints, restoreRun, displayPath } from '../core/checkpoints.js';
import { findRuleFiles } from '../core/rules.js';

export interface ClawOptions {
  provider?: string;
  model?: string;
  mode?: string;
  free?: boolean;
  yes?: boolean;
  maxIterations?: number;
}

const HELP = `
  ${chalk.bold('Slash commands')}
  ${chalk.cyan('/help')}              This list
  ${chalk.cyan('/mode [name]')}       Show or switch mode (code, architect, ask, debug, orchestrator)
  ${chalk.cyan('/model <name>')}      Switch model, e.g. /model claude-sonnet-5
  ${chalk.cyan('/tools')}             Tools available in the current mode
  ${chalk.cyan('/mcp')}               Connected MCP servers
  ${chalk.cyan('/rules')}             Project rule files in effect
  ${chalk.cyan('/cost')}              Spend for this session
  ${chalk.cyan('/undo')}              Undo every file change made this session
  ${chalk.cyan('/checkpoints')}       Checkpoints recorded this session
  ${chalk.cyan('/auto')}              Toggle approving edits automatically
  ${chalk.cyan('/clear')}             Forget the conversation, keep the settings
  ${chalk.cyan('/exit')}              Leave

  ${chalk.bold('In a message')}
  ${chalk.cyan('@path/to/file')}      Attach a file's contents to your message
`;

/**
 * A session reads input at two levels — the main prompt, and the approval
 * prompt nested inside a turn — so it cannot use `rl.question` on a
 * short-lived interface: closing one drops whatever the terminal had already
 * buffered, and the nested prompt then waits forever for a line that was
 * already read. One interface for the whole session, with a queue in front of
 * it, behaves the same whether input is typed or piped.
 */
class LineReader {
  private readonly rl: readline.Interface;
  private readonly buffered: string[] = [];
  private readonly waiting: Array<(line: string | null) => void> = [];
  private closed = false;

  constructor() {
    this.rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    this.rl.on('line', line => {
      const waiter = this.waiting.shift();
      if (waiter) waiter(line);
      else this.buffered.push(line);
    });
    this.rl.on('close', () => {
      this.closed = true;
      while (this.waiting.length > 0) this.waiting.shift()!(null);
    });
  }

  /** Resolves with null at end of input, which ends the session. */
  ask(question: string): Promise<string | null> {
    process.stdout.write(question);
    const queued = this.buffered.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.closed) return Promise.resolve(null);
    return new Promise(resolve => this.waiting.push(resolve));
  }

  close(): void {
    this.rl.close();
  }
}

let reader: LineReader | null = null;

async function prompt(question: string): Promise<string> {
  const line = await reader!.ask(question);
  return line ?? '/exit';
}

/** The approve / decline / always / stop prompt shown before an edit. */
async function askApproval(edit: PendingEdit): Promise<ApprovalDecision> {
  console.log();
  const target = edit.path ? displayPath(edit.path) : '';
  console.log(chalk.bold.yellow(`  ${edit.toolName}`) + (target ? chalk.white(` ${target}`) : ''));

  if (edit.before !== undefined && edit.after !== undefined) {
    const diff = renderDiff(edit.before, edit.after);
    console.log(chalk.dim(`  ${edit.before === '' ? 'new file' : 'edit'}  `) + diffStat(diff));
    console.log(diff.text);
  } else {
    // No previewable diff (a delete, a move, a patch we cannot pre-apply).
    const summary = JSON.stringify(edit.args).slice(0, 200);
    console.log(chalk.dim(`  ${summary}`));
  }

  console.log();
  const answer = (
    await prompt(`  ${chalk.yellow('?')} Apply this? ${chalk.dim('[y]es / [n]o / [a]lways / [s]top')}: `)
  ).trim().toLowerCase();

  if (answer === 'a' || answer === 'always') return 'always';
  if (answer === 's' || answer === 'stop') return 'abort';
  if (answer === 'y' || answer === 'yes' || answer === '') return 'yes';
  return 'no';
}

function showHeader(session: ClawSession): void {
  console.log();
  console.log(chalk.bold.cyan('  Cude Claw'));
  console.log(chalk.dim('  ─────────────────────────────────'));
  console.log(chalk.dim('  Provider: ') + chalk.cyan(session.provider.displayName));
  console.log(chalk.dim('  Model:    ') + chalk.cyan(session.model));
  console.log(chalk.dim('  Mode:     ') + chalk.cyan(session.mode.displayName) + chalk.dim(` — ${session.mode.description}`));
  console.log(chalk.dim('  Session:  ') + chalk.cyan(session.runId));
  console.log();
  console.log(chalk.dim('  /help for commands, @file to attach a file, /exit to leave.'));
  console.log();
}

function showCost(session: ClawSession): void {
  console.log();
  if (session.totalCost === 0) {
    console.log(chalk.dim('  This session: ') + chalk.green('free') +
      chalk.dim(` · ${session.totalInputTokens} in / ${session.totalOutputTokens} out · ${session.turns} turn${session.turns !== 1 ? 's' : ''}`));
  } else {
    console.log(chalk.dim('  This session: ') + chalk.yellow(`$${session.totalCost.toFixed(6)}`) +
      chalk.dim(` · ${session.totalInputTokens} in / ${session.totalOutputTokens} out · ${session.turns} turn${session.turns !== 1 ? 's' : ''}`));
  }
  console.log();
}

/** Returns false when the session should end. */
async function handleSlash(input: string, session: ClawSession): Promise<boolean> {
  const [command, ...rest] = input.slice(1).trim().split(/\s+/);
  const argument = rest.join(' ');

  switch (command.toLowerCase()) {
    case 'help':
      console.log(HELP);
      return true;

    case 'exit':
    case 'quit':
      return false;

    case 'mode': {
      if (!argument) {
        console.log();
        for (const mode of listModes()) {
          const marker = mode.name === session.mode.name ? chalk.green('●') : chalk.dim('○');
          console.log(`  ${marker} ${chalk.bold.white(mode.name.padEnd(14))}${chalk.dim(mode.description)}`);
        }
        console.log();
        return true;
      }
      try {
        session.setMode(argument);
        showInfo(`Mode: ${session.mode.displayName} — ${session.mode.description}`);
      } catch (err) {
        showError(err instanceof Error ? err.message : String(err));
      }
      return true;
    }

    case 'model': {
      if (!argument) {
        showInfo(`Model: ${session.model} on ${session.provider.displayName}`);
        return true;
      }
      try {
        session.setModel(undefined, argument);
        showInfo(`Model: ${session.model} on ${session.provider.displayName}`);
      } catch (err) {
        showError(err instanceof Error ? err.message : String(err));
      }
      return true;
    }

    case 'tools': {
      const tools = toolsForMode(session.mode);
      console.log();
      console.log(chalk.dim(`  ${tools.length} tools in ${session.mode.displayName} mode:`));
      console.log(chalk.dim('  ' + tools.map(t => t.name).join(', ')));
      console.log();
      return true;
    }

    case 'mcp': {
      const mcp = await initializeMcp();
      console.log();
      if (mcp.connected.length === 0) {
        console.log(chalk.dim('  No MCP servers connected. See: cude mcp list'));
      } else {
        for (const server of mcp.connected) {
          const count = mcp.tools.filter(t => t.name.startsWith(`mcp__${server}__`)).length;
          console.log(`  ${chalk.green('✓')} ${chalk.white(server.padEnd(18))}${chalk.dim(`${count} tools`)}`);
        }
      }
      for (const failure of mcp.failed) {
        console.log(`  ${chalk.red('✗')} ${chalk.white(failure.server.padEnd(18))}${chalk.red(failure.reason)}`);
      }
      console.log();
      return true;
    }

    case 'rules': {
      const files = findRuleFiles();
      console.log();
      if (files.length === 0) {
        console.log(chalk.dim('  No rule files. See: cude rules'));
      } else {
        for (const file of files) {
          console.log(`  ${chalk.green('✓')} ${chalk.white(displayPath(file.path))}`);
        }
      }
      console.log();
      return true;
    }

    case 'cost':
      showCost(session);
      return true;

    case 'checkpoints': {
      const mine = listCheckpoints().filter(c => c.runId === session.runId);
      console.log();
      if (mine.length === 0) {
        console.log(chalk.dim('  No file changes yet this session.'));
      } else {
        for (const checkpoint of mine) {
          console.log(
            `  ${chalk.cyan(checkpoint.id)} ${chalk.yellow(checkpoint.toolName.padEnd(16))}` +
            chalk.dim(checkpoint.files.map(f => displayPath(f.path)).join(', '))
          );
        }
      }
      console.log();
      return true;
    }

    case 'undo': {
      const mine = listCheckpoints().filter(c => c.runId === session.runId);
      if (mine.length === 0) {
        showInfo('Nothing to undo — this session has not changed any files.');
        return true;
      }
      const answer = (await prompt(`  ${chalk.yellow('?')} Undo ${mine.length} change${mine.length !== 1 ? 's' : ''} from this session? ${chalk.dim('[y/N]')}: `)).trim().toLowerCase();
      if (answer !== 'y' && answer !== 'yes') {
        showInfo('Cancelled');
        return true;
      }
      const result = restoreRun(session.runId);
      console.log();
      for (const path of result.restored) console.log(`  ${chalk.green('restored')} ${displayPath(path)}`);
      for (const path of result.removed) console.log(`  ${chalk.yellow('removed ')} ${displayPath(path)}`);
      for (const failure of result.failed) console.log(`  ${chalk.red('failed  ')} ${displayPath(failure.path)} ${chalk.dim(failure.reason)}`);
      console.log();
      return true;
    }

    case 'auto':
      session.autoApprove = !session.autoApprove;
      showInfo(
        session.autoApprove
          ? 'Edits will be applied without asking. /auto again to go back.'
          : 'Edits will be shown for approval.'
      );
      return true;

    case 'clear':
      session.clear();
      showInfo('Conversation cleared. Mode, model and session cost are unchanged.');
      return true;

    default:
      showError(`Unknown command: /${command}\nTry /help`);
      return true;
  }
}

export async function runClaw(initialTask: string | undefined, options: ClawOptions = {}): Promise<void> {
  let session: ClawSession;
  try {
    session = new ClawSession({
      provider: options.provider,
      model: options.model,
      mode: options.mode,
      free: options.free,
      autoApprove: options.yes,
      maxIterationsPerTurn: options.maxIterations,
    });
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  if (!session.supportsTools) {
    showError(
      `${session.provider.displayName} does not support tool calling, which Claw needs.\n` +
      'Pick a provider that does, e.g. "cude claw -p anthropic" or "cude claw -p openai".'
    );
    process.exitCode = 1;
    return;
  }

  showHeader(session);

  const mcp = await initializeMcp();
  if (mcp.connected.length > 0) {
    console.log(chalk.dim(`  MCP: ${mcp.connected.join(', ')} (${mcp.tools.length} tools)`));
    console.log();
  }
  for (const failure of mcp.failed) {
    console.log(chalk.yellow(`  MCP server "${failure.server}" unavailable: ${failure.reason}`));
  }

  reader = new LineReader();
  // Destructive shell commands still go through the tool layer's own gate.
  setConfirmCallback(async message => {
    const answer = (await prompt(`\n  ${chalk.yellow('?')} ${message} ${chalk.dim('[y/N]')}: `)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  });

  let pending = initialTask;

  try {
    for (;;) {
      const input = pending ?? (await prompt(chalk.bold.cyan('\n  › ')));
      pending = undefined;

      const trimmed = input.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('/')) {
        const keepGoing = await handleSlash(trimmed, session);
        if (!keepGoing) break;
        continue;
      }

      console.log();
      startSpinner('Thinking...');

      let turn;
      try {
        turn = await session.send(trimmed, {
          onIteration: n => updateSpinner(`Thinking... (step ${n})`),
          onThought: text => {
            stopSpinner(true, '');
            console.log(renderMarkdown(text).split('\n').map(l => '  ' + l).join('\n'));
            startSpinner('Working...');
          },
          onToolCall: (name, args) => {
            updateSpinner(`${name} ${JSON.stringify(args).slice(0, 60)}`);
          },
          onToolResult: (name, ok, summary) => {
            stopSpinner(true, '');
            console.log(
              (ok ? chalk.green('  ✓ ') : chalk.red('  ✗ ')) +
              chalk.white(name) + ' ' + chalk.dim(summary)
            );
            startSpinner('Working...');
          },
          onApproval: async edit => {
            stopSpinner(true, '');
            const decision = await askApproval(edit);
            startSpinner('Working...');
            return decision;
          },
        });
        stopSpinner(true, '');
      } catch (err) {
        stopSpinner(false, 'Turn failed');
        showError(err instanceof Error ? err.message : String(err));
        continue;
      }

      if (turn.output) {
        console.log();
        console.log(renderMarkdown(turn.output.replace(/TASK COMPLETE:\s*/i, '')).split('\n').map(l => '  ' + l).join('\n'));
      }

      const costLabel = turn.cost === 0 ? chalk.green('free') : chalk.yellow(`$${turn.cost.toFixed(6)}`);
      console.log(
        chalk.dim(`  ─ ${turn.iterations} step${turn.iterations !== 1 ? 's' : ''}, ` +
        `${turn.toolCalls} tool call${turn.toolCalls !== 1 ? 's' : ''} · `) + costLabel +
        chalk.dim(` · session $${session.totalCost.toFixed(6)}`)
      );

      if (turn.stopReason === 'max_iterations') {
        console.log(chalk.yellow('  ⚠ Hit the per-turn step limit. Say "continue" to keep going.'));
      } else if (turn.stopReason === 'budget_exceeded') {
        console.log(chalk.red('  ⚠ Stopped by the spending limit. See: cude budget status'));
      }
    }
  } finally {
    reader?.close();
    reader = null;
    await shutdownMcp();
  }

  showCost(session);
  const changes = listCheckpoints().filter(c => c.runId === session.runId).length;
  if (changes > 0) {
    console.log(chalk.dim('  Undo this session: ') + chalk.cyan(`cude checkpoint restore-run ${session.runId}`));
    console.log();
  }
  printSeparator();
  console.log();
}

/** Exposed for the tests, which drive a session without a terminal. */
export { ClawSession, getMode };
