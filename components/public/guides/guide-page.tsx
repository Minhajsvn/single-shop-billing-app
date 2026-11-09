import type { Metadata } from "next";
import Link from "next/link";
import { LandingMotion } from "@/components/public/landing/landing-motion";
import { TRIAL_DAYS } from "@/lib/billing/plans";
import { SITE_URL } from "@/lib/site-info";
import { GUIDES, getGuide, type GuideBlock, type GuideSlug } from "./guide-content";
import "@/app/(public)/landing.css";

const OG_ALT = "billo: the till that keeps selling. POS and VAT billing for UAE shops.";

function longDate(iso: string) {
  return new Intl.DateTimeFormat("en-AE", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dubai" }).format(new Date(`${iso}T12:00:00+04:00`));
}

export function guideMetadata(slug: GuideSlug): Metadata {
  const guide = getGuide(slug);
  const url = `/guides/${guide.slug}`;
  return {
    title: { absolute: guide.title },
    description: guide.description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      url,
      siteName: "billo",
      title: guide.title,
      description: guide.description,
      locale: "en_AE",
      modifiedTime: guide.checked,
      images: [{ url: "/opengraph-image.png", width: 1200, height: 630, alt: OG_ALT }],
    },
    twitter: { card: "summary_large_image", title: guide.title, description: guide.description, images: [{ url: "/opengraph-image.png", alt: OG_ALT }] },
  };
}

function Block({ block }: { block: GuideBlock }) {
  if (block.kind === "p") return <p>{block.text}</p>;
  if (block.kind === "list") {
    return (
      <ul>
        {block.items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    );
  }
  return (
    <div className="gd-table-wrap" data-ui>
      <table className="gd-table">
        <thead>
          <tr>{block.head.map((cell) => <th key={cell} scope="col">{cell}</th>)}</tr>
        </thead>
        <tbody>
          {block.rows.map((row) => (
            <tr key={row[0]}>
              <th scope="row">{row[0]}</th>
              <td>{row[1]}</td>
              <td>{row[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GuidePage({ slug }: { slug: GuideSlug }) {
  const guide = getGuide(slug);
  const other = GUIDES.find((item) => item.slug !== slug);
  const url = `${SITE_URL}/guides/${guide.slug}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        headline: `${guide.h1[0]} ${guide.h1[1]}`,
        description: guide.description,
        datePublished: guide.checked,
        dateModified: guide.checked,
        mainEntityOfPage: url,
        image: `${SITE_URL}/opengraph-image.png`,
        author: { "@type": "Organization", name: "billo", url: SITE_URL },
        publisher: { "@type": "Organization", name: "billo", logo: { "@type": "ImageObject", url: `${SITE_URL}/icon-512.png` } },
        citation: guide.sources.map((source) => source.url),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "billo", item: SITE_URL },
          { "@type": "ListItem", position: 2, name: guide.nav, item: url },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: guide.faq.map((item) => ({ "@type": "Question", name: item.q, acceptedAnswer: { "@type": "Answer", text: item.a } })),
      },
    ],
  };

  return (
    <div className="landing guide-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <LandingMotion />

      <article className="gd" aria-labelledby="gd-title">
        <header className="gd-head">
          <nav className="fp-crumbs" aria-label="Breadcrumb">
            <Link href="/">billo</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">Guides</span>
          </nav>
          <h1 id="gd-title" className="lp-h1 gd-h1">
            <span className="lp-line"><span>{guide.h1[0]}</span></span>{" "}
            <span className="lp-line"><span>{guide.h1[1]}</span></span>
          </h1>
          <p className="lp-lede gd-lede">{guide.lede}</p>
          <p className="gd-meta">
            Facts checked on <time dateTime={guide.checked}>{longDate(guide.checked)}</time>. General information, not tax advice.
          </p>
        </header>

        <figure className="gd-figure">
          <video data-autoplay muted loop playsInline preload="metadata" poster={`/media/${guide.figure.video}.jpg`} width={1280} height={720} aria-label={guide.figure.caption}>
            <source src={`/media/${guide.figure.video}.mp4`} type="video/mp4" />
          </video>
          <figcaption>{guide.figure.caption}</figcaption>
        </figure>

        <div className="gd-body">
          {guide.sections.map((section, index) => (
            <section key={section.heading} className={index === 0 ? "gd-section gd-summary" : "gd-section"} data-reveal>
              <h2>{section.heading}</h2>
              {section.blocks.map((block, i) => <Block key={i} block={block} />)}
            </section>
          ))}

          <section className="gd-section" data-reveal>
            <h2>Sources</h2>
            <ul className="gd-sources">
              {guide.sources.map((source) => (
                <li key={source.url}>
                  <a href={source.url} rel="noopener" target="_blank">{source.label}</a>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </article>

      <section className="lp-section lp-faq" aria-labelledby="gd-faq-title">
        <h2 id="gd-faq-title" className="lp-h2 lp-faq-title">Questions</h2>
        <div className="lp-faq-list" data-reveal>
          {guide.faq.map((item, index) => (
            <details key={item.q} name="faq" open={index === 0}>
              <summary>{item.q}<span className="faq-sign" aria-hidden="true" /></summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {other && (
        <section className="lp-section" aria-labelledby="gd-next-title">
          <h2 id="gd-next-title" className="lp-h2" data-reveal>Read next</h2>
          <Link href={`/guides/${other.slug}`} className="gd-next" data-reveal>
            {/* eslint-disable-next-line @next/next/no-img-element -- static poster frame, already sized */}
            <img src={`/media/${other.figure.video}.jpg`} alt="" width={1280} height={720} loading="lazy" />
            <span className="gd-next-words">
            <span className="gd-next-title">{other.h1[0]} {other.h1[1]}</span>
            <span className="gd-next-text">{other.lede}</span>
            </span>
          </Link>
        </section>
      )}

      <section className="lp-close" aria-labelledby="gd-close-title" data-reveal>
        <div className="lp-close-text">
          <h2 id="gd-close-title" className="lp-h2 lp-close-h">VAT receipts, done for you</h2>
          <p className="lp-body">billo prints your TRN and the 5% VAT on every sale. Try it free for {TRIAL_DAYS} days, no card needed.</p>
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
