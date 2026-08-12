// MCP client and registry.
//
// Driven against test/helpers/mcp-stub-server.mjs, a real stdio MCP server, so
// these exercise the protocol rather than a mock of it.

import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startStubServer } from './helpers/openai-stub.mjs';

const home = mkdtempSync(join(tmpdir(), 'cude-home-'));
process.env.CUDE_HOME = home;

const { McpClient } = await import('../dist/mcp/client.js');
const {
  loadMcpConfig,
  saveMcpConfig,
  initializeMcp,
  shutdownMcp,
  resetMcpState,
  executeMcpTool,
  qualifyToolName,
  parseToolName,
  isMcpTool,
  getMcpToolDefinitions,
} = await import('../dist/mcp/registry.js');
const { executeTool } = await import('../dist/core/tools.js');
const { getMode, toolsForMode, isToolAllowed } = await import('../dist/core/modes.js');
const { runAgent } = await import('../dist/core/agent.js');
const { setApiKey } = await import('../dist/config/index.js');

const STUB_SERVER = fileURLToPath(new URL('./helpers/mcp-stub-server.mjs', import.meta.url));
const stdioConfig = { command: process.execPath, args: [STUB_SERVER] };

after(() => rmSync(home, { recursive: true, force: true }));
beforeEach(async () => {
  await shutdownMcp();
  resetMcpState();
});

describe('MCP client speaks the protocol', () => {
  test('lists the tools a server offers', async () => {
    const client = new McpClient('test', stdioConfig);
    try {
      const tools = await client.listTools();
      assert.deepEqual(tools.map(t => t.name).sort(), ['echo', 'explode']);
      assert.equal(tools.find(t => t.name === 'echo').inputSchema.required[0], 'message');
    } finally {
      await client.close();
    }
  });

  test('calls a tool and returns its text content', async () => {
    const client = new McpClient('test', stdioConfig);
    try {
      const result = await client.callTool('echo', { message: 'hello' });
      assert.equal(result.text, 'echo: hello');
      assert.equal(result.isError, false);
    } finally {
      await client.close();
    }
  });

  test('a tool that reports isError is surfaced as a failure', async () => {
    const client = new McpClient('test', stdioConfig);
    try {
      const result = await client.callTool('explode', {});
      assert.equal(result.isError, true);
      assert.match(result.text, /refused/);
    } finally {
      await client.close();
    }
  });

  test('a JSON-RPC error becomes a thrown error, not a silent empty result', async () => {
    const client = new McpClient('test', stdioConfig);
    try {
      await assert.rejects(() => client.callTool('no_such_tool', {}), /Unknown tool/);
    } finally {
      await client.close();
    }
  });

  test('a server that cannot start reports why', async () => {
    const client = new McpClient('broken', { command: 'definitely-not-a-real-binary-xyz' });
    try {
      await assert.rejects(() => client.listTools(), /broken/);
    } finally {
      await client.close();
    }
  });

  test('a server that never answers times out rather than hanging', async () => {
    // `node -e ""` exits immediately without speaking the protocol.
    const client = new McpClient('silent', { command: process.execPath, args: ['-e', 'setTimeout(()=>{},5000)'], timeout: 300 });
    try {
      await assert.rejects(() => client.listTools(), /within 300ms/);
    } finally {
      await client.close();
    }
  });
});

describe('MCP registry namespaces and dispatches tools', () => {
  test('tool names are namespaced so a server cannot shadow a built-in', () => {
    const qualified = qualifyToolName('files', 'read_file');
    assert.notEqual(qualified, 'read_file');
    assert.equal(isMcpTool(qualified), true);
    assert.equal(isMcpTool('read_file'), false);
    assert.deepEqual(parseToolName(qualified), { server: 'files', tool: 'read_file' });
  });

  test('configured servers contribute tools to the agent', async () => {
    saveMcpConfig({ mcpServers: { probe: stdioConfig } });
    const result = await initializeMcp();

    assert.deepEqual(result.connected, ['probe']);
    assert.deepEqual(result.failed, []);
    assert.ok(result.tools.some(t => t.name === 'mcp__probe__echo'));
    assert.ok(
      result.tools.find(t => t.name === 'mcp__probe__echo').description.includes('probe'),
      'the description should name the server it came from'
    );
  });

  test('executeTool routes a namespaced call to the right server', async () => {
    saveMcpConfig({ mcpServers: { probe: stdioConfig } });
    await initializeMcp();

    const result = await executeTool('mcp__probe__echo', { message: 'through the dispatcher' });
    assert.equal(result.success, true);
    assert.match(result.output, /through the dispatcher/);
  });

  test('a failing MCP tool comes back as a tool failure, not a crash', async () => {
    saveMcpConfig({ mcpServers: { probe: stdioConfig } });
    await initializeMcp();

    const result = await executeTool('mcp__probe__explode', {});
    assert.equal(result.success, false);
    assert.match(result.error, /refused/);
  });

  test('one broken server does not stop the others', async () => {
    saveMcpConfig({
      mcpServers: {
        good: stdioConfig,
        bad: { command: 'definitely-not-a-real-binary-xyz' },
      },
    });
    const result = await initializeMcp();

    assert.deepEqual(result.connected, ['good']);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].server, 'bad');
    assert.ok(result.tools.some(t => t.name === 'mcp__good__echo'), 'the working server still contributed');
  });

  test('a disabled server is skipped', async () => {
    saveMcpConfig({ mcpServers: { probe: { ...stdioConfig, disabled: true } } });
    const result = await initializeMcp();
    assert.deepEqual(result.connected, []);
    assert.deepEqual(result.tools, []);
  });

  test('an unconfigured MCP tool call explains itself', async () => {
    const result = await executeMcpTool('mcp__ghost__thing', {});
    assert.equal(result.success, false);
    assert.match(result.error, /not connected/);
  });

  test('malformed mcp.json is reported, not swallowed', () => {
    writeFileSync(join(home, 'mcp.json'), '{ not json');
    assert.throws(() => loadMcpConfig(), /not valid JSON/);
    saveMcpConfig({ mcpServers: {} });
  });
});

describe('MCP tools respect mode budgets', () => {
  test('read-only modes are not handed arbitrary external tools', async () => {
    saveMcpConfig({ mcpServers: { probe: stdioConfig } });
    await initializeMcp();

    const ask = getMode('ask');
    const code = getMode('code');

    assert.equal(isToolAllowed(ask, 'mcp__probe__echo'), false, 'ask mode must not expose MCP tools');
    assert.equal(isToolAllowed(code, 'mcp__probe__echo'), true);
    assert.ok(!toolsForMode(ask).some(t => t.name.startsWith('mcp__')));
    assert.ok(toolsForMode(code).some(t => t.name.startsWith('mcp__')));
  });

  test('the agent offers MCP tools to the model and can call them', async () => {
    saveMcpConfig({ mcpServers: { probe: stdioConfig } });

    const server = await startStubServer([
      { content: 'using the server', toolCalls: [{ name: 'mcp__probe__echo', arguments: { message: 'from the agent' } }] },
      { content: 'TASK COMPLETE: used an MCP tool' },
    ]);

    try {
      setApiKey('vllm-endpoint', server.url);
      const result = await runAgent({ task: 'use the echo tool', provider: 'vllm', model: 'stub', maxIterations: 3 });

      assert.equal(result.success, true);

      const offered = server.requests[0].body.tools.map(t => t.function.name);
      assert.ok(offered.includes('mcp__probe__echo'), 'the MCP tool was not offered to the model');

      const toolMessage = server.sentMessages()[1].find(m => m.role === 'tool');
      assert.match(toolMessage.content, /echo: from the agent/);
    } finally {
      await server.close();
    }
  });

  test('MCP servers are shut down when the run ends', async () => {
    saveMcpConfig({ mcpServers: { probe: stdioConfig } });
    const server = await startStubServer([{ content: 'TASK COMPLETE: nothing to do' }]);
    try {
      setApiKey('vllm-endpoint', server.url);
      await runAgent({ task: 'do nothing', provider: 'vllm', model: 'stub', maxIterations: 2 });
      // A leaked stdio child would keep the process alive after the test file
      // finishes; the registry must have released them.
      assert.deepEqual(getMcpToolDefinitions(), []);
    } finally {
      await server.close();
    }
  });
});
