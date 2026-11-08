"use client";

import { useEffect, useRef } from "react";

/** Pure: lock once `idleLockMinutes` have passed with no pointer, touch or key input. */
export function shouldLock(lastActivityMs: number, nowMs: number, idleLockMinutes: number): boolean {
  return nowMs - lastActivityMs >= idleLockMinutes * 60_000;
}

const EVENTS = ["pointerdown", "pointermove", "keydown", "touchstart", "wheel"] as const;

/** Calls `onIdle` once after the idle time while `enabled`; any input restarts the clock. */
export function useIdleLock(enabled: boolean, idleLockMinutes: number, onIdle: () => void) {
  const last = useRef(0);
  const callback = useRef(onIdle);
  useEffect(() => {
    callback.current = onIdle;
  }, [onIdle]);

  useEffect(() => {
    if (!enabled) return;
    last.current = Date.now();
    const touch = () => { last.current = Date.now(); };
    EVENTS.forEach((name) => window.addEventListener(name, touch, { passive: true }));
    const timer = window.setInterval(() => {
      if (shouldLock(last.current, Date.now(), idleLockMinutes)) callback.current();
    }, 5_000);
    return () => {
      EVENTS.forEach((name) => window.removeEventListener(name, touch));
      window.clearInterval(timer);
    };
  }, [enabled, idleLockMinutes]);
}
