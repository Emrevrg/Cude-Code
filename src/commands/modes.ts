import chalk from 'chalk';
import { listModes, getMode, toolsForMode } from '../core/modes.js';
import { findRuleFiles, buildRulesPrompt } from '../core/rules.js';
import { getWorkspaceRoot } from '../core/tools.js';
import { showInfo, printSeparator } from '../ui/display.js';
import { relative } from 'path';

export function runModesList(): void {
  console.log();
  console.log(chalk.bold.cyan('  Agent Modes'));
  printSeparator();
  console.log();

  for (const mode of listModes()) {
    const tools = toolsForMode(mode);
    const budget =
      mode.allowedTools === 'all'
        ? chalk.dim(`all ${tools.length} tools`)
        : chalk.yellow(
            `${tools.length} tools` +
            (mode.writablePathPattern ? `, writes limited to ${mode.writablePathPattern}` : ', read-only')
          );

    console.log(`  ${chalk.bold.white(mode.name.padEnd(14))}${chalk.cyan(mode.displayName)}`);
    console.log(`  ${' '.repeat(14)}${chalk.dim(mode.description)}`);
    console.log(`  ${' '.repeat(14)}${budget}`);
    console.log();
  }

  console.log(chalk.dim('  Use: ') + chalk.cyan('cude run "task" --mode architect'));
  console.log(chalk.dim('       ') + chalk.cyan('cude claw --mode ask'));
  console.log();
}

export function runModesShow(name: string): void {
  let mode;
  try {
    mode = getMode(name);
  } catch (err) {
    console.log(chalk.red(`  ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
    return;
  }

  const tools = toolsForMode(mode);
  console.log();
  console.log(chalk.bold.cyan(`  ${mode.displayName} mode`));
  printSeparator();
  console.log();
  console.log(chalk.dim('  ' + mode.description));
  console.log();
  console.log(chalk.bold('  System prompt:'));
  console.log(chalk.dim('  ' + mode.systemPrompt.replace(/\n/g, '\n  ')));
  console.log();
  console.log(chalk.bold(`  Tools (${tools.length}):`));
  console.log(chalk.dim('  ' + tools.map(t => t.name).join(', ')));
  console.log();
}

export function runRulesList(): void {
  const root = getWorkspaceRoot();
  const files = findRuleFiles();

  console.log();
  console.log(chalk.bold.cyan('  Project Rules'));
  printSeparator();
  console.log();
  console.log(chalk.dim(`  Workspace root: ${root}`));
  console.log();

  if (files.length === 0) {
    showInfo('No rule files found.');
    console.log();
    console.log(chalk.dim('  Cude reads standing instructions from any of:'));
    console.log(chalk.cyan('    AGENTS.md') + chalk.dim('        (also read by other agent tools)'));
    console.log(chalk.cyan('    CUDE.md'));
    console.log(chalk.cyan('    .cuderules'));
    console.log(chalk.cyan('    .cude/rules/*.md'));
    console.log();
    console.log(chalk.dim('  Files are discovered from the filesystem root down to the'));
    console.log(chalk.dim('  workspace, so the closest one to your work wins.'));
    console.log();
    return;
  }

  // Nearest last, which is the order they reach the prompt.
  for (const file of files) {
    const label = relative(root, file.path) || file.path;
    const lines = file.content.split('\n').length;
    console.log(
      `  ${chalk.green('✓')} ${chalk.white(label.padEnd(36))} ${chalk.dim(`${lines} lines, ${file.content.length} chars`)}`
    );
  }

  const prompt = buildRulesPrompt(files);
  console.log();
  console.log(chalk.dim(`  ${prompt.length} characters appended to every agent system prompt.`));
  console.log(chalk.dim('  Later files override earlier ones.'));
  console.log();
}
