"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { ArrowsClockwise, CheckCircle, DownloadSimple, ShieldCheck, UploadSimple } from "@phosphor-icons/react";
import { createDemoStateBackup, reconcilePendingOperations, restoreDemoStateBackup, useDemoStore } from "@/lib/demo-store";
import { formatDateTime } from "@/lib/domain";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { syncCatalogToSupabase } from "@/lib/supabase/catalog-sync";

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
  const [saved, setSaved] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settings, setSettings] = useState(defaults);
  const [backupMessage, setBackupMessage] = useState("");
  const [catalogMessage, setCatalogMessage] = useState("");
  const [settingsMessage, setSettingsMessage] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [catalogBusy, setCatalogBusy] = useState(false);
  const backupInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const value = window.localStorage.getItem(SETTINGS_KEY);
      if (value) setSettings(JSON.parse(value));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);


  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let active = true;
    void fetch("/api/v1/business").then(async (response) => {
      if (!response.ok) return;
      const body = await response.json() as { business?: typeof defaults };
      if (active && body.business) setSettings({ ...defaults, ...body.business });
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    setSettingsMessage("");
    setSettingsBusy(true);

    if (isSupabaseConfigured()) {
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

    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
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
    if (!window.confirm("Restore this backup? Current local shop data will be replaced.")) return;
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

  async function retryPending() {
    const result = await reconcilePendingOperations();
    setSyncMessage(result.message);
  }

  return (
    <>
      <div className="page-heading"><div><div className="eyebrow">Business profile</div><h1 className="page-title">Settings</h1><p className="page-copy">These legal details will be snapshotted onto each tax invoice.</p></div>{saved && <span className="badge green">Saved</span>}</div>
      <form className="panel" onSubmit={submit}>
        <div className="panel-header"><div><div className="panel-title">Shop identity</div><div className="panel-subtitle">UAE tax invoice information</div></div></div>
        <div className="panel-body"><div className="form-grid">
          <div className="field"><label htmlFor="business-name">Legal business name</label><input className="input" id="business-name" value={settings.name} onChange={(event) => setSettings({ ...settings, name: event.target.value })} required /></div>
          <div className="field"><label htmlFor="trn">Tax registration number</label><input className="input" id="trn" value={settings.trn} onChange={(event) => setSettings({ ...settings, trn: event.target.value })} inputMode="numeric" pattern="[0-9]{15}" minLength={15} maxLength={15} required /></div>
          <div className="field"><label htmlFor="phone">Phone</label><input className="input" id="phone" value={settings.phone} onChange={(event) => setSettings({ ...settings, phone: event.target.value })} required /></div>
          <div className="field"><label htmlFor="prefix">Invoice prefix</label><input className="input" id="prefix" value={settings.prefix} onChange={(event) => setSettings({ ...settings, prefix: event.target.value.toUpperCase() })} pattern="[A-Z0-9-]{1,8}" maxLength={8} required /><small>Use 1–8 uppercase letters, numbers, or hyphens.</small></div>
          <div className="field full-span"><label htmlFor="address">Registered address</label><textarea className="textarea" id="address" value={settings.address} onChange={(event) => setSettings({ ...settings, address: event.target.value })} required /></div>
          <div className="field full-span"><label htmlFor="footer">Receipt footer</label><input className="input" id="footer" value={settings.footer} onChange={(event) => setSettings({ ...settings, footer: event.target.value })} /></div>
        </div></div>
        {settingsMessage && <div className="backup-message" role="alert">{settingsMessage}</div>}
        <div className="modal-footer"><button className="button primary" type="submit" disabled={settingsBusy}>{settingsBusy ? "Saving…" : "Save settings"}</button></div>
      </form>
      <section className="panel sync-diagnostics">
        <div className="panel-header"><div><div className="panel-title">Cloud catalog</div><div className="panel-subtitle">Explicitly upload products and customers to this business</div></div><button className="button" type="button" onClick={syncCatalog} disabled={!isSupabaseConfigured() || catalogBusy}><UploadSimple size={15} weight="bold" />{catalogBusy ? "Uploading…" : "Upload catalog"}</button></div>
        <div className="panel-body"><p className="panel-subtitle">This uploads the current local catalog only. Sales, returns, stock movements, and register records are not uploaded by this action.</p>{catalogMessage && <div className="backup-message" role="status">{catalogMessage}</div>}</div>
      </section>
      <section className="panel sync-diagnostics">
        <div className="panel-header"><div><div className="panel-title">Offline outbox</div><div className="panel-subtitle">Supported customer, sale, refund, register, and inventory changes sync automatically; other pending operations are retained</div></div><button className="button" onClick={retryPending} disabled={!store.syncOperations.some((item) => item.status === "pending" || item.status === "failed")}><ArrowsClockwise size={15} weight="bold" /> Retry pending</button></div>
        {syncMessage && <div className="backup-message" role="status">{syncMessage}</div>}
        {store.syncOperations.length ? <div className="table-wrap"><table><thead><tr><th>Operation</th><th>Entity</th><th>Created</th><th>Status</th></tr></thead><tbody>{store.syncOperations.slice(0, 12).map((operation) => <tr key={operation.id}><td className="product-meta">{operation.id}</td><td>{operation.entity}</td><td>{formatDateTime(operation.createdAt)}</td><td><span className={`badge ${operation.status === "synced" ? "green" : operation.status === "failed" ? "red" : "yellow"}`}>{operation.status}</span>{operation.error && <div className="product-meta">{operation.error}</div>}</td></tr>)}</tbody></table></div> : <div className="empty compact-empty"><CheckCircle size={28} weight="duotone" /><h3>Outbox is clear</h3><p>Offline sales, returns, customers, and stock changes appear here until reconnect.</p></div>}
      </section>
      <section className="panel backup-panel">
        <div className="panel-header"><div><div className="panel-title">Backup and recovery</div><div className="panel-subtitle">Portable local snapshot for this single device</div></div><ShieldCheck size={20} weight="duotone" /></div>
        <div className="panel-body backup-body"><div><strong>Keep a recoverable copy</strong><p>Download after closing each business day. The file contains invoices, customers, products, stock movements, register data, and settings.</p></div><div className="backup-actions"><button className="button" onClick={downloadBackup}><DownloadSimple size={15} weight="bold" /> Download backup</button><button className="button" onClick={() => backupInput.current?.click()}><UploadSimple size={15} weight="bold" /> Restore backup</button><input className="sr-only" ref={backupInput} type="file" accept="application/json,.json" onChange={restoreBackup} aria-label="Choose Shop Ledger backup file" /></div></div>
        {backupMessage && <div className="backup-message" role="status">{backupMessage}</div>}
      </section>
    </>
  );
}
