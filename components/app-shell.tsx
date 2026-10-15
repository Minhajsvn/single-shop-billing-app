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
import { clearHostedStore, useDemoStore, useShopContext } from "@/lib/demo-store";
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
  const { mode, business, device } = useShopContext();
  const store = useDemoStore();

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const supabase = createClient();
    void supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  async function signOut() {
    // Unsynced work is never discarded: it stays in this user's own cache and syncs when they sign in here again.
    const pending = store.syncOperations.filter((operation) => operation.status !== "synced").length;
    if (mode === "hosted" && pending && !window.confirm(`${pending} change${pending === 1 ? " has" : "s have"} not synced yet. They stay saved on this browser and sync when you sign in here again. Sign out anyway?`)) return;
    clearHostedStore();
    if (isSupabaseConfigured()) await createClient().auth.signOut();
    document.cookie = "shop-ledger-mode=; path=/; Max-Age=0; SameSite=Lax";
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
          <div className="operator"><strong>{mode === "sample" ? "Sample shop" : device ? `Till ${device.tillNumber}` : "Till"}</strong><span>{device?.name ?? (mode === "hosted" ? "Not selected" : "This browser")}</span></div>
        </div>
      </aside>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {links.map(({ href, label, icon: Icon }) => <Link href={href} key={href} className={active(href) ? "active" : ""} aria-current={active(href) ? "page" : undefined}><Icon size={18} weight={active(href) ? "fill" : "bold"} /><span>{label}</span></Link>)}
        <Link href="/settings" className={active("/settings") ? "active" : ""} aria-current={active("/settings") ? "page" : undefined}><Gear size={18} weight={active("/settings") ? "fill" : "bold"} /><span>Settings</span></Link>
      </nav>

      <main className="main">
        <header className="topbar">
          <div className="topbar-title">{business?.legalName ?? "Shop Ledger"}</div>
          <div className="topbar-actions">
            {mode === "hosted" && device ? <span className="badge">Till {device.tillNumber}</span> : null}
            {mode === "sample" ? <span className="badge yellow">Sample shop</span> : null}
            {email ? <span className="auth-user" title={email}>{email}</span> : null}
            {isSupabaseConfigured() ? <button className="button" type="button" onClick={signOut}>{mode === "sample" ? "Leave sample" : "Sign out"}</button> : null}
            <Link className="button primary" href="/sale"><ShoppingCart size={15} weight="bold" /> New sale</Link>
          </div>
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
