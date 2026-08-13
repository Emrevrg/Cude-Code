import type { AgentStep } from './agent.js';

export type ActivityKind = 'user' | 'model' | 'tool' | 'approval' | 'warning' | 'error' | 'system';

export interface ActivityEntry {
  id: string;
  at: string;
  kind: ActivityKind;
  label: string;
  detail?: string;
  provider?: string;
  model?: string;
  cost?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ActivitySummary {
  turns: number;
  modelCalls: number;
  toolCalls: number;
  approvals: number;
  warnings: number;
  errors: number;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  lastAction?: string;
}

export function activityEntry(
  kind: ActivityKind,
  label: string,
  detail?: string,
  metadata: Omit<ActivityEntry, 'id' | 'at' | 'kind' | 'label' | 'detail'> = {},
): ActivityEntry {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: new Date().toISOString(), kind, label, detail, ...metadata };
}

export function summarizeActivity(entries: ActivityEntry[]): ActivitySummary {
  const summary: ActivitySummary = {
    turns: entries.filter(entry => entry.kind === 'user').length,
    modelCalls: entries.filter(entry => entry.kind === 'model').length,
    toolCalls: entries.filter(entry => entry.kind === 'tool').length,
    approvals: entries.filter(entry => entry.kind === 'approval').length,
    warnings: entries.filter(entry => entry.kind === 'warning').length,
    errors: entries.filter(entry => entry.kind === 'error').length,
    totalCost: entries.reduce((sum, entry) => sum + (entry.cost ?? 0), 0),
    inputTokens: entries.reduce((sum, entry) => sum + (entry.inputTokens ?? 0), 0),
    outputTokens: entries.reduce((sum, entry) => sum + (entry.outputTokens ?? 0), 0),
  };
  const last = entries.at(-1);
  if (last) summary.lastAction = last.detail ? `${last.label}: ${last.detail}` : last.label;
  return summary;
}

export function activityFromAgentSteps(steps: AgentStep[]): ActivityEntry[] {
  return steps.flatMap(step => {
    if (step.type === 'tool_call') return [activityEntry('tool', `Tool: ${step.toolName ?? 'unknown'}`, safeDetail(step.toolArgs))];
    if (step.type === 'thought') return [activityEntry('model', 'Model response')];
    return [];
  });
}

function safeDetail(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const fields = ['path', 'source', 'destination', 'command', 'provider', 'model'];
  const visible = fields.filter(key => typeof record[key] === 'string')
    .map(key => `${key}=${String(record[key]).slice(0, 160)}`);
  return visible.length > 0 ? visible.join(', ') : undefined;
}

export function formatActivity(entries: ActivityEntry[], limit = 40): string {
  const shown = entries.slice(-limit);
  if (shown.length === 0) return 'No observable activity recorded yet.';
  return shown.map(entry => {
    const time = new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const detail = entry.detail ? ` — ${entry.detail}` : '';
    return `${time} [${entry.kind}] ${entry.label}${detail}`;
  }).join('\n');
}
