// Builds the billo logo kit: SVG masters and variants, PNGs, favicon.ico, web manifest.
// Run: node branding/kit/kit.mjs   (needs Google Chrome for PNG rendering)
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { symbolD, smallD, wordmarkD, WORDMARK_W, f } from "./geometry.mjs";

import { COLORS } from "./colors.mjs";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const root = fileURLToPath(new URL(".", import.meta.url));
const dirs = ["svg", "png", "web"].map((d) => join(root, d));
for (const d of dirs) { rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true }); }
const [SVG, PNG, WEB] = dirs;

const svg = (vb, body, title) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"><title>${title}</title>${body}</svg>\n`;
const path = (d, fill) => `<path fill="${fill}" fill-rule="evenodd" d="${d}"/>`;
const save = (dir, name, s) => (writeFileSync(join(dir, name), s), join(dir, name));

// Colourways: symbol colour, wordmark colour.
const ways = {
  color: [COLORS.green, COLORS.ink],
  black: ["#000000", "#000000"],
  white: [COLORS.white, COLORS.white],
  green: [COLORS.green, COLORS.green],
};

// Symbol: trimmed to its footprint (x 52..204, y 36..228) plus a little air.
for (const [k, [c]] of Object.entries(ways)) {
  save(SVG, `billo-symbol-${k}.svg`, svg("40 28 176 208", path(symbolD, c), "billo"));
  save(SVG, `billo-symbol-small-${k}.svg`, svg("0 0 256 256", path(smallD, c), "billo"));
}

// Horizontal lockup: wordmark baseline on the b's baseline (y 192), x-height 0.9 of master.
const S = 0.9, GAP = 30;
const horiz = (sc, wc) =>
  path(symbolD, sc) + `<g transform="translate(${204 + GAP},${f(192 - 200 * S)}) scale(${S})">${path(wordmarkD(), wc)}</g>`;
const hW = Math.ceil(204 + GAP + WORDMARK_W * S);
// Stacked lockup: wordmark centred under the tile, gap = one tooth depth x 2.
const stacked = (sc, wc) => {
  const w = WORDMARK_W * S, x = 128 - w / 2, y = 228 + 32 - 56 * S;
  return path(symbolD, sc) + `<g transform="translate(${f(x)},${f(y)}) scale(${S})">${path(wordmarkD(), wc)}</g>`;
};
const sBottom = 228 + 32 + 144 * S;
for (const [k, [sc, wc]] of Object.entries(ways)) {
  save(SVG, `billo-horizontal-${k}.svg`, svg(`40 28 ${hW - 28} 208`, horiz(sc, wc), "billo"));
  save(SVG, `billo-stacked-${k}.svg`, svg(`${f(128 - (WORDMARK_W * S) / 2 - 12)} 28 ${f(WORDMARK_W * S + 24)} ${f(sBottom - 16)}`, stacked(sc, wc), "billo"));
  save(SVG, `billo-wordmark-${k}.svg`, svg(`-8 48 ${WORDMARK_W + 16} 160`, path(wordmarkD(), wc), "billo"));
}

// App icon: full-bleed green square (platforms apply their own mask), white small-cut mark.
const appIcon = svg(
  "0 0 256 256",
  `<rect width="256" height="256" fill="${COLORS.green}"/><g transform="translate(36,38) scale(0.72)">${path(smallD, COLORS.white)}</g>`,
  "billo"
);
save(SVG, "billo-app-icon.svg", appIcon);
save(WEB, "favicon.svg", svg("0 0 256 256", path(smallD, COLORS.green), "billo"));
save(WEB, "icon-maskable.svg", appIcon);

// --- PNG rendering: one headless Chrome run rasterises every SVG on a canvas at the exact size ---
// (Screenshots cannot go below Chrome's minimum window width, so small icons are drawn on a canvas instead.)
const jobs = [];
const png = (svgFile, out, w, h = w) => (jobs.push({ svgFile, out, w: Math.round(w), h: Math.round(h) }), out);
function renderAll() {
  const items = jobs.map((j) => ({ ...j, src: "data:image/svg+xml;base64," + readFileSync(j.svgFile).toString("base64") }));
  const page = join(root, ".render.html");
  writeFileSync(page, `<!doctype html><body><pre id="out"></pre><script>
const items = ${JSON.stringify(items.map(({ src, w, h }) => ({ src, w, h })))};
Promise.all(items.map(({ src, w, h }) => new Promise((ok) => {
  const img = new Image(); img.onload = () => { const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d").drawImage(img, 0, 0, w, h); ok(c.toDataURL("image/png")); }; img.src = src;
}))).then((r) => { document.getElementById("out").textContent = JSON.stringify(r); });
</script>`);
  const dom = execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--virtual-time-budget=10000", "--dump-dom",
    "file:///" + page.replace(/\\/g, "/")], { maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }).toString();
  rmSync(page);
  const urls = JSON.parse(dom.match(/<pre id="out">(.*?)<\/pre>/s)[1].replace(/&quot;/g, '"'));
  urls.forEach((u, i) => writeFileSync(items[i].out, Buffer.from(u.split(",")[1], "base64")));
}
const vbRatio = (file) => {
  const [, , w, h] = readFileSync(file, "utf8").match(/viewBox="([^"]+)"/)[1].split(" ").map(Number);
  return w / h;
};
for (const k of Object.keys(ways)) {
  for (const n of [512, 1024]) png(join(SVG, `billo-symbol-${k}.svg`), join(PNG, `billo-symbol-${k}-${n}.png`), Math.round(n * vbRatio(join(SVG, `billo-symbol-${k}.svg`))), n);
  const hf = join(SVG, `billo-horizontal-${k}.svg`);
  png(hf, join(PNG, `billo-horizontal-${k}-1200.png`), 1200, Math.round(1200 / vbRatio(hf)));
  const sf = join(SVG, `billo-stacked-${k}.svg`);
  png(sf, join(PNG, `billo-stacked-${k}-800.png`), Math.round(800 * vbRatio(sf)), 800);
}
const fav = join(WEB, "favicon.svg"), app = join(SVG, "billo-app-icon.svg");
const icoSizes = [16, 32, 48].map((n) => png(fav, join(WEB, `favicon-${n}.png`), n));
png(app, join(WEB, "apple-touch-icon.png"), 180);
png(app, join(WEB, "icon-192.png"), 192);
png(app, join(WEB, "icon-512.png"), 512);
png(app, join(PNG, "billo-app-icon-1024.png"), 1024);

renderAll();

// favicon.ico with PNG-encoded entries (supported by every current browser).
const imgs = icoSizes.map((p) => readFileSync(p));
const head = Buffer.alloc(6 + 16 * imgs.length);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(imgs.length, 4);
let off = head.length;
imgs.forEach((b, i) => {
  const n = [16, 32, 48][i], e = 6 + 16 * i;
  head.writeUInt8(n, e); head.writeUInt8(n, e + 1); head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(b.length, e + 8); head.writeUInt32LE(off, e + 12); off += b.length;
});
writeFileSync(join(WEB, "favicon.ico"), Buffer.concat([head, ...imgs]));

writeFileSync(join(WEB, "site.webmanifest"), JSON.stringify({
  name: "billo", short_name: "billo", theme_color: COLORS.green, background_color: COLORS.paper, display: "standalone",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
  ],
}, null, 2) + "\n");
writeFileSync(join(WEB, "head-snippet.html"), `<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="${COLORS.green}">
`);

// Contrast check for the palette (WCAG relative luminance).
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
console.log("green/white", cr(COLORS.green, COLORS.white).toFixed(2), "green/paper", cr(COLORS.green, COLORS.paper).toFixed(2),
  "ink/paper", cr(COLORS.ink, COLORS.paper).toFixed(2), "green/ink", cr(COLORS.green, COLORS.ink).toFixed(2));
