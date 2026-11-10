-- Fix for Stage 2B, shipped with 2C: the cash part of a split sale or refund counts in the drawer.
-- apply_sale_sync / apply_credit_note_sync add a drawer movement only when the document's method is exactly 'cash',
-- so a split's cash part was missing from the server's expected cash. The till counts it (register-totals), so closing
-- such a register was refused with register_expected_cash_mismatch. The wrappers (latest in 055, cost stamping kept)
-- now add the cash part as a movement when they save a split document. Retries add nothing.

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

  insert into public.sale_payments (id, business_id, sale_id, method, amount_fils, reference, created_at)
  select r.id, saved.business_id, saved.id, r.method, r.amount_fils, r.reference, saved.created_at
  from public.payment_rows_from(p_payload -> 'sale') r;

  if (select sum(amount_fils) from public.sale_payments where sale_id = saved.id) <> saved.gross_fils then
    raise exception using errcode = 'P0001', message = 'payments_mismatch';
  end if;

  -- 2B fix: a split's cash part goes in the drawer (a plain cash sale already got its movement from apply_sale_sync).
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

create or replace function public.apply_credit_note_sync_with_payments(p_operation_id uuid, p_business_id uuid, p_entity_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  result jsonb;
  saved public.credit_notes;
  cash_part bigint;
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

  -- 2B fix: a split refund's cash part comes out of the drawer, like apply_credit_note_sync does for a cash refund.
  if saved.payment_method = 'split' then
    select amount_fils into cash_part from public.credit_note_payments where credit_note_id = saved.id and method = 'cash';
    if cash_part is not null then
      insert into public.cash_movements (business_id, register_session_id, type, amount_fils, reason, created_by, created_at)
      values (saved.business_id, saved.register_session_id, 'refund', -cash_part, saved.credit_note_number, auth.uid(), saved.created_at);
    end if;
  end if;
  return result;
end
$$;

revoke execute on function public.apply_sale_sync_with_payments(uuid, uuid, uuid, jsonb) from public, anon;
revoke execute on function public.apply_credit_note_sync_with_payments(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.apply_sale_sync_with_payments(uuid, uuid, uuid, jsonb) to authenticated;
grant execute on function public.apply_credit_note_sync_with_payments(uuid, uuid, uuid, jsonb) to authenticated;

-- Backfill, open registers only: closed registers keep the figures they were closed with.
insert into public.cash_movements (business_id, register_session_id, sale_id, type, amount_fils, reason, created_by, created_at)
select s.business_id, s.register_session_id, s.id, 'sale', p.amount_fils, s.invoice_number, s.created_by, s.created_at
from public.sales s
join public.sale_payments p on p.sale_id = s.id and p.method = 'cash'
join public.register_sessions rs on rs.id = s.register_session_id and rs.status = 'open'
where s.payment_method = 'split'
  and not exists (select 1 from public.cash_movements m where m.sale_id = s.id);

insert into public.cash_movements (business_id, register_session_id, type, amount_fils, reason, created_by, created_at)
select c.business_id, c.register_session_id, 'refund', -p.amount_fils, c.credit_note_number, c.created_by, c.created_at
from public.credit_notes c
join public.credit_note_payments p on p.credit_note_id = c.id and p.method = 'cash'
join public.register_sessions rs on rs.id = c.register_session_id and rs.status = 'open'
where c.payment_method = 'split'
  and not exists (
    select 1 from public.cash_movements m
    where m.register_session_id = c.register_session_id and m.type = 'refund' and m.reason = c.credit_note_number
  );
