import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getDataDir } from '../config/index.js';
import { McpClient, type McpServerConfig } from './client.js';
import type { ToolDefinition } from '../providers/types.js';

/**
 * Configured MCP servers, and the tools they contribute to the agent.
 *
 * Tool names are namespaced `mcp__<server>__<tool>` so a server cannot shadow a
 * built-in tool, and so the model can see which server a capability came from.
 */

export const MCP_PREFIX = 'mcp__';
/** Between server and tool. A server name may therefore not contain `__`. */
const SEPARATOR = '__';

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export function getMcpConfigPath(): string {
  return join(getDataDir(), 'mcp.json');
}

export function loadMcpConfig(): McpConfig {
  const path = getMcpConfigPath();
  if (!existsSync(path)) return { mcpServers: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<McpConfig>;
    return { mcpServers: parsed.mcpServers ?? {} };
  } catch (err) {
    throw new Error(
      `${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export function saveMcpConfig(config: McpConfig): void {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getMcpConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}

export function qualifyToolName(server: string, tool: string): string {
  return `${MCP_PREFIX}${server}${SEPARATOR}${tool}`;
}

export function parseToolName(qualified: string): { server: string; tool: string } | null {
  if (!qualified.startsWith(MCP_PREFIX)) return null;
  const rest = qualified.slice(MCP_PREFIX.length);
  const separator = rest.indexOf(SEPARATOR);
  if (separator === -1) return null;
  return {
    server: rest.slice(0, separator),
    tool: rest.slice(separator + SEPARATOR.length),
  };
}

export function isMcpTool(name: string): boolean {
  return name.startsWith(MCP_PREFIX);
}

// ─── live state ─────────────────────────────────────────────────────────────

const clients = new Map<string, McpClient>();
let toolDefinitions: ToolDefinition[] = [];
let initialized = false;

export interface McpInitResult {
  connected: string[];
  failed: Array<{ server: string; reason: string }>;
  tools: ToolDefinition[];
}

/**
 * Connects every enabled server and collects their tools. Servers are
 * independent: one that fails to start is reported and skipped rather than
 * taking the run down with it.
 */
export async function initializeMcp(): Promise<McpInitResult> {
  if (initialized) {
    return { connected: [...clients.keys()], failed: [], tools: toolDefinitions };
  }
  initialized = true;

  let config: McpConfig;
  try {
    config = loadMcpConfig();
  } catch (err) {
    return { connected: [], failed: [{ server: 'mcp.json', reason: String(err) }], tools: [] };
  }

  const entries = Object.entries(config.mcpServers).filter(([, c]) => !c.disabled);
  const connected: string[] = [];
  const failed: McpInitResult['failed'] = [];
  const definitions: ToolDefinition[] = [];

  const results = await Promise.all(
    entries.map(async ([name, serverConfig]) => {
      const client = new McpClient(name, serverConfig);
      try {
        const tools = await client.listTools();
        return { name, client, tools, error: null as string | null };
      } catch (err) {
        await client.close().catch(() => undefined);
        return {
          name,
          client: null,
          tools: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    })
  );

  for (const result of results) {
    if (result.error || !result.client) {
      failed.push({ server: result.name, reason: result.error ?? 'unknown error' });
      continue;
    }
    clients.set(result.name, result.client);
    connected.push(result.name);

    for (const tool of result.tools) {
      definitions.push({
        name: qualifyToolName(result.name, tool.name),
        description: `[${result.name}] ${tool.description ?? tool.name}`,
        parameters: (tool.inputSchema as Record<string, unknown>) ?? { properties: {} },
      });
    }
  }

  toolDefinitions = definitions;
  return { connected, failed, tools: definitions };
}

export function getMcpToolDefinitions(): ToolDefinition[] {
  return toolDefinitions;
}

export async function executeMcpTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ success: boolean; output: string; error?: string }> {
  const parsed = parseToolName(name);
  if (!parsed) {
    return { success: false, output: '', error: `Not an MCP tool name: ${name}` };
  }

  const client = clients.get(parsed.server);
  if (!client) {
    const known = [...clients.keys()];
    return {
      success: false,
      output: '',
      error:
        `MCP server "${parsed.server}" is not connected.` +
        (known.length ? ` Connected: ${known.join(', ')}.` : ' No MCP servers are connected.'),
    };
  }

  try {
    const result = await client.callTool(parsed.tool, args);
    if (result.isError) {
      return { success: false, output: '', error: result.text };
    }
    return { success: true, output: result.text };
  } catch (err) {
    return {
      success: false,
      output: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Stops every server. Without this a stdio child keeps the CLI alive. */
export async function shutdownMcp(): Promise<void> {
  await Promise.all([...clients.values()].map(c => c.close().catch(() => undefined)));
  clients.clear();
  toolDefinitions = [];
  initialized = false;
}

/** Test hook: forget cached connection state without touching disk. */
export function resetMcpState(): void {
  clients.clear();
  toolDefinitions = [];
  initialized = false;
}
