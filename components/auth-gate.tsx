"use client";

import { ArrowClockwise, WarningCircle } from "@phosphor-icons/react";
import { TillPicker } from "@/components/till-picker";
import { getStoreMode, startHostedStore, useShopContext } from "@/lib/demo-store";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

type GateState = { status: "checking" } | { status: "ready" } | { status: "error"; message: string };

export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  useEffect(() => { pathRef.current = pathname; }, [pathname]);
  const { device, mode } = useShopContext();
  const [gate, setGate] = useState<GateState>(isSupabaseConfigured() ? { status: "checking" } : { status: "ready" });

  // Runs once per mount: the dashboard layout stays mounted across page changes, so the shop loads once.
  const start = useCallback(async (active: () => boolean) => {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    if (!active()) return;
    if (!data.session) {
      router.replace(`/login?next=${encodeURIComponent(pathRef.current)}`);
      return;
    }
    if (pathRef.current !== "/setup") {
      const { data: business, error } = await supabase.from("businesses").select("id").limit(1).maybeSingle();
      if (!active()) return;
      if (error) {
        console.error("Unable to check shop setup status", error);
      } else if (!business) {
        router.replace("/setup");
        return;
      }
    }
    const result = await startHostedStore();
    if (!active()) return;
    setGate(result.ok ? { status: "ready" } : { status: "error", message: result.error });
  }, [router]);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    // The explicit sample shop has no account to check.
    if (getStoreMode() === "sample") return;
    let active = true;
    const timer = window.setTimeout(() => void start(() => active), 0);
    const { data: subscription } = createClient().auth.onAuthStateChange((_event, session) => {
      if (!session && getStoreMode() !== "sample") router.replace(`/login?next=${encodeURIComponent(pathRef.current)}`);
    });
    return () => {
      active = false;
      window.clearTimeout(timer);
      subscription.subscription.unsubscribe();
    };
  }, [router, start]);

  if (mode === "sample") return children;
  if (gate.status === "checking") {
    return <div className="auth-loading" role="status">Loading your shop…</div>;
  }
  if (gate.status === "error") {
    return (
      <main className="auth-shell">
        <section className="auth-card panel">
          <div className="notice error-notice" role="alert"><WarningCircle size={17} weight="bold" /><span>{gate.message}</span></div>
          <button className="button primary auth-submit" type="button" onClick={() => { setGate({ status: "checking" }); void start(() => true); }}><ArrowClockwise size={16} weight="bold" />Retry</button>
        </section>
      </main>
    );
  }
  if (mode === "hosted" && !device && pathname !== "/setup") return <TillPicker />;
  return children;
}
