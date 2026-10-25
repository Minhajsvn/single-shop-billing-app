-- Stage 1G: an owner pauses and resumes a till by hand from Settings -> Tills.
-- Both run as security definer, so the devices_status_guard lets their status writes through; the
-- device_paused_at trigger stamps or clears paused_at, and enforce_plan_limit('tills') refuses a resume
-- beyond the plan's till limit with the same plan_limit_reached it raises everywhere else.
-- A till paused with an open shift keeps the register_access_gate rule: that shift can still finish and sync.

create function public.pause_till(p_business_id uuid, p_device_id uuid)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
begin
  if auth.uid() is null or not public.owns_business(p_business_id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  perform 1 from public.devices where business_id = p_business_id for update;
  if not exists (
    select 1 from public.devices
    where id = p_device_id and business_id = p_business_id and status = 'active'
  ) then
    raise exception using errcode = 'P0001', message = 'till_not_found';
  end if;

  -- A shop always keeps one selling till.
  if not exists (
    select 1 from public.devices
    where business_id = p_business_id and status = 'active' and id <> p_device_id
  ) then
    raise exception using errcode = 'P0001', message = 'last_active_till';
  end if;

  update public.devices set status = 'paused'
  where id = p_device_id and business_id = p_business_id;
end
$$;

create function public.resume_till(p_business_id uuid, p_device_id uuid)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
begin
  if auth.uid() is null or not public.owns_business(p_business_id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  perform 1 from public.devices where business_id = p_business_id for update;
  if not exists (
    select 1 from public.devices
    where id = p_device_id and business_id = p_business_id and status = 'paused'
  ) then
    raise exception using errcode = 'P0001', message = 'till_not_found';
  end if;

  -- enforce_plan_limit('tills') raises plan_limit_reached when the shop is already at its till limit.
  update public.devices set status = 'active'
  where id = p_device_id and business_id = p_business_id;
end
$$;

revoke execute on function public.pause_till(uuid, uuid) from public, anon;
revoke execute on function public.resume_till(uuid, uuid) from public, anon;
grant execute on function public.pause_till(uuid, uuid) to authenticated;
grant execute on function public.resume_till(uuid, uuid) to authenticated;
