import { readFileSync, readdirSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';
import { getDataDir } from '../config/index.js';
import type { Message } from '../providers/types.js';
import { hardenDirectory, redactSecrets, writeSecureFile } from '../core/security.js';

export interface Session {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  provider: string;
  model: string;
  messages: Message[];
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

function getSessionsDir(): string {
  // getDataDir() rather than a hardcoded ~/.cude: CUDE_HOME redirects
  // everything else Cude persists, and sessions were the one store that
  // ignored it and wrote to the real home directory even under test.
  const dir = join(getDataDir(), 'sessions');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  // A session file is a full transcript of work on this machine, written to a
  // world-readable path by default. Narrow it to the owner.
  hardenDirectory(dir);
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
  };
  saveSession(session);
  return session;
}

export function saveSession(session: Session): void {
  session.updatedAt = new Date().toISOString();
  // A transcript that quotes a key is a credential store nobody thinks of as
  // one — and it outlives the run. Redact on the way to disk; the model has
  // already seen the redacted form anyway, since tool output is cleaned before
  // it is ever sent.
  const serialized = JSON.stringify(session, null, 2);
  writeSecureFile(getSessionPath(session.id), redactSecrets(serialized).text);
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

  for (const msg of session.messages) {
    if (msg.role === 'system') continue;
    const role = msg.role === 'user' ? '**You**' : '**Assistant**';
    lines.push(`### ${role}`, ``, msg.content, ``, `---`, ``);
  }

  return lines.join('\n');
}
