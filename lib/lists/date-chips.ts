import { dubaiSupplyDate } from "../invoice-numbers.ts";

export type DateChip = "last30" | "today" | "year" | "all";
export const DATE_CHIPS: { chip: DateChip; label: string }[] = [
  { chip: "last30", label: "Last 30 days" },
  { chip: "today", label: "Today" },
  { chip: "year", label: "This year" },
  { chip: "all", label: "All" },
];
/** Days of sales the browser keeps (HISTORY_DAYS in the snapshot route). */
export const LOCAL_HISTORY_DAYS = 90;

/** A Dubai business date (YYYY-MM-DD) moved by whole days. */
function shiftDate(date: string, days: number): string {
  const moved = new Date(`${date}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

/** The Dubai business-date range a chip covers; from is null for "All". */
export function chipRange(chip: DateChip, now: Date): { from: string | null; to: string } {
  const today = dubaiSupplyDate(now);
  if (chip === "today") return { from: today, to: today };
  if (chip === "last30") return { from: shiftDate(today, -29), to: today };
  if (chip === "year") return { from: `${today.slice(0, 4)}-01-01`, to: today };
  return { from: null, to: today };
}

/** This year and All reach beyond the 90 days the browser holds, so they search the server. */
export function chipIsServer(chip: DateChip): boolean {
  return chip === "year" || chip === "all";
}

/** The range the browser can answer on its own (the fall-back when the server cannot be reached). */
export function localHistoryRange(now: Date): { from: string; to: string } {
  const today = dubaiSupplyDate(now);
  return { from: shiftDate(today, -(LOCAL_HISTORY_DAYS - 1)), to: today };
}
