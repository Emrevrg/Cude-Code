// Renders assets/cude-cli.svg from the CLI's actual banner output.
//
// The screenshot in the README used to be captured by hand, so when the brand
// mark changed the README kept showing the old one, feet and all. Generating it
// from the same LOGO_ART the CLI prints means the two cannot drift apart.
//
// Usage: node tools/generate-cli-shot.mjs [--write]

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const displayPath = fileURLToPath(new URL('../src/ui/display.ts', import.meta.url));
const source = readFileSync(displayPath, 'utf8');

const literal = source.match(/const LOGO_ART =\r?\n((?:.*\r?\n)*?.*?');/);
if (!literal) {
  console.error('could not read LOGO_ART from src/ui/display.ts');
  process.exit(1);
}

const art = literal[1]
  .split(/\r?\n/)
  .map((line) => line.trim().replace(/^'/, '').replace(/(\\n)?'\s*\+?;?$/, ''))
  .filter((line) => line.length > 0);

const version = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')
).version;

// The art is drawn as rectangles, not text. Quadrant block characters
// (U+2580..U+259F) are absent from some monospace fonts, and a viewer without
// them would see the mark collapse into tofu boxes; rectangles render anywhere.
// bit 0 = upper-left, 1 = upper-right, 2 = lower-left, 3 = lower-right
const QUADRANT_BITS = {
  ' ': 0b0000, '▘': 0b0001, '▝': 0b0010, '▀': 0b0011,
  '▖': 0b0100, '▌': 0b0101, '▞': 0b0110, '▛': 0b0111,
  '▗': 0b1000, '▚': 0b1001, '▐': 0b1010, '▜': 0b1011,
  '▄': 0b1100, '▙': 0b1101, '▟': 0b1110, '█': 0b1111,
};

// Layout
const CHAR_W = 13.2;
const LINE_H = 25;
const PAD_X = 48;
const PAD_Y = 34;
const TITLEBAR = 52;
const COLS = Math.max(...art.map((l) => l.length), 52);
const WIDTH = Math.round(PAD_X * 2 + COLS * CHAR_W);
const HEIGHT = Math.round(TITLEBAR + PAD_Y * 2 + (2 + art.length + 4) * LINE_H);

const MONO = "ui-monospace,'SF Mono','Cascadia Mono','JetBrains Mono',Menlo,Consolas,monospace";

let y = TITLEBAR + PAD_Y + LINE_H;
const rows = [];

rows.push(
  `    <text x="${PAD_X}" y="${y}" fill="#818cf8">❯</text>` +
  `<text x="${PAD_X + CHAR_W * 2}" y="${y}" fill="#e5e7eb">cude chat</text>`
);
y += LINE_H * 2;

// The mark
const artTop = y - LINE_H * 0.8;
const subW = CHAR_W / 2;
const subH = LINE_H / 2;
const marks = [];

for (let r = 0; r < art.length; r++) {
  for (let c = 0; c < art[r].length; c++) {
    const bits = QUADRANT_BITS[art[r][c]];
    if (!bits) continue;
    for (let q = 0; q < 4; q++) {
      if (!(bits & (1 << q))) continue;
      const x = PAD_X + c * CHAR_W + (q % 2) * subW;
      const cellY = artTop + r * LINE_H + (q >> 1) * subH;
      // The half-pixel overhang closes the hairline seams between sub-cells.
      marks.push(
        `    <rect x="${x.toFixed(2)}" y="${cellY.toFixed(2)}" ` +
        `width="${(subW + 0.5).toFixed(2)}" height="${(subH + 0.5).toFixed(2)}"/>`
      );
    }
  }
}
y += LINE_H * art.length;

y += LINE_H * 0.5;
rows.push(
  `    <text x="${PAD_X}" y="${y}" fill="#ffffff" font-weight="700">CUDE CODE</text>` +
  `<text x="${PAD_X + CHAR_W * 11}" y="${y}" fill="#6b7280">v${version}</text>`
);
y += LINE_H;
rows.push(
  `    <text x="${PAD_X}" y="${y}" fill="#9ca3af">YAZ. ANLA. </text>` +
  `<text x="${PAD_X + CHAR_W * 11}" y="${y}" fill="#6366f1">ÜRET.</text>`
);
y += LINE_H;
rows.push(
  `    <text x="${PAD_X}" y="${y}" fill="#6b7280">19 providers · 22 tools · 9 task types · browser · RAG</text>`
);

const svg = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="Cude Code running in the terminal">`,
  '  <title>cude chat</title>',
  '  <defs>',
  '    <linearGradient id="markGradient" x1="0" y1="0" x2="0" y2="1">',
  '      <stop offset="0%" stop-color="#ffffff"/>',
  '      <stop offset="55%" stop-color="#c7d2fe"/>',
  '      <stop offset="100%" stop-color="#6366f1"/>',
  '    </linearGradient>',
  '  </defs>',
  '',
  `  <rect width="${WIDTH}" height="${HEIGHT}" rx="14" fill="#0b0d12"/>`,
  `  <rect width="${WIDTH}" height="${TITLEBAR}" rx="14" fill="#151922"/>`,
  `  <rect y="${TITLEBAR - 14}" width="${WIDTH}" height="14" fill="#151922"/>`,
  `  <circle cx="30" cy="${TITLEBAR / 2}" r="7" fill="#ff5f57"/>`,
  `  <circle cx="54" cy="${TITLEBAR / 2}" r="7" fill="#febc2e"/>`,
  `  <circle cx="78" cy="${TITLEBAR / 2}" r="7" fill="#28c840"/>`,
  `  <text x="${WIDTH / 2}" y="${TITLEBAR / 2 + 5}" fill="#8b93a7" font-family="${MONO}" font-size="15" text-anchor="middle">cude-code — zsh</text>`,
  '',
  '  <g fill="url(#markGradient)" shape-rendering="crispEdges">',
  marks.join('\n'),
  '  </g>',
  '',
  `  <g font-family="${MONO}" font-size="19" xml:space="preserve">`,
  rows.join('\n'),
  '  </g>',
  '</svg>',
  '',
].join('\n');

if (process.argv.includes('--write')) {
  const out = fileURLToPath(new URL('../assets/cude-cli.svg', import.meta.url));
  writeFileSync(out, svg, 'utf8');
  console.error(`wrote assets/cude-cli.svg (${WIDTH}x${HEIGHT})`);
} else {
  process.stdout.write(svg);
}
