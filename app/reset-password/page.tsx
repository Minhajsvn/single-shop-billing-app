"use client";

import { Key, WarningCircle } from "@phosphor-icons/react";
import { CONFIRM_FAILED, isNetworkError, NETWORK_ERROR, PASSWORD_RULE } from "@/lib/auth/signup";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

type View = "checking" | "ready" | "no-session";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [view, setView] = useState<View>("checking");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The reset link (/auth/confirm) signs the user in before sending them here.
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    void createClient().auth.getSession().then(({ data }) => setView(data.session ? "ready" : "no-session"));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 8) {
      setError(PASSWORD_RULE);
      return;
    }
    setBusy(true);
    setError(null);
    let message: string | null = null;
    try {
      const { error: updateError } = await createClient().auth.updateUser({ password });
      if (updateError) {
        if (isNetworkError(updateError)) message = NETWORK_ERROR;
        else if (updateError.code === "weak_password") message = PASSWORD_RULE;
        else message = updateError.message;
      }
    } catch {
      message = NETWORK_ERROR;
    }
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    router.replace("/overview");
  }

  return (
    <main className="auth-shell">
      <section className="auth-card panel" aria-labelledby="reset-title">
        <div className="auth-brand"><span className="brand-mark">SL</span><span><strong>Shop Ledger</strong><small>UAE retail till</small></span></div>
        <div className="eyebrow">Password reset</div>
        <h1 id="reset-title">Choose a new password</h1>
        {view === "checking" ? <p className="page-copy" role="status">Checking your link…</p> : null}
        {view === "no-session" ? (
          <>
            <div className="auth-form"><div className="notice error-notice" role="alert"><WarningCircle size={17} weight="bold" /><span>{CONFIRM_FAILED}</span></div></div>
            <div className="auth-links">
              <Link href="/forgot-password">Send a new link</Link>
              <Link href="/login">Back to sign in</Link>
            </div>
          </>
        ) : null}
        {view === "ready" ? (
          <form className="auth-form" onSubmit={submit} noValidate>
            <label className="field-label" htmlFor="password">New password</label>
            <input className="input" id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} autoComplete="new-password" aria-describedby="password-hint" />
            <p className="field-hint" id="password-hint">At least 8 characters.</p>
            {error ? <div className="notice error-notice" role="alert"><WarningCircle size={17} weight="bold" /><span>{error}</span></div> : null}
            <button className="button primary auth-submit" type="submit" disabled={busy}><Key size={16} weight="bold" />{busy ? "Saving…" : "Save new password"}</button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
