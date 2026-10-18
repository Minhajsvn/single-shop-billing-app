/** EAN-13 check: 13 digits whose last digit matches the weighted (1,3,1,3…) checksum of the first 12. */
export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  let sum = 0;
  for (let index = 0; index < 12; index++) sum += Number(code[index]) * (index % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(code[12]);
}

const EAN_L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const EAN_R = EAN_L.map((code) => [...code].map((bit) => bit === "0" ? "1" : "0").join(""));
const EAN_G = EAN_R.map((code) => [...code].reverse().join(""));
// Parity of the six left-hand digits, chosen by the leading digit.
const EAN_PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

/** EAN-13 as 95 modules ("1" = bar, "0" = space), guards included. */
export function ean13Modules(code: string): string {
  if (!isValidEan13(code)) throw new RangeError(`Not a valid EAN-13: ${code}`);
  const digits = [...code].map(Number);
  const parity = EAN_PARITY[digits[0]];
  const left = digits.slice(1, 7).map((digit, index) => (parity[index] === "L" ? EAN_L : EAN_G)[digit]).join("");
  const right = digits.slice(7).map((digit) => EAN_R[digit]).join("");
  return `101${left}01010${right}101`;
}

// Code 128 bar/space widths for values 0–106 (106 = stop, with its trailing 2-module bar).
const CODE128_WIDTHS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];
const START_B = 104;
const STOP = 106;

function widthsToModules(widths: string): string {
  return [...widths].map((width, index) => (index % 2 === 0 ? "1" : "0").repeat(Number(width))).join("");
}

/** Code 128 set B (printable ASCII 32–126) as modules, with start, mod-103 check symbol and stop. */
export function code128Modules(text: string): string {
  if (!text) throw new RangeError("Code 128 needs at least one character");
  const values = [...text].map((char) => {
    const code = char.charCodeAt(0);
    if (code < 32 || code > 126) throw new RangeError(`Code 128B cannot encode "${char}"`);
    return code - 32;
  });
  const check = values.reduce((sum, value, index) => sum + value * (index + 1), START_B) % 103;
  return [START_B, ...values, check, STOP].map((value) => widthsToModules(CODE128_WIDTHS[value])).join("");
}

/**
 * What a product's label prints: its EAN-13 when valid, otherwise Code 128 of the barcode, or of the SKU when it
 * has none. Null when the code has characters a label barcode cannot carry (Arabic, a non-breaking space…).
 */
export function barcodeFor(product: { barcode?: string; sku: string }): { symbology: "ean13" | "code128"; value: string; modules: string } | null {
  const value = product.barcode?.trim() || product.sku.trim();
  if (isValidEan13(value)) return { symbology: "ean13", value, modules: ean13Modules(value) };
  if (!/^[\x20-\x7E]+$/.test(value)) return null;
  return { symbology: "code128", value, modules: code128Modules(value) };
}
