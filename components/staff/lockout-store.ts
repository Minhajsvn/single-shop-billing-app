"use client";

import { useEffect, useState } from "react";
import { blockedFor, recordFailure, recordSuccess, type LockoutState } from "@/lib/staff/lockout";

// The wrong-PIN count is kept per till (this browser) so a reload does not reset a block (spec 2A §5.1).
const KEY = "billo.pinLockout";

function load(): LockoutState {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LockoutState) : {};
  } catch {
    return {};
  }
}

function save(state: LockoutState) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage blocked: the block still holds for this page.
  }
}

/** Lockout state plus a clock that ticks every second while someone is blocked, for the countdown. */
export function useLockout() {
  const [state, setState] = useState<LockoutState>(() => (typeof window === "undefined" ? {} : load()));
  const [now, setNow] = useState(() => Date.now());
  const anyBlocked = Object.values(state).some((entry) => entry.blockedUntil && entry.blockedUntil > now);

  useEffect(() => {
    if (!anyBlocked) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [anyBlocked]);

  return {
    blockedMs: (memberId: string) => blockedFor(state, memberId, now),
    fail(memberId: string) {
      const next = recordFailure(load(), memberId, Date.now());
      save(next);
      setState(next);
      setNow(Date.now());
    },
    succeed(memberId: string) {
      const next = recordSuccess(load(), memberId);
      save(next);
      setState(next);
    },
  };
}
