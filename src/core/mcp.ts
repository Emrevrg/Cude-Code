import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { ToolDefinition } from '../providers/types.js';
import type { ToolResult } from './tools.js';

interface McpServerConfig { command: string; args?: string[]; env?: Record<string, string>; }
interface McpConfig { servers?: Record<string, McpServerConfig>; }
interface McpTool { name: string; description?: string; inputSchema?: Record<string, unknown>; }
export interface DiscoveredMcpTool extends ToolDefinition { mcpServer: string; mcpName: string; }

function configPath(): string { return process.env.CUDE_MCP_FILE ?? join(process.cwd(), '.cude', 'mcp.json'); }
function loadServers(): Record<string, McpServerConfig> {
  if (!existsSync(configPath())) return {};
  try { return (JSON.parse(readFileSync(configPath(), 'utf8')) as McpConfig).servers ?? {}; } catch { return {}; }
}

async function request(server: McpServerConfig, method: string, params: Record<string, unknown> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn(server.command, server.args ?? [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, ...(server.env ?? {}) } });
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(() => { child.kill(); reject(new Error(`MCP request timed out: ${method}`)); }, 15_000);
    const finish = (error?: Error, value?: any) => { clearTimeout(timer); child.kill(); error ? reject(error) : resolve(value); };
    child.on('error', error => finish(error));
    child.stdout.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd < 0) return;
        const header = buffer.subarray(0, headerEnd).toString();
        const length = Number(header.match(/Content-Length:\s*(\d+)/i)?.[1]);
        if (!Number.isFinite(length) || buffer.length < headerEnd + 4 + length) return;
        const body = buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString();
        buffer = buffer.subarray(headerEnd + 4 + length);
        try {
          const message = JSON.parse(body) as { id?: number; result?: unknown; error?: { message?: string } };
          if (message.id === 2) finish(message.error ? new Error(message.error.message ?? 'MCP error') : undefined, message.result);
        } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
      }
    });
    const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cude-code', version: '0.2.0' } } });
    child.stdin.write(`Content-Length: ${Buffer.byteLength(init)}\r\n\r\n${init}`);
    child.stdin.write(`Content-Length: ${Buffer.byteLength(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }))}\r\n\r\n${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}`);
    const body = JSON.stringify({ jsonrpc: '2.0', id: 2, method, params });
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  });
}

async function callServer(server: McpServerConfig, method: string, params: Record<string, unknown>): Promise<any> {
  // request() sends the initialization handshake and the requested call in one process.
  return request(server, method, params);
}

export async function discoverMcpTools(): Promise<DiscoveredMcpTool[]> {
  const tools: DiscoveredMcpTool[] = [];
  for (const [serverName, server] of Object.entries(loadServers())) {
    try {
      const result = await callServer(server, 'tools/list', {}) as { tools?: McpTool[] };
      for (const tool of result.tools ?? []) {
        tools.push({ name: `mcp__${serverName}__${tool.name}`, description: tool.description ?? `MCP tool ${tool.name}`, parameters: tool.inputSchema ?? { type: 'object', properties: {} }, mcpServer: serverName, mcpName: tool.name });
      }
    } catch { /* doctor/agent remain usable when an optional server is offline */ }
  }
  return tools;
}

export async function callMcpTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const match = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(name);
  if (!match) return { success: false, output: '', error: `Invalid MCP tool name: ${name}` };
  const serverName = match[1];
  const toolName = match[2];
  const server = loadServers()[serverName];
  if (!server) return { success: false, output: '', error: `MCP server not configured: ${serverName}` };
  try {
    const result = await callServer(server, 'tools/call', { name: toolName, arguments: args }) as { content?: Array<{ text?: string }>; isError?: boolean };
    const output = (result.content ?? []).map(item => item.text ?? '').join('\n');
    return { success: !result.isError, output, error: result.isError ? output : undefined };
  } catch (error) { return { success: false, output: '', error: error instanceof Error ? error.message : String(error) }; }
}
