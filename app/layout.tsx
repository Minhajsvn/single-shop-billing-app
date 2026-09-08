import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shop Ledger UAE",
  description: "Single-shop sales, billing, stock, and cash register.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
