create extension if not exists pgcrypto;

create type public.device_status as enum ('active', 'revoked');
create type public.product_status as enum ('active', 'inactive');
create type public.stock_movement_type as enum ('opening', 'receipt', 'correction_in', 'correction_out', 'sale', 'return');

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete restrict,
  legal_name text not null,
  trn text not null check (trn ~ '^[0-9]{15}$'),
  address text not null,
  phone text not null,
  timezone text not null default 'Asia/Dubai' check (timezone = 'Asia/Dubai'),
  invoice_prefix text not null default 'SL' check (invoice_prefix ~ '^[A-Z0-9-]{1,8}$'),
  receipt_footer text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  name text not null,
  status public.device_status not null default 'active',
  pin_hash text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, name)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 160),
  sku text not null,
  barcode text,
  price_fils bigint not null check (price_fils > 0),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0),
  status public.product_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, sku),
  unique nulls not distinct (business_id, barcode)
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  type public.stock_movement_type not null,
  quantity_delta integer not null check (quantity_delta <> 0),
  reason text not null check (char_length(reason) between 1 and 300),
  source_id uuid,
  operation_id uuid not null default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (business_id, operation_id)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index products_business_status_idx on public.products (business_id, status);
create index products_business_barcode_idx on public.products (business_id, barcode) where barcode is not null;
create index stock_movements_product_created_idx on public.stock_movements (product_id, created_at desc);
create index audit_events_business_created_idx on public.audit_events (business_id, created_at desc);

alter table public.businesses enable row level security;
alter table public.devices enable row level security;
alter table public.products enable row level security;
alter table public.stock_movements enable row level security;
alter table public.audit_events enable row level security;

create function public.owns_business(target_business_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.businesses b where b.id = target_business_id and b.owner_id = auth.uid()) $$;

create policy "owners manage their business" on public.businesses for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owners manage their devices" on public.devices for all using (public.owns_business(business_id)) with check (public.owns_business(business_id));
create policy "owners manage their products" on public.products for all using (public.owns_business(business_id)) with check (public.owns_business(business_id));
create policy "owners read stock movements" on public.stock_movements for select using (public.owns_business(business_id));
create policy "owners read audit events" on public.audit_events for select using (public.owns_business(business_id));

revoke update, delete on public.stock_movements from authenticated;
revoke update, delete on public.audit_events from authenticated;
