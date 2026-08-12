// Rasterises assets/cude-mark.svg without a browser.
//
// The mark is three stroked polylines with round caps and round joins, so the
// inked region is exactly the union of capsules (a segment plus its radius) —
// "distance to the nearest segment <= stroke-width / 2". That is a closed form,
// which means the block art can be regenerated deterministically instead of
// depending on a 150MB Chromium download that CI deliberately skips.
//
// Exports the sampler; tools/generate-logo.mjs and tools/mark-preview.mjs use it.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Parses `M x y L x y L x y ...` — the only path syntax the mark uses. */
function parsePolyline(d) {
  const numbers = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const points = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) points.push([numbers[i], numbers[i + 1]]);
  return points;
}

export function loadMark(svgPath = fileURLToPath(new URL('../assets/cude-mark.svg', import.meta.url))) {
  const svg = readFileSync(svgPath, 'utf8');

  const groupWidth = Number(svg.match(/stroke-width="(\d+(?:\.\d+)?)"/)?.[1] ?? 42);
  const strokes = [];

  const groupCap = svg.match(/stroke-linecap="(\w+)"/)?.[1] ?? 'butt';

  for (const match of svg.matchAll(/<path\s+([^>]*?)d="([^"]+)"([^>]*)\/>/g)) {
    const attrs = match[1] + match[3];
    const own = attrs.match(/stroke-width="(\d+(?:\.\d+)?)"/);
    const cap = attrs.match(/stroke-linecap="(\w+)"/)?.[1] ?? groupCap;
    strokes.push({
      points: parsePolyline(match[2]),
      radius: (own ? Number(own[1]) : groupWidth) / 2,
      cap,
    });
  }

  if (strokes.length === 0) throw new Error(`no <path> found in ${svgPath}`);
  return strokes;
}

/**
 * Whether a point lies within `radius` of a segment.
 *
 * `clampStart` / `clampEnd` model the cap: clamping t gives a round end (the
 * capsule), leaving it unclamped gives a butt end (the rectangle stops square
 * at the endpoint). Interior joins always clamp, so they stay round.
 */
function withinSegment(px, py, ax, ay, bx, by, r2, clampStart, clampEnd) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return (px - ax) ** 2 + (py - ay) ** 2 <= r2;

  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
  if (t < 0) {
    if (!clampStart) return false;
    t = 0;
  }
  if (t > 1) {
    if (!clampEnd) return false;
    t = 1;
  }

  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return (px - cx) ** 2 + (py - cy) ** 2 <= r2;
}

export function makeInkTest(strokes) {
  return (x, y) => {
    for (const { points, radius, cap } of strokes) {
      const r2 = radius * radius;
      const round = cap !== 'butt';
      const last = points.length - 2;

      if (points.length === 1) {
        const [ax, ay] = points[0];
        if (round && (x - ax) ** 2 + (y - ay) ** 2 <= r2) return true;
        continue;
      }

      for (let i = 0; i <= last; i++) {
        const [ax, ay] = points[i];
        const [bx, by] = points[i + 1];
        // Only the two ends of the polyline take the cap; joins stay round.
        const clampStart = i > 0 || round;
        const clampEnd = i < last || round;
        if (withinSegment(x, y, ax, ay, bx, by, r2, clampStart, clampEnd)) return true;
      }
    }
    return false;
  };
}

/**
 * Tight bounding box of the inked region, as `[x, y, width, height]`.
 *
 * Computed rather than hand-measured: a round cap reaches `radius` past its
 * endpoint along the stroke, a butt cap does not, so changing a cap silently
 * changes the box. Getting this wrong shifts and squashes the block art.
 */
export function markBounds(strokes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const include = (x, y) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  for (const { points, radius, cap } of strokes) {
    const round = cap !== 'butt';
    const last = points.length - 2;

    for (let i = 0; i <= last; i++) {
      const [ax, ay] = points[i];
      const [bx, by] = points[i + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const length = Math.hypot(dx, dy) || 1;
      // The rectangle: both endpoints offset perpendicular by the radius.
      const nx = (-dy / length) * radius;
      const ny = (dx / length) * radius;
      for (const [px, py] of [[ax, ay], [bx, by]]) {
        include(px + nx, py + ny);
        include(px - nx, py - ny);
      }
      // Round ends and interior joins add a disc.
      if (round || i > 0) {
        include(ax - radius, ay - radius);
        include(ax + radius, ay + radius);
      }
      if (round || i < last) {
        include(bx - radius, by - radius);
        include(bx + radius, by + radius);
      }
    }
  }

  return [minX, minY, maxX - minX, maxY - minY];
}

/**
 * Ink coverage per cell of a `cols x rows` grid over `viewBox`, supersampled
 * `ss` times per axis. Mirrors what the Chromium version measured from alpha.
 */
export function sampleCoverage({ strokes, viewBox, cols, rows, ss = 8 }) {
  const [vx, vy, vw, vh] = viewBox;
  const inked = makeInkTest(strokes);
  const grid = [];

  for (let row = 0; row < rows; row++) {
    const line = [];
    for (let col = 0; col < cols; col++) {
      let hits = 0;
      for (let j = 0; j < ss; j++) {
        const y = vy + ((row + (j + 0.5) / ss) / rows) * vh;
        for (let i = 0; i < ss; i++) {
          const x = vx + ((col + (i + 0.5) / ss) / cols) * vw;
          if (inked(x, y)) hits++;
        }
      }
      line.push(hits / (ss * ss));
    }
    grid.push(line);
  }

  return grid;
}

// bit 1 = upper-left, 2 = upper-right, 4 = lower-left, 8 = lower-right
const QUADRANT = [
  ' ', '▘', '▝', '▀',
  '▖', '▌', '▞', '▛',
  '▗', '▚', '▐', '▜',
  '▄', '▙', '▟', '█',
];

/**
 * The mark reduced onto a quadrant-block grid — what the CLI prints.
 *
 * Quadrant blocks split each character cell into 2x2, which is what makes a
 * faithful reduction possible: half-blocks give two sub-rows but only ONE
 * sub-column, so the bottom notch (2.6% of the mark's width, about 0.7 of a
 * cell) could not be drawn without widening it. At 2x horizontal resolution it
 * lands on ~1.5 sub-cells and survives as-is.
 */
export function renderBlockArt({ cols = 29, rows = 17, ss = 12, threshold = 0.45 } = {}) {
  const strokes = loadMark();
  const viewBox = markBounds(strokes);
  const coverage = sampleCoverage({ strokes, viewBox, cols: cols * 2, rows: rows * 2, ss });

  const on = (y, x) => ((coverage[y]?.[x] ?? 0) >= threshold ? 1 : 0);

  const lines = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const mask =
        on(r * 2, c * 2) * 1 +
        on(r * 2, c * 2 + 1) * 2 +
        on(r * 2 + 1, c * 2) * 4 +
        on(r * 2 + 1, c * 2 + 1) * 8;
      line += QUADRANT[mask];
    }
    lines.push(line.replace(/\s+$/, ''));
  }

  while (lines.length && lines[0] === '') lines.shift();
  while (lines.length && lines.at(-1) === '') lines.pop();

  const indent = Math.min(...lines.filter(Boolean).map((l) => l.match(/^ */)[0].length));
  return lines.map((l) => (l ? '  ' + l.slice(indent) : ''));
}
