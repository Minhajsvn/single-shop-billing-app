-- Stage 1I: granted plans. Platform staff give a shop a plan by hand (optionally until a date). A grant is a separate
-- table, not a subscriptions column, so a Stripe event (apply_billing_event only writes subscriptions) can never
-- overwrite it. While a grant is in force it decides the plan and gives full access; the subscription row is untouched.
-- Service role only; the staff check lives in the app and these functions trust p_actor.

create table public.plan_grants (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  plan_id text not null references public.plan_catalog (id),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  granted_by uuid not null references auth.users (id),
  note text not null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id),
  revoke_note text,
  created_at timestamptz not null default now()
);

-- At most one open (not revoked) grant per shop.
create unique index plan_grants_one_open on public.plan_grants (business_id) where revoked_at is null;

alter table public.plan_grants enable row level security;
revoke all on public.plan_grants from public, anon, authenticated;
grant select, insert, update on public.plan_grants to service_role;

-- Body copied from 202610250035_admin_console.sql. Changes: a grant in force replaces the plan, forces full access and
-- sets accessEndsAt to the grant end; the keys grantPlanId and grantEndsAt are always returned. Overrides, the extra
-- till and add-ons are applied on top exactly as before; status stays the subscription's.
create or replace function public.entitlements_internal(target_business_id uuid, at_time timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public, extensions, pg_temp
as $$
declare
  sub public.subscriptions;
  plan public.plan_catalog;
  grant_row public.plan_grants;
  access_end timestamptz;
  access text;
  plan_id_out text;
begin
  select * into sub from public.subscriptions where business_id = target_business_id;
  if not found then
    return jsonb_build_object(
      'planId', null, 'status', null, 'access', 'read_only', 'trialEndsAt', null, 'graceEndsAt', null,
      'accessEndsAt', null, 'cancelAt', null, 'hasPaymentMethod', false, 'billingInterval', null, 'currentPeriodEnd', null,
      'grantPlanId', null, 'grantEndsAt', null,
      'features', '[]'::jsonb,
      'limits', jsonb_build_object('branches', 0, 'tills', 0, 'members', 0, 'products', 0)
    );
  end if;

  select * into grant_row from public.plan_grants g
  where g.business_id = target_business_id and g.revoked_at is null and g.starts_at <= at_time
    and (g.ends_at is null or g.ends_at > at_time)
  order by g.created_at desc limit 1;

  if grant_row.id is not null then
    select * into plan from public.plan_catalog where id = grant_row.plan_id;
    plan_id_out := grant_row.plan_id;
    access_end := grant_row.ends_at;
    access := 'full';
  else
    select * into plan from public.plan_catalog where id = sub.plan_id;
    plan_id_out := sub.plan_id;
    access_end := public.access_ends_at(sub);
    access := case when access_end is null or access_end > at_time then 'full' else 'read_only' end;
  end if;

  return jsonb_build_object(
    'planId', plan_id_out,
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
    'grantPlanId', grant_row.plan_id,
    'grantEndsAt', grant_row.ends_at,
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

-- Grant a plan. Refused while a Stripe subscription is live (not canceled): Stripe owns that shop's plan.
-- An open grant is revoked first (its revoke_note is the new note) so there is never more than one.
create function public.admin_grant_plan(p_business_id uuid, p_plan_id text, p_ends_at timestamptz, p_actor uuid, p_note text)
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
  if sub.stripe_subscription_id is not null and sub.status <> 'canceled' then
    raise exception using errcode = 'P0001', message = 'stripe_subscription_live';
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

-- End the open grant now. The shop falls back to its subscription.
create function public.admin_revoke_grant(p_business_id uuid, p_actor uuid, p_note text)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  clean_note text := public.admin_clean_note(p_note);
  open_grant public.plan_grants;
begin
  perform 1 from public.subscriptions where business_id = p_business_id for update;

  select * into open_grant from public.plan_grants where business_id = p_business_id and revoked_at is null;
  if not found then
    raise exception using errcode = 'P0001', message = 'no_grant';
  end if;

  update public.plan_grants set revoked_at = now(), revoked_by = p_actor, revoke_note = clean_note where id = open_grant.id;

  insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, summary)
  values (p_business_id, p_actor, 'admin.revoke_grant', 'plan_grant', open_grant.id, jsonb_build_object(
    'before', jsonb_build_object('planId', open_grant.plan_id, 'endsAt', open_grant.ends_at),
    'after', jsonb_build_object('planId', null, 'endsAt', null),
    'note', clean_note));
end
$$;

revoke execute on function public.admin_grant_plan(uuid, text, timestamptz, uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_revoke_grant(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_grant_plan(uuid, text, timestamptz, uuid, text) to service_role;
grant execute on function public.admin_revoke_grant(uuid, uuid, text) to service_role;
