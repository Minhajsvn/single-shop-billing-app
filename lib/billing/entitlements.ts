import { z } from "zod";
import { PLANS, type FeatureKey, type PlanId } from "./plans.ts";

const FEATURE_KEYS = [...new Set(Object.values(PLANS).flatMap((plan) => plan.features))] as [FeatureKey, ...FeatureKey[]];
const PLAN_IDS = Object.keys(PLANS) as [PlanId, ...PlanId[]];
const limit = z.number().int().nonnegative().nullable();

const entitlementsSchema = z.object({
  planId: z.enum(PLAN_IDS).nullable(),
  status: z.enum(["trialing", "active", "past_due", "canceled"]).nullable(),
  access: z.enum(["full", "read_only"]),
  trialEndsAt: z.string().nullable(),
  graceEndsAt: z.string().nullable(),
  // Stage 1F fields default so entitlement caches written earlier still parse.
  accessEndsAt: z.string().nullable().default(null),
  cancelAt: z.string().nullable().default(null),
  hasPaymentMethod: z.boolean().default(false),
  billingInterval: z.enum(["month", "year"]).nullable().default(null),
  features: z.array(z.enum(FEATURE_KEYS)),
  limits: z.object({ branches: limit, tills: limit, members: limit, products: limit }),
});

export type Entitlements = z.infer<typeof entitlementsSchema>;

export const READ_ONLY_ENTITLEMENTS: Entitlements = {
  planId: null, status: null, access: "read_only", trialEndsAt: null, graceEndsAt: null,
  accessEndsAt: null, cancelAt: null, hasPaymentMethod: false, billingInterval: null, features: [],
  limits: { branches: 0, tills: 0, members: 0, products: 0 },
};

export function parseEntitlements(input: unknown): Entitlements {
  return entitlementsSchema.parse(input);
}

export function hasFeature(entitlements: Entitlements, feature: FeatureKey): boolean {
  return entitlements.access === "full" && entitlements.features.includes(feature);
}
