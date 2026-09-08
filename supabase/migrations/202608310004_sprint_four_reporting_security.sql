alter table public.customers add constraint customers_id_business_unique unique (id, business_id);
alter table public.sales add constraint sales_id_business_unique unique (id, business_id);
alter table public.sale_items add constraint sale_items_id_business_unique unique (id, business_id);
alter table public.credit_notes add constraint credit_notes_id_business_unique unique (id, business_id);

alter table public.sales
  add constraint sales_customer_same_business
  foreign key (customer_id, business_id) references public.customers(id, business_id) on delete restrict;

alter table public.sale_items
  add constraint sale_items_sale_same_business
  foreign key (sale_id, business_id) references public.sales(id, business_id) on delete restrict;

alter table public.credit_notes
  add constraint credit_notes_sale_same_business
  foreign key (sale_id, business_id) references public.sales(id, business_id) on delete restrict;

alter table public.credit_note_items
  add constraint credit_note_items_note_same_business
  foreign key (credit_note_id, business_id) references public.credit_notes(id, business_id) on delete restrict;

alter table public.credit_note_items
  add constraint credit_note_items_sale_item_same_business
  foreign key (sale_item_id, business_id) references public.sale_items(id, business_id) on delete restrict;

create view public.daily_fiscal_documents
with (security_invoker = true)
as
select business_id, supply_date as business_date, id as document_id, invoice_number as document_number,
  'invoice'::text as document_type, payment_method, net_fils, vat_fils, gross_fils, created_at
from public.sales
union all
select cn.business_id, (cn.created_at at time zone 'Asia/Dubai')::date as business_date,
  cn.id, cn.credit_note_number, 'credit_note'::text, cn.payment_method,
  -cn.net_fils, -cn.vat_fils, -cn.gross_fils, cn.created_at
from public.credit_notes cn;

revoke all on public.daily_fiscal_documents from anon;
grant select on public.daily_fiscal_documents to authenticated;

revoke all on public.businesses, public.devices, public.products, public.stock_movements,
  public.audit_events, public.register_sessions, public.invoice_number_ranges,
  public.sales, public.sale_items, public.cash_movements, public.customers,
  public.credit_notes, public.credit_note_items, public.sync_operations from anon;

revoke update, delete on public.register_sessions from authenticated;
revoke update, delete on public.audit_events from authenticated;

comment on view public.daily_fiscal_documents is 'RLS-aware signed fiscal ledger for authorized daily reports; credit notes are negative values.';
