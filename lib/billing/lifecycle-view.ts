import { dubaiSupplyDate } from "../invoice-numbers.ts";
import type { TillDevice } from "../snapshot/types.ts";
import type { Entitlements } from "./entitlements.ts";

export type Role = "owner" | "manager" | "cashier";
export type LifecycleState = "full" | "trial" | "grace" | "read_only";
export type BannerAction = "update_card" | "choose_plan" | null;
export type Banner = { tone: "red" | "yellow" | "grey"; text: string; action: BannerAction };
export type RegisterOpenDecision = "allow" | "read_only" | "till_paused" | "choose_till";

const DAY_MS = 86_400_000;

function dateNumber(isoDate: string): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/** Whole Dubai calendar days from `now` to `endIso`; 0 on the last day and for anything already past. */
export function dubaiDaysLeft(endIso: string, now: Date): number {
  const end = new Date(endIso);
  if (!Number.isFinite(end.getTime())) return 0;
  return Math.max(0, Math.round((dateNumber(dubaiSupplyDate(end)) - dateNumber(dubaiSupplyDate(now))) / DAY_MS));
}

/** Read-only is decided on the device clock, so a cache that still says "full" cannot outlive the access end. */
export function lifecycleState(e: Entitlements, now: Date): LifecycleState {
  if (e.access === "read_only") return "read_only";
  if (e.accessEndsAt !== null) {
    const end = new Date(e.accessEndsAt).getTime();
    if (Number.isFinite(end) && end <= now.getTime()) return "read_only";
  }
  if (e.status === "past_due") return "grace";
  if (e.status === "trialing") return "trial";
  return "full";
}

function days(n: number): string {
  return n === 1 ? "1 day" : `${n} days`;
}

export function bannerFor(input: { e: Entitlements; stale: boolean; role: Role; now: Date }): Banner | null {
  const { e, stale, role, now } = input;
  const owner = role === "owner";
  const state = lifecycleState(e, now);

  if (state === "read_only") {
    return owner
      ? { tone: "red", text: "Read-only. Sales are paused. Invoices, reports and exports still work.", action: "choose_plan" }
      : { tone: "red", text: "Read-only. Sales are paused. Ask the shop owner to renew.", action: null };
  }
  if (state === "grace") {
    const end = e.graceEndsAt ?? e.accessEndsAt;
    const left = end ? dubaiDaysLeft(end, now) : 0;
    const when = left === 0 ? "today" : `within ${days(left)}`;
    return owner
      ? { tone: "yellow", text: `Payment failed. Your card was declined. Update it ${when} to keep selling.`, action: "update_card" }
      : { tone: "yellow", text: `Payment failed. Ask the shop owner to update the card ${when}. Sales continue as normal.`, action: null };
  }
  if (stale) return { tone: "grey", text: "Connect to the internet to check your subscription.", action: null };
  if (state === "trial" && owner && !e.hasPaymentMethod) {
    const end = e.trialEndsAt ?? e.accessEndsAt;
    if (end) {
      const left = dubaiDaysLeft(end, now);
      if (left <= 4) return { tone: "grey", text: `Pro trial · ${left === 0 ? "ends today" : `${days(left)} left`} · Choose a plan`, action: "choose_plan" };
    }
  }
  return null;
}

/** Decides whether a till may open a register. An open register is never interrupted, and a stale cache alone never blocks. */
export function registerOpenDecision(input: {
  e: Entitlements; stale: boolean; device: TillDevice | null; activeTills: number; registerOpen: boolean; now: Date;
}): RegisterOpenDecision {
  const { e, device, activeTills, registerOpen, now } = input;
  if (registerOpen) return "allow";
  if (lifecycleState(e, now) === "read_only") return "read_only";
  if (device?.status === "paused") return "till_paused";
  if (e.limits.tills !== null && activeTills > e.limits.tills) return "choose_till";
  return "allow";
}

export function canWrite(state: LifecycleState, registerOpen: boolean): boolean {
  return state !== "read_only" || registerOpen;
}
