"use client";

import { PaperPlaneTilt, WarningCircle } from "@/components/icons";
import { isNetworkError, NETWORK_ERROR, RATE_LIMITED, RESEND_COOLDOWN_SECONDS } from "@/lib/auth/signup";
import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";

/** "Send the link again": resends the sign-up confirmation, then stays disabled for 60 seconds. */
export function ResendLinkButton({ email, coolingDown }: { email: string; coolingDown: boolean }) {
  const [secondsLeft, setSecondsLeft] = useState(coolingDown ? RESEND_COOLDOWN_SECONDS : 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = window.setTimeout(() => setSecondsLeft((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [secondsLeft]);

  async function resend() {
    setBusy(true);
    setError(null);
    setSent(false);
    let failure: { message?: string; status?: number; name?: string } | null = null;
    try {
      const { error: resendError } = await createClient().auth.resend({ type: "signup", email });
      failure = resendError;
    } catch (caught) {
      failure = { message: caught instanceof Error ? caught.message : "fetch failed", status: 0 };
    }
    setBusy(false);
    // Supabase answers the same way for unknown addresses, so only a network failure is worth showing.
    if (failure && (isNetworkError(failure) || failure.status === 429)) {
      setError(isNetworkError(failure) ? NETWORK_ERROR : RATE_LIMITED);
      return;
    }
    setSent(true);
    setSecondsLeft(RESEND_COOLDOWN_SECONDS);
  }

  return (
    <div className="auth-form">
      {error ? <div className="notice error-notice" role="alert"><WarningCircle size={17} weight="bold" /><span>{error}</span></div> : null}
      <button className="button auth-submit" type="button" onClick={resend} disabled={busy || secondsLeft > 0}>
        <PaperPlaneTilt size={16} weight="bold" />Send the link again
      </button>
      <p className="field-hint" role="status">
        {secondsLeft > 0 ? `${sent ? "Sent. " : ""}You can send it again in ${secondsLeft} s.` : sent ? "Sent." : ""}
      </p>
    </div>
  );
}

export function CheckEmail({ email, onStartAgain }: { email: string; onStartAgain: () => void }) {
  return (
    <>
      <div className="eyebrow">One more step</div>
      <h1 id="check-email-title">Check your email</h1>
      <p className="page-copy">We sent a link to {email}. Open it to continue.</p>
      <ResendLinkButton email={email} coolingDown />
      <div className="auth-links">
        <button className="link-button" type="button" onClick={onStartAgain}>Wrong address? Start again</button>
      </div>
    </>
  );
}
