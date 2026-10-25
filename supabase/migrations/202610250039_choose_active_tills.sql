-- Stage 1H: the till choice keeps up to the shop's current till limit, not exactly one. When an extra till ends on
-- Pro (limit 2) with 3 active tills, the owner keeps 2 and only 1 is paused.
-- Owner only. Every kept id must be an active till of the business; at least one and at most the till limit
-- (entitlements_internal limits.tills; null = unlimited; a shop always keeps one selling till) may be kept.
-- The others are paused under the same row lock. Returns how many were paused.
-- Security definer, so the devices_status_guard lets the status write through and device_paused_at stamps paused_at.
create function public.choose_active_tills(p_business_id uuid, p_keep_device_ids uuid[])
returns integer language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  keep_ids uuid[];
  till_limit integer;
  paused_count integer;
begin
  if auth.uid() is null or not public.owns_business(p_business_id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  perform 1 from public.devices where business_id = p_business_id for update;

  select coalesce(array_agg(distinct id), array[]::uuid[]) into keep_ids
  from unnest(coalesce(p_keep_device_ids, array[]::uuid[])) as kept(id);
  if cardinality(keep_ids) = 0 then
    raise exception using errcode = 'P0001', message = 'keep_at_least_one';
  end if;

  if array_position(keep_ids, null) is not null or (
    select count(*) from public.devices
    where id = any(keep_ids) and business_id = p_business_id and status = 'active'
  ) <> cardinality(keep_ids) then
    raise exception using errcode = 'P0001', message = 'till_not_found';
  end if;

  till_limit := (public.entitlements_internal(p_business_id, now())->'limits'->>'tills')::integer;
  if till_limit is not null and cardinality(keep_ids) > greatest(till_limit, 1) then
    raise exception using errcode = 'P0001', message = 'too_many_tills';
  end if;

  update public.devices set status = 'paused'
  where business_id = p_business_id and status = 'active' and id <> all(keep_ids);
  get diagnostics paused_count = row_count;
  return paused_count;
end
$$;

revoke execute on function public.choose_active_tills(uuid, uuid[]) from public, anon;
grant execute on function public.choose_active_tills(uuid, uuid[]) to authenticated;

-- The one-till form (body from 202610190024) now keeps that one till through choose_active_tills.
create or replace function public.choose_active_till(p_business_id uuid, p_keep_device_id uuid)
returns integer language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
begin
  return public.choose_active_tills(p_business_id, array[p_keep_device_id]);
end
$$;

revoke execute on function public.choose_active_till(uuid, uuid) from public, anon;
grant execute on function public.choose_active_till(uuid, uuid) to authenticated;
