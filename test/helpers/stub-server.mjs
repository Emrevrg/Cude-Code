// A tiny OpenAI-compatible HTTP server for agent tests.
//
// Tests script its behaviour by passing an array of "turns": each turn is
// either a plain string (a final assistant message with no tool calls) or an
// object `{ content, tool_calls }` whose `tool_calls` follow the OpenAI wire
// shape (`[{ id, function: { name, arguments } }]`). The server records every
// inbound `/v1/chat/completions` body on `server.requests` so tests can assert
// on the shape of the conversation (tool messages, consecutive assistants, etc).

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

export function startStubServer(turns) {
  const requests = [];
  let turnIndex = 0;

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let parsed = null;
      try { parsed = JSON.parse(body || '{}'); } catch { parsed = {}; }
      requests.push({ url: req.url, body: parsed });

      const turn = turns[Math.min(turnIndex, turns.length - 1)];
      turnIndex++;

      // If the last turn is reached, repeat it forever (so a "never finishes"
      // agent keeps getting tool calls until max_iterations).
      const message = typeof turn === 'string'
        ? { role: 'assistant', content: turn }
        : {
            role: 'assistant',
            content: turn.content ?? '',
            ...(turn.tool_calls ? { tool_calls: turn.tool_calls.map((tc) => ({
              id: tc.id ?? `call_${randomBytes(4).toString('hex')}`,
              type: 'function',
              function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
            })) } : {}),
          };

      const payload = {
        id: `chatcmpl-${randomBytes(6).toString('hex')}`,
        object: 'chat.completion',
        choices: [{ index: 0, message, finish_reason: turn.tool_calls ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        server,
        requests,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

// Returns the list of message roles in request order for the last POST.
export function rolesOf(request) {
  return request.body.messages.map((m) => m.role);
}

// True if the request body ever contains two adjacent assistant messages.
export function hasConsecutiveAssistants(request) {
  const roles = rolesOf(request);
  for (let i = 1; i < roles.length; i++) {
    if (roles[i] === 'assistant' && roles[i - 1] === 'assistant') return true;
  }
  return false;
}
