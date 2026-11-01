import { PRICE_TEXT } from "@/lib/billing/price-text";
import { SITE_INFO } from "@/lib/site-info";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Refunds and cancellation | billo" };

export default function RefundsPage() {
  return (
    <article className="public-doc">
      <h1 className="page-title">Refunds and cancellation</h1>

      <h2>Refunds</h2>
      <p>We do not give refunds once a paid period has started. The {PRICE_TEXT.trialDays}-day trial needs no card, so you can try the full service before paying.</p>

      <h2>Cancelling</h2>
      <p>The shop owner can cancel in the Billing tab at any time. Cancelling stops the next renewal. The shop keeps full use until the end of the period it has already paid for.</p>

      <h2>After the paid period ends</h2>
      <p>The shop becomes read-only. Sales are paused, but invoices and reports stay viewable and can be exported. Choosing a plan again restores full use.</p>

      <h2>If a payment fails</h2>
      <p>A failed renewal gives the shop {PRICE_TEXT.graceDays} days of grace with full use while you update your card. After that the shop becomes read-only until a payment goes through.</p>

      <h2>Questions</h2>
      <p>Write to {SITE_INFO.email}.</p>
    </article>
  );
}
