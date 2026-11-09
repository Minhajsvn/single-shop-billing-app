import Link from "next/link";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/offline-pos", label: "Offline selling" },
  { href: "/vat-invoice", label: "VAT invoices" },
  { href: "/close-day", label: "Closing the day" },
  { href: "/returns", label: "Returns" },
  { href: "/stock", label: "Stock" },
  { href: "/guides/uae-e-invoicing-small-business", label: "E-invoicing guide" },
  { href: "/guides/uae-tax-invoice", label: "Tax invoice guide" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/refunds", label: "Refunds and cancellation" },
  { href: "/contact", label: "Contact" },
];

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <nav aria-label="Site information">
        <ul>
          {LINKS.map((link) => (
            <li key={link.href}><Link href={link.href}>{link.label}</Link></li>
          ))}
        </ul>
      </nav>
    </footer>
  );
}
