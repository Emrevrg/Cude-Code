import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { formatProjectContext, loadProjectContext } from '../dist/core/context.js';

test('loads parent and child project instructions in scope order', () => {
  const root = mkdtempSync(join(tmpdir(), 'cude-context-'));
  const child = join(root, 'src');
  mkdirSync(child);
  writeFileSync(join(root, 'AGENTS.md'), 'root rules');
  writeFileSync(join(child, 'CLAUDE.md'), 'child rules');
  try {
    const files = loadProjectContext(child);
    assert.deepEqual(files.map(file => file.content), ['root rules', 'child rules']);
    assert.match(formatProjectContext(files), /Project instructions:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AGENTS.override.md replaces AGENTS.md in the same directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'cude-context-'));
  writeFileSync(join(root, 'AGENTS.md'), 'old rules');
  writeFileSync(join(root, 'AGENTS.override.md'), 'override rules');
  try {
    assert.deepEqual(loadProjectContext(root).map(file => file.content), ['override rules']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
