-- Stage 1H: internal admin console writes. Platform staff extend a trial and give a shop an extra till for a while.
-- The staff check lives in the app (PLATFORM_STAFF_EMAILS); these functions are service_role only and trust p_actor.
-- Every change writes an audit_events row (actor = staff user, summary = before/after + note) in the same transaction.

alter table public.entitlement_overrides
  add column kind text not null default 'manual' check (kind in ('manual', 'extra_till'));

create index entitlement_overrides_business_kind_idx on public.entitlement_overrides (business_id, kind);

-- A note is 1-500 characters once trimmed; the trimmed text is what is stored.
create function public.admin_clean_note(p_note text)
returns text language plpgsql immutable set search_path = public, extensions, pg_temp
as $$
declare
  cleaned text := btrim(coalesce(p_note, ''));
begin
  if char_length(cleaned) not between 1 and 500 then
    raise exception using errcode = 'P0001', message = 'note_required';
  end if;
  return cleaned;
end
$$;

revoke execute on function public.admin_clean_note(text) from public, anon, authenticated;
grant execute on function public.admin_clean_note(text) to service_role;

-- Extend trial: only for trials (including one that has just run out). A trial with a card on file is refused:
-- Stripe holds that trial end, so it is changed in Stripe.
create function public.admin_extend_trial(p_business_id uuid, p_trial_ends_at timestamptz, p_actor uuid, p_note text)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  note text := public.admin_clean_note(p_note);
  sub public.subscriptions;
begin
  select * into sub from public.subscriptions where business_id = p_business_id for update;
  if not found or sub.status <> 'trialing' then
    raise exception using errcode = 'P0001', message = 'not_trialing';
  end if;
  if sub.has_payment_method then
    raise exception using errcode = 'P0001', message = 'trial_has_card';
  end if;
  if p_trial_ends_at is null or p_trial_ends_at <= now() then
    raise exception using errcode = 'P0001', message = 'end_not_in_future';
  end if;

  update public.subscriptions set trial_ends_at = p_trial_ends_at, updated_at = now()
  where business_id = p_business_id;

  insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, summary)
  values (p_business_id, p_actor, 'admin.extend_trial', 'subscription', p_business_id, jsonb_build_object(
    'before', jsonb_build_object('trialEndsAt', sub.trial_ends_at),
    'after', jsonb_build_object('trialEndsAt', p_trial_ends_at),
    'note', note));
end
$$;

-- Give an extra till until p_until: max_tills = the plan's tills + 1 (add-on tills still add on top in
-- entitlements_internal). One active extra till per shop: an active one is ended first.
create function public.admin_give_extra_till(p_business_id uuid, p_until timestamptz, p_actor uuid, p_note text)
returns uuid language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  note text := public.admin_clean_note(p_note);
  sub public.subscriptions;
  plan_tills integer;
  replaced public.entitlement_overrides;
  new_id uuid;
begin
  if p_until is null or p_until <= now() then
    raise exception using errcode = 'P0001', message = 'until_not_in_future';
  end if;

  select * into sub from public.subscriptions where business_id = p_business_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'shop_not_found';
  end if;
  select max_tills into plan_tills from public.plan_catalog where id = sub.plan_id;

  select * into replaced from public.entitlement_overrides
  where business_id = p_business_id and kind = 'extra_till' and (expires_at is null or expires_at > now())
  order by created_at desc limit 1;
  update public.entitlement_overrides set expires_at = now()
  where business_id = p_business_id and kind = 'extra_till' and (expires_at is null or expires_at > now());

  insert into public.entitlement_overrides (business_id, kind, max_tills, expires_at, note)
  values (p_business_id, 'extra_till', plan_tills + 1, p_until, note)
  returning id into new_id;

  insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, summary)
  values (p_business_id, p_actor, 'admin.extra_till', 'entitlement_override', new_id, jsonb_build_object(
    'before', jsonb_build_object('replaced', case when replaced.id is null then null else jsonb_build_object(
      'id', replaced.id, 'maxTills', replaced.max_tills, 'expiresAt', replaced.expires_at) end),
    'after', jsonb_build_object('id', new_id, 'planId', sub.plan_id, 'maxTills', plan_tills + 1, 'expiresAt', p_until),
    'note', note));

  return new_id;
end
$$;

-- End the active extra till now. Tills above the limit stay active; the till choice applies at the next register open.
create function public.admin_end_extra_till(p_business_id uuid, p_actor uuid, p_note text)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  note text := public.admin_clean_note(p_note);
  active public.entitlement_overrides;
begin
  perform 1 from public.subscriptions where business_id = p_business_id for update;

  select * into active from public.entitlement_overrides
  where business_id = p_business_id and kind = 'extra_till' and (expires_at is null or expires_at > now())
  order by created_at desc limit 1;
  if not found then
    raise exception using errcode = 'P0001', message = 'no_extra_till';
  end if;

  update public.entitlement_overrides set expires_at = now()
  where business_id = p_business_id and kind = 'extra_till' and (expires_at is null or expires_at > now());

  insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, summary)
  values (p_business_id, p_actor, 'admin.end_extra_till', 'entitlement_override', active.id, jsonb_build_object(
    'before', jsonb_build_object('id', active.id, 'maxTills', active.max_tills, 'expiresAt', active.expires_at),
    'after', jsonb_build_object('id', active.id, 'maxTills', active.max_tills, 'expiresAt', now()),
    'note', note));
end
$$;

revoke execute on function public.admin_extend_trial(uuid, timestamptz, uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_give_extra_till(uuid, timestamptz, uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_end_extra_till(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_extend_trial(uuid, timestamptz, uuid, text) to service_role;
grant execute on function public.admin_give_extra_till(uuid, timestamptz, uuid, text) to service_role;
grant execute on function public.admin_end_extra_till(uuid, uuid, text) to service_role;
