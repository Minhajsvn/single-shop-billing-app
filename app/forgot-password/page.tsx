"use client";

import { PaperPlaneTilt, WarningCircle } from "@/components/icons";
import { INVALID_EMAIL, isNetworkError, isValidEmail, NETWORK_ERROR, RATE_LIMITED } from "@/lib/auth/signup";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import Link from "next/link";
import { FormEvent, useState } from "react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = email.trim();
    if (!isValidEmail(address)) {
      setError(INVALID_EMAIL);
      return;
    }
    if (!isSupabaseConfigured()) {
      setError("Supabase is not configured for this build. Add the project URL and publishable key to .env.local.");
      return;
    }
    setBusy(true);
    setError(null);
    let failure: string | null = null;
    try {
      // The email template builds the link from the Site URL, so no redirect is passed here.
      const { error: resetError } = await createClient().auth.resetPasswordForEmail(address);
      if (isNetworkError(resetError)) failure = NETWORK_ERROR;
      else if (resetError?.status === 429) failure = RATE_LIMITED;
    } catch {
      failure = NETWORK_ERROR;
    }
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    // Same answer whether or not the address has an account.
    setSentTo(address);
  }

  return (
    <main className="auth-shell">
      <section className="auth-card panel" aria-labelledby="forgot-title">
        <div className="auth-brand"><span className="brand-mark">SL</span><span><strong>Shop Ledger</strong><small>UAE retail till</small></span></div>
        {sentTo ? (
          <>
            <div className="eyebrow">Password reset</div>
            <h1 id="forgot-title">Check your email</h1>
            <p className="page-copy">We sent a link to {sentTo}. Open it to continue.</p>
            <div className="auth-links">
              <button className="link-button" type="button" onClick={() => setSentTo(null)}>Wrong address? Start again</button>
              <Link href="/login">Back to sign in</Link>
            </div>
          </>
        ) : (
          <>
            <div className="eyebrow">Password reset</div>
            <h1 id="forgot-title">Forgot your password?</h1>
            <p className="page-copy">Enter your email and we will send you a link to choose a new one.</p>
            <form className="auth-form" onSubmit={submit} noValidate>
              <label className="field-label" htmlFor="email">Email</label>
              <input className="input" id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
              {error ? <div className="notice error-notice" role="alert"><WarningCircle size={17} weight="bold" /><span>{error}</span></div> : null}
              <button className="button primary auth-submit" type="submit" disabled={busy}><PaperPlaneTilt size={16} weight="bold" />{busy ? "Sending…" : "Send reset link"}</button>
            </form>
            <div className="auth-links">
              <Link href="/login">Back to sign in</Link>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
