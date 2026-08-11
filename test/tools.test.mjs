// Exercises every registered tool against real files, a real git repository
// and — when Chromium is present — a real browser.
//
// Each `regression:` test below corresponds to a bug that actually shipped.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { executeTool, TOOL_DEFINITIONS } = await import('../dist/core/tools.js');

let dir;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'cude-test-'));
});

after(() => rmSync(dir, { recursive: true, force: true }));

const ok = async (name, args) => {
  const res = await executeTool(name, args);
  assert.ok(res.success, `${name} failed: ${res.error}`);
  return res;
};

/** Chromium is a separate ~150MB download, so browser tests skip without it. */
async function chromiumAvailable() {
  try {
    const { chromium } = await import('playwright');
    const b = await chromium.launch({ headless: true });
    await b.close();
    return true;
  } catch {
    return false;
  }
}

describe('tool registry', () => {
  test('every tool has a name, description and parameters', () => {
    assert.ok(TOOL_DEFINITIONS.length > 0);
    const seen = new Set();
    for (const def of TOOL_DEFINITIONS) {
      assert.ok(def.name, 'tool without a name');
      assert.ok(def.description, `${def.name}: missing description`);
      assert.ok(def.parameters?.properties, `${def.name}: missing parameter schema`);
      assert.ok(!seen.has(def.name), `${def.name}: duplicate tool name`);
      seen.add(def.name);
    }
  });

  test('every required parameter is declared in properties', () => {
    // A required name that isn't in properties can never be satisfied.
    for (const def of TOOL_DEFINITIONS) {
      for (const key of def.parameters.required ?? []) {
        assert.ok(
          key in def.parameters.properties,
          `${def.name}: '${key}' is required but not described in properties`
        );
      }
    }
  });

  test('an unknown tool name is reported, not thrown', async () => {
    const res = await executeTool('no_such_tool', {});
    assert.equal(res.success, false);
    assert.match(res.error, /unknown tool/i);
  });
});

describe('file operations', () => {
  test('write, read, replace and inspect a file', async () => {
    const f = join(dir, 'a.txt');
    await ok('write_file', { path: f, content: 'hello\nworld\n' });
    const read = await ok('read_file', { path: f });
    assert.match(read.output, /hello/);
    await ok('replace_in_file', { path: f, old_text: 'world', new_text: 'cude' });
    assert.match((await ok('read_file', { path: f })).output, /cude/);
    await ok('get_file_info', { path: f });
  });

  test('copy, move and delete', async () => {
    const src = join(dir, 'b.txt');
    await ok('write_file', { path: src, content: 'x' });
    await ok('copy_file', { source: src, destination: join(dir, 'c.txt') });
    await ok('move_file', { source: join(dir, 'c.txt'), destination: join(dir, 'd.txt') });
    await ok('delete_file', { path: join(dir, 'd.txt') });
    assert.equal(existsSync(join(dir, 'd.txt')), false);
  });

  test('create and list a directory', async () => {
    await ok('create_directory', { path: join(dir, 'sub') });
    const list = await ok('list_directory', { path: dir });
    assert.match(list.output, /a\.txt/);
  });

  test('diff and patch', async () => {
    const f = join(dir, 'p.txt');
    await ok('write_file', { path: f, content: 'hello\ncude\n' });
    await ok('diff_files', { file_a: f, file_b: join(dir, 'a.txt') });
    await ok('apply_patch', { path: f, patch: '@@ -1,2 +1,2 @@\n-hello\n+HELLO\n cude' });
    assert.match((await ok('read_file', { path: f })).output, /HELLO/);
  });
});

describe('search', () => {
  test('regression: a glob pattern does not throw', async () => {
    // `*.txt` reached RegExp unescaped and threw "Nothing to repeat".
    const res = await executeTool('search_files', { directory: dir, pattern: '*.txt' });
    assert.ok(res.success, `glob search failed: ${res.error}`);
    assert.match(res.output, /a\.txt/);
  });

  test('a regex pattern still works', async () => {
    const res = await ok('search_files', { directory: dir, pattern: '\\.txt$' });
    assert.match(res.output, /a\.txt/);
  });

  test('regression: an unparseable pattern falls back instead of throwing', async () => {
    const res = await executeTool('search_files', { directory: dir, pattern: '[' });
    assert.ok(res.success, `malformed pattern threw: ${res.error}`);
  });

  test('grep_search finds file contents', async () => {
    assert.match((await ok('grep_search', { directory: dir, pattern: 'cude' })).output, /a\.txt/);
  });
});

describe('shell and git', () => {
  test('run_command returns stdout', async () => {
    assert.match((await ok('run_command', { command: 'echo hello-from-test' })).output, /hello-from-test/);
  });

  test('git_command runs against the repository', async () => {
    await ok('git_command', { command: 'status --short' });
  });

  test('npm_command runs', async () => {
    await ok('npm_command', { command: '--version' });
  });
});

describe('RAG', () => {
  test('index, search and summarise', async () => {
    await ok('rag_index', { directory: 'src/ui' });
    const found = await ok('rag_search', { query: 'banner' });
    assert.ok(found.output.length > 0);
    assert.match((await ok('rag_summary', {})).output, /src\/ui/);
  });
});

describe('parameter validation', () => {
  test('regression: a missing required parameter names what is missing', async () => {
    // This used to surface as `paths[0] must be of type string`, which told
    // the model nothing about how to retry.
    const res = await executeTool('browser_screenshot', { url: 'file:///x' });
    assert.equal(res.success, false);
    assert.match(res.error, /missing required parameter/i);
    assert.match(res.error, /output/, 'error should name the missing parameter');
  });

  test('regression: a misnamed parameter is reported as missing', async () => {
    const res = await executeTool('rag_index', { path: 'src/ui' });
    assert.equal(res.success, false);
    assert.match(res.error, /directory/, 'error should name the accepted parameter');
  });

  test('a tool with no required parameters still runs', async () => {
    await ok('rag_summary', {});
  });
});

describe('browser', { skip: (await chromiumAvailable()) ? false : 'Chromium not installed' }, () => {
  // Its own directory rather than the root fixture: these tests are the
  // slowest in the file, and one run where the root `after` hook removed `dir`
  // first failed all three with ERR_FILE_NOT_FOUND.
  let bdir;
  let page;
  before(() => {
    bdir = mkdtempSync(join(tmpdir(), 'cude-browser-'));
    page = join(bdir, 'page.html');
    writeFileSync(page, '<html><head><title>T</title></head><body><h1 id="h">Hi</h1></body></html>');
  });
  after(() => rmSync(bdir, { recursive: true, force: true }));

  test('navigate returns page content', async () => {
    const res = await ok('browser_navigate', { url: `file://${page}` });
    assert.match(res.output, /Hi/);
  });

  test('extract pulls a selector', async () => {
    const res = await ok('browser_extract', { url: `file://${page}`, selector: '#h' });
    assert.match(res.output, /Hi/);
  });

  test('screenshot writes a file', async () => {
    const out = join(bdir, 'shot.png');
    await ok('browser_screenshot', { url: `file://${page}`, output: out });
    assert.ok(existsSync(out), 'screenshot file was not created');
  });
});
