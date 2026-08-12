import chalk from 'chalk';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import {
  listSessions,
  loadSession,
  deleteSession,
  exportSessionToMarkdown,
  forkSession,
} from '../storage/sessions.js';
import { showSuccess, showError, showInfo, showSessionTable } from '../ui/display.js';
import { runChat } from './chat.js';

export async function runSessionsList(): Promise<void> {
  const sessions = listSessions();

  if (sessions.length === 0) {
    console.log();
    showInfo('No sessions found.');
    console.log(chalk.dim('  Start a chat session with: cude chat --session <name>'));
    console.log();
    return;
  }

  console.log();
  console.log(chalk.bold.cyan(`  Chat Sessions (${sessions.length})`));
  showSessionTable(sessions);
  console.log(chalk.dim('  Continue a session: cude sessions continue <id>'));
  console.log(chalk.dim('  Delete a session:   cude sessions delete <id>'));
  console.log(chalk.dim('  Export to markdown: cude sessions export <id>'));
  console.log();
}

export async function runSessionsContinue(idOrName: string): Promise<void> {
  // Try to find by exact ID first
  let session = loadSession(idOrName);

  // Try partial ID match
  if (!session) {
    const sessions = listSessions();
    const found = sessions.find(
      s => s.id.startsWith(idOrName) || s.name.toLowerCase() === idOrName.toLowerCase()
    );
    if (found) {
      session = found;
    }
  }

  if (!session) {
    showError(`Session not found: ${idOrName}`);
    console.log(chalk.dim('  Use "cude sessions list" to see available sessions'));
    process.exit(1);
  }

  console.log();
  showInfo(`Continuing session: ${chalk.cyan(session.name)} (${session.messages.filter(m => m.role !== 'system').length} messages)`);

  await runChat({
    session: session.name,
    provider: session.provider,
    model: session.model,
  });
}

export async function runSessionsDelete(idOrName: string): Promise<void> {
  // Find session
  let sessionId = idOrName;
  const sessions = listSessions();
  const found = sessions.find(
    s => s.id === idOrName ||
         s.id.startsWith(idOrName) ||
         s.name.toLowerCase() === idOrName.toLowerCase()
  );

  if (!found) {
    showError(`Session not found: ${idOrName}`);
    process.exit(1);
  }

  sessionId = found.id;

  const { default: inquirer } = await import('inquirer');
  const answer = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Delete session "${found.name}"? This cannot be undone.`,
      default: false,
    },
  ]) as { confirm: boolean };

  if (answer.confirm) {
    if (deleteSession(sessionId)) {
      showSuccess(`Session "${found.name}" deleted`);
    } else {
      showError(`Failed to delete session`);
    }
  } else {
    showInfo('Delete cancelled');
  }
}

export async function runSessionsExport(idOrName: string, outputPath?: string): Promise<void> {
  // Find session
  let session = loadSession(idOrName);

  if (!session) {
    const sessions = listSessions();
    const found = sessions.find(
      s => s.id.startsWith(idOrName) || s.name.toLowerCase() === idOrName.toLowerCase()
    );
    if (found) {
      session = found;
    }
  }

  if (!session) {
    showError(`Session not found: ${idOrName}`);
    process.exit(1);
  }

  const markdown = exportSessionToMarkdown(session);
  const filename = outputPath ?? `${session.name.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().split('T')[0]}.md`;
  const fullPath = resolve(filename);

  writeFileSync(fullPath, markdown, 'utf-8');
  showSuccess(`Session exported to: ${fullPath}`);
  console.log(chalk.dim(`  ${session.messages.filter(m => m.role !== 'system').length} messages, $${session.totalCost.toFixed(6)} total cost`));
}

export async function runSessionsFork(idOrName: string, name: string): Promise<void> {
  const sessions = listSessions();
  const source = sessions.find(s =>
    s.id === idOrName || s.id.startsWith(idOrName) || s.name.toLowerCase() === idOrName.toLowerCase()
  );
  if (!source) {
    showError(`Session not found: ${idOrName}`);
    process.exit(1);
  }
  const fork = forkSession(source, name);
  showSuccess(`Session forked as "${fork.name}"`);
  console.log(chalk.dim(`  New id: ${fork.id}`));
  console.log(chalk.dim(`  Parent: ${source.id}`));
}
