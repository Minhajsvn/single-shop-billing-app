-- Stage 2F (spec docs/superpowers/specs/2026-11-13-stage-2f-weighed-items-design.md §4): weighed items and scale labels.
-- A weighed product keeps price and cost per kg and stock in grams. A weighed sale line is quantity 1 at its total
-- price with weight_grams; stock moves by those grams. Safe before the app deploy: no product is sold by weight until
-- the new app switches one on, and older tills send no weightGrams.

alter table public.products
  add column sold_by_weight boolean not null default false,
  add column scale_code integer check (scale_code between 1 and 999999);
create unique index products_business_scale_code_unique on public.products (business_id, scale_code) where scale_code is not null;

alter table public.sale_items add column weight_grams integer check (weight_grams between 1 and 100000);
alter table public.credit_note_items add column weight_grams integer check (weight_grams between 1 and 100000);

-- 2C hid cost columns with column grants; the new columns are granted explicitly.
grant select (sold_by_weight, scale_code) on public.products to authenticated;
grant select (weight_grams) on public.sale_items to authenticated;
grant select (weight_grams) on public.credit_note_items to authenticated;

-- Deliveries: for a weighed product the line's quantity is grams and its cost is per kg (by_weight records which rule).
alter table public.purchase_receipt_lines add column by_weight boolean not null default false;
alter table public.purchase_receipt_lines drop constraint purchase_receipt_lines_quantity_check;
alter table public.purchase_receipt_lines drop constraint purchase_receipt_lines_check;
alter table public.purchase_receipt_lines add constraint purchase_receipt_lines_quantity_rule check (
  (not by_weight and quantity between 1 and 100000 and line_net_fils = quantity * unit_cost_fils)
  or (by_weight and quantity between 1 and 100000000 and line_net_fils = round(quantity::numeric * unit_cost_fils / 1000.0))
);

-- The shop's scale label layout: prefixes (two digits, 20-29), item-code length (4-6), and whether the value digits
-- are the weight in grams or the price in fils.
create function public.scale_label_valid(p_settings jsonb)
returns boolean language sql immutable set search_path = public, pg_temp
as $$
  select jsonb_typeof(p_settings) = 'object'
    and (select count(*) from jsonb_object_keys(p_settings)) = 3
    and jsonb_typeof(p_settings->'prefixes') = 'array'
    and jsonb_array_length(p_settings->'prefixes') between 1 and 10
    and not exists (select 1 from jsonb_array_elements(p_settings->'prefixes') e
                    where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ '^2[0-9]$')
    and (select count(distinct e #>> '{}') from jsonb_array_elements(p_settings->'prefixes') e) = jsonb_array_length(p_settings->'prefixes')
    and jsonb_typeof(p_settings->'codeLength') = 'number'
    and (p_settings->>'codeLength') in ('4', '5', '6')
    and coalesce(p_settings->>'value', '') in ('weight', 'price')
$$;

alter table public.businesses
  add column scale_label jsonb not null default '{"prefixes":["21","22"],"codeLength":5,"value":"weight"}'::jsonb
  check (public.scale_label_valid(scale_label));

-- Owners can update their business row directly; the scale label changes only through shop_set_scale_label
-- (which checks the plan), so a direct update of it is refused.
create function public.guard_scale_label()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  if new.scale_label is distinct from old.scale_label and coalesce(current_setting('billo.scale_label_write', true), '') <> 'on' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger guard_scale_label before update of scale_label on public.businesses for each row execute function public.guard_scale_label();

create function public.shop_set_scale_label(p_business_id uuid, p_settings jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  before jsonb;
begin
  perform public.staff_require_owner(p_business_id);
  if not coalesce(public.entitlements_internal(p_business_id) -> 'features' ? 'weighed_items', false) then
    raise exception 'feature_not_in_plan' using errcode = 'P0001';
  end if;
  if not public.scale_label_valid(p_settings) then
    raise exception 'invalid_scale_label' using errcode = 'P0001';
  end if;
  select scale_label into before from public.businesses where id = p_business_id for update;
  perform set_config('billo.scale_label_write', 'on', true);
  update public.businesses set scale_label = p_settings, updated_at = now() where id = p_business_id;
  perform set_config('billo.scale_label_write', '', true);
  insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, summary)
  values (p_business_id, auth.uid(), 'business.scale_label', 'business', p_business_id,
          jsonb_build_object('before', before, 'after', p_settings));
  return p_settings;
end
$$;

revoke all on function public.shop_set_scale_label(uuid, jsonb) from public, anon;
grant execute on function public.shop_set_scale_label(uuid, jsonb) to authenticated;

-- Refund by invoice number (202610210029, 202610220032): the sale's items now carry weight_grams, so a weighed line
-- fetched from another till shows its weight. Patched in place like 202610220032; the anchor must appear once.
do $$
declare
  def text;
  anchor constant text := E'''gross_fils'', i.gross_fils\n      )';
begin
  select pg_get_functiondef('public.find_sale_by_invoice(uuid, text)'::regprocedure) into def;
  if (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'expected exactly one sale item gross in find_sale_by_invoice';
  end if;
  execute replace(def, anchor, E'''gross_fils'', i.gross_fils,\n        ''weight_grams'', i.weight_grams\n      )');
end
$$;

-- apply_sale_sync: the body of 202610190024_register_access_gate.sql as patched by 202610210029; Stage 2F adds the weightGrams rule and moves
-- stock by grams for weighed lines.
create or replace function public.apply_sale_sync(
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
  line_grams integer;
  product_weighed boolean;
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
  if auth.uid() is null or not public.has_role(p_business_id, 'cashier') then
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

    -- Stage 2F: a line of a product sold by weight is one line of 1 with its grams; no other line has grams.
    line_grams := null;
    if coalesce(line_record->>'weightGrams', '') <> '' then
      if (line_record->>'weightGrams') !~ '^\d{1,7}$' then
        raise exception 'weight_mismatch' using errcode = 'P0001';
      end if;
      line_grams := (line_record->>'weightGrams')::integer;
    end if;
    product_weighed := false;
    if resolved_product_id is not null then
      select coalesce(p.sold_by_weight, false) into product_weighed
      from public.products p where p.id = resolved_product_id and p.business_id = p_business_id;
      product_weighed := coalesce(product_weighed, false);
    end if;
    if (product_weighed and (line_grams is null or line_grams not between 1 and 100000 or line_quantity <> 1))
       or (not product_weighed and line_grams is not null) then
      raise exception 'weight_mismatch' using errcode = 'P0001';
    end if;

    insert into public.sale_items (
      id, business_id, sale_id, product_id, description, sku, quantity,
      unit_gross_fils, net_fils, vat_fils, gross_fils, list_unit_gross_fils, weight_grams
    )
    values (
      sale_line_id, p_business_id, p_entity_id, resolved_product_id,
      line_record->>'name', nullif(line_record->>'sku', ''), line_quantity,
      line_unit_gross, line_net, line_vat, line_gross,
      nullif(line_record->>'listUnitGrossFils', '')::bigint, line_grams
    );

    if resolved_product_id is not null then
      update public.products
      set stock_quantity = stock_quantity - coalesce(line_grams, line_quantity),
          updated_at = now()
      where id = resolved_product_id
        and business_id = p_business_id
        and stock_quantity >= coalesce(line_grams, line_quantity);

      if not found then
        raise exception 'insufficient_hosted_stock' using errcode = 'P0001';
      end if;

      insert into public.stock_movements (
        business_id, product_id, type, quantity_delta, reason,
        source_id, created_by
      )
      values (
        p_business_id, resolved_product_id, 'sale', -coalesce(line_grams, line_quantity),
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

-- apply_credit_note_sync: the body of 202610130016_tills_and_sync_device.sql as patched by 202610210029 and 202610220032; Stage 2F copies the sale line's grams
-- and puts them back.
create or replace function public.apply_credit_note_sync(
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
  line_grams integer;
  line_restock boolean;
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
  if auth.uid() is null or not public.has_role(p_business_id, 'cashier') then
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
      and si.business_id = p_business_id
    for update;

    if not found then
      raise exception 'original_sale_line_not_found' using errcode = 'P0001';
    end if;

    select coalesce(sum(quantity), 0)
    into returned_quantity
    from public.credit_note_items cni
    where cni.business_id = p_business_id and cni.sale_item_id = (line_record->>'originalLineId')::uuid;

    if returned_quantity + line_quantity > sale_item_record.quantity then
      raise exception 'credit_note_quantity_exceeds_sale' using errcode = 'P0001';
    end if;

    -- Stage 2F: a weighed sale line is returned whole and puts its grams back. Stock moves only when the line and the
    -- product still agree on how it is sold (a product switched since the sale is refunded without restocking).
    line_grams := sale_item_record.weight_grams;
    if line_grams is not null and line_quantity <> 1 then
      raise exception 'weight_mismatch' using errcode = 'P0001';
    end if;
    line_restock := true;
    if sale_item_record.product_id is not null then
      select coalesce(p.sold_by_weight, false) = (line_grams is not null) into line_restock
      from public.products p where p.id = sale_item_record.product_id;
      line_restock := coalesce(line_restock, false);
    end if;

    note_line_id := (line_record->>'id')::uuid;
    insert into public.credit_note_items (
      id, business_id, credit_note_id, sale_item_id, product_id,
      description, sku, quantity, unit_gross_fils, net_fils, vat_fils, gross_fils, weight_grams
    )
    values (
      note_line_id, p_business_id, p_entity_id, sale_item_id, sale_item_record.product_id,
      line_record->>'name', nullif(line_record->>'sku', ''), line_quantity,
      line_unit_gross, line_net, line_vat, line_gross, line_grams
    );

    product_id := sale_item_record.product_id;
    if product_id is not null and line_restock then
      update public.products
      set stock_quantity = stock_quantity + coalesce(line_grams, line_quantity),
          updated_at = now()
      where products.id = product_id and products.business_id = p_business_id;

      insert into public.stock_movements (
        business_id, product_id, type, quantity_delta, reason,
        source_id, created_by, created_at
      )
      values (
        p_business_id, product_id, 'return', coalesce(line_grams, line_quantity),
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

-- apply_product_sync: the body of 202611100053_categories.sql; Stage 2F adds soldByWeight and scaleCode.
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
  has_category boolean;
  new_category uuid;
  has_scale boolean;
  new_scale integer;
  old_weighed boolean;
  old_stock integer;
  new_weighed boolean;
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

  -- Stage 2C: the category, when the till sent one.
  has_category := product_payload ? 'categoryId';
  if has_category and jsonb_typeof(product_payload->'categoryId') <> 'null' then
    if coalesce(product_payload->>'categoryId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not exists (select 1 from public.product_categories c where c.id = (product_payload->>'categoryId')::uuid and c.business_id = p_business_id) then
      raise exception 'category_not_found' using errcode = 'P0001';
    end if;
    new_category := (product_payload->>'categoryId')::uuid;
  end if;

  -- Stage 2F: soldByWeight (absent keeps it) and scaleCode (absent keeps it; null clears it).
  has_scale := product_payload ? 'scaleCode';
  if has_scale and jsonb_typeof(product_payload->'scaleCode') <> 'null' then
    if jsonb_typeof(product_payload->'scaleCode') <> 'number' or (product_payload->>'scaleCode') !~ '^\d{1,6}$'
       or (product_payload->>'scaleCode')::integer < 1 then
      raise exception 'invalid_scale_code' using errcode = 'P0001';
    end if;
    new_scale := (product_payload->>'scaleCode')::integer;
    if exists (select 1 from public.products p where p.business_id = p_business_id and p.id <> target_id and p.scale_code = new_scale) then
      raise exception 'scale_code_taken' using errcode = 'P0001';
    end if;
  end if;
  select p.sold_by_weight, p.stock_quantity into old_weighed, old_stock from public.products p where p.id = target_id;
  new_weighed := coalesce(old_weighed, false);
  if jsonb_typeof(product_payload->'soldByWeight') = 'boolean' then
    new_weighed := (product_payload->>'soldByWeight')::boolean;
  end if;
  if new_weighed <> coalesce(old_weighed, false) then
    if not coalesce(public.entitlements_internal(p_business_id) -> 'features' ? 'weighed_items', false) then
      raise exception 'feature_not_in_plan' using errcode = 'P0001';
    end if;
    if coalesce(old_stock, 0) <> 0 then
      raise exception 'weight_switch_needs_zero_stock' using errcode = 'P0001';
    end if;
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
    -- Update first, insert only when new: an upsert fires the INSERT plan-limit trigger even when it ends up
    -- updating, which would refuse every edit once a shop is at its product limit. (Re-activating an archived
    -- product still goes through the trigger's "update of status" check.)
    update public.products p
    set name = btrim(product_payload->>'name'),
        sku = product_sku,
        barcode = product_barcode,
        price_fils = (product_payload->>'priceFils')::bigint,
        low_stock_threshold = (product_payload->>'lowStockThreshold')::integer,
        status = case when (product_payload->>'active')::boolean then 'active'::public.product_status else 'inactive'::public.product_status end,
        tax_category = coalesce(nullif(product_payload->>'taxCategory', ''), 'standard')::public.tax_category,
        category_id = case when has_category then new_category else p.category_id end,
        sold_by_weight = new_weighed,
        scale_code = case when has_scale then new_scale else p.scale_code end,
        updated_at = now()
    where p.id = target_id
      and p.business_id = p_business_id;

    if not found then
      insert into public.products (
        id, business_id, name, sku, barcode, price_fils,
        stock_quantity, low_stock_threshold, status, tax_category, category_id, sold_by_weight, scale_code
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
        coalesce(nullif(product_payload->>'taxCategory', ''), 'standard')::public.tax_category,
        new_category,
        new_weighed,
        new_scale
      );
    end if;
  exception when unique_violation then
    -- A concurrent write won the race after the checks above.
    get stacked diagnostics violated = constraint_name;
    if violated = 'products_business_barcode_unique' then
      raise exception 'product_barcode_taken' using errcode = 'P0001';
    elsif violated = 'products_business_scale_code_unique' then
      raise exception 'scale_code_taken' using errcode = 'P0001';
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

-- The sale wrapper (latest 202611120059): unchanged except the cost stamp, which is per gram for weighed lines.
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

  -- Stage 2C: this call saved the sale, so stamp each product line with the product's cost now. Stage 2F: a weighed
  -- line's cost is the per-kg cost for its grams.
  update public.sale_items i set unit_cost_fils = case when i.weight_grams is null then p.cost_fils else round(p.cost_fils * i.weight_grams / 1000.0)::bigint end
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

-- record_purchase_receipt: the body of 202611110058_purchase_receipts.sql; Stage 2F takes grams and a per-kg cost for
-- weighed products.
create or replace function public.record_purchase_receipt(p_business_id uuid, p_receipt jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  receipt_id uuid;
  supplier public.suppliers;
  invoice text := nullif(btrim(coalesce(p_receipt->>'supplierInvoice', '')), '');
  note_text text := nullif(btrim(coalesce(p_receipt->>'note', '')), '');
  inv_date date;
  vat bigint;
  net bigint := 0;
  line jsonb;
  product public.products;
  qty integer;
  unit bigint;
  base integer;
  new_cost bigint;
  line_net bigint;
  earlier date;
begin
  perform public.purchasing_check(p_business_id);

  -- Shape first: every field, every line.
  if jsonb_typeof(p_receipt) <> 'object' or coalesce(p_receipt->>'id', '') !~* uuid_re or coalesce(p_receipt->>'supplierId', '') !~* uuid_re
     or jsonb_typeof(p_receipt->'lines') <> 'array' or jsonb_array_length(p_receipt->'lines') not between 1 and 200
     or coalesce(p_receipt->>'invoiceDate', '') !~ '^\d{4}-\d{2}-\d{2}$'
     or jsonb_typeof(p_receipt->'vatFils') <> 'number' or (p_receipt->>'vatFils') !~ '^\d+$'
     or char_length(coalesce(invoice, '')) > 40 or char_length(coalesce(note_text, '')) > 300 then
    raise exception 'invalid_receipt' using errcode = 'P0001';
  end if;
  for line in select value from jsonb_array_elements(p_receipt->'lines') loop
    if coalesce(line->>'productId', '') !~* uuid_re
       or jsonb_typeof(line->'quantity') <> 'number' or (line->>'quantity') !~ '^\d+$' or (line->>'quantity')::bigint not between 1 and 100000000
       or jsonb_typeof(line->'unitCostFils') <> 'number' or (line->>'unitCostFils') !~ '^\d+$' or (line->>'unitCostFils')::bigint > 100000000 then
      raise exception 'invalid_receipt' using errcode = 'P0001';
    end if;
  end loop;
  if (select count(distinct value->>'productId') from jsonb_array_elements(p_receipt->'lines')) <> jsonb_array_length(p_receipt->'lines') then
    raise exception 'duplicate_line' using errcode = 'P0001';
  end if;
  begin
    inv_date := (p_receipt->>'invoiceDate')::date;
  exception when others then
    raise exception 'invalid_receipt' using errcode = 'P0001';
  end;
  receipt_id := (p_receipt->>'id')::uuid;
  vat := (p_receipt->>'vatFils')::bigint;

  -- A retry returns what was saved; an id from another shop is refused.
  if exists (select 1 from public.purchase_receipts r where r.id = receipt_id) then
    if exists (select 1 from public.purchase_receipts r where r.id = receipt_id and r.business_id = p_business_id) then
      return public.purchase_receipt_get(p_business_id, receipt_id);
    end if;
    raise exception 'invalid_receipt' using errcode = 'P0001';
  end if;

  select * into supplier from public.suppliers s
  where s.id = (p_receipt->>'supplierId')::uuid and s.business_id = p_business_id and s.archived_at is null;
  if not found then
    raise exception 'supplier_not_found' using errcode = 'P0001';
  end if;

  for line in select value from jsonb_array_elements(p_receipt->'lines') loop
    select * into product from public.products p where p.id = (line->>'productId')::uuid and p.business_id = p_business_id;
    if not found then
      raise exception 'product_not_found' using errcode = 'P0001';
    end if;
    if product.status <> 'active' then
      raise exception using errcode = 'P0001', message = 'product_archived', detail = product.name;
    end if;
    -- Stage 2F: a weighed product's quantity is grams and its cost is per kg.
    if not product.sold_by_weight and (line->>'quantity')::bigint > 100000 then
      raise exception 'invalid_receipt' using errcode = 'P0001';
    end if;
    net := net + case when product.sold_by_weight then round((line->>'quantity')::bigint * (line->>'unitCostFils')::bigint / 1000.0)::bigint
                      else (line->>'quantity')::bigint * (line->>'unitCostFils')::bigint end;
  end loop;
  if vat > net then
    raise exception 'invalid_vat' using errcode = 'P0001';
  end if;

  if invoice is not null then
    select r.invoice_date into earlier from public.purchase_receipts r
    where r.business_id = p_business_id and r.supplier_id = supplier.id and lower(r.supplier_invoice) = lower(invoice) and r.voided_at is null;
    if found then
      raise exception using errcode = 'P0001', message = 'duplicate_supplier_invoice', detail = earlier::text;
    end if;
  end if;

  begin
    insert into public.purchase_receipts (id, business_id, supplier_id, supplier_invoice, invoice_date, net_fils, vat_fils, gross_fils, note, received_by)
    values (receipt_id, p_business_id, supplier.id, invoice, inv_date, net, vat, net + vat, note_text, auth.uid());
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'duplicate_supplier_invoice', detail = inv_date::text;
  end;

  -- Lines in product-id order, each product locked while its stock and cost change.
  for line in select value from jsonb_array_elements(p_receipt->'lines') order by value->>'productId' loop
    select * into product from public.products p where p.id = (line->>'productId')::uuid for update;
    qty := (line->>'quantity')::integer;
    unit := (line->>'unitCostFils')::bigint;
    base := greatest(product.stock_quantity, 0);
    line_net := case when product.sold_by_weight then round(qty::numeric * unit / 1000.0)::bigint else qty * unit end;
    new_cost := round((base::numeric * coalesce(product.cost_fils, unit) + qty::numeric * unit) / (base + qty));

    update public.products set stock_quantity = stock_quantity + qty, cost_fils = new_cost, updated_at = now() where id = product.id;
    insert into public.stock_movements (business_id, product_id, type, quantity_delta, reason, source_id, created_by)
    values (p_business_id, product.id, 'receipt', qty,
            left('Delivery · ' || supplier.name || coalesce(' · ' || invoice, ''), 300), receipt_id, auth.uid());
    insert into public.purchase_receipt_lines (receipt_id, business_id, product_id, quantity, unit_cost_fils, line_net_fils, cost_before_fils, cost_after_fils, by_weight)
    values (receipt_id, p_business_id, product.id, qty, unit, line_net, product.cost_fils, new_cost, product.sold_by_weight);
    if product.cost_fils is distinct from new_cost then
      insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, summary)
      values (p_business_id, auth.uid(), 'product.cost', 'product', product.id,
              jsonb_build_object('before', product.cost_fils, 'after', new_cost, 'receiptId', receipt_id));
    end if;
  end loop;

  insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, summary)
  values (p_business_id, auth.uid(), 'purchase.receipt', 'purchase_receipt', receipt_id,
          jsonb_build_object('supplier', supplier.name, 'invoice', invoice, 'lines', jsonb_array_length(p_receipt->'lines'),
                             'netFils', net, 'vatFils', vat, 'grossFils', net + vat));
  return public.purchase_receipt_get(p_business_id, receipt_id);
end
$$;

-- void_purchase_receipt: the body of 202611110058_purchase_receipts.sql; it takes back the stored quantity (grams for a
-- weighed line) and Stage 2F refuses a line whose product has switched how it is sold since the delivery.
create or replace function public.void_purchase_receipt(p_business_id uuid, p_receipt_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  receipt public.purchase_receipts;
  clean_reason text := btrim(coalesce(p_reason, ''));
  line record;
begin
  perform public.purchasing_check(p_business_id);
  if char_length(clean_reason) not between 1 and 200 then
    raise exception 'invalid_reason' using errcode = 'P0001';
  end if;
  select * into receipt from public.purchase_receipts r where r.id = p_receipt_id and r.business_id = p_business_id for update;
  if not found then
    raise exception 'receipt_not_found' using errcode = 'P0001';
  end if;
  if receipt.voided_at is not null then
    raise exception 'already_voided' using errcode = 'P0001';
  end if;

  for line in
    select l.product_id, l.quantity, l.by_weight, p.name, p.stock_quantity, p.sold_by_weight
    from public.purchase_receipt_lines l join public.products p on p.id = l.product_id
    where l.receipt_id = receipt.id order by l.product_id
    for update of p
  loop
    -- Stage 2F: grams and units never mix: a line received one way cannot come back out the other way.
    if line.by_weight <> line.sold_by_weight then
      raise exception using errcode = 'P0001', message = 'weight_mismatch', detail = line.name;
    end if;
    if line.stock_quantity < line.quantity then
      raise exception using errcode = 'P0001', message = 'stock_too_low', detail = line.name || ':' || line.stock_quantity;
    end if;
    update public.products set stock_quantity = stock_quantity - line.quantity, updated_at = now() where id = line.product_id;
    insert into public.stock_movements (business_id, product_id, type, quantity_delta, reason, source_id, created_by)
    values (p_business_id, line.product_id, 'correction_out', -line.quantity, left('Delivery voided · ' || clean_reason, 300), receipt.id, auth.uid());
  end loop;

  update public.purchase_receipts set voided_at = now(), voided_by = auth.uid(), void_reason = clean_reason where id = receipt.id;
  insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, summary)
  values (p_business_id, auth.uid(), 'purchase.void', 'purchase_receipt', receipt.id, jsonb_build_object('reason', clean_reason));
end
$$;

-- profit_report: the body of 202611100055_sync_cost_stamp.sql; byProduct rows gain weightGrams (null when none).
create or replace function public.profit_report(p_business_id uuid, p_from date, p_to date)
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
           i.quantity * i.unit_cost_fils as cost, true as sold, i.weight_grams as grams
    from public.sales s join public.sale_items i on i.sale_id = s.id
    where s.business_id = p_business_id and s.supply_date between p_from and p_to
    union all
    select (c.created_at at time zone 'Asia/Dubai')::date, i.product_id, i.description, -i.quantity, -i.net_fils,
           -(i.quantity * i.unit_cost_fils), false, -i.weight_grams
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
    select product_id, coalesce(product_name, description) as name, sum(qty) as qty, sum(grams) as grams, sum(net) as net,
           coalesce(sum(cost), 0) as cost,
           coalesce(sum(net) filter (where cost is not null), 0) as costed_net
    from tagged group by product_id, coalesce(product_name, description)
  ),
  ranked as (
    select *, costed_net - cost as profit, row_number() over (order by costed_net - cost desc, name) as rank from products
  ),
  product_rows as (
    select rank, product_id, name, qty, grams, net, cost, costed_net from ranked where rank <= 50
    union all
    select 51, null, 'Rest', sum(qty), sum(grams), sum(net), sum(cost), sum(costed_net) from ranked where rank > 50 having count(*) > 0
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
        'productId', product_id, 'name', name, 'quantity', qty, 'weightGrams', grams, 'netFils', net, 'costFils', cost, 'profitFils', costed_net - cost,
        'marginPct', case when costed_net > 0 then round((costed_net - cost) * 100.0 / costed_net, 1) end)
        order by rank) from product_rows), '[]'::jsonb)
  ) into result;
  return result;
end
$$;
