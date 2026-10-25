"use client";

import { CashRegister } from "@phosphor-icons/react";
import { useState } from "react";
import { useEntitlement } from "@/components/billing/use-entitlement";
import { initialKeptTills, keepTillsButton, toggleKeptTill } from "@/lib/access/tills";
import { refreshSnapshot, useShopContext } from "@/lib/demo-store";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/ui/toast-store";

function tills(n: number) {
  return n === 1 ? "1 till" : `${n} tills`;
}

function chooseError(message: string) {
  if (message.includes("till_not_found")) return "A till you chose is no longer active. Refresh and choose again.";
  if (message.includes("too_many_tills")) return "Your plan allows fewer tills than you chose. Refresh and choose again.";
  if (message.includes("keep_at_least_one")) return "Choose at least one till to keep.";
  return "The tills could not be chosen. Check the connection and try again.";
}

/** The plan allows fewer tills than are active: the owner keeps up to the limit, the others are paused (not deleted). */
export function ChooseTill({ compact = false }: { compact?: boolean }) {
  const { business, device, devices } = useShopContext();
  const { e, role } = useEntitlement();
  const active = devices.filter((item) => item.status === "active");
  const limit = e.limits.tills ?? active.length;
  const [keep, setKeep] = useState<string[]>(() => initialKeptTills(active, device?.status === "active" ? device.id : undefined, limit));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const Heading = compact ? "h3" : "h2";
  const single = Math.max(limit, 1) === 1;

  async function choose() {
    if (!business || keep.length === 0) return;
    setBusy(true);
    setError("");
    const { error: rpcError } = await createClient().rpc("choose_active_tills", { p_business_id: business.id, p_keep_device_ids: keep });
    if (rpcError) {
      setError(chooseError(rpcError.message));
      setBusy(false);
      return;
    }
    const refreshed = await refreshSnapshot();
    setBusy(false);
    if (!refreshed.ok) setError(refreshed.error);
    toast(keep.length > 1 ? "Tills chosen. The other tills are paused." : "Till chosen. The other tills are paused.");
  }

  return (
    <div className={`choose-till ${compact ? "compact" : ""}`}>
      {compact ? null : <CashRegister size={38} weight="duotone" />}
      <Heading>{single ? "Choose which till stays" : "Choose which tills stay"}</Heading>
      <p>Your plan allows {tills(limit)}. The others are paused, not deleted: their sales stay, and they work again after an upgrade. A register that is open finishes its shift.</p>
      {role === "owner" ? (
        <>
          <fieldset className="choose-till-list">
            <legend className="sr-only">{single ? "Till to keep" : `Tills to keep (up to ${limit})`}</legend>
            {active.map((item) => {
              const kept = keep.includes(item.id);
              return (
                <label key={item.id} className={`choose-till-option ${kept ? "selected" : ""}`}>
                  <input
                    type={single ? "radio" : "checkbox"}
                    name="keep-till"
                    value={item.id}
                    checked={kept}
                    disabled={!single && !kept && keep.length >= limit}
                    onChange={() => setKeep((current) => toggleKeptTill(current, item.id, limit))}
                  />
                  <span><strong>Till {item.tillNumber} · {item.name}</strong><small>{item.branchName}{item.id === device?.id ? " · This browser" : ""}</small></span>
                </label>
              );
            })}
          </fieldset>
          {single ? null : <p className="choose-till-count" aria-live="polite">{keep.length} of {limit} chosen</p>}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button type="button" className="button primary" onClick={() => void choose()} disabled={busy || keep.length === 0}>{busy ? "Saving…" : keepTillsButton(keep.length)}</button>
        </>
      ) : <p className="choose-till-ask"><strong>Ask the shop owner to choose which {single ? "till stays" : "tills stay"}.</strong></p>}
    </div>
  );
}
