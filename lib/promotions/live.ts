// Stage 2E: whether a promotion applies at a moment, in Dubai time.
import type { Promotion } from "./types.ts";

type DubaiMoment = { date: string; weekday: number; minutes: number };

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const FORMAT = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function dubaiMoment(now: Date): DubaiMoment {
  const parts = Object.fromEntries(FORMAT.formatToParts(now).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: WEEKDAY[parts.weekday], minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const toMinutes = (time: string) => {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
};

function dayAllowed(promotion: Promotion, date: string, weekday: number): boolean {
  if (date < promotion.startsOn || (promotion.endsOn !== null && date > promotion.endsOn)) return false;
  return promotion.days === null || promotion.days.includes(weekday);
}

/**
 * Active, not archived, within its dates, on one of its days and inside its hours. The part of a window that crosses
 * midnight (Fri 22:00–02:00 at Sat 01:00) belongs to the day the window started.
 */
export function isLive(promotion: Promotion, now: Date): boolean {
  if (!promotion.active || promotion.archived) return false;
  const moment = dubaiMoment(now);
  if (!promotion.fromTime || !promotion.toTime) return dayAllowed(promotion, moment.date, moment.weekday);
  const from = toMinutes(promotion.fromTime);
  const to = toMinutes(promotion.toTime);
  if (from <= to) return moment.minutes >= from && moment.minutes < to && dayAllowed(promotion, moment.date, moment.weekday);
  if (moment.minutes >= from) return dayAllowed(promotion, moment.date, moment.weekday);
  if (moment.minutes < to) return dayAllowed(promotion, shiftDate(moment.date, -1), moment.weekday === 1 ? 7 : moment.weekday - 1);
  return false;
}

/** Saved state from before Stage 2E has no promotions. */
export function normalizePromotions(value: unknown): Promotion[] {
  return Array.isArray(value) ? (value as Promotion[]) : [];
}
