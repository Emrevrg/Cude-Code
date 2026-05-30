import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';
import type { ToolDefinition } from '../providers/types.js';

const execAsync = promisify(exec);

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file at the given path',
    parameters: {
      properties: {
        path: {
          type: 'string',
          description: 'The path to the file to read',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file at the given path, creating it if it does not exist',
    parameters: {
      properties: {
        path: {
          type: 'string',
          description: 'The path to write the file to',
        },
        content: {
          type: 'string',
          description: 'The content to write to the file',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'run_command',
    description: 'Execute a shell command and return its output',
    parameters: {
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute',
        },
        cwd: {
          type: 'string',
          description: 'The working directory to run the command in (optional)',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'list_directory',
    description: 'List the contents of a directory',
    parameters: {
      properties: {
        path: {
          type: 'string',
          description: 'The path to the directory to list',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'create_directory',
    description: 'Create a directory and all necessary parent directories',
    parameters: {
      properties: {
        path: {
          type: 'string',
          description: 'The path of the directory to create',
        },
      },
      required: ['path'],
    },
  },
];

// Commands that require confirmation
const DESTRUCTIVE_PATTERNS = [
  /rm\s+-rf/i,
  /rm\s+--force/i,
  /sudo\s+rm/i,
  /format\s+/i,
  /mkfs\./i,
  /dd\s+if=/i,
  />\s*\/dev\//i,
  /shutdown/i,
  /reboot/i,
];

function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_PATTERNS.some(p => p.test(command));
}

type ConfirmCallback = (message: string) => Promise<boolean>;

let confirmCallback: ConfirmCallback | null = null;

export function setConfirmCallback(fn: ConfirmCallback): void {
  confirmCallback = fn;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  switch (name) {
    case 'read_file':
      return executeReadFile(args.path as string);

    case 'write_file':
      return executeWriteFile(args.path as string, args.content as string);

    case 'run_command':
      return executeRunCommand(args.command as string, args.cwd as string | undefined);

    case 'list_directory':
      return executeListDirectory(args.path as string);

    case 'create_directory':
      return executeCreateDirectory(args.path as string);

    default:
      return { success: false, output: '', error: `Unknown tool: ${name}` };
  }
}

function executeReadFile(filePath: string): ToolResult {
  try {
    const resolved = resolve(filePath);
    if (!existsSync(resolved)) {
      return { success: false, output: '', error: `File not found: ${filePath}` };
    }
    const content = readFileSync(resolved, 'utf-8');
    return { success: true, output: content };
  } catch (err) {
    return { success: false, output: '', error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function executeWriteFile(filePath: string, content: string): ToolResult {
  try {
    const resolved = resolve(filePath);
    const dir = dirname(resolved);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(resolved, content, 'utf-8');
    return { success: true, output: `Successfully wrote ${content.length} characters to ${filePath}` };
  } catch (err) {
    return { success: false, output: '', error: `Failed to write file: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function executeRunCommand(command: string, cwd?: string): Promise<ToolResult> {
  if (isDestructiveCommand(command)) {
    if (confirmCallback) {
      const confirmed = await confirmCallback(
        `WARNING: Destructive command detected!\n  ${command}\n  Do you want to proceed?`
      );
      if (!confirmed) {
        return { success: false, output: '', error: 'Command cancelled by user' };
      }
    } else {
      return { success: false, output: '', error: 'Destructive command blocked (no confirmation callback registered)' };
    }
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: cwd ? resolve(cwd) : process.cwd(),
      timeout: 60000,
    });
    const output = stdout + (stderr ? `\nSTDERR: ${stderr}` : '');
    return { success: true, output };
  } catch (err) {
    if (err instanceof Error && 'stdout' in err && 'stderr' in err) {
      const execErr = err as NodeJS.ErrnoException & { stdout: string; stderr: string };
      return {
        success: false,
        output: execErr.stdout ?? '',
        error: execErr.stderr ?? err.message,
      };
    }
    return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
  }
}

function executeListDirectory(dirPath: string): ToolResult {
  try {
    const resolved = resolve(dirPath);
    if (!existsSync(resolved)) {
      return { success: false, output: '', error: `Directory not found: ${dirPath}` };
    }
    const entries = readdirSync(resolved);
    const details = entries.map(entry => {
      try {
        const fullPath = join(resolved, entry);
        const stat = statSync(fullPath);
        const type = stat.isDirectory() ? 'd' : 'f';
        const size = stat.isFile() ? `${stat.size}B` : '';
        return `${type} ${entry}${size ? ` (${size})` : ''}`;
      } catch {
        return `? ${entry}`;
      }
    });
    return { success: true, output: details.join('\n') || '(empty directory)' };
  } catch (err) {
    return { success: false, output: '', error: `Failed to list directory: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function executeCreateDirectory(dirPath: string): ToolResult {
  try {
    const resolved = resolve(dirPath);
    mkdirSync(resolved, { recursive: true });
    return { success: true, output: `Directory created: ${dirPath}` };
  } catch (err) {
    return { success: false, output: '', error: `Failed to create directory: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export function formatToolCall(name: string, args: Record<string, unknown>): string {
  const argStr = Object.entries(args)
    .map(([k, v]) => `${k}=${JSON.stringify(String(v).substring(0, 50))}`)
    .join(', ');
  return chalk.cyan(`[Tool: ${name}(${argStr})]`);
}

export function formatToolResult(result: ToolResult): string {
  if (result.success) {
    const preview = result.output.length > 200
      ? result.output.substring(0, 200) + '...'
      : result.output;
    return chalk.green(`✓ `) + chalk.dim(preview);
  }
  return chalk.red(`✗ ${result.error ?? 'Unknown error'}`);
}
