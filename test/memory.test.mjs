import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addMemory, formatMemory, listMemory, searchMemory } from '../dist/core/memory.js';

test('project memory persists, filters, and formats explicit entries', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cude-memory-'));
  const previous = process.env.CUDE_MEMORY_FILE;
  process.env.CUDE_MEMORY_FILE = join(directory, 'memory.jsonl');
  try {
    addMemory('Run npm test before release', ['testing', 'release']);
    addMemory('Keep provider credentials local', ['security']);
    assert.equal(listMemory().length, 2);
    assert.equal(searchMemory('release').length, 1);
    assert.match(formatMemory(listMemory()), /Run npm test before release/);
  } finally {
    if (previous === undefined) delete process.env.CUDE_MEMORY_FILE;
    else process.env.CUDE_MEMORY_FILE = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
