// Shared geometry for the billo mark: receipt tile with the b knocked out, plus the wordmark.
export const f = (n) => +n.toFixed(2);

const circle = (cx, cy, r) =>
  `M${f(cx - r)},${f(cy)}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0Z`;
const rect = (x, y, w, h) => `M${x},${y}h${w}v${h}h${-w}Z`;

// b outline: stem + bowl, counter as second subpath (evenodd).
export function bPath(L, T, w, R, cy, r) {
  const dy = Math.sqrt(R * R - (R - w) * (R - w));
  return `M${L},${T}H${L + w}V${f(cy - dy)}A${R},${R} 0 1,1 ${L},${cy}Z` + circle(L + R, cy, r);
}

// Receipt tile: rounded top corners, torn (zigzag) bottom edge.
export function tilePath({ x0, x1, top, rx, base, depth, teeth }) {
  const tw = (x1 - x0) / teeth;
  let d = `M${x0},${top + rx}a${rx},${rx} 0 0,1 ${rx},${-rx}H${x1 - rx}a${rx},${rx} 0 0,1 ${rx},${rx}V${base}`;
  for (let i = 0; i < teeth; i++) d += `L${f(x1 - (i + 0.5) * tw)},${base + depth}L${f(x1 - (i + 1) * tw)},${base}`;
  return d + "Z";
}

// Master symbol (use from 32 px up).
export const symbolD =
  tilePath({ x0: 52, x1: 204, top: 36, rx: 28, base: 212, depth: 16, teeth: 4 }) + bPath(86, 66, 26, 42, 150, 16);

// Small-size cut (below 32 px): fills more of the canvas, 3 deeper teeth, heavier b, bigger counter.
export const smallD =
  tilePath({ x0: 36, x1: 220, top: 16, rx: 30, base: 216, depth: 26, teeth: 3 }) + bPath(76, 46, 34, 52, 148, 18);

// Wordmark "billo": stroke 24, baseline 200, x-height 112, ascender 56. Width 316.
export function wordmarkD() {
  const w = 24, base = 200, xh = 112, asc = 56, R = 44, r = 20, cy = 156;
  return (
    bPath(0, asc, w, R, cy, r) +
    rect(104, xh, w, base - xh) + circle(116, 84, 14) +
    rect(146, asc, w, base - asc) + rect(188, asc, w, base - asc) +
    circle(272, cy, R) + circle(272, cy, r)
  );
}
export const WORDMARK_W = 316;
