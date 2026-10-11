-- Stage 1A: country, currency and per-country tax rules. Only AE is enabled in the app; SA is schema-ready.

create function public.valid_tax_id(country_code text, tax_id text)
returns boolean language sql immutable
as $$
  select case country_code
    when 'AE' then tax_id ~ '^[0-9]{15}$'
    when 'SA' then tax_id ~ '^3[0-9]{13}3$'
    else false
  end
$$;

alter table public.businesses
  add column country text not null default 'AE',
  add column currency text not null default 'AED';

alter table public.businesses drop constraint if exists businesses_timezone_check;
alter table public.businesses drop constraint if exists businesses_trn_check;

alter table public.businesses
  add constraint businesses_country_profile check (
    (country = 'AE' and currency = 'AED' and timezone = 'Asia/Dubai')
    or (country = 'SA' and currency = 'SAR' and timezone = 'Asia/Riyadh')
  ),
  add constraint businesses_tax_id_valid check (public.valid_tax_id(country, trn));

create function public.lock_business_country()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if (new.country, new.currency, new.timezone) is distinct from (old.country, old.currency, old.timezone)
     and exists (select 1 from public.sales s where s.business_id = old.id) then
    raise exception using errcode = 'P0001', message = 'country_locked',
      detail = 'Country, currency and timezone cannot change after the first invoice.';
  end if;
  return new;
end
$$;

create trigger lock_business_country before update on public.businesses for each row execute function public.lock_business_country();

create type public.tax_category as enum ('standard', 'zero', 'exempt');
alter table public.products add column tax_category public.tax_category not null default 'standard';

alter table public.sale_items add column vat_rate_bp integer not null default 500 check (vat_rate_bp between 0 and 10000);
alter table public.credit_note_items add column vat_rate_bp integer not null default 500 check (vat_rate_bp between 0 and 10000);
