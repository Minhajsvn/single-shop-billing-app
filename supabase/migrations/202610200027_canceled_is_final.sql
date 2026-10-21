-- Stage 1F review fix: canceled is final for the stored subscription. Stripe sends invoice.payment_failed and
-- customer.subscription.deleted in the same second after the last retry, in no guaranteed order, and the stale
-- check (last_event_at > created) lets both apply. While the stored status is canceled, payment_failed,
-- invoice_paid and subscription_changed are recorded (so a redelivery is a duplicate) and ignored ('stale');
-- only checkout_completed reactivates.
-- apply_billing_event copied from 202610190023; the only change is the canceled guard after the stale check.
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
     or v_kind is null or v_kind not in ('checkout_completed', 'subscription_changed', 'subscription_deleted', 'invoice_paid', 'payment_failed') then
    raise exception using errcode = '22023', message = 'invalid_billing_event';
  end if;
  if v_interval is not null and v_interval not in ('month', 'year') then
    v_interval := null;
  end if;

  -- Resolve first: an event for no known business is not recorded, so a redelivery after checkout
  -- links the Stripe ids is applied.
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

  insert into public.stripe_events (id, type) values (v_id, v_kind) on conflict (id) do nothing;
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

  elsif v_kind = 'invoice_paid' and sub.status = 'trialing' and sub.trial_ends_at > now() then
    -- Stripe's $0 trial-start invoice must not end the Pro trial.
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
  end if;

  update public.subscriptions set last_event_at = v_created, updated_at = now()
  where business_id = sub.business_id;
  return 'applied';
end
$$;

revoke execute on function public.apply_billing_event(jsonb) from public, anon, authenticated;
grant execute on function public.apply_billing_event(jsonb) to service_role;
