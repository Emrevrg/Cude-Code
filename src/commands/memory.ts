import chalk from 'chalk';
import { addMemory, listMemory, searchMemory } from '../core/memory.js';

export function runMemoryAdd(text: string, tags?: string): void {
  const entry = addMemory(text, tags?.split(',') ?? []);
  console.log(chalk.green(`Memory saved: ${entry.id}`));
}
export function runMemoryList(query?: string): void {
  const entries = query ? searchMemory(query) : listMemory();
  if (entries.length === 0) { console.log(chalk.dim('No project memories found.')); return; }
  for (const entry of entries) console.log(`${entry.id}  ${entry.text}${entry.tags.length ? chalk.dim(` [${entry.tags.join(', ')}]`) : ''}`);
}
