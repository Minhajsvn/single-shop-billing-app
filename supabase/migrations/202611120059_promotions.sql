-- Stage 2E (docs/superpowers/specs/2026-11-12-stage-2e-promotions-design.md §4): promotions. Owners and managers on Pro
-- (`promotions`) manage them online; every member's till reads the live ones (they are applied on the till, offline
-- too). Each synced sale line records the promotion that priced it and what it saved.

create table public.promotions (
  id uuid primary key,
  business_id uuid not null references public.businesses (id) on delete restrict,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 40),
  kind text not null check (kind in ('percent_off', 'amount_off', 'multi_buy_free', 'multi_buy_price', 'basket_percent')),
  target_type text not null check (target_type in ('product', 'category', 'all')),
  target_id uuid,
  percent numeric(5, 2),
  amount_fils bigint,
  buy_qty integer,
  get_qty integer,
  bundle_price_fils bigint,
  min_basket_fils bigint,
  starts_on date not null,
  ends_on date,
  days smallint[],
  from_time time,
  to_time time,
  active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  check ((target_type = 'all') = (target_id is null)),
  check (ends_on is null or ends_on >= starts_on),
  check ((from_time is null) = (to_time is null)),
  check (days is null or (cardinality(days) between 1 and 7 and days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[])),
  check (case kind
    when 'percent_off' then percent between 0.1 and 99
    when 'basket_percent' then percent between 0.1 and 99 and target_type = 'all' and min_basket_fils between 0 and 10000000
    when 'amount_off' then amount_fils between 1 and 100000
    when 'multi_buy_free' then buy_qty between 1 and 99 and get_qty between 1 and 99
    when 'multi_buy_price' then buy_qty between 2 and 99 and bundle_price_fils > 0
  end)
);

create index promotions_business on public.promotions (business_id);

alter table public.promotions enable row level security;
-- Members read the shop's promotions that can still apply (not archived, not ended before yesterday): enough for any
-- till, even one whose clock is a day behind.
create policy "members read live promotions" on public.promotions for select using (
  public.has_role(business_id, 'cashier') and archived_at is null
  and (ends_on is null or ends_on >= (now() at time zone 'Asia/Dubai')::date - 1)
);
revoke insert, update, delete, truncate on public.promotions from public, anon, authenticated;
grant select on public.promotions to authenticated;

alter table public.sale_items add column promotion_id uuid;
alter table public.sale_items add column promotion_saving_fils bigint check (promotion_saving_fils >= 0);
-- 2C hid sale_items.unit_cost_fils with column grants; the new columns are granted explicitly.
grant select (promotion_id, promotion_saving_fils) on public.sale_items to authenticated;

-- Raises unless the caller is an owner or manager of the shop (42501) on a plan with promotions (P0001).
create function public.promotions_check(p_business_id uuid)
returns void language plpgsql stable security definer set search_path = public, extensions, pg_temp
as $$
begin
  if auth.uid() is null or not public.has_role(p_business_id, 'manager') then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not coalesce(public.entitlements_internal(p_business_id) -> 'features' ? 'promotions', false) then
    raise exception 'feature_not_in_plan' using errcode = 'P0001';
  end if;
end
$$;

revoke all on function public.promotions_check(uuid) from public, anon, authenticated;

create function public.promotion_json(p public.promotions)
returns jsonb language sql immutable set search_path = public, extensions, pg_temp
as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'kind', p.kind, 'targetType', p.target_type, 'targetId', p.target_id,
    'percent', p.percent, 'amountFils', p.amount_fils, 'buyQty', p.buy_qty, 'getQty', p.get_qty,
    'bundlePriceFils', p.bundle_price_fils, 'minBasketFils', p.min_basket_fils,
    'startsOn', p.starts_on, 'endsOn', p.ends_on, 'days', to_jsonb(p.days),
    'fromTime', to_char(p.from_time, 'HH24:MI'), 'toTime', to_char(p.to_time, 'HH24:MI'),
    'active', p.active, 'archived', p.archived_at is not null, 'createdAt', p.created_at)
$$;

-- Upserts one promotion by its (client-made) id. Pause/resume (`active`) and archive (`archived`) go through here too.
create function public.promotion_save(p_business_id uuid, p_promotion jsonb)
returns uuid language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  target uuid;
  target_kind text := coalesce(p_promotion->>'targetType', 'all');
  target_ref uuid;
  archived boolean := coalesce((p_promotion->>'archived')::boolean, false);
begin
  perform public.promotions_check(p_business_id);
  if jsonb_typeof(p_promotion) <> 'object' or coalesce(p_promotion->>'id', '') !~* uuid_re then
    raise exception 'invalid_promotion' using errcode = 'P0001';
  end if;
  target := (p_promotion->>'id')::uuid;
  if exists (select 1 from public.promotions p where p.id = target and p.business_id <> p_business_id) then
    raise exception 'invalid_promotion' using errcode = 'P0001';
  end if;
  if target_kind <> 'all' then
    if coalesce(p_promotion->>'targetId', '') !~* uuid_re then
      raise exception 'invalid_promotion' using errcode = 'P0001';
    end if;
    target_ref := (p_promotion->>'targetId')::uuid;
    if (target_kind = 'product' and not exists (select 1 from public.products x where x.id = target_ref and x.business_id = p_business_id))
       or (target_kind = 'category' and not exists (select 1 from public.product_categories x where x.id = target_ref and x.business_id = p_business_id)) then
      raise exception 'target_not_found' using errcode = 'P0001';
    end if;
  end if;

  begin
    insert into public.promotions as p (id, business_id, name, kind, target_type, target_id, percent, amount_fils, buy_qty, get_qty,
      bundle_price_fils, min_basket_fils, starts_on, ends_on, days, from_time, to_time, active, archived_at)
    values (target, p_business_id, btrim(coalesce(p_promotion->>'name', '')), p_promotion->>'kind', target_kind, target_ref,
      (p_promotion->>'percent')::numeric, (p_promotion->>'amountFils')::bigint, (p_promotion->>'buyQty')::integer,
      (p_promotion->>'getQty')::integer, (p_promotion->>'bundlePriceFils')::bigint, (p_promotion->>'minBasketFils')::bigint,
      (p_promotion->>'startsOn')::date, nullif(p_promotion->>'endsOn', '')::date,
      case when jsonb_typeof(p_promotion->'days') = 'array' then array(select value::smallint from jsonb_array_elements_text(p_promotion->'days')) end,
      nullif(p_promotion->>'fromTime', '')::time, nullif(p_promotion->>'toTime', '')::time,
      coalesce((p_promotion->>'active')::boolean, true), case when archived then now() end)
    on conflict (id) do update set
      name = excluded.name, kind = excluded.kind, target_type = excluded.target_type, target_id = excluded.target_id,
      percent = excluded.percent, amount_fils = excluded.amount_fils, buy_qty = excluded.buy_qty, get_qty = excluded.get_qty,
      bundle_price_fils = excluded.bundle_price_fils, min_basket_fils = excluded.min_basket_fils,
      starts_on = excluded.starts_on, ends_on = excluded.ends_on, days = excluded.days,
      from_time = excluded.from_time, to_time = excluded.to_time, active = excluded.active,
      archived_at = case when archived then coalesce(p.archived_at, now()) else null end;
  exception when check_violation or not_null_violation or invalid_text_representation or invalid_datetime_format
            or datetime_field_overflow or numeric_value_out_of_range or invalid_parameter_value then
    raise exception 'invalid_promotion' using errcode = 'P0001';
  end;

  insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, summary)
  values (p_business_id, auth.uid(), 'promotion.save', 'promotion', target,
          public.promotion_json((select p from public.promotions p where p.id = target)));
  return target;
end
$$;

-- Every promotion of the shop, archived and ended too, for the manage page.
create function public.promotion_list(p_business_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions, pg_temp
as $$
begin
  perform public.promotions_check(p_business_id);
  return coalesce((select jsonb_agg(public.promotion_json(p) order by p.created_at desc) from public.promotions p where p.business_id = p_business_id), '[]'::jsonb);
end
$$;

-- What each promotion did between two Dubai dates (at most 92 days): uses, units, net, saving; cost and profit over
-- the lines that carry a stamped cost (null when none does).
create function public.promotion_results(p_business_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public, extensions, pg_temp
as $$
begin
  perform public.promotions_check(p_business_id);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 91 then
    raise exception 'invalid_range' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'promotionId', r.promotion_id, 'name', coalesce(p.name, 'Removed promotion'), 'uses', r.uses, 'units', r.units,
      'netFils', r.net, 'savingFils', r.saving, 'costFils', r.cost,
      'profitFils', case when r.cost is null then null else r.costed_net - r.cost end) order by r.saving desc)
    from (
      select i.promotion_id, count(distinct i.sale_id) as uses, sum(i.quantity) as units, sum(i.net_fils) as net,
             sum(coalesce(i.promotion_saving_fils, 0)) as saving,
             sum(i.quantity * i.unit_cost_fils) as cost,
             sum(i.net_fils) filter (where i.unit_cost_fils is not null) as costed_net
      from public.sale_items i join public.sales s on s.id = i.sale_id
      where s.business_id = p_business_id and s.supply_date between p_from and p_to and i.promotion_id is not null
      group by i.promotion_id
    ) r left join public.promotions p on p.id = r.promotion_id), '[]'::jsonb);
end
$$;

revoke all on function public.promotion_json(public.promotions) from public, anon, authenticated;
revoke all on function public.promotion_save(uuid, jsonb) from public, anon;
revoke all on function public.promotion_list(uuid) from public, anon;
revoke all on function public.promotion_results(uuid, date, date) from public, anon;
grant execute on function public.promotion_save(uuid, jsonb) to authenticated;
grant execute on function public.promotion_list(uuid) to authenticated;
grant execute on function public.promotion_results(uuid, date, date) to authenticated;

-- The sale wrapper (latest 202611100056: cost stamping and the split's cash part kept) now also copies each line's
-- promotionId and promotionSavingFils from the till's payload onto the saved line (matched by line id).
create or replace function public.apply_sale_sync_with_payments(p_operation_id uuid, p_business_id uuid, p_entity_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  result jsonb;
  saved public.sales;
  cash_part bigint;
begin
  perform 1 from public.payment_rows_from(p_payload -> 'sale');
  result := public.apply_sale_sync(p_operation_id, p_business_id, p_entity_id, p_payload);

  select * into saved from public.sales where id = p_entity_id and business_id = p_business_id;
  if not found or exists (select 1 from public.sale_payments where sale_id = saved.id) then
    return result; -- refused by the base function's own rules, or a retry that already saved its rows
  end if;

  -- Stage 2C: this call saved the sale, so stamp each product line with the product's cost now.
  update public.sale_items i set unit_cost_fils = p.cost_fils
  from public.products p
  where i.sale_id = saved.id and p.id = i.product_id and p.business_id = saved.business_id;

  -- Stage 2E: the promotion that priced each line, as the till recorded it. Malformed values are ignored.
  update public.sale_items i
  set promotion_id = (l->>'promotionId')::uuid,
      promotion_saving_fils = case when coalesce(l->>'promotionSavingFils', '') ~ '^\d{1,12}$' then (l->>'promotionSavingFils')::bigint end
  from jsonb_array_elements(p_payload->'sale'->'lines') l
  where i.sale_id = saved.id
    and coalesce(l->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and i.id = (l->>'id')::uuid
    and coalesce(l->>'promotionId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  insert into public.sale_payments (id, business_id, sale_id, method, amount_fils, reference, created_at)
  select r.id, saved.business_id, saved.id, r.method, r.amount_fils, r.reference, saved.created_at
  from public.payment_rows_from(p_payload -> 'sale') r;

  if (select sum(amount_fils) from public.sale_payments where sale_id = saved.id) <> saved.gross_fils then
    raise exception using errcode = 'P0001', message = 'payments_mismatch';
  end if;

  -- 2B fix (056): a split's cash part goes in the drawer.
  if saved.payment_method = 'split' then
    select amount_fils into cash_part from public.sale_payments where sale_id = saved.id and method = 'cash';
    if cash_part is not null then
      insert into public.cash_movements (business_id, register_session_id, sale_id, type, amount_fils, reason, created_by, created_at)
      values (saved.business_id, saved.register_session_id, saved.id, 'sale', cash_part, saved.invoice_number, auth.uid(), saved.created_at);
    end if;
  end if;
  return result;
end
$$;

revoke execute on function public.apply_sale_sync_with_payments(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.apply_sale_sync_with_payments(uuid, uuid, uuid, jsonb) to authenticated;
