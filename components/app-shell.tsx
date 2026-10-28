"use client";

import { Archive, DotsThreeOutline, Gear, House, Receipt, ShoppingCart } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { LifecycleBanner } from "@/components/billing/lifecycle-banner";
import { useEntitlement } from "@/components/billing/use-entitlement";
import { ChecklistStrip } from "@/components/onboarding/checklist-strip";
import { bannerFor } from "@/lib/billing/lifecycle-view";
import { MoreSheet, moreLinksFor } from "@/components/nav/more-sheet";
import { navIcon, pathOf } from "@/components/nav/nav-icons";
import { canUsePage, navLinksFor } from "@/lib/access/cashier";
import { UserMenu } from "@/components/nav/user-menu";
import { OfflineRuntime, useSyncStatusText } from "@/components/offline-runtime";
import { ConfirmHost } from "@/components/ui/confirm-host";
import { Toaster } from "@/components/ui/toaster";
import { clearHostedStore, useDemoStore, useShopContext } from "@/lib/demo-store";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { requestConfirm } from "@/lib/ui/confirm-store";

// Phone bar (owner's choice): Overview · Sales · New sale (centre, highlighted) · Inventory · More.
const phoneTabs = [
  { href: "/overview", label: "Overview", icon: House },
  { href: "/sales", label: "Sales", icon: Receipt },
  { href: "/sale", label: "New sale", icon: ShoppingCart, primary: true },
  { href: "/inventory", label: "Inventory", icon: Archive },
];

/** One notice slot under the top bar: a billing banner wins; otherwise the owner's get-ready-to-sell strip. */
function NoticeSlot() {
  const { e, stale, role, now } = useEntitlement();
  return bannerFor({ e, stale, role, now }) ? <LifecycleBanner /> : <ChecklistStrip />;
}

export function AppShell({ children, loading = false }: { children: ReactNode; loading?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const [email, setEmail] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const { mode, business, device, role } = useShopContext();
  const store = useDemoStore();
  const navLinks = navLinksFor(role);
  const settingsLink = navLinks.find((link) => pathOf(link.href) === "/settings");
  const workspaceLinks = navLinks.filter((link) => link !== settingsLink);
  const moreLinks = moreLinksFor(role);
  const syncStatus = useSyncStatusText();

  // A page this role cannot use, opened by address, goes to Overview (the server checks every write anyway).
  useEffect(() => {
    if (loading) return;
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (!canUsePage(role, pathname, tab)) router.replace("/overview");
  }, [loading, pathname, role, router]);

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
  const moreActive = moreLinks.some(({ href }) => active(pathOf(href)));

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
          {workspaceLinks.map(({ href, label }) => {
            const Icon = navIcon(href);
            return (
              <Link className={`nav-link ${active(href) ? "active" : ""}`} href={href} key={href} aria-current={active(href) ? "page" : undefined}>
                <Icon size={17} weight={active(href) ? "fill" : "bold"} />
                <span className="nav-text">{label}</span>
              </Link>
            );
          })}
        </nav>

        {settingsLink ? <>
          <div className="nav-label">System</div>
          <nav className="nav">
            <Link className={`nav-link ${active("/settings") ? "active" : ""}`} href={settingsLink.href} aria-current={active("/settings") ? "page" : undefined}>
              <Gear size={17} weight={active("/settings") ? "fill" : "bold"} />
              <span className="nav-text">{settingsLink.label}</span>
            </Link>
          </nav>
        </> : null}

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
      <MoreSheet links={moreLinks} open={moreOpen} onClose={() => setMoreOpen(false)} shopName={shopName} tillLabel={tillLabel} email={email} signOutLabel={signOutLabel} onSignOut={() => void signOut()} />

      <main className="main">
        <header className="topbar">
          <div className="topbar-title" title={shopName}>{shopName}</div>
          <div className="topbar-actions">
            {syncStatus.attention
              ? <Link className={`sync-line sync-pill ${syncStatus.tone}`} href={syncStatus.href}><span className="sync-dot" /><span>{syncStatus.text}</span></Link>
              : <span className={`sync-line sync-pill ${syncStatus.tone}`}><span className="sync-dot" /><span>{syncStatus.text}</span></span>}
            {mode === "sample" ? <span className="badge yellow">Sample shop</span> : device ? <span className="topbar-till">{tillLabel}</span> : null}
            <Link className="button primary" href="/sale"><ShoppingCart size={15} weight="bold" /> New sale</Link>
          </div>
        </header>
        {/* While the shop loads the entitlements are not known yet; a banner then would be a wrong guess. */}
        {loading ? null : <NoticeSlot />}
        <div className="content">{children}</div>
      </main>
      <ConfirmHost />
      <Toaster />
    </div>
  );
}
