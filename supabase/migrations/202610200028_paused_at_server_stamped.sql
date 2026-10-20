-- Stage 1F review fix: paused_at is server-stamped. The owner's RLS policy allows direct device writes, and
-- enforce_plan_limit skips non-active rows, so a caller-supplied future paused_at (on insert, or by updating
-- paused_at alone) let a "paused" till open shifts forever and sell beyond the plan's till limit.
-- device_paused_at copied from 202610190024: entering 'paused' always stamps now() (the supplied value is ignored),
-- any other update keeps the old value, a non-paused row has no pause time; the trigger also fires on paused_at.
create or replace function public.device_paused_at()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  if new.status::text = 'paused' then
    if tg_op = 'INSERT' or old.status::text <> 'paused' then
      new.paused_at := now();
    else
      new.paused_at := old.paused_at;
    end if;
  else
    new.paused_at := null;
  end if;
  return new;
end
$$;

drop trigger device_paused_at on public.devices;
create trigger device_paused_at before insert or update of status, paused_at on public.devices
for each row execute function public.device_paused_at();

-- register_access_gate copied from 202610190024; the paused-till exception also requires a pause time that is
-- not in the future.
create or replace function public.register_access_gate()
returns trigger language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  sub public.subscriptions;
  device public.devices;
  access_end timestamptz;
  opened timestamptz := coalesce(new.opened_at, now());
begin
  -- A paused till may still deliver a shift it opened before the pause, within 72 hours of the pause.
  select * into device from public.devices d where d.id = new.device_id;
  if device.status::text = 'paused'
     and not coalesce(device.paused_at <= now() and opened < device.paused_at and now() <= device.paused_at + interval '72 hours', false) then
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
