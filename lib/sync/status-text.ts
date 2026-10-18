export type SyncTone = "ok" | "busy" | "offline" | "attention" | "sample";

/**
 * The one-line sync status shown in the sidebar user menu and the phone More sheet.
 * Order: sample shop, then anything refused (it needs the owner), then offline, then syncing, then all synced.
 */
export function syncStatus(input: { mode: "hosted" | "sample" | "unconfigured"; online: boolean; pending: number; needAttention: number; syncing: boolean }): { text: string; tone: SyncTone; attention: boolean } {
  if (input.mode !== "hosted") return { text: "Sample shop · not synced", tone: "sample", attention: false };
  if (input.needAttention > 0) return { text: `${input.needAttention} need attention`, tone: "attention", attention: true };
  if (!input.online) return { text: input.pending ? `Offline · ${input.pending} waiting` : "Offline · all saved", tone: "offline", attention: false };
  if (input.pending > 0 || input.syncing) return { text: `Syncing · ${input.pending} left`, tone: "busy", attention: false };
  return { text: "Online · all synced", tone: "ok", attention: false };
}
