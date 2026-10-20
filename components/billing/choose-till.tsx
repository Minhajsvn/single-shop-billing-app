"use client";

import { CashRegister } from "@phosphor-icons/react";
import { useState } from "react";
import { useEntitlement } from "@/components/billing/use-entitlement";
import { refreshSnapshot, useShopContext } from "@/lib/demo-store";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/ui/toast-store";

function tills(n: number) {
  return n === 1 ? "1 till" : `${n} tills`;
}

/** The plan allows fewer tills than are active: the owner keeps one, the others are paused (not deleted). */
export function ChooseTill({ compact = false }: { compact?: boolean }) {
  const { business, device, devices } = useShopContext();
  const { e, role } = useEntitlement();
  const active = devices.filter((item) => item.status === "active");
  const [keep, setKeep] = useState<string>(() => (device?.status === "active" ? device.id : active[0]?.id) ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const limit = e.limits.tills ?? active.length;
  const Heading = compact ? "h3" : "h2";

  async function choose() {
    if (!business || !keep) return;
    setBusy(true);
    setError("");
    const { error: rpcError } = await createClient().rpc("choose_active_till", { p_business_id: business.id, p_keep_device_id: keep });
    if (rpcError) {
      setError(rpcError.message.includes("till_not_found") ? "That till is no longer active. Refresh and choose again." : "The till could not be chosen. Check the connection and try again.");
      setBusy(false);
      return;
    }
    const refreshed = await refreshSnapshot();
    setBusy(false);
    if (!refreshed.ok) setError(refreshed.error);
    toast("Till chosen. The other tills are paused.");
  }

  return (
    <div className={`choose-till ${compact ? "compact" : ""}`}>
      {compact ? null : <CashRegister size={38} weight="duotone" />}
      <Heading>Choose which till stays</Heading>
      <p>Your plan allows {tills(limit)}. The others are paused, not deleted: their sales stay, and they work again after an upgrade. A register that is open finishes its shift.</p>
      {role === "owner" ? (
        <>
          <fieldset className="choose-till-list">
            <legend className="sr-only">Till to keep</legend>
            {active.map((item) => (
              <label key={item.id} className={`choose-till-option ${keep === item.id ? "selected" : ""}`}>
                <input type="radio" name="keep-till" value={item.id} checked={keep === item.id} onChange={() => setKeep(item.id)} />
                <span><strong>Till {item.tillNumber} · {item.name}</strong><small>{item.branchName}{item.id === device?.id ? " · This browser" : ""}</small></span>
              </label>
            ))}
          </fieldset>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button type="button" className="button primary" onClick={() => void choose()} disabled={busy || !keep}>{busy ? "Saving…" : "Keep this till"}</button>
        </>
      ) : <p className="choose-till-ask"><strong>Ask the shop owner to choose which till stays.</strong></p>}
    </div>
  );
}
