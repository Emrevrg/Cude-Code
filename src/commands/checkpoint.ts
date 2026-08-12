import chalk from 'chalk';
import { format } from 'date-fns';
import {
  listCheckpoints,
  loadCheckpoint,
  restoreCheckpoint,
  restoreRun,
  clearCheckpoints,
  displayPath,
  type Checkpoint,
  type RestoreResult,
} from '../core/checkpoints.js';
import { showSuccess, showError, showInfo, printSeparator } from '../ui/display.js';

function describeChange(checkpoint: Checkpoint): string {
  const created = checkpoint.files.filter(f => f.content === null && !f.skipped).length;
  const modified = checkpoint.files.filter(f => f.content !== null).length;
  const parts: string[] = [];
  if (modified) parts.push(`${modified} modified`);
  if (created) parts.push(`${created} created`);
  return parts.join(', ') || 'no captured files';
}

export function runCheckpointList(): void {
  const checkpoints = listCheckpoints();

  console.log();
  console.log(chalk.bold.cyan('  Checkpoints'));
  printSeparator();
  console.log();

  if (checkpoints.length === 0) {
    showInfo('No checkpoints yet. They are recorded automatically before the agent changes a file.');
    console.log();
    return;
  }

  // Grouped by run, because undoing a whole run is the common case.
  const byRun = new Map<string, Checkpoint[]>();
  for (const checkpoint of checkpoints) {
    const existing = byRun.get(checkpoint.runId);
    if (existing) existing.push(checkpoint);
    else byRun.set(checkpoint.runId, [checkpoint]);
  }

  for (const [runId, group] of byRun) {
    const newest = group[0];
    console.log(
      chalk.bold.white(`  run ${runId}`) +
      chalk.dim(`  ${format(new Date(newest.createdAt), 'MMM d HH:mm')}  ` +
      `${group.length} checkpoint${group.length !== 1 ? 's' : ''}`)
    );
    console.log(chalk.dim(`    ${newest.task.substring(0, 68)}${newest.task.length > 68 ? '…' : ''}`));

    for (const checkpoint of group) {
      const files = checkpoint.files.map(f => displayPath(f.path)).join(', ');
      console.log(
        `    ${chalk.cyan(checkpoint.id)} ${chalk.yellow(checkpoint.toolName.padEnd(16))}` +
        chalk.dim(`${files.substring(0, 50)}  (${describeChange(checkpoint)})`)
      );
    }
    console.log();
  }

  console.log(chalk.dim('  Undo one:    ') + chalk.cyan('cude checkpoint restore <id>'));
  console.log(chalk.dim('  Undo a run:  ') + chalk.cyan('cude checkpoint restore-run <run-id>'));
  console.log();
}

export function runCheckpointShow(id: string): void {
  const checkpoint = loadCheckpoint(id);
  if (!checkpoint) {
    showError(`No checkpoint with id: ${id}\nRun "cude checkpoint list" to see them.`);
    process.exitCode = 1;
    return;
  }

  console.log();
  console.log(chalk.bold.cyan(`  Checkpoint ${checkpoint.id}`));
  printSeparator();
  console.log();
  console.log(chalk.dim('  Run:      ') + checkpoint.runId);
  console.log(chalk.dim('  Recorded: ') + format(new Date(checkpoint.createdAt), 'PPpp'));
  console.log(chalk.dim('  Before:   ') + chalk.yellow(checkpoint.toolName));
  console.log(chalk.dim('  Task:     ') + checkpoint.task);
  console.log();

  for (const file of checkpoint.files) {
    const state = file.skipped
      ? chalk.red('not captured (too large)')
      : file.content === null
      ? chalk.green('did not exist — restoring will delete it')
      : chalk.cyan(`${file.content.split('\n').length} lines captured`);
    console.log(`  ${chalk.white(displayPath(file.path))}`);
    console.log(`    ${state}`);
  }
  console.log();
}

function report(result: RestoreResult, label: string): void {
  if (result.restored.length === 0 && result.removed.length === 0) {
    if (result.failed.length > 0) {
      showError(
        `Could not restore ${label}:\n` +
        result.failed.map(f => `  ${displayPath(f.path)} — ${f.reason}`).join('\n')
      );
      process.exitCode = 1;
      return;
    }
    showInfo(`Nothing to restore for ${label}.`);
    return;
  }

  console.log();
  for (const path of result.restored) {
    console.log(`  ${chalk.green('restored')} ${chalk.white(displayPath(path))}`);
  }
  for (const path of result.removed) {
    console.log(`  ${chalk.yellow('removed ')} ${chalk.white(displayPath(path))} ${chalk.dim('(did not exist before)')}`);
  }
  for (const failure of result.failed) {
    console.log(`  ${chalk.red('failed  ')} ${chalk.white(displayPath(failure.path))} ${chalk.dim(failure.reason)}`);
  }
  console.log();

  const summary =
    `${result.restored.length} restored, ${result.removed.length} removed` +
    (result.failed.length > 0 ? `, ${result.failed.length} failed` : '');
  if (result.failed.length > 0) {
    showError(`${label}: ${summary}`);
    process.exitCode = 1;
  } else {
    showSuccess(`${label}: ${summary}`);
  }
}

export function runCheckpointRestore(id: string): void {
  const checkpoint = loadCheckpoint(id);
  if (!checkpoint) {
    showError(`No checkpoint with id: ${id}\nRun "cude checkpoint list" to see them.`);
    process.exitCode = 1;
    return;
  }
  report(restoreCheckpoint(checkpoint), `checkpoint ${id}`);
}

export function runCheckpointRestoreRun(runId: string): void {
  const belonging = listCheckpoints().filter(c => c.runId === runId);
  if (belonging.length === 0) {
    showError(`No checkpoints for run: ${runId}\nRun "cude checkpoint list" to see them.`);
    process.exitCode = 1;
    return;
  }
  report(restoreRun(runId), `run ${runId}`);
}

export async function runCheckpointClear(): Promise<void> {
  const { default: inquirer } = await import('inquirer');
  const count = listCheckpoints().length;
  if (count === 0) {
    showInfo('No checkpoints to clear.');
    return;
  }

  const answer = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Delete all ${count} checkpoints? Agent edits will no longer be undoable.`,
      default: false,
    },
  ]) as { confirm: boolean };

  if (!answer.confirm) {
    showInfo('Cancelled');
    return;
  }

  showSuccess(`Cleared ${clearCheckpoints()} checkpoints`);
}
