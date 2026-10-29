"use client";

import { EnvelopeSimple, LockKey, SignIn, Storefront } from "@/components/icons";
import { ResendLinkButton } from "@/components/check-email";
import { safeNextPath } from "@/lib/auth/access-rules";
import { CONFIRM_FAILED, isEmailNotConfirmed, isNetworkError, NETWORK_ERROR } from "@/lib/auth/signup";
import { startSampleStore } from "@/lib/demo-store";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, use, useEffect, useState } from "react";

type LoginProps = { searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

export default function LoginPage({ searchParams }: LoginProps) {
  const router = useRouter();
  const { confirm, next } = use(searchParams);
  // Back to the page the proxy sent here from (e.g. /admin); anything unsafe falls back to the overview.
  const destination = safeNextPath(next);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // A failed or reused email link lands here with ?confirm=failed.
  const [error, setError] = useState<string | null>(confirm === "failed" ? CONFIRM_FAILED : null);
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const supabase = createClient();
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace(destination);
    });
  }, [router, destination]);

  function trySample() {
    startSampleStore();
    router.replace("/overview");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setUnconfirmedEmail(null);

    if (!isSupabaseConfigured()) {
      setError("Supabase is not configured for this build. Add the project URL and publishable key to .env.local.");
      setBusy(false);
      return;
    }

    const address = email.trim();
    let signInError: { message?: string; status?: number; code?: string; name?: string } | null;
    try {
      ({ error: signInError } = await createClient().auth.signInWithPassword({ email: address, password }));
    } catch {
      signInError = { message: "fetch failed", status: 0 };
    }
    if (signInError) {
      if (isEmailNotConfirmed(signInError)) setUnconfirmedEmail(address);
      else setError(isNetworkError(signInError) ? NETWORK_ERROR : signInError.message ?? NETWORK_ERROR);
      setBusy(false);
      return;
    }
    router.replace(destination);
  }

  return (
    <main className="auth-shell">
      <section className="auth-card panel" aria-labelledby="login-title">
        <div className="auth-brand"><span className="brand-mark">SL</span><span><strong>Shop Ledger</strong><small>UAE retail till</small></span></div>
        <div className="eyebrow">Owner access</div>
        <h1 id="login-title">Sign in to your shop</h1>
        <p className="page-copy">Sign in with the email and password for your shop account.</p>
        <form className="auth-form" onSubmit={submit}>
          <label className="field-label" htmlFor="email">Email</label>
          <input className="input" id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
          <label className="field-label" htmlFor="password">Password</label>
          <input className="input" id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" />
          <div className="auth-row-link"><Link href="/forgot-password">Forgot password?</Link></div>
          {error ? <div className="notice error-notice" role="alert"><LockKey size={17} weight="bold" /><span>{error}</span></div> : null}
          {unconfirmedEmail ? <div className="notice" role="alert"><EnvelopeSimple size={17} weight="bold" /><span>Confirm your email first. We sent a link to {unconfirmedEmail}.</span></div> : null}
          <button className="button primary auth-submit" type="submit" disabled={busy}><SignIn size={16} weight="bold" />{busy ? "Signing in…" : "Sign in"}</button>
        </form>
        {unconfirmedEmail ? <ResendLinkButton key={unconfirmedEmail} email={unconfirmedEmail} coolingDown={false} /> : null}
        <div className="auth-links">
          <Link href="/signup">New here? Start your free trial</Link>
        </div>
        <div className="auth-form">
          <button className="button auth-submit" type="button" onClick={trySample}><Storefront size={16} weight="bold" />Try the sample shop</button>
          <p className="field-hint">Explore with demo data. Nothing is saved to an account.</p>
        </div>
        <p className="auth-footnote">Data access is protected by Supabase Auth and row-level security.</p>
      </section>
    </main>
  );
}
