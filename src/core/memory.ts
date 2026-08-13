import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

export interface MemoryEntry { id: string; createdAt: string; text: string; tags: string[]; }

function memoryPath(root = process.cwd()): string {
  return process.env.CUDE_MEMORY_FILE?.trim() || join(resolve(root), '.cude', 'memory.jsonl');
}

function readEntries(root?: string): MemoryEntry[] {
  const path = memoryPath(root);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line) as MemoryEntry]; } catch { return []; }
  });
}

export function addMemory(text: string, tags: string[] = [], root = process.cwd()): MemoryEntry {
  const entry: MemoryEntry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date().toISOString(), text: text.trim(), tags: tags.filter(Boolean).map(tag => tag.trim().toLowerCase()) };
  const path = memoryPath(root);
  const directory = path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')));
  if (directory) mkdirSync(directory, { recursive: true });
  appendFileSync(path, JSON.stringify(entry) + '\n', 'utf8');
  return entry;
}

export function listMemory(root = process.cwd()): MemoryEntry[] { return readEntries(root); }

export function searchMemory(query: string, root = process.cwd()): MemoryEntry[] {
  const needle = query.toLowerCase();
  return readEntries(root).filter(entry => `${entry.text} ${entry.tags.join(' ')}`.toLowerCase().includes(needle));
}

export function formatMemory(entries: MemoryEntry[], limit = 30): string {
  if (entries.length === 0) return '';
  return entries.slice(-limit).map(entry => `\n- ${entry.text}${entry.tags.length ? ` [${entry.tags.join(', ')}]` : ''}`).join('');
}
