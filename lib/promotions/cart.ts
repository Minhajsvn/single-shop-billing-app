// Stage 2E: between the till's cart and the pricing engine. The cart keeps list prices and manual discounts; the
// engine's priced lines are what is shown, charged and recorded.
import type { Category, Product } from "../domain.ts";
import type { CartInput, PricedLine } from "./engine.ts";

/** A cart line as the till holds it: `listUnitGrossFils` is set only by a manual discount. */
type TillLine = { key: string; productId?: string; name: string; sku?: string; quantity: number; unitGrossFils: number; listUnitGrossFils?: number };

export function toCartInputs(cart: TillLine[], products: Product[], categories: Category[]): CartInput[] {
  const live = new Set(categories.filter((category) => !category.archived).map((category) => category.id));
  const byId = new Map(products.map((product) => [product.id, product]));
  return cart.map((line) => {
    const categoryId = line.productId ? byId.get(line.productId)?.categoryId ?? null : null;
    return {
      key: line.key,
      ...(line.productId ? { productId: line.productId } : {}),
      categoryId: categoryId && live.has(categoryId) ? categoryId : null,
      name: line.name,
      ...(line.sku ? { sku: line.sku } : {}),
      quantity: line.quantity,
      listUnitGrossFils: line.listUnitGrossFils ?? line.unitGrossFils,
      ...(line.listUnitGrossFils !== undefined ? { manualUnitGrossFils: line.unitGrossFils } : {}),
    };
  });
}

/** What completeSale receives: the list price only when the line costs less, and the promotion when one priced it. */
export function checkoutLines(lines: PricedLine[]) {
  return lines.map((line) => ({
    ...(line.productId ? { productId: line.productId } : {}),
    name: line.name,
    ...(line.sku ? { sku: line.sku } : {}),
    quantity: line.quantity,
    unitGrossFils: line.unitGrossFils,
    ...(line.unitGrossFils < line.listUnitGrossFils ? { listUnitGrossFils: line.listUnitGrossFils } : {}),
    ...(line.promotionId ? { promotionId: line.promotionId, promotionName: line.promotionName, promotionSavingFils: line.promotionSavingFils } : {}),
  }));
}

/** One cart item's priced total, what promotions took off it, and the promotion's name for the cart line. */
export function itemSummary(lines: PricedLine[], key: string): { totalFils: number; savingFils: number; promotionName: string | undefined } {
  const own = lines.filter((line) => line.key === key);
  return {
    totalFils: own.reduce((sum, line) => sum + line.unitGrossFils * line.quantity, 0),
    savingFils: own.reduce((sum, line) => sum + line.promotionSavingFils, 0),
    promotionName: own.find((line) => line.promotionName)?.promotionName,
  };
}
