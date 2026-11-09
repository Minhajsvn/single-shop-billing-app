import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-info";

// Crawl the public site; keep the signed-in app, admin, API and auth flows out of search.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/admin",
        "/auth/",
        "/billing",
        "/setup",
        "/overview",
        "/sale",
        "/sales",
        "/inventory",
        "/customers",
        "/register",
        "/reports",
        "/settings",
        "/forgot-password",
        "/reset-password",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
