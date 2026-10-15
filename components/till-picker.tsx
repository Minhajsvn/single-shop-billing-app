"use client";

import { CashRegister, Plus, Storefront } from "@phosphor-icons/react";
import { FormEvent, useState } from "react";
import { refreshSnapshot, useShopContext } from "@/lib/demo-store";
import { storeDeviceId } from "@/lib/device";
import { createClient } from "@/lib/supabase/client";

export function TillPicker() {
  const { business, devices, entitlements } = useShopContext();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const active = devices.filter((device) => device.status === "active");

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
        <p className="page-copy">Each till has its own invoice numbers. Pick the till this computer works as, or register a new one.</p>
        <p className="field-hint">Use each till on one browser only. Two browsers on the same till would issue the same invoice numbers.</p>
        {active.length ? (
          <div className="auth-form">
            {active.map((device) => (
              <button className="button" type="button" key={device.id} onClick={() => void choose(device.id)} disabled={busy}>
                <CashRegister size={16} weight="bold" />Till {device.tillNumber} · {device.name}
              </button>
            ))}
          </div>
        ) : null}
        <form className="auth-form" onSubmit={register}>
          <label className="field-label" htmlFor="till-name">Register a new till</label>
          <input className="input" id="till-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Counter 2" required maxLength={60} />
          {error ? <div className="notice error-notice" role="alert"><Storefront size={17} weight="bold" /><span>{error}</span></div> : null}
          <button className="button primary auth-submit" type="submit" disabled={busy || !business}><Plus size={16} weight="bold" />{busy ? "Saving…" : "Register this till"}</button>
        </form>
      </section>
    </main>
  );
}
