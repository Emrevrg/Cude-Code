import { existsSync, readFileSync } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

const execAsync = promisify(exec);

export type HookEvent = 'session_start' | 'pre_tool_use' | 'post_tool_use' | 'session_end';

export interface HookDefinition {
  command: string;
  timeoutMs?: number;
  allowFailure?: boolean;
}

interface HookConfig {
  hooks?: Partial<Record<HookEvent, HookDefinition[]>>;
}

export interface HookPayload {
  task?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolSuccess?: boolean;
  toolOutput?: string;
}

export interface HookRunResult {
  ok: boolean;
  blocked: boolean;
  output: string;
}

function configPath(): string {
  return process.env.CUDE_HOOKS_FILE ?? join(process.cwd(), '.cude', 'hooks.json');
}

export function loadHooks(): Partial<Record<HookEvent, HookDefinition[]>> {
  const path = configPath();
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as HookConfig;
    return parsed.hooks ?? {};
  } catch {
    return {};
  }
}

export async function runHooks(event: HookEvent, payload: HookPayload = {}): Promise<HookRunResult> {
  const definitions = loadHooks()[event] ?? [];
  const output: string[] = [];
  for (const hook of definitions) {
    if (!hook.command?.trim()) continue;
    const env = {
      ...process.env,
      CUDE_HOOK_EVENT: event,
      CUDE_TASK: payload.task ?? '',
      CUDE_TOOL_NAME: payload.toolName ?? '',
      CUDE_TOOL_ARGS: JSON.stringify(payload.toolArgs ?? {}),
      CUDE_TOOL_SUCCESS: String(payload.toolSuccess ?? ''),
      CUDE_TOOL_OUTPUT: payload.toolOutput ?? '',
    };
    try {
      const result = await execAsync(hook.command, {
        cwd: process.cwd(),
        env,
        windowsHide: true,
        timeout: hook.timeoutMs ?? 15_000,
        maxBuffer: 256 * 1024,
      });
      if (result.stdout.trim()) output.push(result.stdout.trim());
      if (result.stderr.trim()) output.push(result.stderr.trim());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.push(message);
      if (!hook.allowFailure && event === 'pre_tool_use') {
        return { ok: false, blocked: true, output: output.join('\n') };
      }
    }
  }
  return { ok: true, blocked: false, output: output.join('\n') };
}
