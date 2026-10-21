"use client";

import { ArrowCounterClockwise, MagnifyingGlass, Receipt } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { useOnline } from "@/components/offline-runtime";
import { lookupInvoice } from "@/components/sales/use-invoice-lookup";
import { useServerSales } from "@/components/sales/use-server-sales";
import { isOwnerView } from "@/lib/access/cashier";
import { EmptyState, Pager, Skeleton, SummaryStrip } from "@/components/ui/list-parts";
import { useListParams } from "@/components/ui/use-list-params";
import { useDemoStore, useShopContext } from "@/lib/demo-store";
import { formatAED, formatDateTime, type Sale } from "@/lib/domain";
import { DATE_CHIPS, chipIsServer, chipRange, localHistoryRange, type DateChip } from "@/lib/lists/date-chips";
import { mergeUnsyncedSales, saleToRow, type SaleRow } from "@/lib/lists/merge-results";
import { PAGE_SIZE, paginate } from "@/lib/lists/paging";
import { saleMatches } from "@/lib/lists/search";

const OFFLINE_MESSAGE = "Older sales can be searched when this device is online. Showing the last 90 days.";
const ERROR_MESSAGE = "Older sales could not be loaded. Showing the last 90 days.";
const isChip = (value: string): value is DateChip => DATE_CHIPS.some(({ chip }) => chip === value);

/** A cashier refunds a returning customer's sale from its receipt: exact invoice number, no browsing (owner decision 8). */
function RefundByInvoice({ sales }: { sales: Sale[] }) {
  const router = useRouter();
  const online = useOnline();
  const [invoice, setInvoice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const wanted = invoice.trim();
    if (!wanted) return;
    setError("");
    // Today's sales are already on this browser (also offline).
    const local = sales.find((sale) => sale.invoiceNumber.toLowerCase() === wanted.toLowerCase());
    if (local) return router.push(`/sales/${local.id}`);
    if (!online) return setError("Connect to the internet to find older sales.");
    setBusy(true);
    const result = await lookupInvoice(wanted);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    router.push(`/sales/${result.lookup.sale.id}?invoice=${encodeURIComponent(result.lookup.sale.invoiceNumber)}`);
  }

  return (
    <form className="panel-body refund-lookup" onSubmit={(event) => void submit(event)}>
      <label className="field-label" htmlFor="refund-invoice">Refund a sale by invoice number</label>
      <div className="toolbar">
        <div className="search"><Receipt size={16} weight="bold" /><input className="input" id="refund-invoice" value={invoice} onChange={(event) => { setInvoice(event.target.value); setError(""); }} placeholder="Invoice number from the receipt" autoComplete="off" spellCheck={false} /></div>
        <button className="button" type="submit" disabled={busy || !invoice.trim()}><ArrowCounterClockwise size={15} weight="bold" />{busy ? "Finding…" : "Find sale"}</button>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </form>
  );
}

export function SalesWorkspace() {
  const store = useDemoStore();
  const { mode, role } = useShopContext();
  const ownerView = isOwnerView(role);
  const online = useOnline();
  const [params, setParams] = useListParams({ q: "", chip: "last30", page: "1" });
  // A cashier sees today's sales only (owner decision 7): the other chips and server search are off.
  const chips = ownerView ? DATE_CHIPS : DATE_CHIPS.filter((item) => item.chip === "today");
  const chip: DateChip = !ownerView ? "today" : isChip(params.chip) ? params.chip : "last30";
  const page = Number(params.page) || 1;
  const now = useMemo(() => new Date(), []);

  // This year and All reach past the browser's 90 days: hosted shops ask the server when online.
  const wantsServer = chipIsServer(chip) && mode === "hosted" && ownerView;
  const unsynced = useMemo(() => store.syncOperations.flatMap((operation) => (
    operation.entity === "sale" && operation.status !== "synced" && operation.payload && "sale" in operation.payload ? [operation.payload.sale as Sale] : []
  )), [store.syncOperations]);
  const server = useServerSales(wantsServer && online, params.q, chipRange(chip, now), page, unsynced.length);
  const serverUnavailable = wantsServer && (!online || server.status === "error");
  const useServer = wantsServer && !serverUnavailable;
  const range = serverUnavailable ? localHistoryRange(now) : chipRange(chip, now);

  // A shift that runs past midnight keeps its sales in "Today" for a cashier until the register closes.
  const shiftStart = !ownerView && store.register?.status === "open" ? store.register.openedAt : null;
  const localMatches = useMemo(
    () => store.sales
      .filter((sale) => saleMatches(sale, params.q) && (((!range.from || sale.supplyDate >= range.from) && sale.supplyDate <= range.to) || (shiftStart !== null && sale.createdAt >= shiftStart)))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [params.q, range.from, range.to, shiftStart, store.sales],
  );

  let rows: SaleRow[];
  let pager: { page: number; pageCount: number; from: number; to: number; total: number };
  if (useServer) {
    // Unsynced sales made on this device appear on the first page until the server has them.
    const merged = mergeUnsyncedSales(server.rows, unsynced, params.q, chipRange(chip, now));
    const extra = merged.length - server.rows.length;
    rows = page === 1 ? merged : server.rows;
    // The extra rows sit on page 1, so later pages start that many rows further on; the total counts them everywhere.
    const total = server.total + extra;
    const pageCount = Math.max(1, Math.ceil(server.total / PAGE_SIZE));
    const from = rows.length ? (page - 1) * PAGE_SIZE + 1 + (page === 1 ? 0 : extra) : 0;
    pager = { page, pageCount, from, to: rows.length ? from + rows.length - 1 : 0, total };
  } else {
    const paged = paginate(localMatches, page);
    rows = paged.items.map(saleToRow);
    pager = paged;
  }

  const creditedSaleIds = new Set(store.creditNotes.map((note) => note.saleId));
  const gross = localMatches.reduce((sum, sale) => sum + sale.grossFils, 0);
  const chipLabel = DATE_CHIPS.find((item) => item.chip === chip)?.label ?? "";
  const strip = useServer
    ? [{ label: chipLabel, value: `${pager.total.toLocaleString("en-US")} sales` }]
    : [
      { label: serverUnavailable ? "Last 90 days" : chipLabel, value: formatAED(gross) },
      { label: "Sales", value: localMatches.length.toLocaleString("en-US") },
      { label: "Avg", value: formatAED(localMatches.length ? Math.round(gross / localMatches.length) : 0) },
    ];

  return (
    <>
      <div className="page-heading"><div><div className="eyebrow">Immutable invoice ledger</div><h1 className="page-title">Sales</h1><p className="page-copy">{ownerView ? "Find any invoice by number, customer name or phone." : "Today's sales. To refund an older sale, enter the invoice number from its receipt."}</p></div><Link className="button primary" href="/sale">New sale</Link></div>
      <SummaryStrip label="Sales summary" items={strip} />
      {!ownerView && mode === "hosted" ? <section className="panel"><RefundByInvoice sales={store.sales} /></section> : null}
      <section className="panel sales-ledger">
        <div className="panel-body list-controls">
          <div className="search"><MagnifyingGlass size={16} weight="bold" /><input className="input" value={params.q} onChange={(event) => setParams({ q: event.target.value, page: "1" })} placeholder="Invoice number, customer name or phone" aria-label="Search sales" /></div>
          <div className="chips" role="radiogroup" aria-label="Dates">
            {chips.map((item) => <button key={item.chip} type="button" role="radio" aria-checked={chip === item.chip} className={`chip ${chip === item.chip ? "on" : ""}`} onClick={() => setParams({ chip: item.chip, page: "1" })}>{item.label}</button>)}
          </div>
          {serverUnavailable ? <p className="notice list-notice" role="status">{online ? ERROR_MESSAGE : OFFLINE_MESSAGE}</p> : null}
        </div>
        {useServer && server.status !== "loaded" && !rows.length ? <Skeleton variant="list" /> : rows.length ? (
          <div className="table-wrap"><table><thead><tr><th>Invoice</th><th>Customer</th><th>Issued</th><th>Payment</th><th className="numeric">Total</th></tr></thead><tbody>{rows.map((row) => (
            <tr key={row.id}>
              <td><Link className="invoice-link" href={`/sales/${row.id}`}>{row.invoiceNumber}</Link>{creditedSaleIds.has(row.id) ? <div className="product-meta">Credit issued</div> : null}{row.local ? <div className="product-meta">Not synced yet</div> : null}</td>
              <td>{row.customerName ?? "Walk-in"}{row.customerPhone ? <div className="product-meta">{row.customerPhone}</div> : null}</td>
              <td>{formatDateTime(row.createdAt)}</td>
              <td><span className={`badge ${row.paymentMethod === "cash" ? "green" : "blue"}`}>{row.paymentMethod}</span></td>
              <td className="numeric product-name">{formatAED(row.grossFils)}</td>
            </tr>
          ))}</tbody></table></div>
        ) : (
          <EmptyState
            icon={<Receipt size={30} weight="duotone" />}
            title={params.q ? `No sales match "${params.q}" in ${(serverUnavailable ? "the last 90 days" : chipLabel.toLowerCase())}` : `No sales in ${chipLabel.toLowerCase()}`}
            hint="Try another search or date range."
            action={chip !== "all" && ownerView ?<button type="button" className="button" onClick={() => setParams({ chip: "all", page: "1" })}>Search all dates</button> : undefined}
          />
        )}
        <Pager {...pager} onPage={(next) => setParams({ page: String(next) })} />
      </section>
    </>
  );
}
