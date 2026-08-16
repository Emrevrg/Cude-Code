import { TOOL_DEFINITIONS } from './tools.js';
import type { TaskType } from './selector.js';
import { getMcpToolDefinitions, isMcpTool } from '../mcp/registry.js';
import type { ToolDefinition } from '../providers/types.js';

/**
 * Agent modes. A mode is a system prompt plus a tool budget: what the agent is
 * being asked to do, and what it is allowed to touch while doing it.
 *
 * The tool budget is the part that matters. "Ask me about this codebase" should
 * not be able to write to it, and enforcing that with a prompt alone is not
 * enforcement — so the allow-list is applied twice, once when the tool list is
 * built for the model and again in executeTool.
 */
export interface AgentMode {
  name: string;
  displayName: string;
  description: string;
  /** Appended to the base agent prompt. */
  systemPrompt: string;
  /** Tool names this mode may call. `'all'` means every registered tool. */
  allowedTools: 'all' | string[];
  /**
   * When set, writes are additionally restricted to paths matching this — a
   * mode that says it only writes Markdown has to actually only write Markdown.
   */
  writablePathPattern?: RegExp;
  /**
   * Whether tools contributed by MCP servers are offered in this mode. An
   * external server's tools are arbitrary, so a mode that promises read-only
   * cannot honestly hand them to the model.
   */
  allowMcp: boolean;
  defaultTaskType: TaskType;
}

/** Tools whose first path argument is something the mode is about to write. */
const WRITE_PATH_ARGS: Record<string, string> = {
  write_file: 'path',
  create_directory: 'path',
  replace_in_file: 'path',
  apply_patch: 'path',
  delete_file: 'path',
  move_file: 'destination',
  copy_file: 'destination',
};

/**
 * Tools that only observe. Every mode gets these, and because none of them
 * mutates anything, a turn made up entirely of these calls can run in
 * parallel.
 */
export const READ_ONLY_TOOLS = [
  'read_file',
  'list_directory',
  'search_files',
  'grep_search',
  'get_file_info',
  'diff_files',
  'rag_index',
  'rag_search',
  'rag_summary',
  'browser_navigate',
  'browser_screenshot',
  'browser_extract',
];

export const MODES: Record<string, AgentMode> = {
  code: {
    name: 'code',
    displayName: 'Code',
    description: 'Write and modify code. Every tool available.',
    systemPrompt:
      'You are in Code mode. Implement what was asked: read the surrounding code first, ' +
      'match its conventions, and make the smallest change that does the job. ' +
      'Verify your work by running the project\'s own tests or build when they exist.',
    allowedTools: 'all',
    allowMcp: true,
    defaultTaskType: 'code',
  },

  architect: {
    name: 'architect',
    displayName: 'Architect',
    description: 'Plan and design. Reads anything; writes only Markdown.',
    systemPrompt:
      'You are in Architect mode. Investigate thoroughly and produce a plan — do not ' +
      'implement it. Read the code that matters, identify the files that would change ' +
      'and the order to change them, and name the trade-offs and risks you actually ' +
      'found. You may write Markdown documents; you cannot modify source files.',
    allowedTools: [...READ_ONLY_TOOLS, 'write_file', 'create_directory'],
    writablePathPattern: /\.(md|markdown|txt)$/i,
    allowMcp: false,
    defaultTaskType: 'complex',
  },

  ask: {
    name: 'ask',
    displayName: 'Ask',
    description: 'Answer questions. Read-only — cannot modify anything.',
    systemPrompt:
      'You are in Ask mode. Answer the question from what the codebase actually says, ' +
      'citing the files and line numbers you relied on. You have no ability to modify ' +
      'anything; if the answer requires a change, describe the change instead of ' +
      'attempting it.',
    allowedTools: READ_ONLY_TOOLS,
    allowMcp: false,
    defaultTaskType: 'analysis',
  },

  debug: {
    name: 'debug',
    displayName: 'Debug',
    description: 'Diagnose failures. Every tool available.',
    systemPrompt:
      'You are in Debug mode. Find the actual cause before proposing a fix: reproduce ' +
      'the failure, read the code on the failing path, and add instrumentation if the ' +
      'evidence is not there. State what you confirmed versus what you are inferring. ' +
      'Do not guess at a fix and declare victory without re-running the failing case.',
    allowedTools: 'all',
    allowMcp: true,
    defaultTaskType: 'complex',
  },

  orchestrator: {
    name: 'orchestrator',
    displayName: 'Orchestrator',
    description: 'Break a large task into ordered steps and work through them.',
    systemPrompt:
      'You are in Orchestrator mode. Decompose the task into concrete, ordered ' +
      'sub-tasks, then carry them out one at a time, reporting the outcome of each ' +
      'before starting the next. Keep a running list of what is done and what remains, ' +
      'and stop to say so if a sub-task turns out to be blocked.',
    allowedTools: 'all',
    allowMcp: true,
    defaultTaskType: 'complex',
  },
};

export const DEFAULT_MODE = 'code';

export function getMode(name?: string): AgentMode {
  if (!name) return MODES[DEFAULT_MODE];
  const mode = MODES[name.toLowerCase()];
  if (!mode) {
    throw new Error(
      `Unknown mode: ${name}. Available: ${Object.keys(MODES).join(', ')}`
    );
  }
  return mode;
}

export function listModes(): AgentMode[] {
  return Object.values(MODES);
}

export function isToolAllowed(mode: AgentMode, toolName: string): boolean {
  if (isMcpTool(toolName)) return mode.allowMcp;
  if (mode.allowedTools === 'all') return true;
  return mode.allowedTools.includes(toolName);
}

/**
 * Full check for one call. Returns the reason to refuse, or null to proceed.
 */
export function checkToolCall(
  mode: AgentMode,
  toolName: string,
  args: Record<string, unknown>
): string | null {
  if (!isToolAllowed(mode, toolName)) {
    const allowed = toolsForMode(mode).map(t => t.name).join(', ');
    return `${toolName} is not available in ${mode.displayName} mode. Allowed: ${allowed}.`;
  }

  const pattern = mode.writablePathPattern;
  const pathArg = WRITE_PATH_ARGS[toolName];
  if (pattern && pathArg) {
    const target = args[pathArg];
    // create_directory has no extension to match; a directory is fine.
    if (toolName !== 'create_directory' && typeof target === 'string' && !pattern.test(target)) {
      return (
        `${mode.displayName} mode may only write files matching ${pattern} — ` +
        `${target} does not. Describe the change instead of making it.`
      );
    }
  }

  return null;
}

/** The tool list handed to the model for this mode, MCP tools included. */
export function toolsForMode(mode: AgentMode): ToolDefinition[] {
  const builtIn =
    mode.allowedTools === 'all'
      ? TOOL_DEFINITIONS
      : TOOL_DEFINITIONS.filter(t => isToolAllowed(mode, t.name));
  return mode.allowMcp ? [...builtIn, ...getMcpToolDefinitions()] : builtIn;
}
