import type { MetadataRoute } from "next";
import { GUIDES } from "@/components/public/guides/guide-content";
import { FEATURE_PAGES } from "@/components/public/features/feature-content";
import { SITE_URL } from "@/lib/site-info";

// Public pages only. The app, admin and auth screens are kept out (see robots.ts).
export default function sitemap(): MetadataRoute.Sitemap {
  const updated = "2026-11-08";
  return [
    {
      url: SITE_URL,
      lastModified: updated,
      changeFrequency: "weekly",
      priority: 1,
      videos: [
        {
          title: "billo in 20 seconds",
          description: "A short tour of the billo till: a sale, the VAT receipt with the shop's TRN, and offline selling.",
          thumbnail_loc: `${SITE_URL}/media/teaser.jpg`,
          content_loc: `${SITE_URL}/media/teaser.mp4`,
          duration: 20,
        },
      ],
    },
    ...FEATURE_PAGES.map((page) => ({
      url: `${SITE_URL}/${page.slug}`,
      lastModified: updated,
      changeFrequency: "monthly" as const,
      priority: 0.8,
      videos: [{ title: page.title, description: page.description, thumbnail_loc: `${SITE_URL}/media/${page.video}.jpg`, content_loc: `${SITE_URL}/media/${page.video}.mp4`, duration: 16 }],
    })),
    ...GUIDES.map((guide) => ({ url: `${SITE_URL}/guides/${guide.slug}`, lastModified: guide.checked, changeFrequency: "monthly" as const, priority: 0.7 })),
    { url: `${SITE_URL}/contact`, lastModified: updated, changeFrequency: "yearly", priority: 0.4 },
    { url: `${SITE_URL}/terms`, lastModified: updated, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/privacy`, lastModified: updated, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/refunds`, lastModified: updated, changeFrequency: "yearly", priority: 0.2 },
  ];
}
