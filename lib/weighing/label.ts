// Stage 2F: reading a label printed by a counter scale. Layout: 2 prefix digits, the item (scale) code, the value
// digits (grams or fils), and an EAN-13 check digit.
import { isValidEan13 } from "../catalogue/barcode.ts";
import type { ScaleLabelSettings } from "./types.ts";

export type ScaleLabel =
  | { kind: "weight"; scaleCode: number; grams: number }
  | { kind: "price"; scaleCode: number; priceFils: number }
  | { error: "not_scale" | "bad_check_digit" | "no_value" | "too_heavy" };

/** The most a till line can weigh (100 kg), as the server allows. */
export const MAX_LINE_GRAMS = 100000;

export function parseScaleLabel(code: string, settings: ScaleLabelSettings): ScaleLabel {
  const value = code.trim();
  if (!/^\d{13}$/.test(value) || !settings.prefixes.includes(value.slice(0, 2))) return { error: "not_scale" };
  const scaleCode = Number(value.slice(2, 2 + settings.codeLength));
  if (scaleCode < 1) return { error: "not_scale" };
  if (!isValidEan13(value)) return { error: "bad_check_digit" };
  const amount = Number(value.slice(2 + settings.codeLength, 12));
  if (amount < 1) return { error: "no_value" };
  if (settings.value === "price") return { kind: "price", scaleCode, priceFils: amount };
  if (amount > MAX_LINE_GRAMS) return { error: "too_heavy" };
  return { kind: "weight", scaleCode, grams: amount };
}
