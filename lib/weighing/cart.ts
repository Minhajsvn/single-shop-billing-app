// Stage 2F: weighed lines in the till's cart. Each weighing is its own line of quantity 1 (never merged).
import type { Product } from "../domain.ts";
import { priceForGrams } from "./kg.ts";

/** How much of a product the cart already takes: grams for weighed lines, units for the rest. */
export function cartUsage(lines: ReadonlyArray<{ productId?: string; quantity: number; weightGrams?: number }>, productId: string): number {
  return lines.reduce((sum, line) => sum + (line.productId === productId ? line.weightGrams ?? line.quantity : 0), 0);
}

/** A cart line for `grams` of a weighed product; a price label passes its own printed price. */
export function weighedLine(product: Product, grams: number, labelPriceFils?: number) {
  return {
    key: crypto.randomUUID(),
    productId: product.id,
    name: product.name,
    sku: product.sku,
    quantity: 1,
    unitGrossFils: labelPriceFils ?? priceForGrams(product.priceFils, grams),
    weightGrams: grams,
    pricePerKgFils: product.priceFils,
  };
}
