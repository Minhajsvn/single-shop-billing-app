-- Plan features and limits. Rows are generated from lib/billing/plans.ts by `npm run plans:sql`. A null limit means unlimited.
create table public.plan_catalog (
  id text primary key check (id ~ '^[a-z]+$'),
  features text[] not null default '{}',
  max_branches integer check (max_branches >= 0),
  max_tills integer check (max_tills >= 0),
  max_members integer check (max_members >= 0),
  max_products integer check (max_products >= 0)
);

alter table public.plan_catalog enable row level security;
create policy "signed-in users read plans" on public.plan_catalog for select to authenticated using (true);
