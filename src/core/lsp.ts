import { readFileSync } from 'fs';
import { spawn } from 'child_process';
import { extname, resolve } from 'path';
import { pathToFileURL } from 'url';

export interface LspDiagnostic { message: string; severity?: number; source?: string; line?: number; column?: number; }
export interface LspOptions { command: string; args?: string[]; timeoutMs?: number; }

const defaults: Record<string, LspOptions> = {
  '.ts': { command: 'typescript-language-server', args: ['--stdio'] },
  '.tsx': { command: 'typescript-language-server', args: ['--stdio'] },
  '.js': { command: 'typescript-language-server', args: ['--stdio'] },
  '.jsx': { command: 'typescript-language-server', args: ['--stdio'] },
  '.py': { command: 'pyright-langserver', args: ['--stdio'] },
  '.rs': { command: 'rust-analyzer', args: [] },
  '.go': { command: 'gopls', args: ['serve'] },
};

export function defaultLspForFile(file: string): LspOptions | null { return defaults[extname(file).toLowerCase()] ?? null; }

export async function getDiagnostics(file: string, options: LspOptions): Promise<LspDiagnostic[]> {
  const absolute = resolve(file);
  const text = readFileSync(absolute, 'utf8');
  const uri = pathToFileURL(absolute).toString();
  const child = spawn(options.command, options.args ?? [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let buffer = Buffer.alloc(0);
  let settled = false;
  const diagnostics: LspDiagnostic[] = [];
  return await new Promise<LspDiagnostic[]>((resolvePromise, reject) => {
    const timer = setTimeout(() => finish(new Error(`LSP server timed out: ${options.command}`)), options.timeoutMs ?? 15_000);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch { /* already exited */ }
      if (error) reject(error); else resolvePromise(diagnostics);
    };
    child.once('error', error => finish(new Error(`Unable to start LSP server ${options.command}: ${error.message}`)));
    child.stdout.on('data', chunk => {
      buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
      while (true) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd < 0) break;
        const match = /Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, headerEnd).toString('ascii'));
        if (!match) { buffer = buffer.subarray(headerEnd + 4); continue; }
        const length = Number(match[1]);
        const start = headerEnd + 4;
        if (buffer.length < start + length) break;
        const body = buffer.subarray(start, start + length).toString('utf8');
        buffer = buffer.subarray(start + length);
        try {
          const message = JSON.parse(body) as { method?: string; params?: { diagnostics?: Array<Record<string, unknown>> } };
          if (message.method === 'textDocument/publishDiagnostics' && message.params?.diagnostics) {
            for (const item of message.params.diagnostics) diagnostics.push(normalizeDiagnostic(item));
            send(child, { jsonrpc: '2.0', id: 3, method: 'shutdown', params: null });
            send(child, { jsonrpc: '2.0', method: 'exit', params: null });
            finish();
          }
        } catch { /* ignore malformed server output */ }
      }
    });
    send(child, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: process.pid, rootUri: pathToFileURL(process.cwd()).toString(), capabilities: {}, clientInfo: { name: 'cude-code', version: '0.1.0' } } });
    send(child, { jsonrpc: '2.0', method: 'initialized', params: {} });
    send(child, { jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: languageIdFor(file), version: 1, text } } });
  });
}

function send(child: ReturnType<typeof spawn>, message: Record<string, unknown>): void {
  const body = JSON.stringify(message);
  if (!child.stdin) throw new Error('LSP server stdin is unavailable');
  child.stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
}
function normalizeDiagnostic(item: Record<string, unknown>): LspDiagnostic {
  const range = item.range as { start?: { line?: number; character?: number } } | undefined;
  return { message: String(item.message ?? 'Unknown diagnostic'), severity: typeof item.severity === 'number' ? item.severity : undefined, source: typeof item.source === 'string' ? item.source : undefined, line: typeof range?.start?.line === 'number' ? range.start.line + 1 : undefined, column: typeof range?.start?.character === 'number' ? range.start.character + 1 : undefined };
}
function languageIdFor(file: string): string {
  return ({ '.ts': 'typescript', '.tsx': 'typescriptreact', '.js': 'javascript', '.jsx': 'javascriptreact', '.py': 'python', '.rs': 'rust', '.go': 'go' } as Record<string, string>)[extname(file).toLowerCase()] ?? 'plaintext';
}
