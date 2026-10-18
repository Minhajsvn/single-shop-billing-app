"use client";

import { IdentificationCard, MagnifyingGlass, PencilSimple, Plus, X } from "@phosphor-icons/react";
import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { EmptyState, Pager, SummaryStrip } from "@/components/ui/list-parts";
import { useListParams } from "@/components/ui/use-list-params";
import { paginate } from "@/lib/lists/paging";
import { customerMatches } from "@/lib/lists/search";
import { dubaiSupplyDate } from "@/lib/invoice-numbers";
import { toast } from "@/lib/ui/toast-store";
import { addCustomer, updateCustomer, useDemoStore, type CustomerInput } from "@/lib/demo-store";
import { formatAED, type Customer } from "@/lib/domain";

const blankCustomer: CustomerInput = { name: "", phone: "", email: "", address: "", trn: "" };

export function CustomersWorkspace() {
  const store = useDemoStore();
  const [params, setParams] = useListParams({ q: "", page: "1" });
  const [editing, setEditing] = useState<Customer | null | "new">(null);
  const [error, setError] = useState("");
  const filtered = useMemo(() => store.customers.filter((customer) => customerMatches(customer, params.q)), [params.q, store.customers]);
  const paged = paginate(filtered, Number(params.page) || 1);
  const thisMonth = dubaiSupplyDate(new Date()).slice(0, 7);
  const newThisMonth = store.customers.filter((customer) => dubaiSupplyDate(new Date(customer.createdAt)).slice(0, 7) === thisMonth).length;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input: CustomerInput = {
      name: String(data.get("name") ?? ""), phone: String(data.get("phone") ?? ""),
      email: String(data.get("email") ?? "").trim() || undefined, address: String(data.get("address") ?? "").trim() || undefined,
      trn: String(data.get("trn") ?? "").trim() || undefined,
    };
    const result = editing === "new" ? addCustomer(input) : editing ? updateCustomer(editing.id, input) : { ok: false as const, error: "No customer selected." };
    if (!result.ok) return setError(result.error);
    setEditing(null);
    setError("");
    toast("Customer saved");
  }

  const initial = editing === "new" || !editing ? blankCustomer : editing;

  return (
    <>
      <div className="page-heading"><div><div className="eyebrow">Customer records</div><h1 className="page-title">Customers</h1><p className="page-copy">Store only useful contact and tax details, then see every linked purchase without changing old invoices.</p></div><button className="button primary" onClick={() => setEditing("new")}><Plus size={15} weight="bold" /> Add customer</button></div>
            <SummaryStrip label="Customer summary" items={[{ label: "Customers", value: store.customers.length.toLocaleString("en-US") }, { label: "New this month", value: newThisMonth.toLocaleString("en-US") }, { label: "With TRN", value: store.customers.filter((item) => item.trn).length.toLocaleString("en-US") }]} />
      <section className="panel customer-list-panel"><div className="panel-body"><div className="search"><MagnifyingGlass size={16} weight="bold" /><input className="input" value={params.q} onChange={(event) => setParams({ q: event.target.value, page: "1" })} placeholder="Name, phone, email or TRN" aria-label="Search customers" /></div></div>{paged.items.length ? <div className="customer-list">{paged.items.map((customer) => {
        const purchases = store.sales.filter((sale) => sale.customer?.id === customer.id);
        return <div className="customer-row" key={customer.id}><Link className="customer-main" href={`/customers/${customer.id}`}><span className="customer-avatar">{customer.name.slice(0, 2).toUpperCase()}</span><span><strong>{customer.name}</strong><small>{customer.phone}{customer.email ? ` · ${customer.email}` : ""}</small></span></Link><div className="customer-stat"><span>{purchases.length} purchases</span><strong>{formatAED(purchases.reduce((sum, sale) => sum + sale.grossFils, 0))}</strong></div><div className="customer-trn">{customer.trn ? <><span>TRN</span><strong>{customer.trn}</strong></> : <span>Individual</span>}</div><button className="button icon-only" onClick={() => setEditing(customer)} aria-label={`Edit ${customer.name}`}><PencilSimple size={15} weight="bold" /></button></div>;
      })}</div> : store.customers.length
        ? <EmptyState icon={<IdentificationCard size={32} weight="duotone" />} title={`No customers match "${params.q}"`} hint="Try a name, a phone number in any format, an email or a TRN." />
        : <EmptyState icon={<IdentificationCard size={32} weight="duotone" />} title="No customers yet" hint="Add customers to issue full tax invoices and see their purchases." action={<button className="button primary" onClick={() => setEditing("new")}>Add customer</button>} />}
        <Pager {...paged} onPage={(next) => setParams({ page: String(next) })} /></section>

      {editing && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}><form className="modal" onSubmit={submit}><div className="modal-header"><div><div className="panel-title">{editing === "new" ? "Add customer" : "Edit customer"}</div><div className="panel-subtitle">TRN is optional, but must be 15 digits when supplied.</div></div><button type="button" className="button icon-only" onClick={() => setEditing(null)} aria-label="Close"><X size={16} weight="bold" /></button></div><div className="modal-body"><div className="form-grid"><div className="field"><label htmlFor="customerName">Name</label><input className="input" id="customerName" name="name" defaultValue={initial.name} required autoFocus /></div><div className="field"><label htmlFor="customerPhone">Phone</label><input className="input" id="customerPhone" name="phone" defaultValue={initial.phone} required /></div><div className="field"><label htmlFor="customerEmail">Email</label><input className="input" id="customerEmail" name="email" type="email" defaultValue={initial.email} /></div><div className="field"><label htmlFor="customerTrn">TRN</label><input className="input" id="customerTrn" name="trn" inputMode="numeric" pattern="[0-9]{15}" minLength={15} maxLength={15} defaultValue={initial.trn} /></div><div className="field full-span"><label htmlFor="customerAddress">Address</label><textarea className="textarea" id="customerAddress" name="address" defaultValue={initial.address} /></div></div>{error && <p className="form-error">{error}</p>}</div><div className="modal-footer"><button type="button" className="button" onClick={() => setEditing(null)}>Cancel</button><button className="button primary" type="submit">Save customer</button></div></form></div>}
    </>
  );
}
