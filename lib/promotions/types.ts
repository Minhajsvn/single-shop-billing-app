// Stage 2E: a promotion as the till and the manage page use it (camelCase of the promotions row).
export type PromotionKind = "percent_off" | "amount_off" | "multi_buy_free" | "multi_buy_price" | "basket_percent";
export type PromotionTarget = "product" | "category" | "all";

export type Promotion = {
  id: string;
  name: string;
  kind: PromotionKind;
  targetType: PromotionTarget;
  targetId: string | null;
  percent: number | null;
  amountFils: number | null;
  buyQty: number | null;
  getQty: number | null;
  bundlePriceFils: number | null;
  minBasketFils: number | null;
  /** Dubai dates, inclusive. */
  startsOn: string;
  endsOn: string | null;
  /** ISO weekdays 1 (Mon) … 7 (Sun); null = every day. */
  days: number[] | null;
  /** "HH:MM"; both or neither. A window may cross midnight (22:00–02:00). */
  fromTime: string | null;
  toTime: string | null;
  active: boolean;
  archived: boolean;
  createdAt: string;
};

export const ITEM_KINDS: PromotionKind[] = ["percent_off", "amount_off", "multi_buy_free", "multi_buy_price"];
