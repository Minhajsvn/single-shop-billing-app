"use client";

import { IdentificationCard, MagnifyingGlass, PencilSimple, Plus, X } from "@phosphor-icons/react";
import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { addCustomer, updateCustomer, useDemoStore, type CustomerInput } from "@/lib/demo-store";
import { formatAED, type Customer } from "@/lib/domain";

const blankCustomer: CustomerInput = { name: "", phone: "", email: "", address: "", trn: "" };

export function CustomersWorkspace() {
  const store = useDemoStore();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Customer | null | "new">(null);
  const [error, setError] = useState("");
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return store.customers.filter((customer) => !term || [customer.name, customer.phone, customer.email, customer.trn].some((value) => value?.toLowerCase().includes(term)));
  }, [query, store.customers]);

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
  }

  const initial = editing === "new" || !editing ? blankCustomer : editing;

  return (
    <>
      <div className="page-heading"><div><div className="eyebrow">Customer records</div><h1 className="page-title">Customers</h1><p className="page-copy">Store only useful contact and tax details, then see every linked purchase without changing old invoices.</p></div><button className="button primary" onClick={() => setEditing("new")}><Plus size={15} weight="bold" /> Add customer</button></div>
      <section className="metric-grid customer-metrics"><div className="metric"><div className="metric-label">Customers</div><div className="metric-value">{store.customers.length}</div><div className="metric-note">Active local records</div></div><div className="metric"><div className="metric-label">Business customers</div><div className="metric-value">{store.customers.filter((item) => item.trn).length}</div><div className="metric-note">With validated TRN</div></div><div className="metric"><div className="metric-label">Linked sales</div><div className="metric-value">{store.sales.filter((item) => item.customer).length}</div><div className="metric-note">Full tax invoices</div></div><div className="metric"><div className="metric-label">Customer value</div><div className="metric-value">{formatAED(store.sales.filter((item) => item.customer).reduce((sum, sale) => sum + sale.grossFils, 0))}</div><div className="metric-note">Gross invoiced</div></div></section>
      <section className="panel customer-list-panel"><div className="panel-body"><div className="search"><MagnifyingGlass size={16} weight="bold" /><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, phone, email, or TRN" aria-label="Search customers" /></div></div>{filtered.length ? <div className="customer-list">{filtered.map((customer) => {
        const purchases = store.sales.filter((sale) => sale.customer?.id === customer.id);
        return <div className="customer-row" key={customer.id}><Link className="customer-main" href={`/customers/${customer.id}`}><span className="customer-avatar">{customer.name.slice(0, 2).toUpperCase()}</span><span><strong>{customer.name}</strong><small>{customer.phone}{customer.email ? ` · ${customer.email}` : ""}</small></span></Link><div className="customer-stat"><span>{purchases.length} purchases</span><strong>{formatAED(purchases.reduce((sum, sale) => sum + sale.grossFils, 0))}</strong></div><div className="customer-trn">{customer.trn ? <><span>TRN</span><strong>{customer.trn}</strong></> : <span>Individual</span>}</div><button className="button icon-only" onClick={() => setEditing(customer)} aria-label={`Edit ${customer.name}`}><PencilSimple size={15} weight="bold" /></button></div>;
      })}</div> : <div className="empty"><IdentificationCard size={32} weight="duotone" /><h3>No customers found</h3><p>Add a customer or change the search.</p></div>}</section>

      {editing && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}><form className="modal" onSubmit={submit}><div className="modal-header"><div><div className="panel-title">{editing === "new" ? "Add customer" : "Edit customer"}</div><div className="panel-subtitle">TRN is optional, but must be 15 digits when supplied.</div></div><button type="button" className="button icon-only" onClick={() => setEditing(null)} aria-label="Close"><X size={16} weight="bold" /></button></div><div className="modal-body"><div className="form-grid"><div className="field"><label htmlFor="customerName">Name</label><input className="input" id="customerName" name="name" defaultValue={initial.name} required autoFocus /></div><div className="field"><label htmlFor="customerPhone">Phone</label><input className="input" id="customerPhone" name="phone" defaultValue={initial.phone} required /></div><div className="field"><label htmlFor="customerEmail">Email</label><input className="input" id="customerEmail" name="email" type="email" defaultValue={initial.email} /></div><div className="field"><label htmlFor="customerTrn">TRN</label><input className="input" id="customerTrn" name="trn" inputMode="numeric" pattern="[0-9]{15}" minLength={15} maxLength={15} defaultValue={initial.trn} /></div><div className="field full-span"><label htmlFor="customerAddress">Address</label><textarea className="textarea" id="customerAddress" name="address" defaultValue={initial.address} /></div></div>{error && <p className="form-error">{error}</p>}</div><div className="modal-footer"><button type="button" className="button" onClick={() => setEditing(null)}>Cancel</button><button className="button primary" type="submit">Save customer</button></div></form></div>}
    </>
  );
}
