// Generates the CLI block-art brand mark straight from assets/cude-mark.svg —
// no redrawing, no simplified variant. The SVG is rendered in Chromium and its
// alpha channel is box-filtered down onto a quadrant grid.
//
// Quadrant blocks (▘▝▖▗▚▞▛▜▙▟▌▐▀▄█) split each character cell into 2x2, which
// is what makes a faithful reduction possible: half-blocks give two sub-rows
// but only ONE sub-column, so the mark's bottom notch — 2.6% of its width,
// about 0.7 of a cell — could not be drawn without widening it. At 2x
// horizontal resolution it lands on ~1.5 sub-cells and survives as-is.
//
// Usage: node tools/generate-logo.mjs [--write]
//   --write  patches LOGO_ART in src/ui/display.ts in place

import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const COLS = 29;             // character columns
const ROWS = 17;             // character rows
const SS = 10;               // supersampling factor
const THRESHOLD = 0.45;      // ink coverage needed to light a sub-cell

// Each cell is 2x2 sub-cells.
const PX_W = COLS * 2;
const PX_H = ROWS * 2;

// Bounding box of the mark's strokes in the SVG's own coordinates: the paths
// span x 83..429 and y 56..470, plus half of the 42-unit stroke on every side.
const VIEWBOX = '62 35 388 456';

const svgPath = fileURLToPath(new URL('../assets/cude-mark.svg', import.meta.url));
const svg = readFileSync(svgPath, 'utf8')
  .replace(/viewBox="[^"]*"/, `viewBox="${VIEWBOX}"`)
  .replace(/\swidth="[^"]*"/, '')
  .replace(/\sheight="[^"]*"/, '');

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 400, height: 400 } });

await page.setContent(
  `<body style="margin:0">
     <img id="m" width="${PX_W * SS}" height="${PX_H * SS}"
          src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">
   </body>`
);
await page.waitForFunction('document.getElementById("m").complete');

const coverage = await page.evaluate(`
  (() => {
    const img = document.getElementById('m');
    const W = ${PX_W}, H = ${PX_H}, SS = ${SS};
    const c = document.createElement('canvas');
    c.width = W * SS; c.height = H * SS;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, W * SS, H * SS);
    const d = ctx.getImageData(0, 0, W * SS, H * SS).data;
    const out = [];
    for (let y = 0; y < H; y++) {
      const row = [];
      for (let x = 0; x < W; x++) {
        let sum = 0;
        for (let j = 0; j < SS; j++) {
          for (let i = 0; i < SS; i++) {
            const px = (x * SS + i) + (y * SS + j) * W * SS;
            sum += d[px * 4 + 3];       // alpha — the mark is white on transparent
          }
        }
        row.push(sum / (SS * SS * 255));
      }
      out.push(row);
    }
    return out;
  })()
`);

await browser.close();

// bit 1 = upper-left, 2 = upper-right, 4 = lower-left, 8 = lower-right
const QUADRANT = [
  ' ', '▘', '▝', '▀',
  '▖', '▌', '▞', '▛',
  '▗', '▚', '▐', '▜',
  '▄', '▙', '▟', '█',
];

const on = (y, x) => ((coverage[y]?.[x] ?? 0) >= THRESHOLD ? 1 : 0);

const lines = [];
for (let r = 0; r < ROWS; r++) {
  let s = '';
  for (let c = 0; c < COLS; c++) {
    const mask =
      on(r * 2, c * 2) * 1 +
      on(r * 2, c * 2 + 1) * 2 +
      on(r * 2 + 1, c * 2) * 4 +
      on(r * 2 + 1, c * 2 + 1) * 8;
    s += QUADRANT[mask];
  }
  lines.push(s.replace(/\s+$/, ''));
}
while (lines.length && lines[0] === '') lines.shift();
while (lines.length && lines.at(-1) === '') lines.pop();

const indent = Math.min(...lines.filter(Boolean).map((l) => l.match(/^ */)[0].length));
const art = lines.map((l) => (l ? '  ' + l.slice(indent) : ''));

console.log(art.join('\n'));

if (process.argv.includes('--write')) {
  const target = fileURLToPath(new URL('../src/ui/display.ts', import.meta.url));
  const literal = art
    .map((l, i) => `  '${l.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}${i === art.length - 1 ? "'" : "\\n' +"}`)
    .join('\n');
  const src = readFileSync(target, 'utf8');
  const patched = src.replace(
    /const LOGO_ART =\n(?:.*\n)*?.*?';\n/,
    `const LOGO_ART =\n${literal};\n`
  );
  if (patched === src) {
    console.error('\ncould not locate LOGO_ART in display.ts');
    process.exit(1);
  }
  writeFileSync(target, patched);
  console.error('\npatched src/ui/display.ts');
}
