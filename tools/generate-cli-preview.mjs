// Renders assets/cude-cli.png: what `cude` actually prints, drawn the way a
// terminal draws it.
//
// An earlier version dumped the output into a <pre>. That lies: a browser draws
// each block glyph at its font metrics inside a taller line box, so stacked
// blocks show horizontal seams and solid runs look fragmented. A terminal
// instead paints block elements to exactly fill the character cell. So this
// parses the real ANSI output into (char, colour) cells and paints them as
// filled rectangles on a canvas — seamless, like the terminal.
//
// Usage: node tools/generate-cli-preview.mjs [outDir]

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SP = process.argv[2] ?? fileURLToPath(new URL('../assets', import.meta.url));
const DISPLAY = fileURLToPath(new URL('../dist/ui/display.js', import.meta.url));

// A PTY, so chalk/gradient-string emit 24-bit colour — the exact bytes a
// user's terminal receives.
const raw = execSync(
  `script -qec "node -e \\"import('${DISPLAY}').then(m => m.showBanner())\\"" /dev/null`,
  { encoding: 'utf8', env: { ...process.env, COLORTERM: 'truecolor', TERM: 'xterm-256color' } }
).replace(/\r/g, '');

// --- parse ANSI into a grid of { ch, color, bold, dim } -------------------
const cells = [];
let row = [];
let color = null;
let bold = false;
let dim = false;

const re = /\x1b\[([0-9;]*)m/g;
let last = 0;
let m;
const push = (text) => {
  for (const ch of text) {
    if (ch === '\n') { cells.push(row); row = []; continue; }
    row.push({ ch, color, bold, dim });
  }
};
while ((m = re.exec(raw)) !== null) {
  push(raw.slice(last, m.index));
  last = re.lastIndex;
  const parts = m[1].split(';').map(Number);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === 0) { color = null; bold = false; dim = false; }
    else if (p === 1) bold = true;
    else if (p === 2) dim = true;
    else if (p === 22) { bold = false; dim = false; }
    else if (p === 39) color = null;
    else if (p === 38 && parts[i + 1] === 2) {
      color = `rgb(${parts[i + 2]},${parts[i + 3]},${parts[i + 4]})`;
      i += 4;
    }
  }
}
push(raw.slice(last));
if (row.length) cells.push(row);
while (cells.length && cells.at(-1).every((c) => c.ch === ' ')) cells.pop();

// --- block glyph -> filled sub-rectangles of the cell ---------------------
// [x, y, w, h] in fractions of the cell.
const FULL = [[0, 0, 1, 1]];
const BLOCKS = {
  '█': FULL,
  '▀': [[0, 0, 1, 0.5]],
  '▄': [[0, 0.5, 1, 0.5]],
  '▌': [[0, 0, 0.5, 1]],
  '▐': [[0.5, 0, 0.5, 1]],
  '▘': [[0, 0, 0.5, 0.5]],
  '▝': [[0.5, 0, 0.5, 0.5]],
  '▖': [[0, 0.5, 0.5, 0.5]],
  '▗': [[0.5, 0.5, 0.5, 0.5]],
  '▚': [[0, 0, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]],
  '▞': [[0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5]],
  '▛': [[0, 0, 1, 0.5], [0, 0.5, 0.5, 0.5]],
  '▜': [[0, 0, 1, 0.5], [0.5, 0.5, 0.5, 0.5]],
  '▙': [[0, 0, 0.5, 0.5], [0, 0.5, 1, 0.5]],
  '▟': [[0.5, 0, 0.5, 0.5], [0, 0.5, 1, 0.5]],
};

const CW = 10;    // cell width  (px)
const CH = 21;    // cell height (px) — 0.48 aspect, typical of a terminal
const PAD_X = 26;
const PAD_Y = 20;
const cols = Math.max(...cells.map((r) => r.length));
const width = cols * CW + PAD_X * 2;
const height = cells.length * CH + PAD_Y * 2 + 42;   // + prompt line

const payload = JSON.stringify({ cells, BLOCKS, CW, CH, PAD_X, PAD_Y });

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{margin:0;padding:44px;background:#12121c;display:flex;justify-content:center}
.term{background:#0a0a0f;border-radius:12px;overflow:hidden;border:1px solid #1d1d2a;
 box-shadow:0 24px 70px rgba(0,0,0,.7),0 0 60px rgba(99,102,241,.10)}
.bar{background:#16161f;padding:12px 16px;display:flex;align-items:center;gap:8px;
 border-bottom:1px solid #1d1d2a}
.d{width:12px;height:12px;border-radius:50%}
.t{flex:1;text-align:center;color:#5a5a6a;font-size:12.5px;margin-right:52px;
 font-family:Inter,system-ui,sans-serif}
</style></head><body>
<div class="term">
 <div class="bar">
  <div class="d" style="background:#ff5f56"></div>
  <div class="d" style="background:#ffbd2e"></div>
  <div class="d" style="background:#27c93f"></div>
  <div class="t">cude-code — zsh</div>
 </div>
 <canvas id="c" width="${width}" height="${height}"></canvas>
</div>
<script>
const { cells, BLOCKS, CW, CH, PAD_X, PAD_Y } = ${payload};
const ctx = document.getElementById('c').getContext('2d');
ctx.fillStyle = '#0a0a0f';
ctx.fillRect(0, 0, ${width}, ${height});

const FONT = Math.round(CW / 0.6) + "px 'DejaVu Sans Mono', monospace";
ctx.textBaseline = 'middle';

// prompt line
ctx.font = '700 ' + FONT;
ctx.fillStyle = '#6366f1';
ctx.fillText('\\u276f', PAD_X + CW / 2, PAD_Y + CH / 2);
ctx.font = FONT;
ctx.fillStyle = '#e6e6f0';
ctx.fillText('cude chat', PAD_X + CW * 2, PAD_Y + CH / 2);

const originY = PAD_Y + CH * 2;
cells.forEach((line, r) => {
  line.forEach((cell, c) => {
    if (cell.ch === ' ') return;
    const x = PAD_X + c * CW;
    const y = originY + r * CH;
    const colour = cell.color || (cell.dim ? '#6f6f80' : '#d8d8e4');
    ctx.fillStyle = colour;
    const rects = BLOCKS[cell.ch];
    if (rects) {
      // Paint block elements to fill the cell exactly, as a terminal does.
      for (const [rx, ry, rw, rh] of rects) {
        ctx.fillRect(Math.round(x + rx * CW), Math.round(y + ry * CH),
                     Math.ceil(rw * CW), Math.ceil(rh * CH));
      }
    } else {
      // One glyph per cell, centred — a terminal does not use font advance.
      ctx.font = (cell.bold ? '700 ' : '') + FONT;
      ctx.textAlign = 'center';
      ctx.fillText(cell.ch, x + CW / 2, y + CH / 2);
      ctx.textAlign = 'left';
    }
  });
});
</script></body></html>`;

writeFileSync(`${SP}/preview.html`, html);
console.log('wrote preview.html');
