"use client";

import { Sparkle } from "@/components/icons";
import type { ReactNode } from "react";
import { useEntitlement } from "@/components/billing/use-entitlement";
import type { FeatureKey } from "@/lib/billing/plans";

/**
 * Renders children when the plan includes the feature and the feature is built.
 * Stage 1 builds none of the Pro features, so they show "Coming soon" (parent spec, Stage 1).
 */
export function FeatureGate({ feature, built = false, children }: { feature: FeatureKey; built?: boolean; children: ReactNode }) {
  const { hasFeature } = useEntitlement();
  if (built && hasFeature(feature)) return <>{children}</>;
  return (
    <div className="feature-gate" role="note">
      <Sparkle size={16} weight="bold" />
      <span>{built ? "Not included in your plan." : "Coming soon"}</span>
    </div>
  );
}
