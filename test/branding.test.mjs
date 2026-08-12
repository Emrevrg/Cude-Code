import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

test('branding assets are present and README uses the supplied logo and poster', () => {
  const logo = join(root, 'assets', 'cude-logo.png');
  const poster = join(root, 'assets', 'cude-poster.png');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');

  assert.ok(existsSync(logo) && statSync(logo).size > 0, 'canonical logo is missing');
  assert.ok(existsSync(poster) && statSync(poster).size > 0, 'canonical poster is missing');
  assert.match(readme, /assets\/cude-logo\.png/);
  assert.match(readme, /assets\/cude-poster\.png/);
  assert.doesNotMatch(readme, /cude-banner\.svg|cude-cli\.png/);
  assert.equal(existsSync(join(root, 'assets', 'cude-banner.svg')), false);
  assert.equal(existsSync(join(root, 'assets', 'cude-cli.png')), false);
});
