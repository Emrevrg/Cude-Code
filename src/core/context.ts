import { existsSync, readFileSync } from 'fs';
import { dirname, join, parse, resolve } from 'path';

const CONTEXT_NAMES = ['AGENTS.md', 'CLAUDE.md', '.cude-context.md'];
const MAX_FILE_CHARS = 24_000;
const MAX_TOTAL_CHARS = 60_000;

export interface ContextFile {
  path: string;
  content: string;
  truncated: boolean;
}

function readContextFile(path: string): ContextFile | null {
  try {
    const raw = readFileSync(path, 'utf8');
    const truncated = raw.length > MAX_FILE_CHARS;
    return { path, content: truncated ? raw.slice(0, MAX_FILE_CHARS) : raw, truncated };
  } catch {
    return null;
  }
}

/** Load nearest project instructions, supporting common coding-agent conventions. */
export function loadProjectContext(start = process.cwd()): ContextFile[] {
  const files: ContextFile[] = [];
  let current = resolve(start);
  let total = 0;

  while (true) {
    const override = join(current, 'AGENTS.override.md');
    const candidates = existsSync(override) ? [override] : CONTEXT_NAMES.map(name => join(current, name));
    for (const path of candidates) {
      if (!existsSync(path)) continue;
      const item = readContextFile(path);
      if (!item || total >= MAX_TOTAL_CHARS) continue;
      const remaining = MAX_TOTAL_CHARS - total;
      if (item.content.length > remaining) {
        item.content = item.content.slice(0, remaining);
        item.truncated = true;
      }
      files.push(item);
      total += item.content.length;
      break;
    }
    const parent = dirname(current);
    if (parent === current || parse(current).root === current) break;
    current = parent;
  }
  return files.reverse();
}

export function formatProjectContext(files: ContextFile[]): string {
  if (files.length === 0) return '';
  return files.map(file =>
    `\n\n--- Project instructions: ${file.path}${file.truncated ? ' (truncated)' : ''} ---\n${file.content}`
  ).join('');
}
