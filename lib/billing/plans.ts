export type FeatureKey =
  | "staff_roles"
  | "weighed_items"
  | "serial_tracking"
  | "split_payment"
  | "promotions"
  | "purchasing"
  | "categories_margin"
  | "advanced_reports"
  | "digital_receipts"
  | "repairs"
  | "customer_credit"
  | "loyalty"
  | "multi_branch"
  | "accounting_export"
  | "api_access"
  | "audit_log"
  | "sso";

export type PlanId = "starter" | "pro" | "business" | "enterprise";

export type PlanLimits = { branches: number | null; tills: number | null; members: number | null; products: number | null };

export type Plan = {
  id: PlanId;
  name: string;
  selfServe: boolean;
  monthlyPriceMinor: { AED: number; SAR: number } | null;
  annualPriceMinor: { AED: number; SAR: number } | null;
  features: FeatureKey[];
  limits: PlanLimits;
};

const PRO_FEATURES: FeatureKey[] = [
  "staff_roles",
  "weighed_items",
  "serial_tracking",
  "split_payment",
  "promotions",
  "purchasing",
  "categories_margin",
  "advanced_reports",
  "digital_receipts",
];

const BUSINESS_FEATURES: FeatureKey[] = [
  ...PRO_FEATURES,
  "repairs",
  "customer_credit",
  "loyalty",
  "multi_branch",
  "accounting_export",
  "api_access",
  "audit_log",
];

export const PLANS: Record<PlanId, Plan> = {
  starter: { id: "starter", name: "Starter", selfServe: true, monthlyPriceMinor: { AED: 9900, SAR: 9900 }, annualPriceMinor: { AED: 99000, SAR: 99000 }, features: [], limits: { branches: 1, tills: 1, members: 2, products: 5000 } },
  pro: { id: "pro", name: "Pro", selfServe: true, monthlyPriceMinor: { AED: 17900, SAR: 17900 }, annualPriceMinor: { AED: 179000, SAR: 179000 }, features: PRO_FEATURES, limits: { branches: 1, tills: 2, members: 5, products: null } },
  business: { id: "business", name: "Business", selfServe: true, monthlyPriceMinor: { AED: 34900, SAR: 34900 }, annualPriceMinor: { AED: 349000, SAR: 349000 }, features: BUSINESS_FEATURES, limits: { branches: 3, tills: 6, members: 20, products: null } },
  enterprise: { id: "enterprise", name: "Enterprise", selfServe: false, monthlyPriceMinor: null, annualPriceMinor: null, features: [...BUSINESS_FEATURES, "sso"], limits: { branches: null, tills: null, members: null, products: null } },
};

export const ADDON_PRICES = {
  till: { AED: 4900, SAR: 4900 },
  branch: { AED: 12900, SAR: 12900 },
} as const;

export const TRIAL_PLAN: PlanId = "pro";
export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 7;

export function planHasFeature(planId: PlanId, feature: FeatureKey): boolean {
  return PLANS[planId].features.includes(feature);
}

export const STARTER_VAT_RATE = 0.05;

// Prices are shown before VAT; VAT is rounded half-up to the fil.
export function priceWithVat(minor: number): { netMinor: number; vatMinor: number; grossMinor: number } {
  const vatMinor = Math.round(minor * STARTER_VAT_RATE);
  return { netMinor: minor, vatMinor, grossMinor: minor + vatMinor };
}
