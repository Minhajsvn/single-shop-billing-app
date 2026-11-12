"use client";

import { Sparkle, WarningCircle } from "@/components/icons";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { useEntitlement } from "@/components/billing/use-entitlement";
import { useOnline } from "@/components/offline-runtime";
import { refreshSnapshot, useDemoStore, useShopContext } from "@/lib/demo-store";
import { describeTest, saveScaleLabel } from "@/lib/weighing/client";
import type { ScaleLabelSettings } from "@/lib/weighing/types";
import { toast } from "@/lib/ui/toast-store";

const PREFIXES = ["20", "21", "22", "23", "24", "25", "26", "27", "28", "29"];

/** Stage 2F: how this shop's counter scale prints its barcode labels (owner, Pro), with a box to test a label. */
export function ScaleLabelTab() {
  const { hasFeature } = useEntitlement();
  const { scaleLabel } = useShopContext();
  const store = useDemoStore();
  const online = useOnline();
  const [draft, setDraft] = useState<ScaleLabelSettings>(scaleLabel);
  const [testCode, setTestCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!hasFeature("weighed_items")) {
    return <section className="panel locked-card" role="note"><div className="panel-body"><Sparkle size={20} weight="bold" /><div><div className="panel-title">Sell loose goods by weight on Pro</div><p className="field-hint">Scan your counter scale&apos;s labels or type a weight at the till; stock, deliveries and profit work in kg. <Link href="/settings?tab=billing">See plans</Link>.</p></div></div></section>;
  }

  function togglePrefix(prefix: string, on: boolean) {
    setDraft((current) => ({ ...current, prefixes: on ? [...current.prefixes, prefix].sort() : current.prefixes.filter((item) => item !== prefix) }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.prefixes.length) return setError("Tick at least one prefix.");
    setBusy(true);
    const result = await saveScaleLabel(draft);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setError("");
    toast("Scale label settings saved");
    void refreshSnapshot();
  }

  const result = describeTest(testCode, draft, store.products);
  const valueDigits = 13 - 2 - draft.codeLength - 1;
  return (
    <form className="panel" onSubmit={submit} aria-label="Scale labels">
      <div className="panel-header"><div><div className="panel-title">Scale labels</div><div className="panel-subtitle">Match how your counter scale prints its barcodes; every till uses this</div></div></div>
      <div className="panel-body"><div className="form-grid">
        <fieldset className="field full-span promo-days"><legend className="field-label">Label starts with</legend>
          {PREFIXES.map((prefix) => <label key={prefix} className="promo-day"><input type="checkbox" checked={draft.prefixes.includes(prefix)} onChange={(event) => togglePrefix(prefix, event.target.checked)} /> {prefix}</label>)}
        </fieldset>
        <div className="field"><label htmlFor="scale-code-length">Item code digits</label>
          <select className="select" id="scale-code-length" value={draft.codeLength} onChange={(event) => setDraft({ ...draft, codeLength: Number(event.target.value) as ScaleLabelSettings["codeLength"] })}>
            {[4, 5, 6].map((length) => <option key={length} value={length}>{length}</option>)}
          </select>
          <small>Then {valueDigits} digits of {draft.value === "weight" ? "grams" : "fils"} and a check digit.</small>
        </div>
        <fieldset className="field"><legend className="field-label">The last digits hold</legend>
          <label className="promo-day"><input type="radio" name="scale-value" checked={draft.value === "weight"} onChange={() => setDraft({ ...draft, value: "weight" })} /> The weight (grams)</label>
          <label className="promo-day"><input type="radio" name="scale-value" checked={draft.value === "price"} onChange={() => setDraft({ ...draft, value: "price" })} /> The price (fils)</label>
        </fieldset>
        <div className="field full-span"><label htmlFor="scale-test">Test a label</label>
          <input className="input" id="scale-test" inputMode="numeric" value={testCode} onChange={(event) => setTestCode(event.target.value)} placeholder="Scan a label from your scale" autoComplete="off" />
          {result ? <p className="field-hint" role="status">{result}</p> : null}
        </div>
      </div>
      {!online ? <div className="notice" role="status"><WarningCircle size={18} weight="fill" /><span>Saving needs a connection</span></div> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}</div>
      <div className="modal-footer"><button className="button primary" type="submit" disabled={busy || !online}>Save scale labels</button></div>
    </form>
  );
}
