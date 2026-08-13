import chalk from 'chalk';
import { defaultLspForFile, getDiagnostics, type LspOptions } from '../core/lsp.js';
import { showError } from '../ui/display.js';

export async function runLspDiagnostics(file: string, options: { server?: string; args?: string; json?: boolean } = {}): Promise<void> {
  const defaults = defaultLspForFile(file);
  const server: LspOptions | null = options.server ? { command: options.server, args: options.args?.split(' ').filter(Boolean) ?? [] } : defaults;
  if (!server) { showError(`No default LSP server is known for ${file}. Use --server <command>.`); process.exitCode = 1; return; }
  try {
    const diagnostics = await getDiagnostics(file, server);
    if (options.json) { process.stdout.write(JSON.stringify({ file, server: server.command, diagnostics }) + '\n'); return; }
    console.log(chalk.bold.cyan(`\n  LSP diagnostics · ${file}`));
    console.log(chalk.dim(`  Server: ${server.command}`));
    if (diagnostics.length === 0) console.log(chalk.green('  No diagnostics reported.'));
    for (const diagnostic of diagnostics) console.log(`  ${chalk.yellow(diagnostic.line ? `${diagnostic.line}:${diagnostic.column ?? 1}` : '')} ${diagnostic.message}${diagnostic.source ? chalk.dim(` [${diagnostic.source}]`) : ''}`);
  } catch (error) { showError(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
