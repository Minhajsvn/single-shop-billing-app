const REJECTION_TEXT: Record<string, string> = {
  product_sku_taken: "Another product already uses this SKU.",
  product_barcode_taken: "Another product already uses this barcode.",
  category_name_taken: "A category with this name already exists",
  category_not_found: "This product's category has not reached the server; sync again.",
  invalid_category: "Category names need 1 to 40 characters.",
  plan_limit_reached: "Your plan's product limit is reached: upgrade to Pro or archive products.",
  weight_mismatch: "This till is out of date for a product sold by weight. Reload the till and sell it again.",
  scale_code_taken: "That scale code is already used by another product.",
  invalid_scale_code: "Scale codes are whole numbers from 1 to 999999.",
  weight_switch_needs_zero_stock: "Set stock to 0 before changing how this product is sold.",
  feature_not_in_plan: "This needs the Pro plan.",
};

/** What the owner sees for a sync rejection; codes without a friendly text are shown as they are. */
export function rejectionText(code: string): string {
  return REJECTION_TEXT[code.trim()] ?? code;
}
