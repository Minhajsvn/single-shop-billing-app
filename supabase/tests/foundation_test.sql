-- Foundation tests. Runs inside one transaction and always rolls back.
begin;

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@test.local'),
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@test.local'),
  ('00000000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-c@test.local');

-- 1. Bootstrap: creating a business creates its owner membership and main branch.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
insert into public.businesses (id, owner_id, legal_name, trn, address, phone)
values ('b0000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000a', 'Shop A LLC', '100000000000003', 'Al Barsha, Dubai', '+971500000001');

do $$ begin
  assert (select count(*) from public.business_members where business_id = 'b0000000-0000-4000-8000-00000000000a' and role = 'owner' and status = 'active') = 1, 'owner membership created';
  assert (select count(*) from public.branches where business_id = 'b0000000-0000-4000-8000-00000000000a' and is_main) = 1, 'main branch created';
  assert public.has_role('b0000000-0000-4000-8000-00000000000a', 'cashier'), 'owner satisfies cashier';
  assert public.owns_business('b0000000-0000-4000-8000-00000000000a'), 'owns_business still true for owner';
end $$;

-- 2. Default branch: rows inserted without branch_id get the main branch.
insert into public.devices (id, business_id, name) values ('d0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000a', 'Till 1');
do $$ begin
  assert (select d.branch_id = b.id from public.devices d join public.branches b on b.business_id = d.business_id and b.is_main where d.id = 'd0000000-0000-4000-8000-00000000000a'), 'device assigned to main branch';
end $$;

-- 3. Tenant isolation: owner B sees nothing of business A.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
insert into public.businesses (id, owner_id, legal_name, trn, address, phone)
values ('b0000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000b', 'Shop B LLC', '100000000000004', 'Deira, Dubai', '+971500000002');
do $$ begin
  assert (select count(*) from public.businesses where id = 'b0000000-0000-4000-8000-00000000000a') = 0, 'B cannot read A business';
  assert (select count(*) from public.branches where business_id = 'b0000000-0000-4000-8000-00000000000a') = 0, 'B cannot read A branches';
  assert (select count(*) from public.business_members where business_id = 'b0000000-0000-4000-8000-00000000000a') = 0, 'B cannot read A members';
  assert (select count(*) from public.devices where business_id = 'b0000000-0000-4000-8000-00000000000a') = 0, 'B cannot read A devices';
  assert not public.has_role('b0000000-0000-4000-8000-00000000000a', 'cashier'), 'B has no role in A';
end $$;

-- 3b. Ownership cannot be reassigned, even by the owner (still acting as B).
do $$ begin
  begin
    update public.businesses set owner_id = '00000000-0000-4000-8000-00000000000a' where id = 'b0000000-0000-4000-8000-00000000000b';
    assert false, 'owner_id must not be reassignable';
  exception when others then
    assert sqlerrm = 'owner_id_immutable', format('expected owner_id_immutable, got %s', sqlerrm);
  end;
end $$;

-- 4. Cross-tenant spoof: B cannot attach a device to A's branch.
reset role;
select set_config('test.a_branch', (select id::text from public.branches where business_id = 'b0000000-0000-4000-8000-00000000000a' and is_main), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
do $$ begin
  begin
    insert into public.devices (business_id, branch_id, name) values ('b0000000-0000-4000-8000-00000000000b', current_setting('test.a_branch')::uuid, 'Spoofed till');
    assert false, 'device on another tenant branch must be rejected';
  exception when foreign_key_violation then
    null;
  end;
end $$;
reset role;

-- 5. Country rules: valid tax IDs, consistent country profile, country locked after first invoice.
do $$ begin
  begin
    insert into public.businesses (owner_id, legal_name, trn, address, phone)
    values ('00000000-0000-4000-8000-00000000000c', 'Bad TRN', '12345', 'Dubai', '+971500000009');
    assert false, 'invalid UAE TRN must be rejected';
  exception when check_violation then
    null;
  end;
  begin
    update public.businesses set country = 'SA' where id = 'b0000000-0000-4000-8000-00000000000b';
    assert false, 'SA with AED and a UAE TRN must be rejected';
  exception when check_violation then
    null;
  end;
  assert (select tax_category::text from public.products limit 0) is null, 'tax_category column exists';
end $$;

-- B has no sales yet, so B may still switch country.
update public.businesses set country = 'SA', currency = 'SAR', timezone = 'Asia/Riyadh', trn = '300000000000003' where id = 'b0000000-0000-4000-8000-00000000000b';
update public.businesses set country = 'AE', currency = 'AED', timezone = 'Asia/Dubai', trn = '100000000000004' where id = 'b0000000-0000-4000-8000-00000000000b';

-- A issues an invoice (inserted as the migration owner, as the sync RPCs do), then cannot switch.
insert into public.register_sessions (id, business_id, device_id, business_date, opening_cash_fils, opened_by)
values ('e0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-00000000000a', current_date, 0, '00000000-0000-4000-8000-00000000000a');
insert into public.sales (id, business_id, device_id, register_session_id, invoice_number, operation_id, payment_method, supply_date, supplier_snapshot, net_fils, vat_fils, gross_fils, created_by)
values ('5a000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-00000000000a', 'e0000000-0000-4000-8000-00000000000a', 'T-0001', gen_random_uuid(), 'cash', current_date, '{}'::jsonb, 100, 5, 105, '00000000-0000-4000-8000-00000000000a');

do $$ begin
  assert (select s.branch_id = d.branch_id from public.sales s join public.devices d on d.id = s.device_id where s.id = '5a000000-0000-4000-8000-00000000000a'), 'sale inherits device branch';
  begin
    update public.businesses set country = 'SA', currency = 'SAR', timezone = 'Asia/Riyadh', trn = '300000000000003' where id = 'b0000000-0000-4000-8000-00000000000a';
    assert false, 'country must be locked after the first invoice';
  exception when others then
    assert sqlerrm = 'country_locked', format('expected country_locked, got %s', sqlerrm);
  end;
end $$;

-- 6. Every business has a subscription; new ones start a 14-day Pro trial.
do $$ begin
  assert (select plan_id from public.subscriptions where business_id = 'b0000000-0000-4000-8000-00000000000a') = 'pro', 'trial is on pro';
  assert (select status::text from public.subscriptions where business_id = 'b0000000-0000-4000-8000-00000000000a') = 'trialing', 'trialing';
  assert (select trial_ends_at between now() + interval '13 days 23 hours' and now() + interval '14 days 1 hour' from public.subscriptions where business_id = 'b0000000-0000-4000-8000-00000000000a'), 'trial is 14 days';
  assert not exists (select 1 from public.businesses b left join public.subscriptions s on s.business_id = b.id where s.business_id is null), 'every business has a subscription';
end $$;

-- 7. Limits: Pro trial allows 2 tills; a third is refused.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
insert into public.devices (id, business_id, name) values ('d0000000-0000-4000-8000-0000000000a2', 'b0000000-0000-4000-8000-00000000000a', 'Till 2');
do $$ begin
  begin
    insert into public.devices (business_id, name) values ('b0000000-0000-4000-8000-00000000000a', 'Till 3');
    assert false, 'third till should exceed the Pro trial limit';
  exception when others then
    assert sqlerrm = 'plan_limit_reached', format('expected plan_limit_reached, got %s', sqlerrm);
  end;
end $$;
reset role;

-- 8. Downgrade over the limit keeps existing tills but blocks new ones and re-activation; an add-on lifts it.
update public.subscriptions set plan_id = 'starter', status = 'active' where business_id = 'b0000000-0000-4000-8000-00000000000a';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.devices where business_id = 'b0000000-0000-4000-8000-00000000000a' and status = 'active') = 2, 'existing tills survive downgrade';
  update public.devices set status = 'revoked' where id = 'd0000000-0000-4000-8000-0000000000a2';
  begin
    update public.devices set status = 'active' where id = 'd0000000-0000-4000-8000-0000000000a2';
    assert false, 're-activating beyond the Starter limit must fail';
  exception when others then
    assert sqlerrm = 'plan_limit_reached', format('expected plan_limit_reached, got %s', sqlerrm);
  end;
end $$;
reset role;
update public.subscriptions set addon_tills = 1 where business_id = 'b0000000-0000-4000-8000-00000000000a';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
update public.devices set status = 'active' where id = 'd0000000-0000-4000-8000-0000000000a2';

-- 9. Entitlement access: members only.
do $$ begin
  assert (public.business_entitlements('b0000000-0000-4000-8000-00000000000a') -> 'limits' ->> 'tills')::int = 2, 'starter 1 till + 1 add-on';
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
do $$ begin
  begin
    perform public.business_entitlements('b0000000-0000-4000-8000-00000000000a');
    assert false, 'non-members must not read entitlements';
  exception when insufficient_privilege then
    null;
  end;
end $$;
reset role;

-- 10. Lifecycle, overrides and the trial boundary (resolver evaluated at fixed instants).
do $$
declare
  t timestamptz := '2026-11-01 00:00:00+00';
  a constant uuid := 'b0000000-0000-4000-8000-00000000000a';
begin
  update public.subscriptions set plan_id = 'pro', status = 'trialing', trial_ends_at = t, addon_tills = 0 where business_id = a;
  assert public.entitlements_internal(a, t - interval '1 second') ->> 'access' = 'full', 'trial active before end';
  assert public.entitlements_internal(a, t) ->> 'access' = 'read_only', 'trial ends exactly at trial_ends_at';

  update public.subscriptions set status = 'past_due', grace_ends_at = t where business_id = a;
  assert public.entitlements_internal(a, t - interval '1 day') ->> 'access' = 'full', 'grace period keeps access';
  assert public.entitlements_internal(a, t) ->> 'access' = 'read_only', 'grace expiry is read-only';

  update public.subscriptions set status = 'canceled' where business_id = a;
  assert public.entitlements_internal(a, t - interval '1 day') ->> 'access' = 'read_only', 'canceled is read-only';

  update public.subscriptions set status = 'active', plan_id = 'starter' where business_id = a;
  insert into public.entitlement_overrides (business_id, features, max_tills, note) values (a, array['repairs'], 5, 'pilot deal');
  insert into public.entitlement_overrides (business_id, features, expires_at, note) values (a, array['loyalty'], t - interval '1 day', 'expired promo');
  assert public.entitlements_internal(a, t) -> 'features' ? 'repairs', 'override adds feature';
  assert not (public.entitlements_internal(a, t) -> 'features' ? 'loyalty'), 'expired override ignored';
  assert (public.entitlements_internal(a, t) -> 'limits' ->> 'tills')::int = 5, 'override replaces till limit';

  update public.subscriptions set plan_id = 'enterprise' where business_id = a;
  assert jsonb_typeof(public.entitlements_internal(a, t) -> 'limits' -> 'products') = 'null', 'enterprise products unlimited';
end $$;

-- 11. Sync RPCs can resolve pgcrypto (installed in schema extensions on Supabase).
do $$
declare fn regprocedure;
begin
  for fn in select p.oid::regprocedure from pg_proc p where p.proname in ('apply_customer_sync','apply_sale_sync','apply_register_sync','apply_credit_note_sync','apply_stock_sync') loop
    assert exists (select 1 from pg_proc p, unnest(p.proconfig) c where p.oid = fn and c = 'search_path=public, extensions, pg_temp'), format('%s must have extensions on its search_path', fn);
  end loop;
  assert (select count(*) from pg_proc where proname in ('apply_customer_sync','apply_sale_sync','apply_register_sync','apply_credit_note_sync','apply_stock_sync')) = 5, 'all five sync RPCs exist';
end $$;

rollback;
