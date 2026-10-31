import Link from "next/link";

const LINKS = [
  { href: "/", label: "Home" },
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
