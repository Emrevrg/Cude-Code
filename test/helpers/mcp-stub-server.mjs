#!/usr/bin/env node
// A minimal MCP server over stdio, used to test the client against the actual
// protocol rather than a mock of it. Speaks newline-delimited JSON-RPC.
//
// Tools: `echo` (returns what it was given) and `explode` (returns isError).

import { createInterface } from 'node:readline';

const TOOLS = [
  {
    name: 'echo',
    description: 'Return the message it was given',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string', description: 'Text to echo' } },
      required: ['message'],
    },
  },
  {
    name: 'explode',
    description: 'Always fails, for testing error propagation',
    inputSchema: { type: 'object', properties: {} },
  },
];

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

const rl = createInterface({ input: process.stdin });

rl.on('line', (line) => {
  const text = line.trim();
  if (!text) return;

  let request;
  try {
    request = JSON.parse(text);
  } catch {
    return;
  }

  // Notifications carry no id and expect no reply.
  if (request.id === undefined) return;

  const reply = (result) => send({ jsonrpc: '2.0', id: request.id, result });
  const fail = (code, message) => send({ jsonrpc: '2.0', id: request.id, error: { code, message } });

  switch (request.method) {
    case 'initialize':
      reply({
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'cude-test-server', version: '1.0.0' },
      });
      return;

    case 'tools/list':
      reply({ tools: TOOLS });
      return;

    case 'tools/call': {
      const { name, arguments: args = {} } = request.params ?? {};
      if (name === 'echo') {
        reply({ content: [{ type: 'text', text: `echo: ${args.message ?? ''}` }] });
        return;
      }
      if (name === 'explode') {
        reply({ content: [{ type: 'text', text: 'the tool refused' }], isError: true });
        return;
      }
      fail(-32602, `Unknown tool: ${name}`);
      return;
    }

    default:
      fail(-32601, `Method not found: ${request.method}`);
  }
});
