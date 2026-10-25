-- Stage 1G: a till becomes (or stops being) paused only through server functions such as choose_active_till.
-- Signed-in users write devices with their own role; security-definer functions run as their owner, so the guard
-- refuses direct writes of 'paused' from the authenticated and anon roles only. New tills always start active.
create function public.devices_status_guard()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status::text <> 'active' then
      raise exception using errcode = 'P0001', message = 'till_status_locked';
    end if;
  -- Entering paused, or leaving it for active, is locked; removing a paused till (revoked) stays allowed.
  elsif old.status is distinct from new.status
        and (new.status::text = 'paused' or (old.status::text = 'paused' and new.status::text = 'active')) then
    raise exception using errcode = 'P0001', message = 'till_status_locked';
  end if;
  return new;
end
$$;

revoke execute on function public.devices_status_guard() from public, anon, authenticated;

create trigger devices_status_guard before insert or update of status on public.devices
for each row execute function public.devices_status_guard();
