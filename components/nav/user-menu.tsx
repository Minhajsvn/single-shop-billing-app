"use client";

import { CaretUp, Gear, SignOut } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSyncStatusText } from "@/components/offline-runtime";

/** Bottom of the desktop sidebar: till, branch and sync status; opens to the account, Settings and Sign out. */
export function UserMenu({ tillLabel, email, signOutLabel, onSignOut }: { tillLabel: string; email: string | null; signOutLabel: string | null; onSignOut: () => void }) {
  const status = useSyncStatusText();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className="user-menu" ref={root}>
      {open ? (
        <div className="user-menu-popover" role="menu">
          {email ? <div className="user-menu-email" title={email}>{email}</div> : null}
          <Link role="menuitem" href="/settings" onClick={() => setOpen(false)}><Gear size={15} weight="bold" />Settings</Link>
          {signOutLabel ? <button role="menuitem" type="button" onClick={() => { setOpen(false); onSignOut(); }}><SignOut size={15} weight="bold" />{signOutLabel}</button> : null}
        </div>
      ) : null}
      {status.attention ? <Link className={`sync-line ${status.tone}`} href={status.href}><span className="sync-dot" />{status.text}</Link> : null}
      <button type="button" className="user-menu-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span><strong>{tillLabel}</strong>{status.attention ? null : <span className={`sync-line ${status.tone}`}><span className="sync-dot" />{status.text}</span>}</span>
        <CaretUp size={14} weight="bold" />
      </button>
    </div>
  );
}
