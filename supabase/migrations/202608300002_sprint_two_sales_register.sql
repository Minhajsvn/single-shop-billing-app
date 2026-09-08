create type public.register_status as enum ('open', 'closed');
create type public.payment_method as enum ('cash', 'card');
create type public.sale_status as enum ('completed');
create type public.cash_movement_type as enum ('opening', 'sale', 'adjustment_in', 'adjustment_out', 'refund', 'closing');

create table public.register_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  device_id uuid not null references public.devices(id) on delete restrict,
  business_date date not null,
  status public.register_status not null default 'open',
  opening_cash_fils bigint not null check (opening_cash_fils >= 0),
  expected_cash_fils bigint,
  counted_cash_fils bigint,
  variance_fils bigint,
  opened_by uuid not null references auth.users(id) on delete restrict,
  opened_at timestamptz not null default now(),
  closed_by uuid references auth.users(id) on delete restrict,
  closed_at timestamptz,
  check (
    (status = 'open' and closed_at is null and counted_cash_fils is null and variance_fils is null)
    or
    (status = 'closed' and closed_at is not null and counted_cash_fils is not null and variance_fils is not null)
  )
);

create unique index one_open_register_per_device on public.register_sessions (device_id) where status = 'open';
create index register_sessions_business_date_idx on public.register_sessions (business_id, business_date desc);

create table public.invoice_number_ranges (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  device_id uuid not null references public.devices(id) on delete restrict,
  date_code text not null check (date_code ~ '^[0-9]{6}$'),
  range_start integer not null check (range_start > 0),
  range_end integer not null check (range_end >= range_start),
  next_number integer not null check (next_number >= range_start),
  reserved_at timestamptz not null default now(),
  check (next_number <= range_end + 1),
  unique (business_id, date_code, range_start),
  unique (business_id, date_code, range_end)
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  device_id uuid not null references public.devices(id) on delete restrict,
  register_session_id uuid not null references public.register_sessions(id) on delete restrict,
  invoice_number text not null,
  operation_id uuid not null,
  status public.sale_status not null default 'completed',
  payment_method public.payment_method not null,
  supply_date date not null,
  supplier_snapshot jsonb not null,
  customer_snapshot jsonb,
  net_fils bigint not null check (net_fils >= 0),
  vat_fils bigint not null check (vat_fils >= 0),
  gross_fils bigint not null check (gross_fils = net_fils + vat_fils and gross_fils > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (business_id, invoice_number),
  unique (business_id, operation_id)
);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  sale_id uuid not null references public.sales(id) on delete restrict,
  product_id uuid references public.products(id) on delete restrict,
  description text not null,
  sku text,
  quantity integer not null check (quantity > 0),
  unit_gross_fils bigint not null check (unit_gross_fils > 0),
  net_fils bigint not null check (net_fils >= 0),
  vat_fils bigint not null check (vat_fils >= 0),
  gross_fils bigint not null check (gross_fils = net_fils + vat_fils and gross_fils > 0)
);

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  register_session_id uuid not null references public.register_sessions(id) on delete restrict,
  sale_id uuid references public.sales(id) on delete restrict,
  type public.cash_movement_type not null,
  amount_fils bigint not null check (amount_fils <> 0),
  reason text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index sales_business_created_idx on public.sales (business_id, created_at desc);
create index sales_register_idx on public.sales (register_session_id, created_at);
create index sale_items_sale_idx on public.sale_items (sale_id);
create index cash_movements_register_idx on public.cash_movements (register_session_id, created_at);

alter table public.register_sessions enable row level security;
alter table public.invoice_number_ranges enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.cash_movements enable row level security;

create policy "owners read their register sessions" on public.register_sessions for select using (public.owns_business(business_id));
create policy "owners read invoice reservations" on public.invoice_number_ranges for select using (public.owns_business(business_id));
create policy "owners read their sales" on public.sales for select using (public.owns_business(business_id));
create policy "owners read their sale items" on public.sale_items for select using (public.owns_business(business_id));
create policy "owners read their cash movements" on public.cash_movements for select using (public.owns_business(business_id));

revoke update, delete on public.sales from authenticated;
revoke update, delete on public.sale_items from authenticated;
revoke update, delete on public.cash_movements from authenticated;

comment on table public.sales is 'Immutable fiscal invoice headers. Checkout writes through an authenticated server transaction/RPC.';
comment on table public.sale_items is 'Immutable line snapshots; totals are never recalculated from current product values.';
