"use client";

import type { ReactNode } from "react";

const count = (value: number) => value.toLocaleString("en-US");

/** "‹ Previous · 51–100 of 1,240 · Next ›" under a list of 50 per page. */
export function Pager({ page, pageCount, from, to, total, onPage }: { page: number; pageCount: number; from: number; to: number; total: number; onPage: (page: number) => void }) {
  if (total <= 0) return null;
  return (
    <nav className="pager" aria-label="Pages">
      <button type="button" className="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Previous</button>
      <span className="pager-position" aria-live="polite">{count(from)}–{count(to)} of {count(total)}</span>
      <button type="button" className="button" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>Next ›</button>
    </nav>
  );
}

/** One slim line of 2–4 figures in place of the large summary cards. */
export function SummaryStrip({ items, label }: { items: { label: string; value: string }[]; label: string }) {
  return (
    <section className="summary-strip" aria-label={label}>
      {items.map((item) => <span key={item.label}><span className="summary-label">{item.label}</span> <strong>{item.value}</strong></span>)}
    </section>
  );
}

export function EmptyState({ icon, title, hint, action }: { icon: ReactNode; title: string; hint: string; action?: ReactNode }) {
  return <div className="empty">{icon}<h3>{title}</h3><p>{hint}</p>{action}</div>;
}

/** Grey placeholders in the final layout's shape while the shop loads. */
export function Skeleton({ variant, rows = 6 }: { variant: "list" | "cards" | "grid"; rows?: number }) {
  return (
    <div className={`skeleton skeleton-${variant}`} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => <span key={index} className="skeleton-block" />)}
    </div>
  );
}
