// Generates the CLI block-art brand mark from the same geometry as assets/logo.svg.
// Draws into a half-block pixel grid (each text row = 2 pixel rows) so diagonals
// come out smooth and the hexagon keeps its true aspect ratio.

const W = 34;          // columns
const ROWS = 17;       // text rows
const H = ROWS * 2;    // pixel rows

const grid = Array.from({ length: H }, () => new Array(W).fill(false));

function plot(x, y) {
  const xi = Math.round(x), yi = Math.round(y);
  if (xi >= 0 && xi < W && yi >= 0 && yi < H) grid[yi][xi] = true;
}

// Thick line: walk the segment and stamp a disc of the given radius.
function line(x1, y1, x2, y2, t) {
  const dx = x2 - x1, dy = y2 - y1;
  const steps = Math.ceil(Math.hypot(dx, dy) * 6);
  for (let i = 0; i <= steps; i++) {
    const x = x1 + (dx * i) / steps;
    const y = y1 + (dy * i) / steps;
    for (let oy = -t; oy <= t; oy += 0.5) {
      for (let ox = -t; ox <= t; ox += 0.5) {
        // squash x so the disc stays round on screen (char cell ≈ 0.6 wide × 0.5 tall here)
        if ((ox / 1.2) ** 2 + oy ** 2 <= t * t) plot(x + ox, y + oy);
      }
    }
  }
}

// Round join: fills the half-pixel gap where two segments meet at a vertex.
function dot(x, y, t) {
  for (let oy = -t; oy <= t; oy += 0.5) {
    for (let ox = -t; ox <= t; ox += 0.5) {
      if ((ox / 1.2) ** 2 + oy ** 2 <= t * t) plot(x + ox, y + oy);
    }
  }
}

// --- hexagon geometry (pointy top/bottom), mirroring the SVG ---
const cx = 17, cy = 17;
const R = 16;                       // vertical radius, in pixel rows (even, so vertices land on whole text rows)
// A regular hexagon is 0.866× as wide as tall; the extra /0.6 converts
// char-heights to char-widths so it does not come out squashed.
const RX = Math.round(R * 0.5 * 0.866 / 0.6);

const top   = [cx, cy - R];
const ur    = [cx + RX, cy - R / 2];
const lr    = [cx + RX, cy + R / 2];
const ll    = [cx - RX, cy + R / 2];
const ul    = [cx - RX, cy - R / 2];

const T = 1.0;                      // stroke thickness
// How far the right-hand vertical edges reach in from each corner before the
// "C" opening starts. Keeps the hexagon readable at terminal size.
const STUB = 4;

// The "C": upper-right vertex -> top -> upper-left -> lower-left -> bottom notch (left leg)
line(ur[0], ur[1], ur[0], ur[1] + STUB, T);
line(...ur, ...top, T);
line(...top, ...ul, T);
line(...ul, ...ll, T);
line(...ll, cx - 1.6, cy + R - 2, T);
line(cx - 1.6, cy + R - 2, cx - 1.6, cy + R, T);

// Right leg of the bottom notch, sweeping up to the lower-right vertex
line(cx + 1.6, cy + R, cx + 1.6, cy + R - 2, T);
line(cx + 1.6, cy + R - 2, ...lr, T);
line(lr[0], lr[1], lr[0], lr[1] - STUB, T);

// ">" chevron inside, placed at the same relative position as in the SVG
const chevBack = cx - RX + (RX * 2) * 0.38;
const chevTip  = cx - RX + (RX * 2) * 0.64;
const chevRise = R * 0.33;
line(chevBack, cy - chevRise, chevTip, cy, T * 0.95);
line(chevTip, cy, chevBack, cy + chevRise, T * 0.95);
dot(chevTip, cy, T * 0.95);

// Round joins at every corner so no half-pixel notches show up
for (const v of [ul, ll, ur, lr]) dot(v[0], v[1], T);
// The apex angle is sharp enough that at terminal resolution the interior
// pokes through as a notch, so give it a slightly fuller cap.
dot(top[0], top[1] + 0.5, T * 1.7);

// --- render half-block characters ---
const lines = [];
for (let r = 0; r < ROWS; r++) {
  let s = '';
  for (let c = 0; c < W; c++) {
    const t = grid[r * 2][c];
    const b = grid[r * 2 + 1][c];
    s += t && b ? '█' : t ? '▀' : b ? '▄' : ' ';
  }
  lines.push(s.replace(/\s+$/, ''));
}
while (lines.length && lines[0] === '') lines.shift();
while (lines.length && lines[lines.length - 1] === '') lines.pop();

console.log(lines.join('\n'));
console.log('\n--- JS literal ---\n');
console.log(lines.map((l) => `  '${l}\\n' +`).join('\n').replace(/\\n' \+$/, "'"));
