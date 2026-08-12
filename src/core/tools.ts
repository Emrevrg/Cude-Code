import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, unlinkSync, copyFileSync, renameSync } from 'fs';
import { join, resolve, dirname, relative, isAbsolute } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';
import { getWorkspaceRootSetting } from '../config/index.js';
import type { ToolDefinition } from '../providers/types.js';
import { BROWSER_TOOL_DEFINITIONS, executeBrowserTool } from './browser.js';
import { RAG_TOOL_DEFINITIONS, executeRagTool } from './rag.js';

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
        start_line: {
          type: 'number',
          description: 'Optional line number to start reading from (1-indexed)',
        },
        end_line: {
          type: 'number',
          description: 'Optional line number to end reading at (1-indexed)',
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
    name: 'replace_in_file',
    description: 'Replace text in a file by finding and replacing a specific string. Set replace_all=true to replace every occurrence.',
    parameters: {
      properties: {
        path: {
          type: 'string',
          description: 'The path to the file',
        },
        old_text: {
          type: 'string',
          description: 'The text to find and replace',
        },
        new_text: {
          type: 'string',
          description: 'The new text to replace with',
        },
        replace_all: {
          type: 'boolean',
          description: 'If true, replace every occurrence (default: false — only the first)',
        },
      },
      required: ['path', 'old_text', 'new_text'],
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
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 60000)',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'list_directory',
    description: 'List the contents of a directory with file information',
    parameters: {
      properties: {
        path: {
          type: 'string',
          description: 'The path to the directory to list',
        },
        recursive: {
          type: 'boolean',
          description: 'Whether to list recursively',
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
  {
    name: 'delete_file',
    description: 'Delete a file from the filesystem',
    parameters: {
      properties: {
        path: {
          type: 'string',
          description: 'The path to the file to delete',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'copy_file',
    description: 'Copy a file from source to destination',
    parameters: {
      properties: {
        source: {
          type: 'string',
          description: 'The source file path',
        },
        destination: {
          type: 'string',
          description: 'The destination file path',
        },
      },
      required: ['source', 'destination'],
    },
  },
  {
    name: 'search_files',
    description: 'Search for files matching a pattern in a directory',
    parameters: {
      properties: {
        pattern: {
          type: 'string',
          description: 'File pattern to search for (glob pattern or regex)',
        },
        directory: {
          type: 'string',
          description: 'The directory to search in',
        },
      },
      required: ['pattern', 'directory'],
    },
  },
  {
    name: 'grep_search',
    description: 'Search for text content within files',
    parameters: {
      properties: {
        pattern: {
          type: 'string',
          description: 'The text or regex pattern to search for',
        },
        directory: {
          type: 'string',
          description: 'The directory to search in',
        },
        file_pattern: {
          type: 'string',
          description: 'Optional file glob pattern to limit search',
        },
      },
      required: ['pattern', 'directory'],
    },
  },
  {
    name: 'get_file_info',
    description: 'Get detailed information about a file',
    parameters: {
      properties: {
        path: {
          type: 'string',
          description: 'The path to the file',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'git_command',
    description: 'Execute a git command in the repository',
    parameters: {
      properties: {
        command: {
          type: 'string',
          description: 'The git command to execute (without "git" prefix)',
        },
        cwd: {
          type: 'string',
          description: 'The repository directory (optional)',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'npm_command',
    description: 'Execute an npm command',
    parameters: {
      properties: {
        command: {
          type: 'string',
          description: 'The npm command to execute (without "npm" prefix)',
        },
        cwd: {
          type: 'string',
          description: 'The working directory (optional)',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'move_file',
    description: 'Move or rename a file to a new location',
    parameters: {
      properties: {
        source: {
          type: 'string',
          description: 'The current path of the file',
        },
        destination: {
          type: 'string',
          description: 'The new path for the file',
        },
      },
      required: ['source', 'destination'],
    },
  },
  {
    name: 'diff_files',
    description: 'Show a unified diff between two files',
    parameters: {
      properties: {
        file_a: {
          type: 'string',
          description: 'Path to the first file',
        },
        file_b: {
          type: 'string',
          description: 'Path to the second file',
        },
      },
      required: ['file_a', 'file_b'],
    },
  },
  {
    name: 'apply_patch',
    description: 'Apply a multi-hunk unified-diff patch to a single file',
    parameters: {
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to patch',
        },
        patch: {
          type: 'string',
          description: 'A unified diff patch (with --- / +++ headers and @@ hunks) to apply',
        },
      },
      required: ['path', 'patch'],
    },
  },
  ...BROWSER_TOOL_DEFINITIONS,
  ...RAG_TOOL_DEFINITIONS,
];

// ─── Workspace boundary ─────────────────────────────────────────────────────
//
// Every mutating file tool used to resolve() its argument and act, with no
// restriction at all — `delete_file` would unlink anything the process could
// reach. Mutations are now confined to a workspace root. Reads stay
// unrestricted: the agent frequently needs to look at files outside the tree.

let explicitWorkspaceRoot: string | null = null;

/** Injection point for tests and embedders; overrides env and config. */
export function setWorkspaceRoot(root: string): void {
  explicitWorkspaceRoot = resolve(root);
}

export function resetWorkspaceRoot(): void {
  explicitWorkspaceRoot = null;
}

export function getWorkspaceRoot(): string {
  if (explicitWorkspaceRoot) return explicitWorkspaceRoot;
  const fromEnv = process.env.CUDE_WORKSPACE_ROOT;
  if (fromEnv && fromEnv.trim()) return resolve(fromEnv.trim());
  const fromConfig = getWorkspaceRootSetting();
  if (fromConfig) return resolve(fromConfig);
  return process.cwd();
}

export function isInsideWorkspace(target: string): boolean {
  const root = getWorkspaceRoot();
  const rel = relative(root, resolve(target));
  // A path on another drive comes back absolute, which isAbsolute catches.
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Returns a ToolResult to abort with, or null when the path is allowed. */
function guardWritePath(filePath: string, label = 'path'): ToolResult | null {
  const resolved = resolve(filePath);
  if (isInsideWorkspace(resolved)) return null;
  return {
    success: false,
    output: '',
    error:
      `Refusing to modify a ${label} outside the workspace root.\n` +
      `  ${label}: ${resolved}\n` +
      `  workspace root: ${getWorkspaceRoot()}\n` +
      `Change the root with CUDE_WORKSPACE_ROOT or "cude config set workspace-root <dir>".`,
  };
}

// ─── Destructive commands ───────────────────────────────────────────────────
//
// The old list was nine POSIX regexes applied only to run_command, so none of
// `del /f /s /q`, `rd /s /q` or `Remove-Item -Recurse -Force` matched on
// Windows — and `git_command` and `npm_command` bypassed the check entirely.
const DESTRUCTIVE_PATTERNS = [
  // POSIX
  /\brm\s+(-\w*[rf]\w*|--recursive|--force)/i,
  /sudo\s+rm/i,
  /\bmkfs\./i,
  /\bdd\s+if=/i,
  />\s*\/dev\//i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  // `format ` alone also matched `npm run format`, which now reaches this
  // check; a drive letter is what makes it the destructive command.
  /\bformat\s+[a-z]:/i,
  // Windows cmd
  /\bdel\s+\/[a-z]/i,
  /\brd\s+\/s/i,
  /\brmdir\s+\/s/i,
  /\bdiskpart\b/i,
  // PowerShell
  /\bRemove-Item\b[\s\S]*(-Recurse|-Force)/i,
  /\bInvoke-Expression\b/i,
  /(^|[\s;|])iex(\s|$)/i,
  // Piping a download straight into a shell
  /\|\s*(sudo\s+)?(ba|z|k)?sh\b/i,
  /\|\s*(powershell|pwsh)\b/i,
  // git and npm reach this check now, and some of their subcommands destroy
  // work that is not recoverable from the repository.
  /\bgit\s+clean\b[^;|]*\s-[a-z]*f/i,
  /\bgit\s+reset\s+--hard/i,
  /\bgit\s+push\b[^;|]*\s(--force(?!-with-lease)|-f)\b/i,
  /\bgit\s+branch\s+-D\b/,
  /\bgit\s+checkout\s+--\s/i,
  /\bnpm\s+(publish|unpublish)\b/i,
];

export function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_PATTERNS.some(p => p.test(command));
}

type ConfirmCallback = (message: string) => Promise<boolean>;

let confirmCallback: ConfirmCallback | null = null;

export function setConfirmCallback(fn: ConfirmCallback): void {
  confirmCallback = fn;
}

export function clearConfirmCallback(): void {
  confirmCallback = null;
}

/**
 * Returns a ToolResult to abort with when the operation must not proceed, or
 * null once the user has agreed to it.
 */
async function requireConfirmation(message: string): Promise<ToolResult | null> {
  if (!confirmCallback) {
    return {
      success: false,
      output: '',
      error: 'Destructive operation blocked (no confirmation callback registered)',
    };
  }
  const confirmed = await confirmCallback(message);
  if (!confirmed) {
    return { success: false, output: '', error: 'Operation cancelled by user' };
  }
  return null;
}

/**
 * Checks a call against the tool's declared `required` parameters.
 * Without this a missing argument surfaces as whatever low-level error the
 * implementation happens to throw (e.g. `paths[0] must be of type string`),
 * which tells the model nothing about how to retry.
 */
function findMissingParams(name: string, args: Record<string, unknown>): string[] {
  const def = TOOL_DEFINITIONS.find((d) => d.name === name);
  const required = (def?.parameters as { required?: unknown })?.required;
  if (!Array.isArray(required)) return [];
  return required.filter(
    (key): key is string =>
      typeof key === 'string' && (args[key] === undefined || args[key] === null)
  );
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const missing = findMissingParams(name, args);
  if (missing.length > 0) {
    const def = TOOL_DEFINITIONS.find((d) => d.name === name);
    const known = Object.keys(
      ((def?.parameters as { properties?: Record<string, unknown> })?.properties) ?? {}
    );
    return {
      success: false,
      output: '',
      error:
        `Missing required parameter(s) for ${name}: ${missing.join(', ')}. ` +
        `Accepted parameters: ${known.join(', ')}.`,
    };
  }

  switch (name) {
    case 'read_file':
      return executeReadFile(args.path as string, args.start_line as number | undefined, args.end_line as number | undefined);

    case 'write_file':
      return executeWriteFile(args.path as string, args.content as string);

    case 'replace_in_file':
      return executeReplaceInFile(args.path as string, args.old_text as string, args.new_text as string, args.replace_all as boolean | undefined);

    case 'run_command':
      return executeRunCommand(args.command as string, args.cwd as string | undefined, args.timeout as number | undefined);

    case 'list_directory':
      return executeListDirectory(args.path as string, args.recursive as boolean | undefined);

    case 'create_directory':
      return executeCreateDirectory(args.path as string);

    case 'delete_file':
      return executeDeleteFile(args.path as string);

    case 'copy_file':
      return executeCopyFile(args.source as string, args.destination as string);

    case 'search_files':
      return executeSearchFiles(args.pattern as string, args.directory as string);

    case 'grep_search':
      return executeGrepSearch(args.pattern as string, args.directory as string, args.file_pattern as string | undefined);

    case 'get_file_info':
      return executeGetFileInfo(args.path as string);

    case 'git_command':
      return executeGitCommand(args.command as string, args.cwd as string | undefined);

    case 'npm_command':
      return executeNpmCommand(args.command as string, args.cwd as string | undefined);

    case 'move_file':
      return executeMoveFile(args.source as string, args.destination as string);

    case 'diff_files':
      return executeDiffFiles(args.file_a as string, args.file_b as string);

    case 'apply_patch':
      return executeApplyPatch(args.path as string, args.patch as string);

    case 'browser_navigate':
    case 'browser_screenshot':
    case 'browser_extract':
      return executeBrowserTool(name, args);

    case 'rag_index':
    case 'rag_search':
    case 'rag_summary':
      return executeRagTool(name, args);

    default:
      return { success: false, output: '', error: `Unknown tool: ${name}` };
  }
}

function executeReadFile(filePath: string, startLine?: number, endLine?: number): ToolResult {
  try {
    const resolved = resolve(filePath);
    if (!existsSync(resolved)) {
      return { success: false, output: '', error: `File not found: ${filePath}` };
    }
    let content = readFileSync(resolved, 'utf-8');
    
    if (startLine !== undefined || endLine !== undefined) {
      const lines = content.split('\n');
      const start = (startLine ?? 1) - 1;
      const end = endLine ?? lines.length;
      content = lines.slice(start, end).join('\n');
    }
    
    return { success: true, output: content };
  } catch (err) {
    return { success: false, output: '', error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function executeWriteFile(filePath: string, content: string): ToolResult {
  const outside = guardWritePath(filePath, 'file');
  if (outside) return outside;
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

function executeReplaceInFile(filePath: string, oldText: string, newText: string, replaceAll?: boolean): ToolResult {
  const outside = guardWritePath(filePath, 'file');
  if (outside) return outside;
  try {
    const resolved = resolve(filePath);
    if (!existsSync(resolved)) {
      return { success: false, output: '', error: `File not found: ${filePath}` };
    }
    
    let content = readFileSync(resolved, 'utf-8');
    
    if (!content.includes(oldText)) {
      return { success: false, output: '', error: `Text not found in file: ${oldText.substring(0, 50)}...` };
    }

    const occurrences = content.split(oldText).length - 1;
    if (replaceAll) {
      content = content.split(oldText).join(newText);
    } else {
      content = content.replace(oldText, newText);
    }
    writeFileSync(resolved, content, 'utf-8');
    
    const replaced = replaceAll ? occurrences : Math.min(1, occurrences);
    return { success: true, output: `Replaced ${replaced} occurrence(s) in ${filePath}` };
  } catch (err) {
    return { success: false, output: '', error: `Failed to replace in file: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function executeMoveFile(source: string, destination: string): ToolResult {
  const outsideSource = guardWritePath(source, 'source');
  if (outsideSource) return outsideSource;
  const outsideDest = guardWritePath(destination, 'destination');
  if (outsideDest) return outsideDest;
  try {
    const sourcePath = resolve(source);
    const destPath = resolve(destination);

    if (!existsSync(sourcePath)) {
      return { success: false, output: '', error: `Source not found: ${source}` };
    }

    const destDir = dirname(destPath);
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }

    renameSync(sourcePath, destPath);
    return { success: true, output: `Moved ${source} → ${destination}` };
  } catch (err) {
    return { success: false, output: '', error: `Failed to move file: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function executeDiffFiles(fileA: string, fileB: string): ToolResult {
  try {
    const pathA = resolve(fileA);
    const pathB = resolve(fileB);
    if (!existsSync(pathA)) return { success: false, output: '', error: `File not found: ${fileA}` };
    if (!existsSync(pathB)) return { success: false, output: '', error: `File not found: ${fileB}` };

    const a = readFileSync(pathA, 'utf-8').split('\n');
    const b = readFileSync(pathB, 'utf-8').split('\n');
    const diff: string[] = [];
    diff.push(`--- ${fileA}`);
    diff.push(`+++ ${fileB}`);
    const maxLines = Math.max(a.length, b.length);
    let changed = 0;
    for (let i = 0; i < maxLines; i++) {
      const lineA = a[i];
      const lineB = b[i];
      if (lineA === lineB) continue;
      if (lineA !== undefined) {
        diff.push(`- ${lineA}`);
        changed++;
      }
      if (lineB !== undefined) {
        diff.push(`+ ${lineB}`);
        changed++;
      }
    }
    if (changed === 0) diff.push('(files are identical)');
    return { success: true, output: diff.join('\n') };
  } catch (err) {
    return { success: false, output: '', error: `Failed to diff files: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function executeApplyPatch(filePath: string, patch: string): ToolResult {
  const outside = guardWritePath(filePath, 'file');
  if (outside) return outside;
  try {
    const resolved = resolve(filePath);
    if (!existsSync(resolved)) {
      return { success: false, output: '', error: `File not found: ${filePath}` };
    }

    const original = readFileSync(resolved, 'utf-8');
    const lines = original.split('\n');
    const patchLines = patch.split('\n');
    let index = 0;
    let applied = 0;

    while (index < patchLines.length) {
      const line = patchLines[index];
      const hunkMatch = line.match(/^@@\s*-(\d+)(?:,\d+)?\s*\+(\d+)(?:,\d+)?\s*@@/);
      if (!hunkMatch) { index++; continue; }
      const startLine = Math.max(0, parseInt(hunkMatch[2], 10) - 1);
      index++;
      let cursor = startLine;
      while (index < patchLines.length && !patchLines[index].startsWith('@@')) {
        const pl = patchLines[index];
        if (pl.startsWith('---') || pl.startsWith('+++') || pl.startsWith('diff ')) { index++; continue; }
        if (pl.startsWith(' ')) {
          cursor++;
        } else if (pl.startsWith('-')) {
          if (lines[cursor] === pl.slice(1)) {
            lines.splice(cursor, 1);
            applied++;
          }
        } else if (pl.startsWith('+')) {
          lines.splice(cursor, 0, pl.slice(1));
          cursor++;
          applied++;
        }
        index++;
      }
    }

    if (applied === 0) {
      return { success: false, output: '', error: 'Patch did not apply: no hunks matched' };
    }
    writeFileSync(resolved, lines.join('\n'), 'utf-8');
    return { success: true, output: `Applied patch (${applied} line change(s)) to ${filePath}` };
  } catch (err) {
    return { success: false, output: '', error: `Failed to apply patch: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function executeDeleteFile(filePath: string): Promise<ToolResult> {
  const outside = guardWritePath(filePath, 'file');
  if (outside) return outside;
  try {
    const resolved = resolve(filePath);
    if (!existsSync(resolved)) {
      return { success: false, output: '', error: `File not found: ${filePath}` };
    }

    // Deleting is as irreversible as any destructive shell command, so it goes
    // through the same confirmation gate.
    const denied = await requireConfirmation(
      `WARNING: about to delete a file!\n  ${resolved}\n  Do you want to proceed?`
    );
    if (denied) return denied;

    unlinkSync(resolved);
    return { success: true, output: `Successfully deleted ${filePath}` };
  } catch (err) {
    return { success: false, output: '', error: `Failed to delete file: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function executeCopyFile(source: string, destination: string): ToolResult {
  const outside = guardWritePath(destination, 'destination');
  if (outside) return outside;
  try {
    const sourcePath = resolve(source);
    const destPath = resolve(destination);
    
    if (!existsSync(sourcePath)) {
      return { success: false, output: '', error: `Source file not found: ${source}` };
    }
    
    const destDir = dirname(destPath);
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }
    
    copyFileSync(sourcePath, destPath);
    return { success: true, output: `Successfully copied ${source} to ${destination}` };
  } catch (err) {
    return { success: false, output: '', error: `Failed to copy file: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Confirmation gate shared by run_command, git_command and npm_command. */
async function guardDestructiveCommand(command: string): Promise<ToolResult | null> {
  if (!isDestructiveCommand(command)) return null;
  return requireConfirmation(
    `WARNING: Destructive command detected!\n  ${command}\n  Do you want to proceed?`
  );
}

async function executeRunCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult> {
  const blocked = await guardDestructiveCommand(command);
  if (blocked) return blocked;

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: cwd ? resolve(cwd) : process.cwd(),
      timeout: timeout ?? 60000,
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

function executeListDirectory(dirPath: string, recursive?: boolean): ToolResult {
  try {
    const resolved = resolve(dirPath);
    if (!existsSync(resolved)) {
      return { success: false, output: '', error: `Directory not found: ${dirPath}` };
    }
    
    if (recursive) {
      // Recursive listing
      const entries: string[] = [];
      const walk = (dir: string, prefix = '') => {
        const items = readdirSync(dir);
        for (const item of items) {
          const fullPath = join(dir, item);
          const stat = statSync(fullPath);
          const type = stat.isDirectory() ? 'd' : 'f';
          entries.push(`${prefix}${type} ${item}`);
          if (stat.isDirectory()) {
            walk(fullPath, prefix + '  ');
          }
        }
      };
      walk(resolved);
      return { success: true, output: entries.join('\n') || '(empty directory)' };
    } else {
      // Non-recursive listing
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
    }
  } catch (err) {
    return { success: false, output: '', error: `Failed to list directory: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function executeCreateDirectory(dirPath: string): ToolResult {
  const outside = guardWritePath(dirPath, 'directory');
  if (outside) return outside;
  try {
    const resolved = resolve(dirPath);
    if (existsSync(resolved)) {
      return { success: true, output: `Directory already exists: ${dirPath}` };
    }
    
    mkdirSync(resolved, { recursive: true });
    return { success: true, output: `Successfully created directory: ${dirPath}` };
  } catch (err) {
    return { success: false, output: '', error: `Failed to create directory: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function executeGetFileInfo(filePath: string): ToolResult {
  try {
    const resolved = resolve(filePath);
    if (!existsSync(resolved)) {
      return { success: false, output: '', error: `File not found: ${filePath}` };
    }
    
    const stat = statSync(resolved);
    const info = [
      `Path: ${filePath}`,
      `Type: ${stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other'}`,
      `Size: ${stat.size} bytes`,
      `Created: ${stat.birthtime.toISOString()}`,
      `Modified: ${stat.mtime.toISOString()}`,
      `Permissions: ${stat.mode.toString(8)}`,
    ].join('\n');
    
    return { success: true, output: info };
  } catch (err) {
    return { success: false, output: '', error: `Failed to get file info: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * The tool accepts "glob pattern or regex". A bare filename glob such as
 * `*.ts` is the most natural thing to pass and is not valid regex — feeding it
 * straight to RegExp throws "Nothing to repeat" — so translate globs first and
 * only fall back to regex for anything that is clearly not one.
 */
function patternToRegExp(pattern: string): RegExp {
  const looksLikeGlob = /[*?]/.test(pattern) && !/[()+^$|\\]/.test(pattern);
  if (looksLikeGlob) {
    const source = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${source}$`, 'i');
  }
  try {
    return new RegExp(pattern, 'i');
  } catch {
    // Neither a glob nor valid regex — match it literally rather than throwing.
    return new RegExp(pattern.replace(/[.*+^${}()|[\]\\?]/g, '\\$&'), 'i');
  }
}

function executeSearchFiles(pattern: string, directory: string): ToolResult {
  try {
    const resolved = resolve(directory);
    if (!existsSync(resolved)) {
      return { success: false, output: '', error: `Directory not found: ${directory}` };
    }

    const results: string[] = [];
    const searchPattern = patternToRegExp(pattern);

    const walk = (dir: string) => {
      const items = readdirSync(dir);
      for (const item of items) {
        if (searchPattern.test(item)) {
          results.push(join(dir, item).replace(resolved, '.'));
        }
        const fullPath = join(dir, item);
        // Broken symlinks and races would otherwise abort the whole search.
        let stat;
        try {
          stat = statSync(fullPath);
        } catch {
          continue;
        }
        if (stat.isDirectory() && !item.startsWith('.')) {
          walk(fullPath);
        }
      }
    };
    
    walk(resolved);
    return { success: true, output: results.length > 0 ? results.join('\n') : 'No matches found' };
  } catch (err) {
    return { success: false, output: '', error: `Failed to search files: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function executeGrepSearch(pattern: string, directory: string, filePattern?: string): Promise<ToolResult> {
  try {
    const resolved = resolve(directory);
    if (!existsSync(resolved)) {
      return { success: false, output: '', error: `Directory not found: ${directory}` };
    }

    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch (err: any) {
      return {
        success: false,
        output: '',
        error: `Invalid regex pattern: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv', 'venv', 'vendor', '.cache', 'coverage', 'target', 'bin', 'obj']);
    const includeRE = filePattern ? new RegExp(filePattern.replace(/\./g, '\\.')) : null;
    const matches: string[] = [];

    const walk = (dir: string) => {
      for (const item of readdirSync(dir)) {
        if (SKIP.has(item)) continue;
        const full = join(dir, item);
        let stat;
        try {
          stat = statSync(full);
        } catch {
          continue;
        }
        if (stat.isDirectory()) {
          walk(full);
        } else if (stat.isFile()) {
          if (includeRE && !includeRE.test(item)) continue;
          let content: string;
          try {
            content = readFileSync(full, 'utf-8');
          } catch {
            continue;
          }
          const rel = full.replace(resolved, '.');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              matches.push(`${rel}:${i + 1}:${lines[i]}`);
            }
            regex.lastIndex = 0;
          }
        }
      }
    };

    walk(resolved);
    if (regex.global) regex.lastIndex = 0;
    return {
      success: true,
      output: matches.length > 0 ? matches.slice(0, 500).join('\n') : 'No matches found',
    };
  } catch (err) {
    return { success: false, output: '', error: `Failed to search: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function executeGitCommand(command: string, cwd?: string): Promise<ToolResult> {
  const blocked = await guardDestructiveCommand(`git ${command}`);
  if (blocked) return blocked;
  try {
    const { stdout, stderr } = await execAsync(`git ${command}`, {
      cwd: cwd ? resolve(cwd) : process.cwd(),
    });
    return { success: true, output: stdout + (stderr ? `\n${stderr}` : '') };
  } catch (err) {
    if (err instanceof Error && 'stdout' in err) {
      const execErr = err as any;
      return {
        success: false,
        output: execErr.stdout ?? '',
        error: execErr.stderr ?? err.message,
      };
    }
    return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
  }
}

async function executeNpmCommand(command: string, cwd?: string): Promise<ToolResult> {
  // npm can run arbitrary package scripts, so it gets the same scrutiny.
  const blocked = await guardDestructiveCommand(`npm ${command}`);
  if (blocked) return blocked;
  try {
    const { stdout, stderr } = await execAsync(`npm ${command}`, {
      cwd: cwd ? resolve(cwd) : process.cwd(),
      timeout: 120000,
    });
    return { success: true, output: stdout + (stderr ? `\n${stderr}` : '') };
  } catch (err) {
    if (err instanceof Error && 'stdout' in err) {
      const execErr = err as any;
      return {
        success: false,
        output: execErr.stdout ?? '',
        error: execErr.stderr ?? err.message,
      };
    }
    return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
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
