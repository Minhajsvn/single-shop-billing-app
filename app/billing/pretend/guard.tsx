import { notFound, redirect } from "next/navigation";
import { billingProvider } from "@/lib/billing/provider";
import { pretendAvailable } from "@/lib/billing/pretend-events";
import { loadOwnerBilling } from "@/lib/billing/owner-session";

/** 404 unless the pretend provider runs; sign-in for visitors; a short message for non-owners. */
export async function requirePretendOwner(): Promise<{ denied: string | null }> {
  if (!pretendAvailable(billingProvider().kind)) notFound();
  const owner = await loadOwnerBilling();
  if (owner instanceof Response) {
    if (owner.status === 401) redirect("/login");
    return { denied: "Only the shop owner can manage billing." };
  }
  return { denied: null };
}

export function TestBadge() {
  return (
    <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 999, background: "var(--warning-bg)", color: "var(--warning)", fontSize: 12, fontWeight: 600 }}>
      Test billing — no real charges
    </span>
  );
}

export const pretendShell: React.CSSProperties = { maxWidth: 420, margin: "48px auto", padding: "0 16px", display: "grid", gap: 16 };
