-- Stage 2C (docs/superpowers/specs/2026-11-10-stage-2c-categories-margin-design.md §4.1): product categories for every
-- plan. One flat list per shop; a product is in at most one category. Written through the offline outbox like products.

create table public.product_categories (
  id uuid primary key,
  business_id uuid not null references public.businesses (id) on delete restrict,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 40),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

-- A live name is unique per shop, ignoring case; archived categories free their name.
create unique index product_categories_live_name on public.product_categories (business_id, lower(name)) where archived_at is null;
create index product_categories_business on public.product_categories (business_id);

alter table public.product_categories enable row level security;
create policy "members read categories" on public.product_categories for select using (public.has_role(business_id, 'cashier'));
revoke insert, update, delete, truncate on public.product_categories from public, anon, authenticated;
grant select on public.product_categories to authenticated;

alter table public.products add column category_id uuid references public.product_categories (id) on delete set null;
create index products_category on public.products (category_id) where category_id is not null;

-- Upserts one category by id. Owner only, idempotent on the operation id (like apply_product_sync).
-- Payload: { category: { id, name, sortOrder, archived }, deviceId }.
create function public.apply_category_sync(p_operation_id uuid, p_business_id uuid, p_entity_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  existing_operation public.sync_operations%rowtype;
  category jsonb;
  payload_hash text;
  active_device_id uuid;
  clean_name text;
  archived boolean;
  sort_value integer;
begin
  if auth.uid() is null or not public.owns_business(p_business_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) <> 'object' or jsonb_typeof(p_payload->'category') <> 'object' then
    raise exception 'invalid_category' using errcode = 'P0001';
  end if;

  category := p_payload->'category';
  payload_hash := encode(digest(p_payload::text, 'sha256'), 'hex');

  select * into existing_operation from public.sync_operations where operation_id = p_operation_id;
  if found then
    if existing_operation.payload_hash <> payload_hash or existing_operation.business_id <> p_business_id
       or existing_operation.entity_id <> p_entity_id then
      raise exception 'operation_payload_conflict' using errcode = 'P0001';
    end if;
    return jsonb_build_object('status', existing_operation.status::text, 'entityId', existing_operation.entity_id);
  end if;

  if coalesce(category->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or (category->>'id')::uuid <> p_entity_id then
    raise exception 'invalid_category' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.product_categories c where c.id = p_entity_id and c.business_id <> p_business_id) then
    raise exception 'category_not_found' using errcode = 'P0001';
  end if;

  clean_name := btrim(coalesce(category->>'name', ''));
  if char_length(clean_name) not between 1 and 40 then
    raise exception 'invalid_category' using errcode = 'P0001';
  end if;
  archived := coalesce((category->>'archived')::boolean, false);
  sort_value := coalesce((category->>'sortOrder')::integer, 0);

  active_device_id := public.sync_device_id(p_business_id, p_payload);
  if active_device_id is null then
    raise exception 'no_active_device' using errcode = 'P0001';
  end if;

  if not archived and exists (
    select 1 from public.product_categories c
    where c.business_id = p_business_id and c.id <> p_entity_id and c.archived_at is null and lower(c.name) = lower(clean_name)
  ) then
    raise exception 'category_name_taken' using errcode = 'P0001';
  end if;

  begin
    update public.product_categories c
    set name = clean_name,
        sort_order = sort_value,
        archived_at = case when archived then coalesce(c.archived_at, now()) else null end
    where c.id = p_entity_id and c.business_id = p_business_id;
    if not found then
      insert into public.product_categories (id, business_id, name, sort_order, archived_at)
      values (p_entity_id, p_business_id, clean_name, sort_value, case when archived then now() end);
    end if;
  exception when unique_violation then
    raise exception 'category_name_taken' using errcode = 'P0001';
  end;

  insert into public.sync_operations (operation_id, business_id, device_id, entity_type, entity_id, payload_hash, status)
  values (p_operation_id, p_business_id, active_device_id, 'category', p_entity_id, payload_hash, 'accepted');

  insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, summary)
  values (p_business_id, auth.uid(), 'sync.accepted', 'category', p_entity_id,
          jsonb_build_object('operationId', p_operation_id, 'name', clean_name, 'archived', archived));

  return jsonb_build_object('status', 'accepted', 'entityId', p_entity_id);
end;
$$;

revoke all on function public.apply_category_sync(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.apply_category_sync(uuid, uuid, uuid, jsonb) to authenticated;

-- apply_product_sync: the body of 202610180020_catalogue_sync.sql with one addition: an optional product.categoryId.
-- Key absent keeps the product's category (older tills); null clears it; otherwise it must be this shop's category.
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
        updated_at = now()
    where p.id = target_id
      and p.business_id = p_business_id;

    if not found then
      insert into public.products (
        id, business_id, name, sku, barcode, price_fils,
        stock_quantity, low_stock_threshold, status, tax_category, category_id
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
        new_category
      );
    end if;
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
