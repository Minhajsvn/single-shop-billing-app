// Stage 2E: refusal codes from the promotion functions, in the owner's words.
const MESSAGES: Record<string, string> = {
  feature_not_in_plan: "Promotions are on the Pro plan.",
  not_authorized: "Only the owner or a manager can manage promotions.",
  invalid_promotion: "Check the promotion: the values, dates and hours must make sense.",
  target_not_found: "That product or category is not in this shop.",
  invalid_range: "Choose a period within 92 days.",
};

export const PROMOTION_CODES = Object.keys(MESSAGES);

export function promotionErrorMessage(code: string): string {
  return MESSAGES[code] ?? "Something went wrong. Try again.";
}

export function promotionErrorStatus(code: string): number {
  if (code === "not_authorized" || code === "feature_not_in_plan") return 403;
  if (code === "target_not_found") return 404;
  return MESSAGES[code] ? 400 : 500;
}
