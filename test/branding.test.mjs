import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

test('branding assets are present and README uses the poster', () => {
  const poster = join(root, 'assets', 'cude-poster.png');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');

  assert.ok(existsSync(poster) && statSync(poster).size > 0, 'canonical poster is missing');
  assert.doesNotMatch(readme, /assets\/cude-cli\.png/);
  assert.match(readme, /assets\/cude-poster\.png/);
  assert.doesNotMatch(readme, /cude-banner\.svg|cude-logo\.png/);
  assert.equal(existsSync(join(root, 'assets', 'cude-banner.svg')), false);
  assert.equal(existsSync(join(root, 'assets', 'cude-logo.png')), false);
});

test('CLI banner uses the portable canonical silhouette', () => {
  const display = readFileSync(join(root, 'src', 'ui', 'display.ts'), 'utf8');
  const svg = readFileSync(join(root, 'assets', 'cude-mark.svg'), 'utf8');
  assert.match(display, /CLI_LOGO_ART/);
  assert.match(display, /gradient\(CLI_LOGO_ART\)/);
  assert.match(svg, /split lower vertex/);
});
