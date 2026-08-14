import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runAgent, type AgentResult } from './agent.js';

export interface SubagentDefinition {
  name: string;
  description: string;
  prompt: string;
  path: string;
}

function parseFrontmatter(raw: string): { metadata: Record<string, string>; body: string } {
  if (!raw.startsWith('---')) return { metadata: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return { metadata: {}, body: raw };
  const metadata: Record<string, string> = {};
  for (const line of raw.slice(3, end).split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator > 0) metadata[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return { metadata, body: raw.slice(end + 4).trim() };
}

export function loadSubagents(root = process.cwd()): SubagentDefinition[] {
  const directory = join(root, '.cude', 'agents');
  if (!existsSync(directory)) return [];
  const result: SubagentDefinition[] = [];
  for (const entry of readdirSync(directory)) {
    if (!entry.endsWith('.md')) continue;
    const path = join(directory, entry);
    try {
      const parsed = parseFrontmatter(readFileSync(path, 'utf8'));
      const name = parsed.metadata.name || entry.slice(0, -3);
      result.push({
        name,
        description: parsed.metadata.description || `Specialized subagent: ${name}`,
        prompt: parsed.body,
        path,
      });
    } catch { /* Ignore unreadable definitions and keep discovery resilient. */ }
  }
  return result;
}

export async function runSubagent(name: string, task: string, options: { provider?: string; model?: string; free?: boolean; maxIterations?: number; verbose?: boolean } = {}): Promise<AgentResult> {
  const definition = loadSubagents().find(item => item.name === name);
  if (!definition) throw new Error(`Subagent '${name}' was not found under .cude/agents.`);
  return runAgent({
    task: `${definition.prompt}\n\nSubagent task:\n${task}`,
    provider: options.provider,
    model: options.model,
    free: options.free,
    maxIterations: options.maxIterations,
    verbose: options.verbose,
  });
}
