const REJECTION_TEXT: Record<string, string> = {
  product_sku_taken: "Another product already uses this SKU.",
  product_barcode_taken: "Another product already uses this barcode.",
  category_name_taken: "A category with this name already exists",
  category_not_found: "This product's category has not reached the server; sync again.",
  invalid_category: "Category names need 1 to 40 characters.",
  plan_limit_reached: "Your plan's product limit is reached: upgrade to Pro or archive products.",
};

/** What the owner sees for a sync rejection; codes without a friendly text are shown as they are. */
export function rejectionText(code: string): string {
  return REJECTION_TEXT[code.trim()] ?? code;
}
