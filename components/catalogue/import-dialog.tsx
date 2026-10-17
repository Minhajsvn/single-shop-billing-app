"use client";

import { DownloadSimple, FileArrowUp, Printer, X } from "@phosphor-icons/react";
import { useMemo, useState, type ChangeEvent } from "react";
import { useDemoProducts } from "@/hooks/use-demo-products";
import { planImport, type ImportPlan, type PlannedCreate } from "@/lib/catalogue/classify";
import { guessMapping } from "@/lib/catalogue/columns";
import { parseCsv, problemsToCsv } from "@/lib/catalogue/csv";
import type { Cell, ColumnMapping, ImportField } from "@/lib/catalogue/types";
import { useShopContext } from "@/lib/demo-store";
import { formatAED } from "@/lib/domain";

const FIELDS: { field: ImportField; label: string; required?: boolean }[] = [
  { field: "name", label: "Product name", required: true },
  { field: "price", label: "Price incl. VAT (AED)", required: true },
  { field: "barcode", label: "Barcode" },
  { field: "sku", label: "SKU" },
  { field: "stock", label: "Stock" },
  { field: "lowStock", label: "Low-stock threshold" },
  { field: "taxCategory", label: "VAT category" },
];
const VISIBLE_ROWS = 100;

type Step =
  | { kind: "file" }
  | { kind: "map"; rows: Cell[][]; offset: number; fileName: string; mapping: ColumnMapping }
  | { kind: "preview"; rows: Cell[][]; offset: number; fileName: string; mapping: ColumnMapping; plan: ImportPlan; skipped: Set<number> }
  | { kind: "done"; createdIds: string[]; updatedIds: string[]; operationIds: string[] };

const cellText = (cell: Cell) => cell === null || cell === undefined ? "" : cell instanceof Date ? cell.toISOString().slice(0, 10) : String(cell);
const isBlankRow = (row: Cell[]) => row.every((cell) => cellText(cell).trim() === "");

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** Moves every row number back to the spreadsheet's own numbering when blank rows came before the headings. */
function shiftRows(plan: ImportPlan, offset: number): ImportPlan {
  if (!offset) return plan;
  return {
    creates: plan.creates.map((row) => ({ ...row, rowNumber: row.rowNumber + offset })),
    updates: plan.updates.map((row) => ({ ...row, rowNumber: row.rowNumber + offset })),
    problems: plan.problems.map((row) => ({ ...row, rowNumber: row.rowNumber + offset })),
  };
}

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (!count) return null;
  return (
    <details className="import-group">
      <summary><strong>{title}</strong><span className="badge blue">{count.toLocaleString("en-US")}</span></summary>
      <div className="import-rows">{children}</div>
      {count > VISIBLE_ROWS ? <p className="field-hint">and {(count - VISIBLE_ROWS).toLocaleString("en-US")} more</p> : null}
    </details>
  );
}

export function ImportDialog({ onClose, onPrintLabels }: { onClose: () => void; onPrintLabels: (productIds: string[]) => void }) {
  const { products, applyImport, productLimit, syncOperations, syncProblems } = useDemoProducts();
  const { mode } = useShopContext();
  const [step, setStep] = useState<Step>({ kind: "file" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const productNames = useMemo(() => new Map(products.map((product) => [product.id, product.name])), [products]);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      let rows: Cell[][];
      if (/\.csv$/i.test(file.name)) {
        rows = parseCsv(await file.text());
      } else if (/\.xlsx$/i.test(file.name)) {
        // Loaded on demand so the spreadsheet reader is not part of every page.
        const { readSheet } = await import("read-excel-file/browser");
        rows = (await readSheet(file)) as Cell[][];
      } else {
        setError("Choose an Excel (.xlsx) or CSV (.csv) file.");
        return;
      }
      // The first non-empty row holds the headings.
      const offset = rows.findIndex((row) => !isBlankRow(row));
      if (offset === -1 || rows.slice(offset + 1).every(isBlankRow)) {
        setError("This file has no rows.");
        return;
      }
      const usable = rows.slice(offset);
      setStep({ kind: "map", rows: usable, offset, fileName: file.name, mapping: guessMapping(usable[0]) });
    } catch {
      setError("This file could not be read. Save it again as .xlsx or .csv and retry.");
    } finally {
      setBusy(false);
    }
  }

  function preview(current: Extract<Step, { kind: "map" }>) {
    const result = planImport(current.rows, current.mapping, products, { productLimit: productLimit(), newId: () => crypto.randomUUID() });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError("");
    setStep({ ...current, kind: "preview", plan: shiftRows(result.plan, current.offset), skipped: new Set() });
  }

  function confirm(current: Extract<Step, { kind: "preview" }>) {
    const plan = { ...current.plan, creates: current.plan.creates.filter((row) => !current.skipped.has(row.rowNumber)) };
    setStep({ kind: "done", ...applyImport(plan) });
  }

  const header = (
    <div className="modal-header">
      <div><div className="panel-title">Import products</div><div className="panel-subtitle">Excel (.xlsx) or CSV. Nothing is saved until you confirm.</div></div>
      <button type="button" className="button icon-only" onClick={onClose} aria-label="Close"><X size={16} weight="bold" /></button>
    </div>
  );

  let body: React.ReactNode;
  let footer: React.ReactNode;

  if (step.kind === "file") {
    body = (
      <div className="import-file">
        <label className="button primary import-file-button">
          <FileArrowUp size={18} weight="bold" /> {busy ? "Reading…" : "Choose file"}
          <input type="file" accept=".xlsx,.csv" onChange={chooseFile} disabled={busy} className="sr-only" />
        </label>
        <p className="field-hint">Only the first worksheet is read. The first row should hold the column headings (for example Name, Barcode, Price, Stock). Up to 5,000 rows per file.</p>
      </div>
    );
    footer = <button type="button" className="button" onClick={onClose}>Cancel</button>;
  } else if (step.kind === "map") {
    const headings = step.rows[0];
    const ready = step.mapping.name !== undefined && step.mapping.price !== undefined;
    body = (
      <>
        <p className="field-hint import-file-name">{step.fileName} · {(step.rows.length - 1).toLocaleString("en-US")} rows</p>
        <div className="form-grid">
          {FIELDS.map(({ field, label, required }) => (
            <div className="field" key={field}>
              <label htmlFor={`map-${field}`}>{label}{required ? " *" : ""}</label>
              <select
                className="select"
                id={`map-${field}`}
                value={step.mapping[field] ?? ""}
                onChange={(event) => {
                  const mapping = { ...step.mapping };
                  if (event.target.value === "") delete mapping[field];
                  else mapping[field] = Number(event.target.value);
                  setStep({ ...step, mapping });
                }}
              >
                <option value="">Not in this file</option>
                {headings.map((heading, index) => <option key={index} value={index}>{cellText(heading) || `Column ${index + 1}`}</option>)}
              </select>
            </div>
          ))}
        </div>
      </>
    );
    footer = <><button type="button" className="button" onClick={() => setStep({ kind: "file" })}>Back</button><button type="button" className="button primary" disabled={!ready} onClick={() => preview(step)}>Continue</button></>;
  } else if (step.kind === "preview") {
    const { plan, skipped } = step;
    const fresh = plan.creates.filter((row) => !row.possibleDuplicateOf);
    const duplicates = plan.creates.filter((row) => row.possibleDuplicateOf);
    const changed = plan.updates.filter((row) => row.changed);
    const unchanged = plan.updates.length - changed.length;
    const count = plan.creates.filter((row) => !skipped.has(row.rowNumber)).length + changed.length;
    const toggle = (row: PlannedCreate) => {
      const next = new Set(skipped);
      if (next.has(row.rowNumber)) next.delete(row.rowNumber);
      else next.add(row.rowNumber);
      setStep({ ...step, skipped: next });
    };
    body = (
      <>
        <div className="import-summary">
          <div><strong>{fresh.length.toLocaleString("en-US")}</strong><span>New</span></div>
          <div><strong>{changed.length.toLocaleString("en-US")}</strong><span>Updates</span></div>
          <div><strong>{duplicates.length.toLocaleString("en-US")}</strong><span>Possible duplicates</span></div>
          <div className={plan.problems.length ? "has-problems" : ""}><strong>{plan.problems.length.toLocaleString("en-US")}</strong><span>Problems</span></div>
        </div>
        {unchanged ? <p className="field-hint">{unchanged.toLocaleString("en-US")} rows match existing products and change nothing.</p> : null}
        <Group title="New products" count={fresh.length}>
          {fresh.slice(0, VISIBLE_ROWS).map((row) => <div className="import-row" key={row.rowNumber}><span>Row {row.rowNumber}</span><strong>{row.product.name}</strong><span>{formatAED(row.product.priceFils)} · stock {row.product.stock}</span></div>)}
        </Group>
        <Group title="Updates" count={changed.length}>
          {changed.slice(0, VISIBLE_ROWS).map((row) => (
            <div className="import-row" key={row.rowNumber}>
              <span>Row {row.rowNumber}</span>
              <strong>{productNames.get(row.productId)}{row.archived ? " (archived)" : ""}</strong>
              <span>{formatAED(row.before.priceFils)} → {formatAED(row.after.priceFils)} · stock {row.before.stock} → {row.after.stock}{row.after.barcode !== row.before.barcode ? ` · barcode ${row.after.barcode}` : ""}</span>
            </div>
          ))}
        </Group>
        <Group title="Possible duplicates (added unless unticked)" count={duplicates.length}>
          {duplicates.slice(0, VISIBLE_ROWS).map((row) => (
            <label className="import-row import-check" key={row.rowNumber}>
              <input type="checkbox" checked={!skipped.has(row.rowNumber)} onChange={() => toggle(row)} />
              <strong>{row.product.name}</strong>
              <span>Row {row.rowNumber} · has no barcode or SKU match, same name as “{row.possibleDuplicateOf}”</span>
            </label>
          ))}
        </Group>
        <Group title="Problems (skipped)" count={plan.problems.length}>
          {plan.problems.slice(0, VISIBLE_ROWS).map((row) => <div className="import-row problem" key={row.rowNumber}><span>Row {row.rowNumber}</span><strong>{cellText(row.cells[step.mapping.name ?? 0]) || "(no name)"}</strong><span>{row.reasons.join(" ")}</span></div>)}
        </Group>
        {plan.problems.length ? <button type="button" className="button" onClick={() => download("import-problems.csv", problemsToCsv(step.rows[0], plan.problems))}><DownloadSimple size={15} weight="bold" /> Download problem rows</button> : null}
      </>
    );
    footer = <><button type="button" className="button" onClick={() => setStep({ ...step, kind: "map" })}>Back</button><button type="button" className="button primary" disabled={count === 0} onClick={() => confirm(step)}>Import {count.toLocaleString("en-US")} products</button></>;
  } else {
    const ids = new Set(step.operationIds);
    const remaining = syncOperations.filter((operation) => ids.has(operation.id) && operation.status !== "synced").length;
    const productIds = [...step.createdIds, ...step.updatedIds];
    const attention = productIds.filter((id) => syncProblems.has(id)).length;
    const saved = productIds.length;
    body = (
      <div className="import-done">
        <p><strong>Saved in this browser: {saved.toLocaleString("en-US")}</strong> products ({step.createdIds.length.toLocaleString("en-US")} new, {step.updatedIds.length.toLocaleString("en-US")} updated).</p>
        {mode === "hosted" ? (
          <>
            <p>Synced: {(step.operationIds.length - remaining).toLocaleString("en-US")} of {step.operationIds.length.toLocaleString("en-US")} changes{remaining && !attention ? " · syncing in the background, you can keep working" : ""}.</p>
            <progress max={Math.max(step.operationIds.length, 1)} value={step.operationIds.length - remaining} />
            {attention ? <p className="form-error">Needs attention: {attention} products were not saved to the server. They are marked on the Inventory page.</p> : null}
          </>
        ) : null}
      </div>
    );
    footer = <>{saved ? <button type="button" className="button" onClick={() => onPrintLabels(productIds)}><Printer size={15} weight="bold" /> Print labels for these products</button> : null}<button type="button" className="button primary" onClick={onClose}>Done</button></>;
  }

  return (
    <div className="modal-backdrop" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <div className="modal import-dialog" role="dialog" aria-label="Import products">
        {header}
        <div className="modal-body">{body}{error ? <p className="form-error" role="alert">{error}</p> : null}</div>
        <div className="modal-footer">{footer}</div>
      </div>
    </div>
  );
}
