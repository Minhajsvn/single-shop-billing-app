-- Stage 1H: internal admin console writes. Platform staff extend a trial and give a shop an extra till for a while.
-- The staff check lives in the app (PLATFORM_STAFF_EMAILS); these functions are service_role only and trust p_actor.
-- Every change writes an audit_events row (actor = staff user, summary = before/after + note) in the same transaction.

alter table public.entitlement_overrides
  add column kind text not null default 'manual' check (kind in ('manual', 'extra_till'));

create index entitlement_overrides_business_kind_idx on public.entitlement_overrides (business_id, kind);

-- An extra till is one more than the shop's current limit, so a plan change while it is active still counts:
-- tills = coalesce(newest active manual max_tills, plan max_tills) + 1 when an active extra_till exists, then + addon
-- tills (null = unlimited stays unlimited). The extra_till row's own max_tills is informational (plan + 1 at give time).
-- Body copied from 202610200026_entitlements_period_end.sql; only the tills limit changes.
create or replace function public.entitlements_internal(target_business_id uuid, at_time timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public, extensions, pg_temp
as $$
declare
  sub public.subscriptions;
  plan public.plan_catalog;
  access_end timestamptz;
  access text;
begin
  select * into sub from public.subscriptions where business_id = target_business_id;
  if not found then
    return jsonb_build_object(
      'planId', null, 'status', null, 'access', 'read_only', 'trialEndsAt', null, 'graceEndsAt', null,
      'accessEndsAt', null, 'cancelAt', null, 'hasPaymentMethod', false, 'billingInterval', null, 'currentPeriodEnd', null,
      'features', '[]'::jsonb,
      'limits', jsonb_build_object('branches', 0, 'tills', 0, 'members', 0, 'products', 0)
    );
  end if;

  select * into plan from public.plan_catalog where id = sub.plan_id;

  access_end := public.access_ends_at(sub);
  access := case when access_end is null or access_end > at_time then 'full' else 'read_only' end;

  return jsonb_build_object(
    'planId', sub.plan_id,
    'status', sub.status,
    'access', access,
    'trialEndsAt', sub.trial_ends_at,
    'graceEndsAt', sub.grace_ends_at,
    -- Always a parseable instant or null: an already-ended (-infinity) access end is sent as the epoch.
    'accessEndsAt', case when access_end is null or isfinite(access_end) then to_jsonb(access_end) else to_jsonb('1970-01-01T00:00:00Z'::text) end,
    'cancelAt', sub.cancel_at,
    'hasPaymentMethod', sub.has_payment_method,
    'billingInterval', sub.billing_interval,
    'currentPeriodEnd', sub.current_period_end,
    'features', to_jsonb(array(
      select distinct feature from (
        select unnest(plan.features) as feature
        union all
        select unnest(o.features) from public.entitlement_overrides o
        where o.business_id = target_business_id and (o.expires_at is null or o.expires_at > at_time)
      ) granted
      order by feature
    )),
    'limits', jsonb_build_object(
      'branches', coalesce((select o.max_branches from public.entitlement_overrides o where o.business_id = target_business_id and o.max_branches is not null and (o.expires_at is null or o.expires_at > at_time) order by o.created_at desc limit 1), plan.max_branches) + sub.addon_branches,
      'tills', coalesce((select o.max_tills from public.entitlement_overrides o where o.business_id = target_business_id and o.kind = 'manual' and o.max_tills is not null and (o.expires_at is null or o.expires_at > at_time) order by o.created_at desc limit 1), plan.max_tills)
        + case when exists (select 1 from public.entitlement_overrides o where o.business_id = target_business_id and o.kind = 'extra_till' and (o.expires_at is null or o.expires_at > at_time)) then 1 else 0 end
        + sub.addon_tills,
      'members', coalesce((select o.max_members from public.entitlement_overrides o where o.business_id = target_business_id and o.max_members is not null and (o.expires_at is null or o.expires_at > at_time) order by o.created_at desc limit 1), plan.max_members),
      'products', coalesce((select o.max_products from public.entitlement_overrides o where o.business_id = target_business_id and o.max_products is not null and (o.expires_at is null or o.expires_at > at_time) order by o.created_at desc limit 1), plan.max_products)
    )
  );
end
$$;

revoke execute on function public.entitlements_internal(uuid, timestamptz) from public, anon, authenticated;

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

-- Give an extra till until p_until. entitlements_internal adds 1 to the current limit while it is active; the row's
-- max_tills (the plan's tills + 1 at give time) is kept for the record only. A plan with no till limit is refused.
-- One active extra till per shop: an active one is ended first.
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
  if plan_tills is null then
    raise exception using errcode = 'P0001', message = 'plan_has_no_till_limit';
  end if;

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
