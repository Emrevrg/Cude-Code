import chalk from 'chalk';
import {
  loadMcpConfig,
  saveMcpConfig,
  getMcpConfigPath,
  initializeMcp,
  shutdownMcp,
} from '../mcp/registry.js';
import { McpClient, isHttpConfig, type McpServerConfig } from '../mcp/client.js';
import { showSuccess, showError, showInfo, printSeparator } from '../ui/display.js';
import { startSpinner, stopSpinner } from '../ui/spinner.js';

function describeTransport(config: McpServerConfig): string {
  if (isHttpConfig(config)) return config.url;
  const parts = [config.command, ...(config.args ?? [])];
  return parts.join(' ');
}

export function runMcpList(): void {
  let config;
  try {
    config = loadMcpConfig();
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  const servers = Object.entries(config.mcpServers);

  console.log();
  console.log(chalk.bold.cyan('  MCP Servers'));
  printSeparator();
  console.log();

  if (servers.length === 0) {
    showInfo('No MCP servers configured.');
    console.log();
    console.log(chalk.dim('  Add one:'));
    console.log(chalk.cyan('    cude mcp add filesystem --command npx ') +
      chalk.dim('-- -y @modelcontextprotocol/server-filesystem /path'));
    console.log(chalk.cyan('    cude mcp add docs --url https://example.com/mcp'));
    console.log();
    console.log(chalk.dim(`  Or edit ${getMcpConfigPath()} directly — it uses the same`));
    console.log(chalk.dim('  "mcpServers" shape as other MCP clients, so an existing'));
    console.log(chalk.dim('  configuration can be copied across unchanged.'));
    console.log();
    return;
  }

  for (const [name, server] of servers) {
    const state = server.disabled ? chalk.dim('○ disabled') : chalk.green('✓ enabled ');
    const kind = isHttpConfig(server) ? chalk.magenta('http ') : chalk.blue('stdio');
    console.log(`  ${state} ${kind} ${chalk.bold.white(name.padEnd(18))}${chalk.dim(describeTransport(server))}`);
  }

  console.log();
  console.log(chalk.dim(`  Config: ${getMcpConfigPath()}`));
  console.log(chalk.dim('  Check they work: ') + chalk.cyan('cude mcp test'));
  console.log();
}

export async function runMcpTest(): Promise<void> {
  startSpinner('Connecting to MCP servers...');
  const result = await initializeMcp();
  stopSpinner(result.failed.length === 0, 'MCP check complete');

  console.log();
  if (result.connected.length === 0 && result.failed.length === 0) {
    showInfo('No MCP servers configured. Run "cude mcp list" for how to add one.');
    console.log();
    await shutdownMcp();
    return;
  }

  for (const server of result.connected) {
    const tools = result.tools.filter(t => t.name.startsWith(`mcp__${server}__`));
    console.log(`  ${chalk.green('✓')} ${chalk.bold.white(server.padEnd(18))}${chalk.dim(`${tools.length} tool${tools.length !== 1 ? 's' : ''}`)}`);
    for (const tool of tools) {
      const bare = tool.name.replace(`mcp__${server}__`, '');
      console.log(`      ${chalk.cyan(bare.padEnd(28))}${chalk.dim(tool.description.replace(`[${server}] `, '').substring(0, 60))}`);
    }
  }

  for (const failure of result.failed) {
    console.log(`  ${chalk.red('✗')} ${chalk.bold.white(failure.server.padEnd(18))}${chalk.red(failure.reason)}`);
  }

  console.log();
  if (result.failed.length > 0) process.exitCode = 1;
  await shutdownMcp();
}

export interface McpAddOptions {
  command?: string;
  args?: string[];
  url?: string;
  header?: string[];
  env?: string[];
  cwd?: string;
}

function parsePairs(pairs: string[] | undefined, label: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of pairs ?? []) {
    const index = pair.indexOf('=');
    if (index === -1) {
      throw new Error(`${label} must be KEY=VALUE, got: ${pair}`);
    }
    out[pair.slice(0, index)] = pair.slice(index + 1);
  }
  return out;
}

export async function runMcpAdd(name: string, options: McpAddOptions): Promise<void> {
  if (!options.command && !options.url) {
    showError(
      'An MCP server needs either --command (stdio) or --url (http).\n' +
      '  cude mcp add files --command npx -- -y @modelcontextprotocol/server-filesystem .\n' +
      '  cude mcp add docs --url https://example.com/mcp'
    );
    process.exitCode = 1;
    return;
  }
  if (options.command && options.url) {
    showError('Choose one transport: --command or --url, not both.');
    process.exitCode = 1;
    return;
  }

  let server: McpServerConfig;
  try {
    server = options.url
      ? { url: options.url, headers: parsePairs(options.header, '--header') }
      : {
          command: options.command!,
          args: options.args ?? [],
          env: parsePairs(options.env, '--env'),
          ...(options.cwd ? { cwd: options.cwd } : {}),
        };
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  const config = loadMcpConfig();
  const replacing = name in config.mcpServers;

  // Verify before saving, so a typo is caught now rather than mid-run.
  startSpinner(`Connecting to ${name}...`);
  const client = new McpClient(name, server);
  let tools;
  try {
    tools = await client.listTools();
    stopSpinner(true, `${name}: ${tools.length} tool${tools.length !== 1 ? 's' : ''}`);
  } catch (err) {
    stopSpinner(false, `${name} did not respond`);
    await client.close();
    showError(
      `Could not connect to "${name}": ${err instanceof Error ? err.message : String(err)}\n` +
      'Nothing was saved. Fix the command or URL and try again.'
    );
    process.exitCode = 1;
    return;
  }
  await client.close();

  config.mcpServers[name] = server;
  saveMcpConfig(config);

  console.log();
  for (const tool of tools) {
    console.log(`  ${chalk.cyan(tool.name.padEnd(28))}${chalk.dim((tool.description ?? '').substring(0, 60))}`);
  }
  console.log();
  showSuccess(`${replacing ? 'Updated' : 'Added'} MCP server "${name}" — its tools are now available to the agent`);
}

export async function runMcpRemove(name: string): Promise<void> {
  const config = loadMcpConfig();
  if (!(name in config.mcpServers)) {
    showError(`No MCP server named "${name}".\nConfigured: ${Object.keys(config.mcpServers).join(', ') || '(none)'}`);
    process.exitCode = 1;
    return;
  }

  delete config.mcpServers[name];
  saveMcpConfig(config);
  showSuccess(`Removed MCP server "${name}"`);
}

export function runMcpToggle(name: string, disabled: boolean): void {
  const config = loadMcpConfig();
  const server = config.mcpServers[name];
  if (!server) {
    showError(`No MCP server named "${name}".`);
    process.exitCode = 1;
    return;
  }

  if (disabled) server.disabled = true;
  else delete server.disabled;

  saveMcpConfig(config);
  showSuccess(`MCP server "${name}" ${disabled ? 'disabled' : 'enabled'}`);
}
