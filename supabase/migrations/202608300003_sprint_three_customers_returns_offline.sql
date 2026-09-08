create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 160),
  phone text not null check (char_length(phone) between 3 and 40),
  email text,
  address text,
  trn text check (trn is null or trn ~ '^[0-9]{15}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (business_id, trn)
);

alter table public.sales add column customer_id uuid references public.customers(id) on delete restrict;

create table public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  device_id uuid not null references public.devices(id) on delete restrict,
  register_session_id uuid not null references public.register_sessions(id) on delete restrict,
  sale_id uuid not null references public.sales(id) on delete restrict,
  credit_note_number text not null,
  operation_id uuid not null,
  payment_method public.payment_method not null,
  customer_snapshot jsonb,
  supplier_snapshot jsonb not null,
  net_fils bigint not null check (net_fils >= 0),
  vat_fils bigint not null check (vat_fils >= 0),
  gross_fils bigint not null check (gross_fils = net_fils + vat_fils and gross_fils > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (business_id, credit_note_number),
  unique (business_id, operation_id)
);

create table public.credit_note_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  credit_note_id uuid not null references public.credit_notes(id) on delete restrict,
  sale_item_id uuid not null references public.sale_items(id) on delete restrict,
  product_id uuid references public.products(id) on delete restrict,
  description text not null,
  sku text,
  quantity integer not null check (quantity > 0),
  unit_gross_fils bigint not null check (unit_gross_fils > 0),
  net_fils bigint not null check (net_fils >= 0),
  vat_fils bigint not null check (vat_fils >= 0),
  gross_fils bigint not null check (gross_fils = net_fils + vat_fils and gross_fils > 0)
);

create type public.sync_operation_status as enum ('accepted', 'rejected');

create table public.sync_operations (
  operation_id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  device_id uuid not null references public.devices(id) on delete restrict,
  entity_type text not null,
  entity_id uuid not null,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  status public.sync_operation_status not null,
  error_code text,
  received_at timestamptz not null default now(),
  check ((status = 'accepted' and error_code is null) or status = 'rejected')
);

create index customers_business_name_idx on public.customers (business_id, name);
create index sales_customer_created_idx on public.sales (customer_id, created_at desc) where customer_id is not null;
create index credit_notes_sale_created_idx on public.credit_notes (sale_id, created_at desc);
create index credit_note_items_note_idx on public.credit_note_items (credit_note_id);
create index sync_operations_business_received_idx on public.sync_operations (business_id, received_at desc);

alter table public.customers enable row level security;
alter table public.credit_notes enable row level security;
alter table public.credit_note_items enable row level security;
alter table public.sync_operations enable row level security;

create policy "owners manage their customers" on public.customers for all using (public.owns_business(business_id)) with check (public.owns_business(business_id));
create policy "owners read their credit notes" on public.credit_notes for select using (public.owns_business(business_id));
create policy "owners read their credit note items" on public.credit_note_items for select using (public.owns_business(business_id));
create policy "owners read their sync diagnostics" on public.sync_operations for select using (public.owns_business(business_id));

revoke update, delete on public.credit_notes from authenticated;
revoke update, delete on public.credit_note_items from authenticated;
revoke update, delete on public.sync_operations from authenticated;

comment on table public.credit_notes is 'Immutable fiscal corrections. Return writes occur in one authenticated transaction with stock and payment reversals.';
comment on table public.sync_operations is 'Idempotency ledger. Replaying an operation_id with the same payload returns its first result; a different payload is rejected.';
