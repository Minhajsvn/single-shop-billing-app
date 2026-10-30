export type StatusTone = "green" | "red" | "yellow" | "blue";

/** Colour for a shop's status line (the plain-words text from shopStatusText): trials and granted plans blue, trouble red or yellow, the rest green. */
export function statusTone(text: string): StatusTone {
  if (text.startsWith("Read-only")) return "red";
  if (text.startsWith("Payment failed")) return "yellow";
  if (text.startsWith("Pro trial") || text.includes("provided by Shop Ledger")) return "blue";
  return "green";
}

/** A soft-dot pill showing a shop's status text. */
export function StatusPill({ text }: { text: string }) {
  return <span className={`badge ${statusTone(text)}`} title={text}><span className="admin-pill-text">{text}</span></span>;
}
