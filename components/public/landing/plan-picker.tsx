"use client";

import Link from "next/link";
import { useState } from "react";
import { PLANS, TRIAL_DAYS } from "@/lib/billing/plans";

const aed = (minor: number) => (minor / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

const OPTIONS = [
  {
    id: "monthly",
    name: "Monthly",
    figure: `AED ${aed(PLANS.starter.monthlyPriceMinor?.AED ?? 0)}`,
    period: "a month",
    text: "Everything billo does, for one shop and one till. Up to 2 users and 5,000 products. Stop any month.",
    action: "Start with monthly",
  },
  {
    id: "yearly",
    name: "Yearly",
    figure: `AED ${aed(PLANS.starter.annualPriceMinor?.AED ?? 0)}`,
    period: "a year",
    text: "The same as monthly, paid once a year. You get 2 months free.",
    action: "Start with yearly",
  },
  {
    id: "trial",
    name: "Free trial",
    figure: `${TRIAL_DAYS} days`,
    period: "free",
    text: "Try everything with your own products. No card needed. Choose a plan at the end, or just stop.",
    action: "Start the free trial",
  },
] as const;

export function PlanPicker() {
  const [selected, setSelected] = useState<(typeof OPTIONS)[number]["id"]>("yearly");
  const plan = OPTIONS.find((option) => option.id === selected) ?? OPTIONS[1];

  return (
    <div className="plans">
      <div className="plan-names" role="radiogroup" aria-label="Starter plan">
        {OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={option.id === selected}
            className="plan-name"
            onClick={() => setSelected(option.id)}
            onFocus={() => setSelected(option.id)}
          >
            {option.name}
          </button>
        ))}
      </div>
      <div className="plan-stage" aria-live="polite">
        <div key={plan.id} className="plan-stage-inner">
          <p className="plan-figure">
            {plan.figure} <span className="plan-period">{plan.period}</span>
          </p>
          <p className="plan-text">{plan.text}</p>
          <Link href="/signup" className="lp-button">{plan.action}</Link>
        </div>
      </div>
    </div>
  );
}
