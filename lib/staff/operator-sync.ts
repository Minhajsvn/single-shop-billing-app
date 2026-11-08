// Which synced operations carry a person behind the PIN, so the sync route only makes the extra
// apply_operator_sync call when there is something to record (spec 2A §4.3).

const FIELDS = [
  "operatorMemberId",
  "approvedByMemberId",
  "openedOperatorMemberId",
  "openedApprovedByMemberId",
  "closedOperatorMemberId",
  "closedApprovedByMemberId",
] as const;

type Op = { entity: string; payload?: unknown };

function record(op: Op): Record<string, unknown> | null {
  const payload = op.payload as Record<string, unknown> | undefined;
  if (!payload || typeof payload !== "object") return null;
  const pick = (key: string) => (payload[key] && typeof payload[key] === "object" ? (payload[key] as Record<string, unknown>) : null);
  switch (op.entity) {
    case "sale": return pick("sale");
    case "credit-note": return pick("creditNote");
    case "stock": return pick("movement");
    case "register": return payload.action === "adjustment" ? pick("adjustment") : pick("register");
    default: return null;
  }
}

export function carriesOperator(op: Op): boolean {
  const rec = record(op);
  return !!rec && FIELDS.some((field) => typeof rec[field] === "string" && rec[field] !== "");
}
