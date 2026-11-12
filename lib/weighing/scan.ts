// Stage 2F: what the till does with a scanned code that matched no barcode or SKU. Only a shop that sells something by
// weight reads scale labels; anywhere else the code stays an ordinary unknown code (final review I2).
import { findWeighedByScaleCode } from "../checkout/lookup.ts";
import type { Product } from "../domain.ts";
import { gramsForPrice } from "./kg.ts";
import { MAX_LINE_GRAMS, parseScaleLabel } from "./label.ts";
import type { ScaleLabelSettings } from "./types.ts";

export type ScanOutcome =
  | { kind: "none" }
  | { kind: "notice"; text: string }
  | { kind: "add"; product: Product; grams: number; labelPriceFils?: number };

export function scanScaleLabel(code: string, settings: ScaleLabelSettings, products: Product[]): ScanOutcome {
  if (!products.some((product) => product.active && product.soldByWeight)) return { kind: "none" };
  const label = parseScaleLabel(code, settings);
  if ("error" in label) {
    if (label.error === "not_scale") return { kind: "none" };
    if (label.error === "bad_check_digit") return { kind: "notice", text: "This label did not scan cleanly; scan again" };
    if (label.error === "no_value") return { kind: "notice", text: "This label has no weight or price; weigh it again" };
    return { kind: "notice", text: "This label is over 100 kg; weigh it again" };
  }
  const product = findWeighedByScaleCode(products, label.scaleCode);
  if (!product) return { kind: "notice", text: `No weighed product with scale code ${String(label.scaleCode).padStart(settings.codeLength, "0")}` };
  if (label.kind === "weight") return { kind: "add", product, grams: label.grams };
  const grams = gramsForPrice(label.priceFils, product.priceFils);
  if (grams > MAX_LINE_GRAMS) return { kind: "notice", text: "This label is over 100 kg; weigh it again" };
  return { kind: "add", product, grams, labelPriceFils: label.priceFils };
}
