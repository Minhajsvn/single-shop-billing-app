// Stage 2F: how this shop's counter scale lays out its barcode labels (a shop setting, sent in the snapshot).

/** Prefixes: two-digit label starts (20–29). codeLength: the item code's digits. value: what the value digits hold. */
export type ScaleLabelSettings = { prefixes: string[]; codeLength: 4 | 5 | 6; value: "weight" | "price" };

export const DEFAULT_SCALE_LABEL: ScaleLabelSettings = { prefixes: ["21", "22"], codeLength: 5, value: "weight" };

/** The setting as the server would accept it (1–10 distinct prefixes 20–29, length 4–6); anything else is the default. */
export function normalizeScaleLabel(raw: unknown): ScaleLabelSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_SCALE_LABEL;
  const { prefixes, codeLength, value } = raw as Record<string, unknown>;
  if (!Array.isArray(prefixes) || prefixes.length < 1 || prefixes.length > 10) return DEFAULT_SCALE_LABEL;
  if (!prefixes.every((prefix) => typeof prefix === "string" && /^2\d$/.test(prefix)) || new Set(prefixes).size !== prefixes.length) return DEFAULT_SCALE_LABEL;
  if (codeLength !== 4 && codeLength !== 5 && codeLength !== 6) return DEFAULT_SCALE_LABEL;
  if (value !== "weight" && value !== "price") return DEFAULT_SCALE_LABEL;
  return { prefixes: [...prefixes] as string[], codeLength, value };
}
