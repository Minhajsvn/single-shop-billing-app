-- Stage 2B: one payment row per method on every sale and refund (spec 2026-11-09-stage-2b §4.2–4.4).
-- sales.payment_method / credit_notes.payment_method stay as a one-word summary (one method, or 'split').
-- Rows are written only by the sync functions (202611090051); members read them like the document they belong to.

create table public.sale_payments (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  sale_id uuid not null references public.sales(id) on delete restrict,
  method public.payment_method not null check (method <> 'split'),
  amount_fils bigint not null check (amount_fils > 0),
  reference text check (reference is null or (method = 'transfer' and char_length(reference) <= 60)),
  created_at timestamptz not null default now(),
  unique (sale_id, method)
);

create table public.credit_note_payments (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  credit_note_id uuid not null references public.credit_notes(id) on delete restrict,
  method public.payment_method not null check (method <> 'split'),
  amount_fils bigint not null check (amount_fils > 0),
  reference text check (reference is null or (method = 'transfer' and char_length(reference) <= 60)),
  created_at timestamptz not null default now(),
  unique (credit_note_id, method)
);

create index sale_payments_business_created_idx on public.sale_payments (business_id, created_at);
create index credit_note_payments_business_created_idx on public.credit_note_payments (business_id, created_at);

alter table public.sale_payments enable row level security;
alter table public.credit_note_payments enable row level security;

create policy "owners read their sale payments" on public.sale_payments for select using (public.owns_business(business_id));
create policy "members read payments of visible sales" on public.sale_payments for select
  using (public.has_role(business_id, 'cashier') and exists (select 1 from public.sales s where s.id = sale_id));
create policy "owners read their credit note payments" on public.credit_note_payments for select using (public.owns_business(business_id));
create policy "members read payments of visible credit notes" on public.credit_note_payments for select
  using (public.has_role(business_id, 'cashier') and exists (select 1 from public.credit_notes c where c.id = credit_note_id));

revoke insert, update, delete, truncate on public.sale_payments, public.credit_note_payments from anon, authenticated;
grant select on public.sale_payments, public.credit_note_payments to authenticated;

-- Backfill: every existing document gets one row, its method for its whole total.
insert into public.sale_payments (id, business_id, sale_id, method, amount_fils, created_at)
select gen_random_uuid(), s.business_id, s.id, s.payment_method, s.gross_fils, s.created_at
from public.sales s
where s.gross_fils > 0 and not exists (select 1 from public.sale_payments p where p.sale_id = s.id);

insert into public.credit_note_payments (id, business_id, credit_note_id, method, amount_fils, created_at)
select gen_random_uuid(), c.business_id, c.id, c.payment_method, c.gross_fils, c.created_at
from public.credit_notes c
where c.gross_fils > 0 and not exists (select 1 from public.credit_note_payments p where p.credit_note_id = c.id);
