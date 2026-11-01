# billo — logo usage guide

**Mark:** "Receipt tile". A till receipt with a torn bottom edge, with the lowercase b punched out of it. It stands for a bill handed over the counter.

See `board.png` for the logo in use (receipt, counter sign, app icon, app header, browser tab, business card).

## Files

| Need | File |
|---|---|
| Main logo (screens) | `svg/billo-horizontal-color.svg` |
| On Billo Green or dark backgrounds | `svg/billo-horizontal-white.svg`, `svg/billo-stacked-white.svg` |
| One colour (receipt printers, stamps, fax) | `svg/billo-*-black.svg` |
| Square spaces (social avatar, signage) | `svg/billo-stacked-*.svg`, `svg/billo-symbol-*.svg` |
| Under 32 px | `svg/billo-symbol-small-*.svg` (small-size cut) |
| App icon | `svg/billo-app-icon.svg`, `png/billo-app-icon-1024.png` |
| Website icons | `web/` (copy into `public/`, paste `web/head-snippet.html` into `<head>`) |
| PNG exports | `png/` (transparent background) |

Variants: `color` (green symbol and ink wordmark), `green` (all green), `black`, `white`.

## Colour

| Name | HEX | RGB | CMYK | Pantone (nearest*) |
|---|---|---|---|---|
| Billo Green | `#0B6E4F` | 11 110 79 | 90 25 75 25 | 3425 C |
| Ink | `#16201C` | 22 32 28 | 70 45 60 85 | Black 3 C |
| Till Paper | `#FFF7E8` | 255 247 232 | 0 3 9 0 | — |

\* The CMYK and Pantone values are approximate. Check them against a printed swatch before a print run.

Contrast ratios: green on white is 6.25:1, green on Till Paper is 5.87:1, and ink on Till Paper is 15.7:1. Billo Green passes WCAG AA for normal text on white and on Till Paper. Do not set green on ink, because the ratio is only 2.67:1.

## Clear space

Clear space **x** is one receipt tooth: the width of one zigzag segment at the bottom of the tile. That is one quarter of the tile's width. Keep at least **x** free on all sides of the symbol and the lockups.

## Minimum size

- **Symbol:** use the master from 32 px up. Below 32 px, use the small-size cut, down to 16 px. In print, the minimum is 6 mm.
- **Horizontal lockup:** minimum 80 px wide on screen, or 20 mm in print.
- **Thermal receipt printers:** use `billo-horizontal-black` at 30 mm wide or more.

## Approved backgrounds

- **White, Till Paper or light photos:** use the colour or green version.
- **Billo Green or Ink:** use the white version. The b then shows the background through it.
- **Mid-tone or busy backgrounds:** place the logo on a Till Paper or white panel.

## Don't

- Stretch, skew, rotate or outline the logo.
- Change the colours, or put the green logo on a green background.
- Add shadows, gradients or glows.
- Rebuild the wordmark in a font. It is custom drawn, so always use the supplied files.
- Change the number of teeth on the master symbol.

## Typography

The "billo" wordmark is drawn as outlines from simple geometric shapes. No font licence is needed for the logo. For product and marketing text, keep using the app's existing UI font, and set headings in Ink.

## Regenerating

```bash
node branding/kit/kit.mjs     # SVG, PNG, favicon.ico, manifest (needs Google Chrome)
node branding/kit/board.mjs   # presentation board
```

All geometry lives in `geometry.mjs` and the palette in `colors.mjs`.

## Open items

- **Trademark:** not checked. Run a professional search in the UAE and the other markets you plan to enter before you register the mark or print anything at scale.
- **Print colours:** confirm the CMYK and Pantone values on a physical proof.
- **App icon:** the iOS/Android icon has a full-bleed green background. Check it with your platform's mask preview.
