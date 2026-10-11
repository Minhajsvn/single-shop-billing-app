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

  select d.id
  into active_device_id
  from public.devices d
  where d.business_id = p_business_id and d.status = 'active'
  order by d.created_at
  limit 1;
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
