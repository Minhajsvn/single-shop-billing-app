"use client";

import {
  Archive,
  CashRegister,
  ChartBar,
  DotsThreeOutline,
  Gear,
  House,
  IdentificationCard,
  Receipt,
  ShoppingCart,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { MORE_LINKS, MoreSheet } from "@/components/nav/more-sheet";
import { UserMenu } from "@/components/nav/user-menu";
import { OfflineRuntime } from "@/components/offline-runtime";
import { ConfirmHost } from "@/components/ui/confirm-host";
import { Toaster } from "@/components/ui/toaster";
import { clearHostedStore, useDemoStore, useShopContext } from "@/lib/demo-store";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { requestConfirm } from "@/lib/ui/confirm-store";

const links = [
  { href: "/overview", label: "Overview", icon: House },
  { href: "/sale", label: "New sale", icon: ShoppingCart },
  { href: "/sales", label: "Sales", icon: Receipt },
  { href: "/inventory", label: "Inventory", icon: Archive },
  { href: "/customers", label: "Customers", icon: IdentificationCard },
  { href: "/register", label: "Register", icon: CashRegister },
  { href: "/reports", label: "Reports", icon: ChartBar },
];

// Phone bar (owner's choice): Overview · Sales · New sale (centre, highlighted) · Inventory · More.
const phoneTabs = [
  { href: "/overview", label: "Overview", icon: House },
  { href: "/sales", label: "Sales", icon: Receipt },
  { href: "/sale", label: "New sale", icon: ShoppingCart, primary: true },
  { href: "/inventory", label: "Inventory", icon: Archive },
];

export function AppShell({ children, loading = false }: { children: ReactNode; loading?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const [email, setEmail] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
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
    if (mode === "hosted" && pending && !(await requestConfirm({
      title: "Sign out with unsynced changes?",
      body: `${pending} change${pending === 1 ? " has" : "s have"} not synced yet. They stay saved on this browser and sync when you sign in here again.`,
      confirmLabel: "Sign out",
      destructive: true,
    }))) return;
    clearHostedStore();
    if (isSupabaseConfigured()) await createClient().auth.signOut();
    document.cookie = "shop-ledger-mode=; path=/; Max-Age=0; SameSite=Lax";
    router.replace("/login");
  }

  const shopName = business?.legalName ?? (mode === "sample" ? "Sample shop" : "Shop Ledger");
  const tillLabel = mode === "sample" ? "This browser" : device ? `Till ${device.tillNumber} · ${device.branchName}` : "No till selected";
  const signOutLabel = isSupabaseConfigured() ? (mode === "sample" ? "Leave sample" : "Sign out") : null;
  const moreActive = MORE_LINKS.some(({ href }) => active(href));

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
          <OfflineRuntime ready={!loading} />
          <UserMenu tillLabel={tillLabel} email={email} signOutLabel={signOutLabel} onSignOut={() => void signOut()} />
        </div>
      </aside>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {phoneTabs.map(({ href, label, icon: Icon, primary }) => (
          <Link href={href} key={href} className={`${active(href) ? "active" : ""} ${primary ? "nav-primary" : ""}`} aria-current={active(href) ? "page" : undefined}>
            <Icon size={primary ? 20 : 18} weight={active(href) || primary ? "fill" : "bold"} /><span>{label}</span>
          </Link>
        ))}
        <button type="button" className={moreActive || moreOpen ? "active" : ""} onClick={() => setMoreOpen(true)} aria-haspopup="dialog" aria-expanded={moreOpen}>
          <DotsThreeOutline size={18} weight={moreActive ? "fill" : "bold"} /><span>More</span>
        </button>
      </nav>
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} shopName={shopName} tillLabel={tillLabel} email={email} signOutLabel={signOutLabel} onSignOut={() => void signOut()} />

      <main className="main">
        <header className="topbar">
          <div className="topbar-title" title={shopName}>{shopName}</div>
          <div className="topbar-actions">
            {mode === "sample" ? <span className="badge yellow">Sample shop</span> : device ? <span className="topbar-till">{tillLabel}</span> : null}
            <Link className="button primary" href="/sale"><ShoppingCart size={15} weight="bold" /> New sale</Link>
          </div>
        </header>
        <div className="content">{children}</div>
      </main>
      <ConfirmHost />
      <Toaster />
    </div>
  );
}
