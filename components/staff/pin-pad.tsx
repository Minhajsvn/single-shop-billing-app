"use client";

import { ArrowLeft } from "@/components/icons";
import { useEffect, useRef, useState } from "react";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"] as const;

function mmss(ms: number) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Four dots and large keys; the keyboard's digits and Backspace work too. `onSubmit` gets the 4 digits and returns
 * whether they were right; a wrong PIN shakes the dots and clears them. While `blockedMs` > 0 nothing is accepted.
 */
export function PinPad({ label, onSubmit, blockedMs = 0, busy = false }: { label: string; onSubmit: (pin: string) => Promise<boolean>; blockedMs?: number; busy?: boolean }) {
  const [digits, setDigitsState] = useState("");
  const [shake, setShake] = useState(false);
  const [checking, setChecking] = useState(false);
  // Keys can arrive faster than React re-renders, so the typed digits and the busy flag live in refs too.
  const typed = useRef("");
  const checkingRef = useRef(false);
  const disabled = busy || checking || blockedMs > 0;
  const setDigits = (value: string) => { typed.current = value; setDigitsState(value); };

  async function press(key: string) {
    if (busy || checkingRef.current || blockedMs > 0) return;
    if (key === "back") return setDigits(typed.current.slice(0, -1));
    if (!/^[0-9]$/.test(key) || typed.current.length >= 4) return;
    const next = typed.current + key;
    setDigits(next);
    if (next.length < 4) return;
    checkingRef.current = true;
    setChecking(true);
    const ok = await onSubmit(next);
    checkingRef.current = false;
    setChecking(false);
    if (!ok) {
      setShake(true);
      window.setTimeout(() => setShake(false), 400);
      setDigits("");
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (/^[0-9]$/.test(event.key)) { event.preventDefault(); void press(event.key); }
      else if (event.key === "Backspace") { event.preventDefault(); void press("back"); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="pin-pad" aria-label={label}>
      <div className={`pin-dots ${shake ? "shake" : ""}`} role="status" aria-live="polite" aria-label={`${digits.length} of 4 digits entered`}>
        {[0, 1, 2, 3].map((i) => <span key={i} className={i < digits.length ? "filled" : ""} />)}
      </div>
      {blockedMs > 0 ? <p className="pin-blocked" role="alert">Too many wrong tries. Try again in {mmss(blockedMs)}.</p> : null}
      <div className="pin-keys">
        {KEYS.map((key, i) => key === ""
          ? <span key={i} />
          : <button key={i} type="button" className="pin-key" disabled={disabled} onClick={() => void press(key)} aria-label={key === "back" ? "Delete last digit" : key}>
              {key === "back" ? <ArrowLeft size={22} weight="bold" /> : key}
            </button>)}
      </div>
    </div>
  );
}
