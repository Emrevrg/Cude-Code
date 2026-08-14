import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverMcpTools, callMcpTool } from '../dist/core/mcp.js';

test('MCP discovery is optional and truthful when no servers are configured', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cude-mcp-'));
  const previous = process.env.CUDE_MCP_FILE;
  const config = join(directory, 'mcp.json');
  process.env.CUDE_MCP_FILE = config;
  writeFileSync(config, JSON.stringify({ servers: {} }));
  try {
    assert.deepEqual(await discoverMcpTools(), []);
    const result = await callMcpTool('mcp__missing__tool', {});
    assert.equal(result.success, false);
    assert.match(result.error, /not configured/);
  } finally {
    if (previous === undefined) delete process.env.CUDE_MCP_FILE;
    else process.env.CUDE_MCP_FILE = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
