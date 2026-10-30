-- Stage 1I: the till sync gate honours a granted plan. register_access_gate (the BEFORE INSERT trigger on
-- register_sessions fired by the sale and credit-note sync RPCs) read only the subscription, so a shop on an expired
-- trial with a grant in force got read_only on every sync while entitlements_internal (and the device) showed full
-- access, and its sales piled up in the outbox. A grant in force now skips the read-only check (the paused-till check
-- still applies). Otherwise the access end is the later of the subscription's end and the moment the most recent
-- grant stopped being in force (its end or its revoke), so a shift opened under the grant still lands within 72 hours.
-- The grant-in-force predicate is the one in entitlements_internal (202610290040_plan_grants.sql).
-- register_access_gate copied from 202610220034; only the access-end logic changes.
create or replace function public.register_access_gate()
returns trigger language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  sub public.subscriptions;
  device public.devices;
  access_end timestamptz;
  grant_end timestamptz;
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

  -- A grant in force gives full access whatever the subscription says.
  if exists (select 1 from public.plan_grants g
             where g.business_id = new.business_id and g.revoked_at is null and g.starts_at <= now()
               and (g.ends_at is null or g.ends_at > now())) then
    return new;
  end if;

  select * into sub from public.subscriptions where business_id = new.business_id;
  -- No subscription row means no access (entitlements report read_only too).
  access_end := case when found then public.access_ends_at(sub) else '-infinity'::timestamptz end;

  -- The moment the most recent grant stopped being in force: its end or its revoke, whichever came first.
  select max(least(g.ends_at, g.revoked_at)) into grant_end
  from public.plan_grants g
  where g.business_id = new.business_id and g.starts_at <= now() and least(g.ends_at, g.revoked_at) <= now();
  if access_end is not null and grant_end is not null then
    access_end := greatest(access_end, grant_end);
  end if;

  -- A shift opened before the end is accepted when it arrives within 72 hours of that end.
  if access_end is not null and now() > access_end
     and (opened >= access_end or now() > access_end + interval '72 hours') then
    raise exception using errcode = 'P0001', message = 'read_only';
  end if;
  return new;
end
$$;

revoke execute on function public.register_access_gate() from public, anon, authenticated;
