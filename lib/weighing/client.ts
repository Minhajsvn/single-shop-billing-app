// Stage 2F: the Settings → Scale labels tab: saving the layout (online, owner, Pro) and its test box.
import { findWeighedByScaleCode } from "../checkout/lookup.ts";
import { formatAED, type Product } from "../domain.ts";
import { formatKg, gramsForPrice, priceForGrams } from "./kg.ts";
import { parseScaleLabel } from "./label.ts";
import type { ScaleLabelSettings } from "./types.ts";

type Deps = { fetch?: typeof fetch };

const ERRORS: Record<string, string> = {
  invalid_scale_label: "Check the prefixes (20–29) and item code length (4–6).",
  feature_not_in_plan: "Scale labels are part of the Pro plan.",
  not_owner: "Only the shop owner can change scale labels.",
};

export async function saveScaleLabel(settings: ScaleLabelSettings, deps: Deps = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)("/api/v1/business/scale-label", { method: "PUT", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
  } catch {
    return { ok: false, error: "Scale label settings need a connection" };
  }
  if (response.ok) return { ok: true };
  const body = (await response.json().catch(() => null)) as { code?: string } | null;
  return { ok: false, error: ERRORS[body?.code ?? ""] ?? "The scale label settings could not be saved. Try again." };
}

/** What a scanned label would add with these settings: "Item 01234 → Medjool Dates · 0.750 kg · AED 30.00", or why not. */
export function describeTest(code: string, settings: ScaleLabelSettings, products: Product[]): string {
  if (!code.trim()) return "";
  const label = parseScaleLabel(code, settings);
  if ("error" in label) {
    if (label.error === "not_scale") return "Not a scale label for these settings";
    if (label.error === "bad_check_digit") return "This label did not scan cleanly; scan again";
    if (label.error === "no_value") return "This label has no weight or price";
    return "This label is over 100 kg";
  }
  const item = `Item ${String(label.scaleCode).padStart(settings.codeLength, "0")}`;
  const product = findWeighedByScaleCode(products, label.scaleCode);
  if (!product) return `${item} → no weighed product has this scale code`;
  const grams = label.kind === "weight" ? label.grams : gramsForPrice(label.priceFils, product.priceFils);
  const price = label.kind === "price" ? label.priceFils : priceForGrams(product.priceFils, grams);
  return `${item} → ${product.name} · ${formatKg(grams)} · ${formatAED(price)}`;
}
