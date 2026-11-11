// Stage 2F: kg and price maths for products sold by weight. Grams and fils are whole numbers everywhere.
import { formatAED, type Product } from "../domain.ts";

/** "0.75" → 750 grams; 0.001–100 kg with up to 3 decimals, a dot as the separator. Anything else is null. */
export function parseKgInput(text: string): number | null {
  const value = text.trim();
  if (!/^\d{1,3}(\.\d{1,3})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const grams = Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
  return grams >= 1 && grams <= 100000 ? grams : null;
}

/** The price of `grams` at a per-kg price, rounded to whole fils and never free. */
export function priceForGrams(pricePerKgFils: number, grams: number): number {
  return Math.max(1, Math.round((pricePerKgFils * grams) / 1000));
}

/** The grams a price-label amount buys at a per-kg price, rounded and at least 1 g. */
export function gramsForPrice(priceFils: number, pricePerKgFils: number): number {
  return Math.max(1, Math.round((priceFils * 1000) / pricePerKgFils));
}

/** 4250 → "4.250 kg". */
export function formatKg(grams: number): string {
  return `${(grams / 1000).toFixed(3)} kg`;
}

/** 4000 → "AED 40.00/kg". */
export function perKgText(pricePerKgFils: number): string {
  return `${formatAED(pricePerKgFils)}/kg`;
}

/** The receipt's line text: "0.750 kg × AED 40.00/kg". */
export function weighedLineText(grams: number, pricePerKgFils: number): string {
  return `${formatKg(grams)} × ${perKgText(pricePerKgFils)}`;
}

/** Stock as the screens show it: kg for weighed products, whole units otherwise. */
export function formatStock(product: Pick<Product, "stock" | "soldByWeight">): string {
  return product.soldByWeight ? formatKg(product.stock) : String(product.stock);
}

/** A weighed line's per-kg price: the one kept on this device, else worked out from its list price and grams. */
export function linePricePerKg(line: { weightGrams?: number; pricePerKgFils?: number; unitGrossFils: number; listUnitGrossFils?: number }): number {
  if (line.pricePerKgFils) return line.pricePerKgFils;
  return Math.round(((line.listUnitGrossFils ?? line.unitGrossFils) * 1000) / (line.weightGrams || 1000));
}

/** A stock amount in kg ("250.5" → 250500 g): 0 or more, up to 3 decimals, at most 1,000,000 kg. Else null. */
export function parseKgAmount(text: string): number | null {
  const value = text.trim();
  if (!/^\d{1,7}(\.\d{1,3})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const grams = Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
  return grams <= 1_000_000_000 ? grams : null;
}
