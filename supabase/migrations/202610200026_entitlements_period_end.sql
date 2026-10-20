-- Stage 1F: entitlements carry current_period_end so the Billing tab can show the renewal date.
-- An active subscription has no access end (accessEndsAt is null), so the renewal date needs its own key.
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
      'tills', coalesce((select o.max_tills from public.entitlement_overrides o where o.business_id = target_business_id and o.max_tills is not null and (o.expires_at is null or o.expires_at > at_time) order by o.created_at desc limit 1), plan.max_tills) + sub.addon_tills,
      'members', coalesce((select o.max_members from public.entitlement_overrides o where o.business_id = target_business_id and o.max_members is not null and (o.expires_at is null or o.expires_at > at_time) order by o.created_at desc limit 1), plan.max_members),
      'products', coalesce((select o.max_products from public.entitlement_overrides o where o.business_id = target_business_id and o.max_products is not null and (o.expires_at is null or o.expires_at > at_time) order by o.created_at desc limit 1), plan.max_products)
    )
  );
end
$$;

revoke execute on function public.entitlements_internal(uuid, timestamptz) from public, anon, authenticated;
