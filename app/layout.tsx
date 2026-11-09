import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { ThemeWatcher } from "@/components/theme-choice";
import { THEME_SCRIPT } from "@/lib/ui/theme";
import { SITE_URL } from "@/lib/site-info";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], display: "swap", variable: "--font-space-grotesk" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "billo",
  description: "POS and billing software for UAE shops: sales, VAT invoices, stock and the cash register.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // data-theme is set by the inline script before paint, so React keeps the DOM's value.
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`} data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <ThemeWatcher />
        {children}
      </body>
    </html>
  );
}
