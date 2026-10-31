import { PRICE_TEXT } from "@/lib/billing/price-text";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Shop Ledger UAE: a till and billing app for shops" };

export default function HomePage() {
  return (
    <>
      <section className="public-hero">
        <div className="eyebrow">For shops in the UAE</div>
        <h1 className="page-title">A till and billing app that keeps selling offline</h1>
        <p className="page-copy">
          Shop Ledger is a till and billing app for shops in the UAE. Ring up sales, print receipts, track stock and
          customers, and close the day with a cash register. The till keeps working when the internet drops and syncs when it returns.
        </p>
        <div className="public-cta">
          <Link href="/signup" className="button primary">Sign up</Link>
          <Link href="/login" className="button">Sign in</Link>
        </div>
      </section>
      <section className="public-section" aria-labelledby="pricing-title">
        <h2 id="pricing-title">Pricing</h2>
        <div className="public-grid">
          <div className="panel public-card">
            <h3>{PRICE_TEXT.planName}</h3>
            <p className="public-price">{PRICE_TEXT.monthly}</p>
            <p className="page-copy">or</p>
            <p className="public-price">{PRICE_TEXT.annual}</p>
          </div>
          <div className="panel public-card">
            <h3>Free trial</h3>
            <p className="public-price">{PRICE_TEXT.trial}</p>
            <p className="page-copy">Start by signing up. Pick a plan when the trial is ending.</p>
          </div>
        </div>
      </section>
    </>
  );
}
