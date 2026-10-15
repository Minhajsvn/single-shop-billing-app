"use client";

import { LockKey, SignIn, Storefront } from "@phosphor-icons/react";
import { startSampleStore } from "@/lib/demo-store";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const supabase = createClient();
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/overview");
    });
  }, [router]);

  function trySample() {
    startSampleStore();
    router.replace("/overview");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    if (!isSupabaseConfigured()) {
      setError("Supabase is not configured for this build. Add the project URL and publishable key to .env.local.");
      setBusy(false);
      return;
    }

    const { error: signInError } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
    if (signInError) {
      setError(signInError.message);
      setBusy(false);
      return;
    }
    router.replace("/overview");
  }

  return (
    <main className="auth-shell">
      <section className="auth-card panel" aria-labelledby="login-title">
        <div className="auth-brand"><span className="brand-mark">SL</span><span><strong>Shop Ledger</strong><small>UAE retail till</small></span></div>
        <div className="eyebrow">Owner access</div>
        <h1 id="login-title">Sign in to your shop</h1>
        <p className="page-copy">Use the owner account created in Supabase to access the register and shop records.</p>
        <form className="auth-form" onSubmit={submit}>
          <label className="field-label" htmlFor="email">Email</label>
          <input className="input" id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
          <label className="field-label" htmlFor="password">Password</label>
          <input className="input" id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" />
          {error ? <div className="notice error-notice" role="alert"><LockKey size={17} weight="bold" /><span>{error}</span></div> : null}
          <button className="button primary auth-submit" type="submit" disabled={busy}><SignIn size={16} weight="bold" />{busy ? "Signing in…" : "Sign in"}</button>
        </form>
        <div className="auth-form">
          <button className="button auth-submit" type="button" onClick={trySample}><Storefront size={16} weight="bold" />Try the sample shop</button>
          <p className="field-hint">Explore with demo data. Nothing is saved to an account.</p>
        </div>
        <p className="auth-footnote">Data access is protected by Supabase Auth and row-level security.</p>
      </section>
    </main>
  );
}
