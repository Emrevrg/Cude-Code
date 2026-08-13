import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultLspForFile } from '../dist/core/lsp.js';

test('LSP defaults are explicit and language-aware', () => {
  assert.deepEqual(defaultLspForFile('src/index.ts'), { command: 'typescript-language-server', args: ['--stdio'] });
  assert.deepEqual(defaultLspForFile('main.rs'), { command: 'rust-analyzer', args: [] });
  assert.equal(defaultLspForFile('README.md'), null);
});
