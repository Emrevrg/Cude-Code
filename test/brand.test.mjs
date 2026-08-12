// The brand mark must not drift from the artwork.
//
// It did: the CLI's block art and the README screenshot both kept an older
// shape whose bottom notch was drawn with round caps, so the two legs bulged
// half a stroke-width below their end points and read as feet hanging off the
// mark. Nothing caught it, because nothing compared the rendered art to the
// SVG it is supposed to come from.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(fileURLToPath(new URL(p, root)), 'utf8');

const { renderBlockArt, loadMark, markBounds, makeInkTest } =
  await import('../tools/mark-raster.mjs');

/** The LOGO_ART literal as the CLI will actually print it. */
function logoArtFromSource() {
  const source = read('src/ui/display.ts');
  const literal = source.match(/const LOGO_ART =\r?\n((?:.*\r?\n)*?.*?');/);
  assert.ok(literal, 'could not find LOGO_ART in src/ui/display.ts');
  return literal[1]
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^'/, '').replace(/(\\n)?'\s*\+?;?$/, ''))
    .filter((line) => line.length > 0);
}

describe('brand mark', () => {
  test('regression: the CLI art is what the artwork actually reduces to', () => {
    // Run `node tools/generate-logo.mjs --write` after changing the SVG.
    assert.deepEqual(
      logoArtFromSource(),
      renderBlockArt(),
      'src/ui/display.ts LOGO_ART is out of date with assets/cude-mark.svg'
    );
  });

  test('regression: the bottom notch has flat legs, not round feet', () => {
    const svg = read('assets/cude-mark.svg');
    const legs = [...svg.matchAll(/<path d="M (\d+) 441 L \1 470"([^/]*)\/>/g)];

    assert.equal(legs.length, 2, 'expected exactly two bottom legs');
    for (const [, x, attrs] of legs) {
      assert.match(
        attrs,
        /stroke-linecap="butt"/,
        `leg at x=${x} must use a butt cap — a round one adds half the stroke ` +
        'width below the end point, which is what made the legs look like feet'
      );
    }
  });

  test('the legs read as a split, not as protrusions', () => {
    const strokes = loadMark();
    const [, , width, height] = markBounds(strokes);

    // Measured off the reference artwork: the legs are ~6% of the mark's
    // height, and the slit between them ~2.5% of its width.
    const legLength = (470 - 441) / height;
    assert.ok(legLength > 0.04 && legLength < 0.09, `leg length is ${(legLength * 100).toFixed(1)}% of height`);

    const slit = (282 - 230 - 42) / width;
    assert.ok(slit > 0.015 && slit < 0.04, `slit is ${(slit * 100).toFixed(1)}% of width`);
  });

  test('the mark is open on its right side — that is what makes it a "C"', () => {
    const inked = makeInkTest(loadMark());
    // Mid-height on the right edge, between the two arm caps.
    assert.equal(inked(429, 256), false, 'the right side should be open');
    assert.equal(inked(83, 256), true, 'the left side should be solid');
  });

  test('every image the README points at exists', () => {
    const readme = read('README.md');
    const referenced = [...readme.matchAll(/src="\.\/(assets\/[^"]+)"/g)].map((m) => m[1]);

    assert.ok(referenced.length > 0, 'expected the README to show the brand assets');
    for (const asset of referenced) {
      assert.ok(
        existsSync(fileURLToPath(new URL(asset, root))),
        `README references ${asset}, which does not exist`
      );
    }
  });

  test('regression: the terminal screenshot is generated from the same art', () => {
    // It used to be a hand-captured PNG, so it kept showing the old mark after
    // the artwork changed.
    const svg = read('assets/cude-cli.svg');
    const art = logoArtFromSource();

    const inkedCells = art.join('').replace(/ /g, '').length;
    const rects = (svg.match(/<rect x=/g) ?? []).length;
    assert.ok(
      rects >= inkedCells,
      `the screenshot draws ${rects} cells for ${inkedCells} inked characters — regenerate it with tools/generate-cli-shot.mjs`
    );
  });
});
