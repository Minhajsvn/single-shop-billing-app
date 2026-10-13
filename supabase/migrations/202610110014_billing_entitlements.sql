-- Stage 1A: subscriptions, manual overrides, Stripe event log, the entitlement resolver and plan limits.

create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'canceled');

create table public.subscriptions (
  business_id uuid primary key references public.businesses(id) on delete restrict,
  plan_id text not null references public.plan_catalog(id),
  status public.subscription_status not null,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  grace_ends_at timestamptz,
  addon_tills integer not null default 0 check (addon_tills >= 0),
  addon_branches integer not null default 0 check (addon_branches >= 0),
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;
create policy "owners read their subscription" on public.subscriptions for select using (public.has_role(business_id, 'owner'));

create table public.entitlement_overrides (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  features text[] not null default '{}',
  max_branches integer check (max_branches >= 0),
  max_tills integer check (max_tills >= 0),
  max_members integer check (max_members >= 0),
  max_products integer check (max_products >= 0),
  expires_at timestamptz,
  note text not null check (char_length(note) between 1 and 500),
  created_at timestamptz not null default now()
);

create index entitlement_overrides_business_idx on public.entitlement_overrides (business_id);
alter table public.entitlement_overrides enable row level security;

create table public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;

-- Existing businesses start the same trial new businesses get.
insert into public.subscriptions (business_id, plan_id, status, trial_ends_at)
select id, 'pro', 'trialing', now() + interval '14 days' from public.businesses
on conflict (business_id) do nothing;

create function public.entitlements_internal(target_business_id uuid, at_time timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  sub public.subscriptions;
  plan public.plan_catalog;
  access text;
begin
  select * into sub from public.subscriptions where business_id = target_business_id;
  if not found then
    return jsonb_build_object(
      'planId', null, 'status', null, 'access', 'read_only', 'trialEndsAt', null, 'graceEndsAt', null,
      'features', '[]'::jsonb,
      'limits', jsonb_build_object('branches', 0, 'tills', 0, 'members', 0, 'products', 0)
    );
  end if;

  select * into plan from public.plan_catalog where id = sub.plan_id;

  access := case
    when sub.status = 'active' then 'full'
    when sub.status = 'trialing' and sub.trial_ends_at > at_time then 'full'
    when sub.status = 'past_due' and sub.grace_ends_at > at_time then 'full'
    else 'read_only'
  end;

  return jsonb_build_object(
    'planId', sub.plan_id,
    'status', sub.status,
    'access', access,
    'trialEndsAt', sub.trial_ends_at,
    'graceEndsAt', sub.grace_ends_at,
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

create function public.business_entitlements(target_business_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is not null and not public.has_role(target_business_id, 'cashier') then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  return public.entitlements_internal(target_business_id, now());
end
$$;

revoke execute on function public.business_entitlements(uuid) from public, anon;
grant execute on function public.business_entitlements(uuid) to authenticated;

-- Blocks inserts and re-activations beyond the plan limit. Existing active rows are never touched.
create function public.enforce_plan_limit()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  limit_key text := tg_argv[0];
  limit_value jsonb;
  used integer;
begin
  if new.status::text <> 'active' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status::text = 'active' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.business_id::text || ':' || limit_key, 0));
  limit_value := public.entitlements_internal(new.business_id) -> 'limits' -> limit_key;
  if limit_value is null or jsonb_typeof(limit_value) = 'null' then
    return new;
  end if;

  execute format('select count(*) from public.%I where business_id = $1 and status::text = ''active''', tg_table_name)
    into used using new.business_id;

  if used >= limit_value::integer then
    raise exception using errcode = 'P0001', message = 'plan_limit_reached', detail = limit_key;
  end if;
  return new;
end
$$;

create trigger devices_plan_limit before insert or update of status on public.devices for each row execute function public.enforce_plan_limit('tills');
create trigger branches_plan_limit before insert or update of status on public.branches for each row execute function public.enforce_plan_limit('branches');
create trigger business_members_plan_limit before insert or update of status on public.business_members for each row execute function public.enforce_plan_limit('members');
create trigger products_plan_limit before insert or update of status on public.products for each row execute function public.enforce_plan_limit('products');

-- The subscription must exist before the member and branch so their limit checks can resolve.
create or replace function public.bootstrap_business()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.subscriptions (business_id, plan_id, status, trial_ends_at)
  values (new.id, 'pro', 'trialing', now() + interval '14 days');
  insert into public.business_members (business_id, user_id, role) values (new.id, new.owner_id, 'owner');
  insert into public.branches (business_id, name, address, invoice_prefix, receipt_footer, is_main)
  values (new.id, 'Main branch', new.address, new.invoice_prefix, new.receipt_footer, true);
  return new;
end
$$;
