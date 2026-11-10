import type { Metadata } from "next";
import Link from "next/link";
import { FAQ, FEATURES, SHOP_TYPES, STEPS } from "@/components/public/landing/content";
import { LandingMotion } from "@/components/public/landing/landing-motion";
import { LiveTill } from "@/components/public/landing/live-till";
import { PlanPicker } from "@/components/public/landing/plan-picker";
import { SyncRows } from "@/components/public/landing/sync-rows";
import { TourButton } from "@/components/public/landing/tour-button";
import { foundingOfferOpen } from "@/lib/billing/founding-offer";
import { PLANS, TRIAL_DAYS } from "@/lib/billing/plans";
import { SITE_URL } from "@/lib/site-info";
import "./landing.css";

const TITLE = "billo: POS and billing software for UAE shops";
const OG_ALT = "billo: the till that keeps selling. POS and VAT billing for UAE shops.";
const DESCRIPTION =
  "Ring up sales, print VAT invoices with your TRN, track stock and close the till. billo keeps selling when the internet drops. 14-day free trial, no card.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "billo",
    title: "billo: the till that keeps selling",
    description: "POS and VAT billing for UAE shops. Fast checkout, 80mm receipts, stock alerts and a cash register that balances.",
    locale: "en_AE",
    // Set here because this openGraph object replaces the one built from app/opengraph-image.png.
    images: [{ url: "/opengraph-image.png", width: 1200, height: 630, alt: OG_ALT }],
  },
  twitter: { card: "summary_large_image", title: "billo: the till that keeps selling", description: DESCRIPTION, images: [{ url: "/opengraph-image.png", alt: OG_ALT }] },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#org`,
      name: "billo",
      url: SITE_URL,
      logo: `${SITE_URL}/icon-512.png`,
    },
    {
      "@type": "SoftwareApplication",
      name: "billo",
      url: SITE_URL,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web, Windows",
      description: DESCRIPTION,
      areaServed: "AE",
      publisher: { "@id": `${SITE_URL}/#org` },
      offers: [
        { "@type": "Offer", name: "Starter monthly", price: (PLANS.starter.monthlyPriceMinor?.AED ?? 0) / 100, priceCurrency: "AED" },
        { "@type": "Offer", name: "Starter yearly", price: (PLANS.starter.annualPriceMinor?.AED ?? 0) / 100, priceCurrency: "AED" },
      ],
    },
    {
      "@type": "VideoObject",
      name: "billo in 20 seconds",
      description: "A short tour of the billo till: a sale, the VAT receipt with the shop's TRN, and offline selling.",
      thumbnailUrl: `${SITE_URL}/media/teaser.jpg`,
      contentUrl: `${SITE_URL}/media/teaser.mp4`,
      uploadDate: "2026-11-08",
      duration: "PT20S",
    },
    {
      "@type": "FAQPage",
      mainEntity: FAQ.map((item) => ({ "@type": "Question", name: item.q, acceptedAnswer: { "@type": "Answer", text: item.a } })),
    },
  ],
};

// The Founding 50 text follows founding_offer_open(); the page is rebuilt at most hourly (FOUNDING_OFFER_REVALIDATE).
export const revalidate = 3600;

export default async function HomePage() {
  const foundingOpen = await foundingOfferOpen();
  return (
    <div className="landing">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\u003c") }} />
      <LandingMotion />

      <section className="lp-hero" aria-labelledby="hero-title">
        <div className="lp-hero-text">
          <h1 id="hero-title" className="lp-h1">
            <span className="lp-line"><span>Simple billing for</span></span>{" "}
            <span className="lp-line"><span>every UAE shop</span></span>
          </h1>
          <p className="lp-lede">
            Sell, print VAT receipts and close the day in a few taps. billo keeps working even when the internet is down.
          </p>
          <div className="lp-actions">
            <Link href="/signup" className="lp-button lp-button-big">Try it free for {TRIAL_DAYS} days</Link>
            <TourButton />
          </div>
          <ul className="lp-trust" aria-label="Trial terms">
            <li>No card needed</li>
            <li>Easy to set up</li>
            <li>Cancel any time</li>
          </ul>
        </div>
        <div className="lp-hero-stage">
          <LiveTill />
          <p className="lp-stage-note">Go on, try it: tap a product, then press Cash.</p>
        </div>
      </section>

      <section className="lp-band" aria-labelledby="band-title">
        <h2 id="band-title" className="lp-band-title">Made for every kind of shop</h2>
        <div className="lp-marquee" aria-hidden="true">
          <div className="lp-marquee-track">
            {[...SHOP_TYPES, ...SHOP_TYPES].map((type, index) => (
              <span key={`${type}-${index}`}>{type}</span>
            ))}
          </div>
        </div>
        <p className="sr-only">{SHOP_TYPES.join(", ")}.</p>
      </section>

      <section className="lp-section lp-features" aria-labelledby="features-title">
        <h2 id="features-title" className="lp-h2" data-reveal>Everything your counter needs</h2>
        <div className="bento">
          {FEATURES.map((feature) => (
            <article key={feature.id} className={`bento-tile bento-${feature.id}`} data-reveal>
              <div className="bento-text">
                <h3><Link href={`/${feature.page}`} className="bento-link">{feature.title}</Link></h3>
                <p>{feature.text}</p>
                <span className="bento-more" aria-hidden="true">Learn more</span>
              </div>
              <div className="bento-media">
                <video data-autoplay muted loop playsInline preload="none" poster={`/media/${feature.video}.jpg`} width={1280} height={720} aria-label={feature.alt}>
                  <source src={`/media/${feature.video}.mp4`} type="video/mp4" />
                </video>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-section lp-sync" aria-labelledby="sync-title" data-reveal>
        <div className="lp-sync-head">
          <h2 id="sync-title" className="lp-h2">Internet down? Keep selling.</h2>
          <p className="lp-body">Every sale is saved on the till first. When the internet comes back, it sends itself. Nothing lost, nothing counted twice.</p>
        </div>
        <SyncRows />
      </section>

      <section className="lp-section" aria-labelledby="steps-title">
        <h2 id="steps-title" className="lp-h2" data-reveal>Start in three steps</h2>
        <ol className="lp-step-row">
          {STEPS.map((step, index) => (
            <li key={step.title} className="lp-step" data-reveal>
              <div className="lp-step-text">
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </div>
              {index === 0 && (
                <div className="lp-response" data-ui>
                  <div className="resp-row resp-head"><span>Product</span><span>Price</span><span>Stock</span></div>
                  <div className="resp-row"><span>Karak Tea</span><span>3.00</span><span>48</span></div>
                  <div className="resp-row"><span>Labneh 400g</span><span>14.50</span><span>12</span></div>
                  <div className="resp-row"><span>Al Ain Water 1.5L</span><span>2.50</span><span>120</span></div>
                </div>
              )}
              {index === 1 && (
                <div className="lp-response" data-ui>
                  <div className="resp-row"><span>Cash in drawer</span><span className="call-text">AED 500.00</span></div>
                  <div className="resp-row"><span>Till</span><span className="resp-ok">Open</span></div>
                  <div className="resp-row"><span>Date</span><span>Sun 8 Nov, Dubai</span></div>
                </div>
              )}
              {index === 2 && (
                <div className="lp-response lp-response-wide" data-ui>
                  <video data-autoplay muted loop playsInline preload="none" poster="/media/loop-variance.jpg" width={1280} height={720} aria-label="The close register panel showing a variance of AED 0.00.">
                    <source src="/media/loop-variance.webm" type="video/webm" />
                    <source src="/media/loop-variance.mp4" type="video/mp4" />
                  </video>
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section className="lp-section lp-pricing" aria-labelledby="pricing-title" data-reveal>
        <h2 id="pricing-title" className="lp-h2">One simple price</h2>
        <PlanPicker foundingOpen={foundingOpen} />
      </section>

      <section className="lp-section lp-faq" aria-labelledby="faq-title">
        <h2 id="faq-title" className="lp-h2 lp-faq-title">Questions? Answers.</h2>
        <div className="lp-faq-list" data-reveal>
          {FAQ.map((item, index) => (
            <details key={item.q} name="faq" open={index === 0}>
              <summary>{item.q}<span className="faq-sign" aria-hidden="true" /></summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="lp-close" aria-labelledby="close-title" data-reveal>
        <div className="lp-close-text">
          <h2 id="close-title" className="lp-h2 lp-close-h">Try billo free for {TRIAL_DAYS} days</h2>
          <p className="lp-body">Use it with your own products. No card, no setup fee, nothing to install.</p>
          <Link href="/signup" className="lp-button lp-button-big lp-button-invert">Start my free trial</Link>
        </div>
        <video className="lp-close-media" data-autoplay muted loop playsInline preload="none" poster="/media/loop-receipt.jpg" width={1280} height={720} aria-label="A billo receipt printing with the shop's TRN and 5% VAT.">
          <source src="/media/loop-receipt.webm" type="video/webm" />
          <source src="/media/loop-receipt.mp4" type="video/mp4" />
        </video>
      </section>

      <div className="lp-sticky">
        <span>{TRIAL_DAYS} days free · no card</span>
        <Link href="/signup" className="lp-button">Try it free</Link>
      </div>
    </div>
  );
}
