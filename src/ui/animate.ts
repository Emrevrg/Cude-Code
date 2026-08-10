import chalk from 'chalk';
import ora, { type Ora } from 'ora';

// ─── Terminal width ─────────────────────────────────────────────────────────

export function termWidth(): number {
  return Math.max(process.stdout.columns ?? 80, 60);
}

function boxWidth(): number {
  return Math.min(termWidth() - 6, 80);
}

// ─── Tool icons ─────────────────────────────────────────────────────────────

const TOOL_ICONS: Record<string, string> = {
  read_file:           '📄',
  write_file:          '💾',
  edit_file:           '✏️ ',
  run_command:         '⚡',
  list_directory:      '📁',
  create_directory:    '📁',
  git_status:          '🌿',
  git_diff:            '🔀',
  git_commit:          '📦',
  git_log:             '📜',
  fetch_webpage:       '🌐',
  web_search:          '🔍',
  run_code:            '🐍',
  search_memory:       '💭',
  browser_navigate:    '🌍',
  browser_click:       '👆',
  browser_type:        '⌨️ ',
  browser_get_content: '📋',
  browser_screenshot:  '📸',
  browser_close:       '🚪',
  test_project:        '🧪',
  grep_search:         '🔎',
  find_files:          '📂',
  delete_file:         '🗑️ ',
  move_file:           '📎',
  replace_in_files:    '🔄',
  git_branch:          '🌿',
  git_stash:           '📦',
  git_checkout:        '🔀',
  git_blame:           '👤',
  git_merge:           '🔗',
  git_cherry_pick:     '🍒',
  run_lint:            '🧹',
  analyze_project:     '📊',
  diff_files:          '📝',
  patch_file:          '🩹',
};

// ─── Spinner frame sets ─────────────────────────────────────────────────────

const FRAMES: Record<string, { frames: string[]; interval: number }> = {
  think:   { frames: ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'], interval: 80  },
  globe:   { frames: ['🌍','🌎','🌏','🌎'],                          interval: 350 },
  search:  { frames: ['🔍','🔎','🔍','🔎'],                          interval: 350 },
  file:    { frames: ['⠂','⠄','⠄','⠂'],                             interval: 150 },
  git:     { frames: ['○','◎','●','◎'],                               interval: 180 },
  code:    { frames: ['◆','◇','◈','◇'],                               interval: 160 },
  browser: { frames: ['🌍','🌎','🌏','🌎'],                          interval: 400 },
  test:    { frames: ['⢾','⢽','⢻','⢿','⡿','⢟','⢯','⢷'],           interval: 100 },
};

function framesForTool(toolName?: string): { frames: string[]; interval: number } {
  if (!toolName) return FRAMES['think']!;
  if (['web_search', 'fetch_webpage'].includes(toolName))
    return FRAMES['search']!;
  if (['browser_navigate','browser_click','browser_type','browser_get_content'].includes(toolName))
    return FRAMES['browser']!;
  if (['git_status','git_diff','git_commit','git_log'].includes(toolName))
    return FRAMES['git']!;
  if (['read_file','write_file','edit_file','list_directory','create_directory'].includes(toolName))
    return FRAMES['file']!;
  if (['run_code'].includes(toolName))
    return FRAMES['code']!;
  if (['test_project'].includes(toolName))
    return FRAMES['test']!;
  return FRAMES['think']!;
}

// ─── Elapsed timer ────────────────────────────────────────────────────────

let _startTime: number | null = null;

export function startTimer(): void { _startTime = Date.now(); }

export function elapsedStr(): string {
  if (_startTime === null) return '';
  const ms  = Date.now() - _startTime;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

// ─── Spinner singleton ──────────────────────────────────────────────────────

let _sp:      Ora    | null = null;
let _maxIter: number        = 10;

function ensureSpinner(text: string, toolName?: string): Ora {
  if (_sp?.isSpinning) {
    _sp.text    = text;
    _sp.spinner = framesForTool(toolName);
    return _sp;
  }
  stopAnimator();
  _sp = ora({ text, spinner: framesForTool(toolName), color: 'cyan' }).start();
  return _sp;
}

export function stopAnimator(success?: boolean, msg?: string): void {
  if (!_sp) return;
  if (success === true)       _sp.succeed(msg ? chalk.green(msg)  : undefined);
  else if (success === false) _sp.fail(msg   ? chalk.red(msg)    : undefined);
  else                        _sp.stop();
  _sp = null;
}

// ─── Cost formatter ───────────────────────────────────────────────────────

export function fmtCost(cost: number): string {
  if (cost === 0)         return chalk.green('Free');
  if (cost < 0.0001)     return chalk.yellow(`${(cost * 1_000_000).toFixed(1)}µ¢`);
  if (cost < 0.01)       return chalk.yellow(`$${cost.toFixed(5)}`);
  return chalk.yellow(`$${cost.toFixed(4)}`);
}

// ─── Public animator API ────────────────────────────────────────────────────

export const agentAnim = {

  think(step: number, maxIter?: number): void {
    if (maxIter) _maxIter = maxIter;
    const elapsed = elapsedStr();
    ensureSpinner(
      chalk.dim('Thinking…') +
      chalk.dim(`  step ${step}/${_maxIter}`) +
      (elapsed ? chalk.dim(`  ${elapsed}`) : ''),
      undefined
    );
  },

  toolStart(name: string, args: Record<string, unknown>): void {
    const icon   = TOOL_ICONS[name] ?? '⚙ ';
    const detail = _toolDetail(name, args);
    const maxW   = Math.min(termWidth() - 20, 60);
    const label  =
      `${icon} ${chalk.cyan(name)}` +
      (detail ? chalk.dim('  ' + detail.slice(0, maxW)) : '');

    if (_sp?.isSpinning) {
      _sp.stopAndPersist({ symbol: chalk.hex('#3b82f6')('⚙'), text: label });
      _sp = null;
    } else {
      process.stdout.write('\n  ' + chalk.hex('#3b82f6')('⚙ ') + label + '\n');
    }

    _sp = ora({
      text:    chalk.dim('running…') + chalk.dim('  ' + elapsedStr()),
      spinner: framesForTool(name),
      color:   'cyan',
    }).start();
  },

  toolDone(name: string, success: boolean, output: string): void {
    let preview: string;
    if (name === 'edit_file' && success) {
      preview = _editFileSummary(output);
    } else {
      const cleaned = output.replace(/\n/g, ' ').trim();
      const maxLen  = Math.min(termWidth() - 12, 100);
      preview = cleaned.slice(0, maxLen) + (cleaned.length > maxLen ? '…' : '');
    }

    const line   = success ? chalk.dim(preview) : chalk.red(preview);
    const symbol = success ? chalk.green('✓') : chalk.red('✗');

    if (_sp?.isSpinning) {
      _sp.stopAndPersist({ symbol, text: line });
      _sp = null;
    } else {
      process.stdout.write(`  ${symbol} ${line}\n`);
    }
  },

  finish(
    success: boolean,
    summary: string,
    meta?: { cost: number; tokens: number; steps: number }
  ): void {
    stopAnimator();
    const elapsed = elapsedStr();
    console.log();

    if (success) {
      const metaStr = meta
        ? chalk.dim(`${meta.steps} steps`) +
          (elapsed ? chalk.dim(` · ${elapsed}`) : '') +
          chalk.dim(' · ') + fmtCost(meta.cost) +
          chalk.dim(` · ${meta.tokens.toLocaleString()} tok`)
        : '';
      console.log(
        chalk.green('  ✔ ') + chalk.white.bold('Task complete!') +
        (metaStr ? chalk.dim('  ') + metaStr : '')
      );
    } else {
      console.log(chalk.red('  ✘ ') + chalk.white.bold('Task did not complete.'));
    }

    if (summary) {
      console.log();
      const lines  = summary.replace(/TASK COMPLETE:\s*/i, '').trim().split('\n');
      const maxW   = Math.min(termWidth() - 8, 90);
      const shown  = Math.min(lines.length, 10);
      for (const l of lines.slice(0, shown)) {
        console.log(chalk.dim('    ') + chalk.white(l.slice(0, maxW)));
      }
      if (lines.length > shown) {
        console.log(chalk.dim(`    … (${lines.length - shown} more lines)`));
      }
    }
  },
};

// ─── Agent header ───────────────────────────────────────────────────────────

export function printAgentHeader(opts: {
  task: string;
  provider: string;
  model: string;
  maxIter: number;
  mode?: string;
  autoCommit?: boolean;
}): void {
  const W      = boxWidth();
  const border = chalk.hex('#7c3aed');
  const pad    = (s: string) => s.slice(0, W).padEnd(W);

  const taskLines = wrapText('Task:  ' + opts.task, W);

  console.log();
  console.log(border('  ┌' + '─'.repeat(W + 2) + '┐'));
  console.log(border('  │ ') + chalk.bold.hex('#7c3aed')('◈ Cude Code Agent'.padEnd(W)) + border(' │'));
  console.log(border('  │ ') + chalk.dim('─'.repeat(W))                                 + border(' │'));

  for (const line of taskLines) {
    console.log(border('  │ ') + chalk.white(pad(line)) + border(' │'));
  }

  console.log(
    border('  │ ') +
    chalk.hex('#06b6d4')(pad(`Model: ${opts.provider}  ›  ${opts.model}`)) +
    border(' │')
  );

  const iterLine = `Limit: ${opts.maxIter} iterations` +
    (opts.autoCommit ? '  ·  auto-commit on' : '');
  console.log(border('  │ ') + chalk.dim(pad(iterLine)) + border(' │'));

  if (opts.mode) {
    console.log(border('  │ ') + chalk.hex('#10b981')(pad('Mode:  ' + opts.mode)) + border(' │'));
  }

  console.log(border('  └' + '─'.repeat(W + 2) + '┘'));
  console.log();
}

// ─── Ctrl+C / SIGINT graceful shutdown ───────────────────────────────────────

let _ctrlCHandler: (() => void) | null = null;

export function registerCtrlC(onInterrupt: () => void): () => void {
  _ctrlCHandler = onInterrupt;
  const handler = () => {
    stopAnimator();
    console.log();
    console.log(chalk.yellow('  ⚡ Interrupted — stopping agent...'));
    _ctrlCHandler?.();
    process.exit(130);
  };
  process.once('SIGINT', handler);
  return () => process.off('SIGINT', handler);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function getToolIcon(name: string): string {
  return TOOL_ICONS[name] ?? '⚙ ';
}

function _toolDetail(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'read_file':
    case 'edit_file':
    case 'write_file': {
      const p = args['path'] ? String(args['path']) : '';
      return p.length > 50 ? '…' + p.slice(-48) : p;
    }
    case 'run_command':
      return args['command'] ? String(args['command']).slice(0, 55) : '';
    case 'web_search':
      return args['query'] ? `"${String(args['query']).slice(0, 45)}"` : '';
    case 'fetch_webpage':
    case 'browser_navigate':
      return args['url'] ? String(args['url']).replace(/^https?:\/\//, '').slice(0, 50) : '';
    case 'git_commit':
      return args['message'] ? `"${String(args['message']).slice(0, 45)}"` : '';
    case 'list_directory':
      return args['path'] ? String(args['path']) : '';
    case 'test_project':
      return args['filter'] ? `filter: ${String(args['filter']).slice(0, 30)}` : '';
    case 'grep_search':
      return args['pattern'] ? `/${String(args['pattern']).slice(0, 40)}/` : '';
    case 'find_files':
      return args['pattern'] ? String(args['pattern']).slice(0, 40) : '';
    case 'delete_file':
    case 'move_file':
      return args['source'] ? String(args['source']).slice(0, 45) : (args['path'] ? String(args['path']).slice(0, 45) : '');
    case 'replace_in_files':
      return args['pattern'] ? `s/${String(args['pattern']).slice(0, 20)}/${String(args['replacement'] ?? '').slice(0, 20)}/` : '';
    case 'git_branch':
    case 'git_checkout':
      return args['name'] ?? args['target'] ? String(args['name'] ?? args['target']).slice(0, 40) : (args['action'] ? String(args['action']) : '');
    case 'git_stash':
      return args['action'] ? String(args['action']) : '';
    case 'git_blame':
      return args['path'] ? String(args['path']).slice(0, 45) : '';
    case 'git_merge':
      return args['branch'] ? String(args['branch']).slice(0, 40) : '';
    case 'git_cherry_pick':
      return args['commit'] ? String(args['commit']).slice(0, 12) : '';
    case 'run_lint':
      return args['fix'] ? 'auto-fix' : '';
    case 'analyze_project':
      return args['path'] ? String(args['path']).slice(0, 40) : '';
    default:
      return '';
  }
}

function _editFileSummary(output: string): string {
  if (!output) return 'file updated';
  const short = output.split('\n')[0]?.trim() ?? output;
  return short.slice(0, 80);
}

function wrapText(text: string, width: number): string[] {
  if (text.length <= width) return [text];
  const lines: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= width) { lines.push(remaining); break; }
    let cut = remaining.lastIndexOf(' ', width);
    if (cut <= 0) cut = width;
    lines.push(remaining.slice(0, cut));
    remaining = (lines.length === 1 ? '       ' : '       ') + remaining.slice(cut).trimStart();
  }
  return lines;
}
