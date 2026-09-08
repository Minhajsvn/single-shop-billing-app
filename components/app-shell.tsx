"use client";

import {
  Archive,
  CashRegister,
  ChartBar,
  Gear,
  House,
  IdentificationCard,
  Receipt,
  ShoppingCart,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { OfflineRuntime } from "@/components/offline-runtime";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

const links = [
  { href: "/overview", label: "Overview", icon: House },
  { href: "/sale", label: "New sale", icon: ShoppingCart },
  { href: "/sales", label: "Sales", icon: Receipt },
  { href: "/inventory", label: "Inventory", icon: Archive },
  { href: "/customers", label: "Customers", icon: IdentificationCard },
  { href: "/register", label: "Register", icon: CashRegister },
  { href: "/reports", label: "Reports", icon: ChartBar },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const supabase = createClient();
    void supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  async function signOut() {
    if (isSupabaseConfigured()) await createClient().auth.signOut();
    router.replace("/login");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/overview">
          <span className="brand-mark">SL</span>
          <span>
            <span className="brand-name">Shop Ledger</span>
            <span className="brand-meta">UAE retail till</span>
          </span>
        </Link>

        <div className="nav-label">Workspace</div>
        <nav className="nav" aria-label="Primary navigation">
          {links.map(({ href, label, icon: Icon }) => (
            <Link className={`nav-link ${active(href) ? "active" : ""}`} href={href} key={href} aria-current={active(href) ? "page" : undefined}>
              <Icon size={17} weight={active(href) ? "fill" : "bold"} />
              {label}
            </Link>
          ))}
        </nav>

        <div className="nav-label" style={{ marginTop: 22 }}>System</div>
        <nav className="nav">
          <Link className={`nav-link ${active("/settings") ? "active" : ""}`} href="/settings" aria-current={active("/settings") ? "page" : undefined}>
            <Gear size={17} weight={active("/settings") ? "fill" : "bold"} />
            Settings
          </Link>
        </nav>

        <div className="sidebar-bottom">
          <OfflineRuntime />
          <div className="operator"><strong>Owner till</strong><span>Device 01</span></div>
        </div>
      </aside>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {links.map(({ href, label, icon: Icon }) => <Link href={href} key={href} className={active(href) ? "active" : ""} aria-current={active(href) ? "page" : undefined}><Icon size={18} weight={active(href) ? "fill" : "bold"} /><span>{label}</span></Link>)}
        <Link href="/settings" className={active("/settings") ? "active" : ""} aria-current={active("/settings") ? "page" : undefined}><Gear size={18} weight={active("/settings") ? "fill" : "bold"} /><span>Settings</span></Link>
      </nav>

      <main className="main">
        <header className="topbar">
          <div className="topbar-title">Single shop workspace</div>
          <div className="topbar-actions">
            <span className="badge yellow">Local cache</span>
            {email ? <span className="auth-user" title={email}>{email}</span> : null}
            {isSupabaseConfigured() ? <button className="button" type="button" onClick={signOut}>Sign out</button> : null}
            <Link className="button primary" href="/sale"><ShoppingCart size={15} weight="bold" /> New sale</Link>
          </div>
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
