import type { Product } from "../domain.ts";

export type HeldLine = { productId?: string; name: string; sku?: string; quantity: number; unitGrossFils: number; listUnitGrossFils?: number; weightGrams?: number; pricePerKgFils?: number };
export type HeldCart = { id: string; heldAt: string; customerId?: string; lines: HeldLine[] };

/** Held sales are a cashier convenience on one till, not fiscal documents: they never sync. */
export const MAX_HELD_CARTS = 10;

export function heldCartsKey(deviceId: string | null): string {
  return `shop-ledger-held-carts-v1:${deviceId ?? "local"}`;
}

export function holdCart(list: HeldCart[], cart: Omit<HeldCart, "id" | "heldAt">, id: string, now: Date): { ok: true; list: HeldCart[] } | { ok: false; error: string } {
  if (!cart.lines.length) return { ok: false, error: "Add an item before holding the sale." };
  if (list.length >= MAX_HELD_CARTS) return { ok: false, error: `You can hold up to ${MAX_HELD_CARTS} sales. Resume or clear one first.` };
  return { ok: true, list: [{ ...cart, id, heldAt: now.toISOString() }, ...list] };
}

/** Takes a held sale back out, never selling beyond current stock: lines are capped or dropped with a notice. */
export function resumeCart(list: HeldCart[], id: string, products: Product[]): { ok: true; cart: HeldCart; list: HeldCart[]; notices: string[] } | { ok: false; error: string } {
  const held = list.find((cart) => cart.id === id);
  if (!held) return { ok: false, error: "That held sale is no longer available." };
  const notices: string[] = [];
  const used = new Map<string, number>();
  const lines = held.lines.flatMap((line) => {
    if (!line.productId) return [line];
    const product = products.find((candidate) => candidate.id === line.productId);
    if (!product || !product.active || product.stock < 1) {
      notices.push(`${line.name} is no longer available and was removed.`);
      return [];
    }
    // Stage 2F: a weighed line needs its grams in stock; a product switched to or from weighing since the hold is dropped.
    if (Boolean(product.soldByWeight) !== (line.weightGrams !== undefined)) {
      notices.push(`${line.name} is now sold ${product.soldByWeight ? "by weight" : "by the item"} and was removed; add it again.`);
      return [];
    }
    if (line.weightGrams !== undefined) {
      used.set(product.id, (used.get(product.id) ?? 0) + line.weightGrams);
      if (used.get(product.id)! > product.stock) {
        notices.push(`${line.name} is no longer in stock for that weight and was removed.`);
        used.set(product.id, used.get(product.id)! - line.weightGrams);
        return [];
      }
      return [line];
    }
    if (line.quantity > product.stock) {
      notices.push(`${line.name} reduced to ${product.stock} (stock changed).`);
      return [{ ...line, quantity: product.stock }];
    }
    return [line];
  });
  return { ok: true, cart: { ...held, lines }, list: list.filter((cart) => cart.id !== id), notices };
}
