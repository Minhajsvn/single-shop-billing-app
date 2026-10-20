"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { ArrowsClockwise, CashRegister, CheckCircle, DownloadSimple, ShieldCheck, UploadSimple } from "@phosphor-icons/react";
import { ChooseTill } from "@/components/billing/choose-till";
import { EmptyState } from "@/components/ui/list-parts";
import { useListParams } from "@/components/ui/use-list-params";
import { createDemoStateBackup, reconcilePendingOperations, refreshSnapshot, restoreDemoStateBackup, switchThisTill, useDemoStore, useShopContext } from "@/lib/demo-store";
import { formatDateTime } from "@/lib/domain";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { syncCatalogToSupabase } from "@/lib/supabase/catalog-sync";
import { requestConfirm } from "@/lib/ui/confirm-store";

const TABS = [
  { tab: "business", label: "Business" },
  { tab: "tills", label: "Tills" },
  { tab: "tax", label: "Tax and invoices" },
  { tab: "data", label: "Data" },
] as const;
type Tab = (typeof TABS)[number]["tab"];
const isTab = (value: string): value is Tab => TABS.some((item) => item.tab === value);

const SETTINGS_KEY = "shop-ledger-demo-settings-v1";
const defaults = {
  name: "Al Noor Corner Shop",
  trn: "100000000000003",
  phone: "+971 4 555 0184",
  prefix: "SL",
  address: "Dubai, United Arab Emirates",
  footer: "Thank you for shopping with us.",
};

export default function SettingsPage() {
  const store = useDemoStore();
  const { mode, business, devices, device, entitlements } = useShopContext();
  const tillLimit = entitlements.limits.tills;
  const overTillLimit = tillLimit !== null && devices.filter((item) => item.status === "active").length > tillLimit;
  const [params, setParams] = useListParams({ tab: "business" });
  const tab: Tab = isTab(params.tab) ? params.tab : "business";
  // On a phone the tab row scrolls; keep the open tab in view (Data sits past the edge at 375px).
  useEffect(() => {
    document.getElementById(`settings-tab-${tab}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);
  const hosted = mode === "hosted";
  const [saved, setSaved] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settings, setSettings] = useState(defaults);
  const [backupMessage, setBackupMessage] = useState("");
  const [catalogMessage, setCatalogMessage] = useState("");
  const [settingsMessage, setSettingsMessage] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const [tillMessage, setTillMessage] = useState("");
  const [catalogBusy, setCatalogBusy] = useState(false);
  const backupInput = useRef<HTMLInputElement>(null);

  // Hosted shops edit the server copy; the browser-only stores keep theirs in localStorage.
  useEffect(() => {
    if (hosted) return;
    const timer = window.setTimeout(() => {
      try {
        const value = window.localStorage.getItem(SETTINGS_KEY);
        if (value) setSettings(JSON.parse(value));
      } catch { /* keep defaults */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [hosted]);

  useEffect(() => {
    if (!hosted || !business) return;
    const timer = window.setTimeout(() => setSettings({ name: business.legalName, trn: business.trn, phone: business.phone, prefix: business.invoicePrefix, address: business.address, footer: business.receiptFooter }), 0);
    return () => window.clearTimeout(timer);
  }, [hosted, business]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    setSettingsMessage("");
    setSettingsBusy(true);

    if (hosted) {
      try {
        const response = await fetch("/api/v1/business", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(settings),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { error?: unknown } | null;
          const message = body && typeof body.error === "string" ? body.error : "Hosted business settings could not be saved.";
          setSettingsMessage(message);
          setSettingsBusy(false);
          return;
        }
      } catch {
        setSettingsMessage("The hosted business settings request failed. Local settings were not changed.");
        setSettingsBusy(false);
        return;
      }
    }

    if (hosted) await refreshSnapshot();
    else {
      try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
    }
    setSaved(true);
    setSettingsBusy(false);
    window.setTimeout(() => setSaved(false), 2200);
  }


  function downloadBackup() {
    const payload = { schemaVersion: 3, exportedAt: new Date().toISOString(), app: "Shop Ledger UAE", settings, state: createDemoStateBackup() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `shop-ledger-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setBackupMessage("Backup downloaded. Store it somewhere separate from this shop computer.");
  }

  async function restoreBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!(await requestConfirm({ title: "Restore this backup?", body: "Current local shop data will be replaced.", confirmLabel: "Restore", destructive: true }))) return;
    try {
      const parsed = JSON.parse(await file.text()) as { schemaVersion?: number; settings?: typeof defaults; state?: unknown };
      if (parsed.schemaVersion !== 3) return setBackupMessage("Restore stopped: this backup version is not supported.");
      const result = restoreDemoStateBackup(parsed.state);
      if (!result.ok) return setBackupMessage(`Restore stopped: ${result.error}`);
      if (parsed.settings && Object.values(parsed.settings).every((value) => typeof value === "string")) {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(parsed.settings));
        setSettings(parsed.settings);
      }
      setBackupMessage("Backup restored and validated successfully.");
    } catch {
      setBackupMessage("Restore stopped: the selected file is not valid Shop Ledger JSON.");
    }
  }

  async function syncCatalog() {
    setCatalogBusy(true);
    setCatalogMessage("");
    const result = await syncCatalogToSupabase(store.products, store.customers);
    setCatalogBusy(false);
    if (result.errors.length) {
      setCatalogMessage(`${result.products} products and ${result.customers} customers saved. ${result.errors.join(" ")}`);
      return;
    }
    setCatalogMessage(`${result.products} products and ${result.customers} customers are now available in Supabase.`);
  }

  async function syncNow() {
    setSyncBusy(true);
    const pending = store.syncOperations.some((item) => item.status === "pending" || item.status === "failed");
    if (pending) {
      const result = await reconcilePendingOperations();
      setSyncMessage(result.message);
    } else {
      // Nothing to send: fetch the latest shop data instead.
      const result = await refreshSnapshot();
      setSyncMessage(result.ok ? "Shop data is up to date." : result.error);
    }
    setSyncBusy(false);
  }

  async function switchTill() {
    setTillMessage("");
    // Sales go into the open register of this till; the drawer is closed before the browser becomes another till.
    if (store.register?.status === "open") return setTillMessage("Close the register before switching this browser to another till.");
    if (!(await requestConfirm({ title: "Switch this browser's till?", body: "You will choose which till this browser works as. Changes not yet synced stay with the till that made them.", confirmLabel: "Choose till" }))) return;
    switchThisTill();
  }

  const failed = store.syncOperations.filter((operation) => operation.status === "failed");
  const saveButton = <div className="modal-footer"><button className="button primary" type="submit" disabled={settingsBusy}>{settingsBusy ? "Saving…" : "Save settings"}</button></div>;
  const savedMessage = settingsMessage && <div className="backup-message" role="alert">{settingsMessage}</div>;

  return (
    <>
      <div className="page-heading"><div><div className="eyebrow">Business profile</div><h1 className="page-title">Settings</h1><p className="page-copy">These legal details will be snapshotted onto each tax invoice.</p></div>{saved && <span className="badge green">Saved</span>}</div>
      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        {TABS.map((item) => <button key={item.tab} type="button" role="tab" id={`settings-tab-${item.tab}`} aria-controls="settings-panel" aria-selected={tab === item.tab} className="settings-tab" onClick={() => setParams({ tab: item.tab })}>{item.label}</button>)}
      </div>
      <div className="settings-panel" role="tabpanel" id="settings-panel" aria-labelledby={`settings-tab-${tab}`}>
        {tab === "business" ? <form className="panel" onSubmit={submit}>
          <div className="panel-header"><div><div className="panel-title">Shop identity</div><div className="panel-subtitle">UAE tax invoice information</div></div></div>
          <div className="panel-body"><div className="form-grid">
            <div className="field"><label htmlFor="business-name">Legal business name</label><input className="input" id="business-name" value={settings.name} onChange={(event) => setSettings({ ...settings, name: event.target.value })} required /></div>
            <div className="field"><label htmlFor="trn">Tax registration number</label><input className="input" id="trn" value={settings.trn} onChange={(event) => setSettings({ ...settings, trn: event.target.value })} inputMode="numeric" pattern="[0-9]{15}" minLength={15} maxLength={15} required /></div>
            <div className="field"><label htmlFor="phone">Phone</label><input className="input" id="phone" value={settings.phone} onChange={(event) => setSettings({ ...settings, phone: event.target.value })} required /></div>
            <div className="field full-span"><label htmlFor="address">Registered address</label><textarea className="textarea" id="address" value={settings.address} onChange={(event) => setSettings({ ...settings, address: event.target.value })} required /></div>
          </div></div>
          {savedMessage}
          {saveButton}
        </form> : null}

        {tab === "tills" ? <section className="panel">
          <div className="panel-header"><div><div className="panel-title">Tills</div><div className="panel-subtitle">Each till has its own invoice numbers</div></div>{hosted ? <button className="button" type="button" onClick={() => void switchTill()}><CashRegister size={15} weight="bold" />Switch this browser&apos;s till</button> : null}</div>
          {tillMessage && <div className="backup-message" role="alert">{tillMessage}</div>}
          {/* Over the plan's till limit: the choice can be made here too, also from a till whose register is open. */}
          {hosted && overTillLimit ? <div className="panel-body"><ChooseTill compact /></div> : null}
          {hosted && devices.length ? <div className="table-wrap"><table><thead><tr><th>Till</th><th>Name</th><th>Branch</th><th>Status</th></tr></thead><tbody>{devices.map((item) => <tr key={item.id}><td className="product-name">Till {item.tillNumber}{item.id === device?.id ? <div className="product-meta">This browser</div> : null}</td><td>{item.name}</td><td>{item.branchName}</td><td><span className={`badge ${item.status === "active" ? "green" : item.status === "paused" ? "yellow" : "red"}`}>{item.status === "active" ? "Active" : item.status === "paused" ? "Paused" : "Revoked"}</span></td></tr>)}</tbody></table></div>
            : <EmptyState compact icon={<CashRegister size={28} weight="duotone" />} title={hosted ? "No tills yet" : "One till: this browser"} hint={hosted ? "Register a till from the till picker." : "Tills are set up when you use a shop account."} />}
        </section> : null}

        {tab === "tax" ? <form className="panel" onSubmit={submit}>
          <div className="panel-header"><div><div className="panel-title">Tax and invoices</div><div className="panel-subtitle">Invoice numbering and the receipt footer</div></div></div>
          <div className="panel-body"><div className="form-grid">
            <div className="field"><label htmlFor="prefix">Invoice prefix</label><input className="input" id="prefix" value={settings.prefix} onChange={(event) => setSettings({ ...settings, prefix: event.target.value.toUpperCase() })} pattern="[A-Z0-9-]{1,8}" maxLength={8} required /><small>Use 1–8 uppercase letters, numbers, or hyphens.</small></div>
            <div className="field full-span"><label htmlFor="footer">Receipt footer</label><input className="input" id="footer" value={settings.footer} onChange={(event) => setSettings({ ...settings, footer: event.target.value })} /></div>
          </div></div>
          {savedMessage}
          {saveButton}
        </form> : null}

        {tab === "data" ? <>
          <section className="panel sync-diagnostics">
            <div className="panel-header"><div><div className="panel-title">Offline outbox</div><div className="panel-subtitle">Supported customer, sale, refund, register, and inventory changes sync automatically; other pending operations are retained</div></div><button className="button" type="button" onClick={() => void syncNow()} disabled={syncBusy || (!hosted && !store.syncOperations.some((item) => item.status === "pending" || item.status === "failed"))}><ArrowsClockwise size={15} weight="bold" />{syncBusy ? "Syncing…" : "Sync now"}</button></div>
            {syncMessage && <div className="backup-message" role="status">{syncMessage}</div>}
            {store.syncOperations.length ? <div className="table-wrap"><table><thead><tr><th>Operation</th><th>Entity</th><th>Created</th><th>Status</th></tr></thead><tbody>{store.syncOperations.slice(0, 12).map((operation) => <tr key={operation.id}><td className="product-meta">{operation.id}</td><td>{operation.entity}</td><td>{formatDateTime(operation.createdAt)}</td><td><span className={`badge ${operation.status === "synced" ? "green" : operation.status === "failed" ? "red" : "yellow"}`}>{operation.status}</span>{operation.error && <div className="product-meta">{operation.error}</div>}</td></tr>)}</tbody></table></div> : <EmptyState compact icon={<CheckCircle size={28} weight="duotone" />} title="Outbox is clear" hint="Offline sales, returns, customers, and stock changes appear here until reconnect." />}
          </section>
          {failed.length ? <section className="panel sync-diagnostics">
            <div className="panel-header"><div><div className="panel-title">Needs attention</div><div className="panel-subtitle">{failed.length} change{failed.length === 1 ? "" : "s"} could not sync. They stay saved here; fix the cause and choose Sync now.</div></div></div>
            <div className="table-wrap"><table><thead><tr><th>Entity</th><th>Created</th><th>Reason</th></tr></thead><tbody>{failed.map((operation) => <tr key={operation.id}><td>{operation.entity}<div className="product-meta">{operation.entityId}</div></td><td>{formatDateTime(operation.createdAt)}</td><td>{operation.error ?? "No reason was given."}</td></tr>)}</tbody></table></div>
          </section> : null}
          <section className="panel backup-panel">
            <div className="panel-header"><div><div className="panel-title">Backup and recovery</div><div className="panel-subtitle">Portable local snapshot for this single device</div></div><ShieldCheck size={20} weight="duotone" /></div>
            <div className="panel-body backup-body"><div><strong>Keep a recoverable copy</strong><p>Download after closing each business day. The file contains invoices, customers, products, stock movements, register data, and settings.</p></div><div className="backup-actions"><button className="button" onClick={downloadBackup}><DownloadSimple size={15} weight="bold" /> Download backup</button>{!hosted ? <><button className="button" onClick={() => backupInput.current?.click()}><UploadSimple size={15} weight="bold" /> Restore backup</button><input className="sr-only" ref={backupInput} type="file" accept="application/json,.json" onChange={restoreBackup} aria-label="Choose Shop Ledger backup file" /></> : null}</div></div>
            {backupMessage && <div className="backup-message" role="status">{backupMessage}</div>}
          </section>
          {!hosted ? <section className="panel sync-diagnostics">
            <div className="panel-header"><div><div className="panel-title">Cloud catalog</div><div className="panel-subtitle">Explicitly upload products and customers to this business</div></div><button className="button" type="button" onClick={syncCatalog} disabled={!isSupabaseConfigured() || catalogBusy}><UploadSimple size={15} weight="bold" />{catalogBusy ? "Uploading…" : "Upload catalog"}</button></div>
            <div className="panel-body"><p className="panel-subtitle">This uploads the current local catalog only. Sales, returns, stock movements, and register records are not uploaded by this action.</p>{catalogMessage && <div className="backup-message" role="status">{catalogMessage}</div>}</div>
          </section> : null}
        </> : null}
      </div>
    </>
  );
}
