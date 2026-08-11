// Integrity checks on the model catalog and version wiring.
//
// These exist because both classes of failure below shipped once: the
// task-type selector named a model that had been removed from the catalog
// (so those routes could not resolve a model), and the catalog carried
// prices that were wrong by 3-4x in a table the budget tracker multiplies
// tokens by — which silently produced wrong spend reports.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(fileURLToPath(new URL(p, root)), 'utf8');
const pkg = JSON.parse(read('package.json'));

const { MODELS } = await import('../dist/config/models.js');

test('every model id referenced in source resolves in the catalog', () => {
  // A model named in the selector or a provider but absent from MODELS means
  // that route cannot resolve a model at runtime.
  const sources = ['src/core/selector.ts', 'src/providers/anthropic.ts'];
  const referenced = new Set();
  for (const file of sources) {
    for (const m of read(file).matchAll(/model:\s*'([^']+)'/g)) referenced.add(m[1]);
  }

  assert.ok(referenced.size > 0, 'expected to find model references to check');
  for (const id of referenced) {
    // Ollama models are whatever the user has pulled locally, so the provider
    // enumerates them at runtime from /api/tags rather than from this catalog.
    if (id.startsWith('ollama/')) continue;
    assert.ok(MODELS[id], `${id} is referenced in source but missing from the catalog`);
  }
});

test('catalog entries are internally consistent', () => {
  for (const [key, model] of Object.entries(MODELS)) {
    assert.equal(model.id, key, `${key}: id does not match its catalog key`);
    assert.ok(model.name, `${key}: missing name`);
    assert.ok(model.provider, `${key}: missing provider`);
    assert.ok(Array.isArray(model.capabilities), `${key}: capabilities must be an array`);
    assert.ok(model.contextWindow > 0, `${key}: contextWindow must be positive`);
  }
});

test('pricing is present and non-negative for every model', () => {
  // The budget tracker multiplies token counts by these, so a missing or
  // negative value corrupts spend reporting rather than failing loudly.
  for (const [key, model] of Object.entries(MODELS)) {
    const { inputPerMillion, outputPerMillion } = model.pricing ?? {};
    assert.equal(typeof inputPerMillion, 'number', `${key}: inputPerMillion must be a number`);
    assert.equal(typeof outputPerMillion, 'number', `${key}: outputPerMillion must be a number`);
    assert.ok(inputPerMillion >= 0, `${key}: negative input price`);
    assert.ok(outputPerMillion >= 0, `${key}: negative output price`);
    if (model.free) {
      assert.equal(inputPerMillion, 0, `${key}: marked free but has an input price`);
      assert.equal(outputPerMillion, 0, `${key}: marked free but has an output price`);
    }
  }
});

test('paid models cost more to generate than to read', () => {
  // Every provider charges at least as much for output as for input. A row
  // that inverts this is a transcription error, which is how the wrong
  // Opus and Haiku prices went unnoticed.
  for (const [key, model] of Object.entries(MODELS)) {
    if (model.free || model.local) continue;
    const { inputPerMillion, outputPerMillion } = model.pricing;
    if (inputPerMillion === 0 && outputPerMillion === 0) continue;
    assert.ok(
      outputPerMillion >= inputPerMillion,
      `${key}: output ($${outputPerMillion}) cheaper than input ($${inputPerMillion})`
    );
  }
});

test('the version is the same in package.json, the CLI and the banner', () => {
  const { version } = pkg;
  assert.match(version, /^\d+\.\d+\.\d+$/, 'version is not semver');
  assert.ok(read('src/cli.ts').includes(version), `src/cli.ts does not mention ${version}`);
  assert.ok(read('src/ui/display.ts').includes(version), `banner does not mention ${version}`);
});

test('every dependency is actually imported somewhere in src/', async () => {
  // 67MB of unused dependencies shipped once. Playwright is loaded through a
  // dynamic import, so match the bare name rather than an import statement.
  const { execSync } = await import('node:child_process');
  const src = execSync('cat $(find src -name "*.ts")', {
    cwd: fileURLToPath(root),
    encoding: 'utf8',
    maxBuffer: 1e8,
  });
  for (const dep of Object.keys(pkg.dependencies)) {
    assert.ok(src.includes(dep), `${dep} is a dependency but is never referenced in src/`);
  }
});
