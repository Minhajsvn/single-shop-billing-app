import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Shop Ledger UAE",
    short_name: "Shop Ledger",
    description: "Single-shop sales, VAT billing, inventory, and daily register.",
    start_url: "/overview",
    display: "standalone",
    background_color: "#f7f6f3",
    theme_color: "#20211f",
    orientation: "landscape",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
