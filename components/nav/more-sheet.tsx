"use client";

import { SignOut, X } from "@/components/icons";
import Link from "next/link";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { navIcon } from "@/components/nav/nav-icons";
import { useSyncStatusText } from "@/components/offline-runtime";
import { navLinksFor, type NavLink, type Role } from "@/lib/access/cashier";

/** Pages on the phone bar itself; the rest of this role's pages go in More. */
const PHONE_BAR = new Set(["/overview", "/sales", "/sale", "/inventory"]);

/** More's links for this role: an owner's Customers, Register, Reports, Settings; a cashier's without Reports. */
export function moreLinksFor(role: Role): NavLink[] {
  return navLinksFor(role).filter((link) => !PHONE_BAR.has(link.href));
}

const FOCUSABLE = "a[href], button:not([disabled])";

/** Phone "More": the less-used pages plus the till, the account, sync status and Sign out. */
export function MoreSheet({ links, open, onClose, shopName, tillLabel, email, signOutLabel, onSignOut }: {
  links: NavLink[];
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
          {links.map(({ href, label }) => {
            const Icon = navIcon(href);
            return <Link key={href} href={href} onClick={onClose}><Icon size={18} weight="bold" />{label}</Link>;
          })}
          {signOutLabel ? <button type="button" onClick={() => { onClose(); onSignOut(); }}><SignOut size={18} weight="bold" />{signOutLabel}</button> : null}
        </nav>
      </div>
    </div>
  );
}
