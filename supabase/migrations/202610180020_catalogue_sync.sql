-- Stage 1D: catalogue sync.
-- 1. Many products may have no barcode (blank barcodes were "not distinct", so only one was allowed).
-- 2. apply_product_sync: products are created and edited through their own sync operation.
-- 3. apply_stock_sync: import counts (absolute stock), and stock operations without a product copy.

alter table public.products drop constraint if exists products_business_id_barcode_key;
drop index if exists public.products_business_barcode_idx;
create unique index products_business_barcode_unique on public.products (business_id, barcode) where barcode is not null;

create or replace function public.apply_product_sync(
  p_operation_id uuid,
  p_business_id uuid,
  p_entity_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  existing_operation public.sync_operations%rowtype;
  product_payload jsonb;
  payload_hash text;
  active_device_id uuid;
  target_id uuid;
  product_sku text;
  product_barcode text;
  violated text;
begin
  if auth.uid() is null or not public.owns_business(p_business_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) <> 'object' or jsonb_typeof(p_payload->'product') <> 'object' then
    raise exception 'product_payload_must_contain_product' using errcode = 'P0001';
  end if;

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

  if coalesce(product_payload->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or (product_payload->>'id')::uuid <> p_entity_id
  then
    raise exception 'product_id_mismatch' using errcode = 'P0001';
  end if;
  target_id := p_entity_id;

  if exists (select 1 from public.products p where p.id = target_id and p.business_id <> p_business_id) then
    raise exception 'product_belongs_to_another_business' using errcode = 'P0001';
  end if;

  active_device_id := public.sync_device_id(p_business_id, p_payload);
  if active_device_id is null then
    raise exception 'no_active_device' using errcode = 'P0001';
  end if;

  product_sku := btrim(product_payload->>'sku');
  product_barcode := nullif(btrim(coalesce(product_payload->>'barcode', '')), '');

  -- The till compares SKUs ignoring case; refuse here too, with a name the till can explain.
  if exists (select 1 from public.products p where p.business_id = p_business_id and p.id <> target_id and lower(p.sku) = lower(product_sku)) then
    raise exception 'product_sku_taken' using errcode = 'P0001';
  end if;
  if product_barcode is not null and exists (
    select 1 from public.products p where p.business_id = p_business_id and p.id <> target_id and p.barcode = product_barcode
  ) then
    raise exception 'product_barcode_taken' using errcode = 'P0001';
  end if;

  begin
    insert into public.products (
      id, business_id, name, sku, barcode, price_fils,
      stock_quantity, low_stock_threshold, status, tax_category
    )
    values (
      target_id,
      p_business_id,
      btrim(product_payload->>'name'),
      product_sku,
      product_barcode,
      (product_payload->>'priceFils')::bigint,
      0,
      (product_payload->>'lowStockThreshold')::integer,
      case when (product_payload->>'active')::boolean then 'active'::public.product_status else 'inactive'::public.product_status end,
      coalesce(nullif(product_payload->>'taxCategory', ''), 'standard')::public.tax_category
    )
    on conflict (id) do update
    set name = excluded.name,
        sku = excluded.sku,
        barcode = excluded.barcode,
        price_fils = excluded.price_fils,
        low_stock_threshold = excluded.low_stock_threshold,
        status = excluded.status,
        tax_category = excluded.tax_category,
        updated_at = now();
  exception when unique_violation then
    -- A concurrent write won the race after the checks above.
    get stacked diagnostics violated = constraint_name;
    if violated = 'products_business_barcode_unique' then
      raise exception 'product_barcode_taken' using errcode = 'P0001';
    elsif violated = 'products_business_id_sku_key' then
      raise exception 'product_sku_taken' using errcode = 'P0001';
    end if;
    raise;
  end;

  insert into public.sync_operations (
    operation_id, business_id, device_id, entity_type, entity_id,
    payload_hash, status
  )
  values (
    p_operation_id, p_business_id, active_device_id, 'product', p_entity_id,
    payload_hash, 'accepted'
  );

  insert into public.audit_events (
    business_id, actor_id, action, entity_type, entity_id, summary
  )
  values (
    p_business_id, auth.uid(), 'sync.accepted', 'product', p_entity_id,
    jsonb_build_object('operationId', p_operation_id, 'sku', product_sku)
  );

  return jsonb_build_object('status', 'accepted', 'entityId', p_entity_id);
end;
$$;

revoke all on function public.apply_product_sync(uuid, uuid, uuid, jsonb) from public;
grant execute on function public.apply_product_sync(uuid, uuid, uuid, jsonb) to authenticated;

-- apply_stock_sync: copied from 202610130016 with the 1D changes marked.
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
  current_stock integer;
begin
  if auth.uid() is null or not public.owns_business(p_business_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) <> 'object'
    or jsonb_typeof(p_payload->'movement') <> 'object'
    or coalesce(jsonb_typeof(p_payload->'product'), 'null') not in ('object', 'null')
  then
    raise exception 'stock_payload_must_contain_movement_and_product' using errcode = 'P0001';
  end if;

  movement_payload := p_payload->'movement';
  -- 1D: the product copy is optional; new clients send product changes as their own operation.
  product_payload := case when jsonb_typeof(p_payload->'product') = 'object' then p_payload->'product' end;
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
    when 'import-count' then 'import_count'::public.stock_movement_type
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

  product_id_text := coalesce(nullif(product_payload->>'id', ''), nullif(movement_payload->>'productId', ''));
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
    if movement_type <> 'opening'::public.stock_movement_type or product_payload is null then
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

  -- 1D: an import count carries the counted stock; the difference is taken against the server's stock,
  -- so sales from other tills (or not yet synced here) cannot push the count off.
  if movement_type = 'import_count'::public.stock_movement_type then
    if coalesce(p_payload->>'countedStock', '') !~ '^[0-9]+$' then
      raise exception 'import_count_requires_counted_stock' using errcode = 'P0001';
    end if;
    select p.stock_quantity
    into current_stock
    from public.products p
    where p.id = resolved_product_id
    for update;
    movement_delta := (p_payload->>'countedStock')::integer - current_stock;
  end if;

  if movement_delta <> 0 then
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
  end if;

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
alter function public.apply_stock_sync(uuid, uuid, uuid, jsonb) set search_path = public, extensions, pg_temp;
alter function public.apply_product_sync(uuid, uuid, uuid, jsonb) set search_path = public, extensions, pg_temp;
