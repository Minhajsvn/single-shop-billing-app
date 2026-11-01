import { SiteFooter } from "@/components/public/site-footer";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

export default function PublicLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="public-shell">
      <header className="public-header">
        <Link href="/" className="auth-brand public-brand"><BrandMark /><span><strong>billo</strong><small>UAE retail till</small></span></Link>
        <nav className="public-actions" aria-label="Account">
          <Link href="/login" className="button">Sign in</Link>
          <Link href="/signup" className="button primary">Sign up</Link>
        </nav>
      </header>
      <main className="public-main">{children}</main>
      <SiteFooter />
    </div>
  );
}
