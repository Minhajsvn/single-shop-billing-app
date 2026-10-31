-- Stage 1J: Razorpay replaces Stripe. The database names become provider-neutral, and the lifecycle learns two things:
-- an event for a subscription other than the stored one never changes the shop, and a trial card can be removed.
alter table public.subscriptions rename column stripe_customer_id to billing_customer_id;
alter table public.subscriptions rename column stripe_subscription_id to billing_subscription_id;
alter table public.stripe_events rename to billing_events;
alter index public.subscriptions_stripe_customer_id_key rename to subscriptions_billing_customer_id_key;
alter index public.subscriptions_stripe_subscription_id_key rename to subscriptions_billing_subscription_id_key;
alter index public.stripe_events_pkey rename to billing_events_pkey;

-- apply_billing_event: the body of 202610200027 with the trial_ends_at line of 202610250037, the neutral names, and
-- two additions: the stray-subscription guard and the trial_card_removed kind.
create or replace function public.apply_billing_event(p_event jsonb)
returns text language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  v_id text := p_event->>'id';
  v_created timestamptz := (p_event->>'created')::timestamptz;
  v_kind text := p_event->>'kind';
  v_business uuid := (p_event->>'businessId')::uuid;
  v_customer text := p_event->>'customerId';
  v_subscription text := p_event->>'subscriptionId';
  v_status text := p_event->>'status';
  v_period_end timestamptz := (p_event->>'currentPeriodEnd')::timestamptz;
  v_cancel_at timestamptz := (p_event->>'cancelAt')::timestamptz;
  v_interval text := p_event->>'interval';
  sub public.subscriptions;
  inserted integer;
begin
  if v_id is null or v_created is null
     or v_kind is null or v_kind not in ('checkout_completed', 'subscription_changed', 'subscription_deleted', 'invoice_paid', 'payment_failed', 'trial_card_removed') then
    raise exception using errcode = '22023', message = 'invalid_billing_event';
  end if;
  if v_interval is not null and v_interval not in ('month', 'year') then
    v_interval := null;
  end if;

  -- Resolve first: an event for no known business is not recorded, so a redelivery after checkout
  -- links the billing ids is applied.
  if v_business is not null then
    select * into sub from public.subscriptions where business_id = v_business for update;
  end if;
  if sub.business_id is null and v_subscription is not null then
    select * into sub from public.subscriptions where billing_subscription_id = v_subscription for update;
  end if;
  if sub.business_id is null and v_customer is not null then
    select * into sub from public.subscriptions where billing_customer_id = v_customer for update;
  end if;
  if sub.business_id is null then
    return 'unknown_business';
  end if;

  insert into public.billing_events (id, type) values (v_id, v_kind) on conflict (id) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then
    return 'duplicate';
  end if;

  if sub.last_event_at > v_created then
    return 'stale';
  end if;

  -- Canceled is final: a same-second payment_failed, or a late invoice or subscription update for the deleted
  -- subscription, must not bring it back. Only a new checkout reactivates.
  if sub.status = 'canceled' and v_kind in ('payment_failed', 'invoice_paid', 'subscription_changed') then
    return 'stale';
  end if;

  -- A stray subscription: the shop already has a different one. A second paid checkout is 'superseded' (the app
  -- cancels it at the provider); every other event for it is 'stale'. A checkout for a new id while the stored row
  -- is canceled, or is a trial without a card, falls through and relinks the ids.
  if sub.billing_subscription_id is not null and v_subscription is not null
     and v_subscription <> sub.billing_subscription_id then
    if v_kind <> 'checkout_completed' then
      return 'stale';
    end if;
    if sub.status in ('active', 'past_due') or (sub.status = 'trialing' and sub.has_payment_method) then
      return 'superseded';
    end if;
  end if;

  if v_kind = 'checkout_completed' then
    if v_status = 'trialing' and sub.trial_ends_at > now() then
      update public.subscriptions set status = 'trialing', plan_id = 'pro'
      where business_id = sub.business_id;
    else
      update public.subscriptions set status = 'active', plan_id = 'starter', grace_ends_at = null, canceled_at = null
      where business_id = sub.business_id;
    end if;
    update public.subscriptions set
      billing_customer_id = coalesce(v_customer, billing_customer_id),
      billing_subscription_id = coalesce(v_subscription, billing_subscription_id),
      has_payment_method = true,
      billing_interval = coalesce(v_interval, billing_interval),
      current_period_end = coalesce(v_period_end, current_period_end)
    where business_id = sub.business_id;

  elsif v_kind = 'subscription_changed' then
    update public.subscriptions set
      status = case
        when v_status = 'trialing' then 'trialing'::public.subscription_status
        when v_status = 'active' then 'active'::public.subscription_status
        when v_status in ('past_due', 'unpaid') then 'past_due'::public.subscription_status
        else status
      end,
      plan_id = case when v_status = 'active' then 'starter' else plan_id end,
      grace_ends_at = case
        when v_status = 'active' then null
        when v_status in ('past_due', 'unpaid') then case when status = 'past_due' then grace_ends_at else now() + interval '7 days' end
        else grace_ends_at
      end,
      current_period_end = coalesce(v_period_end, current_period_end),
      cancel_at = v_cancel_at,
      trial_ends_at = case when v_status = 'trialing' and p_event->>'trialEnd' is not null
        then (p_event->>'trialEnd')::timestamptz else trial_ends_at end,
      billing_interval = coalesce(v_interval, billing_interval)
    where business_id = sub.business_id;

  elsif v_kind = 'invoice_paid' and sub.status = 'trialing' and sub.trial_ends_at > now() then
    -- A zero-amount trial-start invoice must not end the Pro trial.
    update public.subscriptions set current_period_end = coalesce(v_period_end, current_period_end)
    where business_id = sub.business_id;

  elsif v_kind = 'invoice_paid' then
    update public.subscriptions set status = 'active', plan_id = 'starter', grace_ends_at = null,
      current_period_end = coalesce(v_period_end, current_period_end)
    where business_id = sub.business_id;

  elsif v_kind = 'payment_failed' then
    update public.subscriptions set
      grace_ends_at = case when status = 'past_due' then grace_ends_at else now() + interval '7 days' end,
      status = 'past_due'
    where business_id = sub.business_id;

  elsif v_kind = 'subscription_deleted' then
    update public.subscriptions set status = 'canceled', canceled_at = v_created, cancel_at = null
    where business_id = sub.business_id;

  elsif v_kind = 'trial_card_removed' then
    -- The owner cancelled a card-saved trial: back to a plain Pro trial with the days left, offered a plan again.
    update public.subscriptions set status = 'trialing', plan_id = 'pro', has_payment_method = false,
      billing_customer_id = null, billing_subscription_id = null, cancel_at = null
    where business_id = sub.business_id;
  end if;

  update public.subscriptions set last_event_at = v_created, updated_at = now()
  where business_id = sub.business_id;
  return 'applied';
end
$$;

revoke execute on function public.apply_billing_event(jsonb) from public, anon, authenticated;
grant execute on function public.apply_billing_event(jsonb) to service_role;

-- Shops the daily check looks at: every shop whose subscription has a billing subscription id.
create or replace function public.admin_billing_check_shops()
returns setof uuid language sql stable security definer set search_path = public, extensions, pg_temp
as $$
  select business_id from public.subscriptions where billing_subscription_id is not null order by business_id;
$$;

-- Grant a plan. Refused while a billing subscription is live (not canceled): the provider owns that shop's plan.
-- An open grant is revoked first (its revoke_note is the new note) so there is never more than one.
create or replace function public.admin_grant_plan(p_business_id uuid, p_plan_id text, p_ends_at timestamptz, p_actor uuid, p_note text)
returns uuid language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  clean_note text := public.admin_clean_note(p_note);
  sub public.subscriptions;
  open_grant public.plan_grants;
  new_id uuid;
begin
  select * into sub from public.subscriptions where business_id = p_business_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'shop_not_found';
  end if;
  if not exists (select 1 from public.plan_catalog where id = p_plan_id) then
    raise exception using errcode = 'P0001', message = 'plan_not_found';
  end if;
  if p_ends_at is not null and p_ends_at <= now() then
    raise exception using errcode = 'P0001', message = 'until_not_in_future';
  end if;
  if sub.billing_subscription_id is not null and sub.status <> 'canceled' then
    raise exception using errcode = 'P0001', message = 'billing_subscription_live';
  end if;

  select * into open_grant from public.plan_grants where business_id = p_business_id and revoked_at is null;
  if found then
    update public.plan_grants set revoked_at = now(), revoked_by = p_actor, revoke_note = clean_note where id = open_grant.id;
  end if;

  insert into public.plan_grants (business_id, plan_id, ends_at, granted_by, note)
  values (p_business_id, p_plan_id, p_ends_at, p_actor, clean_note)
  returning id into new_id;

  insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, summary)
  values (p_business_id, p_actor, 'admin.grant_plan', 'plan_grant', new_id, jsonb_build_object(
    'before', jsonb_build_object('planId', open_grant.plan_id, 'endsAt', open_grant.ends_at),
    'after', jsonb_build_object('planId', p_plan_id, 'endsAt', p_ends_at),
    'note', clean_note));

  return new_id;
end
$$;

-- Records a cancel the owner asked for. p_cancel_at is the date the subscription ends, or null when a trial card is
-- removed (the trial just continues). Service role only; the app has already called the provider.
create function public.record_billing_cancel(p_business uuid, p_cancel_at timestamptz, p_actor uuid)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
begin
  update public.subscriptions set cancel_at = p_cancel_at, updated_at = now() where business_id = p_business;
  insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, summary)
  values (p_business, p_actor, 'billing.cancel', 'subscription', p_business,
    jsonb_build_object('cancel_at', p_cancel_at));
end
$$;

revoke execute on function public.record_billing_cancel(uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.record_billing_cancel(uuid, timestamptz, uuid) to service_role;
