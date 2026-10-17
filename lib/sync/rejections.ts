const REJECTION_TEXT: Record<string, string> = {
  product_sku_taken: "Another product already uses this SKU.",
  product_barcode_taken: "Another product already uses this barcode.",
  plan_limit_reached: "Your plan's product limit is reached: upgrade to Pro or archive products.",
};

/** What the owner sees for a sync rejection; codes without a friendly text are shown as they are. */
export function rejectionText(code: string): string {
  return REJECTION_TEXT[code.trim()] ?? code;
}
