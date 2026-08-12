// Generates the CLI block-art brand mark straight from assets/cude-mark.svg —
// no redrawing, no simplified variant.
//
// Quadrant blocks (▘▝▖▗▚▞▛▜▙▟▌▐▀▄█) split each character cell into 2x2, which
// is what makes a faithful reduction possible: half-blocks give two sub-rows
// but only ONE sub-column, so the mark's bottom notch — 2.6% of its width,
// about 0.7 of a cell — could not be drawn without widening it. At 2x
// horizontal resolution it lands on ~1.5 sub-cells and survives as-is.
//
// The mark is three stroked polylines with round joins, so its inked region is
// a closed form (see tools/mark-raster.mjs) and is sampled directly. It used to
// be rendered in Chromium and read back from the alpha channel, which meant
// this tool could not run wherever Playwright's 150MB browser was absent — CI
// skips that download deliberately, so the art could not be regenerated there.
//
// Usage: node tools/generate-logo.mjs [--write]
//   --write  patches LOGO_ART in src/ui/display.ts in place

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderBlockArt } from './mark-raster.mjs';

const art = renderBlockArt();

console.log(art.join('\n'));

if (process.argv.includes('--write')) {
  const target = fileURLToPath(new URL('../src/ui/display.ts', import.meta.url));
  const src = readFileSync(target, 'utf8');
  // A Windows checkout has CRLF line endings, so anchoring on "\n" alone never
  // matched and --write silently reported that it could not find the literal.
  const eol = src.includes('\r\n') ? '\r\n' : '\n';

  const literal = art
    .map((l, i) => `  '${l.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}${i === art.length - 1 ? "'" : "\\n' +"}`)
    .join(eol);
  const patched = src.replace(
    /const LOGO_ART =\r?\n(?:.*\r?\n)*?.*?';\r?\n/,
    `const LOGO_ART =${eol}${literal};${eol}`
  );
  if (patched === src) {
    console.error('\ncould not locate LOGO_ART in display.ts');
    process.exit(1);
  }
  writeFileSync(target, patched);
  console.error('\npatched src/ui/display.ts');
}
