"use client";

import { DownloadSimple, Sparkle, WarningCircle } from "@/components/icons";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useOnline } from "@/components/offline-runtime";
import { EmptyState, SummaryStrip } from "@/components/ui/list-parts";
import { formatAED } from "@/lib/domain";
import type { SyncOperation } from "@/lib/domain";
import { fetchProfitReport } from "@/lib/profit/client";
import { profitCsv } from "@/lib/profit/csv";
import { MAX_HISTORY_DAYS, periodRange, type PeriodKey } from "@/lib/profit/math";
import type { ProfitReport } from "@/lib/profit/types";
import { uaeBusinessDate } from "@/lib/reporting";

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this-week", label: "This week" },
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
];

type SortKey = "profit" | "margin" | "net";
type Row = { key: string; name: string; netFils: number; costFils: number; profitFils: number; marginPct: number | null; quantity?: number };

function shiftDate(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(["﻿", text], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const pct = (value: number | null) => (value === null ? "—" : `${value.toFixed(1)}%`);

function sortRows(rows: Row[], key: SortKey) {
  const value = (row: Row) => (key === "profit" ? row.profitFils : key === "net" ? row.netFils : row.marginPct ?? Number.NEGATIVE_INFINITY);
  // The "Rest" row (products beyond the top 50) always stays last.
  const rest = (row: Row) => (row.key.startsWith("rest-") ? 1 : 0);
  return [...rows].sort((a, b) => rest(a) - rest(b) || value(b) - value(a) || a.name.localeCompare(b.name));
}

function ProfitTable({ title, rows, withQuantity, onExport }: { title: string; rows: Row[]; withQuantity?: boolean; onExport: () => void }) {
  const [sort, setSort] = useState<SortKey>("profit");
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);
  const header = (key: SortKey, label: string) => (
    <th className="numeric" aria-sort={sort === key ? "descending" : "none"}><button type="button" className="sort-button" onClick={() => setSort(key)}>{label}</button></th>
  );
  return (
    <section className="panel">
      <div className="panel-header"><div><div className="panel-title">{title}</div><div className="panel-subtitle">Profit and margin count costed lines only</div></div><button type="button" className="button" onClick={onExport} disabled={!rows.length}><DownloadSimple size={15} weight="bold" /> CSV</button></div>
      {rows.length ? (
        <div className="table-wrap stack-table"><table><thead><tr><th>{withQuantity ? "Product" : "Category"}</th>{withQuantity ? <th className="numeric">Qty</th> : null}{header("net", "Net sales")}<th className="numeric">Cost</th>{header("profit", "Profit")}{header("margin", "Margin")}</tr></thead>
          <tbody>{sorted.map((row) => (
            <tr key={row.key}><td data-label={withQuantity ? "Product" : "Category"}><span className="product-name">{row.name}</span></td>{withQuantity ? <td data-label="Qty" className="numeric">{row.quantity}</td> : null}<td data-label="Net sales" className="numeric">{formatAED(row.netFils)}</td><td data-label="Cost" className="numeric">{formatAED(row.costFils)}</td><td data-label="Profit" className="numeric product-name">{formatAED(row.profitFils)}</td><td data-label="Margin" className="numeric">{pct(row.marginPct)}</td></tr>
          ))}</tbody></table></div>
      ) : <div className="panel-body"><p className="field-hint">Nothing sold in this period.</p></div>}
    </section>
  );
}

/** Stage 2C: profit by day, category and product. Online only; owner or manager; Pro. */
export function ProfitTab({ allowed, syncOperations }: { allowed: boolean; syncOperations: SyncOperation[] }) {
  const online = useOnline();
  const today = uaeBusinessDate(new Date());
  const [period, setPeriod] = useState<PeriodKey | "day">("today");
  const [day, setDay] = useState(today);
  const range = useMemo(() => (period === "day" ? { from: day, to: day } : periodRange(period, new Date())), [period, day]);
  const [result, setResult] = useState<{ key: string; report?: ProfitReport; error?: string } | null>(null);
  const key = `${range.from}:${range.to}`;
  const pendingSales = syncOperations.some((op) => op.status !== "synced" && (op.entity === "sale" || op.entity === "credit-note"));

  useEffect(() => {
    if (!allowed || !online) return;
    let live = true;
    void fetchProfitReport(range.from, range.to).then((response) => {
      if (!live) return;
      setResult(response.ok ? { key, report: response.report } : { key, error: response.error });
    });
    return () => { live = false; };
  }, [allowed, online, key, range.from, range.to]);

  if (!allowed) {
    return (
      <section className="panel locked-card" role="note">
        <div className="panel-body"><Sparkle size={20} weight="bold" /><div><div className="panel-title">See profit by day, category and product on Pro</div><p className="field-hint">Add a cost to each product and billo works out gross profit and margin from every sale. <Link href="/settings?tab=billing">See plans</Link>.</p></div></div>
      </section>
    );
  }

  const current = result?.key === key ? result : null;
  const report = current?.report;
  const totals = report?.totals;
  const maxDayProfit = Math.max(1, ...(report?.byDay ?? []).map((row) => Math.abs(row.profitFils)));

  return (
    <div className="profit-tab">
      <div className="toolbar profit-periods">
        <div className="segmented" role="radiogroup" aria-label="Period">
          {PERIODS.map((item) => <button key={item.key} type="button" role="radio" aria-checked={period === item.key} className={`button ${period === item.key ? "primary" : ""}`} onClick={() => setPeriod(item.key)}>{item.label}</button>)}
        </div>
        <label className="profit-day"><span className="sr-only">One day</span><input className="input" type="date" value={period === "day" ? day : ""} min={shiftDate(today, -MAX_HISTORY_DAYS)} max={today} onChange={(event) => { if (event.target.value) { setDay(event.target.value); setPeriod("day"); } }} aria-label="Pick one day" /></label>
      </div>

      {!online ? <div className="notice" role="status"><WarningCircle size={18} weight="fill" /><span>Profit needs a connection</span></div> : null}
      {online && pendingSales ? <div className="notice" role="status"><WarningCircle size={18} weight="fill" /><span>Profit counts synced sales only</span></div> : null}
      {current?.error ? <div className="notice error-notice" role="alert"><WarningCircle size={18} weight="fill" /><span>{current.error}</span></div> : null}
      {online && !current ? <p className="field-hint" role="status">Loading profit…</p> : null}

      {totals ? <>
        <SummaryStrip label="Profit totals" items={[
          { label: "Net sales excl. VAT", value: formatAED(totals.netFils) },
          { label: "Cost", value: formatAED(totals.costFils) },
          { label: "Gross profit", value: formatAED(totals.profitFils) },
          { label: "Margin", value: pct(totals.marginPct) },
        ]} />
        {totals.uncostedLines > 0 ? (
          <div className="notice" role="status"><WarningCircle size={18} weight="fill" /><span>{totals.uncostedLines} sold {totals.uncostedLines === 1 ? "line has" : "lines have"} no cost, so {formatAED(totals.uncostedNetFils)} of sales is left out of profit. <Link href="/inventory?filter=no-cost">Add costs in Products.</Link></span></div>
        ) : null}
        {report.byDay.length > 1 ? (
          <section className="panel">
            <div className="panel-header"><div><div className="panel-title">Profit by day</div></div><button type="button" className="button" onClick={() => download(`billo-profit-days-${range.from}-${range.to}.csv`, profitCsv("day", report))}><DownloadSimple size={15} weight="bold" /> CSV</button></div>
            <div className="panel-body"><ol className="profit-bars">{report.byDay.map((row) => (
              <li key={row.date}><span className="profit-bar-date">{row.date.slice(5)}</span><span className="profit-bar-track"><span className={`profit-bar ${row.profitFils < 0 ? "negative" : ""}`} style={{ width: `${(Math.abs(row.profitFils) / maxDayProfit) * 100}%` }} /></span><span className="profit-bar-value">{formatAED(row.profitFils)}</span></li>
            ))}</ol></div>
          </section>
        ) : null}
        {report.byDay.length === 0 && report.byProduct.length === 0 ? <EmptyState icon={<WarningCircle size={28} weight="duotone" />} title="No sales in this period" hint="Choose another period or make a sale." /> : <>
          <ProfitTable title="By category" rows={report.byCategory.map((row) => ({ ...row, key: row.categoryId ?? "none" }))} onExport={() => download(`billo-profit-categories-${range.from}-${range.to}.csv`, profitCsv("category", report))} />
          <ProfitTable title="By product" withQuantity rows={report.byProduct.map((row, index) => ({ ...row, key: row.productId ?? `rest-${index}` }))} onExport={() => download(`billo-profit-products-${range.from}-${range.to}.csv`, profitCsv("product", report))} />
        </>}
      </> : null}
    </div>
  );
}
