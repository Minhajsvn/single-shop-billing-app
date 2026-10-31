import { GRACE_DAYS, PLANS, TRIAL_DAYS, TRIAL_PLAN } from "./plans.ts";

function aed(minor: number): string {
  return `AED ${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** Public-page wording for the Starter price and the trial, read from the plan constants. No VAT line. */
export const PRICE_TEXT = {
  monthly: `${aed(PLANS.starter.monthlyPriceMinor?.AED ?? 0)} / month`,
  annual: `${aed(PLANS.starter.annualPriceMinor?.AED ?? 0)} / year (2 months free)`,
  trial: `${TRIAL_DAYS}-day ${PLANS[TRIAL_PLAN].name} trial, no card needed`,
  trialDays: TRIAL_DAYS,
  graceDays: GRACE_DAYS,
  planName: PLANS.starter.name,
  trialPlanName: PLANS[TRIAL_PLAN].name,
};
