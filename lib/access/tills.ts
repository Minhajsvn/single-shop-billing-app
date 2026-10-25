import type { Role } from "./cashier.ts";

export type TillRow = { id: string; status: string; tillNumber: number };
export type TillAction = "pause" | "resume" | null;

/** The button a till row shows on Settings -> Tills. Owners only; the shop's last active till cannot be paused. */
export function tillRowAction(role: Role, till: TillRow, devices: TillRow[]): TillAction {
  if (role !== "owner") return null;
  if (till.status === "paused") return "resume";
  if (till.status !== "active") return null;
  const othersActive = devices.some((item) => item.id !== till.id && item.status === "active");
  return othersActive ? "pause" : null;
}

export function resumeLimitMessage(limit: number): string {
  return `Your plan allows ${limit === 1 ? "1 till" : `${limit} tills`}. Pause another till first or upgrade.`;
}

/**
 * The tills the "Choose which tills stay" card starts with: this browser's till first (when it is active), then the
 * others in order, up to the plan's till limit. A shop always keeps one selling till, so a limit below 1 keeps 1.
 */
export function initialKeptTills(active: TillRow[], thisDeviceId: string | undefined, limit: number): string[] {
  const ordered = [...active.filter((item) => item.id === thisDeviceId), ...active.filter((item) => item.id !== thisDeviceId)];
  return ordered.slice(0, Math.max(limit, 1)).map((item) => item.id);
}

/** Tapping a till: a kept one is let go; another is kept while there is room. With a limit of one it swaps. */
export function toggleKeptTill(keep: string[], id: string, limit: number): string[] {
  if (keep.includes(id)) return keep.filter((item) => item !== id);
  const max = Math.max(limit, 1);
  if (max === 1) return [id];
  return keep.length < max ? [...keep, id] : keep;
}

export function keepTillsButton(count: number): string {
  return count > 1 ? `Keep these ${count} tills` : "Keep this till";
}

/** The in-app confirm dialog shown before an owner pauses a till. */
export function pauseTillPrompt(tillNumber: number): { title: string; body: string } {
  return { title: `Pause Till ${tillNumber}?`, body: "It stops selling until you resume it. A shift already open on it can still finish." };
}
