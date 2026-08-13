import { readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';
import type { Message } from '../providers/types.js';
import type { ActivityEntry } from '../core/activity.js';

export interface Session {
  id: string;
  parentId?: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  provider: string;
  model: string;
  messages: Message[];
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  activity?: ActivityEntry[];
}

function getSessionsDir(): string {
  const dir = join(homedir(), '.cude', 'sessions');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getSessionPath(id: string): string {
  return join(getSessionsDir(), `${id}.json`);
}

export function createSession(name: string, provider: string, model: string): Session {
  const session: Session = {
    id: uuidv4(),
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    provider,
    model,
    messages: [],
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    activity: [],
  };
  saveSession(session);
  return session;
}

/** Create an independent branch while preserving the source conversation. */
export function forkSession(source: Session, name: string): Session {
  const fork: Session = {
    ...source,
    id: uuidv4(),
    parentId: source.id,
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: source.messages.map(message => ({ ...message })),
    activity: source.activity ? source.activity.map(entry => ({ ...entry })) : [],
  };
  saveSession(fork);
  return fork;
}

export function saveSession(session: Session): void {
  session.updatedAt = new Date().toISOString();
  writeFileSync(getSessionPath(session.id), JSON.stringify(session, null, 2), 'utf-8');
}

export function loadSession(id: string): Session | null {
  const path = getSessionPath(id);
  if (!existsSync(path)) return null;
  try {
    const data = readFileSync(path, 'utf-8');
    return JSON.parse(data) as Session;
  } catch {
    return null;
  }
}

export function findSessionByName(name: string): Session | null {
  const sessions = listSessions();
  return sessions.find(s => s.name === name) ?? null;
}

export function listSessions(): Session[] {
  const dir = getSessionsDir();
  try {
    const files = readdirSync(dir).filter(f => f.endsWith('.json'));
    const sessions: Session[] = [];
    for (const file of files) {
      try {
        const data = readFileSync(join(dir, file), 'utf-8');
        sessions.push(JSON.parse(data) as Session);
      } catch {
        // skip corrupted sessions
      }
    }
    return sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  } catch {
    return [];
  }
}

export function deleteSession(id: string): boolean {
  const path = getSessionPath(id);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

export function addMessageToSession(session: Session, message: Message): void {
  session.messages.push(message);
}

export function updateSessionCost(
  session: Session,
  cost: number,
  inputTokens: number,
  outputTokens: number
): void {
  session.totalCost += cost;
  session.totalInputTokens += inputTokens;
  session.totalOutputTokens += outputTokens;
}

export function addActivityToSession(session: Session, entry: ActivityEntry): void {
  if (!session.activity) session.activity = [];
  session.activity.push(entry);
}

export function exportSessionToMarkdown(session: Session): string {
  const lines: string[] = [
    `# Session: ${session.name}`,
    ``,
    `**ID:** ${session.id}`,
    `**Provider:** ${session.provider}`,
    `**Model:** ${session.model}`,
    `**Created:** ${format(new Date(session.createdAt), 'PPpp')}`,
    `**Updated:** ${format(new Date(session.updatedAt), 'PPpp')}`,
    `**Total Cost:** $${session.totalCost.toFixed(6)}`,
    `**Tokens:** ${session.totalInputTokens} in / ${session.totalOutputTokens} out`,
    ``,
    `---`,
    ``,
    `## Conversation`,
    ``,
  ];

  if (session.activity?.length) {
    lines.push('## Activity Summary', '', '```text');
    lines.push(...session.activity.map(entry => {
      const detail = entry.detail ? ` — ${entry.detail}` : '';
      return `[${entry.kind}] ${entry.label}${detail}`;
    }));
    lines.push('```', '', '---', '');
  }

  for (const msg of session.messages) {
    if (msg.role === 'system') continue;
    const role = msg.role === 'user' ? '**You**' : '**Assistant**';
    lines.push(`### ${role}`, ``, msg.content, ``, `---`, ``);
  }

  return lines.join('\n');
}
