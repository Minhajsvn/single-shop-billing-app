-- Stage 1B: explicit tills. Each device has a per-business till number, and sync work is booked to the device named in the payload.

alter table public.devices add column till_number smallint;

update public.devices d
set till_number = numbered.n
from (select id, row_number() over (partition by business_id order by created_at, id) as n from public.devices) numbered
where numbered.id = d.id;

alter table public.devices alter column till_number set not null;
alter table public.devices add constraint devices_till_number_positive check (till_number between 1 and 999);
alter table public.devices add constraint devices_business_till_unique unique (business_id, till_number);

create function public.assign_till_number()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.till_number is null then
    perform pg_advisory_xact_lock(hashtextextended(new.business_id::text || ':till_number', 0));
    new.till_number := coalesce((select max(till_number) from public.devices where business_id = new.business_id), 0) + 1;
  end if;
  return new;
end
$$;

create trigger assign_till_number before insert on public.devices for each row execute function public.assign_till_number();

create function public.sync_device_id(p_business_id uuid, p_payload jsonb)
returns uuid language plpgsql stable security definer set search_path = public
as $$
declare
  requested text := nullif(p_payload->>'deviceId', '');
  resolved uuid;
begin
  if requested is not null then
    select d.id into resolved from public.devices d
    where d.id::text = requested and d.business_id = p_business_id and d.status = 'active';
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

-- Part B: the five sync RPCs, copied verbatim from 202609130006-202609140009; only the device selection changes.

create or replace function public.apply_customer_sync(
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
  payload_hash text;
  customer_name text;
  customer_phone text;
  customer_email text;
  customer_address text;
  customer_trn text;
  customer_created_at timestamptz;
  customer_updated_at timestamptz;
begin
  if auth.uid() is null or not public.owns_business(p_business_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'customer_payload_must_be_an_object' using errcode = 'P0001';
  end if;

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

  if p_payload->>'id' <> p_entity_id::text then
    raise exception 'customer_id_mismatch' using errcode = 'P0001';
  end if;

  customer_name := nullif(btrim(p_payload->>'name'), '');
  customer_phone := nullif(btrim(p_payload->>'phone'), '');
  customer_email := nullif(btrim(p_payload->>'email'), '');
  customer_address := nullif(btrim(p_payload->>'address'), '');
  customer_trn := nullif(btrim(p_payload->>'trn'), '');

  if customer_name is null or char_length(customer_name) > 160 then
    raise exception 'invalid_customer_name' using errcode = 'P0001';
  end if;
  if customer_phone is null or char_length(customer_phone) > 40 then
    raise exception 'invalid_customer_phone' using errcode = 'P0001';
  end if;
  if customer_trn is not null and customer_trn !~ '^[0-9]{15}$' then
    raise exception 'invalid_customer_trn' using errcode = 'P0001';
  end if;

  customer_created_at := coalesce(nullif(p_payload->>'createdAt', '')::timestamptz, now());
  customer_updated_at := coalesce(nullif(p_payload->>'updatedAt', '')::timestamptz, now());

  if exists (
    select 1 from public.customers
    where id = p_entity_id and business_id <> p_business_id
  ) then
    raise exception 'customer_belongs_to_another_business' using errcode = 'P0001';
  end if;

  insert into public.customers (
    id, business_id, name, phone, email, address, trn, created_at, updated_at
  )
  values (
    p_entity_id, p_business_id, customer_name, customer_phone, customer_email,
    customer_address, customer_trn, customer_created_at, customer_updated_at
  )
  on conflict (id) do update
  set name = excluded.name,
      phone = excluded.phone,
      email = excluded.email,
      address = excluded.address,
      trn = excluded.trn,
      updated_at = excluded.updated_at
  where public.customers.business_id = p_business_id;

  insert into public.sync_operations (
    operation_id, business_id, device_id, entity_type, entity_id,
    payload_hash, status
  )
  values (
    p_operation_id,
    p_business_id,
    public.sync_device_id(p_business_id, p_payload),
    'customer',
    p_entity_id,
    payload_hash,
    'accepted'
  );

  insert into public.audit_events (
    business_id, actor_id, action, entity_type, entity_id, summary
  )
  values (
    p_business_id, auth.uid(), 'sync.accepted', 'customer', p_entity_id,
    jsonb_build_object('operationId', p_operation_id)
  );

  return jsonb_build_object('status', 'accepted', 'entityId', p_entity_id);
end;
$$;

revoke all on function public.apply_customer_sync(uuid, uuid, uuid, jsonb) from public;
grant execute on function public.apply_customer_sync(uuid, uuid, uuid, jsonb) to authenticated;

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
      business_id, device_id, business_date, status, opening_cash_fils, opened_by
    )
    values (
      p_business_id, active_device_id, business_date, 'open', opening_cash, auth.uid()
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
      unit_gross_fils, net_fils, vat_fils, gross_fils
    )
    values (
      sale_line_id, p_business_id, p_entity_id, resolved_product_id,
      line_record->>'name', nullif(line_record->>'sku', ''), line_quantity,
      line_unit_gross, line_net, line_vat, line_gross
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

create or replace function public.apply_register_sync(
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
  active_device_id uuid;
  register_id uuid;
  action_name text;
  amount_fils bigint;
  calculated_expected_cash_fils bigint;
  input_counted_cash_fils bigint;
  calculated_variance_fils bigint;
  payload_hash text;
begin
  if auth.uid() is null or not public.owns_business(p_business_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'register_payload_must_be_an_object' using errcode = 'P0001';
  end if;

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
    return jsonb_build_object('status', existing_operation.status::text, 'entityId', existing_operation.entity_id);
  end if;

  action_name := p_payload->>'action';
  if action_name not in ('open', 'adjustment', 'close') then
    raise exception 'invalid_register_action' using errcode = 'P0001';
  end if;

  select *
  into business_record
  from public.businesses
  where id = p_business_id;

  active_device_id := public.sync_device_id(p_business_id, p_payload);

  if active_device_id is null then
    raise exception 'no_active_device' using errcode = 'P0001';
  end if;

  if action_name = 'open' then
    if jsonb_typeof(p_payload->'register') <> 'object' then
      raise exception 'register_open_payload_missing_register' using errcode = 'P0001';
    end if;

    select rs.id
    into register_id
    from public.register_sessions rs
    where rs.business_id = p_business_id
      and rs.device_id = active_device_id
      and rs.status = 'open'
    order by rs.opened_at desc
    limit 1;

    if register_id is null then
      amount_fils := (p_payload #>> '{register,openingCashFils}')::bigint;
      if amount_fils < 0 then
        raise exception 'invalid_register_opening_cash' using errcode = 'P0001';
      end if;

      insert into public.register_sessions (
        id, business_id, device_id, business_date, status,
        opening_cash_fils, opened_by, opened_at
      )
      values (
        p_entity_id,
        p_business_id,
        active_device_id,
        ((p_payload #>> '{register,openedAt}')::timestamptz at time zone 'Asia/Dubai')::date,
        'open',
        amount_fils,
        auth.uid(),
        (p_payload #>> '{register,openedAt}')::timestamptz
      );
    end if;
  elsif action_name = 'adjustment' then
    select rs.id
    into register_id
    from public.register_sessions rs
    where rs.business_id = p_business_id
      and rs.device_id = active_device_id
      and rs.status = 'open'
    order by rs.opened_at desc
    limit 1;

    if register_id is null then
      if jsonb_typeof(p_payload->'register') <> 'object' then
        raise exception 'no_open_register' using errcode = 'P0001';
      end if;
      amount_fils := (p_payload #>> '{register,openingCashFils}')::bigint;
      insert into public.register_sessions (
        id, business_id, device_id, business_date, status,
        opening_cash_fils, opened_by, opened_at
      )
      values (
        gen_random_uuid(),
        p_business_id,
        active_device_id,
        ((p_payload #>> '{register,openedAt}')::timestamptz at time zone 'Asia/Dubai')::date,
        'open',
        amount_fils,
        auth.uid(),
        (p_payload #>> '{register,openedAt}')::timestamptz
      )
      returning id into register_id;
    end if;

    amount_fils := (p_payload #>> '{adjustment,amountFils}')::bigint;
    if amount_fils = 0 then
      raise exception 'invalid_cash_adjustment' using errcode = 'P0001';
    end if;

    insert into public.cash_movements (
      id, business_id, register_session_id, type, amount_fils,
      reason, created_by, created_at
    )
    values (
      (p_payload #>> '{adjustment,id}')::uuid,
      p_business_id,
      register_id,
      case when amount_fils > 0 then 'adjustment_in'::public.cash_movement_type else 'adjustment_out'::public.cash_movement_type end,
      amount_fils,
      btrim(p_payload #>> '{adjustment,reason}'),
      auth.uid(),
      (p_payload #>> '{adjustment,createdAt}')::timestamptz
    );
  else
    select rs.id
    into register_id
    from public.register_sessions rs
    where rs.business_id = p_business_id
      and rs.device_id = active_device_id
      and rs.status = 'open'
    order by rs.opened_at desc
    limit 1;

    if register_id is null then
      if jsonb_typeof(p_payload->'register') <> 'object' then
        raise exception 'no_open_register' using errcode = 'P0001';
      end if;
      amount_fils := (p_payload #>> '{register,openingCashFils}')::bigint;
      insert into public.register_sessions (
        id, business_id, device_id, business_date, status,
        opening_cash_fils, opened_by, opened_at
      )
      values (
        gen_random_uuid(),
        p_business_id,
        active_device_id,
        ((p_payload #>> '{register,openedAt}')::timestamptz at time zone 'Asia/Dubai')::date,
        'open',
        amount_fils,
        auth.uid(),
        (p_payload #>> '{register,openedAt}')::timestamptz
      )
      returning id into register_id;
    end if;

    input_counted_cash_fils := (p_payload #>> '{register,countedCashFils}')::bigint;
    calculated_expected_cash_fils := (
      select rs.opening_cash_fils + coalesce(sum(cm.amount_fils), 0)
      from public.register_sessions rs
      left join public.cash_movements cm on cm.register_session_id = rs.id
      where rs.id = register_id
      group by rs.id
    );
    calculated_variance_fils := input_counted_cash_fils - calculated_expected_cash_fils;

    if p_payload #>> '{register,expectedCashFils}' is not null
      and (p_payload #>> '{register,expectedCashFils}')::bigint <> calculated_expected_cash_fils
    then
      raise exception 'register_expected_cash_mismatch' using errcode = 'P0001';
    end if;
    if p_payload #>> '{register,varianceFils}' is not null
      and (p_payload #>> '{register,varianceFils}')::bigint <> calculated_variance_fils
    then
      raise exception 'register_variance_mismatch' using errcode = 'P0001';
    end if;

    update public.register_sessions
    set status = 'closed',
        expected_cash_fils = calculated_expected_cash_fils,
        counted_cash_fils = input_counted_cash_fils,
        variance_fils = calculated_variance_fils,
        closed_by = auth.uid(),
        closed_at = (p_payload #>> '{register,closedAt}')::timestamptz
    where id = register_id;
  end if;

  insert into public.sync_operations (
    operation_id, business_id, device_id, entity_type, entity_id,
    payload_hash, status
  )
  values (
    p_operation_id, p_business_id, active_device_id, 'register', p_entity_id,
    payload_hash, 'accepted'
  );

  insert into public.audit_events (
    business_id, actor_id, action, entity_type, entity_id, summary
  )
  values (
    p_business_id, auth.uid(), 'sync.accepted', 'register', p_entity_id,
    jsonb_build_object('operationId', p_operation_id, 'action', action_name)
  );

  return jsonb_build_object('status', 'accepted', 'entityId', p_entity_id);
end;
$$;

revoke all on function public.apply_register_sync(uuid, uuid, uuid, jsonb) from public;
grant execute on function public.apply_register_sync(uuid, uuid, uuid, jsonb) to authenticated;

create or replace function public.apply_credit_note_sync(
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
  sale_record public.sales%rowtype;
  sale_item_record public.sale_items%rowtype;
  line_record jsonb;
  note_payload jsonb;
  payload_hash text;
  active_device_id uuid;
  register_id uuid;
  sale_id uuid;
  sale_item_id uuid;
  note_line_id uuid;
  line_quantity integer;
  line_unit_gross bigint;
  line_net bigint;
  line_vat bigint;
  line_gross bigint;
  returned_quantity integer;
  calculated_net bigint := 0;
  calculated_vat bigint := 0;
  calculated_gross bigint := 0;
  note_net bigint;
  note_vat bigint;
  note_gross bigint;
  product_id uuid;
begin
  if auth.uid() is null or not public.owns_business(p_business_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) <> 'object' or jsonb_typeof(p_payload->'creditNote') <> 'object' then
    raise exception 'credit_note_payload_must_contain_credit_note' using errcode = 'P0001';
  end if;

  note_payload := p_payload->'creditNote';
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
    return jsonb_build_object('status', existing_operation.status::text, 'entityId', existing_operation.entity_id);
  end if;

  if note_payload->>'id' <> p_entity_id::text then
    raise exception 'credit_note_id_mismatch' using errcode = 'P0001';
  end if;

  sale_id := (note_payload->>'saleId')::uuid;
  select *
  into sale_record
  from public.sales
  where id = sale_id and business_id = p_business_id;

  if not found then
    raise exception 'original_sale_not_found' using errcode = 'P0001';
  end if;

  select *
  into business_record
  from public.businesses
  where id = p_business_id;

  note_net := (note_payload->>'netFils')::bigint;
  note_vat := (note_payload->>'vatFils')::bigint;
  note_gross := (note_payload->>'grossFils')::bigint;
  if note_net < 0 or note_vat < 0 or note_gross <= 0 or note_gross <> note_net + note_vat then
    raise exception 'invalid_credit_note_totals' using errcode = 'P0001';
  end if;

  active_device_id := public.sync_device_id(p_business_id, p_payload);
  if active_device_id is null then
    raise exception 'no_active_device' using errcode = 'P0001';
  end if;

  select rs.id
  into register_id
  from public.register_sessions rs
  where rs.business_id = p_business_id
    and rs.device_id = active_device_id
    and rs.status = 'open'
  order by rs.opened_at desc
  limit 1;
  if register_id is null then
    raise exception 'no_open_register' using errcode = 'P0001';
  end if;

  insert into public.credit_notes (
    id, business_id, device_id, register_session_id, sale_id,
    credit_note_number, operation_id, payment_method, customer_snapshot,
    supplier_snapshot, net_fils, vat_fils, gross_fils, created_by, created_at
  )
  values (
    p_entity_id, p_business_id, active_device_id, register_id, sale_id,
    note_payload->>'creditNoteNumber', p_operation_id,
    (note_payload->>'paymentMethod')::public.payment_method,
    sale_record.customer_snapshot,
    jsonb_build_object(
      'name', business_record.legal_name,
      'trn', business_record.trn,
      'address', business_record.address,
      'phone', business_record.phone
    ),
    note_net, note_vat, note_gross, auth.uid(),
    (note_payload->>'createdAt')::timestamptz
  );

  for line_record in
    select value from jsonb_array_elements(note_payload->'lines')
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
      raise exception 'invalid_credit_note_line' using errcode = 'P0001';
    end if;

    sale_item_id := (line_record->>'originalLineId')::uuid;
    select *
    into sale_item_record
    from public.sale_items si
    where si.id = sale_item_id
      and si.sale_id = sale_record.id
      and si.business_id = p_business_id;

    if not found then
      raise exception 'original_sale_line_not_found' using errcode = 'P0001';
    end if;

    select coalesce(sum(quantity), 0)
    into returned_quantity
    from public.credit_note_items cni
    where cni.business_id = p_business_id and cni.sale_item_id = sale_item_id;

    if returned_quantity + line_quantity > sale_item_record.quantity then
      raise exception 'credit_note_quantity_exceeds_sale' using errcode = 'P0001';
    end if;

    note_line_id := (line_record->>'id')::uuid;
    insert into public.credit_note_items (
      id, business_id, credit_note_id, sale_item_id, product_id,
      description, sku, quantity, unit_gross_fils, net_fils, vat_fils, gross_fils
    )
    values (
      note_line_id, p_business_id, p_entity_id, sale_item_id, sale_item_record.product_id,
      line_record->>'name', nullif(line_record->>'sku', ''), line_quantity,
      line_unit_gross, line_net, line_vat, line_gross
    );

    product_id := sale_item_record.product_id;
    if product_id is not null then
      update public.products
      set stock_quantity = stock_quantity + line_quantity,
          updated_at = now()
      where products.id = product_id and products.business_id = p_business_id;

      insert into public.stock_movements (
        business_id, product_id, type, quantity_delta, reason,
        source_id, created_by, created_at
      )
      values (
        p_business_id, product_id, 'return', line_quantity,
        note_payload->>'creditNoteNumber', p_entity_id, auth.uid(),
        (note_payload->>'createdAt')::timestamptz
      );
    end if;

    calculated_net := calculated_net + line_net;
    calculated_vat := calculated_vat + line_vat;
    calculated_gross := calculated_gross + line_gross;
  end loop;

  if calculated_net <> note_net or calculated_vat <> note_vat or calculated_gross <> note_gross then
    raise exception 'credit_note_total_mismatch' using errcode = 'P0001';
  end if;

  if note_payload->>'paymentMethod' = 'cash' then
    insert into public.cash_movements (
      business_id, register_session_id, type, amount_fils,
      reason, created_by, created_at
    )
    values (
      p_business_id, register_id, 'refund', -note_gross,
      note_payload->>'creditNoteNumber', auth.uid(),
      (note_payload->>'createdAt')::timestamptz
    );
  end if;

  insert into public.sync_operations (
    operation_id, business_id, device_id, entity_type, entity_id,
    payload_hash, status
  )
  values (
    p_operation_id, p_business_id, active_device_id, 'credit-note', p_entity_id,
    payload_hash, 'accepted'
  );

  insert into public.audit_events (
    business_id, actor_id, action, entity_type, entity_id, summary
  )
  values (
    p_business_id, auth.uid(), 'sync.accepted', 'credit-note', p_entity_id,
    jsonb_build_object('operationId', p_operation_id, 'creditNoteNumber', note_payload->>'creditNoteNumber')
  );

  return jsonb_build_object('status', 'accepted', 'entityId', p_entity_id);
end;
$$;

revoke all on function public.apply_credit_note_sync(uuid, uuid, uuid, jsonb) from public;
grant execute on function public.apply_credit_note_sync(uuid, uuid, uuid, jsonb) to authenticated;

create or replace function public.apply_stock_sync(
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
  movement_payload jsonb;
  product_payload jsonb;
  payload_hash text;
  active_device_id uuid;
  resolved_product_id uuid;
  movement_type public.stock_movement_type;
  movement_delta integer;
  movement_id uuid;
  product_id_text text;
begin
  if auth.uid() is null or not public.owns_business(p_business_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) <> 'object'
    or jsonb_typeof(p_payload->'movement') <> 'object'
    or jsonb_typeof(p_payload->'product') <> 'object'
  then
    raise exception 'stock_payload_must_contain_movement_and_product' using errcode = 'P0001';
  end if;

  movement_payload := p_payload->'movement';
  product_payload := p_payload->'product';
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
    return jsonb_build_object('status', existing_operation.status::text, 'entityId', existing_operation.entity_id);
  end if;

  movement_id := (movement_payload->>'id')::uuid;
  if movement_id <> p_entity_id then
    raise exception 'stock_movement_id_mismatch' using errcode = 'P0001';
  end if;

  movement_delta := (movement_payload->>'delta')::integer;
  if movement_delta = 0 then
    raise exception 'stock_movement_delta_must_not_be_zero' using errcode = 'P0001';
  end if;

  movement_type := case movement_payload->>'type'
    when 'opening' then 'opening'::public.stock_movement_type
    when 'receipt' then 'receipt'::public.stock_movement_type
    when 'correction-in' then 'correction_in'::public.stock_movement_type
    when 'correction-out' then 'correction_out'::public.stock_movement_type
    else null
  end;

  if movement_type is null then
    raise exception 'invalid_manual_stock_movement_type' using errcode = 'P0001';
  end if;
  if movement_type in ('opening'::public.stock_movement_type, 'receipt'::public.stock_movement_type, 'correction_in'::public.stock_movement_type)
    and movement_delta < 1
  then
    raise exception 'stock_in_movement_must_be_positive' using errcode = 'P0001';
  end if;
  if movement_type = 'correction_out'::public.stock_movement_type and movement_delta > -1 then
    raise exception 'stock_out_movement_must_be_negative' using errcode = 'P0001';
  end if;

  active_device_id := public.sync_device_id(p_business_id, p_payload);
  if active_device_id is null then
    raise exception 'no_active_device' using errcode = 'P0001';
  end if;

  product_id_text := nullif(product_payload->>'id', '');
  if coalesce(product_id_text, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select p.id
    into resolved_product_id
    from public.products p
    where p.id = product_id_text::uuid
      and p.business_id = p_business_id;

    if resolved_product_id is null and exists (
      select 1 from public.products p where p.id = product_id_text::uuid and p.business_id <> p_business_id
    ) then
      raise exception 'product_belongs_to_another_business' using errcode = 'P0001';
    end if;
  end if;

  if resolved_product_id is null then
    select p.id
    into resolved_product_id
    from public.products p
    where p.business_id = p_business_id
      and p.sku = product_payload->>'sku'
    limit 1;
  end if;

  if resolved_product_id is null then
    if movement_type <> 'opening'::public.stock_movement_type then
      raise exception 'hosted_product_not_found' using errcode = 'P0001';
    end if;

    if product_id_text is null
      or product_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then
      product_id_text := gen_random_uuid()::text;
    end if;

    insert into public.products (
      id, business_id, name, sku, barcode, price_fils,
      stock_quantity, low_stock_threshold, status
    )
    values (
      product_id_text::uuid,
      p_business_id,
      btrim(product_payload->>'name'),
      btrim(product_payload->>'sku'),
      nullif(btrim(product_payload->>'barcode'), ''),
      (product_payload->>'priceFils')::bigint,
      0,
      (product_payload->>'lowStockThreshold')::integer,
      case when (product_payload->>'active')::boolean then 'active'::public.product_status else 'inactive'::public.product_status end
    )
    returning id into resolved_product_id;
  end if;

  update public.products p
  set stock_quantity = p.stock_quantity + movement_delta,
      updated_at = now()
  where p.id = resolved_product_id
    and p.business_id = p_business_id
    and p.stock_quantity + movement_delta >= 0;

  if not found then
    raise exception 'insufficient_hosted_stock' using errcode = 'P0001';
  end if;

  insert into public.stock_movements (
    id, business_id, product_id, type, quantity_delta, reason,
    source_id, operation_id, created_by, created_at
  )
  values (
    movement_id,
    p_business_id,
    resolved_product_id,
    movement_type,
    movement_delta,
    btrim(movement_payload->>'reason'),
    movement_id,
    p_operation_id,
    auth.uid(),
    (movement_payload->>'createdAt')::timestamptz
  );

  insert into public.sync_operations (
    operation_id, business_id, device_id, entity_type, entity_id,
    payload_hash, status
  )
  values (
    p_operation_id, p_business_id, active_device_id, 'stock', p_entity_id,
    payload_hash, 'accepted'
  );

  insert into public.audit_events (
    business_id, actor_id, action, entity_type, entity_id, summary
  )
  values (
    p_business_id, auth.uid(), 'sync.accepted', 'stock', p_entity_id,
    jsonb_build_object('operationId', p_operation_id, 'movementType', movement_payload->>'type', 'delta', movement_delta)
  );

  return jsonb_build_object('status', 'accepted', 'entityId', p_entity_id);
end;
$$;

revoke all on function public.apply_stock_sync(uuid, uuid, uuid, jsonb) from public;
grant execute on function public.apply_stock_sync(uuid, uuid, uuid, jsonb) to authenticated;

-- Re-apply the 202610100001 hotfix, which create or replace resets.
alter function public.apply_customer_sync(uuid, uuid, uuid, jsonb) set search_path = public, extensions, pg_temp;
alter function public.apply_sale_sync(uuid, uuid, uuid, jsonb) set search_path = public, extensions, pg_temp;
alter function public.apply_register_sync(uuid, uuid, uuid, jsonb) set search_path = public, extensions, pg_temp;
alter function public.apply_credit_note_sync(uuid, uuid, uuid, jsonb) set search_path = public, extensions, pg_temp;
alter function public.apply_stock_sync(uuid, uuid, uuid, jsonb) set search_path = public, extensions, pg_temp;

-- Part C: entitlements fail closed without a signed-in member.
create or replace function public.business_entitlements(target_business_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null or not public.has_role(target_business_id, 'cashier') then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  return public.entitlements_internal(target_business_id, now());
end
$$;

-- Part D: the main branch mirrors business invoice settings.
create function public.mirror_business_to_main_branch()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if (new.address, new.invoice_prefix, new.receipt_footer) is distinct from (old.address, old.invoice_prefix, old.receipt_footer) then
    update public.branches
    set address = new.address, invoice_prefix = new.invoice_prefix, receipt_footer = new.receipt_footer
    where business_id = new.id and is_main;
  end if;
  return new;
end
$$;

create trigger mirror_business_to_main_branch after update on public.businesses for each row execute function public.mirror_business_to_main_branch();
