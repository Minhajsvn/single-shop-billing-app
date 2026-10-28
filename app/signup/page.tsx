"use client";

import { UserPlus, WarningCircle } from "@/components/icons";
import { CheckEmail } from "@/components/check-email";
import { NETWORK_ERROR, signupErrorMessage, validateSignup } from "@/lib/auth/signup";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The address the link went to; kept in memory, never in the URL.
  const [sentTo, setSentTo] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    void createClient().auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/overview");
    });
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = { name: name.trim(), email: email.trim(), password };
    const invalid = validateSignup(input);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (!isSupabaseConfigured()) {
      setError("Supabase is not configured for this build. Add the project URL and publishable key to .env.local.");
      return;
    }

    setBusy(true);
    setError(null);
    let message: string | null;
    try {
      const { error: signUpError } = await createClient().auth.signUp({
        email: input.email,
        password: input.password,
        options: { data: { full_name: input.name } },
      });
      message = signupErrorMessage(signUpError);
    } catch {
      message = NETWORK_ERROR;
    }
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    // Also reached for an address that already has an account: the form never reveals who signed up.
    setSentTo(input.email);
    setPassword("");
  }

  function startAgain() {
    setSentTo(null);
    setError(null);
  }

  return (
    <main className="auth-shell">
      <section className="auth-card panel" aria-labelledby={sentTo ? "check-email-title" : "signup-title"}>
        <div className="auth-brand"><span className="brand-mark">SL</span><span><strong>Shop Ledger</strong><small>UAE retail till</small></span></div>
        {sentTo ? (
          <CheckEmail email={sentTo} onStartAgain={startAgain} />
        ) : (
          <>
            <div className="eyebrow">New shop</div>
            <h1 id="signup-title">Start your free trial</h1>
            <p className="page-copy">14 days of Pro. No card needed.</p>
            <form className="auth-form" onSubmit={submit} noValidate>
              <label className="field-label" htmlFor="name">Your name</label>
              <input className="input" id="name" value={name} onChange={(event) => setName(event.target.value)} required autoComplete="name" />
              <label className="field-label" htmlFor="email">Email</label>
              <input className="input" id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
              <label className="field-label" htmlFor="password">Password</label>
              <input className="input" id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} autoComplete="new-password" aria-describedby="password-hint" />
              <p className="field-hint" id="password-hint">At least 8 characters.</p>
              {error ? <div className="notice error-notice" role="alert"><WarningCircle size={17} weight="bold" /><span>{error}</span></div> : null}
              <button className="button primary auth-submit" type="submit" disabled={busy}><UserPlus size={16} weight="bold" />{busy ? "Creating account…" : "Create account"}</button>
            </form>
            <div className="auth-links">
              <Link href="/login">Already have an account? Sign in</Link>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
