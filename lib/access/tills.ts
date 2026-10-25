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

/** The in-app confirm dialog shown before an owner pauses a till. */
export function pauseTillPrompt(tillNumber: number): { title: string; body: string } {
  return { title: `Pause Till ${tillNumber}?`, body: "It stops selling until you resume it. A shift already open on it can still finish." };
}
