alter table public.customers drop constraint if exists customers_business_id_trn_key;
create unique index if not exists customers_business_trn_unique
  on public.customers (business_id, trn)
  where trn is not null;
