-- Stage 1F: subscription lifecycle. Stripe webhook events are applied through one service_role RPC that
-- ignores duplicates and out-of-order deliveries; entitlements expose when access ends.

alter table public.subscriptions
  add column has_payment_method boolean not null default false,
  add column billing_interval text check (billing_interval in ('month', 'year')),
  add column cancel_at timestamptz,
  add column canceled_at timestamptz,
  add column last_event_at timestamptz;

-- When full access ends; null means it does not end. A missing date counts as already ended (read-only).
create function public.access_ends_at(sub public.subscriptions)
returns timestamptz language sql stable set search_path = public, extensions, pg_temp
as $$
  select case sub.status
    when 'trialing' then case
      when sub.trial_ends_at is null then '-infinity'::timestamptz
      when sub.has_payment_method then sub.trial_ends_at + interval '2 days'
      else sub.trial_ends_at
    end
    when 'past_due' then coalesce(sub.grace_ends_at, '-infinity'::timestamptz)
    when 'canceled' then coalesce(sub.canceled_at, '-infinity'::timestamptz)
    else null
  end
$$;

revoke execute on function public.access_ends_at(public.subscriptions) from public, anon, authenticated;

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
      'accessEndsAt', null, 'cancelAt', null, 'hasPaymentMethod', false, 'billingInterval', null,
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
    'accessEndsAt', access_end,
    'cancelAt', sub.cancel_at,
    'hasPaymentMethod', sub.has_payment_method,
    'billingInterval', sub.billing_interval,
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
      'tills', coalesce((select o.max_tills from public.entitlement_overrides o where o.business_id = target_business_id and o.max_tills is not null and (o.expires_at is null or o.expires_at > at_time) order by o.created_at desc limit 1), plan.max_tills) + sub.addon_tills,
      'members', coalesce((select o.max_members from public.entitlement_overrides o where o.business_id = target_business_id and o.max_members is not null and (o.expires_at is null or o.expires_at > at_time) order by o.created_at desc limit 1), plan.max_members),
      'products', coalesce((select o.max_products from public.entitlement_overrides o where o.business_id = target_business_id and o.max_products is not null and (o.expires_at is null or o.expires_at > at_time) order by o.created_at desc limit 1), plan.max_products)
    )
  );
end
$$;

revoke execute on function public.entitlements_internal(uuid, timestamptz) from public, anon, authenticated;

-- Applies one normalized Stripe event. Returns 'applied' | 'duplicate' | 'stale' | 'unknown_business'.
create function public.apply_billing_event(p_event jsonb)
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
     or v_kind is null or v_kind not in ('checkout_completed', 'subscription_changed', 'subscription_deleted', 'invoice_paid', 'payment_failed') then
    raise exception using errcode = '22023', message = 'invalid_billing_event';
  end if;
  if v_interval is not null and v_interval not in ('month', 'year') then
    v_interval := null;
  end if;

  insert into public.stripe_events (id, type) values (v_id, v_kind) on conflict (id) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then
    return 'duplicate';
  end if;

  if v_business is not null then
    select * into sub from public.subscriptions where business_id = v_business for update;
  end if;
  if sub.business_id is null and v_subscription is not null then
    select * into sub from public.subscriptions where stripe_subscription_id = v_subscription for update;
  end if;
  if sub.business_id is null and v_customer is not null then
    select * into sub from public.subscriptions where stripe_customer_id = v_customer for update;
  end if;
  if sub.business_id is null then
    return 'unknown_business';
  end if;

  if sub.last_event_at > v_created then
    return 'stale';
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
      stripe_customer_id = coalesce(v_customer, stripe_customer_id),
      stripe_subscription_id = coalesce(v_subscription, stripe_subscription_id),
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
      billing_interval = coalesce(v_interval, billing_interval)
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
  end if;

  update public.subscriptions set last_event_at = v_created, updated_at = now()
  where business_id = sub.business_id;
  return 'applied';
end
$$;

revoke execute on function public.apply_billing_event(jsonb) from public, anon, authenticated;
grant execute on function public.apply_billing_event(jsonb) to service_role;
