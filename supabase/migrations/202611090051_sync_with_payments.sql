-- Stage 2B: sync a sale or refund together with its payment rows (spec 2026-11-09-stage-2b §4.5).
-- Each wrapper checks the payment list, calls the existing apply_*_sync unchanged, and inserts the rows. One function
-- call is one transaction, so a refused list or a failed insert leaves no document behind. A record without a list
-- (a till on an older app version) gets one row from its paymentMethod for its whole total.

-- The payment rows a record asks for: its list, or one row from its summary method. Checks every rule except the
-- total, which is compared with the saved document afterwards. Raises payments_mismatch.
create function public.payment_rows_from(p_record jsonb)
returns table (id uuid, method public.payment_method, amount_fils bigint, reference text)
language plpgsql immutable set search_path = public, extensions, pg_temp
as $$
declare
  summary text := p_record ->> 'paymentMethod';
  list jsonb := p_record -> 'payments';
  item jsonb;
  seen text[] := '{}';
  m text;
  amount bigint;
  ref text;
  uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if list is null or jsonb_typeof(list) = 'null' then
    if summary not in ('cash', 'card', 'transfer') then
      raise exception using errcode = 'P0001', message = 'payments_mismatch';
    end if;
    return query select gen_random_uuid(), summary::public.payment_method, (p_record ->> 'grossFils')::bigint, null::text;
    return;
  end if;

  if jsonb_typeof(list) <> 'array' or jsonb_array_length(list) not between 1 and 3 then
    raise exception using errcode = 'P0001', message = 'payments_mismatch';
  end if;
  for item in select value from jsonb_array_elements(list) loop
    m := item ->> 'method';
    if m not in ('cash', 'card', 'transfer') or m = any(seen)
       or jsonb_typeof(item -> 'amountFils') <> 'number' or (item ->> 'amountFils') !~ '^[0-9]+$'
       or coalesce(item ->> 'id', '') !~ uuid_re then
      raise exception using errcode = 'P0001', message = 'payments_mismatch';
    end if;
    amount := (item ->> 'amountFils')::bigint;
    ref := nullif(btrim(coalesce(item ->> 'reference', '')), '');
    if amount <= 0 or (ref is not null and (m <> 'transfer' or char_length(ref) > 60)) then
      raise exception using errcode = 'P0001', message = 'payments_mismatch';
    end if;
    seen := seen || m;
  end loop;

  if (array_length(seen, 1) = 1 and summary <> seen[1]) or (array_length(seen, 1) > 1 and summary <> 'split') then
    raise exception using errcode = 'P0001', message = 'payments_mismatch';
  end if;

  return query
  select (e ->> 'id')::uuid, (e ->> 'method')::public.payment_method, (e ->> 'amountFils')::bigint,
         nullif(btrim(coalesce(e ->> 'reference', '')), '')
  from jsonb_array_elements(list) e;
end
$$;

revoke execute on function public.payment_rows_from(jsonb) from public, anon, authenticated;

create function public.apply_sale_sync_with_payments(p_operation_id uuid, p_business_id uuid, p_entity_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  result jsonb;
  saved public.sales;
begin
  -- Check the list before anything is written; the base function checks who is calling.
  perform 1 from public.payment_rows_from(p_payload -> 'sale');
  result := public.apply_sale_sync(p_operation_id, p_business_id, p_entity_id, p_payload);

  select * into saved from public.sales where id = p_entity_id and business_id = p_business_id;
  if not found or exists (select 1 from public.sale_payments where sale_id = saved.id) then
    return result; -- refused by the base function's own rules, or a retry that already saved its rows
  end if;

  insert into public.sale_payments (id, business_id, sale_id, method, amount_fils, reference, created_at)
  select r.id, saved.business_id, saved.id, r.method, r.amount_fils, r.reference, saved.created_at
  from public.payment_rows_from(p_payload -> 'sale') r;

  if (select sum(amount_fils) from public.sale_payments where sale_id = saved.id) <> saved.gross_fils then
    raise exception using errcode = 'P0001', message = 'payments_mismatch';
  end if;
  return result;
end
$$;

create function public.apply_credit_note_sync_with_payments(p_operation_id uuid, p_business_id uuid, p_entity_id uuid, p_payload jsonb)
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
