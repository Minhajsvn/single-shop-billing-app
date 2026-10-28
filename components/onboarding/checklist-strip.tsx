"use client";

import { CheckCircle, ListChecks } from "@/components/icons";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useShopContext } from "@/lib/demo-store";
import { checklistView } from "@/lib/onboarding/checklist";

const READY_VISIBLE_MS = 8000;

/** "Get ready to sell · N of 3 · Next: <step>" for owners until the shop has products, a register and a first sale. */
export function ChecklistStrip() {
  const { onboarding, role, mode } = useShopContext();
  const view = checklistView(onboarding, { role, mode });
  const done = view?.done ?? null;
  const [lastDone, setLastDone] = useState<number | null>(done);
  const [justFinished, setJustFinished] = useState(false);

  // The third step flipping to done while this page is open earns one "ready" line, then nothing.
  if (done !== lastDone) {
    setLastDone(done);
    if (done === 3 && lastDone !== null && lastDone < 3) setJustFinished(true);
  }

  useEffect(() => {
    if (!justFinished) return;
    const timer = window.setTimeout(() => setJustFinished(false), READY_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [justFinished]);

  if (!view) return null;
  if (!view.next) {
    return justFinished ? (
      <div className="onboarding-strip ready" role="status">
        <CheckCircle size={16} weight="bold" className="onboarding-strip-icon" aria-hidden />
        <span className="onboarding-strip-text">You&apos;re ready to sell.</span>
      </div>
    ) : null;
  }

  return (
    <div className="onboarding-strip" role="status">
      <ListChecks size={16} weight="bold" className="onboarding-strip-icon" aria-hidden />
      <span className="onboarding-strip-text">Get ready to sell · {view.done} of 3 · Next: {view.next.label}</span>
      <Link className="button" href={view.next.href}>{view.next.button}</Link>
    </div>
  );
}
