import chalk from 'chalk';
import { execSync } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { printSeparator } from '../ui/display.js';
import { getWorkspaceRoot } from '../core/tools.js';
import { getConfig, getDataDir } from '../config/index.js';
import { loadMcpConfig } from '../mcp/registry.js';
import { isHttpConfig } from '../mcp/client.js';
import {
  allowsSecretFiles,
  allowsUnsafeCommands,
  auditEnabled,
  auditLogPath,
  blocksPrivateNetwork,
  classifyPath,
  findLoosePermissions,
  inheritsSecrets,
  isSecretEnvName,
  redactionDisabled,
  scanWorkspace,
  type ScanIssue,
  type ScanReport,
} from '../core/security.js';

/**
 * `cude security` — the controls in core/security.ts, pointed outward.
 *
 * The same detection that stops a secret reaching the model is what finds one
 * already committed to the repository, so the scanner is the security core
 * run over a directory instead of over a tool result. `audit` reports on the
 * installation itself: file permissions, plaintext keys, which protections
 * have been switched off.
 */

const SEVERITY_COLOR = {
  critical: chalk.red.bold,
  high: chalk.red,
  medium: chalk.yellow,
} as const;

/** Files git would actually commit, so an ignored `.env` is not reported as a leak. */
function gitTrackedFiles(root: string): Set<string> | undefined {
  try {
    const output = execSync('git ls-files', {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 16 * 1024 * 1024,
    });
    return new Set(output.split('\n').map(line => line.trim()).filter(Boolean));
  } catch {
    // Not a repository, or git is not installed — the scan still works.
    return undefined;
  }
}

function printIssues(issues: ScanIssue[]): void {
  for (const issue of issues) {
    const color = SEVERITY_COLOR[issue.severity];
    console.log(
      `  ${color(issue.severity.toUpperCase().padEnd(8))} ` +
      `${chalk.white(issue.file)}${chalk.dim(`:${issue.line}`)}`
    );
    console.log(`  ${' '.repeat(8)} ${chalk.dim(`${issue.description} — ${issue.preview}`)}`);
  }
}

export interface SecurityScanOptions {
  json?: boolean;
  /** Exit non-zero when anything is found. For CI. */
  strict?: boolean;
}

export function runSecurityScan(directory: string | undefined, options: SecurityScanOptions = {}): void {
  const root = directory ? join(process.cwd(), directory) : getWorkspaceRoot();

  if (!existsSync(root)) {
    console.log(chalk.red(`  No such directory: ${root}`));
    process.exitCode = 1;
    return;
  }

  const report = scanWorkspace(root, { gitTracked: gitTrackedFiles(root) });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    if (options.strict && hasFindings(report)) process.exitCode = 1;
    return;
  }

  console.log();
  console.log(chalk.bold.cyan('  Secret scan'));
  printSeparator();
  console.log(chalk.dim(`  ${report.root}`));
  console.log(chalk.dim(`  ${report.filesScanned} file(s) scanned`));
  console.log();

  if (report.issues.length === 0) {
    console.log(chalk.green('  No hardcoded credentials found.'));
  } else {
    const critical = report.issues.filter(i => i.severity === 'critical').length;
    console.log(
      chalk.red.bold(`  ${report.issues.length} possible credential(s) in source files`) +
      (critical ? chalk.red(` — ${critical} critical`) : '')
    );
    console.log();
    printIssues(report.issues);
  }

  if (report.secretFiles.length > 0) {
    console.log();
    console.log(chalk.bold('  Credential files present (never read by the agent):'));
    for (const file of report.secretFiles) {
      const tracked = report.trackedSecretFiles.includes(file);
      console.log(
        `  ${tracked ? chalk.red('tracked by git') : chalk.dim('ignored      ')}  ${file}`
      );
    }
    if (report.trackedSecretFiles.length > 0) {
      console.log();
      console.log(chalk.red.bold('  A credential file is tracked by git. It is in the history the moment it is pushed.'));
      console.log(chalk.dim('  Add it to .gitignore, then: git rm --cached <file>, and rotate the key.'));
    }
  }

  console.log();
  if (report.issues.length > 0) {
    console.log(chalk.dim('  Every finding above should be replaced with an environment variable and rotated —'));
    console.log(chalk.dim('  a key that reached a repository is a key that has to be assumed leaked.'));
    console.log();
  }

  if (options.strict && hasFindings(report)) process.exitCode = 1;
}

function hasFindings(report: ScanReport): boolean {
  return report.issues.length > 0 || report.trackedSecretFiles.length > 0;
}

/** Reports the state of the installation itself, and what is switched off. */
export function runSecurityAudit(): void {
  console.log();
  console.log(chalk.bold.cyan('  Security audit'));
  printSeparator();
  console.log();

  const problems: string[] = [];
  const notes: string[] = [];

  // 1. Where the keys are, and who can read them.
  const dataDir = getDataDir();
  const configFile = join(dataDir, 'config.json');
  const storedKeys = Object.keys((getConfig().get('apiKeys') as Record<string, string>) ?? {});

  console.log(chalk.bold('  Credential storage'));
  console.log(`    ${chalk.dim('data directory:')} ${dataDir}`);
  if (storedKeys.length === 0) {
    console.log(`    ${chalk.green('✓')} no API keys stored on disk — they come from the environment`);
  } else {
    console.log(
      `    ${chalk.yellow('!')} ${storedKeys.length} key(s) stored in plain text (${storedKeys.join(', ')})`
    );
    notes.push('Keys in config.json are not encrypted. Environment variables keep them out of a file entirely.');
  }

  if (process.platform === 'win32') {
    console.log(`    ${chalk.dim('permissions: governed by Windows ACLs on the user profile')}`);
  } else {
    const loose = findLoosePermissions(dataDir);
    if (loose.length === 0) {
      console.log(`    ${chalk.green('✓')} owner-only permissions throughout`);
    } else {
      console.log(`    ${chalk.red('✗')} ${loose.length} path(s) readable by other accounts:`);
      for (const path of loose.slice(0, 10)) console.log(`        ${path}`);
      problems.push(`Run: chmod -R go-rwx ${dataDir}`);
    }
  }
  console.log(`    ${chalk.dim('config file:')} ${existsSync(configFile) ? configFile : '(not created yet)'}`);
  console.log();

  // 2. Secrets exported into this shell reach every provider request.
  const secretEnv = Object.keys(process.env).filter(isSecretEnvName);
  console.log(chalk.bold('  Environment'));
  if (secretEnv.length === 0) {
    console.log(`    ${chalk.dim('no credential-shaped variables in this shell')}`);
  } else {
    console.log(`    ${chalk.green('✓')} ${secretEnv.length} credential variable(s) found; they are stripped from child processes`);
    console.log(`      ${chalk.dim(secretEnv.slice(0, 8).join(', '))}${secretEnv.length > 8 ? chalk.dim(', …') : ''}`);
  }
  console.log();

  // 3. Third-party servers get to run code and see tool arguments.
  console.log(chalk.bold('  MCP servers'));
  try {
    const servers = Object.entries(loadMcpConfig().mcpServers);
    if (servers.length === 0) {
      console.log(`    ${chalk.dim('none configured')}`);
    }
    for (const [name, config] of servers) {
      const kind = isHttpConfig(config) ? config.url : `${(config as { command: string }).command}`;
      const state = config.disabled ? chalk.dim('disabled') : chalk.yellow('enabled');
      console.log(`    ${state}  ${chalk.white(name)}  ${chalk.dim(kind)}`);
      const granted = Object.keys((config as { env?: Record<string, string> }).env ?? {}).filter(isSecretEnvName);
      if (granted.length > 0) {
        console.log(`             ${chalk.dim(`granted secrets: ${granted.join(', ')}`)}`);
      }
    }
    if (servers.some(([, c]) => !c.disabled)) {
      notes.push('An MCP server runs as you and sees every argument the agent sends it. Only enable ones you trust.');
    }
  } catch (err) {
    console.log(`    ${chalk.red('✗')} ${err instanceof Error ? err.message : String(err)}`);
  }
  console.log();

  // 4. Protections that are currently switched off.
  console.log(chalk.bold('  Active protections'));
  const controls: Array<[string, boolean, string]> = [
    ['credential files refused', !allowsSecretFiles(), 'CUDE_ALLOW_SECRET_FILES=1 is set'],
    ['secret redaction', !redactionDisabled(), 'CUDE_NO_REDACT=1 is set'],
    ['dangerous commands blocked', !allowsUnsafeCommands(), 'CUDE_ALLOW_UNSAFE_COMMANDS=1 is set'],
    ['secrets stripped from child processes', !inheritsSecrets(), 'CUDE_INHERIT_SECRETS=1 is set'],
    ['audit log', auditEnabled(), 'CUDE_AUDIT=0 is set'],
  ];
  for (const [label, on, why] of controls) {
    console.log(`    ${on ? chalk.green('✓') : chalk.red('✗')} ${label}${on ? '' : chalk.dim(`  — ${why}`)}`);
    if (!on) problems.push(`${label} is disabled (${why}).`);
  }
  console.log(
    `    ${blocksPrivateNetwork() ? chalk.green('✓') : chalk.dim('·')} private-network requests blocked` +
    (blocksPrivateNetwork() ? '' : chalk.dim('  — optional, set CUDE_BLOCK_PRIVATE_NETWORK=1'))
  );
  console.log(`    ${chalk.green('✓')} cloud metadata endpoints blocked (always)`);
  console.log(`    ${chalk.green('✓')} writes confined to ${getWorkspaceRoot()}`);
  console.log();

  // 5. The workspace itself.
  console.log(chalk.bold('  Workspace'));
  const root = getWorkspaceRoot();
  const gitignore = join(root, '.gitignore');
  const ignored = existsSync(gitignore) ? readFileSync(gitignore, 'utf-8') : '';
  const envFile = join(root, '.env');
  if (existsSync(envFile) && !/^\s*\.env\s*$/m.test(ignored) && !/^\s*\*?\.env\*?\s*$/m.test(ignored)) {
    console.log(`    ${chalk.red('✗')} .env exists and is not in .gitignore`);
    problems.push('Add .env to .gitignore before the next commit.');
  } else {
    console.log(`    ${chalk.green('✓')} no unignored .env in the workspace root`);
  }
  console.log(`    ${chalk.dim(`run "cude security scan" for a full credential sweep of ${relative(process.cwd(), root) || '.'}`)}`);
  console.log();

  // 6. Verdict.
  printSeparator();
  if (problems.length === 0) {
    console.log(chalk.green.bold('  Nothing to fix.'));
  } else {
    console.log(chalk.yellow.bold(`  ${problems.length} thing(s) to fix:`));
    for (const problem of problems) console.log(`    • ${problem}`);
  }
  for (const note of notes) console.log(chalk.dim(`    note: ${note}`));
  console.log();
}

/** Tail of the append-only tool-call log. */
export function runSecurityLog(options: { lines?: number } = {}): void {
  const path = auditLogPath();
  const limit = options.lines ?? 40;

  console.log();
  console.log(chalk.bold.cyan('  Audit log'));
  printSeparator();
  console.log(chalk.dim(`  ${path}`));

  if (!auditEnabled()) {
    console.log(chalk.yellow('  Logging is disabled (CUDE_AUDIT=0).'));
    console.log();
    return;
  }
  if (!existsSync(path)) {
    console.log(chalk.dim('  Nothing recorded yet.'));
    console.log();
    return;
  }

  console.log(chalk.dim(`  ${(statSync(path).size / 1024).toFixed(1)} KB, last ${limit} entries`));
  console.log();

  const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean).slice(-limit);
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as { at: string; tool: string; args: string; outcome: string; detail?: string };
      const outcome =
        entry.outcome === 'ok' ? chalk.green('ok     ')
        : entry.outcome === 'blocked' ? chalk.red('blocked')
        : entry.outcome === 'denied' ? chalk.yellow('denied ')
        : chalk.dim('error  ');
      console.log(
        `  ${chalk.dim(entry.at.slice(11, 19))} ${outcome} ${chalk.white(entry.tool.padEnd(18))} ${chalk.dim(entry.args.slice(0, 90))}`
      );
      if (entry.detail) console.log(`  ${' '.repeat(28)}${chalk.dim(entry.detail.slice(0, 90))}`);
    } catch {
      // A truncated final line during a concurrent write; skip it.
    }
  }
  console.log();
}

/** Explains why one path is or is not readable — the deny-list, made checkable. */
export function runSecurityCheck(target: string): void {
  const verdict = classifyPath(target);
  console.log();
  if (verdict.sensitive) {
    console.log(`  ${chalk.red('protected')}  ${target}`);
    console.log(`  ${chalk.dim(verdict.reason)}`);
    if (allowsSecretFiles()) {
      console.log(`  ${chalk.yellow('but CUDE_ALLOW_SECRET_FILES=1 is set, so the agent can read it anyway')}`);
    }
  } else {
    console.log(`  ${chalk.green('readable')}  ${target}`);
  }
  console.log();
}
