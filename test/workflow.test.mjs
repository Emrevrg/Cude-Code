import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCLI } from '../dist/cli.js';

test('slogan workflow commands are exposed as first-class CLI commands', () => {
  const names = createCLI().commands.map(command => command.name());
  assert.ok(names.includes('write'));
  assert.ok(names.includes('understand'));
  assert.ok(names.includes('produce'));
});
