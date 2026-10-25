-- Stage 1G: re-pausing a till (pause_till / resume_till) restamps paused_at, which renewed the 72-hour window for a
-- shift opened long before. A paused till now accepts only a shift opened within the 72 hours before its pause, so
-- any shift on a paused till is bounded to 144 hours however often the till is re-paused.
-- register_access_gate copied from 202610200028; only the paused-till condition changes.
create or replace function public.register_access_gate()
returns trigger language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  sub public.subscriptions;
  device public.devices;
  access_end timestamptz;
  opened timestamptz := coalesce(new.opened_at, now());
begin
  -- A paused till may still deliver a shift it opened in the 72 hours before the pause, within 72 hours of the pause.
  select * into device from public.devices d where d.id = new.device_id;
  if device.status::text = 'paused'
     and not coalesce(device.paused_at <= now()
                      and opened < device.paused_at
                      and opened >= device.paused_at - interval '72 hours'
                      and now() <= device.paused_at + interval '72 hours', false) then
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
