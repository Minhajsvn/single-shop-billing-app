// Stage 2E: a promotion in plain words, for the list and the form's preview.
import { formatAED } from "../domain.ts";
import type { Promotion } from "./types.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const dayMonth = (date: string) => {
  const [, month, day] = date.split("-").map(Number);
  return { day, month: MONTHS[month - 1] };
};
const pct = (value: number | null) => `${Number(value ?? 0).toString()}%`;

function when(p: Promotion): string {
  const start = dayMonth(p.startsOn);
  if (!p.endsOn) return `from ${start.day} ${start.month}`;
  const end = dayMonth(p.endsOn);
  if (p.startsOn.slice(0, 7) === p.endsOn.slice(0, 7)) return `${start.day}–${end.day} ${end.month}`;
  return `${start.day} ${start.month}–${end.day} ${end.month}`;
}

function hours(p: Promotion): string | null {
  const days = p.days?.length ? [...p.days].sort((a, b) => a - b).map((day) => DAYS[day - 1]).join(", ") : null;
  const time = p.fromTime && p.toTime ? `${p.fromTime}–${p.toTime}` : null;
  if (days && time) return `${days} ${time}`;
  if (days) return days;
  if (time) return `every day ${time}`;
  return null;
}

/** e.g. "Buy 2 get 1 free on Cola 330ml · 1–30 Nov · Fri 16:00–19:00". `targetName` is the product or category name. */
export function describePromotion(p: Promotion, targetName: string): string {
  const target = p.targetType === "all" ? "everything" : targetName;
  const what = p.kind === "percent_off" ? `${pct(p.percent)} off ${target}`
    : p.kind === "amount_off" ? `${formatAED(p.amountFils ?? 0)} off ${target}`
      : p.kind === "multi_buy_free" ? `Buy ${p.buyQty} get ${p.getQty} free on ${target}`
        : p.kind === "multi_buy_price" ? `${p.buyQty} for ${formatAED(p.bundlePriceFils ?? 0)} on ${target}`
          : `${pct(p.percent)} off bills of ${formatAED(p.minBasketFils ?? 0)} or more`;
  return [what, when(p), hours(p)].filter(Boolean).join(" · ").replace(/\u00a0/g, " ");
}
