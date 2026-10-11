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

  select d.id
  into active_device_id
  from public.devices d
  where d.business_id = p_business_id and d.status = 'active'
  order by d.created_at
  limit 1;

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

  select d.id
  into active_device_id
  from public.devices d
  where d.business_id = p_business_id and d.status = 'active'
  order by d.created_at
  limit 1;
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
