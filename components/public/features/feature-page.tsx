import type { Metadata } from "next";
import Link from "next/link";
import { LandingMotion } from "@/components/public/landing/landing-motion";
import { TRIAL_DAYS } from "@/lib/billing/plans";
import { SITE_URL } from "@/lib/site-info";
import { FEATURE_PAGES, getFeature, type FeatureSlug } from "./feature-content";
import "@/app/(public)/landing.css";

const OG_ALT = "billo: the till that keeps selling. POS and VAT billing for UAE shops.";

export function featureMetadata(slug: FeatureSlug): Metadata {
  const page = getFeature(slug);
  const url = `/${page.slug}`;
  return {
    title: { absolute: page.title },
    description: page.description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      url,
      siteName: "billo",
      title: page.title,
      description: page.description,
      locale: "en_AE",
      images: [{ url: `/media/${page.video}.jpg`, width: 1280, height: 720, alt: page.videoAlt }, { url: "/opengraph-image.png", width: 1200, height: 630, alt: OG_ALT }],
    },
    twitter: { card: "summary_large_image", title: page.title, description: page.description, images: [{ url: `/media/${page.video}.jpg`, alt: page.videoAlt }] },
  };
}

export function FeaturePage({ slug }: { slug: FeatureSlug }) {
  const page = getFeature(slug);
  const others = FEATURE_PAGES.filter((item) => item.slug !== slug);
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "billo", item: SITE_URL },
          { "@type": "ListItem", position: 2, name: page.nav, item: `${SITE_URL}/${page.slug}` },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: page.faq.map((item) => ({ "@type": "Question", name: item.q, acceptedAnswer: { "@type": "Answer", text: item.a } })),
      },
    ],
  };

  return (
    <div className="landing feature-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <LandingMotion />

      <section className="fp-hero" aria-labelledby="fp-title">
        <div className="fp-hero-text">
          <nav className="fp-crumbs" aria-label="Breadcrumb">
            <Link href="/">billo</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{page.nav}</span>
          </nav>
          <h1 id="fp-title" className="lp-h1">
            <span className="lp-line"><span>{page.h1[0]}</span></span>{" "}
            <span className="lp-line"><span>{page.h1[1]}</span></span>
          </h1>
          <p className="lp-lede">{page.lede}</p>
          <div className="lp-actions">
            <Link href="/signup" className="lp-button lp-button-big">Try it free for {TRIAL_DAYS} days</Link>
          </div>
        </div>
        <div className="fp-hero-media">
          <video data-autoplay muted loop playsInline preload="metadata" poster={`/media/${page.video}.jpg`} width={1280} height={720} aria-label={page.videoAlt}>
            <source src={`/media/${page.video}.mp4`} type="video/mp4" />
          </video>
        </div>
      </section>

      <section className="lp-section" aria-labelledby="fp-points-title">
        <h2 id="fp-points-title" className="lp-h2" data-reveal>{page.pointsTitle}</h2>
        <ol className="fp-points">
          {page.points.map((point) => (
            <li key={point.title} data-reveal>
              <h3>{point.title}</h3>
              <p>{point.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="lp-section lp-faq" aria-labelledby="fp-faq-title">
        <h2 id="fp-faq-title" className="lp-h2 lp-faq-title">Questions</h2>
        <div className="lp-faq-list" data-reveal>
          {page.faq.map((item, index) => (
            <details key={item.q} name="faq" open={index === 0}>
              <summary>{item.q}<span className="faq-sign" aria-hidden="true" /></summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="lp-section" aria-labelledby="fp-more-title">
        <h2 id="fp-more-title" className="lp-h2" data-reveal>More of what billo does</h2>
        <ul className="fp-more" data-reveal>
          {others.map((item) => (
            <li key={item.slug}>
              <Link href={`/${item.slug}`} className="fp-more-link">
                {/* eslint-disable-next-line @next/next/no-img-element -- static poster frame, already sized */}
                <img src={`/media/${item.video}.jpg`} alt="" width={1280} height={720} loading="lazy" />
                <span>{item.nav}</span>
                <span className="fp-more-text">{item.short}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="lp-close" aria-labelledby="fp-close-title" data-reveal>
        <div className="lp-close-text">
          <h2 id="fp-close-title" className="lp-h2 lp-close-h">Try billo free for {TRIAL_DAYS} days</h2>
          <p className="lp-body">Use it with your own products. No card, no setup fee, nothing to install.</p>
          <Link href="/signup" className="lp-button lp-button-big lp-button-invert">Start my free trial</Link>
        </div>
        <video className="lp-close-media" data-autoplay muted loop playsInline preload="none" poster="/media/loop-receipt.jpg" width={1280} height={720} aria-label="A billo receipt printing with the shop's TRN and 5% VAT.">
          <source src="/media/loop-receipt.webm" type="video/webm" />
          <source src="/media/loop-receipt.mp4" type="video/mp4" />
        </video>
      </section>
    </div>
  );
}
