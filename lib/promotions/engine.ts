// Stage 2E: the till's pricing engine (spec §5). Pure: the same cart, promotions and moment give the same prices.
import { isLive } from "./live.ts";
import { ITEM_KINDS, type Promotion } from "./types.ts";

export type CartInput = {
  key: string;
  productId?: string;
  /** The product's live category; null or absent when it has none (or it is archived). */
  categoryId?: string | null;
  name: string;
  sku?: string;
  quantity: number;
  listUnitGrossFils: number;
  /** Set by a manual line discount: that line takes no item offer (owner decision 3). */
  manualUnitGrossFils?: number;
  /** Stage 2F: a weighed line (quantity 1) takes only percent off and the basket offer. */
  weightGrams?: number;
  pricePerKgFils?: number;
};

export type PricedLine = {
  key: string;
  productId?: string;
  name: string;
  sku?: string;
  quantity: number;
  unitGrossFils: number;
  listUnitGrossFils: number;
  promotionId?: string;
  promotionName?: string;
  /** What promotions took off this line (not counting a manual discount). */
  promotionSavingFils: number;
  manual: boolean;
  weightGrams?: number;
  pricePerKgFils?: number;
};

/** A run of units that end up at one total, before it is cut into whole-fils unit prices. */
type Segment = { quantity: number; totalFils: number };
type Working = { input: CartInput; base: number; segments: Segment[]; item?: Promotion };

/** Splits a total over units in whole fils: `extra` units cost base + 1, the rest base (spec §5.4). */
export function splitWholeFils(totalFils: number, quantity: number): { quantity: number; unitGrossFils: number }[] {
  const base = Math.floor(totalFils / quantity);
  const extra = totalFils - base * quantity;
  const parts = [{ quantity: extra, unitGrossFils: base + 1 }, { quantity: quantity - extra, unitGrossFils: base }];
  return parts.filter((part) => part.quantity > 0);
}

function matches(promotion: Promotion, line: CartInput): boolean {
  if (!line.productId) return false;
  // Stage 2F: AED off each and multi-buys count items; a weighed line is not a count of items.
  if (line.weightGrams !== undefined && promotion.kind !== "percent_off") return false;
  if (promotion.targetType === "all") return true;
  if (promotion.targetType === "product") return promotion.targetId === line.productId;
  return Boolean(line.categoryId) && promotion.targetId === line.categoryId;
}

/** The segments a line becomes under one item offer, and how much they save. Never below 1 fils a unit. */
function itemSegments(promotion: Promotion, quantity: number, unit: number): { segments: Segment[]; saving: number } {
  const full = (q: number) => ({ quantity: q, totalFils: q * unit });
  if (promotion.kind === "percent_off" || promotion.kind === "amount_off") {
    const off = promotion.kind === "percent_off" ? Math.round((unit * (promotion.percent ?? 0)) / 100) : promotion.amountFils ?? 0;
    const each = Math.min(off, unit - 1);
    return { segments: [{ quantity, totalFils: quantity * (unit - each) }], saving: quantity * each };
  }
  const groupSize = promotion.kind === "multi_buy_free" ? (promotion.buyQty ?? 0) + (promotion.getQty ?? 0) : promotion.buyQty ?? 0;
  if (groupSize < 1) return { segments: [full(quantity)], saving: 0 };
  const groups = Math.floor(quantity / groupSize);
  const grouped = groups * groupSize;
  if (!groups) return { segments: [full(quantity)], saving: 0 };
  const perGroup = promotion.kind === "multi_buy_free"
    ? (promotion.getQty ?? 0) * unit
    : Math.max(0, groupSize * unit - (promotion.bundlePriceFils ?? groupSize * unit));
  const saving = Math.min(groups * perGroup, grouped * unit - grouped);
  const segments = [{ quantity: grouped, totalFils: grouped * unit - saving }];
  if (quantity > grouped) segments.push(full(quantity - grouped));
  return { segments, saving };
}

const older = (a: Promotion, b: Promotion) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/** Spreads `amount` over weights in proportion, in whole fils (largest remainder), never more than each cap. */
function spread(amount: number, weights: number[], caps: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || amount <= 0) return weights.map(() => 0);
  const raw = weights.map((weight) => (amount * weight) / sum);
  const shares = raw.map((value, index) => Math.min(Math.floor(value), caps[index]));
  let left = amount - shares.reduce((a, b) => a + b, 0);
  const order = raw.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    if (shares[index] < caps[index]) {
      shares[index] += 1;
      left -= 1;
    }
  }
  return shares;
}

export function applyPromotions(cart: CartInput[], promotions: Promotion[], now: Date): { lines: PricedLine[]; savingFils: number } {
  const live = promotions.filter((promotion) => isLive(promotion, now));
  const itemOffers = live.filter((promotion) => ITEM_KINDS.includes(promotion.kind));

  // 1. Each line: its best single item offer (none for manual-discount and custom lines).
  const working: Working[] = cart.map((input) => {
    const base = input.manualUnitGrossFils ?? input.listUnitGrossFils;
    const plain: Working = { input, base, segments: [{ quantity: input.quantity, totalFils: input.quantity * base }] };
    if (input.manualUnitGrossFils !== undefined) return plain;
    let best: { promotion: Promotion; segments: Segment[]; saving: number } | null = null;
    for (const promotion of itemOffers.filter((candidate) => matches(candidate, input))) {
      const result = itemSegments(promotion, input.quantity, base);
      if (result.saving <= 0) continue;
      if (!best || result.saving > best.saving || (result.saving === best.saving && older(promotion, best.promotion) < 0)) best = { promotion, ...result };
    }
    return best ? { input, base, segments: best.segments, item: best.promotion } : plain;
  });

  // 2. The best basket offer on the bill after item offers, spread over every segment.
  const segments = working.flatMap((line, lineIndex) => line.segments.map((segment) => ({ lineIndex, segment })));
  const billFils = segments.reduce((sum, { segment }) => sum + segment.totalFils, 0);
  const room = segments.map(({ segment }) => segment.totalFils - segment.quantity);
  const roomTotal = room.reduce((a, b) => a + b, 0);
  let basket: { promotion: Promotion; saving: number } | null = null;
  for (const promotion of live.filter((candidate) => candidate.kind === "basket_percent")) {
    if (billFils < (promotion.minBasketFils ?? 0)) continue;
    const saving = Math.min(Math.round((billFils * (promotion.percent ?? 0)) / 100), roomTotal);
    if (saving <= 0) continue;
    if (!basket || saving > basket.saving || (saving === basket.saving && older(promotion, basket.promotion) < 0)) basket = { promotion, saving };
  }
  const basketShares = basket ? spread(basket.saving, segments.map(({ segment }) => segment.totalFils), room) : segments.map(() => 0);

  // 3. Whole-fils lines with what promotions took off.
  const lines: PricedLine[] = [];
  segments.forEach(({ lineIndex, segment }, index) => {
    const line = working[lineIndex];
    const share = basketShares[index];
    // The segment's own item saving and its basket share; the line names whichever promotion took off more (spec §5.5).
    const itemSaving = line.base * segment.quantity - segment.totalFils;
    const named = itemSaving >= share ? (itemSaving > 0 ? line.item : undefined) : basket?.promotion;
    for (const part of splitWholeFils(segment.totalFils - share, segment.quantity)) {
      const saving = line.base * part.quantity - part.unitGrossFils * part.quantity;
      const promotion = saving > 0 ? named : undefined;
      lines.push({
        key: line.input.key,
        ...(line.input.productId ? { productId: line.input.productId } : {}),
        name: line.input.name,
        ...(line.input.sku ? { sku: line.input.sku } : {}),
        quantity: part.quantity,
        unitGrossFils: part.unitGrossFils,
        listUnitGrossFils: line.input.listUnitGrossFils,
        ...(promotion ? { promotionId: promotion.id, promotionName: promotion.name } : {}),
        promotionSavingFils: Math.max(0, saving),
        manual: line.input.manualUnitGrossFils !== undefined,
        ...(line.input.weightGrams !== undefined ? { weightGrams: line.input.weightGrams, ...(line.input.pricePerKgFils ? { pricePerKgFils: line.input.pricePerKgFils } : {}) } : {}),
      });
    }
  });
  return { lines, savingFils: lines.reduce((sum, line) => sum + line.promotionSavingFils, 0) };
}
