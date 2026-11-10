// Stage 2C: refusal codes from set_product_cost, product_costs and profit_report, in the owner's words.
const MESSAGES: Record<string, string> = {
  feature_not_in_plan: "Cost and profit are on the Pro plan.",
  not_authorized: "Only the owner or a manager can see cost and profit.",
  product_not_found: "Saved. The cost will save once this product has synced; open it again to retry.",
  invalid_cost: "Enter a cost between 0 and 1,000,000 AED.",
  invalid_range: "Choose a period within 92 days.",
};

export const PROFIT_CODES = Object.keys(MESSAGES);

export function profitErrorMessage(code: string): string {
  return MESSAGES[code] ?? "Something went wrong. Try again.";
}

/** HTTP status for a refusal code. */
export function profitErrorStatus(code: string): number {
  if (code === "not_authorized" || code === "feature_not_in_plan") return 403;
  if (code === "product_not_found") return 404;
  return MESSAGES[code] ? 400 : 500;
}
