-- Stage 1C: per-item discounts. Store each discounted line's list price so tax invoices can show the discount.

alter table public.sale_items add column list_unit_gross_fils bigint;
alter table public.sale_items add constraint sale_items_list_price_not_below_charge check (list_unit_gross_fils is null or list_unit_gross_fils >= unit_gross_fils);

-- apply_sale_sync copied verbatim from 202610130016; only the sale_items insert gains list_unit_gross_fils.
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
