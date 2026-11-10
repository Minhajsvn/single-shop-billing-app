// Stage 2D: refusal codes from the purchasing functions, in the owner's words. Some carry a detail from the server:
// stock_too_low "<name>:<stock>", duplicate_supplier_invoice "<earlier date>", product_archived "<name>".
const MESSAGES: Record<string, string> = {
  feature_not_in_plan: "Suppliers and deliveries are on the Pro plan.",
  not_authorized: "Only the owner or a manager can manage purchases.",
  invalid_supplier: "Check the supplier: a name of up to 80 characters, and a TRN of 15 digits if given.",
  supplier_name_taken: "A supplier with this name already exists.",
  supplier_not_found: "This supplier is not available. Choose another.",
  invalid_receipt: "Check the delivery: 1 to 200 lines, whole quantities and costs within the limits.",
  duplicate_line: "A product appears twice; combine the lines.",
  product_not_found: "A product on this delivery no longer exists.",
  product_archived: "Restore the archived product first.",
  duplicate_supplier_invoice: "This supplier invoice is already recorded.",
  invalid_vat: "VAT cannot be more than the net amount.",
  receipt_not_found: "This delivery could not be found.",
  already_voided: "This delivery is already voided.",
  invalid_reason: "Give a reason of up to 200 characters.",
  stock_too_low: "Too much of this delivery has been sold to void it; record a correction in Inventory instead.",
  invalid_range: "Choose a period within 92 days.",
};

export const PURCHASING_CODES = Object.keys(MESSAGES);

export function purchasingErrorMessage(code: string, detail?: string): string {
  if (detail && code === "stock_too_low") {
    const split = detail.lastIndexOf(":");
    return `${detail.slice(0, split)}: only ${detail.slice(split + 1)} left; record a correction in Inventory instead.`;
  }
  if (detail && code === "duplicate_supplier_invoice") return `This supplier invoice is already recorded on ${detail}.`;
  if (detail && code === "product_archived") return `Restore ${detail} first.`;
  return MESSAGES[code] ?? "Something went wrong. Try again.";
}

export function purchasingErrorStatus(code: string): number {
  if (code === "not_authorized" || code === "feature_not_in_plan") return 403;
  if (code.endsWith("_not_found")) return 404;
  return MESSAGES[code] ? 400 : 500;
}
