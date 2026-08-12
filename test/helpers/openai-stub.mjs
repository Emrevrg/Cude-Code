// A local OpenAI-compatible chat-completions server with scripted replies.
//
// The agent loop was previously untestable without a real API key, which is how
// F1 (always reports success) and F2 (tool results sent outside the tool-call
// protocol) both shipped. Point the vLLM or LiteLLM provider at `server.url`
// and the whole loop runs offline.
//
// Every request body is recorded in `server.requests`, so tests can assert on
// what actually went over the wire — the message roles, the `tool_calls` the
// assistant carried, and the `tool_call_id` each result was keyed by.

import { createServer } from 'node:http';

/**
 * @param {object} spec               `{ content?: string, toolCalls?: [{ name, arguments }] }`
 * @returns an OpenAI chat-completion response body
 */
function toCompletion(spec) {
  const content = spec?.content ?? '';
  const toolCalls = (spec?.toolCalls ?? []).map((tc, i) => ({
    id: tc.id ?? `call_${i}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'function',
    function: {
      name: tc.name,
      arguments: JSON.stringify(tc.arguments ?? {}),
    },
  }));

  return {
    id: 'chatcmpl-stub',
    object: 'chat.completion',
    model: 'stub-model',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

/**
 * @param {object[]|function} script  Either a list of reply specs consumed in
 *   order (the last one repeats forever), or `(requestBody, turnIndex) => spec`.
 */
export async function startStubServer(script) {
  const requests = [];
  let turn = 0;

  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');

      // GET /v1/models — the availability probe.
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'stub-model', object: 'model' }] }));
        return;
      }

      let body = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = { _unparseable: raw };
      }
      requests.push({ url: req.url, body, headers: req.headers });

      const index = turn++;
      const spec = typeof script === 'function'
        ? script(body, index)
        : script[Math.min(index, script.length - 1)];

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(toCompletion(spec)));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    get turns() {
      return turn;
    },
    /** Message arrays as they were actually sent, request by request. */
    sentMessages() {
      return requests.filter((r) => r.body?.messages).map((r) => r.body.messages);
    },
    async close() {
      // fetch keeps connections alive; without this close() never resolves.
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
