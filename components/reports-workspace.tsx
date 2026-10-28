"use client";

import { CalendarBlank, DownloadSimple, Printer, Receipt } from "@/components/icons";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useDemoStore } from "@/lib/demo-store";
import { formatAED, formatDateTime } from "@/lib/domain";
import { printDocument } from "@/lib/print";
import { buildDailyReport, dailyReportCsv, uaeBusinessDate } from "@/lib/reporting";
import { EmptyState, SummaryStrip } from "@/components/ui/list-parts";

function reportDateLabel(value: string) {
  return new Intl.DateTimeFormat("en-AE", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T12:00:00Z`));
}

export function ReportsWorkspace() {
  const store = useDemoStore();
  const [date, setDate] = useState(store.sales[0]?.supplyDate ?? uaeBusinessDate(new Date()));
  const [exported, setExported] = useState(false);
  const report = useMemo(() => buildDailyReport(store, date), [store, date]);
  const paymentTotal = Math.max(1, report.cashFils + report.cardFils);

  function downloadCsv() {
    const blob = new Blob(["\uFEFF", dailyReportCsv(report)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `shop-ledger-daily-${date}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExported(true);
    window.setTimeout(() => setExported(false), 2200);
  }

  function printReport() {
    printDocument("daily-report");
  }

  return <>
    <div className="page-heading no-print"><div><div className="eyebrow">Daily reconciliation</div><h1 className="page-title">Reports</h1><p className="page-copy">One Dubai business day across invoices, VAT, payment methods, returns, and the register.</p></div><div className="report-actions"><label className="date-control"><CalendarBlank size={16} weight="bold" /><span className="sr-only">Business date</span><input type="date" value={date} onInput={(event) => setDate(event.currentTarget.value)} /></label><button className="button" onClick={downloadCsv}><DownloadSimple size={16} weight="bold" /> Export CSV</button><button className="button primary" onClick={printReport}><Printer size={16} weight="bold" /> Print report</button>{exported && <span className="badge green" role="status">CSV downloaded</span>}</div></div>

    <article className="daily-report-document">
      <header className="report-print-header"><div><span>Shop Ledger UAE</span><strong>Daily sales report</strong></div><div><span>Business date</span><strong>{reportDateLabel(date)}</strong></div></header>
      <div className="no-print"><SummaryStrip label="Daily totals" items={[{ label: "Net sales", value: formatAED(report.netFils) }, { label: "VAT 5%", value: formatAED(report.vatFils) }, { label: "Gross", value: formatAED(report.grossFils) }, { label: "Returns", value: formatAED(report.returnsFils) }]} /></div>
      <section className="metric-grid report-metrics print-only" aria-label="Daily report totals"><div className="metric"><div className="metric-label">Net sales</div><div className="metric-value">{formatAED(report.netFils)}</div><div className="metric-note">After credit notes</div></div><div className="metric"><div className="metric-label">VAT 5%</div><div className="metric-value">{formatAED(report.vatFils)}</div><div className="metric-note">Included in gross</div></div><div className="metric"><div className="metric-label">Gross sales</div><div className="metric-value">{formatAED(report.grossFils)}</div><div className="metric-note">{report.invoiceCount} {report.invoiceCount === 1 ? "invoice" : "invoices"}</div></div><div className="metric"><div className="metric-label">Returns</div><div className="metric-value">{formatAED(report.returnsFils)}</div><div className="metric-note">{report.creditNoteCount} {report.creditNoteCount === 1 ? "credit note" : "credit notes"}</div></div></section>

      <div className="grid-two report-grid"><section className="panel"><div className="panel-header"><div><div className="panel-title">Payment breakdown</div><div className="panel-subtitle">Net of same-day refunds</div></div></div><div className="panel-body payment-breakdown"><div><div className="breakdown-copy"><span>Cash</span><strong>{formatAED(report.cashFils)}</strong></div><div className="breakdown-track"><span style={{ width: `${Math.max(0, report.cashFils / paymentTotal) * 100}%` }} /></div></div><div><div className="breakdown-copy"><span>Card</span><strong>{formatAED(report.cardFils)}</strong></div><div className="breakdown-track card"><span style={{ width: `${Math.max(0, report.cardFils / paymentTotal) * 100}%` }} /></div></div></div></section><section className="panel"><div className="panel-header"><div><div className="panel-title">Register reconciliation</div><div className="panel-subtitle">Drawer values for this business date</div></div></div>{report.register ? <div className="panel-body detail-list report-register"><div><span>Opening cash</span><strong>{formatAED(report.register.openingCashFils)}</strong></div><div><span>Expected cash</span><strong>{report.register.expectedCashFils === undefined ? "Register still open" : formatAED(report.register.expectedCashFils)}</strong></div><div><span>Counted cash</span><strong>{report.register.countedCashFils === undefined ? "Not counted" : formatAED(report.register.countedCashFils)}</strong></div><div><span>Variance</span><strong>{report.register.varianceFils === undefined ? "Pending close" : formatAED(report.register.varianceFils)}</strong></div></div> : <EmptyState compact icon={<Receipt size={28} weight="duotone" />} title="No register session" hint="The current local register does not belong to this date." />}</section></div>

      <section className="panel report-ledger"><div className="panel-header"><div><div className="panel-title">Document ledger</div><div className="panel-subtitle">Invoices and credit notes in chronological order</div></div></div>{report.transactions.length ? <div className="table-wrap"><table><thead><tr><th>Document</th><th>Issued</th><th>Customer</th><th>Payment</th><th className="numeric">Net</th><th className="numeric">VAT</th><th className="numeric">Gross</th></tr></thead><tbody>{report.transactions.map((item) => <tr key={`${item.type}-${item.id}`}><td>{item.type === "invoice" ? <Link className="invoice-link" href={`/sales/${item.id}`}>{item.number}</Link> : <><strong>{item.number}</strong><div className="product-meta">Credit note</div></>}</td><td>{formatDateTime(item.createdAt)}</td><td>{item.customer}</td><td><span className={`badge ${item.paymentMethod === "cash" ? "green" : "blue"}`}>{item.paymentMethod}</span></td><td className="numeric">{formatAED(item.netFils)}</td><td className="numeric">{formatAED(item.vatFils)}</td><td className="numeric product-name">{formatAED(item.grossFils)}</td></tr>)}</tbody></table></div> : <EmptyState icon={<Receipt size={30} weight="duotone" />} title="No documents for this date" hint="Choose another Dubai business date or complete a sale." action={<Link className="button primary no-print" href="/sale">New sale</Link>} />}</section>
      <footer className="report-print-footer">Generated from immutable local invoice and credit-note records · Currency AED · Timezone Asia/Dubai</footer>
    </article>
  </>;
}
