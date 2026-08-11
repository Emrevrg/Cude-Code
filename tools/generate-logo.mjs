// Generates the CLI block-art brand mark by rendering the real vector mark in
// Chromium and downsampling its pixels — so the terminal art is a faithful
// reduction of the logo rather than a hand-drawn interpretation of it.
//
// Two details of the full mark are sub-pixel at terminal size (the bottom
// notch gap is ~2.6% of the width, i.e. under one cell) and would simply
// vanish. So this renders a small-size variant with those features widened,
// the way a favicon variant is drawn — same shape, tuned to survive the grid.
//
// Usage: node tools/generate-logo.mjs [--write]
//   --write  patches LOGO_ART in src/ui/display.ts in place

import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const COLS = 28;             // character columns
const ROWS = 17;             // character rows (each holds 2 pixel rows)
const SS = 12;               // supersampling factor
const THRESHOLD = 0.42;      // ink coverage needed to light a pixel

const PX_W = COLS;
const PX_H = ROWS * 2;

// Small-size variant of assets/cude-mark.svg: hexagon opened on the right to
// form the "C", ">" chevron inside, split notch at the bottom vertex.
const STROKE = 46;           // thicker than the full mark (42) so it survives
// The notch gap must clear two whole cells or the two legs merge into a blob.
// gap = 2*NOTCH - STROKE, and one cell is 432/COLS units wide.
const NOTCH = Math.round((2.1 * (432 / COLS) + STROKE) / 2);
// Short verticals so the right-hand corners of the hexagon read. Tuned so both
// tips land on a cell boundary — off-boundary lengths leave stray half-blocks.
const STUB = 38;
const LEG = 462;             // where the notch legs stop — kept short, as in the mark
const MARK = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="40 20 432 478">
  <g fill="none" stroke="#fff" stroke-width="${STROKE}"
     stroke-linecap="round" stroke-linejoin="round">
    <path d="M 429 ${156 + STUB} L 429 156 L 256 56 L 83 156 L 83 356
             L ${256 - NOTCH} 436 L ${256 - NOTCH} ${LEG}"/>
    <path d="M ${256 + NOTCH} ${LEG} L ${256 + NOTCH} 436 L 429 356 L 429 ${356 - STUB}"/>
    <path d="M 198 188 L 304 256 L 198 324" stroke-width="${STROKE}"/>
  </g>
</svg>`;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 400, height: 400 } });

await page.setContent(
  `<body style="margin:0">
     <img id="m" width="${PX_W * SS}" height="${PX_H * SS}"
          src="data:image/svg+xml;base64,${Buffer.from(MARK).toString('base64')}">
   </body>`
);
await page.waitForFunction('document.getElementById("m").complete');

// Box-filter each character-pixel down from its SS x SS block of the render.
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
            sum += d[px * 4 + 3];   // alpha: the mark is white on transparent
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

const on = (y, x) => (coverage[y]?.[x] ?? 0) >= THRESHOLD;

const lines = [];
for (let r = 0; r < ROWS; r++) {
  let s = '';
  for (let c = 0; c < COLS; c++) {
    const top = on(r * 2, c);
    const bot = on(r * 2 + 1, c);
    s += top && bot ? '█' : top ? '▀' : bot ? '▄' : ' ';
  }
  lines.push(s.replace(/\s+$/, ''));
}
while (lines.length && lines[0] === '') lines.shift();
while (lines.length && lines.at(-1) === '') lines.pop();

// Trim shared left padding so the art sits flush, then re-indent uniformly.
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
