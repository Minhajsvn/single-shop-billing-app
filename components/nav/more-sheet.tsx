"use client";

import { CashRegister, ChartBar, Gear, IdentificationCard, SignOut, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { useSyncStatusText } from "@/components/offline-runtime";

export const MORE_LINKS = [
  { href: "/customers", label: "Customers", icon: IdentificationCard },
  { href: "/register", label: "Register", icon: CashRegister },
  { href: "/reports", label: "Reports", icon: ChartBar },
  { href: "/settings", label: "Settings", icon: Gear },
];

const FOCUSABLE = "a[href], button:not([disabled])";

/** Phone "More": the less-used pages plus the till, the account, sync status and Sign out. */
export function MoreSheet({ open, onClose, shopName, tillLabel, email, signOutLabel, onSignOut }: {
  open: boolean;
  onClose: () => void;
  shopName: string;
  tillLabel: string;
  email: string | null;
  signOutLabel: string | null;
  onSignOut: () => void;
}) {
  const status = useSyncStatusText();
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheet.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => { opener?.focus(); };
  }, [open]);

  if (!open) return null;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !sheet.current) return;
    const items = [...sheet.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (event.shiftKey && document.activeElement === items[0]) {
      event.preventDefault();
      items[items.length - 1]?.focus();
    } else if (!event.shiftKey && document.activeElement === items[items.length - 1]) {
      event.preventDefault();
      items[0]?.focus();
    }
  }

  return (
    <div className="more-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={sheet} className="more-sheet" role="dialog" aria-modal="true" aria-label="More" onKeyDown={onKeyDown}>
        <div className="more-head">
          <div>
            <strong>{shopName}</strong>
            <span>{tillLabel}{email ? ` · ${email}` : ""}</span>
            {status.attention
              ? <Link className={`sync-line ${status.tone}`} href={status.href} onClick={onClose}><span className="sync-dot" />{status.text}</Link>
              : <span className={`sync-line ${status.tone}`}><span className="sync-dot" />{status.text}</span>}
          </div>
          <button type="button" className="button icon-only" onClick={onClose} aria-label="Close"><X size={16} weight="bold" /></button>
        </div>
        <nav className="more-links" aria-label="More pages">
          {MORE_LINKS.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={onClose}><Icon size={18} weight="bold" />{label}</Link>)}
          {signOutLabel ? <button type="button" onClick={() => { onClose(); onSignOut(); }}><SignOut size={18} weight="bold" />{signOutLabel}</button> : null}
        </nav>
      </div>
    </div>
  );
}
