-- Stage 2C (spec §4.3–4.4): stamp each synced line with its cost, and the profit report.
-- The two 2B wrappers keep their names and arguments, so the sync route does not change. A line keeps the cost it was
-- recorded with: a sale takes the product's cost when it syncs, a refund copies the cost of the sale line it returns.
-- Retries do not re-stamp. Lines recorded before this migration stay uncosted (no backfill).

create or replace function public.apply_sale_sync_with_payments(p_operation_id uuid, p_business_id uuid, p_entity_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  result jsonb;
  saved public.sales;
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

  insert into public.sale_payments (id, business_id, sale_id, method, amount_fils, reference, created_at)
  select r.id, saved.business_id, saved.id, r.method, r.amount_fils, r.reference, saved.created_at
  from public.payment_rows_from(p_payload -> 'sale') r;

  if (select sum(amount_fils) from public.sale_payments where sale_id = saved.id) <> saved.gross_fils then
    raise exception using errcode = 'P0001', message = 'payments_mismatch';
  end if;
  return result;
end
$$;

create or replace function public.apply_credit_note_sync_with_payments(p_operation_id uuid, p_business_id uuid, p_entity_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  result jsonb;
  saved public.credit_notes;
begin
  perform 1 from public.payment_rows_from(p_payload -> 'creditNote');
  result := public.apply_credit_note_sync(p_operation_id, p_business_id, p_entity_id, p_payload);

  select * into saved from public.credit_notes where id = p_entity_id and business_id = p_business_id;
  if not found or exists (select 1 from public.credit_note_payments where credit_note_id = saved.id) then
    return result;
  end if;

  -- Stage 2C: a returned line takes back exactly the cost its sale line counted.
  update public.credit_note_items n set unit_cost_fils = s.unit_cost_fils
  from public.sale_items s
  where n.credit_note_id = saved.id and s.id = n.sale_item_id;

  insert into public.credit_note_payments (id, business_id, credit_note_id, method, amount_fils, reference, created_at)
  select r.id, saved.business_id, saved.id, r.method, r.amount_fils, r.reference, saved.created_at
  from public.payment_rows_from(p_payload -> 'creditNote') r;

  if (select sum(amount_fils) from public.credit_note_payments where credit_note_id = saved.id) <> saved.gross_fils then
    raise exception using errcode = 'P0001', message = 'payments_mismatch';
  end if;
  return result;
end
$$;

revoke execute on function public.apply_sale_sync_with_payments(uuid, uuid, uuid, jsonb) from public, anon;
revoke execute on function public.apply_credit_note_sync_with_payments(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.apply_sale_sync_with_payments(uuid, uuid, uuid, jsonb) to authenticated;
grant execute on function public.apply_credit_note_sync_with_payments(uuid, uuid, uuid, jsonb) to authenticated;

-- Profit between two Dubai business dates (at most 92 days). Owner or manager, Pro only.
-- Sales count on their supply date, refunds on their Dubai creation date (as the daily report does).
-- Line profit = net excl. VAT − quantity × stamped cost. Lines without a cost are "uncosted": their net is reported on
-- its own and left out of cost, profit and margin. Category is the product's current live category, else
-- "Uncategorised". byProduct: top 50 by profit, then one "Rest" row.
create function public.profit_report(p_business_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public, extensions, pg_temp
as $$
declare
  result jsonb;
begin
  perform public.cost_reader_check(p_business_id);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 91 then
    raise exception 'invalid_range' using errcode = 'P0001';
  end if;

  with lines as (
    select s.supply_date as day, i.product_id, i.description, i.quantity as qty, i.net_fils as net,
           i.quantity * i.unit_cost_fils as cost, true as sold
    from public.sales s join public.sale_items i on i.sale_id = s.id
    where s.business_id = p_business_id and s.supply_date between p_from and p_to
    union all
    select (c.created_at at time zone 'Asia/Dubai')::date, i.product_id, i.description, -i.quantity, -i.net_fils,
           -(i.quantity * i.unit_cost_fils), false
    from public.credit_notes c join public.credit_note_items i on i.credit_note_id = c.id
    where c.business_id = p_business_id and (c.created_at at time zone 'Asia/Dubai')::date between p_from and p_to
  ),
  tagged as (
    select l.*, p.name as product_name, cat.id as category_id, cat.name as category_name
    from lines l
    left join public.products p on p.id = l.product_id
    left join public.product_categories cat on cat.id = p.category_id and cat.archived_at is null
  ),
  totals as (
    select coalesce(sum(net), 0) as net,
           coalesce(sum(net) filter (where cost is not null), 0) as costed_net,
           coalesce(sum(cost), 0) as cost,
           coalesce(sum(net) filter (where cost is null), 0) as uncosted_net,
           count(*) filter (where cost is null and sold) as uncosted_lines
    from tagged
  ),
  days as (
    select day, sum(net) as net, coalesce(sum(cost), 0) as cost,
           coalesce(sum(net) filter (where cost is not null), 0) - coalesce(sum(cost), 0) as profit
    from tagged group by day
  ),
  categories as (
    select category_id, coalesce(category_name, 'Uncategorised') as name, sum(net) as net,
           coalesce(sum(cost), 0) as cost,
           coalesce(sum(net) filter (where cost is not null), 0) as costed_net
    from tagged group by category_id, category_name
  ),
  products as (
    select product_id, coalesce(product_name, description) as name, sum(qty) as qty, sum(net) as net,
           coalesce(sum(cost), 0) as cost,
           coalesce(sum(net) filter (where cost is not null), 0) as costed_net
    from tagged group by product_id, coalesce(product_name, description)
  ),
  ranked as (
    select *, costed_net - cost as profit, row_number() over (order by costed_net - cost desc, name) as rank from products
  ),
  product_rows as (
    select rank, product_id, name, qty, net, cost, costed_net from ranked where rank <= 50
    union all
    select 51, null, 'Rest', sum(qty), sum(net), sum(cost), sum(costed_net) from ranked where rank > 50 having count(*) > 0
  )
  select jsonb_build_object(
    'totals', (select jsonb_build_object(
        'netFils', net, 'costedNetFils', costed_net, 'costFils', cost, 'profitFils', costed_net - cost,
        'marginPct', case when costed_net > 0 then round((costed_net - cost) * 100.0 / costed_net, 1) end,
        'uncostedNetFils', uncosted_net, 'uncostedLines', uncosted_lines) from totals),
    'byDay', coalesce((select jsonb_agg(jsonb_build_object('date', day, 'netFils', net, 'costFils', cost, 'profitFils', profit) order by day) from days), '[]'::jsonb),
    'byCategory', coalesce((select jsonb_agg(jsonb_build_object(
        'categoryId', category_id, 'name', name, 'netFils', net, 'costFils', cost, 'profitFils', costed_net - cost,
        'marginPct', case when costed_net > 0 then round((costed_net - cost) * 100.0 / costed_net, 1) end)
        order by costed_net - cost desc, name) from categories), '[]'::jsonb),
    'byProduct', coalesce((select jsonb_agg(jsonb_build_object(
        'productId', product_id, 'name', name, 'quantity', qty, 'netFils', net, 'costFils', cost, 'profitFils', costed_net - cost,
        'marginPct', case when costed_net > 0 then round((costed_net - cost) * 100.0 / costed_net, 1) end)
        order by rank) from product_rows), '[]'::jsonb)
  ) into result;
  return result;
end
$$;

revoke all on function public.profit_report(uuid, date, date) from public, anon;
grant execute on function public.profit_report(uuid, date, date) to authenticated;
