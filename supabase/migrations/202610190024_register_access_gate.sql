-- Stage 1F: read-only and paused tills are enforced when a register session is opened, never mid-shift.
-- A shift opened before the access end keeps selling and closing; a new shift after the end is refused.

-- Nothing in this file uses the new value at run time, so it may share the migration's transaction.
alter type public.device_status add value if not exists 'paused';

-- One gate for every insert path: the explicit open, and the implicit sessions created by
-- adjustment, close and sale sync when the server has no open session for the till.
create function public.register_access_gate()
returns trigger language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  sub public.subscriptions;
  access_end timestamptz;
  opened timestamptz := coalesce(new.opened_at, now());
begin
  if exists (select 1 from public.devices d where d.id = new.device_id and d.status = 'paused') then
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

  update public.devices set status = 'paused'
  where business_id = p_business_id and status = 'active' and id <> p_keep_device_id;
  get diagnostics paused_count = row_count;
  return paused_count;
end
$$;

revoke execute on function public.choose_active_till(uuid, uuid) from public, anon;
grant execute on function public.choose_active_till(uuid, uuid) to authenticated;
