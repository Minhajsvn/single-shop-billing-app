-- Stage 1H: daily billing check. The app compares each shop's subscriptions row with Stripe and records disagreements
-- here as flags for the platform owner to look at. Nothing in this file changes public.subscriptions.
-- One open flag per (shop, field); a repeat run updates it; only "looked at" closes it; a field still wrong on a later
-- run opens a new flag. Service role only: RLS on with no policies, and no grants to anon or authenticated.

create table public.admin_billing_flags (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  field text not null check (field in ('status', 'current_period_end', 'cancel_at', 'trial_end', 'exists')),
  ours text,
  theirs text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  seen_at timestamptz,
  seen_by uuid references auth.users(id) on delete restrict,
  seen_note text check (seen_note is null or char_length(seen_note) between 1 and 500),
  check ((seen_at is null) = (seen_by is null) and (seen_at is null) = (seen_note is null))
);

create unique index admin_billing_flags_open_idx on public.admin_billing_flags (business_id, field) where seen_at is null;
create index admin_billing_flags_business_idx on public.admin_billing_flags (business_id, first_seen desc);

-- When each shop was last checked (shown on the admin shop page), whether or not anything disagreed.
create table public.admin_billing_check_runs (
  business_id uuid primary key references public.businesses(id) on delete restrict,
  checked_at timestamptz not null
);

alter table public.admin_billing_flags enable row level security;
alter table public.admin_billing_check_runs enable row level security;
revoke all on public.admin_billing_flags from public, anon, authenticated;
revoke all on public.admin_billing_check_runs from public, anon, authenticated;
grant select, insert, update, delete on public.admin_billing_flags to service_role;
grant select, insert, update, delete on public.admin_billing_check_runs to service_role;

-- Shops the daily check looks at: every shop whose subscription has a Stripe subscription id.
create function public.admin_billing_check_shops()
returns setof uuid language sql stable security definer set search_path = public, extensions, pg_temp
as $$
  select business_id from public.subscriptions where stripe_subscription_id is not null order by business_id;
$$;

-- Records one shop's check: p_mismatches is a JSON array of { field, ours, theirs } (ours/theirs text or null).
-- Each field opens a flag, or updates the open one (latest values, last_seen = now()). Fields that agree are left alone.
create function public.admin_record_billing_check(p_business_id uuid, p_mismatches jsonb)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  item jsonb;
begin
  if p_mismatches is null or jsonb_typeof(p_mismatches) <> 'array' then
    raise exception using errcode = 'P0001', message = 'mismatches_not_array';
  end if;

  for item in select value from jsonb_array_elements(p_mismatches) loop
    insert into public.admin_billing_flags (business_id, field, ours, theirs, first_seen, last_seen)
    values (p_business_id, item->>'field', item->>'ours', item->>'theirs', now(), now())
    on conflict (business_id, field) where seen_at is null
    do update set ours = excluded.ours, theirs = excluded.theirs, last_seen = excluded.last_seen;
  end loop;

  insert into public.admin_billing_check_runs (business_id, checked_at) values (p_business_id, now())
  on conflict (business_id) do update set checked_at = excluded.checked_at;
end
$$;

-- "Looked at": closes an open flag with the staff id and a note, and writes an admin.flag_seen audit row.
create function public.admin_mark_flag_seen(p_flag_id uuid, p_actor uuid, p_note text)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  note text := public.admin_clean_note(p_note);
  flag public.admin_billing_flags;
  seen timestamptz := now();
begin
  select * into flag from public.admin_billing_flags where id = p_flag_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'flag_not_found';
  end if;
  if flag.seen_at is not null then
    raise exception using errcode = 'P0001', message = 'flag_already_seen';
  end if;

  update public.admin_billing_flags set seen_at = seen, seen_by = p_actor, seen_note = note where id = p_flag_id;

  insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, summary)
  values (flag.business_id, p_actor, 'admin.flag_seen', 'billing_flag', flag.id, jsonb_build_object(
    'before', jsonb_build_object('field', flag.field, 'ours', flag.ours, 'theirs', flag.theirs,
      'firstSeen', flag.first_seen, 'lastSeen', flag.last_seen, 'seenAt', null),
    'after', jsonb_build_object('seenAt', seen),
    'note', note));
end
$$;

revoke execute on function public.admin_billing_check_shops() from public, anon, authenticated;
revoke execute on function public.admin_record_billing_check(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.admin_mark_flag_seen(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_billing_check_shops() to service_role;
grant execute on function public.admin_record_billing_check(uuid, jsonb) to service_role;
grant execute on function public.admin_mark_flag_seen(uuid, uuid, text) to service_role;
