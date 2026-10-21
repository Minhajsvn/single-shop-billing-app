"use client";

import { CashRegister, PauseCircle, Plus, Storefront } from "@phosphor-icons/react";
import { FormEvent, useState } from "react";
import { READ_ONLY_REASON, useEntitlement } from "@/components/billing/use-entitlement";
import { isOwnerView } from "@/lib/access/cashier";
import { refreshSnapshot, useShopContext } from "@/lib/demo-store";
import { storeDeviceId } from "@/lib/device";
import { createClient } from "@/lib/supabase/client";

export function TillPicker() {
  const { business, devices, entitlements, role } = useShopContext();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { canWrite } = useEntitlement();
  // Paused tills are listed but cannot be chosen; revoked ones are not listed.
  const listed = devices.filter((device) => device.status === "active" || device.status === "paused");

  async function choose(id: string) {
    setBusy(true);
    storeDeviceId(id);
    const result = await refreshSnapshot();
    if (!result.ok) setError(`This till could not be loaded: ${result.error}`);
    setBusy(false);
  }

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!business) return;
    setBusy(true);
    setError(null);
    const { data, error: insertError } = await createClient()
      .from("devices")
      .insert({ business_id: business.id, name: name.trim() })
      .select("id")
      .single();
    if (insertError || !data) {
      const limit = entitlements.limits.tills;
      setError(insertError?.message.includes("plan_limit_reached")
        ? `Your plan allows ${limit ?? "unlimited"} till${limit === 1 ? "" : "s"}. Use an existing till or upgrade.`
        : insertError?.message ?? "The till could not be registered.");
      setBusy(false);
      return;
    }
    await choose(data.id as string);
  }

  return (
    <main className="auth-shell">
      <section className="auth-card panel" aria-labelledby="till-title">
        <div className="auth-brand"><span className="brand-mark">SL</span><span><strong>{business?.legalName ?? "Shop Ledger"}</strong><small>Choose this browser&apos;s till</small></span></div>
        <div className="eyebrow">Till setup</div>
        <h1 id="till-title">Which till is this browser?</h1>
        <p className="page-copy">Each till has its own invoice numbers. Pick the till this computer works as{isOwnerView(role) ? ", or register a new one" : ""}.</p>
        <p className="field-hint">Use each till on one browser only. Two browsers on the same till would issue the same invoice numbers.</p>
        {listed.length ? (
          <div className="auth-form">
            {listed.map((device) => device.status === "paused" ? (
              <button className="button till-paused" type="button" key={device.id} disabled title="This till is paused because the plan allows fewer tills.">
                <PauseCircle size={16} weight="bold" />Till {device.tillNumber} · {device.name}<small>Paused — upgrade to use</small>
              </button>
            ) : (
              <button className="button" type="button" key={device.id} onClick={() => void choose(device.id)} disabled={busy}>
                <CashRegister size={16} weight="bold" />Till {device.tillNumber} · {device.name}
              </button>
            ))}
          </div>
        ) : null}
        {/* Only the owner registers tills (the server refuses anyone else). */}
        {!isOwnerView(role) ? <>
          {listed.some((device) => device.status === "active") ? null : <p className="notice" role="status"><Storefront size={17} weight="bold" /><span>Ask the shop owner to add a till.</span></p>}
          {error ? <div className="notice error-notice" role="alert"><Storefront size={17} weight="bold" /><span>{error}</span></div> : null}
        </> : <form className="auth-form" onSubmit={register}>
          <label className="field-label" htmlFor="till-name">Register a new till</label>
          <input className="input" id="till-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Counter 2" required maxLength={60} />
          {error ? <div className="notice error-notice" role="alert"><Storefront size={17} weight="bold" /><span>{error}</span></div> : null}
          {canWrite ? null : <p className="field-hint">{READ_ONLY_REASON}</p>}
          <button className="button primary auth-submit" type="submit" disabled={busy || !business || !canWrite} title={canWrite ? undefined : READ_ONLY_REASON}><Plus size={16} weight="bold" />{busy ? "Saving…" : "Register this till"}</button>
        </form>}
      </section>
    </main>
  );
}
