// Generates the three billo logo concepts as clean filled SVG paths (no text, no strokes).
import { writeFileSync } from "node:fs";

const out = new URL("./", import.meta.url);
const save = (name, svg) => writeFileSync(new URL(name, out), svg);
const f = (n) => +n.toFixed(2);

// Ring (circle with real hole) as one evenodd path.
const ring = (cx, cy, R, r) =>
  `M${f(cx - R)},${cy}a${R},${R} 0 1,0 ${2 * R},0a${R},${R} 0 1,0 ${-2 * R},0Z` +
  `M${f(cx - r)},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0Z`;
const disk = (cx, cy, r) => `M${f(cx - r)},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0Z`;
const rect = (x, y, w, h) => `M${x},${y}h${w}v${h}h${-w}Z`;
// Stem whose top is torn into a V notch, like a receipt ripped off the printer.
const notched = (x, y, w, h, d) => `M${x},${y}L${f(x + w / 2)},${y + d}L${x + w},${y}V${y + h}H${x}Z`;

// b as a single outline: stem + bowl, counter as a second subpath.
function bPath(L, T, w, R, cy, r, notch = 0) {
  const cx = L + R;
  const dy = Math.sqrt(R * R - (R - w) * (R - w));
  const top = notch ? `M${L},${T}L${f(L + w / 2)},${T + notch}L${L + w},${T}` : `M${L},${T}H${L + w}`;
  return (
    `${top}V${f(cy - dy)}A${R},${R} 0 1,1 ${L},${cy}Z` +
    `M${f(cx - r)},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0Z`
  );
}

// Wordmark "billo": stroke 24, x-height 112..200, ascender 56, bowls R44/r20.
function wordmark({ notch = 0 } = {}) {
  const w = 24, base = 200, xh = 112, asc = 56, R = 44, r = 20, cy = 156;
  const d = [];
  d.push(bPath(0, asc, w, R, cy, r, notch));
  d.push(rect(104, xh, w, base - xh), disk(116, 84, 14));
  for (const x of [146, 188]) d.push(notch ? notched(x, asc, w, base - asc, 12) : rect(x, asc, w, base - asc));
  d.push(ring(272, cy, R, r));
  return { d: d.join(""), width: 316 };
}

const svg = (vb, body, title) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"><title>${title}</title>${body}</svg>\n`;
const path = (d, fill = "#000") => `<path fill="${fill}" fill-rule="evenodd" d="${d}"/>`;

// A — "l + o": the l and o of billo joined at the baseline into a b; a slot stays open above.
const aD =
  "M56,56a16,16 0 0,1 32,0V166H102A50,50 0 1,1 152,216H72a16,16 0 0,1 -16,-16Z" +
  disk(152, 166, 18);
save("a-symbol.svg", svg("0 0 256 256", path(aD), "billo A symbol"));

// B — torn-receipt stems: every ascender is ripped like a till roll.
const bD = bPath(78, 40, 34, 52, 160, 20, 16);
save("b-symbol.svg", svg("0 0 256 256", path(bD), "billo B symbol"));

// C — receipt tile with the b knocked out in negative space.
const tile =
  `M52,64a28,28 0 0,1 28,-28H176a28,28 0 0,1 28,28V212` +
  `L185,228L166,212L147,228L128,212L109,228L90,212L71,228L52,212Z`;
const cD = tile + bPath(86, 66, 26, 42, 150, 16);
save("c-symbol.svg", svg("0 0 256 256", path(cD), "billo C symbol"));

// Lockups: symbol at 256 tall + wordmark scaled to sit on the symbol's optical baseline.
function lockup(name, symD, wm, s = 0.9, gap = 28, dy = 0) {
  const wx = 256 + gap;
  const width = Math.ceil(wx + wm.width * s + 16);
  const body =
    path(symD) +
    `<g transform="translate(${wx},${f(dy)}) scale(${s})">${path(wm.d)}</g>`;
  save(name, svg(`0 0 ${width} 256`, body, name));
}
lockup("a-lockup.svg", aD, wordmark(), 0.9, 8, 36);
lockup("c-lockup.svg", cD, wordmark(), 0.9, 12, 12);
const wmB = wordmark({ notch: 12 });
save("b-lockup.svg", svg(`0 0 ${wmB.width + 32} 256`, `<g transform="translate(16,0)">${path(wmB.d)}</g>`, "billo B wordmark"));
console.log("ok");
