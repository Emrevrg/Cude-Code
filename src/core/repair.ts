import type { ToolCall, ToolDefinition } from '../providers/types.js';

/**
 * Recovering from the ways a model gets a tool call slightly wrong.
 *
 * A wrong call costs a full iteration: the loop returns "Unknown tool:
 * write_files", the model reads it, apologises, and tries again. On a
 * benchmark with a step limit that is the difference between solving a task
 * and running out of budget three steps short — and the mistakes are almost
 * always trivial. `writeFile` for `write_file`. `file_path` for `path`. A JSON
 * object wrapped in a markdown fence.
 *
 * Repair is deliberately conservative. It only fires when there is exactly one
 * plausible target, and every repair is reported so it shows up in the audit
 * log rather than silently changing what the model asked for.
 */

/** Common aliases from other agent tools, mapped to what Cude actually calls them. */
const NAME_ALIASES: Record<string, string> = {
  // Anthropic / Claude Code
  bash: 'run_command',
  shell: 'run_command',
  execute_command: 'run_command',
  executecommand: 'run_command',
  str_replace_editor: 'replace_in_file',
  str_replace_based_edit_tool: 'replace_in_file',
  edit_file: 'replace_in_file',
  editfile: 'replace_in_file',
  create_file: 'write_file',
  createfile: 'write_file',
  view: 'read_file',
  cat: 'read_file',
  open_file: 'read_file',
  // OpenAI / Codex
  apply_diff: 'apply_patch',
  patch_file: 'apply_patch',
  ls: 'list_directory',
  list_files: 'list_directory',
  find_files: 'search_files',
  glob: 'search_files',
  grep: 'grep_search',
  ripgrep: 'grep_search',
  search: 'grep_search',
  mkdir: 'create_directory',
  rm: 'delete_file',
  remove_file: 'delete_file',
  mv: 'move_file',
  rename_file: 'move_file',
  cp: 'copy_file',
  git: 'git_command',
  npm: 'npm_command',
};

/** Argument names other tools use for the same thing. */
const ARG_ALIASES: Record<string, string[]> = {
  path: ['file_path', 'filepath', 'filename', 'file', 'target_file', 'file_name', 'dir', 'directory_path'],
  content: ['contents', 'text', 'data', 'body', 'file_text', 'new_content'],
  old_text: ['old_string', 'search', 'find', 'from', 'old_str'],
  new_text: ['new_string', 'replace', 'replacement', 'to', 'new_str'],
  command: ['cmd', 'script', 'shell_command', 'command_line'],
  directory: ['dir', 'folder', 'path', 'root'],
  pattern: ['query', 'regex', 'search_pattern', 'glob'],
  source: ['src', 'from', 'from_path', 'old_path'],
  destination: ['dest', 'dst', 'to', 'to_path', 'new_path'],
  url: ['uri', 'link', 'address'],
  query: ['q', 'search', 'question'],
  patch: ['diff', 'unified_diff', 'patch_text'],
};

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * The alias table keyed the way lookups arrive — punctuation stripped — so
 * `str_replace_editor`, `strReplaceEditor` and `str-replace-editor` all hit
 * the same entry.
 */
const NORMALIZED_ALIASES: Record<string, string> = Object.fromEntries(
  Object.entries(NAME_ALIASES).map(([alias, target]) => [normalize(alias), target])
);

/** Levenshtein distance, capped — only small edits are worth repairing. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 4) return 99;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * The tool the model meant, or null when that cannot be said with confidence.
 * Ambiguity is left alone: guessing between two candidates is worse than an
 * error message naming both.
 */
export function resolveToolName(requested: string, known: string[]): string | null {
  if (known.includes(requested)) return requested;

  const alias = NORMALIZED_ALIASES[normalize(requested)];
  if (alias && known.includes(alias)) return alias;

  const target = normalize(requested);

  // Same letters, different punctuation: writeFile → write_file.
  const exact = known.filter(name => normalize(name) === target);
  if (exact.length === 1) return exact[0];

  // Off by a character or two, and unambiguous.
  const scored = known
    .map(name => ({ name, distance: editDistance(target, normalize(name)) }))
    .filter(candidate => candidate.distance <= 2)
    .sort((a, b) => a.distance - b.distance);

  if (scored.length === 0) return null;
  if (scored.length > 1 && scored[0].distance === scored[1].distance) return null;
  return scored[0].name;
}

/**
 * Pulls a JSON object out of what a model produced for the ReAct loop: a bare
 * object, a ```json fence, or an object with prose either side of it.
 */
export function parseLooseJson(raw: string): Record<string, unknown> | null {
  const attempts: string[] = [];
  const trimmed = raw.trim();
  attempts.push(trimmed);

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) attempts.push(fenced[1].trim());

  const braced = trimmed.match(/\{[\s\S]*\}/);
  if (braced) attempts.push(braced[0]);

  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next shape.
    }
  }

  // A trailing comma is the single most common malformation; worth one retry.
  const decommaed = attempts[attempts.length - 1]?.replace(/,\s*([}\]])/g, '$1');
  if (decommaed) {
    try {
      const parsed = JSON.parse(decommaed) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Give up: the caller reports it rather than inventing arguments.
    }
  }

  return null;
}

export interface RepairedCall {
  call: ToolCall;
  /** What was changed, for the log. Empty when the call arrived correct. */
  repairs: string[];
}

/**
 * Maps a call onto the tool it was meant for: the real name, the declared
 * argument names, and JSON-encoded arguments unwrapped into objects.
 */
export function repairToolCall(call: ToolCall, tools: ToolDefinition[]): RepairedCall {
  const repairs: string[] = [];
  const known = tools.map(t => t.name);

  const resolved = resolveToolName(call.name, known);
  const name = resolved ?? call.name;
  if (resolved && resolved !== call.name) {
    repairs.push(`renamed ${call.name} → ${resolved}`);
  }

  const definition = tools.find(t => t.name === name);
  const properties =
    ((definition?.parameters as { properties?: Record<string, unknown> })?.properties) ?? {};
  const declared = Object.keys(properties);

  // Some models send the whole argument object as a JSON string.
  let args: Record<string, unknown> = call.arguments ?? {};
  if (typeof args === 'string') {
    const parsed = parseLooseJson(args as unknown as string);
    if (parsed) {
      args = parsed;
      repairs.push('parsed arguments from a JSON string');
    }
  }

  if (declared.length === 0) {
    return { call: { ...call, name, arguments: args }, repairs };
  }

  const repaired: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (declared.includes(key)) {
      repaired[key] = value;
      continue;
    }

    // An alias the tool declares under a different name.
    const canonical = declared.find(name => (ARG_ALIASES[name] ?? []).includes(normalize(key).replace(/_/g, '')) ||
      (ARG_ALIASES[name] ?? []).includes(key.toLowerCase()));
    if (canonical && repaired[canonical] === undefined) {
      repaired[canonical] = value;
      repairs.push(`argument ${key} → ${canonical}`);
      continue;
    }

    // A near-miss on a declared name.
    const close = declared.filter(name => editDistance(normalize(key), normalize(name)) <= 2);
    if (close.length === 1 && repaired[close[0]] === undefined) {
      repaired[close[0]] = value;
      repairs.push(`argument ${key} → ${close[0]}`);
      continue;
    }

    // Unrecognised: keep it. The parameter check reports it far better than a
    // silent drop would.
    repaired[key] = value;
  }

  return { call: { ...call, name, arguments: repaired }, repairs };
}

/**
 * The message sent back when a call cannot be repaired. Naming the closest
 * candidates turns a dead iteration into a corrected one.
 */
export function unknownToolMessage(requested: string, known: string[]): string {
  const suggestions = known
    .map(name => ({ name, distance: editDistance(normalize(requested), normalize(name)) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
    .map(candidate => candidate.name);

  return (
    `Unknown tool: ${requested}. ` +
    `Closest available: ${suggestions.join(', ')}. ` +
    `Call one of the tools you were given, using its exact name.`
  );
}
