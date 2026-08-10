import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, unlinkSync, renameSync, rmdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { homedir, tmpdir } from 'os';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';
import type { ToolDefinition } from '../providers/types.js';
import { getApiKey } from '../config/index.js';

const BROWSER_INSTALL_DIR = join(homedir(), '.cude', 'browser');
const BROWSER_DATA_DIR    = join(homedir(), '.cude', 'browsers');

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// ─── HTML stripper ───────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
             .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

// ─── Smart truncation (keeps head + tail, skips middle) ──────────────────────

export function smartTruncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const half = Math.floor(maxLen / 2);
  const skipped = text.length - maxLen;
  return (
    text.slice(0, half) +
    `\n\n[... ${skipped} characters omitted ...]\n\n` +
    text.slice(text.length - half)
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

type ConfirmCallback = (message: string) => Promise<boolean>;
let confirmCallback: ConfirmCallback | null = null;
export function setConfirmCallback(fn: ConfirmCallback): void { confirmCallback = fn; }

// ─── Tool definitions ────────────────────────────────────────────────────────

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file. For large files, specify start_line/end_line.',
    parameters: {
      properties: {
        path:       { type: 'string', description: 'Path to the file' },
        start_line: { type: 'number', description: 'First line to read (1-based, optional)' },
        end_line:   { type: 'number', description: 'Last line to read (optional)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'edit_file',
    description: 'Surgically edit a file by replacing a specific block of text. Safer than write_file — only changes what you specify. PREFERRED for modifying existing files.',
    parameters: {
      properties: {
        path:     { type: 'string', description: 'Path to the file' },
        old_text: { type: 'string', description: 'The exact text to find (must exist in the file)' },
        new_text: { type: 'string', description: 'The text to replace it with' },
      },
      required: ['path', 'old_text', 'new_text'],
    },
  },
  {
    name: 'write_file',
    description: 'Write (or overwrite) a file. Use only for NEW files or full rewrites. For existing files, prefer edit_file.',
    parameters: {
      properties: {
        path:    { type: 'string', description: 'Path to write' },
        content: { type: 'string', description: 'Full content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'run_command',
    description: 'Execute a shell command. 60-second timeout. Destructive commands require confirmation.',
    parameters: {
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        cwd:     { type: 'string', description: 'Working directory (optional)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'list_directory',
    description: 'List contents of a directory with file sizes and types.',
    parameters: {
      properties: {
        path:      { type: 'string', description: 'Directory path' },
        recursive: { type: 'boolean', description: 'List recursively (default false)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'create_directory',
    description: 'Create a directory (and all parent directories).',
    parameters: {
      properties: {
        path: { type: 'string', description: 'Directory path to create' },
      },
      required: ['path'],
    },
  },
  {
    name: 'git_status',
    description: 'Show current git repository status (staged, modified, untracked files).',
    parameters: { properties: {}, required: [] },
  },
  {
    name: 'git_diff',
    description: 'Show git diff to review changes before committing.',
    parameters: {
      properties: {
        path:   { type: 'string', description: 'Specific file path (optional, omit for all changes)' },
        staged: { type: 'boolean', description: 'Show staged (--cached) diff instead of working tree' },
      },
      required: [],
    },
  },
  {
    name: 'git_commit',
    description: 'Stage all changes and create a git commit.',
    parameters: {
      properties: {
        message: { type: 'string', description: 'Commit message' },
        files:   { type: 'string', description: 'Specific files to stage (space-separated, default: all changed files)' },
      },
      required: ['message'],
    },
  },
  {
    name: 'git_log',
    description: 'Show recent git commit history.',
    parameters: {
      properties: {
        count: { type: 'number', description: 'Number of commits to show (default: 10)' },
        path:  { type: 'string', description: 'Filter by file path (optional)' },
      },
      required: [],
    },
  },
  {
    name: 'fetch_webpage',
    description: 'Fetch a URL and return its clean text content (HTML stripped). Up to 12000 chars.',
    parameters: {
      properties: {
        url: { type: 'string', description: 'URL to fetch (http/https)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'run_code',
    description: 'Execute a code snippet. Languages: javascript, python, bash. 15-second timeout.',
    parameters: {
      properties: {
        language: { type: 'string', enum: ['javascript', 'python', 'bash'], description: 'Language' },
        code:     { type: 'string', description: 'Code to execute' },
      },
      required: ['language', 'code'],
    },
  },
  {
    name: 'search_memory',
    description: 'Search stored memory (MEMORY.md and USER.md) for relevant information.',
    parameters: {
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'web_search',
    description: 'Search the internet for current information. Uses Brave Search API if BRAVE_API_KEY env var is set; falls back to Jina.ai (no key needed).',
    parameters: {
      properties: {
        query:       { type: 'string', description: 'Search query' },
        max_results: { type: 'number', description: 'Maximum number of results to return (default: 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'browser_navigate',
    description: 'Open a browser and navigate to a URL. Requires playwright (install with: npm install playwright && npx playwright install chromium). Use CUDE_HEADLESS=1 env var for headless mode.',
    parameters: {
      properties: {
        url:      { type: 'string', description: 'URL to navigate to' },
        wait_for: { type: 'string', enum: ['load', 'networkidle', 'domcontentloaded'], description: 'When to consider navigation complete (default: load)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_click',
    description: 'Click an element in the currently open browser page.',
    parameters: {
      properties: {
        selector: { type: 'string', description: 'CSS selector to click' },
        text:     { type: 'string', description: 'Visible text of element to click (alternative to selector)' },
      },
      required: [],
    },
  },
  {
    name: 'browser_type',
    description: 'Type text into a browser input field.',
    parameters: {
      properties: {
        selector:    { type: 'string', description: 'CSS selector of the input field' },
        text:        { type: 'string', description: 'Text to type' },
        clear_first: { type: 'boolean', description: 'Clear existing content before typing (default: false)' },
      },
      required: ['selector', 'text'],
    },
  },
  {
    name: 'browser_get_content',
    description: 'Get the visible text content of the current browser page (or a specific element).',
    parameters: {
      properties: {
        selector: { type: 'string', description: 'CSS selector to extract (optional — omit for full page)' },
      },
      required: [],
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Take a screenshot of the current browser page and save it to a file.',
    parameters: {
      properties: {
        path:      { type: 'string', description: 'File path to save screenshot (default: /tmp/cude-screenshot.png)' },
        full_page: { type: 'boolean', description: 'Capture full scrollable page (default: false)' },
      },
      required: [],
    },
  },
  {
    name: 'browser_close',
    description: 'Close the browser instance opened by browser_navigate.',
    parameters: { properties: {}, required: [] },
  },
  {
    name: 'test_project',
    description: 'Auto-detect and run the project\'s test suite (jest, vitest, pytest, mocha, cargo test, go test, etc.). Returns pass/fail counts and failing test names so the agent can retry fixes.',
    parameters: {
      properties: {
        path:    { type: 'string', description: 'Project root directory (default: current directory)' },
        filter:  { type: 'string', description: 'Run only tests matching this pattern (optional)' },
        timeout: { type: 'number', description: 'Timeout in seconds (default: 120)' },
      },
      required: [],
    },
  },
  {
    name: 'grep_search',
    description: 'Search file contents using a regex pattern. Returns matching lines with file paths and line numbers.',
    parameters: {
      properties: {
        pattern:     { type: 'string', description: 'Regex pattern to search for' },
        path:        { type: 'string', description: 'Directory or file to search in (default: current directory)' },
        include:     { type: 'string', description: 'Glob filter for file names (e.g. \'*.ts\', \'*.py\')' },
        max_results: { type: 'number', description: 'Maximum number of matching lines to return (default: 50)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'find_files',
    description: 'Find files or directories by glob pattern. Excludes node_modules and .git by default.',
    parameters: {
      properties: {
        pattern: { type: 'string', description: 'Glob pattern for file/directory names (e.g. \'*.ts\', \'Dockerfile\')' },
        path:    { type: 'string', description: 'Directory to search in (default: current directory)' },
        type:    { type: 'string', description: 'Filter by type: \'file\' or \'dir\'' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file or empty directory. Requires confirmation for safety.',
    parameters: {
      properties: {
        path: { type: 'string', description: 'Path to the file or empty directory to delete' },
      },
      required: ['path'],
    },
  },
  {
    name: 'move_file',
    description: 'Move or rename a file or directory.',
    parameters: {
      properties: {
        source:      { type: 'string', description: 'Current path of the file or directory' },
        destination: { type: 'string', description: 'New path for the file or directory' },
      },
      required: ['source', 'destination'],
    },
  },
  {
    name: 'replace_in_files',
    description: 'Search and replace text across multiple files. Supports glob filtering and dry-run mode.',
    parameters: {
      properties: {
        pattern:     { type: 'string', description: 'Text or regex pattern to search for' },
        replacement: { type: 'string', description: 'Replacement text' },
        path:        { type: 'string', description: 'Directory to search in (default: current directory)' },
        include:     { type: 'string', description: 'Glob filter for file names (e.g. \'*.ts\')' },
        dry_run:     { type: 'boolean', description: 'If true, show what would change without modifying files' },
      },
      required: ['pattern', 'replacement'],
    },
  },
  {
    name: 'git_branch',
    description: 'Manage git branches: list, create, delete, or switch branches.',
    parameters: {
      properties: {
        action: { type: 'string', description: 'Action to perform: \'list\', \'create\', \'delete\', or \'switch\'' },
        name:   { type: 'string', description: 'Branch name (required for create, delete, switch)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'git_stash',
    description: 'Manage git stash: save, pop, list, or drop stashed changes.',
    parameters: {
      properties: {
        action:  { type: 'string', description: 'Action to perform: \'save\', \'pop\', \'list\', or \'drop\'' },
        message: { type: 'string', description: 'Stash message (used with \'save\' action)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'git_checkout',
    description: 'Switch branches or restore files. Can create a new branch with the create flag.',
    parameters: {
      properties: {
        target: { type: 'string', description: 'Branch name or file path to checkout' },
        create: { type: 'boolean', description: 'Create a new branch (uses git checkout -b)' },
      },
      required: ['target'],
    },
  },
  {
    name: 'run_lint',
    description: 'Auto-detect and run the project\'s linter (ESLint, Prettier, Ruff, Pylint, Clippy, golint, etc.).',
    parameters: {
      properties: {
        path: { type: 'string', description: 'Project root directory (default: current directory)' },
        fix:  { type: 'boolean', description: 'Auto-fix issues if supported by the linter' },
      },
      required: [],
    },
  },
  {
    name: 'analyze_project',
    description: 'Analyze project structure: detect frameworks, count files by type, find entry points, list dependencies.',
    parameters: {
      properties: {
        path: { type: 'string', description: 'Project root directory (default: current directory)' },
      },
      required: [],
    },
  },
  {
    name: 'diff_files',
    description: 'Compare two files and show a unified diff of their differences.',
    parameters: {
      properties: {
        file1: { type: 'string', description: 'Path to the first file' },
        file2: { type: 'string', description: 'Path to the second file' },
      },
      required: ['file1', 'file2'],
    },
  },
  {
    name: 'patch_file',
    description: 'Apply a unified diff patch to a file.',
    parameters: {
      properties: {
        path:  { type: 'string', description: 'Path to the file to patch' },
        patch: { type: 'string', description: 'The unified diff content to apply' },
      },
      required: ['path', 'patch'],
    },
  },
  {
    name: 'git_blame',
    description: 'Show git blame for a file, optionally restricted to a line range.',
    parameters: {
      properties: {
        path:       { type: 'string', description: 'Path to the file' },
        start_line: { type: 'number', description: 'Start line number (optional)' },
        end_line:   { type: 'number', description: 'End line number (optional)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'git_merge',
    description: 'Merge a branch into the current branch.',
    parameters: {
      properties: {
        branch: { type: 'string', description: 'Branch name to merge' },
        no_ff:  { type: 'boolean', description: 'Use --no-ff to always create a merge commit' },
      },
      required: ['branch'],
    },
  },
  {
    name: 'git_cherry_pick',
    description: 'Cherry-pick a specific commit onto the current branch.',
    parameters: {
      properties: {
        commit: { type: 'string', description: 'Commit hash to cherry-pick' },
      },
      required: ['commit'],
    },
  },
];

// ─── Destructive command guard ───────────────────────────────────────────────

const DESTRUCTIVE_PATTERNS = [
  /rm\s+-rf/i, /rm\s+--force/i, /sudo\s+rm/i,
  /format\s+/i, /mkfs\./i, /dd\s+if=/i, />\s*\/dev\//i,
  /shutdown/i, /reboot/i, /git\s+reset\s+--hard/i,
  /git\s+clean\s+-f/i, /git\s+push\s+--force/i,
  /drop\s+table/i, /truncate\s+table/i,
];

function isDestructiveCommand(cmd: string): boolean {
  return DESTRUCTIVE_PATTERNS.some(p => p.test(cmd));
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  switch (name) {
    case 'read_file':
      return executeReadFile(args.path as string, args.start_line as number | undefined, args.end_line as number | undefined);
    case 'edit_file':
      return executeEditFile(args.path as string, args.old_text as string, args.new_text as string);
    case 'write_file':
      return executeWriteFile(args.path as string, args.content as string);
    case 'run_command':
      return executeRunCommand(args.command as string, args.cwd as string | undefined);
    case 'list_directory':
      return executeListDirectory(args.path as string, args.recursive as boolean | undefined);
    case 'create_directory':
      return executeCreateDirectory(args.path as string);
    case 'git_status':
      return executeGitStatus();
    case 'git_diff':
      return executeGitDiff(args.path as string | undefined, args.staged as boolean | undefined);
    case 'git_commit':
      return executeGitCommit(args.message as string, args.files as string | undefined);
    case 'git_log':
      return executeGitLog(args.count as number | undefined, args.path as string | undefined);
    case 'fetch_webpage':
      return executeFetchWebpage(args.url as string);
    case 'run_code':
      return executeRunCode(args.language as string, args.code as string);
    case 'search_memory':
      return executeSearchMemory(args.query as string);
    case 'web_search':
      return executeWebSearch(args.query as string, args.max_results as number | undefined);
    case 'browser_navigate':
      return executeBrowserNavigate(args.url as string, args.wait_for as string | undefined);
    case 'browser_click':
      return executeBrowserClick(args.selector as string | undefined, args.text as string | undefined);
    case 'browser_type':
      return executeBrowserType(args.selector as string, args.text as string, args.clear_first as boolean | undefined);
    case 'browser_get_content':
      return executeBrowserGetContent(args.selector as string | undefined);
    case 'browser_screenshot':
      return executeBrowserScreenshot(args.path as string | undefined, args.full_page as boolean | undefined);
    case 'browser_close':
      return executeBrowserClose();
    case 'test_project':
      return executeTestProject(args.path as string | undefined, args.filter as string | undefined, args.timeout as number | undefined);
    case 'grep_search':
      return executeGrepSearch(args.pattern as string, args.path as string | undefined, args.include as string | undefined, args.max_results as number | undefined);
    case 'find_files':
      return executeFindFiles(args.pattern as string, args.path as string | undefined, args.type as string | undefined);
    case 'delete_file':
      return executeDeleteFile(args.path as string);
    case 'move_file':
      return executeMoveFile(args.source as string, args.destination as string);
    case 'replace_in_files':
      return executeReplaceInFiles(args.pattern as string, args.replacement as string, args.path as string | undefined, args.include as string | undefined, args.dry_run as boolean | undefined);
    case 'git_branch':
      return executeGitBranch(args.action as string, args.name as string | undefined);
    case 'git_stash':
      return executeGitStash(args.action as string, args.message as string | undefined);
    case 'git_checkout':
      return executeGitCheckout(args.target as string, args.create as boolean | undefined);
    case 'run_lint':
      return executeRunLint(args.path as string | undefined, args.fix as boolean | undefined);
    case 'analyze_project':
      return executeAnalyzeProject(args.path as string | undefined);
    case 'diff_files':
      return executeDiffFiles(args.file1 as string, args.file2 as string);
    case 'patch_file':
      return executePatchFile(args.path as string, args.patch as string);
    case 'git_blame':
      return executeGitBlame(args.path as string, args.start_line as number | undefined, args.end_line as number | undefined);
    case 'git_merge':
      return executeGitMerge(args.branch as string, args.no_ff as boolean | undefined);
    case 'git_cherry_pick':
      return executeGitCherryPick(args.commit as string);
    default:
      return { success: false, output: '', error: `Unknown tool: ${name}` };
  }
}

// ─── Implementations ─────────────────────────────────────────────────────────

function executeReadFile(filePath: string, startLine?: number, endLine?: number): ToolResult {
  try {
    const resolved = resolve(filePath);
    if (!existsSync(resolved)) {
      return { success: false, output: '', error: `File not found: ${filePath}` };
    }
    let content = readFileSync(resolved, 'utf-8');
    const totalLines = content.split('\n').length;

    if (startLine !== undefined || endLine !== undefined) {
      const lines = content.split('\n');
      const from = (startLine ?? 1) - 1;
      const to   = endLine ?? lines.length;
      content = lines.slice(from, to).join('\n');
      return {
        success: true,
        output: `[Lines ${from + 1}-${Math.min(to, totalLines)} of ${totalLines} in ${filePath}]\n${content}`,
      };
    }

    // Large file — smart truncation
    const MAX = 12000;
    if (content.length > MAX) {
      return {
        success: true,
        output: smartTruncate(content, MAX) + `\n\n[Total: ${totalLines} lines, ${content.length} chars. Use start_line/end_line for specific sections.]`,
      };
    }
    return { success: true, output: content };
  } catch (err) {
    return { success: false, output: '', error: `Read failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function executeEditFile(filePath: string, oldText: string, newText: string): ToolResult {
  try {
    const resolved = resolve(filePath);
    if (!existsSync(resolved)) {
      return { success: false, output: '', error: `File not found: ${filePath}` };
    }
    const content = readFileSync(resolved, 'utf-8');
    if (!content.includes(oldText)) {
      // Try to give a helpful error with context
      return {
        success: false,
        output: '',
        error: `Text not found in ${filePath}. The old_text must match exactly (including whitespace/indentation). Read the file first to get the exact text.`,
      };
    }
    const occurrences = content.split(oldText).length - 1;
    if (occurrences > 1) {
      return {
        success: false,
        output: '',
        error: `Found ${occurrences} occurrences of old_text in ${filePath}. Provide more context to make the match unique.`,
      };
    }
    const updated = content.replace(oldText, newText);
    writeFileSync(resolved, updated, 'utf-8');

    const addedLines   = newText.split('\n').length - oldText.split('\n').length;
    const sign = addedLines >= 0 ? '+' : '';
    return {
      success: true,
      output: `Edited ${filePath} (${sign}${addedLines} lines). Change applied successfully.`,
    };
  } catch (err) {
    return { success: false, output: '', error: `Edit failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function executeWriteFile(filePath: string, content: string): ToolResult {
  try {
    const resolved = resolve(filePath);
    const dir = dirname(resolved);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const existed = existsSync(resolved);
    writeFileSync(resolved, content, 'utf-8');
    const lines = content.split('\n').length;
    return {
      success: true,
      output: `${existed ? 'Overwrote' : 'Created'} ${filePath} (${lines} lines, ${content.length} chars)`,
    };
  } catch (err) {
    return { success: false, output: '', error: `Write failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function executeRunCommand(command: string, cwd?: string): Promise<ToolResult> {
  if (isDestructiveCommand(command)) {
    if (!confirmCallback) {
      return { success: false, output: '', error: 'Destructive command blocked (no confirm callback)' };
    }
    const ok = await confirmCallback(`⚠ Destructive command detected:\n  ${command}\n  Proceed?`);
    if (!ok) return { success: false, output: '', error: 'Command cancelled by user' };
  }
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: cwd ? resolve(cwd) : process.cwd(),
      timeout: 60000,
    });
    const out = stdout + (stderr ? `\nSTDERR: ${stderr}` : '');
    return { success: true, output: out || '(no output)' };
  } catch (err) {
    if (err instanceof Error && 'stdout' in err && 'stderr' in err) {
      const e = err as NodeJS.ErrnoException & { stdout: string; stderr: string; code?: number };
      return { success: false, output: e.stdout ?? '', error: e.stderr ?? err.message };
    }
    return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
  }
}

function executeListDirectory(dirPath: string, recursive = false): ToolResult {
  try {
    const resolved = resolve(dirPath);
    if (!existsSync(resolved)) {
      return { success: false, output: '', error: `Directory not found: ${dirPath}` };
    }

    const lines: string[] = [];

    function walk(dir: string, prefix: string, depth: number): void {
      if (depth > 4) { lines.push(`${prefix}[depth limit reached]`); return; }
      const entries = readdirSync(dir).filter(e => e !== 'node_modules' && e !== '.git');
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            lines.push(`${prefix}📁 ${entry}/`);
            if (recursive) walk(fullPath, prefix + '  ', depth + 1);
          } else {
            const kb = (stat.size / 1024).toFixed(1);
            lines.push(`${prefix}📄 ${entry} (${kb}KB)`);
          }
        } catch { lines.push(`${prefix}? ${entry}`); }
      }
    }

    walk(resolved, '', 0);
    return { success: true, output: lines.join('\n') || '(empty directory)' };
  } catch (err) {
    return { success: false, output: '', error: `List failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function executeCreateDirectory(dirPath: string): ToolResult {
  try {
    mkdirSync(resolve(dirPath), { recursive: true });
    return { success: true, output: `Created directory: ${dirPath}` };
  } catch (err) {
    return { success: false, output: '', error: `Create dir failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── Git tools ───────────────────────────────────────────────────────────────

async function executeGitStatus(): Promise<ToolResult> {
  try {
    const { stdout } = await execAsync('git status --short && echo "---" && git branch --show-current', {
      cwd: process.cwd(), timeout: 10000,
    });
    return { success: true, output: stdout.trim() || 'Working tree clean' };
  } catch {
    return { success: false, output: '', error: 'Not a git repository or git not found' };
  }
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

async function executeGitDiff(filePath?: string, staged = false): Promise<ToolResult> {
  try {
    const args = staged ? '--cached' : '';
    const target = filePath ? `-- ${shellQuote(filePath)}` : '';
    const { stdout } = await execAsync(`git diff ${args} ${target}`, {
      cwd: process.cwd(), timeout: 15000,
    });
    const diff = stdout.trim();
    if (!diff) return { success: true, output: staged ? 'No staged changes' : 'No unstaged changes' };
    return { success: true, output: smartTruncate(diff, 8000) };
  } catch (err) {
    return { success: false, output: '', error: `git diff failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function executeGitCommit(message: string, files?: string): Promise<ToolResult> {
  try {
    const addCmd = files ? `git add ${files}` : 'git add -A';
    await execAsync(addCmd, { cwd: process.cwd(), timeout: 10000 });
    const { stdout } = await execAsync(`git commit -m ${JSON.stringify(message)}`, {
      cwd: process.cwd(), timeout: 15000,
    });
    return { success: true, output: stdout.trim() };
  } catch (err) {
    if (err instanceof Error && 'stderr' in err) {
      const e = err as NodeJS.ErrnoException & { stderr: string; stdout: string };
      const msg = e.stderr ?? e.stdout ?? err.message;
      if (msg.includes('nothing to commit')) {
        return { success: true, output: 'Nothing to commit — working tree clean' };
      }
      return { success: false, output: '', error: msg };
    }
    return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
  }
}

async function executeGitLog(count = 10, filePath?: string): Promise<ToolResult> {
  try {
    const target = filePath ? `-- ${shellQuote(filePath)}` : '';
    const { stdout } = await execAsync(
      `git log --oneline --decorate -n ${count} ${target}`,
      { cwd: process.cwd(), timeout: 10000 }
    );
    return { success: true, output: stdout.trim() || 'No commits yet' };
  } catch (err) {
    return { success: false, output: '', error: `git log failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── Web + code tools ─────────────────────────────────────────────────────────

async function executeFetchWebpage(url: string): Promise<ToolResult> {
  try {
    let parsedUrl: URL;
    try { parsedUrl = new URL(url); } catch {
      return { success: false, output: '', error: `Invalid URL: ${url}` };
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return { success: false, output: '', error: 'Only http/https URLs are supported' };
    }
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Codiente-CLI/1.0)', 'Accept': 'text/html,text/plain' },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      return { success: false, output: '', error: `HTTP ${response.status}: ${response.statusText}` };
    }
    const html = await response.text();
    const text = stripHtml(html);
    return { success: true, output: smartTruncate(text, 12000) };
  } catch (err) {
    return { success: false, output: '', error: `Fetch failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function executeRunCode(language: string, code: string): Promise<ToolResult> {
  // Use execFile (argv array, no shell) to avoid injection via code content
  const interpreters: Record<string, [string, string[]]> = {
    javascript: ['node',    ['-e', code]],
    python:     ['python3', ['-c', code]],
    bash:       ['bash',    ['-c', code]],
  };
  const entry = interpreters[language];
  if (!entry) {
    return { success: false, output: '', error: `Unsupported language: ${language}` };
  }
  const [bin, args] = entry;
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, { timeout: 15000, cwd: process.cwd() });
    const out = [stdout ? `STDOUT:\n${stdout}` : '', stderr ? `STDERR:\n${stderr}` : ''].filter(Boolean).join('\n');
    return { success: true, output: out || '(no output)' };
  } catch (err) {
    if (err instanceof Error && 'stdout' in err && 'stderr' in err) {
      const e = err as NodeJS.ErrnoException & { stdout: string; stderr: string };
      return { success: false, output: e.stdout ?? '', error: e.stderr ?? err.message };
    }
    return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
  }
}

async function executeSearchMemory(query: string): Promise<ToolResult> {
  try {
    const { searchMemory } = await import('../storage/memory.js');
    return { success: true, output: searchMemory(query) };
  } catch (err) {
    return { success: false, output: '', error: `Memory search failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── Web search ──────────────────────────────────────────────────────────────

async function executeWebSearch(query: string, maxResults = 5): Promise<ToolResult> {
  // Check env var and stored config key (set via: cude config set-key brave <key>)
  const braveKey = process.env['BRAVE_API_KEY'] || getApiKey('brave');
  if (braveKey) {
    try {
      const result = await executeBraveSearch(query, maxResults, braveKey);
      if (result.success) return result;
    } catch { /* fallthrough to Jina */ }
  }
  return executeJinaSearch(query, maxResults);
}

async function executeBraveSearch(query: string, maxResults: number, apiKey: string): Promise<ToolResult> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
  const response = await fetch(url, {
    headers: { 'Accept': 'application/json', 'X-Subscription-Token': apiKey },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Brave API HTTP ${response.status}`);
  const data = await response.json() as {
    web?: { results?: Array<{ title: string; url: string; description?: string }> };
  };
  const results = (data.web?.results ?? []).slice(0, maxResults);
  if (results.length === 0) return { success: true, output: 'No results found' };
  const formatted = results
    .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description ?? ''}`)
    .join('\n\n');
  return { success: true, output: `Search results for "${query}":\n\n${formatted}` };
}

async function executeJinaSearch(query: string, _maxResults: number): Promise<ToolResult> {
  try {
    const url = `https://s.jina.ai/${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'text/plain',
        'X-Return-Format': 'text',
        'User-Agent': 'Mozilla/5.0 (compatible; Codiente-CLI/1.0)',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      return {
        success: false, output: '',
        error: `Search failed (HTTP ${response.status}). Set BRAVE_API_KEY env var for reliable search.`,
      };
    }
    const text = await response.text();
    return { success: true, output: `Search results for "${query}":\n\n${smartTruncate(text, 6000)}` };
  } catch (err) {
    return {
      success: false, output: '',
      error: `Web search failed: ${err instanceof Error ? err.message : String(err)}. Set BRAVE_API_KEY for reliable search.`,
    };
  }
}

// ─── Browser automation (Playwright) ─────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _browser: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _page: any = null;
let _exitRegistered = false;

export async function closeBrowser(): Promise<void> {
  if (_browser) {
    try { await _browser.close(); } catch { /* ignore */ }
    _browser = null;
    _page = null;
  }
}

// Public API so the setup wizard can trigger a pre-install.
export async function setupBrowserAutomation(): Promise<void> {
  await autoInstallPlaywright();
}

async function autoInstallPlaywright(): Promise<unknown> {
  mkdirSync(BROWSER_INSTALL_DIR, { recursive: true });
  mkdirSync(BROWSER_DATA_DIR,    { recursive: true });

  process.stdout.write('\n');
  process.stdout.write(chalk.bold.hex('#7c3aed')('  ◈ Browser Automation Setup\n'));
  process.stdout.write(chalk.dim('  ' + '─'.repeat(45) + '\n'));
  process.stdout.write(chalk.dim('  Playwright + Chromium required for browser tools.\n'));
  process.stdout.write(chalk.dim(`  Installing to: ${BROWSER_INSTALL_DIR}\n`));
  process.stdout.write(chalk.dim('  Download ~150–200 MB. Ctrl+C to cancel.\n\n'));

  // ── Step 1: npm install playwright ──────────────────────────────────────────
  process.stdout.write(chalk.dim('  [1/2] Installing Playwright package... '));
  try {
    await execAsync(
      `npm install playwright --prefix ${shellQuote(BROWSER_INSTALL_DIR)} --no-save --loglevel error`,
      { timeout: 120_000 }
    );
    process.stdout.write(chalk.green('✓\n'));
  } catch (err) {
    process.stdout.write(chalk.red('✗\n\n'));
    throw new Error(
      `Playwright package install failed:\n  ${err instanceof Error ? err.message : String(err)}\n\n` +
      'Install manually:\n  npm install playwright\n  npx playwright install chromium'
    );
  }

  // ── Step 2: download Chromium ───────────────────────────────────────────────
  process.stdout.write(chalk.dim('  [2/2] Downloading Chromium browser...  '));
  const playwrightBin = join(BROWSER_INSTALL_DIR, 'node_modules', '.bin', 'playwright');
  try {
    await execAsync(`"${playwrightBin}" install chromium`, {
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSER_DATA_DIR },
      timeout: 600_000, // 10 min for large download
    });
    process.stdout.write(chalk.green('✓\n\n'));
  } catch (err) {
    process.stdout.write(chalk.red('✗\n\n'));
    throw new Error(
      `Chromium download failed:\n  ${err instanceof Error ? err.message : String(err)}\n\n` +
      'Try manually:\n  PLAYWRIGHT_BROWSERS_PATH=~/.cude/browsers npx playwright install chromium'
    );
  }

  process.stdout.write(chalk.green('  ✓ Browser automation ready!\n\n'));

  // Point playwright at the local browsers dir for this process
  process.env['PLAYWRIGHT_BROWSERS_PATH'] = BROWSER_DATA_DIR;

  const localPath = join(BROWSER_INSTALL_DIR, 'node_modules', 'playwright');
  return (new Function('m', 'return import(m)'))(localPath);
}

async function loadPlaywright(): Promise<unknown> {
  // 1. Try standard import (globally installed or in project node_modules)
  try {
    return await (new Function('m', 'return import(m)'))('playwright');
  } catch { /* not in PATH */ }

  // 2. Try local install in ~/.cude/browser/
  const localPath = join(BROWSER_INSTALL_DIR, 'node_modules', 'playwright');
  if (existsSync(localPath)) {
    try {
      process.env['PLAYWRIGHT_BROWSERS_PATH'] = BROWSER_DATA_DIR;
      return await (new Function('m', 'return import(m)'))(localPath);
    } catch { /* corrupt install — fall through */ }
  }

  // 3. Auto-install (user is informed inline)
  return autoInstallPlaywright();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureBrowser(): Promise<{ page: any }> {
  if (_page) return { page: _page };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playwright: any = await loadPlaywright();

  // Headless when no display or explicitly requested
  const headless = process.env['CUDE_HEADLESS'] === '1' ||
    (process.platform === 'linux' && !process.env['DISPLAY'] && !process.env['WAYLAND_DISPLAY']);

  _browser = await playwright.chromium.launch({
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await _browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });
  _page = await context.newPage();

  if (!_exitRegistered) {
    process.on('exit', () => { if (_browser) _browser.close().catch(() => {}); });
    _exitRegistered = true;
  }

  return { page: _page };
}

async function executeBrowserNavigate(url: string, waitFor = 'load'): Promise<ToolResult> {
  try {
    let parsedUrl: URL;
    try { parsedUrl = new URL(url); } catch {
      return { success: false, output: '', error: `Invalid URL: ${url}` };
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return { success: false, output: '', error: 'Only http/https URLs are supported' };
    }
    const { page } = await ensureBrowser();
    await page.goto(url, { waitUntil: waitFor, timeout: 30000 });
    const title: string = await page.title();
    const currentUrl: string = page.url();
    return { success: true, output: `Navigated to: ${currentUrl}\nPage title: ${title}` };
  } catch (err) {
    return { success: false, output: '', error: `Navigation failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function executeBrowserClick(selector?: string, text?: string): Promise<ToolResult> {
  if (!selector && !text) {
    return { success: false, output: '', error: 'Provide either selector or text parameter' };
  }
  try {
    const { page } = await ensureBrowser();
    if (text) {
      await page.getByText(text, { exact: false }).first().click({ timeout: 10000 });
    } else {
      await page.click(selector!, { timeout: 10000 });
    }
    return { success: true, output: 'Click successful' };
  } catch (err) {
    return { success: false, output: '', error: `Click failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function executeBrowserType(selector: string, text: string, clearFirst = false): Promise<ToolResult> {
  try {
    const { page } = await ensureBrowser();
    if (clearFirst) {
      await page.fill(selector, '', { timeout: 10000 });
    }
    await page.type(selector, text, { delay: 40, timeout: 10000 });
    return { success: true, output: `Typed "${text.substring(0, 60)}${text.length > 60 ? '…' : ''}" into ${selector}` };
  } catch (err) {
    return { success: false, output: '', error: `Type failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function executeBrowserGetContent(selector?: string): Promise<ToolResult> {
  try {
    const { page } = await ensureBrowser();
    let content: string;
    if (selector) {
      const el = await page.$(selector);
      if (!el) return { success: false, output: '', error: `Element not found: ${selector}` };
      content = await el.innerText();
    } else {
      content = await page.innerText('body');
    }
    return { success: true, output: smartTruncate(content.trim(), 8000) };
  } catch (err) {
    return { success: false, output: '', error: `Get content failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function executeBrowserScreenshot(filePath = '/tmp/cude-screenshot.png', fullPage = false): Promise<ToolResult> {
  try {
    const { page } = await ensureBrowser();
    const resolved = resolve(filePath);
    const dir = dirname(resolved);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: resolved, fullPage });
    return { success: true, output: `Screenshot saved: ${resolved}` };
  } catch (err) {
    return { success: false, output: '', error: `Screenshot failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function executeBrowserClose(): Promise<ToolResult> {
  try {
    await closeBrowser();
    return { success: true, output: 'Browser closed successfully' };
  } catch (err) {
    return { success: false, output: '', error: `Browser close failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── Test runner ─────────────────────────────────────────────────────────────

interface TestFramework {
  name: string;
  command: string;
  filterFlag?: string;
}

function detectTestFramework(projectPath: string): TestFramework | null {
  const pkgPath = join(projectPath, 'package.json');
  const cargoPath = join(projectPath, 'Cargo.toml');
  const goPath    = join(projectPath, 'go.mod');
  const reqPath   = join(projectPath, 'requirements.txt');
  const pyprojectPath = join(projectPath, 'pyproject.toml');

  // Go
  if (existsSync(goPath)) return { name: 'go test', command: 'go test ./...', filterFlag: '-run' };
  // Rust / Cargo
  if (existsSync(cargoPath)) return { name: 'cargo test', command: 'cargo test', filterFlag: '--' };
  // Python
  if (existsSync(pyprojectPath) || existsSync(reqPath) || existsSync(join(projectPath, 'pytest.ini')) || existsSync(join(projectPath, 'setup.py'))) {
    return { name: 'pytest', command: 'python -m pytest -v --tb=short', filterFlag: '-k' };
  }

  // Node.js — check package.json
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
        scripts?: Record<string, string>;
        devDependencies?: Record<string, string>;
        dependencies?: Record<string, string>;
      };
      const deps = { ...pkg.devDependencies, ...pkg.dependencies };
      const testScript = pkg.scripts?.test ?? '';

      if (deps['vitest'] || testScript.includes('vitest')) {
        return { name: 'vitest', command: 'npx vitest run --reporter=verbose', filterFlag: '--testNamePattern' };
      }
      if (deps['jest'] || testScript.includes('jest')) {
        return { name: 'jest', command: 'npx jest --verbose', filterFlag: '--testNamePattern' };
      }
      if (deps['mocha'] || testScript.includes('mocha')) {
        return { name: 'mocha', command: 'npx mocha', filterFlag: '--grep' };
      }
      if (deps['jasmine'] || testScript.includes('jasmine')) {
        return { name: 'jasmine', command: 'npx jasmine', filterFlag: '--filter' };
      }
      // Generic npm test
      if (testScript && !testScript.includes('echo')) {
        return { name: 'npm test', command: 'npm test', filterFlag: undefined };
      }
    } catch { /* malformed package.json */ }
  }

  return null;
}

interface TestSummary {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  failingTests: string[];
  duration?: string;
}

function parseTestResults(output: string, framework: string): TestSummary {
  const result: TestSummary = { passed: 0, failed: 0, skipped: 0, total: 0, failingTests: [] };

  if (framework === 'jest' || framework === 'vitest') {
    const passMatch  = output.match(/(\d+)\s+pass(?:ed)?/i);
    const failMatch  = output.match(/(\d+)\s+fail(?:ed)?/i);
    const skipMatch  = output.match(/(\d+)\s+skip(?:ped)?/i);
    const durationM  = output.match(/Duration\s+([\d.]+\s*\w+)/i);
    if (passMatch)  result.passed  = parseInt(passMatch[1]);
    if (failMatch)  result.failed  = parseInt(failMatch[1]);
    if (skipMatch)  result.skipped = parseInt(skipMatch[1]);
    if (durationM)  result.duration = durationM[1];
    // Extract failing test names (lines starting with ✕ or ✗ or FAIL)
    const failLines = output.match(/(?:✕|✗|●|FAIL)\s+(.+)/g) ?? [];
    result.failingTests = failLines.slice(0, 10).map(l => l.replace(/^[✕✗●FAIL\s]+/, '').trim());
  } else if (framework === 'pytest') {
    const summaryMatch = output.match(/(\d+) passed(?:,\s*(\d+) failed)?(?:,\s*(\d+) skipped)?/);
    if (summaryMatch) {
      result.passed  = parseInt(summaryMatch[1] ?? '0');
      result.failed  = parseInt(summaryMatch[2] ?? '0');
      result.skipped = parseInt(summaryMatch[3] ?? '0');
    }
    const failLines = output.match(/FAILED\s+([^\n]+)/g) ?? [];
    result.failingTests = failLines.slice(0, 10).map(l => l.replace('FAILED ', '').trim());
  } else if (framework === 'go test') {
    result.passed  = (output.match(/--- PASS:/g) ?? []).length;
    result.failed  = (output.match(/--- FAIL:/g) ?? []).length;
    const failLines = output.match(/--- FAIL:\s*(\S+)/g) ?? [];
    result.failingTests = failLines.slice(0, 10).map(l => l.replace(/--- FAIL:\s*/, '').trim());
    if (output.includes('ok  \t')) result.passed = result.passed || 1;
  } else if (framework === 'cargo test') {
    const m = output.match(/test result:.*?(\d+) passed.*?(\d+) failed/);
    if (m) { result.passed = parseInt(m[1]); result.failed = parseInt(m[2]); }
    const failLines = output.match(/FAILED\s+[^\n]+/g) ?? [];
    result.failingTests = failLines.slice(0, 10).map(l => l.trim());
  }

  result.total = result.passed + result.failed + result.skipped;
  return result;
}

async function executeTestProject(
  projectPath?: string,
  filter?: string,
  timeoutSecs = 120
): Promise<ToolResult> {
  const cwd = projectPath ? resolve(projectPath) : process.cwd();

  if (!existsSync(cwd)) {
    return { success: false, output: '', error: `Directory not found: ${cwd}` };
  }

  const framework = detectTestFramework(cwd);
  if (!framework) {
    return {
      success: false, output: '',
      error: 'No test framework detected. Expected: jest, vitest, pytest, mocha, cargo, or go.mod',
    };
  }

  let command = framework.command;
  if (filter && framework.filterFlag) {
    command += ` ${framework.filterFlag} ${JSON.stringify(filter)}`;
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: timeoutSecs * 1_000,
      env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
    });

    const combined = (stdout + '\n' + stderr).trim();
    const summary  = parseTestResults(combined, framework.name);

    const lines: string[] = [
      `Test framework: ${framework.name}`,
      `Command: ${command}`,
      ``,
      `Results: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped (${summary.total} total)${summary.duration ? ` · ${summary.duration}` : ''}`,
    ];

    if (summary.failingTests.length > 0) {
      lines.push(``, `Failing tests:`);
      summary.failingTests.forEach(t => lines.push(`  ✗ ${t}`));
    }

    lines.push(``, `--- Output ---`, smartTruncate(combined, 6000));

    const allPassed = summary.failed === 0 && (summary.passed > 0 || summary.total === 0);
    return {
      success: allPassed,
      output: lines.join('\n'),
      error: allPassed ? undefined : `${summary.failed} test(s) failed`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Even on non-zero exit (test failures), we have useful output
    const execErr = err as { stdout?: string; stderr?: string };
    if (execErr.stdout || execErr.stderr) {
      const combined = ((execErr.stdout ?? '') + '\n' + (execErr.stderr ?? '')).trim();
      const summary  = parseTestResults(combined, framework.name);
      const lines: string[] = [
        `Test framework: ${framework.name}`,
        ``,
        `Results: ${summary.passed} passed, ${summary.failed} failed (${summary.total} total)`,
      ];
      if (summary.failingTests.length > 0) {
        lines.push(``, `Failing tests:`);
        summary.failingTests.forEach(t => lines.push(`  ✗ ${t}`));
      }
      lines.push(``, `--- Output ---`, smartTruncate(combined, 5000));
      return { success: false, output: lines.join('\n'), error: `Tests failed: ${summary.failed} failing` };
    }
    return { success: false, output: '', error: `Test run failed: ${msg}` };
  }
}

// ─── Grep search ────────────────────────────────────────────────────────────

async function executeGrepSearch(
  pattern: string,
  searchPath = '.',
  include?: string,
  maxResults = 50
): Promise<ToolResult> {
  try {
    const resolved = resolve(searchPath);
    const includeFlag = include ? `--include=${shellQuote(include)}` : '';
    const cmd = `grep -rn ${includeFlag} -- ${shellQuote(pattern)} ${shellQuote(resolved)} | head -n ${maxResults}`;
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: process.cwd(),
      timeout: 30000,
    });
    const output = stdout.trim();
    if (!output) {
      return { success: true, output: `No matches found for pattern: ${pattern}` };
    }
    const lineCount = output.split('\n').length;
    const result = `Found ${lineCount} match(es):\n\n${smartTruncate(output, 8000)}`;
    return { success: true, output: result + (stderr ? `\nSTDERR: ${stderr}` : '') };
  } catch (err) {
    // grep returns exit code 1 when no matches found
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === '1') {
      return { success: true, output: `No matches found for pattern: ${pattern}` };
    }
    const execErr = err as { stdout?: string; stderr?: string; code?: number };
    if (execErr.code === 1 && !execErr.stdout) {
      return { success: true, output: `No matches found for pattern: ${pattern}` };
    }
    return { success: false, output: '', error: `grep failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── Find files ─────────────────────────────────────────────────────────────

async function executeFindFiles(
  pattern: string,
  searchPath = '.',
  type?: string
): Promise<ToolResult> {
  try {
    const resolved = resolve(searchPath);
    const typeFlag = type === 'dir' ? '-type d' : type === 'file' ? '-type f' : '';
    const cmd = `find ${shellQuote(resolved)} -name ${shellQuote(pattern)} ${typeFlag} -not -path '*/node_modules/*' -not -path '*/.git/*' | head -n 200`;
    const { stdout } = await execAsync(cmd, {
      cwd: process.cwd(),
      timeout: 15000,
    });
    const output = stdout.trim();
    if (!output) {
      return { success: true, output: `No files found matching pattern: ${pattern}` };
    }
    const fileCount = output.split('\n').length;
    return { success: true, output: `Found ${fileCount} result(s):\n\n${smartTruncate(output, 8000)}` };
  } catch (err) {
    return { success: false, output: '', error: `find failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── Delete file ────────────────────────────────────────────────────────────

async function executeDeleteFile(filePath: string): Promise<ToolResult> {
  try {
    const resolved = resolve(filePath);
    if (!existsSync(resolved)) {
      return { success: false, output: '', error: `Not found: ${filePath}` };
    }

    if (confirmCallback) {
      const ok = await confirmCallback(`Delete ${filePath}?`);
      if (!ok) return { success: false, output: '', error: 'Delete cancelled by user' };
    }

    const stat = statSync(resolved);
    if (stat.isDirectory()) {
      rmdirSync(resolved);
      return { success: true, output: `Deleted directory: ${filePath}` };
    } else {
      unlinkSync(resolved);
      return { success: true, output: `Deleted file: ${filePath}` };
    }
  } catch (err) {
    return { success: false, output: '', error: `Delete failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── Move file ──────────────────────────────────────────────────────────────

function executeMoveFile(source: string, destination: string): ToolResult {
  try {
    const resolvedSrc = resolve(source);
    const resolvedDest = resolve(destination);
    if (!existsSync(resolvedSrc)) {
      return { success: false, output: '', error: `Source not found: ${source}` };
    }
    const destDir = dirname(resolvedDest);
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
    renameSync(resolvedSrc, resolvedDest);
    return { success: true, output: `Moved ${source} -> ${destination}` };
  } catch (err) {
    return { success: false, output: '', error: `Move failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── Replace in files ───────────────────────────────────────────────────────

async function executeReplaceInFiles(
  pattern: string,
  replacement: string,
  searchPath = '.',
  include?: string,
  dryRun = false
): Promise<ToolResult> {
  try {
    const resolved = resolve(searchPath);
    const includeFlag = include ? `--include=${shellQuote(include)}` : '';
    const cmd = `grep -rl ${includeFlag} -- ${shellQuote(pattern)} ${shellQuote(resolved)}`;
    let fileList: string;
    try {
      const { stdout } = await execAsync(cmd, { cwd: process.cwd(), timeout: 15000 });
      fileList = stdout.trim();
    } catch {
      return { success: true, output: `No files contain the pattern: ${pattern}` };
    }

    if (!fileList) {
      return { success: true, output: `No files contain the pattern: ${pattern}` };
    }

    const files = fileList.split('\n').filter(Boolean);

    if (!dryRun && confirmCallback) {
      const ok = await confirmCallback(`Replace "${pattern}" with "${replacement}" in ${files.length} file(s)?`);
      if (!ok) return { success: false, output: '', error: 'Replace cancelled by user' };
    }

    const results: string[] = [];
    let totalReplacements = 0;

    for (const file of files) {
      try {
        const content = readFileSync(file, 'utf-8');
        const regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        const matches = content.match(regex);
        const count = matches ? matches.length : 0;

        if (count === 0) continue;

        if (dryRun) {
          results.push(`  ${file}: ${count} occurrence(s)`);
        } else {
          const updated = content.split(pattern).join(replacement);
          writeFileSync(file, updated, 'utf-8');
          results.push(`  ${file}: ${count} replacement(s)`);
        }
        totalReplacements += count;
      } catch {
        results.push(`  ${file}: (skipped — read/write error)`);
      }
    }

    const header = dryRun
      ? `Dry run — would replace "${pattern}" with "${replacement}" (${totalReplacements} occurrences in ${files.length} file(s)):`
      : `Replaced "${pattern}" with "${replacement}" (${totalReplacements} replacements in ${files.length} file(s)):`;

    return { success: true, output: `${header}\n\n${results.join('\n')}` };
  } catch (err) {
    return { success: false, output: '', error: `Replace failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── Git branch ─────────────────────────────────────────────────────────────

async function executeGitBranch(action: string, name?: string): Promise<ToolResult> {
  try {
    switch (action) {
      case 'list': {
        const { stdout } = await execAsync('git branch -a', { cwd: process.cwd(), timeout: 10000 });
        return { success: true, output: stdout.trim() || 'No branches found' };
      }
      case 'create': {
        if (!name) return { success: false, output: '', error: 'Branch name is required for create' };
        const { stdout } = await execAsync(`git branch ${shellQuote(name)}`, { cwd: process.cwd(), timeout: 10000 });
        return { success: true, output: stdout.trim() || `Created branch: ${name}` };
      }
      case 'delete': {
        if (!name) return { success: false, output: '', error: 'Branch name is required for delete' };
        const { stdout } = await execAsync(`git branch -d ${shellQuote(name)}`, { cwd: process.cwd(), timeout: 10000 });
        return { success: true, output: stdout.trim() || `Deleted branch: ${name}` };
      }
      case 'switch': {
        if (!name) return { success: false, output: '', error: 'Branch name is required for switch' };
        const { stdout } = await execAsync(`git switch ${shellQuote(name)}`, { cwd: process.cwd(), timeout: 10000 });
        return { success: true, output: stdout.trim() || `Switched to branch: ${name}` };
      }
      default:
        return { success: false, output: '', error: `Unknown action: ${action}. Use list, create, delete, or switch.` };
    }
  } catch (err) {
    const execErr = err as { stderr?: string };
    return { success: false, output: '', error: `git branch failed: ${execErr.stderr || (err instanceof Error ? err.message : String(err))}` };
  }
}

// ─── Git stash ──────────────────────────────────────────────────────────────

async function executeGitStash(action: string, message?: string): Promise<ToolResult> {
  try {
    switch (action) {
      case 'save': {
        const msgFlag = message ? ` -m ${shellQuote(message)}` : '';
        const { stdout, stderr } = await execAsync(`git stash push${msgFlag}`, { cwd: process.cwd(), timeout: 10000 });
        const output = (stdout + stderr).trim();
        return { success: true, output: output || 'Changes stashed' };
      }
      case 'pop': {
        const { stdout, stderr } = await execAsync('git stash pop', { cwd: process.cwd(), timeout: 10000 });
        const output = (stdout + stderr).trim();
        return { success: true, output: output || 'Stash applied and dropped' };
      }
      case 'list': {
        const { stdout } = await execAsync('git stash list', { cwd: process.cwd(), timeout: 10000 });
        return { success: true, output: stdout.trim() || 'No stashes found' };
      }
      case 'drop': {
        const { stdout, stderr } = await execAsync('git stash drop', { cwd: process.cwd(), timeout: 10000 });
        const output = (stdout + stderr).trim();
        return { success: true, output: output || 'Stash dropped' };
      }
      default:
        return { success: false, output: '', error: `Unknown action: ${action}. Use save, pop, list, or drop.` };
    }
  } catch (err) {
    const execErr = err as { stderr?: string };
    return { success: false, output: '', error: `git stash failed: ${execErr.stderr || (err instanceof Error ? err.message : String(err))}` };
  }
}

// ─── Git checkout ───────────────────────────────────────────────────────────

async function executeGitCheckout(target: string, create = false): Promise<ToolResult> {
  try {
    const flag = create ? '-b ' : '';
    const { stdout, stderr } = await execAsync(`git checkout ${flag}${shellQuote(target)}`, {
      cwd: process.cwd(),
      timeout: 10000,
    });
    const output = (stdout + stderr).trim();
    return { success: true, output: output || `Checked out: ${target}` };
  } catch (err) {
    const execErr = err as { stderr?: string };
    return { success: false, output: '', error: `git checkout failed: ${execErr.stderr || (err instanceof Error ? err.message : String(err))}` };
  }
}

// ─── Run lint ───────────────────────────────────────────────────────────────

interface LintFramework {
  name: string;
  command: string;
  fixCommand: string;
}

function detectLintFramework(projectPath: string): LintFramework | null {
  const pkgPath = join(projectPath, 'package.json');
  const pyprojectPath = join(projectPath, 'pyproject.toml');
  const cargoPath = join(projectPath, 'Cargo.toml');
  const goPath = join(projectPath, 'go.mod');

  // Go
  if (existsSync(goPath)) {
    return { name: 'golint', command: 'go vet ./...', fixCommand: 'go vet ./...' };
  }
  // Rust / Cargo
  if (existsSync(cargoPath)) {
    return { name: 'clippy', command: 'cargo clippy', fixCommand: 'cargo clippy --fix --allow-dirty' };
  }
  // Python
  if (existsSync(pyprojectPath)) {
    const content = readFileSync(pyprojectPath, 'utf-8');
    if (content.includes('ruff')) {
      return { name: 'ruff', command: 'ruff check .', fixCommand: 'ruff check --fix .' };
    }
    return { name: 'pylint', command: 'pylint .', fixCommand: 'pylint .' };
  }

  // Node.js
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
        scripts?: Record<string, string>;
        devDependencies?: Record<string, string>;
        dependencies?: Record<string, string>;
      };
      const deps = { ...pkg.devDependencies, ...pkg.dependencies };

      if (deps['eslint'] || pkg.scripts?.lint?.includes('eslint')) {
        return { name: 'eslint', command: 'npx eslint .', fixCommand: 'npx eslint --fix .' };
      }
      if (deps['prettier']) {
        return { name: 'prettier', command: 'npx prettier --check .', fixCommand: 'npx prettier --write .' };
      }
      if (pkg.scripts?.lint) {
        return { name: 'npm lint', command: 'npm run lint', fixCommand: 'npm run lint -- --fix' };
      }
    } catch { /* malformed package.json */ }
  }

  return null;
}

async function executeRunLint(projectPath?: string, fix = false): Promise<ToolResult> {
  const cwd = projectPath ? resolve(projectPath) : process.cwd();
  if (!existsSync(cwd)) {
    return { success: false, output: '', error: `Directory not found: ${cwd}` };
  }

  const framework = detectLintFramework(cwd);
  if (!framework) {
    return {
      success: false, output: '',
      error: 'No linter detected. Expected: eslint, prettier, ruff, pylint, clippy, or go vet.',
    };
  }

  const command = fix ? framework.fixCommand : framework.command;
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: 60000,
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    const combined = (stdout + '\n' + stderr).trim();
    return {
      success: true,
      output: `Linter: ${framework.name}\nCommand: ${command}\n\n${smartTruncate(combined, 6000) || 'No issues found.'}`,
    };
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string };
    const combined = ((execErr.stdout ?? '') + '\n' + (execErr.stderr ?? '')).trim();
    if (combined) {
      return {
        success: false,
        output: `Linter: ${framework.name}\nCommand: ${command}\n\n${smartTruncate(combined, 6000)}`,
        error: 'Lint issues found',
      };
    }
    return { success: false, output: '', error: `Lint failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── Analyze project ────────────────────────────────────────────────────────

async function executeAnalyzeProject(projectPath?: string): Promise<ToolResult> {
  const cwd = projectPath ? resolve(projectPath) : process.cwd();
  if (!existsSync(cwd)) {
    return { success: false, output: '', error: `Directory not found: ${cwd}` };
  }

  const lines: string[] = [`Project Analysis: ${cwd}`, ''];

  // Count files by extension
  try {
    const { stdout } = await execAsync(
      `find ${shellQuote(cwd)} -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/build/*' | sed 's/.*\\.//' | sort | uniq -c | sort -rn | head -20`,
      { cwd, timeout: 15000 }
    );
    if (stdout.trim()) {
      lines.push('File types:', ...stdout.trim().split('\n').map(l => `  ${l.trim()}`), '');
    }
  } catch { /* skip */ }

  // Detect project type and frameworks
  const frameworks: string[] = [];
  const entryPoints: string[] = [];

  // Node.js / JavaScript
  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
        name?: string; version?: string; description?: string;
        main?: string; scripts?: Record<string, string>;
        dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
      };
      lines.push(`Package: ${pkg.name ?? 'unnamed'} v${pkg.version ?? '0.0.0'}`);
      if (pkg.description) lines.push(`Description: ${pkg.description}`);
      lines.push('');

      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps['react']) frameworks.push('React');
      if (deps['vue']) frameworks.push('Vue');
      if (deps['next']) frameworks.push('Next.js');
      if (deps['nuxt']) frameworks.push('Nuxt');
      if (deps['svelte']) frameworks.push('Svelte');
      if (deps['express']) frameworks.push('Express');
      if (deps['fastify']) frameworks.push('Fastify');
      if (deps['@nestjs/core']) frameworks.push('NestJS');
      if (deps['typescript']) frameworks.push('TypeScript');
      if (deps['tailwindcss']) frameworks.push('Tailwind CSS');

      if (pkg.main) entryPoints.push(`main: ${pkg.main}`);
      if (pkg.scripts) {
        lines.push('Scripts:');
        for (const [key, val] of Object.entries(pkg.scripts).slice(0, 10)) {
          lines.push(`  ${key}: ${val}`);
        }
        lines.push('');
      }

      const depCount = Object.keys(pkg.dependencies ?? {}).length;
      const devDepCount = Object.keys(pkg.devDependencies ?? {}).length;
      lines.push(`Dependencies: ${depCount} production, ${devDepCount} dev`, '');
    } catch { /* malformed package.json */ }
  }

  // Python
  const pyprojectPath = join(cwd, 'pyproject.toml');
  const reqPath = join(cwd, 'requirements.txt');
  if (existsSync(pyprojectPath)) {
    const content = readFileSync(pyprojectPath, 'utf-8');
    if (content.includes('django')) frameworks.push('Django');
    if (content.includes('flask')) frameworks.push('Flask');
    if (content.includes('fastapi')) frameworks.push('FastAPI');
    if (content.includes('pytest')) frameworks.push('pytest');
    lines.push('Python project (pyproject.toml detected)', '');
  } else if (existsSync(reqPath)) {
    const content = readFileSync(reqPath, 'utf-8');
    const depCount = content.split('\n').filter(l => l.trim() && !l.startsWith('#')).length;
    if (content.includes('django')) frameworks.push('Django');
    if (content.includes('flask')) frameworks.push('Flask');
    if (content.includes('fastapi')) frameworks.push('FastAPI');
    lines.push(`Python project (${depCount} dependencies in requirements.txt)`, '');
  }

  // Rust
  if (existsSync(join(cwd, 'Cargo.toml'))) {
    frameworks.push('Rust/Cargo');
    entryPoints.push('src/main.rs or src/lib.rs');
  }

  // Go
  if (existsSync(join(cwd, 'go.mod'))) {
    frameworks.push('Go');
    entryPoints.push('main.go or cmd/');
  }

  if (frameworks.length > 0) {
    lines.push(`Frameworks/Libraries: ${frameworks.join(', ')}`, '');
  }
  if (entryPoints.length > 0) {
    lines.push(`Entry points: ${entryPoints.join(', ')}`, '');
  }

  // Total file count
  try {
    const { stdout } = await execAsync(
      `find ${shellQuote(cwd)} -type f -not -path '*/node_modules/*' -not -path '*/.git/*' | wc -l`,
      { cwd, timeout: 10000 }
    );
    lines.push(`Total files: ${stdout.trim()}`);
  } catch { /* skip */ }

  return { success: true, output: lines.join('\n') };
}

// ─── Diff files ─────────────────────────────────────────────────────────────

async function executeDiffFiles(file1: string, file2: string): Promise<ToolResult> {
  try {
    const resolved1 = resolve(file1);
    const resolved2 = resolve(file2);
    if (!existsSync(resolved1)) return { success: false, output: '', error: `File not found: ${file1}` };
    if (!existsSync(resolved2)) return { success: false, output: '', error: `File not found: ${file2}` };

    const { stdout } = await execAsync(`diff -u ${shellQuote(resolved1)} ${shellQuote(resolved2)}`, {
      cwd: process.cwd(),
      timeout: 15000,
    });
    return { success: true, output: stdout.trim() || 'Files are identical' };
  } catch (err) {
    const execErr = err as { stdout?: string; code?: number };
    // diff returns exit code 1 when files differ (not an error)
    if (execErr.stdout) {
      return { success: true, output: smartTruncate(execErr.stdout.trim(), 8000) };
    }
    return { success: false, output: '', error: `diff failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── Patch file ─────────────────────────────────────────────────────────────

async function executePatchFile(filePath: string, patchContent: string): Promise<ToolResult> {
  try {
    const resolved = resolve(filePath);
    if (!existsSync(resolved)) {
      return { success: false, output: '', error: `File not found: ${filePath}` };
    }

    const patchFile = join(tmpdir(), `codiente-patch-${Date.now()}.patch`);
    writeFileSync(patchFile, patchContent, 'utf-8');

    try {
      const { stdout, stderr } = await execAsync(`patch ${shellQuote(resolved)} < ${shellQuote(patchFile)}`, {
        cwd: process.cwd(),
        timeout: 15000,
      });
      const output = (stdout + stderr).trim();
      return { success: true, output: output || `Patch applied to ${filePath}` };
    } finally {
      try { unlinkSync(patchFile); } catch { /* ignore cleanup errors */ }
    }
  } catch (err) {
    return { success: false, output: '', error: `Patch failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── Git blame ──────────────────────────────────────────────────────────────

async function executeGitBlame(
  filePath: string,
  startLine?: number,
  endLine?: number
): Promise<ToolResult> {
  try {
    const resolved = resolve(filePath);
    if (!existsSync(resolved)) {
      return { success: false, output: '', error: `File not found: ${filePath}` };
    }

    const lineRange = startLine !== undefined && endLine !== undefined
      ? `-L ${startLine},${endLine}`
      : startLine !== undefined
        ? `-L ${startLine},+1`
        : '';
    const { stdout } = await execAsync(`git blame ${lineRange} -- ${shellQuote(resolved)}`, {
      cwd: process.cwd(),
      timeout: 15000,
    });
    return { success: true, output: smartTruncate(stdout.trim(), 8000) || 'No blame information' };
  } catch (err) {
    const execErr = err as { stderr?: string };
    return { success: false, output: '', error: `git blame failed: ${execErr.stderr || (err instanceof Error ? err.message : String(err))}` };
  }
}

// ─── Git merge ──────────────────────────────────────────────────────────────

async function executeGitMerge(branch: string, noFf = false): Promise<ToolResult> {
  try {
    const ffFlag = noFf ? '--no-ff ' : '';
    const { stdout, stderr } = await execAsync(`git merge ${ffFlag}${shellQuote(branch)}`, {
      cwd: process.cwd(),
      timeout: 30000,
    });
    const output = (stdout + stderr).trim();
    return { success: true, output: output || `Merged branch: ${branch}` };
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string };
    const combined = ((execErr.stdout ?? '') + '\n' + (execErr.stderr ?? '')).trim();
    if (combined.includes('CONFLICT')) {
      return { success: false, output: smartTruncate(combined, 6000), error: 'Merge conflicts detected' };
    }
    return { success: false, output: '', error: `git merge failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── Git cherry-pick ────────────────────────────────────────────────────────

async function executeGitCherryPick(commit: string): Promise<ToolResult> {
  try {
    const { stdout, stderr } = await execAsync(`git cherry-pick ${shellQuote(commit)}`, {
      cwd: process.cwd(),
      timeout: 30000,
    });
    const output = (stdout + stderr).trim();
    return { success: true, output: output || `Cherry-picked commit: ${commit}` };
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string };
    const combined = ((execErr.stdout ?? '') + '\n' + (execErr.stderr ?? '')).trim();
    if (combined.includes('CONFLICT')) {
      return { success: false, output: smartTruncate(combined, 6000), error: 'Cherry-pick conflicts detected' };
    }
    return { success: false, output: '', error: `git cherry-pick failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── Display helpers ──────────────────────────────────────────────────────────

export function formatToolCall(name: string, args: Record<string, unknown>): string {
  const argStr = Object.entries(args)
    .map(([k, v]) => `${k}=${JSON.stringify(String(v).substring(0, 60))}`)
    .join(', ');
  return chalk.cyan(`  ⚙ ${name}`) + chalk.dim(`(${argStr})`);
}

export function formatToolResult(result: ToolResult): string {
  if (result.success) {
    const preview = result.output.length > 300
      ? result.output.substring(0, 300) + chalk.dim('…')
      : result.output;
    return chalk.green('  ✓ ') + chalk.dim(preview);
  }
  return chalk.red(`  ✗ ${result.error ?? 'Unknown error'}`);
}
