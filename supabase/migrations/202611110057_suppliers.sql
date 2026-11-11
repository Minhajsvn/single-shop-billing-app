-- Stage 2D (docs/superpowers/specs/2026-11-11-stage-2d-purchasing-design.md §4): the shop's suppliers. Pro
-- (`purchasing`), owner and manager only. No table privileges for members: every read and write goes through the
-- functions below, so a cashier never sees suppliers or buying prices.

create table public.suppliers (
  id uuid primary key,
  business_id uuid not null references public.businesses (id) on delete restrict,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 80),
  trn text check (trn ~ '^[0-9]{15}$'),
  phone text check (char_length(phone) <= 30),
  email text check (char_length(email) <= 120),
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create unique index suppliers_live_name on public.suppliers (business_id, lower(name)) where archived_at is null;
create index suppliers_business on public.suppliers (business_id);

alter table public.suppliers enable row level security;
revoke all on public.suppliers from public, anon, authenticated;

-- Raises unless the caller is an owner or manager of the shop (42501 not_authorized) on a plan with purchasing
-- (P0001 feature_not_in_plan).
create function public.purchasing_check(p_business_id uuid)
returns void language plpgsql stable security definer set search_path = public, extensions, pg_temp
as $$
begin
  if auth.uid() is null or not public.has_role(p_business_id, 'manager') then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not coalesce(public.entitlements_internal(p_business_id) -> 'features' ? 'purchasing', false) then
    raise exception 'feature_not_in_plan' using errcode = 'P0001';
  end if;
end
$$;

revoke all on function public.purchasing_check(uuid) from public, anon, authenticated;

create function public.supplier_list(p_business_id uuid)
returns table (id uuid, name text, trn text, phone text, email text, note text, archived boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = public, extensions, pg_temp
as $$
begin
  perform public.purchasing_check(p_business_id);
  return query
  select s.id, s.name, s.trn, s.phone, s.email, s.note, s.archived_at is not null, s.created_at
  from public.suppliers s where s.business_id = p_business_id
  order by s.archived_at is not null, lower(s.name);
end
$$;

-- Upserts one supplier by its (client-made) id. Payload: { id, name, trn?, phone?, email?, note?, archived? }.
create function public.supplier_save(p_business_id uuid, p_supplier jsonb)
returns uuid language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  target uuid;
  clean_name text := btrim(coalesce(p_supplier->>'name', ''));
  clean_trn text := nullif(regexp_replace(coalesce(p_supplier->>'trn', ''), '\s', '', 'g'), '');
  clean_phone text := nullif(btrim(coalesce(p_supplier->>'phone', '')), '');
  clean_email text := nullif(btrim(coalesce(p_supplier->>'email', '')), '');
  clean_note text := nullif(btrim(coalesce(p_supplier->>'note', '')), '');
  archived boolean := coalesce((p_supplier->>'archived')::boolean, false);
begin
  perform public.purchasing_check(p_business_id);
  if jsonb_typeof(p_supplier) <> 'object' or coalesce(p_supplier->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_supplier' using errcode = 'P0001';
  end if;
  target := (p_supplier->>'id')::uuid;
  if char_length(clean_name) not between 1 and 80
     or (clean_trn is not null and clean_trn !~ '^[0-9]{15}$')
     or char_length(coalesce(clean_phone, '')) > 30 or char_length(coalesce(clean_email, '')) > 120
     or char_length(coalesce(clean_note, '')) > 300 then
    raise exception 'invalid_supplier' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.suppliers s where s.id = target and s.business_id <> p_business_id) then
    raise exception 'supplier_not_found' using errcode = 'P0001';
  end if;
  if not archived and exists (
    select 1 from public.suppliers s
    where s.business_id = p_business_id and s.id <> target and s.archived_at is null and lower(s.name) = lower(clean_name)
  ) then
    raise exception 'supplier_name_taken' using errcode = 'P0001';
  end if;

  begin
    update public.suppliers s
    set name = clean_name, trn = clean_trn, phone = clean_phone, email = clean_email, note = clean_note,
        archived_at = case when archived then coalesce(s.archived_at, now()) else null end
    where s.id = target and s.business_id = p_business_id;
    if not found then
      insert into public.suppliers (id, business_id, name, trn, phone, email, note, archived_at)
      values (target, p_business_id, clean_name, clean_trn, clean_phone, clean_email, clean_note, case when archived then now() end);
    end if;
  exception when unique_violation then
    raise exception 'supplier_name_taken' using errcode = 'P0001';
  end;

  insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, summary)
  values (p_business_id, auth.uid(), 'supplier.save', 'supplier', target,
          jsonb_build_object('name', clean_name, 'trn', clean_trn, 'archived', archived));
  return target;
end
$$;

revoke all on function public.supplier_list(uuid) from public, anon;
revoke all on function public.supplier_save(uuid, jsonb) from public, anon;
grant execute on function public.supplier_list(uuid) to authenticated;
grant execute on function public.supplier_save(uuid, jsonb) to authenticated;
