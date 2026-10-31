import { PRICE_TEXT } from "@/lib/billing/price-text";
import { SITE_INFO } from "@/lib/site-info";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms of service | Shop Ledger UAE" };

export default function TermsPage() {
  return (
    <article className="public-doc">
      <h1 className="page-title">Terms of service</h1>
      <p className="page-copy">These terms cover your use of Shop Ledger, provided by {SITE_INFO.legalName}.</p>

      <h2>The service</h2>
      <p>Shop Ledger is a till and billing app for shops in the UAE. It records sales, stock, customers and the cash register, and it keeps working on your device when the internet is down.</p>

      <h2>Free trial</h2>
      <p>A new shop gets a {PRICE_TEXT.trialDays}-day {PRICE_TEXT.trialPlanName} trial. No card is needed to start. If you add a card during the trial, it is charged only when the trial ends.</p>

      <h2>Plans and renewal</h2>
      <p>The {PRICE_TEXT.planName} plan costs {PRICE_TEXT.monthly} or {PRICE_TEXT.annual}. The plan renews automatically at the end of each paid period, and the card you gave is charged through Razorpay, our payment provider.</p>

      <h2>Cancellation</h2>
      <p>The shop owner can cancel in the Billing tab at any time. Cancelling stops the next renewal. The shop keeps full use until the end of the period it has already paid for. See <Link href="/refunds">Refunds and cancellation</Link>.</p>

      <h2>When a subscription ends</h2>
      <p>If a plan ends, is not renewed, or a payment fails and the {PRICE_TEXT.graceDays}-day grace period passes, the shop becomes read-only. Selling pauses. Past invoices and reports stay viewable and can still be exported. Choosing a plan again restores full use.</p>

      <h2>Acceptable use</h2>
      <p>Use the service only for lawful business. Do not try to break into other shops&apos; data, overload the service, or resell access without our written agreement. We may suspend an account that breaks these rules.</p>

      <h2>Your data</h2>
      <p>Your sales and shop records belong to you. See the <Link href="/privacy">Privacy policy</Link> for how we store them.</p>

      <h2>The business</h2>
      <p>{SITE_INFO.legalName}, {SITE_INFO.address}. Questions: {SITE_INFO.email}. More on the <Link href="/contact">Contact</Link> page.</p>
    </article>
  );
}
