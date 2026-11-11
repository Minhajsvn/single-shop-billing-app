"use client";

import { Archive, ArrowCounterClockwise, DownloadSimple, PencilSimple, Plus, Sparkle, Tag, WarningCircle } from "@/components/icons";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useEntitlement } from "@/components/billing/use-entitlement";
import { useOnline } from "@/components/offline-runtime";
import { PromotionForm } from "@/components/promotions/promotion-form";
import { EmptyState } from "@/components/ui/list-parts";
import { refreshSnapshot, useDemoStore, useShopContext } from "@/lib/demo-store";
import { formatAED } from "@/lib/domain";
import { periodRange, type PeriodKey } from "@/lib/profit/math";
import { describePromotion } from "@/lib/promotions/describe";
import { listPromotions, promotionResults, savePromotion, type PromotionResult } from "@/lib/promotions/client";
import type { Promotion } from "@/lib/promotions/types";
import { safeCsv, uaeBusinessDate } from "@/lib/reporting";
import { toast } from "@/lib/ui/toast-store";

type Tab = "current" | "scheduled" | "ended" | "archived" | "results";
const TABS: { key: Tab; label: string }[] = [
  { key: "current", label: "Active now" },
  { key: "scheduled", label: "Scheduled" },
  { key: "ended", label: "Ended" },
  { key: "archived", label: "Archived" },
  { key: "results", label: "Results" },
];
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Today" }, { key: "this-week", label: "This week" }, { key: "this-month", label: "This month" }, { key: "last-month", label: "Last month" },
];

function tabOf(p: Promotion, today: string): Exclude<Tab, "results"> {
  if (p.archived) return "archived";
  if (p.endsOn && p.endsOn < today) return "ended";
  if (p.startsOn > today) return "scheduled";
  return "current";
}

/** Stage 2E: promotions for owner and manager on Pro (online). */
export function PromotionsWorkspace() {
  const { mode } = useShopContext();
  const { hasFeature } = useEntitlement();
  const online = useOnline();
  const blocked = mode !== "hosted" ? "Promotions work in your own shop." : !hasFeature("promotions") ? "pro" : !online ? "Promotions need a connection" : null;
  return <>
    <div className="page-heading"><div><div className="eyebrow">Automatic offers</div><h1 className="page-title">Promotions</h1><p className="page-copy">Set an offer once; every till applies it, online or offline.</p></div></div>
    {blocked === "pro"
      ? <section className="panel locked-card" role="note"><div className="panel-body"><Sparkle size={20} weight="bold" /><div><div className="panel-title">Run automatic offers at the till on Pro</div><p className="field-hint">Percent and AED off, buy N get M free, bundles, whole-bill offers and happy hours. <Link href="/settings?tab=billing">See plans</Link>.</p></div></div></section>
      : blocked ? <div className="notice" role="status"><WarningCircle size={18} weight="fill" /><span>{blocked}</span></div>
        : <PromotionsBody />}
  </>;
}

function PromotionsBody() {
  const store = useDemoStore();
  const [tab, setTab] = useState<Tab>("current");
  const [promotions, setPromotions] = useState<Promotion[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Promotion | "new" | null>(null);
  const [version, setVersion] = useState(0);
  const today = uaeBusinessDate(new Date());

  useEffect(() => {
    let live = true;
    void listPromotions().then((result) => {
      if (!live) return;
      if (result.ok) {
        setPromotions(result.promotions);
        setError("");
      } else setError(result.error);
    });
    return () => { live = false; };
  }, [version]);

  const names = useMemo(() => new Map<string, string>([...store.products.map((p) => [p.id, p.name] as const), ...(store.categories ?? []).map((c) => [c.id, c.name] as const)]), [store.products, store.categories]);
  const shown = (promotions ?? []).filter((p) => tabOf(p, today) === tab);

  async function change(p: Promotion, patch: Partial<Promotion>, done: string) {
    const result = await savePromotion({ ...p, ...patch });
    if (!result.ok) return setError(result.error);
    toast(done);
    setVersion((value) => value + 1);
    void refreshSnapshot();
  }

  return <>
    <div className="toolbar">
      <div className="segmented report-tabs" role="tablist" aria-label="Promotions">{TABS.map((item) => <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} className={`button ${tab === item.key ? "primary" : ""}`} onClick={() => setTab(item.key)}>{item.label}</button>)}</div>
      <button type="button" className="button primary toolbar-action" onClick={() => setEditing("new")}><Plus size={15} weight="bold" /> New promotion</button>
    </div>
    {error ? <div className="notice error-notice" role="alert"><WarningCircle size={18} weight="fill" /><span>{error}</span></div> : null}
    {tab === "results" ? <ResultsTab /> : promotions === null && !error ? <p className="field-hint" role="status">Loading promotions…</p> : (
      <section className="panel">{shown.length ? (
        <div className="table-wrap stack-table"><table><thead><tr><th>Promotion</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{shown.map((p) => (
            <tr key={p.id}>
              <td data-label="Promotion"><div className="product-name">{p.name}</div><div className="product-meta">{describePromotion(p, p.targetId ? names.get(p.targetId) ?? "a removed item" : "")}</div></td>
              <td data-label="Status">{p.archived ? <span className="badge yellow">Archived</span>
                : <label className="promo-switch"><input type="checkbox" checked={p.active} onChange={(event) => void change(p, { active: event.target.checked }, event.target.checked ? "Promotion on" : "Promotion paused")} /> {p.active ? "On" : "Paused"}</label>}</td>
              <td className="numeric row-actions-cell"><div className="row-actions">
                {p.archived ? <button type="button" className="button" onClick={() => void change(p, { archived: false }, "Promotion restored")}><ArrowCounterClockwise size={14} weight="bold" /> Restore</button> : <>
                  <button type="button" className="button" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}><PencilSimple size={14} weight="bold" /> Edit</button>
                  <button type="button" className="button" onClick={() => void change(p, { archived: true }, "Promotion archived")} aria-label={`Archive ${p.name}`}><Archive size={14} weight="bold" /> Archive</button>
                </>}
              </div></td>
            </tr>))}</tbody></table></div>
      ) : <EmptyState icon={<Tag size={28} weight="duotone" />} title="No promotions here" hint="Create one with New promotion; every till picks it up within a few minutes." />}</section>
    )}
    {editing ? <PromotionForm promotion={editing === "new" ? undefined : editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); toast("Promotion saved"); setVersion((value) => value + 1); void refreshSnapshot(); }} /> : null}
  </>;
}

function ResultsTab() {
  const [period, setPeriod] = useState<PeriodKey>("this-month");
  const range = useMemo(() => periodRange(period, new Date()), [period]);
  const key = `${range.from}:${range.to}`;
  const [state, setState] = useState<{ key: string; results?: PromotionResult[]; error?: string } | null>(null);
  useEffect(() => {
    let live = true;
    void promotionResults(range.from, range.to).then((result) => { if (live) setState(result.ok ? { key, results: result.results } : { key, error: result.error }); });
    return () => { live = false; };
  }, [key, range.from, range.to]);
  const current = state?.key === key ? state : null;
  const rows = current?.results ?? [];

  function download() {
    const aed = (fils: number | null) => (fils === null ? "" : (fils / 100).toFixed(2));
    const table = [["Promotion", "Uses", "Units", "Net AED", "Saving AED", "Cost AED", "Profit AED"], ...rows.map((r) => [r.name, r.uses, r.units, aed(r.netFils), aed(r.savingFils), aed(r.costFils), aed(r.profitFils)])];
    const url = URL.createObjectURL(new Blob(["﻿", table.map((row) => row.map(safeCsv).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `billo-promotions-${range.from}-${range.to}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className="panel">
    <div className="panel-body"><div className="toolbar profit-periods">
      <div className="segmented" role="radiogroup" aria-label="Period">{PERIODS.map((item) => <button key={item.key} type="button" role="radio" aria-checked={period === item.key} className={`button ${period === item.key ? "primary" : ""}`} onClick={() => setPeriod(item.key)}>{item.label}</button>)}</div>
      <button type="button" className="button" disabled={!rows.length} onClick={download}><DownloadSimple size={15} weight="bold" /> CSV</button>
    </div></div>
    {current?.error ? <div className="notice error-notice" role="alert"><WarningCircle size={18} weight="fill" /><span>{current.error}</span></div> : null}
    {!current ? <p className="field-hint panel-body">Loading results…</p> : rows.length ? (
      <div className="table-wrap stack-table"><table><thead><tr><th>Promotion</th><th className="numeric">Uses</th><th className="numeric">Units</th><th className="numeric">Net sales</th><th className="numeric">Saving</th><th className="numeric">Profit</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.promotionId}><td data-label="Promotion" className="product-name">{r.name}</td><td data-label="Uses" className="numeric">{r.uses}</td><td data-label="Units" className="numeric">{r.units}</td><td data-label="Net sales" className="numeric">{formatAED(r.netFils)}</td><td data-label="Saving" className="numeric">{formatAED(r.savingFils)}</td><td data-label="Profit" className="numeric">{r.profitFils === null ? "—" : formatAED(r.profitFils)}</td></tr>)}</tbody></table></div>
    ) : <div className="panel-body"><p className="field-hint">No sales used a promotion in this period (synced sales only).</p></div>}
  </section>;
}
