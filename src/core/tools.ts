import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, unlinkSync, copyFileSync, renameSync } from 'fs';
import { join, resolve, dirname, relative, isAbsolute } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';
import { getWorkspaceRootSetting } from '../config/index.js';
import type { ToolDefinition } from '../providers/types.js';
import { BROWSER_TOOL_DEFINITIONS, executeBrowserTool } from './browser.js';
import { RAG_TOOL_DEFINITIONS, executeRagTool } from './rag.js';
import { isMcpTool, executeMcpTool, getMcpToolDefinitions } from '../mcp/registry.js';
import {
  analyzeCommand,
  containsRedaction,
  denyReadReason,
  findSecrets,
  isDestructiveCommand,
  recordAudit,
  redactSecrets,
  redactionNotice,
  scrubbedEnv,
  shouldSkipDuringWalk,
  summarizeArgs,
  wrapUntrusted,
  REDACTION_MARKER,
} from './security.js';

const execAsync = promisify(exec);

// `isDestructiveCommand` moved into the security core alongside the rest of the
// command analysis; it stays exported here because that is where callers and
// the test suite have always found it.
export { isDestructiveCommand };

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

// ─── Read boundary ──────────────────────────────────────────────────────────
//
// Writes are confined to the workspace; reads never were, on the argument that
// the agent often needs to look outside the tree. That argument holds for
// source files and holds for nothing else: `~/.ssh/id_rsa` and `~/.aws/
// credentials` have exactly one reason to be read by an agent, and it is not a
// good one. The deny-list lives in the security core.

/** Returns a ToolResult to abort with, or null when the read is allowed. */
function guardReadPath(filePath: string): ToolResult | null {
  const reason = denyReadReason(filePath);
  if (!reason) return null;
  return { success: false, output: '', error: reason };
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
function findDefinition(name: string) {
  return (
    TOOL_DEFINITIONS.find(d => d.name === name) ??
    getMcpToolDefinitions().find(d => d.name === name)
  );
}

function findMissingParams(name: string, args: Record<string, unknown>): string[] {
  const def = findDefinition(name);
  const required = (def?.parameters as { required?: unknown })?.required;
  if (!Array.isArray(required)) return [];
  return required.filter(
    (key): key is string =>
      typeof key === 'string' && (args[key] === undefined || args[key] === null)
  );
}

/** Tools whose output came from somewhere outside this machine's trust boundary. */
function isUntrustedSource(name: string): boolean {
  return name.startsWith('browser_') || isMcpTool(name);
}

/**
 * The single choke point every tool call passes through.
 *
 * Putting redaction and auditing here rather than in each implementation is
 * what makes them hold: a tool added later gets both without its author having
 * to remember, and there is one place to look when asking "could this call
 * have leaked something?".
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const result = await dispatchTool(name, args);

  if (!result.success) {
    recordAudit({
      tool: name,
      args: summarizeArgs(args),
      outcome: 'error',
      detail: result.error?.slice(0, 200),
    });
    return { ...result, error: result.error ? redactSecrets(result.error).text : result.error };
  }

  // Nothing credential-shaped reaches the model, the transcript or the session
  // file — regardless of which tool produced it or how it got on disk.
  const { text, findings } = redactSecrets(result.output);
  const body = isUntrustedSource(name) ? wrapUntrusted(name, text) : text;
  const output = body + redactionNotice(findings);

  recordAudit({
    tool: name,
    args: summarizeArgs(args),
    outcome: 'ok',
    detail: findings.length ? `${findings.length} secret(s) redacted` : undefined,
  });

  return { ...result, output };
}

async function dispatchTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const missing = findMissingParams(name, args);
  if (missing.length > 0) {
    const def = findDefinition(name);
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
      // Tools contributed by MCP servers are namespaced and dispatched here,
      // so mode checks, checkpoints and the agent loop treat them like any
      // other tool.
      if (isMcpTool(name)) {
        return executeMcpTool(name, args);
      }
      return { success: false, output: '', error: `Unknown tool: ${name}` };
  }
}

/** A file larger than this is read by range, not swallowed whole. */
export const MAX_READ_BYTES = 10 * 1024 * 1024;

function executeReadFile(filePath: string, startLine?: number, endLine?: number): ToolResult {
  const denied = guardReadPath(filePath);
  if (denied) return denied;
  try {
    const resolved = resolve(filePath);
    if (!existsSync(resolved)) {
      return { success: false, output: '', error: `File not found: ${filePath}` };
    }
    // Reading an arbitrarily large file into a string is how a tool call takes
    // the whole CLI down with it.
    const size = statSync(resolved).size;
    if (size > MAX_READ_BYTES) {
      return {
        success: false,
        output: '',
        error:
          `${filePath} is ${(size / 1024 / 1024).toFixed(1)} MB, over the ${MAX_READ_BYTES / 1024 / 1024} MB read limit. ` +
          `Read a range with start_line/end_line, or use grep_search.`,
      };
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

/**
 * Two things must never be written.
 *
 * A redaction marker means the model is echoing back output this layer
 * already cleaned — writing it lands the placeholder on top of the real value
 * and destroys it. A freshly minted credential in file content is the exact
 * failure the industry keeps reporting: the assistant writes a working key
 * into the repository and it gets committed.
 */
async function guardWriteContent(filePath: string, content: string): Promise<ToolResult | null> {
  if (containsRedaction(content)) {
    return {
      success: false,
      output: '',
      error:
        `Refusing to write ${REDACTION_MARKER}…] to ${filePath}. That marker is a placeholder this ` +
        `session substituted for a real secret — writing it back would overwrite the actual value. ` +
        `Edit the surrounding lines instead, and leave the credential line alone.`,
    };
  }

  const findings = findSecrets(content);
  if (findings.length === 0) return null;

  const kinds = [...new Set(findings.map(f => f.description))].join(', ');
  return requireConfirmation(
    `WARNING: this write puts what looks like a live credential into a file!\n` +
    `  file: ${resolve(filePath)}\n` +
    `  found: ${kinds}\n` +
    `  Hardcoded keys are the single most common way these projects leak.\n` +
    `  Prefer an environment variable. Write it anyway?`
  );
}

async function executeWriteFile(filePath: string, content: string): Promise<ToolResult> {
  const outside = guardWritePath(filePath, 'file');
  if (outside) return outside;
  const unsafeContent = await guardWriteContent(filePath, content);
  if (unsafeContent) return unsafeContent;
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

async function executeReplaceInFile(filePath: string, oldText: string, newText: string, replaceAll?: boolean): Promise<ToolResult> {
  const outside = guardWritePath(filePath, 'file');
  if (outside) return outside;
  const unsafeContent = await guardWriteContent(filePath, newText);
  if (unsafeContent) return unsafeContent;
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
  const deniedA = guardReadPath(fileA);
  if (deniedA) return deniedA;
  const deniedB = guardReadPath(fileB);
  if (deniedB) return deniedB;
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

// ─── Unified diff ───────────────────────────────────────────────────────────
//
// The previous implementation walked the patch and spliced as it went, keyed
// on the hunk header's line number. Two things followed from that. A `-` line
// whose text did not match was skipped — while the `+` lines around it were
// still inserted, so a patch aimed at a file that had moved on by three lines
// produced a corrupted file and reported success. And every hunk after the
// first was applied at the wrong offset, because the header numbers describe
// the original file, not the one being mutated in place.
//
// This version locates each hunk by its content, applies all of them or none,
// and says which hunk failed when it cannot.

interface PatchHunk {
  /** 1-indexed line the hunk claims to start at in the original file. */
  oldStart: number;
  /** Context and removed lines: what must be present to apply. */
  expected: string[];
  /** Context and added lines: what replaces it. */
  replacement: string[];
  added: number;
  removed: number;
}

export function parseUnifiedDiff(patch: string): PatchHunk[] {
  const hunks: PatchHunk[] = [];
  const lines = patch.split('\n');
  let current: PatchHunk | null = null;

  for (const line of lines) {
    const header = line.match(/^@@\s*-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*@@/);
    if (header) {
      if (current) hunks.push(current);
      current = {
        oldStart: parseInt(header[1], 10),
        expected: [],
        replacement: [],
        added: 0,
        removed: 0,
      };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('diff ') || line.startsWith('index ')) {
      continue;
    }
    // "\ No newline at end of file" is a marker, not content.
    if (line.startsWith('\\')) continue;
    // A context line for a blank line is a single space; a genuinely empty
    // line is padding between hunks. Treating padding as context made every
    // multi-hunk patch expect a blank line that was not there.
    if (line.length === 0) continue;

    if (line.startsWith('+')) {
      current.replacement.push(line.slice(1));
      current.added++;
    } else if (line.startsWith('-')) {
      current.expected.push(line.slice(1));
      current.removed++;
    } else {
      // A context line, with or without its leading space.
      const text = line.startsWith(' ') ? line.slice(1) : line;
      current.expected.push(text);
      current.replacement.push(text);
    }
  }

  if (current) hunks.push(current);
  return hunks;
}

/** How far from the stated line a hunk may be found. Beyond this it is not the same hunk. */
const PATCH_SEARCH_WINDOW = 200;

function findHunk(lines: string[], expected: string[], hint: number): number {
  if (expected.length === 0) return Math.min(Math.max(hint, 0), lines.length);

  const matchesAt = (index: number): boolean => {
    if (index < 0 || index + expected.length > lines.length) return false;
    for (let i = 0; i < expected.length; i++) {
      if (lines[index + i] !== expected[i]) return false;
    }
    return true;
  };

  if (matchesAt(hint)) return hint;
  for (let offset = 1; offset <= PATCH_SEARCH_WINDOW; offset++) {
    if (matchesAt(hint - offset)) return hint - offset;
    if (matchesAt(hint + offset)) return hint + offset;
  }
  return -1;
}

export type PatchOutcome =
  | { ok: true; content: string; hunksApplied: number; linesChanged: number }
  | { ok: false; error: string };

/**
 * Applies every hunk or none. Returning the original file unchanged on failure
 * is the point: a half-applied patch is worse than a refused one, because the
 * model cannot tell the difference from the outside.
 */
export function applyUnifiedDiff(original: string, patch: string): PatchOutcome {
  const hunks = parseUnifiedDiff(patch);
  if (hunks.length === 0) {
    return { ok: false, error: 'Patch contains no @@ hunks. Provide a unified diff.' };
  }

  const lines = original.split('\n');
  let offset = 0;
  let linesChanged = 0;

  for (let h = 0; h < hunks.length; h++) {
    const hunk = hunks[h];
    const hint = Math.max(0, hunk.oldStart - 1 + offset);
    const at = findHunk(lines, hunk.expected, hint);

    if (at === -1) {
      const firstExpected = hunk.expected[0] ?? '(empty)';
      return {
        ok: false,
        error:
          `Hunk ${h + 1} of ${hunks.length} does not match the file — nothing was written.\n` +
          `  expected near line ${hunk.oldStart}: ${JSON.stringify(firstExpected.slice(0, 80))}\n` +
          `Re-read the file and build the patch from its current contents.`,
      };
    }

    lines.splice(at, hunk.expected.length, ...hunk.replacement);
    offset += hunk.replacement.length - hunk.expected.length;
    linesChanged += hunk.added + hunk.removed;
  }

  return { ok: true, content: lines.join('\n'), hunksApplied: hunks.length, linesChanged };
}

async function executeApplyPatch(filePath: string, patch: string): Promise<ToolResult> {
  const outside = guardWritePath(filePath, 'file');
  if (outside) return outside;
  const unsafeContent = await guardWriteContent(filePath, patch);
  if (unsafeContent) return unsafeContent;
  try {
    const resolved = resolve(filePath);
    if (!existsSync(resolved)) {
      return { success: false, output: '', error: `File not found: ${filePath}` };
    }

    const original = readFileSync(resolved, 'utf-8');
    const result = applyUnifiedDiff(original, patch);

    if (!result.ok) {
      return { success: false, output: '', error: result.error };
    }

    writeFileSync(resolved, result.content, 'utf-8');
    return {
      success: true,
      output: `Applied ${result.hunksApplied} hunk(s), ${result.linesChanged} line change(s) to ${filePath}`,
    };
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
  // Copying a key file into the workspace and reading the copy would otherwise
  // walk straight around the read guard.
  const denied = guardReadPath(source);
  if (denied) return denied;
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

/**
 * Confirmation gate shared by run_command, git_command and npm_command.
 *
 * The old gate asked one question — "does this look like `rm -rf`?" — which
 * says nothing about the command that quietly POSTs `~/.aws/credentials` to a
 * host the model read off a web page. The security core classifies three ways
 * now: run it, ask about it, or refuse it outright.
 */
async function guardCommand(command: string): Promise<ToolResult | null> {
  const { verdict, reason } = analyzeCommand(command);

  if (verdict === 'allow') return null;

  if (verdict === 'block') {
    recordAudit({ tool: 'run_command', args: summarizeArgs({ command }), outcome: 'blocked', detail: reason });
    return {
      success: false,
      output: '',
      error:
        `Refusing to run this command — ${reason}.\n  ${command}\n` +
        `This class of command is blocked outright rather than confirmed. ` +
        `If it is genuinely what you want, set CUDE_ALLOW_UNSAFE_COMMANDS=1 and run it yourself.`,
    };
  }

  const denied = await requireConfirmation(
    `WARNING: this command needs your approval — ${reason}.\n  ${command}\n  Do you want to proceed?`
  );
  if (denied) {
    recordAudit({ tool: 'run_command', args: summarizeArgs({ command }), outcome: 'denied', detail: reason });
  }
  return denied;
}

/** Confines a command's working directory the same way writes are confined. */
function resolveCommandCwd(cwd?: string): { dir: string } | { error: ToolResult } {
  if (!cwd) return { dir: process.cwd() };
  const resolved = resolve(cwd);
  if (!isInsideWorkspace(resolved)) {
    return {
      error: {
        success: false,
        output: '',
        error:
          `Refusing to run a command outside the workspace root.\n` +
          `  cwd: ${resolved}\n  workspace root: ${getWorkspaceRoot()}`,
      },
    };
  }
  return { dir: resolved };
}

/** Caps a runaway command's output instead of buffering it until the process dies. */
const MAX_COMMAND_OUTPUT_BYTES = 10 * 1024 * 1024;

async function executeRunCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult> {
  const blocked = await guardCommand(command);
  if (blocked) return blocked;

  const target = resolveCommandCwd(cwd);
  if ('error' in target) return target.error;

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: target.dir,
      timeout: timeout ?? 60000,
      maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
      // A child process has no business inheriting the API keys this one holds:
      // one malicious postinstall script is all it takes.
      env: scrubbedEnv(),
      windowsHide: true,
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
  const denied = guardReadPath(filePath);
  if (denied) return denied;
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
          // A grep is a read. Without this, `grep_search . "="` walks straight
          // through every .env and .pem in the tree.
          if (shouldSkipDuringWalk(full)) continue;
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
  const blocked = await guardCommand(`git ${command}`);
  if (blocked) return blocked;
  const target = resolveCommandCwd(cwd);
  if ('error' in target) return target.error;
  try {
    const { stdout, stderr } = await execAsync(`git ${command}`, {
      cwd: target.dir,
      timeout: 120000,
      maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
      env: scrubbedEnv(),
      windowsHide: true,
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
  const blocked = await guardCommand(`npm ${command}`);
  if (blocked) return blocked;
  const target = resolveCommandCwd(cwd);
  if ('error' in target) return target.error;
  try {
    const { stdout, stderr } = await execAsync(`npm ${command}`, {
      cwd: target.dir,
      timeout: 120000,
      maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
      // Lifecycle scripts run as this user with this environment. Without the
      // scrub, `npm install` hands every configured API key to every package.
      env: scrubbedEnv(),
      windowsHide: true,
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
