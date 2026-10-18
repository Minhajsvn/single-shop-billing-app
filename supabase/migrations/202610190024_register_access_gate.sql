-- Stage 1F: read-only and paused tills are enforced when a register session is opened, never mid-shift.
-- A shift opened before the access end keeps selling and closing; a new shift after the end is refused.

-- Nothing in this file uses the new value at run time, so it may share the migration's transaction.
alter type public.device_status add value if not exists 'paused';

-- When the till was paused; a shift it opened before then may still arrive for 72 hours.
alter table public.devices add column paused_at timestamptz;

-- paused_at belongs to the paused state only: stamped on entry if missing, cleared on leaving it.
create function public.device_paused_at()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  if new.status::text = 'paused' then
    if tg_op = 'INSERT' or old.status::text <> 'paused' then
      new.paused_at := coalesce(new.paused_at, now());
    end if;
  else
    new.paused_at := null;
  end if;
  return new;
end
$$;

create trigger device_paused_at before insert or update of status on public.devices
for each row execute function public.device_paused_at();

-- One gate for every insert path: the explicit open, and the implicit sessions created by
-- adjustment, close and sale sync when the server has no open session for the till.
create function public.register_access_gate()
returns trigger language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  sub public.subscriptions;
  device public.devices;
  access_end timestamptz;
  opened timestamptz := coalesce(new.opened_at, now());
begin
  -- A paused till may still deliver a shift it opened before the pause, within 72 hours of the pause.
  select * into device from public.devices d where d.id = new.device_id;
  if device.status::text = 'paused'
     and not coalesce(opened < device.paused_at and now() <= device.paused_at + interval '72 hours', false) then
    raise exception using errcode = 'P0001', message = 'till_paused';
  end if;

  select * into sub from public.subscriptions where business_id = new.business_id;
  -- No subscription row means no access (entitlements report read_only too).
  access_end := case when found then public.access_ends_at(sub) else '-infinity'::timestamptz end;

  -- A shift opened before the end is accepted when it arrives within 72 hours of that end.
  if access_end is not null and now() > access_end
     and (opened >= access_end or now() > access_end + interval '72 hours') then
    raise exception using errcode = 'P0001', message = 'read_only';
  end if;
  return new;
end
$$;

revoke execute on function public.register_access_gate() from public, anon, authenticated;

create trigger register_access_gate before insert on public.register_sessions
for each row execute function public.register_access_gate();

-- A paused till may still sync the work of its running shift, so an explicitly named paused device is accepted.
-- The fallback (no deviceId in the payload) stays active-only.
create or replace function public.sync_device_id(p_business_id uuid, p_payload jsonb)
returns uuid language plpgsql stable security definer set search_path = public
as $$
declare
  requested text := nullif(p_payload->>'deviceId', '');
  resolved uuid;
begin
  if requested is not null then
    select d.id into resolved from public.devices d
    where d.id::text = requested and d.business_id = p_business_id and d.status in ('active', 'paused');
    if resolved is null then
      raise exception using errcode = 'P0001', message = 'sync_device_invalid';
    end if;
    return resolved;
  end if;
  select d.id into resolved from public.devices d
  where d.business_id = p_business_id and d.status = 'active'
  order by d.created_at, d.id
  limit 1;
  return resolved;
end
$$;

revoke execute on function public.sync_device_id(uuid, jsonb) from public, anon, authenticated;

-- Owner keeps one till active and pauses the business's other active tills (e.g. after moving to Starter).
-- Returns how many were paused.
create function public.choose_active_till(p_business_id uuid, p_keep_device_id uuid)
returns integer language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  paused_count integer;
begin
  if auth.uid() is null or not public.owns_business(p_business_id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  perform 1 from public.devices where business_id = p_business_id for update;
  if not exists (
    select 1 from public.devices
    where id = p_keep_device_id and business_id = p_business_id and status = 'active'
  ) then
    raise exception using errcode = 'P0001', message = 'till_not_found';
  end if;

  update public.devices set status = 'paused', paused_at = now()
  where business_id = p_business_id and status = 'active' and id <> p_keep_device_id;
  get diagnostics paused_count = row_count;
  return paused_count;
end
$$;

revoke execute on function public.choose_active_till(uuid, uuid) from public, anon;
grant execute on function public.choose_active_till(uuid, uuid) to authenticated;

-- apply_sale_sync copied verbatim from 202610150018; only the implicit session keeps the payload's real open time.
create or replace function public.apply_sale_sync(
  p_operation_id uuid,
  p_business_id uuid,
  p_entity_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing_operation public.sync_operations%rowtype;
  business_record public.businesses%rowtype;
  line_record jsonb;
  sale_payload jsonb;
  payload_hash text;
  active_device_id uuid;
  register_id uuid;
  sale_customer_id uuid;
  resolved_product_id uuid;
  sale_line_id uuid;
  line_quantity integer;
  line_unit_gross bigint;
  line_net bigint;
  line_vat bigint;
  line_gross bigint;
  sale_net bigint;
  sale_vat bigint;
  sale_gross bigint;
  opening_cash bigint;
  business_date date;
begin
  if auth.uid() is null or not public.owns_business(p_business_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if jsonb_typeof(p_payload) <> 'object' or jsonb_typeof(p_payload->'sale') <> 'object' then
    raise exception 'sale_payload_must_contain_sale' using errcode = 'P0001';
  end if;

  sale_payload := p_payload->'sale';
  payload_hash := encode(digest(p_payload::text, 'sha256'), 'hex');

  select *
  into existing_operation
  from public.sync_operations
  where operation_id = p_operation_id;

  if found then
    if existing_operation.payload_hash <> payload_hash
      or existing_operation.business_id <> p_business_id
      or existing_operation.entity_id <> p_entity_id
    then
      raise exception 'operation_payload_conflict' using errcode = 'P0001';
    end if;

    return jsonb_build_object(
      'status', existing_operation.status::text,
      'entityId', existing_operation.entity_id
    );
  end if;

  if sale_payload->>'id' <> p_entity_id::text then
    raise exception 'sale_id_mismatch' using errcode = 'P0001';
  end if;
  if sale_payload->>'status' <> 'completed' then
    raise exception 'invalid_sale_status' using errcode = 'P0001';
  end if;

  sale_net := (sale_payload->>'netFils')::bigint;
  sale_vat := (sale_payload->>'vatFils')::bigint;
  sale_gross := (sale_payload->>'grossFils')::bigint;
  if sale_net < 0 or sale_vat < 0 or sale_gross <= 0 or sale_gross <> sale_net + sale_vat then
    raise exception 'invalid_sale_totals' using errcode = 'P0001';
  end if;

  select *
  into business_record
  from public.businesses
  where id = p_business_id;

  active_device_id := public.sync_device_id(p_business_id, p_payload);

  if active_device_id is null then
    raise exception 'no_active_device' using errcode = 'P0001';
  end if;

  business_date := (sale_payload->>'supplyDate')::date;

  select rs.id
  into register_id
  from public.register_sessions rs
  where rs.business_id = p_business_id
    and rs.device_id = active_device_id
    and rs.status = 'open'
  order by rs.opened_at desc
  limit 1;

  if register_id is null then
    opening_cash := coalesce((p_payload #>> '{register,openingCashFils}')::bigint, 0);
    if opening_cash < 0 then
      raise exception 'invalid_register_opening_cash' using errcode = 'P0001';
    end if;

    insert into public.register_sessions (
      business_id, device_id, business_date, status, opening_cash_fils, opened_by, opened_at
    )
    values (
      p_business_id, active_device_id, business_date, 'open', opening_cash, auth.uid(),
      coalesce((p_payload #>> '{register,openedAt}')::timestamptz, now())
    )
    returning id into register_id;
  end if;

  if jsonb_typeof(sale_payload->'customer') = 'object' then
    select c.id
    into sale_customer_id
    from public.customers c
    where c.business_id = p_business_id
      and (
        (nullif(sale_payload->'customer'->>'trn', '') is not null and c.trn = nullif(sale_payload->'customer'->>'trn', ''))
        or (c.name = sale_payload->'customer'->>'name' and c.phone = sale_payload->'customer'->>'phone')
      )
    order by c.created_at
    limit 1;
  end if;

  insert into public.sales (
    id, business_id, device_id, register_session_id, invoice_number, operation_id,
    status, payment_method, supply_date, supplier_snapshot, customer_id,
    customer_snapshot, net_fils, vat_fils, gross_fils, created_by, created_at
  )
  values (
    p_entity_id, p_business_id, active_device_id, register_id,
    sale_payload->>'invoiceNumber', p_operation_id, 'completed',
    (sale_payload->>'paymentMethod')::public.payment_method,
    business_date,
    jsonb_build_object(
      'name', business_record.legal_name,
      'trn', business_record.trn,
      'address', business_record.address,
      'phone', business_record.phone
    ),
    sale_customer_id,
    nullif(sale_payload->'customer', 'null'::jsonb),
    sale_net,
    sale_vat,
    sale_gross,
    auth.uid(),
    (sale_payload->>'createdAt')::timestamptz
  );

  for line_record in
    select value from jsonb_array_elements(sale_payload->'lines')
  loop
    line_quantity := (line_record->>'quantity')::integer;
    line_unit_gross := (line_record->>'unitGrossFils')::bigint;
    line_net := (line_record->>'netFils')::bigint;
    line_vat := (line_record->>'vatFils')::bigint;
    line_gross := (line_record->>'grossFils')::bigint;

    if line_quantity <= 0 or line_unit_gross <= 0 or line_net < 0
      or line_vat < 0 or line_gross <= 0
      or line_gross <> line_net + line_vat
      or line_gross <> line_unit_gross * line_quantity
    then
      raise exception 'invalid_sale_line' using errcode = 'P0001';
    end if;

    sale_line_id := gen_random_uuid();
    if coalesce(line_record->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      sale_line_id := (line_record->>'id')::uuid;
    end if;

    resolved_product_id := null;
    if coalesce(line_record->>'productId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      resolved_product_id := (line_record->>'productId')::uuid;
    end if;
    if resolved_product_id is null and nullif(line_record->>'sku', '') is not null then
      select p.id
      into resolved_product_id
      from public.products p
      where p.business_id = p_business_id and p.sku = line_record->>'sku'
      limit 1;
    end if;
    if nullif(line_record->>'productId', '') is not null and resolved_product_id is null then
      raise exception 'sale_product_not_found' using errcode = 'P0001';
    end if;

    insert into public.sale_items (
      id, business_id, sale_id, product_id, description, sku, quantity,
      unit_gross_fils, net_fils, vat_fils, gross_fils, list_unit_gross_fils
    )
    values (
      sale_line_id, p_business_id, p_entity_id, resolved_product_id,
      line_record->>'name', nullif(line_record->>'sku', ''), line_quantity,
      line_unit_gross, line_net, line_vat, line_gross,
      nullif(line_record->>'listUnitGrossFils', '')::bigint
    );

    if resolved_product_id is not null then
      update public.products
      set stock_quantity = stock_quantity - line_quantity,
          updated_at = now()
      where id = resolved_product_id
        and business_id = p_business_id
        and stock_quantity >= line_quantity;

      if not found then
        raise exception 'insufficient_hosted_stock' using errcode = 'P0001';
      end if;

      insert into public.stock_movements (
        business_id, product_id, type, quantity_delta, reason,
        source_id, created_by
      )
      values (
        p_business_id, resolved_product_id, 'sale', -line_quantity,
        sale_payload->>'invoiceNumber', p_entity_id, auth.uid()
      );
    end if;
  end loop;

  if sale_payload->>'paymentMethod' = 'cash' then
    insert into public.cash_movements (
      business_id, register_session_id, sale_id, type, amount_fils,
      reason, created_by, created_at
    )
    values (
      p_business_id, register_id, p_entity_id, 'sale', sale_gross,
      sale_payload->>'invoiceNumber', auth.uid(), (sale_payload->>'createdAt')::timestamptz
    );
  end if;

  insert into public.sync_operations (
    operation_id, business_id, device_id, entity_type, entity_id,
    payload_hash, status
  )
  values (
    p_operation_id, p_business_id, active_device_id, 'sale', p_entity_id,
    payload_hash, 'accepted'
  );

  insert into public.audit_events (
    business_id, actor_id, action, entity_type, entity_id, summary
  )
  values (
    p_business_id, auth.uid(), 'sync.accepted', 'sale', p_entity_id,
    jsonb_build_object('operationId', p_operation_id, 'invoiceNumber', sale_payload->>'invoiceNumber')
  );

  return jsonb_build_object('status', 'accepted', 'entityId', p_entity_id);
end;
$$;

revoke all on function public.apply_sale_sync(uuid, uuid, uuid, jsonb) from public;
grant execute on function public.apply_sale_sync(uuid, uuid, uuid, jsonb) to authenticated;

-- create or replace resets search_path; keep the 202610100001 hotfix (pgcrypto lives in schema extensions).
alter function public.apply_sale_sync(uuid, uuid, uuid, jsonb) set search_path = public, extensions, pg_temp;
