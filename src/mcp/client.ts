import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';

/**
 * A minimal Model Context Protocol client.
 *
 * Written against the protocol rather than the official SDK because Cude ships
 * with no runtime dependency it does not need, and the client half of MCP is
 * four JSON-RPC calls: initialize, initialized, tools/list, tools/call.
 *
 * Two transports: stdio (a local server started as a child process, framed as
 * newline-delimited JSON) and HTTP (a single POST per request, accepting either
 * a JSON body or an SSE stream).
 */

export const PROTOCOL_VERSION = '2024-11-05';

export interface StdioServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface HttpServerConfig {
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = (StdioServerConfig | HttpServerConfig) & {
  /** Skip this server without removing its configuration. */
  disabled?: boolean;
  /** Per-request timeout in ms. */
  timeout?: number;
};

export function isHttpConfig(config: McpServerConfig): config is HttpServerConfig {
  return typeof (config as HttpServerConfig).url === 'string';
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const DEFAULT_TIMEOUT = 30_000;

export class McpClient {
  readonly name: string;
  private readonly config: McpServerConfig;
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private buffer = '';
  private started = false;
  private stderrTail: string[] = [];

  constructor(name: string, config: McpServerConfig) {
    this.name = name;
    this.config = config;
  }

  private get timeout(): number {
    return this.config.timeout ?? DEFAULT_TIMEOUT;
  }

  // ─── stdio plumbing ───────────────────────────────────────────────────────

  private startChild(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    const config = this.config as StdioServerConfig;

    // Windows needs a shell for the .cmd shims most MCP servers ship as (npx,
    // npm, uvx). With shell: true Node hands the strings to cmd.exe verbatim
    // and quotes nothing, so anything with a space — "C:\Program Files\..." —
    // has to be quoted here or cmd splits it.
    const useShell = process.platform === 'win32';
    const quote = (value: string): string =>
      useShell && /[^A-Za-z0-9_.:=\\/-]/.test(value) ? `"${value}"` : value;

    // Passing an args array alongside shell: true is deprecated (DEP0190)
    // precisely because nothing escapes it — so build the one command line.
    const args = config.args ?? [];
    const child = useShell
      ? spawn([quote(config.command), ...args.map(quote)].join(' '), [], {
          env: { ...process.env, ...(config.env ?? {}) },
          cwd: config.cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: true,
        })
      : spawn(config.command, args, {
          env: { ...process.env, ...(config.env ?? {}) },
          cwd: config.cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => this.consume(chunk));

    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk: string) => {
      // Servers log freely to stderr; keep only enough to explain a failure.
      this.stderrTail.push(chunk);
      if (this.stderrTail.length > 20) this.stderrTail.shift();
    });

    const fail = (err: Error) => {
      for (const [, waiter] of this.pending) {
        clearTimeout(waiter.timer);
        waiter.reject(err);
      }
      this.pending.clear();
      this.child = null;
      this.started = false;
    };

    child.on('error', err =>
      fail(new Error(`MCP server "${this.name}" could not be started: ${err.message}`))
    );
    child.on('exit', code =>
      fail(new Error(
        `MCP server "${this.name}" exited (code ${code})` +
        (this.stderrTail.length ? `: ${this.stderrTail.join('').trim().slice(-400)}` : '')
      ))
    );

    this.child = child;
    return child;
  }

  /** Newline-delimited JSON frames. */
  private consume(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf('\n');
    while (index !== -1) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) this.dispatch(line);
      index = this.buffer.indexOf('\n');
    }
  }

  private dispatch(line: string): void {
    let message: JsonRpcResponse;
    try {
      message = JSON.parse(line) as JsonRpcResponse;
    } catch {
      return; // Not a JSON-RPC frame — servers sometimes print banners.
    }
    if (typeof message.id !== 'number') return; // A notification from the server.

    const waiter = this.pending.get(message.id);
    if (!waiter) return;
    this.pending.delete(message.id);
    clearTimeout(waiter.timer);

    if (message.error) {
      waiter.reject(new Error(`${message.error.message} (code ${message.error.code})`));
    } else {
      waiter.resolve(message.result);
    }
  }

  // ─── request ──────────────────────────────────────────────────────────────

  private async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (isHttpConfig(this.config)) return this.httpRequest(method, params);

    const child = this.startChild();
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP server "${this.name}" did not answer ${method} within ${this.timeout}ms`));
      }, this.timeout);

      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(payload + '\n', err => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(new Error(`MCP server "${this.name}": ${err.message}`));
        }
      });
    });
  }

  private notify(method: string, params?: Record<string, unknown>): void {
    if (isHttpConfig(this.config)) {
      void this.httpRequest(method, params, true).catch(() => undefined);
      return;
    }
    const child = this.startChild();
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }) + '\n');
  }

  private async httpRequest(
    method: string,
    params?: Record<string, unknown>,
    isNotification = false
  ): Promise<unknown> {
    const config = this.config as HttpServerConfig;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...(config.headers ?? {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          ...(isNotification ? {} : { id: this.nextId++ }),
          method,
          ...(params ? { params } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`MCP server "${this.name}" returned ${response.status} ${response.statusText}`);
      }
      if (isNotification || response.status === 202) return undefined;

      const text = await response.text();
      if (!text.trim()) return undefined;

      // An SSE response carries the JSON-RPC message in a `data:` line.
      const body = text.includes('data:')
        ? (text.split('\n').find(l => l.startsWith('data:'))?.slice(5).trim() ?? text)
        : text;

      const message = JSON.parse(body) as JsonRpcResponse;
      if (message.error) {
        throw new Error(`${message.error.message} (code ${message.error.code})`);
      }
      return message.result;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`MCP server "${this.name}" did not answer ${method} within ${this.timeout}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // ─── protocol ─────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.started) return;
    await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      clientInfo: { name: 'cude-code', version: '0.1.0' },
    });
    this.notify('notifications/initialized');
    this.started = true;
  }

  async listTools(): Promise<McpToolInfo[]> {
    await this.connect();
    const result = (await this.request('tools/list')) as { tools?: McpToolInfo[] } | undefined;
    return result?.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    await this.connect();
    const result = (await this.request('tools/call', { name, arguments: args })) as
      | { content?: Array<{ type: string; text?: string; [k: string]: unknown }>; isError?: boolean }
      | undefined;

    const blocks = result?.content ?? [];
    const text = blocks
      .map(block => {
        if (block.type === 'text') return block.text ?? '';
        // Keep non-text blocks legible rather than dropping them.
        return `[${block.type}]`;
      })
      .join('\n')
      .trim();

    return { text: text || '(no content)', isError: result?.isError === true };
  }

  async close(): Promise<void> {
    for (const [, waiter] of this.pending) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`MCP server "${this.name}" was closed`));
    }
    this.pending.clear();
    this.started = false;

    const child = this.child;
    this.child = null;
    if (!child) return;

    child.stdin.end();
    child.kill();
    // Do not let a server that ignores SIGTERM hold the CLI open.
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 1000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
