import { execFile } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';

const execFileAsync = promisify(execFile);

const CAPABILITIES = [
  ['typescript-language-server', 'LSP · TypeScript/JavaScript'],
  ['pyright-langserver', 'LSP · Python'],
  ['rust-analyzer', 'LSP · Rust'],
  ['gopls', 'LSP · Go'],
  ['debugpy', 'DAP · Python'],
  ['dlv', 'DAP · Go'],
  ['lldb-dap', 'DAP · C/C++/Rust'],
  ['gdb', 'Debugger · GDB'],
  ['omp', 'oh-my-pi bridge'],
  ['pi', 'Pi coding-agent bridge'],
] as const;

async function findExecutable(name: string): Promise<string | null> {
  try {
    const command = process.platform === 'win32' ? 'where.exe' : 'which';
    const { stdout } = await execFileAsync(command, [name], { windowsHide: true });
    return stdout.trim().split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}

export async function runDoctor(json = false): Promise<void> {
  const results = await Promise.all(CAPABILITIES.map(async ([name, label]) => ({
    name, label, path: await findExecutable(name),
  })));
  if (json) {
    process.stdout.write(JSON.stringify({ platform: process.platform, capabilities: results }) + '\n');
    return;
  }
  console.log(chalk.bold.cyan('\n  Cude Code capability check\n'));
  for (const item of results) {
    const status = item.path ? chalk.green('available') : chalk.dim('not found');
    console.log(`  ${status.padEnd(18)} ${item.label} ${item.path ? chalk.dim(`(${item.path})`) : ''}`);
  }
  console.log(chalk.dim('\n  Install language servers/debuggers separately to activate those integrations.\n'));
}
