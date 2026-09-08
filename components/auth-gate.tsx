"use client";

import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(!isSupabaseConfigured());

  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    const supabase = createClient();
    let active = true;
    async function checkSession() {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      if (!data.session) {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        return;
      }

      if (pathname !== "/setup") {
        const { data: business, error } = await supabase.from("businesses").select("id").limit(1).maybeSingle();
        if (error) {
          console.error("Unable to check shop setup status", error);
        } else if (!business) {
          router.replace("/setup");
          return;
        }
      }
      setReady(true);
    }
    void checkSession();

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      } else {
        setReady(true);
      }
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [pathname, router]);

  if (!ready) {
    return <div className="auth-loading" role="status">Checking secure session…</div>;
  }

  return children;
}
