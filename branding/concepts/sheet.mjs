// Builds concepts.html: large mark, lockup, true 64/32/16 px, reversed, one-line idea.
import { readFileSync, writeFileSync } from "node:fs";

const r = (n) => readFileSync(new URL(n, import.meta.url), "utf8");
const img = (n, h, extra = "") =>
  `<img src="data:image/svg+xml;base64,${Buffer.from(r(n)).toString("base64")}" style="height:${h}px;${extra}">`;
const concepts = [
  ["A", "l + o", "Monogram", "The l and o of billo joined at the baseline into a b; a slot stays open above.", false],
  ["B", "Torn till roll", "Wordmark", "Every ascender is ripped like a receipt pulled from the printer.", false],
  ["C", "Receipt tile", "Emblem", "A receipt silhouette with the b punched out of it.", true],
];
const cards = concepts
  .map(([k, name, type, idea, rec]) => `
  <section class="${rec ? "rec" : ""}">
    <div class="head"><b>${k} — ${name}</b><span>${type}${rec ? " · recommended" : ""}</span></div>
    <div class="big">${img(`${k.toLowerCase()}-symbol.svg`, 200)}</div>
    <div class="sizes">${img(`${k.toLowerCase()}-symbol.svg`, 64)}${img(`${k.toLowerCase()}-symbol.svg`, 32)}${img(`${k.toLowerCase()}-symbol.svg`, 16)}
      <div class="dark">${img(`${k.toLowerCase()}-symbol.svg`, 48, "filter:invert(1)")}${img(`${k.toLowerCase()}-symbol.svg`, 16, "filter:invert(1)")}</div></div>
    <div class="lock">${img(`${k.toLowerCase()}-lockup.svg`, 64)}</div>
    <p>${idea}</p>
  </section>`)
  .join("");
writeFileSync(new URL("concepts.html", import.meta.url), `<!doctype html><meta charset="utf-8">
<style>
body{margin:0;padding:40px;background:#f4f4f2;font:15px/1.4 system-ui,sans-serif;color:#20211f;width:1520px}
h1{font-size:22px;margin:0 0 24px}main{display:flex;gap:24px}
section{flex:1;background:#fff;border-radius:16px;padding:24px;border:2px solid transparent}
section.rec{border-color:#20211f}.head{display:flex;justify-content:space-between;margin-bottom:16px}
.head span{color:#77776f}.big{display:flex;justify-content:center;padding:12px 0}
.sizes{display:flex;align-items:center;gap:20px;padding:16px 0;border-top:1px solid #eee}
.dark{margin-left:auto;background:#20211f;border-radius:10px;padding:12px;display:flex;gap:14px;align-items:center}
.lock{padding:16px 0;border-top:1px solid #eee;border-bottom:1px solid #eee}p{margin:14px 0 0}
</style><h1>billoae.com — logo concepts (greyscale)</h1><main>${cards}</main>`);
console.log("ok");
