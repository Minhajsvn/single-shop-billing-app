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
    (select id from public.devices where business_id = p_business_id and status = 'active' order by created_at limit 1),
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