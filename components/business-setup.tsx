"use client";

import { CheckCircle, Storefront } from "@phosphor-icons/react";
import { storeDeviceId } from "@/lib/device";
import { enabledCountries } from "@/lib/fiscal/countries";
import { createClient } from "@/lib/supabase/client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type SetupValues = {
  name: string;
  trn: string;
  address: string;
  phone: string;
  prefix: string;
  footer: string;
  deviceName: string;
};

const defaults: SetupValues = {
  name: "",
  trn: "",
  address: "",
  phone: "",
  prefix: "SL",
  footer: "Thank you for shopping with us.",
  deviceName: "Device 01",
};

// Stage 1 launches in one country; the profile supplies its currency, timezone and tax-ID rules.
const country = enabledCountries()[0];

export function BusinessSetup() {
  const router = useRouter();
  const [values, setValues] = useState<SetupValues>(defaults);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function update(field: keyof SetupValues, value: string) {
    setValues((current) => ({ ...current, [field]: field === "prefix" ? value.toUpperCase() : value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError("Your session expired. Sign in again to continue.");
      setBusy(false);
      return;
    }

    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .insert({
        owner_id: user.id,
        country: country.code,
        currency: country.currency,
        timezone: country.timezone,
        legal_name: values.name.trim(),
        trn: values.trn.trim(),
        address: values.address.trim(),
        phone: values.phone.trim(),
        invoice_prefix: values.prefix.trim(),
        receipt_footer: values.footer.trim(),
      })
      .select("id")
      .single();

    if (businessError || !business) {
      setError(businessError?.code === "23505" ? "This owner already has a shop record. Refresh and continue." : businessError?.message ?? "The shop record could not be created.");
      setBusy(false);
      return;
    }

    const { data: device, error: deviceError } = await supabase.from("devices").insert({ business_id: business.id, name: values.deviceName.trim() }).select("id").single();
    if (deviceError || !device) {
      setError(`The shop was created, but the device could not be registered: ${deviceError?.message ?? "no device was returned"}`);
      setBusy(false);
      return;
    }

    storeDeviceId(device.id as string);
    router.replace("/overview");
  }

  return (
    <main className="auth-shell">
      <section className="auth-card setup-card panel" aria-labelledby="setup-title">
        <div className="auth-brand"><span className="brand-mark">SL</span><span><strong>Shop Ledger</strong><small>UAE retail till</small></span></div>
        <div className="eyebrow">First-time setup</div>
        <h1 id="setup-title">Register this shop</h1>
        <p className="page-copy">These legal details are stored in Supabase and used to scope your shop records securely.</p>
        <p className="field-hint">Country: {country.name} · prices in {country.currency}</p>
        <form className="auth-form" onSubmit={submit}>
          <div className="setup-grid">
            <div className="field"><label htmlFor="setup-name">Legal business name</label><input className="input" id="setup-name" value={values.name} onChange={(event) => update("name", event.target.value)} required /></div>
            <div className="field"><label htmlFor="setup-trn">{country.taxIdLabel} (15 digits)</label><input className="input" id="setup-trn" value={values.trn} onChange={(event) => update("trn", event.target.value)} inputMode="numeric" pattern="[0-9]{15}" minLength={15} maxLength={15} required /></div>
            <div className="field"><label htmlFor="setup-phone">Shop phone</label><input className="input" id="setup-phone" value={values.phone} onChange={(event) => update("phone", event.target.value)} required /></div>
            <div className="field"><label htmlFor="setup-prefix">Invoice prefix</label><input className="input" id="setup-prefix" value={values.prefix} onChange={(event) => update("prefix", event.target.value)} pattern="[A-Z0-9-]{1,8}" maxLength={8} required /></div>
            <div className="field full-span"><label htmlFor="setup-address">Registered address</label><textarea className="textarea" id="setup-address" value={values.address} onChange={(event) => update("address", event.target.value)} required /></div>
            <div className="field full-span"><label htmlFor="setup-footer">Receipt footer</label><input className="input" id="setup-footer" value={values.footer} onChange={(event) => update("footer", event.target.value)} /></div>
            <div className="field full-span"><label htmlFor="setup-device">Device name</label><input className="input" id="setup-device" value={values.deviceName} onChange={(event) => update("deviceName", event.target.value)} required /><small>Use a stable name such as Device 01 for this single shop computer.</small></div>
          </div>
          {error ? <div className="notice error-notice" role="alert"><Storefront size={17} weight="bold" /><span>{error}</span></div> : null}
          <button className="button primary auth-submit" type="submit" disabled={busy}><CheckCircle size={16} weight="bold" />{busy ? "Registering shop…" : "Register shop"}</button>
        </form>
      </section>
    </main>
  );
}
