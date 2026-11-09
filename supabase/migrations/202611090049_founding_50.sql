-- Founding 50 (docs/superpowers/specs/2026-11-09-founding-50-design.md): the first 50 shops to pay get Pro features
-- and limits for 12 months at the Starter price. A seat is claimed by the first event that leaves a shop active on
-- Starter, ends when the subscription is deleted, and only a staff revoke frees it. One record per shop, ever.

create table public.founding_offer (
  id boolean primary key default true check (id),
  seat_cap integer not null default 50 check (seat_cap >= 0),
  months integer not null default 12 check (months > 0)
);
insert into public.founding_offer default values;

create table public.founding_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses (id) on delete cascade,
  seat_no integer not null check (seat_no > 0),
  claimed_at timestamptz not null default now(),
  ends_at timestamptz not null,
  billing_event_id text not null,
  ended_at timestamptz,
  end_reason text check (end_reason in ('canceled', 'revoked', 'upgraded')),
  revoked_by uuid references auth.users (id),
  revoke_note text,
  check ((ended_at is null) = (end_reason is null))
);

-- A seat number belongs to one founder who has not been revoked; a revoked seat number may be reused.
create unique index founding_members_seat_taken on public.founding_members (seat_no) where end_reason is distinct from 'revoked';

alter table public.founding_offer enable row level security;
alter table public.founding_members enable row level security;
revoke all on public.founding_offer from public, anon, authenticated;
revoke all on public.founding_members from public, anon, authenticated;
grant select on public.founding_offer to service_role;
grant select on public.founding_members to service_role;

-- Claims the lowest free seat for a shop that has never had one. Every claim first locks the singleton offer row, so
-- the count and the insert happen one at a time and the cap holds under concurrent payments. Returns the seat number,
-- or null when the shop already had a record or no seat is free.
create function public.claim_founding_seat(p_business uuid, p_event_id text)
returns integer language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  offer public.founding_offer;
  seat integer;
  new_id uuid;
  new_end timestamptz;
  owner uuid;
begin
  if exists (select 1 from public.founding_members where business_id = p_business) then
    return null;
  end if;

  select * into offer from public.founding_offer for update;

  -- Re-check under the lock: a concurrent claim for the same shop may have won.
  if exists (select 1 from public.founding_members where business_id = p_business) then
    return null;
  end if;

  select min(n) into seat from generate_series(1, offer.seat_cap) n
  where not exists (select 1 from public.founding_members m where m.seat_no = n and m.end_reason is distinct from 'revoked');
  if seat is null then
    return null;
  end if;

  new_end := now() + make_interval(months => offer.months);
  insert into public.founding_members (business_id, seat_no, ends_at, billing_event_id)
  values (p_business, seat, new_end, p_event_id)
  returning id into new_id;

  select owner_id into owner from public.businesses where id = p_business;
  insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, summary)
  values (p_business, owner, 'founding.claim', 'founding_member', new_id, jsonb_build_object('seatNo', seat, 'endsAt', new_end));
  return seat;
end
$$;

revoke execute on function public.claim_founding_seat(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_founding_seat(uuid, text) to service_role;

-- apply_billing_event: the body of 202610310043_razorpay_billing.sql with two additions: subscription_deleted ends an
-- open founder record, and an applied event that leaves the shop active on Starter claims a founding seat.
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

  -- A second paid checkout for a shop that already has a live subscription is 'superseded'. It is decided before the
  -- event is recorded, so a redelivery (after the app's provider cancel failed) is superseded again, not a duplicate.
  -- Regardless of last_event_at: an out-of-order checkout for the second subscription must still be cancelled.
  if v_kind = 'checkout_completed' and sub.billing_subscription_id is not null and v_subscription is not null
     and v_subscription <> sub.billing_subscription_id
     and (sub.status in ('active', 'past_due') or (sub.status = 'trialing' and sub.has_payment_method)) then
    return 'superseded';
  end if;

  -- Out-of-order first payment: a charge or failure for a subscription we have not linked yet must wait for
  -- activated/authenticated to link the ids. Not recorded and last_event_at untouched, so Razorpay's redelivery applies.
  if sub.billing_subscription_id is null and v_subscription is not null and v_kind in ('invoice_paid', 'payment_failed') then
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
  if sub.status = 'canceled' and v_kind in ('payment_failed', 'invoice_paid', 'subscription_changed', 'trial_card_removed') then
    return 'stale';
  end if;

  -- Removing a trial card only means something for a trial. On an active or past_due shop it would downgrade it.
  if v_kind = 'trial_card_removed' and sub.status <> 'trialing' then
    return 'stale';
  end if;

  -- A stray subscription: the shop already has a different one. Every event for it but a checkout is 'stale' (a live
  -- shop's checkout was already 'superseded' above). A checkout for a new id while the stored row is canceled, or is
  -- a trial without a card, falls through and relinks the ids.
  if sub.billing_subscription_id is not null and v_subscription is not null
     and v_subscription <> sub.billing_subscription_id then
    if v_kind <> 'checkout_completed' then
      return 'stale';
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
    -- Founding 50: the benefit ends with the subscription; the seat stays taken.
    update public.founding_members set ended_at = v_created, end_reason = 'canceled'
    where business_id = sub.business_id and ended_at is null;

  elsif v_kind = 'trial_card_removed' then
    -- The owner cancelled a card-saved trial: back to a plain Pro trial with the days left, offered a plan again.
    update public.subscriptions set status = 'trialing', plan_id = 'pro', has_payment_method = false,
      billing_customer_id = null, billing_subscription_id = null, cancel_at = null
    where business_id = sub.business_id;
  end if;

  update public.subscriptions set last_event_at = v_created, updated_at = now()
  where business_id = sub.business_id;
  -- Founding 50: the first event that leaves the shop active on Starter (a real charge) claims a seat.
  if v_kind in ('checkout_completed', 'invoice_paid', 'subscription_changed')
     and exists (select 1 from public.subscriptions s where s.business_id = sub.business_id and s.status = 'active' and s.plan_id = 'starter') then
    perform public.claim_founding_seat(sub.business_id, v_id);
  end if;

  return 'applied';
end
$$;

revoke execute on function public.apply_billing_event(jsonb) from public, anon, authenticated;
grant execute on function public.apply_billing_event(jsonb) to service_role;

