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

-- 3c. A branch cannot be moved to another business (still acting as B).
do $$ begin
  begin
    update public.branches set business_id = 'b0000000-0000-4000-8000-00000000000a' where business_id = 'b0000000-0000-4000-8000-00000000000b';
    assert false, 'branch business_id must not be reassignable';
  exception when others then
    assert sqlerrm = 'branch_business_immutable', format('expected branch_business_immutable, got %s', sqlerrm);
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

-- 12. Till numbers: existing and new devices get 1, 2, … per business.
do $$ begin
  assert (select till_number from public.devices where id = 'd0000000-0000-4000-8000-00000000000a') = 1, 'first device is till 1';
  assert (select till_number from public.devices where id = 'd0000000-0000-4000-8000-0000000000a2') = 2, 'second device is till 2';
end $$;

-- 13. sync_device_id: payload device must belong to the business and be active; absent falls back.
do $$
declare
  a constant uuid := 'b0000000-0000-4000-8000-00000000000a';
  b constant uuid := 'b0000000-0000-4000-8000-00000000000b';
begin
  assert public.sync_device_id(a, '{"deviceId":"d0000000-0000-4000-8000-0000000000a2"}'::jsonb) = 'd0000000-0000-4000-8000-0000000000a2', 'explicit device used';
  assert public.sync_device_id(a, '{}'::jsonb) = 'd0000000-0000-4000-8000-00000000000a', 'absent deviceId falls back to oldest active';
  begin
    perform public.sync_device_id(b, '{"deviceId":"d0000000-0000-4000-8000-00000000000a"}'::jsonb);
    assert false, 'foreign device must be rejected';
  exception when others then
    assert sqlerrm = 'sync_device_invalid', format('expected sync_device_invalid, got %s', sqlerrm);
  end;
  update public.devices set status = 'revoked' where id = 'd0000000-0000-4000-8000-0000000000a2';
  begin
    perform public.sync_device_id(a, '{"deviceId":"d0000000-0000-4000-8000-0000000000a2"}'::jsonb);
    assert false, 'revoked device must be rejected';
  exception when others then
    assert sqlerrm = 'sync_device_invalid', format('expected sync_device_invalid, got %s', sqlerrm);
  end;
  update public.devices set status = 'active' where id = 'd0000000-0000-4000-8000-0000000000a2';
  assert not exists (
    select 1 from pg_proc p
    where p.proname in ('apply_customer_sync','apply_sale_sync','apply_register_sync','apply_credit_note_sync','apply_stock_sync')
      and p.prosrc ~ 'order by (d\.)?created_at'
  ), 'no sync RPC still picks the oldest device itself';
end $$;

-- 14. business_entitlements fails closed without a user.
select set_config('request.jwt.claims', '', true);
do $$ begin
  begin
    perform public.business_entitlements('b0000000-0000-4000-8000-00000000000a');
    assert false, 'no auth.uid() must be forbidden';
  exception when others then
    assert sqlerrm = 'forbidden', format('expected forbidden, got %s', sqlerrm);
  end;
end $$;

-- 15. Business settings mirror to the main branch.
update public.businesses set address = 'Mirror Street', invoice_prefix = 'MIR', receipt_footer = 'Mirrored' where id = 'b0000000-0000-4000-8000-00000000000b';
do $$ begin
  assert (select address = 'Mirror Street' and invoice_prefix = 'MIR' and receipt_footer = 'Mirrored'
          from public.branches where business_id = 'b0000000-0000-4000-8000-00000000000b' and is_main), 'main branch mirrors business settings';
end $$;

-- 16. A till number never changes once assigned (invoice numbers embed it).
do $$ begin
  begin
    update public.devices set till_number = 7 where id = 'd0000000-0000-4000-8000-00000000000a';
    assert false, 'till_number must be immutable';
  exception when others then
    assert sqlerrm = 'till_number_immutable', format('expected till_number_immutable, got %s', sqlerrm);
  end;
  update public.devices set name = 'Renamed till' where id = 'd0000000-0000-4000-8000-00000000000a';
  assert (select till_number from public.devices where id = 'd0000000-0000-4000-8000-00000000000a') = 1, 'other device edits still allowed';
end $$;

-- 17. Discounted sale lines keep their list price (UAE tax invoices must show discounts).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select public.apply_sale_sync(
  gen_random_uuid(),
  'b0000000-0000-4000-8000-00000000000a',
  'a1000000-0000-4000-8000-000000000017',
  jsonb_build_object(
    'deviceId', 'd0000000-0000-4000-8000-00000000000a',
    'register', null,
    'sale', jsonb_build_object(
      'id', 'a1000000-0000-4000-8000-000000000017', 'invoiceNumber', 'T17-1', 'status', 'completed',
      'createdAt', now(), 'supplyDate', current_date, 'paymentMethod', 'card',
      'netFils', 230, 'vatFils', 12, 'grossFils', 242,
      'lines', jsonb_build_array(jsonb_build_object(
        'id', 'a1000000-0000-4000-8000-0000000017a1', 'name', 'Discounted', 'quantity', 1,
        'unitGrossFils', 242, 'listUnitGrossFils', 285, 'netFils', 230, 'vatFils', 12, 'grossFils', 242
      ))
    )
  )
);
reset role;
do $$ begin
  assert (select list_unit_gross_fils from public.sale_items where id = 'a1000000-0000-4000-8000-0000000017a1') = 285, 'list price stored';
  begin
    update public.sale_items set list_unit_gross_fils = 100 where id = 'a1000000-0000-4000-8000-0000000017a1';
    assert false, 'list price below the charged price must be rejected';
  exception when check_violation then null;
  end;
end $$;

-- 18. Many products may have no barcode; a real barcode is still unique per business.
reset role;
insert into public.products (id, business_id, name, sku, barcode, price_fils) values
  ('c1800000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-00000000000a', 'No code 1', 'NC-1', null, 100),
  ('c1800000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-00000000000a', 'No code 2', 'NC-2', null, 100),
  ('c1800000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-00000000000a', 'Coded', 'CD-1', '4006381333931', 100);
do $$ begin
  assert (select count(*) from public.products where sku in ('NC-1', 'NC-2') and barcode is null) = 2, 'two blank barcodes allowed';
  begin
    insert into public.products (business_id, name, sku, barcode, price_fils) values ('b0000000-0000-4000-8000-00000000000a', 'Dup', 'CD-2', '4006381333931', 100);
    assert false, 'duplicate barcode must be rejected';
  exception when unique_violation then null;
  end;
end $$;

-- 19. apply_product_sync: create at stock 0, update fields but never stock, idempotent, named rejections.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select public.apply_product_sync(
  'e1900000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-00000000000a', 'c1900000-0000-4000-8000-000000000001',
  jsonb_build_object('deviceId', 'd0000000-0000-4000-8000-00000000000a', 'product', jsonb_build_object(
    'id', 'c1900000-0000-4000-8000-000000000001', 'name', 'Synced tea', 'sku', 'TEA-19', 'priceFils', 500,
    'lowStockThreshold', 2, 'active', true, 'taxCategory', 'standard'))
);
reset role;
update public.products set stock_quantity = 9 where id = 'c1900000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select public.apply_product_sync(
  'e1900000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-00000000000a', 'c1900000-0000-4000-8000-000000000001',
  jsonb_build_object('product', jsonb_build_object(
    'id', 'c1900000-0000-4000-8000-000000000001', 'name', 'Green tea', 'sku', 'TEA-19', 'barcode', '', 'priceFils', 650,
    'lowStockThreshold', 3, 'active', true, 'taxCategory', 'zero'))
);
-- Same operation again is a no-op.
select public.apply_product_sync(
  'e1900000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-00000000000a', 'c1900000-0000-4000-8000-000000000001',
  jsonb_build_object('product', jsonb_build_object(
    'id', 'c1900000-0000-4000-8000-000000000001', 'name', 'Green tea', 'sku', 'TEA-19', 'barcode', '', 'priceFils', 650,
    'lowStockThreshold', 3, 'active', true, 'taxCategory', 'zero'))
);
do $$
declare failure text;
begin
  assert (select name = 'Green tea' and price_fils = 650 and tax_category = 'zero' and stock_quantity = 9 and barcode is null
    from public.products where id = 'c1900000-0000-4000-8000-000000000001'), 'update applied, stock untouched';
  begin
    perform public.apply_product_sync(gen_random_uuid(), 'b0000000-0000-4000-8000-00000000000a', 'c1900000-0000-4000-8000-000000000002',
      jsonb_build_object('product', jsonb_build_object('id', 'c1900000-0000-4000-8000-000000000002', 'name', 'Clash', 'sku', 'tea-19',
        'priceFils', 100, 'lowStockThreshold', 0, 'active', true, 'taxCategory', 'standard')));
    assert false, 'SKU clash must be rejected';
  exception when others then failure := sqlerrm;
  end;
  assert failure = 'product_sku_taken', 'named sku rejection, got ' || coalesce(failure, 'null');
  failure := null;
  begin
    perform public.apply_product_sync(gen_random_uuid(), 'b0000000-0000-4000-8000-00000000000a', 'c1900000-0000-4000-8000-000000000003',
      jsonb_build_object('product', jsonb_build_object('id', 'c1900000-0000-4000-8000-000000000003', 'name', 'Clash', 'sku', 'CL-19',
        'barcode', '4006381333931', 'priceFils', 100, 'lowStockThreshold', 0, 'active', true, 'taxCategory', 'standard')));
    assert false, 'barcode clash must be rejected';
  exception when others then failure := sqlerrm;
  end;
  assert failure = 'product_barcode_taken', 'named barcode rejection, got ' || coalesce(failure, 'null');
end $$;
reset role;
insert into public.products (id, business_id, name, sku, price_fils) values ('c1900000-0000-4000-8000-0000000000bb', 'b0000000-0000-4000-8000-00000000000b', 'B item', 'B-19', 100);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
do $$
declare failure text;
begin
  begin
    perform public.apply_product_sync(gen_random_uuid(), 'b0000000-0000-4000-8000-00000000000a', 'c1900000-0000-4000-8000-0000000000bb',
      jsonb_build_object('product', jsonb_build_object('id', 'c1900000-0000-4000-8000-0000000000bb', 'name', 'Steal', 'sku', 'ST-19',
        'priceFils', 100, 'lowStockThreshold', 0, 'active', true, 'taxCategory', 'standard')));
    assert false, 'cross-business id must be rejected';
  exception when others then failure := sqlerrm;
  end;
  assert failure = 'product_belongs_to_another_business', 'cross-business rejection, got ' || coalesce(failure, 'null');
end $$;

-- 20. Import counts set absolute stock even after another till's sale.
reset role;
update public.products set stock_quantity = 10 where id = 'c1900000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select public.apply_sale_sync(
  gen_random_uuid(), 'b0000000-0000-4000-8000-00000000000a', 'a2000000-0000-4000-8000-000000000020',
  jsonb_build_object(
    'deviceId', 'd0000000-0000-4000-8000-00000000000a', 'register', null,
    'sale', jsonb_build_object(
      'id', 'a2000000-0000-4000-8000-000000000020', 'invoiceNumber', 'T20-1', 'status', 'completed',
      'createdAt', now(), 'supplyDate', current_date, 'paymentMethod', 'card',
      'netFils', 1857, 'vatFils', 93, 'grossFils', 1950,
      'lines', jsonb_build_array(jsonb_build_object(
        'id', 'a2000000-0000-4000-8000-0000000020a1', 'productId', 'c1900000-0000-4000-8000-000000000001', 'name', 'Green tea',
        'sku', 'TEA-19', 'quantity', 3, 'unitGrossFils', 650, 'netFils', 1857, 'vatFils', 93, 'grossFils', 1950
      ))
    )
  )
);
select public.apply_stock_sync(
  'e2000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-00000000000a', 'f2000000-0000-4000-8000-000000000001',
  jsonb_build_object('countedStock', 40, 'movement', jsonb_build_object(
    'id', 'f2000000-0000-4000-8000-000000000001', 'productId', 'c1900000-0000-4000-8000-000000000001', 'delta', 30,
    'type', 'import-count', 'reason', 'Spreadsheet import', 'createdAt', now()))
);
select public.apply_stock_sync(
  'e2000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-00000000000a', 'f2000000-0000-4000-8000-000000000002',
  jsonb_build_object('countedStock', 40, 'movement', jsonb_build_object(
    'id', 'f2000000-0000-4000-8000-000000000002', 'productId', 'c1900000-0000-4000-8000-000000000001', 'delta', 1,
    'type', 'import-count', 'reason', 'Spreadsheet import', 'createdAt', now()))
);
do $$ begin
  assert (select stock_quantity from public.products where id = 'c1900000-0000-4000-8000-000000000001') = 40, 'stock set to the count';
  assert (select quantity_delta from public.stock_movements where id = 'f2000000-0000-4000-8000-000000000001') = 33, 'difference recorded against server stock';
  assert (select type::text from public.stock_movements where id = 'f2000000-0000-4000-8000-000000000001') = 'import_count', 'import_count type';
  assert not exists (select 1 from public.stock_movements where id = 'f2000000-0000-4000-8000-000000000002'), 'unchanged count writes no movement';
  assert exists (select 1 from public.sync_operations where operation_id = 'e2000000-0000-4000-8000-000000000002' and status = 'accepted'), 'unchanged count still accepted';
end $$;

-- 22. A stock movement without a product copy resolves the product by id.
select public.apply_stock_sync(
  gen_random_uuid(), 'b0000000-0000-4000-8000-00000000000a', 'f2200000-0000-4000-8000-000000000001',
  jsonb_build_object('movement', jsonb_build_object(
    'id', 'f2200000-0000-4000-8000-000000000001', 'productId', 'c1900000-0000-4000-8000-000000000001', 'delta', 5,
    'type', 'receipt', 'reason', 'Delivery', 'createdAt', now()))
);
do $$ begin
  assert (select stock_quantity from public.products where id = 'c1900000-0000-4000-8000-000000000001') = 45, 'slim receipt applied';
end $$;

-- 21. The Starter product limit surfaces through apply_product_sync.
reset role;
update public.subscriptions set plan_id = 'starter', status = 'active' where business_id = 'b0000000-0000-4000-8000-00000000000a';
update public.plan_catalog set max_products = (select count(*) from public.products where business_id = 'b0000000-0000-4000-8000-00000000000a' and status = 'active') where id = 'starter';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
do $$
declare failure text;
begin
  begin
    perform public.apply_product_sync(gen_random_uuid(), 'b0000000-0000-4000-8000-00000000000a', 'c2100000-0000-4000-8000-000000000001',
      jsonb_build_object('product', jsonb_build_object('id', 'c2100000-0000-4000-8000-000000000001', 'name', 'One too many', 'sku', 'OVER-21',
        'priceFils', 100, 'lowStockThreshold', 0, 'active', true, 'taxCategory', 'standard')));
    assert false, 'over the plan limit must be rejected';
  exception when others then failure := sqlerrm;
  end;
  assert failure = 'plan_limit_reached', 'plan limit rejection, got ' || coalesce(failure, 'null');
end $$;
-- At the limit, editing an existing active product must still work (an upsert's INSERT trigger must not fire).
select public.apply_product_sync(
  gen_random_uuid(), 'b0000000-0000-4000-8000-00000000000a', 'c1900000-0000-4000-8000-000000000001',
  jsonb_build_object('product', jsonb_build_object(
    'id', 'c1900000-0000-4000-8000-000000000001', 'name', 'Green tea', 'sku', 'TEA-19', 'priceFils', 700,
    'lowStockThreshold', 3, 'active', true, 'taxCategory', 'zero'))
);
do $$ begin
  assert (select price_fils from public.products where id = 'c1900000-0000-4000-8000-000000000001') = 700, 'edit at the plan limit applied';
end $$;
reset role;

-- 23. Server sales search (owner only): invoice, customer name, phone in any format, date range; sale detail.
reset role;
update public.sales set customer_snapshot = jsonb_build_object('id', 'c2300000-0000-4000-8000-000000000001', 'name', 'Omar Hassan', 'phone', '+971 55 555 0198')
where invoice_number = 'T17-1';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
do $$
declare found_count bigint;
begin
  select total_count into found_count from public.search_sales('b0000000-0000-4000-8000-00000000000a', 'T17', null, current_date, 50, 0) limit 1;
  assert found_count = 1, 'invoice search finds T17-1, got ' || coalesce(found_count::text, 'null');
  assert (select invoice_number from public.search_sales('b0000000-0000-4000-8000-00000000000a', 'omar', null, current_date, 50, 0) limit 1) = 'T17-1', 'name search';
  assert (select invoice_number from public.search_sales('b0000000-0000-4000-8000-00000000000a', '0555550198', null, current_date, 50, 0) limit 1) = 'T17-1', 'phone search ignores formatting';
  assert (select customer_phone from public.search_sales('b0000000-0000-4000-8000-00000000000a', '55-555-0198', null, current_date, 50, 0) limit 1) = '+971 55 555 0198', 'phone returned as stored';
  assert not exists (select 1 from public.search_sales('b0000000-0000-4000-8000-00000000000a', '', current_date + 1, current_date + 1, 50, 0)), 'date range excludes everything';
  assert (select count(*) from public.search_sales('b0000000-0000-4000-8000-00000000000a', '', null, current_date, 500, 0)) <= 50, 'limit capped at 50';
  assert (public.get_sale_detail('b0000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-000000000017')->>'invoice_number') = 'T17-1', 'detail returns the sale';
  assert jsonb_array_length(public.get_sale_detail('b0000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-000000000017')->'sale_items') = 1, 'detail returns its items';
  assert public.get_sale_detail('b0000000-0000-4000-8000-00000000000a', gen_random_uuid()) is null, 'unknown sale is null';
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
do $$
declare failure text;
begin
  begin
    perform public.search_sales('b0000000-0000-4000-8000-00000000000a', '', null, current_date, 50, 0);
    assert false, 'another owner must not search business A';
  exception when others then failure := sqlerrm;
  end;
  assert failure = 'not_authorized', 'search guard, got ' || coalesce(failure, 'null');
  failure := null;
  begin
    perform public.get_sale_detail('b0000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-000000000017');
    assert false, 'another owner must not read business A sales';
  exception when others then failure := sqlerrm;
  end;
  assert failure = 'not_authorized', 'detail guard, got ' || coalesce(failure, 'null');
end $$;
reset role;

-- 24a. apply_billing_event (service_role): lifecycle transitions, duplicate and out-of-order protection.
reset role;
insert into public.businesses (id, owner_id, legal_name, trn, address, phone)
values ('b2400000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000c', 'Shop C LLC', '100000000000005', 'Karama, Dubai', '+971500000024');
set local role service_role;
do $$
declare
  biz constant uuid := 'b2400000-0000-4000-8000-000000000001';
  -- Stripe's $0 trial-start invoice; it can arrive before checkout links the subscription id.
  trial_invoice constant jsonb := jsonb_build_object(
    'id', 'evt_24_trial_invoice', 'created', now() - interval '45 minutes', 'kind', 'invoice_paid',
    'businessId', null, 'customerId', null, 'subscriptionId', 'sub_24', 'status', 'trialing',
    'trialEnd', null, 'currentPeriodEnd', now() + interval '20 days', 'cancelAt', null, 'interval', 'month');
  sub public.subscriptions;
  result text;
begin
  select * into sub from public.subscriptions where business_id = biz;
  assert sub.status = 'trialing' and sub.plan_id = 'pro' and not sub.has_payment_method, 'new business starts on the Pro trial without a card';

  result := public.apply_billing_event(trial_invoice);
  assert result = 'unknown_business', 'unlinked subscription id is unknown, got ' || coalesce(result, 'null');
  assert not exists (select 1 from public.stripe_events where id = 'evt_24_trial_invoice'), 'unknown-business event is not kept, so a redelivery is applied';

  result := public.apply_billing_event(jsonb_build_object(
    'id', 'evt_24_checkout', 'created', now() - interval '50 minutes', 'kind', 'checkout_completed',
    'businessId', biz, 'customerId', 'cus_24', 'subscriptionId', 'sub_24', 'status', 'trialing',
    'trialEnd', sub.trial_ends_at, 'currentPeriodEnd', sub.trial_ends_at, 'cancelAt', null, 'interval', 'month'));
  assert result = 'applied', 'checkout applied, got ' || coalesce(result, 'null');
  select * into sub from public.subscriptions where business_id = biz;
  assert sub.status = 'trialing' and sub.plan_id = 'pro', 'paying during the trial stays on the Pro trial';
  assert sub.has_payment_method and sub.billing_interval = 'month', 'card and interval recorded';
  assert sub.stripe_customer_id = 'cus_24' and sub.stripe_subscription_id = 'sub_24', 'Stripe ids stored';

  -- Redelivery after checkout linked the ids is applied; the $0 invoice keeps the Pro trial.
  result := public.apply_billing_event(trial_invoice);
  assert result = 'applied', 'redelivered trial invoice applied, got ' || coalesce(result, 'null');
  select * into sub from public.subscriptions where business_id = biz;
  assert sub.status = 'trialing' and sub.plan_id = 'pro' and sub.has_payment_method, 'trial-start invoice keeps the Pro trial';
  assert sub.current_period_end = now() + interval '20 days' and sub.last_event_at = now() - interval '45 minutes', 'trial invoice stores only the period end';
end $$;

-- The trial has ended; the first real invoice moves the shop to Starter.
reset role;
update public.subscriptions set trial_ends_at = now() - interval '1 hour' where business_id = 'b2400000-0000-4000-8000-000000000001';
set local role service_role;
do $$
declare
  biz constant uuid := 'b2400000-0000-4000-8000-000000000001';
  sub public.subscriptions;
  result text;
begin
  -- Resolved by subscription id only.
  result := public.apply_billing_event(jsonb_build_object(
    'id', 'evt_24_paid_1', 'created', now() - interval '40 minutes', 'kind', 'invoice_paid',
    'businessId', null, 'customerId', null, 'subscriptionId', 'sub_24', 'status', 'active',
    'trialEnd', null, 'currentPeriodEnd', now() + interval '30 days', 'cancelAt', null, 'interval', 'month'));
  assert result = 'applied', 'invoice_paid applied, got ' || coalesce(result, 'null');
  select * into sub from public.subscriptions where business_id = biz;
  assert sub.status = 'active' and sub.plan_id = 'starter', 'paid invoice makes the shop active on Starter';
  assert sub.current_period_end = now() + interval '30 days', 'period end stored';

  -- Resolved by customer id only.
  result := public.apply_billing_event(jsonb_build_object(
    'id', 'evt_24_failed_1', 'created', now() - interval '30 minutes', 'kind', 'payment_failed',
    'businessId', null, 'customerId', 'cus_24', 'subscriptionId', null, 'status', 'past_due',
    'trialEnd', null, 'currentPeriodEnd', null, 'cancelAt', null, 'interval', null));
  assert result = 'applied', 'payment_failed applied, got ' || coalesce(result, 'null');
  select * into sub from public.subscriptions where business_id = biz;
  assert sub.status = 'past_due', 'failed payment makes the shop past_due';
  assert sub.grace_ends_at between now() + interval '7 days' - interval '1 minute' and now() + interval '7 days' + interval '1 minute', 'grace is about seven days';
end $$;

-- A known grace end proves the second failure leaves it alone (now() is constant inside the transaction).
reset role;
update public.subscriptions set grace_ends_at = now() + interval '5 days' where business_id = 'b2400000-0000-4000-8000-000000000001';
set local role service_role;
do $$
declare
  biz constant uuid := 'b2400000-0000-4000-8000-000000000001';
  failed_again constant jsonb := jsonb_build_object(
    'id', 'evt_24_failed_2', 'created', now() - interval '20 minutes', 'kind', 'payment_failed',
    'businessId', null, 'customerId', 'cus_24', 'subscriptionId', 'sub_24', 'status', 'past_due',
    'trialEnd', null, 'currentPeriodEnd', null, 'cancelAt', null, 'interval', null);
  sub public.subscriptions;
  result text;
begin
  result := public.apply_billing_event(failed_again);
  assert result = 'applied', 'second failure applied, got ' || coalesce(result, 'null');
  select * into sub from public.subscriptions where business_id = biz;
  assert sub.status = 'past_due' and sub.grace_ends_at = now() + interval '5 days', 'grace is set once per failure episode';

  result := public.apply_billing_event(failed_again);
  assert result = 'duplicate', 'same event id again is a duplicate, got ' || coalesce(result, 'null');

  result := public.apply_billing_event(jsonb_build_object(
    'id', 'evt_24_changed_old', 'created', now() - interval '45 minutes', 'kind', 'subscription_changed',
    'businessId', null, 'customerId', 'cus_24', 'subscriptionId', 'sub_24', 'status', 'active',
    'trialEnd', null, 'currentPeriodEnd', now() + interval '30 days', 'cancelAt', null, 'interval', 'year'));
  assert result = 'stale', 'an event older than the last applied one is stale, got ' || coalesce(result, 'null');
  select * into sub from public.subscriptions where business_id = biz;
  assert sub.status = 'past_due' and sub.billing_interval = 'month', 'stale event changes nothing';
  assert exists (select 1 from public.stripe_events where id = 'evt_24_changed_old'), 'stale event id is still recorded';

  result := public.apply_billing_event(jsonb_build_object(
    'id', 'evt_24_paid_2', 'created', now() - interval '10 minutes', 'kind', 'invoice_paid',
    'businessId', null, 'customerId', 'cus_24', 'subscriptionId', 'sub_24', 'status', 'active',
    'trialEnd', null, 'currentPeriodEnd', now() + interval '31 days', 'cancelAt', null, 'interval', 'month'));
  assert result = 'applied', 'recovery invoice applied, got ' || coalesce(result, 'null');
  select * into sub from public.subscriptions where business_id = biz;
  assert sub.status = 'active' and sub.grace_ends_at is null, 'paying ends the grace period';

  result := public.apply_billing_event(jsonb_build_object(
    'id', 'evt_24_deleted', 'created', now() - interval '1 minute', 'kind', 'subscription_deleted',
    'businessId', null, 'customerId', 'cus_24', 'subscriptionId', 'sub_24', 'status', 'canceled',
    'trialEnd', null, 'currentPeriodEnd', null, 'cancelAt', null, 'interval', null));
  assert result = 'applied', 'deletion applied, got ' || coalesce(result, 'null');
  select * into sub from public.subscriptions where business_id = biz;
  assert sub.status = 'canceled' and sub.canceled_at = now() - interval '1 minute' and sub.cancel_at is null, 'deleted subscription is canceled at the event time';
  assert sub.last_event_at = now() - interval '1 minute', 'last_event_at tracks the newest applied event';

  result := public.apply_billing_event(jsonb_build_object(
    'id', 'evt_24_nobody', 'created', now(), 'kind', 'invoice_paid',
    'businessId', null, 'customerId', 'cus_nobody', 'subscriptionId', 'sub_nobody', 'status', 'active',
    'trialEnd', null, 'currentPeriodEnd', null, 'cancelAt', null, 'interval', null));
  assert result = 'unknown_business', 'no matching business, got ' || coalesce(result, 'null');
  assert not exists (select 1 from public.stripe_events where id = 'evt_24_nobody'), 'unknown-business event is not recorded';
end $$;
reset role;

-- 24b. entitlements_internal uses the access end; apply_billing_event is service_role only.
reset role;
do $$
declare
  biz constant uuid := 'b2400000-0000-4000-8000-000000000001';
  trial_end timestamptz := now() + interval '3 days';
  grace_end timestamptz := now() + interval '7 days';
  e jsonb;
begin
  update public.subscriptions set status = 'trialing', plan_id = 'pro', has_payment_method = true, trial_ends_at = trial_end,
    grace_ends_at = null, canceled_at = null where business_id = biz;
  e := public.entitlements_internal(biz, trial_end + interval '1 day');
  assert e->>'access' = 'full', 'trial with a card keeps full access one day after the trial end';
  assert (e->>'hasPaymentMethod')::boolean and (e->>'accessEndsAt')::timestamptz = trial_end + interval '2 days', 'trial with a card ends two days after the trial';
  assert e ? 'cancelAt' and e->>'billingInterval' = 'month', 'new keys present';
  update public.subscriptions set status = 'active', plan_id = 'starter', current_period_end = trial_end + interval '1 month' where business_id = biz;
  assert (public.entitlements_internal(biz, now())->>'currentPeriodEnd')::timestamptz = trial_end + interval '1 month', 'active entitlements carry the period end (the renewal date)';
  update public.subscriptions set status = 'trialing', plan_id = 'pro', current_period_end = null where business_id = biz;
  assert e->>'access' is not null and e ? 'trialEndsAt' and e ? 'graceEndsAt' and e ? 'limits' and e ? 'features', 'existing keys kept';
  assert public.entitlements_internal(biz, trial_end + interval '3 days')->>'access' = 'read_only', 'trial with a card is read-only three days after the trial end';

  update public.subscriptions set has_payment_method = false where business_id = biz;
  assert public.entitlements_internal(biz, trial_end + interval '1 day')->>'access' = 'read_only', 'trial without a card ends at the trial end';

  update public.subscriptions set trial_ends_at = null where business_id = biz;
  assert public.entitlements_internal(biz, now())->>'access' = 'read_only', 'trialing without a trial end is read-only';

  update public.subscriptions set status = 'canceled', canceled_at = now() - interval '1 minute' where business_id = biz;
  assert public.entitlements_internal(biz, now())->>'access' = 'read_only', 'canceled is read-only';
  update public.subscriptions set canceled_at = null where business_id = biz;
  e := public.entitlements_internal(biz, now());
  assert e->>'access' = 'read_only', 'canceled without a date is read-only';
  assert (e->>'accessEndsAt')::timestamptz = '1970-01-01T00:00:00Z'::timestamptz, 'missing cancel date is emitted as the epoch, got ' || coalesce(e->>'accessEndsAt', 'null');

  update public.subscriptions set status = 'past_due', grace_ends_at = null where business_id = biz;
  e := public.entitlements_internal(biz, now());
  assert e->>'access' = 'read_only', 'past_due without a grace end is read-only';
  assert (e->>'accessEndsAt')::timestamptz = '1970-01-01T00:00:00Z'::timestamptz, 'missing grace end is emitted as the epoch, got ' || coalesce(e->>'accessEndsAt', 'null');

  update public.subscriptions set status = 'past_due', grace_ends_at = grace_end where business_id = biz;
  e := public.entitlements_internal(biz, now());
  assert e->>'access' = 'full', 'past_due before the grace end keeps full access';
  assert (e->>'accessEndsAt')::timestamptz = grace_end, 'accessEndsAt is the grace end for past_due';
  assert public.entitlements_internal(biz, grace_end + interval '1 minute')->>'access' = 'read_only', 'past_due after the grace end is read-only';

  update public.subscriptions set status = 'active', grace_ends_at = null where business_id = biz;
  e := public.entitlements_internal(biz, now() + interval '10 years');
  assert e->>'access' = 'full' and e->'accessEndsAt' = 'null'::jsonb, 'active has no access end';
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
do $$
declare failure text;
begin
  begin
    perform public.apply_billing_event(jsonb_build_object('id', 'evt_24_forged', 'created', now(), 'kind', 'invoice_paid',
      'businessId', 'b2400000-0000-4000-8000-000000000001'));
    assert false, 'authenticated must not apply billing events';
  exception when others then failure := sqlstate;
  end;
  assert failure = '42501', 'apply_billing_event is service_role only, got ' || coalesce(failure, 'null');
end $$;
reset role;

-- 24c. Read-only applies at register open only: a shift opened before the access end keeps working (within 72 hours).
reset role;
update public.subscriptions set status = 'trialing', plan_id = 'pro', has_payment_method = false,
  trial_ends_at = now() - interval '6 hours', grace_ends_at = null, canceled_at = null, addon_tills = 0
where business_id = 'b2400000-0000-4000-8000-000000000001';
insert into public.devices (id, business_id, name) values ('d2400000-0000-4000-8000-00000000000a', 'b2400000-0000-4000-8000-000000000001', 'Till A');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
do $$
declare
  biz constant uuid := 'b2400000-0000-4000-8000-000000000001';
  till constant text := 'd2400000-0000-4000-8000-00000000000a';
  session_id constant uuid := 'e2400000-0000-4000-8000-0000000000c1';
  failure text;
begin
  perform public.apply_register_sync(gen_random_uuid(), biz, session_id, jsonb_build_object(
    'deviceId', till, 'action', 'open',
    'register', jsonb_build_object('openingCashFils', 0, 'openedAt', now() - interval '9 hours')));
  assert exists (select 1 from public.register_sessions where id = session_id and status = 'open'), 'shift opened before the access end is accepted';

  perform public.apply_sale_sync(gen_random_uuid(), biz, 'a2400000-0000-4000-8000-0000000000c1', jsonb_build_object(
    'deviceId', till, 'register', null,
    'sale', jsonb_build_object(
      'id', 'a2400000-0000-4000-8000-0000000000c1', 'invoiceNumber', 'T24C-1', 'status', 'completed',
      'createdAt', now(), 'supplyDate', current_date, 'paymentMethod', 'card',
      'netFils', 100, 'vatFils', 5, 'grossFils', 105,
      'lines', jsonb_build_array(jsonb_build_object(
        'id', 'a2400000-0000-4000-8000-0000000c1a01', 'name', 'Item', 'quantity', 1,
        'unitGrossFils', 105, 'netFils', 100, 'vatFils', 5, 'grossFils', 105)))));
  assert (select register_session_id from public.sales where id = 'a2400000-0000-4000-8000-0000000000c1') = session_id, 'sale on the running shift is accepted';

  perform public.apply_register_sync(gen_random_uuid(), biz, gen_random_uuid(), jsonb_build_object(
    'deviceId', till, 'action', 'close',
    'register', jsonb_build_object('countedCashFils', 0, 'closedAt', now())));
  assert (select status::text from public.register_sessions where id = session_id) = 'closed', 'closing the running shift is accepted';

  begin
    perform public.apply_register_sync(gen_random_uuid(), biz, 'e2400000-0000-4000-8000-0000000000c2', jsonb_build_object(
      'deviceId', till, 'action', 'open',
      'register', jsonb_build_object('openingCashFils', 0, 'openedAt', now() - interval '1 hour')));
    assert false, 'a new shift after the access end must be refused';
  exception when others then failure := sqlerrm;
  end;
  assert failure = 'read_only', 'new open after the end is read_only, got ' || coalesce(failure, 'null');

  failure := null;
  begin
    perform public.apply_sale_sync(gen_random_uuid(), biz, 'a2400000-0000-4000-8000-0000000000c2', jsonb_build_object(
      'deviceId', till, 'register', null,
      'sale', jsonb_build_object(
        'id', 'a2400000-0000-4000-8000-0000000000c2', 'invoiceNumber', 'T24C-2', 'status', 'completed',
        'createdAt', now(), 'supplyDate', current_date, 'paymentMethod', 'card',
        'netFils', 100, 'vatFils', 5, 'grossFils', 105,
        'lines', jsonb_build_array(jsonb_build_object(
          'id', 'a2400000-0000-4000-8000-0000000c2a01', 'name', 'Item', 'quantity', 1,
          'unitGrossFils', 105, 'netFils', 100, 'vatFils', 5, 'grossFils', 105)))));
    assert false, 'a sale that opens a session after the access end must be refused';
  exception when others then failure := sqlerrm;
  end;
  assert failure = 'read_only', 'implicit session after the end is read_only, got ' || coalesce(failure, 'null');

  -- The shift's open op never reached the server, but the sale carries the real open time (before the end).
  perform public.apply_sale_sync(gen_random_uuid(), biz, 'a2400000-0000-4000-8000-0000000000c3', jsonb_build_object(
    'deviceId', till, 'register', jsonb_build_object('openingCashFils', 0, 'openedAt', now() - interval '8 hours'),
    'sale', jsonb_build_object(
      'id', 'a2400000-0000-4000-8000-0000000000c3', 'invoiceNumber', 'T24C-3', 'status', 'completed',
      'createdAt', now(), 'supplyDate', current_date, 'paymentMethod', 'card',
      'netFils', 100, 'vatFils', 5, 'grossFils', 105,
      'lines', jsonb_build_array(jsonb_build_object(
        'id', 'a2400000-0000-4000-8000-0000000c3a01', 'name', 'Item', 'quantity', 1,
        'unitGrossFils', 105, 'netFils', 100, 'vatFils', 5, 'grossFils', 105)))));
  assert (select rs.opened_at from public.sales s join public.register_sessions rs on rs.id = s.register_session_id
          where s.id = 'a2400000-0000-4000-8000-0000000000c3') = now() - interval '8 hours',
    'implicit session from a sale keeps the real open time and is accepted';
  perform public.apply_register_sync(gen_random_uuid(), biz, gen_random_uuid(), jsonb_build_object(
    'deviceId', till, 'action', 'close',
    'register', jsonb_build_object('countedCashFils', 0, 'closedAt', now())));
end $$;
reset role;
update public.subscriptions set trial_ends_at = now() - interval '73 hours' where business_id = 'b2400000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
do $$
declare failure text;
begin
  begin
    perform public.apply_register_sync(gen_random_uuid(), 'b2400000-0000-4000-8000-000000000001', 'e2400000-0000-4000-8000-0000000000c3', jsonb_build_object(
      'deviceId', 'd2400000-0000-4000-8000-00000000000a', 'action', 'open',
      'register', jsonb_build_object('openingCashFils', 0, 'openedAt', now() - interval '76 hours')));
    assert false, 'a backdated shift arriving more than 72 hours after the end must be refused';
  exception when others then failure := sqlerrm;
  end;
  assert failure = 'read_only', 'backdated open after 72 hours is read_only, got ' || coalesce(failure, 'null');
end $$;
reset role;

-- 24d. Choosing the till that stays pauses the others; a paused till finishes a shift opened before the pause
-- (arriving within 72 hours) but cannot open a new one.
update public.subscriptions set trial_ends_at = now() + interval '10 days' where business_id = 'b2400000-0000-4000-8000-000000000001';
insert into public.devices (id, business_id, name) values ('d2400000-0000-4000-8000-00000000000b', 'b2400000-0000-4000-8000-000000000001', 'Till B');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
do $$
declare
  biz constant uuid := 'b2400000-0000-4000-8000-000000000001';
  till_a constant uuid := 'd2400000-0000-4000-8000-00000000000a';
  till_b constant text := 'd2400000-0000-4000-8000-00000000000b';
  session_b constant uuid := 'e2400000-0000-4000-8000-0000000000d1';
  paused integer;
  failure text;
begin
  paused := public.choose_active_till(biz, till_a);
  assert paused = 1, 'one other till paused, got ' || coalesce(paused::text, 'null');
  assert (select status::text = 'paused' and paused_at = now() from public.devices where id = till_b::uuid), 'till B is paused now';
  assert (select status::text = 'active' and paused_at is null from public.devices where id = till_a), 'kept till stays active';

  -- Till B opened its shift offline before the pause; the open op arrives after it.
  perform public.apply_register_sync(gen_random_uuid(), biz, session_b, jsonb_build_object(
    'deviceId', till_b, 'action', 'open',
    'register', jsonb_build_object('openingCashFils', 0, 'openedAt', now() - interval '1 hour')));
  assert exists (select 1 from public.register_sessions where id = session_b and status = 'open'), 'shift opened before the pause is accepted';

  perform public.apply_sale_sync(gen_random_uuid(), biz, 'a2400000-0000-4000-8000-0000000000d1', jsonb_build_object(
    'deviceId', till_b, 'register', null,
    'sale', jsonb_build_object(
      'id', 'a2400000-0000-4000-8000-0000000000d1', 'invoiceNumber', 'T24D-1', 'status', 'completed',
      'createdAt', now(), 'supplyDate', current_date, 'paymentMethod', 'card',
      'netFils', 100, 'vatFils', 5, 'grossFils', 105,
      'lines', jsonb_build_array(jsonb_build_object(
        'id', 'a2400000-0000-4000-8000-0000000d1a01', 'name', 'Item', 'quantity', 1,
        'unitGrossFils', 105, 'netFils', 100, 'vatFils', 5, 'grossFils', 105)))));
  assert (select register_session_id from public.sales where id = 'a2400000-0000-4000-8000-0000000000d1') = session_b, 'paused till sale on its running shift is accepted';

  perform public.apply_register_sync(gen_random_uuid(), biz, gen_random_uuid(), jsonb_build_object(
    'deviceId', till_b, 'action', 'close',
    'register', jsonb_build_object('countedCashFils', 0, 'closedAt', now())));
  assert (select status::text from public.register_sessions where id = session_b) = 'closed', 'paused till closes its running shift';

  begin
    perform public.apply_register_sync(gen_random_uuid(), biz, 'e2400000-0000-4000-8000-0000000000d2', jsonb_build_object(
      'deviceId', till_b, 'action', 'open',
      'register', jsonb_build_object('openingCashFils', 0, 'openedAt', now() + interval '1 minute')));
    assert false, 'a paused till must not open a new shift';
  exception when others then failure := sqlerrm;
  end;
  assert failure = 'till_paused', 'new open on a paused till is till_paused, got ' || coalesce(failure, 'null');
end $$;
reset role;
-- Fixture only: move the pause 73 hours back. The trigger keeps paused_at server-stamped, so it is bypassed here.
alter table public.devices disable trigger device_paused_at;
update public.devices set paused_at = now() - interval '73 hours' where id = 'd2400000-0000-4000-8000-00000000000b';
alter table public.devices enable trigger device_paused_at;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
do $$
declare failure text;
begin
  begin
    perform public.apply_register_sync(gen_random_uuid(), 'b2400000-0000-4000-8000-000000000001', 'e2400000-0000-4000-8000-0000000000d3', jsonb_build_object(
      'deviceId', 'd2400000-0000-4000-8000-00000000000b', 'action', 'open',
      'register', jsonb_build_object('openingCashFils', 0, 'openedAt', now() - interval '74 hours')));
    assert false, 'a backdated shift arriving more than 72 hours after the pause must be refused';
  exception when others then failure := sqlerrm;
  end;
  assert failure = 'till_paused', 'backdated open after 72 hours is till_paused, got ' || coalesce(failure, 'null');
end $$;
reset role;
do $$ begin
  assert public.sync_device_id('b2400000-0000-4000-8000-000000000001', '{}'::jsonb) = 'd2400000-0000-4000-8000-00000000000a', 'fallback device selection ignores paused tills';
  -- Pro trial allows 2 tills; the paused till does not count, so one more active till fits and a second does not.
  insert into public.devices (id, business_id, name) values ('d2400000-0000-4000-8000-0000000000c3', 'b2400000-0000-4000-8000-000000000001', 'Till C');
  begin
    insert into public.devices (business_id, name) values ('b2400000-0000-4000-8000-000000000001', 'Till D');
    assert false, 'a third active till must exceed the Pro trial limit';
  exception when others then
    assert sqlerrm = 'plan_limit_reached', format('expected plan_limit_reached, got %s', sqlerrm);
  end;
  begin
    update public.devices set status = 'active' where id = 'd2400000-0000-4000-8000-00000000000b';
    assert false, 're-activating a paused till beyond the limit must fail';
  exception when others then
    assert sqlerrm = 'plan_limit_reached', format('expected plan_limit_reached, got %s', sqlerrm);
  end;
  -- With room again, re-activating the paused till clears its pause time.
  update public.devices set status = 'revoked' where id = 'd2400000-0000-4000-8000-0000000000c3';
  update public.devices set status = 'active' where id = 'd2400000-0000-4000-8000-00000000000b';
  assert (select status::text = 'active' and paused_at is null from public.devices where id = 'd2400000-0000-4000-8000-00000000000b'), 're-activated till has no pause time';
end $$;

-- 24e. Only the owner chooses the till that stays.
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cashier-c@test.local');
insert into public.business_members (business_id, user_id, role) values ('b2400000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000d', 'cashier');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000d","role":"authenticated"}', true);
do $$
declare failure text;
begin
  begin
    perform public.choose_active_till('b2400000-0000-4000-8000-000000000001', 'd2400000-0000-4000-8000-00000000000a');
    assert false, 'a cashier must not choose the till that stays';
  exception when others then failure := sqlstate;
  end;
  assert failure = '42501', 'choose_active_till is owner only, got ' || coalesce(failure, 'null');
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
do $$
declare failure text;
begin
  begin
    perform public.choose_active_till('b2400000-0000-4000-8000-000000000001', 'd2400000-0000-4000-8000-0000000000c3');
    assert false, 'a till that is not active cannot be the kept till';
  exception when others then failure := sqlerrm;
  end;
  assert failure = 'till_not_found', 'kept till must be active, got ' || coalesce(failure, 'null');
end $$;
reset role;

-- 24f. Members (a cashier here) read their own shop's tills and branch names, so they get past the till picker;
-- they never see another shop's tills and cannot register or change a till (writes stay owner only).
create temp table t24f_expected on commit drop as
  select
    (select count(*) from public.devices where business_id = 'b2400000-0000-4000-8000-000000000001') as own_devices,
    (select count(*) from public.devices where business_id <> 'b2400000-0000-4000-8000-000000000001') as other_devices,
    (select name from public.devices where id = 'd2400000-0000-4000-8000-00000000000a') as till_a_name;
grant select on t24f_expected to authenticated;
do $$ begin
  assert (select own_devices >= 2 and other_devices >= 1 from t24f_expected), 'fixture: this shop has tills and another shop has tills';
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000d","role":"authenticated"}', true);
do $$
declare
  failure text;
  changed integer;
begin
  assert (select count(*) from public.devices where business_id = 'b2400000-0000-4000-8000-000000000001') = (select own_devices from t24f_expected),
    'a cashier sees every till of their own shop';
  assert (select count(*) from public.devices where business_id <> 'b2400000-0000-4000-8000-000000000001') = 0,
    'a cashier sees no till of another shop';
  assert (select b.name is not null from public.devices d join public.branches b on b.id = d.branch_id where d.id = 'd2400000-0000-4000-8000-00000000000a'),
    'a cashier reads the branch name of their till';

  begin
    insert into public.devices (business_id, name) values ('b2400000-0000-4000-8000-000000000001', 'Cashier till');
    assert false, 'a cashier must not register a till';
  exception when others then failure := sqlstate;
  end;
  assert failure is not null and failure <> 'P0004', 'till insert by a cashier is refused, got ' || coalesce(failure, 'null');

  update public.devices set name = 'Renamed by cashier' where id = 'd2400000-0000-4000-8000-00000000000a';
  get diagnostics changed = row_count;
  assert changed = 0, 'a cashier cannot change a till';
end $$;
reset role;
do $$ begin
  assert (select name from public.devices where id = 'd2400000-0000-4000-8000-00000000000a') = (select till_a_name from t24f_expected), 'till name unchanged after the cashier''s attempt';
  assert (select count(*) from public.devices where business_id = 'b2400000-0000-4000-8000-000000000001') = (select own_devices from t24f_expected), 'no till was added by the cashier';
end $$;

-- 24g. Canceled is final for the stored subscription: Stripe sends payment_failed and subscription.deleted in the
-- same second after the last retry, in either order. Only a new checkout reactivates. Also the applied paths of
-- subscription_changed (trialing, active, past_due with grace set once, cancel_at set and cleared).
reset role;
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000000e', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-e@test.local');
insert into public.businesses (id, owner_id, legal_name, trn, address, phone)
values ('b2400000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-00000000000e', 'Shop E LLC', '100000000000007', 'Deira, Dubai', '+971500000247');
update public.subscriptions set status = 'active', plan_id = 'starter', has_payment_method = true,
  stripe_customer_id = 'cus_24g', stripe_subscription_id = 'sub_24g', billing_interval = 'month',
  trial_ends_at = now() - interval '1 day', grace_ends_at = null, last_event_at = now() - interval '1 hour'
where business_id = 'b2400000-0000-4000-8000-000000000007';
set local role service_role;
do $$
declare
  biz constant uuid := 'b2400000-0000-4000-8000-000000000007';
  t constant timestamptz := date_trunc('second', now()) - interval '30 minutes';
  failed constant jsonb := jsonb_build_object(
    'id', 'evt_24g_failed', 'created', t, 'kind', 'payment_failed',
    'businessId', null, 'customerId', 'cus_24g', 'subscriptionId', 'sub_24g', 'status', 'past_due',
    'trialEnd', null, 'currentPeriodEnd', null, 'cancelAt', null, 'interval', null);
  sub public.subscriptions;
  result text;
begin
  result := public.apply_billing_event(jsonb_build_object(
    'id', 'evt_24g_deleted', 'created', t, 'kind', 'subscription_deleted',
    'businessId', null, 'customerId', 'cus_24g', 'subscriptionId', 'sub_24g', 'status', 'canceled',
    'trialEnd', null, 'currentPeriodEnd', null, 'cancelAt', null, 'interval', null));
  assert result = 'applied', 'deletion applied, got ' || coalesce(result, 'null');

  -- Same created second, delivered after the deletion.
  result := public.apply_billing_event(failed);
  assert result = 'stale', 'payment_failed after the deletion is ignored, got ' || coalesce(result, 'null');
  select * into sub from public.subscriptions where business_id = biz;
  assert sub.status = 'canceled' and sub.canceled_at = t, 'still canceled at the deletion time, got ' || sub.status::text;
  assert sub.grace_ends_at is null, 'no new grace period for a canceled subscription';
  result := public.apply_billing_event(failed);
  assert result = 'duplicate', 'the ignored event id is recorded, so redelivery is a duplicate, got ' || coalesce(result, 'null');

  result := public.apply_billing_event(jsonb_build_object(
    'id', 'evt_24g_paid_old', 'created', t + interval '1 minute', 'kind', 'invoice_paid',
    'businessId', null, 'customerId', 'cus_24g', 'subscriptionId', 'sub_24g', 'status', 'active',
    'trialEnd', null, 'currentPeriodEnd', t + interval '30 days', 'cancelAt', null, 'interval', 'month'));
  assert result in ('stale', 'applied'), 'invoice_paid for the old subscription, got ' || coalesce(result, 'null');
  result := public.apply_billing_event(jsonb_build_object(
    'id', 'evt_24g_changed_old', 'created', t + interval '2 minutes', 'kind', 'subscription_changed',
    'businessId', null, 'customerId', 'cus_24g', 'subscriptionId', 'sub_24g', 'status', 'active',
    'trialEnd', null, 'currentPeriodEnd', t + interval '30 days', 'cancelAt', null, 'interval', 'year'));
  assert result in ('stale', 'applied'), 'subscription_changed for the old subscription, got ' || coalesce(result, 'null');
  select * into sub from public.subscriptions where business_id = biz;
  assert sub.status = 'canceled' and sub.canceled_at = t and sub.grace_ends_at is null, 'invoice_paid and subscription_changed do not revive a canceled subscription';
  assert sub.billing_interval = 'month' and sub.plan_id = 'starter', 'ignored events change nothing';

  -- A new checkout is the only way back.
  result := public.apply_billing_event(jsonb_build_object(
    'id', 'evt_24g_checkout', 'created', t + interval '3 minutes', 'kind', 'checkout_completed',
    'businessId', biz, 'customerId', 'cus_24g', 'subscriptionId', 'sub_24g_new', 'status', 'active',
    'trialEnd', null, 'currentPeriodEnd', t + interval '33 days', 'cancelAt', null, 'interval', 'month'));
  assert result = 'applied', 'new checkout applied, got ' || coalesce(result, 'null');
  select * into sub from public.subscriptions where business_id = biz;
  assert sub.status = 'active' and sub.plan_id = 'starter' and sub.canceled_at is null and sub.grace_ends_at is null, 'new checkout reactivates on Starter';
  assert sub.stripe_subscription_id = 'sub_24g_new', 'new subscription id stored';

  -- subscription_changed applied paths.
  result := public.apply_billing_event(jsonb_build_object(
    'id', 'evt_24g_changed_trialing', 'created', t + interval '4 minutes', 'kind', 'subscription_changed',
    'businessId', null, 'customerId', 'cus_24g', 'subscriptionId', 'sub_24g_new', 'status', 'trialing',
    'trialEnd', null, 'currentPeriodEnd', t + interval '34 days', 'cancelAt', null, 'interval', null));
  assert result = 'applied', 'changed to trialing applied, got ' || coalesce(result, 'null');
  select * into sub from public.subscriptions where business_id = biz;
  assert sub.status = 'trialing' and sub.current_period_end = t + interval '34 days', 'subscription_changed trialing sets trialing and the period end';

  result := public.apply_billing_event(jsonb_build_object(
    'id', 'evt_24g_changed_active', 'created', t + interval '5 minutes', 'kind', 'subscription_changed',
    'businessId', null, 'customerId', 'cus_24g', 'subscriptionId', 'sub_24g_new', 'status', 'active',
    'trialEnd', null, 'currentPeriodEnd', t + interval '365 days', 'cancelAt', t + interval '365 days', 'interval', 'year'));
  assert result = 'applied', 'changed to active applied, got ' || coalesce(result, 'null');
  select * into sub from public.subscriptions where business_id = biz;
  assert sub.status = 'active' and sub.plan_id = 'starter' and sub.grace_ends_at is null, 'subscription_changed active is Starter with no grace';
  assert sub.cancel_at = t + interval '365 days' and sub.billing_interval = 'year', 'cancel_at and interval stored';

  result := public.apply_billing_event(jsonb_build_object(
    'id', 'evt_24g_changed_past_due', 'created', t + interval '6 minutes', 'kind', 'subscription_changed',
    'businessId', null, 'customerId', 'cus_24g', 'subscriptionId', 'sub_24g_new', 'status', 'past_due',
    'trialEnd', null, 'currentPeriodEnd', null, 'cancelAt', t + interval '365 days', 'interval', null));
  assert result = 'applied', 'changed to past_due applied, got ' || coalesce(result, 'null');
  select * into sub from public.subscriptions where business_id = biz;
  assert sub.status = 'past_due' and sub.grace_ends_at = now() + interval '7 days', 'past_due starts a seven-day grace';
  assert sub.billing_interval = 'year' and sub.current_period_end = t + interval '365 days', 'missing interval and period end keep the stored ones';
end $$;
-- A known grace end proves a second past_due change leaves it alone.
reset role;
update public.subscriptions set grace_ends_at = now() + interval '5 days' where business_id = 'b2400000-0000-4000-8000-000000000007';
set local role service_role;
do $$
declare
  biz constant uuid := 'b2400000-0000-4000-8000-000000000007';
  t constant timestamptz := date_trunc('second', now()) - interval '30 minutes';
  sub public.subscriptions;
  result text;
begin
  result := public.apply_billing_event(jsonb_build_object(
    'id', 'evt_24g_changed_unpaid', 'created', t + interval '7 minutes', 'kind', 'subscription_changed',
    'businessId', null, 'customerId', 'cus_24g', 'subscriptionId', 'sub_24g_new', 'status', 'unpaid',
    'trialEnd', null, 'currentPeriodEnd', null, 'cancelAt', null, 'interval', null));
  assert result = 'applied', 'changed to unpaid applied, got ' || coalesce(result, 'null');
  select * into sub from public.subscriptions where business_id = biz;
  assert sub.status = 'past_due' and sub.grace_ends_at = now() + interval '5 days', 'grace is set once per past_due episode';
  assert sub.cancel_at is null, 'cancel_at cleared when the event has none';
end $$;
reset role;

-- 24h. paused_at is server-stamped: an owner cannot insert a paused till with a future pause time, nor move an
-- existing pause into the future, to sell on more tills than the plan allows.
-- (Since 1G an owner cannot insert a paused till at all — 25e — so the forged row is written by the admin role;
-- the pause stamp still ignores the supplied time.)
reset role;
insert into public.devices (id, business_id, name, status, paused_at)
values ('d2400000-0000-4000-8000-0000000000e1', 'b2400000-0000-4000-8000-000000000001', 'Forged till', 'paused', '2099-01-01T00:00:00Z');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
do $$
declare
  biz constant uuid := 'b2400000-0000-4000-8000-000000000001';
  forged constant uuid := 'd2400000-0000-4000-8000-0000000000e1';
  stored timestamptz;
  failure text;
begin
  select paused_at into stored from public.devices where id = forged;
  assert stored between now() - interval '1 minute' and now() + interval '1 minute', 'inserted pause time is now(), got ' || coalesce(stored::text, 'null');

  update public.devices set paused_at = '2099-01-01T00:00:00Z' where id = forged;
  select paused_at into stored from public.devices where id = forged;
  assert stored between now() - interval '1 minute' and now() + interval '1 minute', 'pause time cannot be moved, got ' || coalesce(stored::text, 'null');

  update public.devices set paused_at = '2099-01-01T00:00:00Z' where id = 'd2400000-0000-4000-8000-00000000000a';
  assert (select paused_at is null from public.devices where id = 'd2400000-0000-4000-8000-00000000000a'), 'an active till never has a pause time';

  begin
    perform public.apply_register_sync(gen_random_uuid(), biz, 'e2400000-0000-4000-8000-0000000000e1', jsonb_build_object(
      'deviceId', forged, 'action', 'open',
      'register', jsonb_build_object('openingCashFils', 0, 'openedAt', now())));
    assert false, 'a forged paused till must not open a shift';
  exception when others then failure := sqlerrm;
  end;
  assert failure = 'till_paused', 'open on a forged paused till is till_paused, got ' || coalesce(failure, 'null');
end $$;
reset role;
-- The gate also refuses a pause time in the future even if one got into the table.
alter table public.devices disable trigger device_paused_at;
update public.devices set paused_at = now() + interval '1 day' where id = 'd2400000-0000-4000-8000-0000000000e1';
alter table public.devices enable trigger device_paused_at;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
do $$
declare failure text;
begin
  begin
    perform public.apply_register_sync(gen_random_uuid(), 'b2400000-0000-4000-8000-000000000001', 'e2400000-0000-4000-8000-0000000000e2', jsonb_build_object(
      'deviceId', 'd2400000-0000-4000-8000-0000000000e1', 'action', 'open',
      'register', jsonb_build_object('openingCashFils', 0, 'openedAt', now())));
    assert false, 'a till paused in the future must not open a shift';
  exception when others then failure := sqlerrm;
  end;
  assert failure = 'till_paused', 'future pause time is till_paused, got ' || coalesce(failure, 'null');
end $$;
reset role;


-- 25. Stage 1G cashier access. Shop F: owner ...0f, cashier ...10. Till A has yesterday's closed shift (sale S1);
-- till B has a shift opened yesterday that is still open (sale S2 from yesterday, S3 from today).
reset role;
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000000f', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-f@test.local'),
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cashier-f@test.local');
insert into public.businesses (id, owner_id, legal_name, trn, address, phone)
values ('b2500000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000f', 'Shop F LLC', '100000000000008', 'Satwa, Dubai', '+971500000251');
update public.subscriptions set status = 'active', plan_id = 'pro', trial_ends_at = now() - interval '1 day', grace_ends_at = null
where business_id = 'b2500000-0000-4000-8000-000000000001';
insert into public.business_members (business_id, user_id, role, status)
values ('b2500000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000010', 'cashier', 'active');
insert into public.devices (id, business_id, name) values
  ('d2500000-0000-4000-8000-00000000000a', 'b2500000-0000-4000-8000-000000000001', 'Till A'),
  ('d2500000-0000-4000-8000-00000000000b', 'b2500000-0000-4000-8000-000000000001', 'Till B');
insert into public.products (id, business_id, name, sku, price_fils, stock_quantity, low_stock_threshold)
values ('c2500000-0000-4000-8000-000000000001', 'b2500000-0000-4000-8000-000000000001', 'Tea', 'tea-25', 105, 10, 1);
insert into public.customers (id, business_id, name, phone)
values ('c2500000-0000-4000-8000-0000000000c1', 'b2500000-0000-4000-8000-000000000001', 'Huda', '+971500002501');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000f","role":"authenticated"}', true);
do $$
declare
  biz constant uuid := 'b2500000-0000-4000-8000-000000000001';
  yesterday constant date := (now() at time zone 'Asia/Dubai')::date - 1;
  today constant date := (now() at time zone 'Asia/Dubai')::date;
begin
  perform public.apply_register_sync(gen_random_uuid(), biz, 'e2500000-0000-4000-8000-00000000000a', jsonb_build_object(
    'deviceId', 'd2500000-0000-4000-8000-00000000000a', 'action', 'open',
    'register', jsonb_build_object('openingCashFils', 0, 'openedAt', now() - interval '30 hours')));
  perform public.apply_sale_sync(gen_random_uuid(), biz, 'a2500000-0000-4000-8000-000000000001', jsonb_build_object(
    'deviceId', 'd2500000-0000-4000-8000-00000000000a', 'register', null,
    'sale', jsonb_build_object(
      'id', 'a2500000-0000-4000-8000-000000000001', 'invoiceNumber', 'T25-1', 'status', 'completed',
      'createdAt', now() - interval '29 hours', 'supplyDate', yesterday, 'paymentMethod', 'cash',
      'netFils', 100, 'vatFils', 5, 'grossFils', 105,
      'lines', jsonb_build_array(jsonb_build_object(
        'id', 'a2500000-0000-4000-8000-0000000001a1', 'name', 'Tea', 'quantity', 1,
        'unitGrossFils', 105, 'netFils', 100, 'vatFils', 5, 'grossFils', 105)))));
  perform public.apply_sale_sync(gen_random_uuid(), biz, 'a2500000-0000-4000-8000-000000000000', jsonb_build_object(
    'deviceId', 'd2500000-0000-4000-8000-00000000000a', 'register', null,
    'sale', jsonb_build_object(
      'id', 'a2500000-0000-4000-8000-000000000000', 'invoiceNumber', 'T25-0', 'status', 'completed',
      'createdAt', now() - interval '29 hours', 'supplyDate', yesterday, 'paymentMethod', 'cash',
      'netFils', 100, 'vatFils', 5, 'grossFils', 105,
      'lines', jsonb_build_array(jsonb_build_object(
        'id', 'a2500000-0000-4000-8000-0000000000a1', 'name', 'Tea', 'quantity', 1,
        'unitGrossFils', 105, 'netFils', 100, 'vatFils', 5, 'grossFils', 105)))));
  perform public.apply_credit_note_sync(gen_random_uuid(), biz, 'f2500000-0000-4000-8000-000000000000', jsonb_build_object(
    'deviceId', 'd2500000-0000-4000-8000-00000000000a',
    'creditNote', jsonb_build_object(
      'id', 'f2500000-0000-4000-8000-000000000000', 'saleId', 'a2500000-0000-4000-8000-000000000000',
      'creditNoteNumber', 'CN-T25-0', 'createdAt', now() - interval '28 hours 30 minutes', 'paymentMethod', 'cash',
      'netFils', 100, 'vatFils', 5, 'grossFils', 105,
      'lines', jsonb_build_array(jsonb_build_object(
        'id', 'f2500000-0000-4000-8000-0000000000a1', 'originalLineId', 'a2500000-0000-4000-8000-0000000000a1',
        'name', 'Tea', 'quantity', 1, 'unitGrossFils', 105, 'netFils', 100, 'vatFils', 5, 'grossFils', 105)))));
  perform public.apply_register_sync(gen_random_uuid(), biz, gen_random_uuid(), jsonb_build_object(
    'deviceId', 'd2500000-0000-4000-8000-00000000000a', 'action', 'close',
    'register', jsonb_build_object('countedCashFils', 105, 'closedAt', now() - interval '28 hours')));

  perform public.apply_register_sync(gen_random_uuid(), biz, 'e2500000-0000-4000-8000-00000000000b', jsonb_build_object(
    'deviceId', 'd2500000-0000-4000-8000-00000000000b', 'action', 'open',
    'register', jsonb_build_object('openingCashFils', 0, 'openedAt', now() - interval '26 hours')));
  perform public.apply_sale_sync(gen_random_uuid(), biz, 'a2500000-0000-4000-8000-000000000002', jsonb_build_object(
    'deviceId', 'd2500000-0000-4000-8000-00000000000b', 'register', null,
    'sale', jsonb_build_object(
      'id', 'a2500000-0000-4000-8000-000000000002', 'invoiceNumber', 'T25-2', 'status', 'completed',
      'createdAt', now() - interval '25 hours', 'supplyDate', yesterday, 'paymentMethod', 'cash',
      'netFils', 100, 'vatFils', 5, 'grossFils', 105,
      'lines', jsonb_build_array(jsonb_build_object(
        'id', 'a2500000-0000-4000-8000-0000000002a1', 'name', 'Tea', 'quantity', 1,
        'unitGrossFils', 105, 'netFils', 100, 'vatFils', 5, 'grossFils', 105)))));
  perform public.apply_sale_sync(gen_random_uuid(), biz, 'a2500000-0000-4000-8000-000000000003', jsonb_build_object(
    'deviceId', 'd2500000-0000-4000-8000-00000000000b', 'register', null,
    'sale', jsonb_build_object(
      'id', 'a2500000-0000-4000-8000-000000000003', 'invoiceNumber', 'T25-3', 'status', 'completed',
      'createdAt', now(), 'supplyDate', today, 'paymentMethod', 'card',
      'netFils', 100, 'vatFils', 5, 'grossFils', 105,
      'lines', jsonb_build_array(jsonb_build_object(
        'id', 'a2500000-0000-4000-8000-0000000003a1', 'name', 'Tea', 'quantity', 1,
        'unitGrossFils', 105, 'netFils', 100, 'vatFils', 5, 'grossFils', 105)))));
end $$;
reset role;
create temp table t25_expected on commit drop as
  select
    (select count(*) from public.cash_movements where register_session_id = 'e2500000-0000-4000-8000-00000000000b') as open_moves,
    (select count(*) from public.products where business_id <> 'b2500000-0000-4000-8000-000000000001') as other_products;
grant select on t25_expected to authenticated;

-- 25a. A cashier reads their shop's products and customers, none of another shop's, and cannot write products.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000010","role":"authenticated"}', true);
do $$
declare
  failure text;
  changed integer;
begin
  assert (select count(*) from public.products where business_id = 'b2500000-0000-4000-8000-000000000001') = 1, 'a cashier reads their shop''s products';
  assert (select count(*) from public.customers where business_id = 'b2500000-0000-4000-8000-000000000001') = 1, 'a cashier reads their shop''s customers';
  assert (select count(*) from public.products where business_id <> 'b2500000-0000-4000-8000-000000000001') = 0, 'a cashier reads no other shop''s products';
  assert (select count(*) from public.customers where business_id <> 'b2500000-0000-4000-8000-000000000001') = 0, 'a cashier reads no other shop''s customers';
  begin
    insert into public.products (business_id, name, sku, price_fils, stock_quantity, low_stock_threshold)
    values ('b2500000-0000-4000-8000-000000000001', 'Coffee', 'coffee-25', 200, 1, 0);
    assert false, 'a cashier must not insert a product';
  exception when others then failure := sqlstate;
  end;
  assert failure is not null and failure <> 'P0004', 'product insert by a cashier is refused, got ' || coalesce(failure, 'null');
  update public.products set price_fils = 1 where id = 'c2500000-0000-4000-8000-000000000001';
  get diagnostics changed = row_count;
  assert changed = 0, 'a cashier cannot change a product';
end $$;

-- 25b. Today's sales and the sales of a still-open shift are visible; yesterday's closed shift is not.
do $$
begin
  assert exists (select 1 from public.sales where id = 'a2500000-0000-4000-8000-000000000003'), 'a cashier sees today''s sale';
  assert exists (select 1 from public.sales where id = 'a2500000-0000-4000-8000-000000000002'), 'a cashier sees yesterday''s sale of the still-open shift';
  assert not exists (select 1 from public.sales where id = 'a2500000-0000-4000-8000-000000000001'), 'a cashier does not see yesterday''s closed-shift sale';
  assert (select count(*) from public.sale_items where sale_id = 'a2500000-0000-4000-8000-000000000002') = 1, 'a cashier sees the items of a visible sale';
  assert (select count(*) from public.sale_items where sale_id = 'a2500000-0000-4000-8000-000000000001') = 0, 'a cashier sees no items of a hidden sale';
  assert exists (select 1 from public.register_sessions where id = 'e2500000-0000-4000-8000-00000000000b'), 'a cashier sees the open shift';
  assert not exists (select 1 from public.register_sessions where id = 'e2500000-0000-4000-8000-00000000000a'), 'a cashier does not see yesterday''s closed shift';
  assert (select count(*) from public.cash_movements where register_session_id = 'e2500000-0000-4000-8000-00000000000b') = (select open_moves from t25_expected),
    'a cashier sees the cash movements of the open shift';
  assert (select count(*) from public.cash_movements where register_session_id = 'e2500000-0000-4000-8000-00000000000a') = 0, 'a cashier sees no cash movement of a closed old shift';
  assert (select count(*) from public.sales where business_id <> 'b2500000-0000-4000-8000-000000000001') = 0, 'a cashier sees no other shop''s sales';
  assert not exists (select 1 from public.credit_notes where id = 'f2500000-0000-4000-8000-000000000000'), 'a cashier does not see an old refund of an old sale';
  assert (select count(*) from public.credit_note_items where credit_note_id = 'f2500000-0000-4000-8000-000000000000') = 0, 'nor its items';
end $$;

-- 25d. Refund by exact invoice number: an old sale's detail, while it stays hidden from plain selects.
do $$
declare
  detail jsonb;
begin
  detail := public.find_sale_by_invoice('b2500000-0000-4000-8000-000000000001', 'T25-1');
  assert detail->>'id' = 'a2500000-0000-4000-8000-000000000001', 'find_sale_by_invoice returns the old sale';
  assert jsonb_array_length(detail->'sale_items') = 1, 'the old sale comes with its items';
  assert not exists (select 1 from public.sales where id = 'a2500000-0000-4000-8000-000000000001'), 'the old sale stays hidden from plain selects';
  assert public.find_sale_by_invoice('b2500000-0000-4000-8000-000000000001', 'T25-404') is null, 'a wrong invoice number returns null';
  assert public.find_sale_by_invoice('b2500000-0000-4000-8000-000000000001', 'T24C-1') is null, 'another shop''s invoice returns null';
  assert public.find_sale_by_invoice('b2500000-0000-4000-8000-000000000001', 't25-1') is null, 'the match is exact';
end $$;

-- 25c. A cashier's selling work syncs: customer, sale, refund of the old sale, register close. Product sync and
-- business settings stay owner-only.
do $$
declare
  biz constant uuid := 'b2500000-0000-4000-8000-000000000001';
  failure text;
  changed integer;
begin
  perform public.apply_customer_sync(gen_random_uuid(), biz, 'c2500000-0000-4000-8000-0000000000c2', jsonb_build_object(
    'id', 'c2500000-0000-4000-8000-0000000000c2', 'name', 'Omar', 'phone', '+971500002502',
    'createdAt', now(), 'updatedAt', now()));
  assert exists (select 1 from public.customers where id = 'c2500000-0000-4000-8000-0000000000c2'), 'a cashier''s new customer syncs';

  perform public.apply_sale_sync(gen_random_uuid(), biz, 'a2500000-0000-4000-8000-000000000004', jsonb_build_object(
    'deviceId', 'd2500000-0000-4000-8000-00000000000b', 'register', null,
    'sale', jsonb_build_object(
      'id', 'a2500000-0000-4000-8000-000000000004', 'invoiceNumber', 'T25-4', 'status', 'completed',
      'createdAt', now(), 'supplyDate', (now() at time zone 'Asia/Dubai')::date, 'paymentMethod', 'cash',
      'netFils', 100, 'vatFils', 5, 'grossFils', 105,
      'lines', jsonb_build_array(jsonb_build_object(
        'id', 'a2500000-0000-4000-8000-0000000004a1', 'name', 'Tea', 'quantity', 1,
        'unitGrossFils', 105, 'netFils', 100, 'vatFils', 5, 'grossFils', 105)))));
  assert exists (select 1 from public.sales where id = 'a2500000-0000-4000-8000-000000000004'), 'a cashier''s sale syncs';

  perform public.apply_credit_note_sync(gen_random_uuid(), biz, 'f2500000-0000-4000-8000-000000000001', jsonb_build_object(
    'deviceId', 'd2500000-0000-4000-8000-00000000000b',
    'creditNote', jsonb_build_object(
      'id', 'f2500000-0000-4000-8000-000000000001', 'saleId', 'a2500000-0000-4000-8000-000000000001',
      'creditNoteNumber', 'CN-T25-1', 'createdAt', now(), 'paymentMethod', 'cash',
      'netFils', 100, 'vatFils', 5, 'grossFils', 105,
      'lines', jsonb_build_array(jsonb_build_object(
        'id', 'f2500000-0000-4000-8000-0000000001a1', 'originalLineId', 'a2500000-0000-4000-8000-0000000001a1',
        'name', 'Tea', 'quantity', 1, 'unitGrossFils', 105, 'netFils', 100, 'vatFils', 5, 'grossFils', 105)))));
  assert exists (select 1 from public.credit_notes where id = 'f2500000-0000-4000-8000-000000000001'), 'a cashier refunds an old sale by invoice';

  assert (select count(*) from public.credit_note_items where credit_note_id = 'f2500000-0000-4000-8000-000000000001') = 1,
    'a cashier sees the refund of the open shift and its item';
  assert jsonb_array_length(public.find_sale_by_invoice(biz, 'T25-1')->'credit_notes') = 1, 'the invoice lookup lists the refund';
  assert (public.find_sale_by_invoice(biz, 'T25-1')->'credit_notes'->0->'credit_note_items'->0->>'quantity')::int = 1,
    'the invoice lookup lists the refunded quantity';
  assert (select count(*) from public.audit_events where business_id = biz and action = 'sale.lookup_by_invoice') = 0,
    'audit rows are not readable by a cashier';

  perform public.apply_register_sync(gen_random_uuid(), biz, gen_random_uuid(), jsonb_build_object(
    'deviceId', 'd2500000-0000-4000-8000-00000000000b', 'action', 'close',
    'register', jsonb_build_object('countedCashFils', 105, 'closedAt', now())));
  assert exists (select 1 from public.credit_notes where id = 'f2500000-0000-4000-8000-000000000001'),
    'today''s refund of an old sale stays visible after its shift closes';

  begin
    perform public.apply_product_sync(gen_random_uuid(), biz, 'c2500000-0000-4000-8000-000000000002',
      jsonb_build_object('product', jsonb_build_object('id', 'c2500000-0000-4000-8000-000000000002', 'name', 'Coffee', 'sku', 'coffee-25b',
        'priceFils', 200, 'lowStockThreshold', 0, 'active', true, 'taxCategory', 'standard')));
    assert false, 'a cashier must not sync products';
  exception when others then failure := sqlstate;
  end;
  assert failure = '42501', 'product sync by a cashier is not authorized, got ' || coalesce(failure, 'null');

  update public.businesses set legal_name = 'Renamed by cashier' where id = biz;
  get diagnostics changed = row_count;
  assert changed = 0, 'a cashier cannot change the business';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.audit_events where business_id = 'b2500000-0000-4000-8000-000000000001' and action = 'sale.lookup_by_invoice'
          and actor_id = '00000000-0000-4000-8000-000000000010') >= 4, 'each invoice lookup by the cashier is audited';
  assert (select open_moves from t25_expected) >= 1, 'fixture: the open shift has a cash movement';
  assert (select status::text from public.register_sessions where id = 'e2500000-0000-4000-8000-00000000000b') = 'closed', 'a cashier''s register close syncs';
end $$;

-- 25d (cont.). A non-member gets not_authorized.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
do $$
declare
  failure text;
begin
  begin
    perform public.find_sale_by_invoice('b2500000-0000-4000-8000-000000000001', 'T25-1');
    assert false, 'a non-member must not look up invoices';
  exception when others then failure := sqlstate;
  end;
  assert failure = '42501', 'invoice lookup by a non-member is not authorized, got ' || coalesce(failure, 'null');
end $$;

-- 25e. Tills are paused only by the till choice: direct writes of paused are refused, revoke still works.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000f","role":"authenticated"}', true);
do $$
declare
  failure text;
begin
  begin
    insert into public.devices (business_id, name, status) values ('b2500000-0000-4000-8000-000000000001', 'Till P', 'paused');
    assert false, 'an owner must not insert a paused till';
  exception when others then failure := sqlerrm;
  end;
  assert failure = 'till_status_locked', 'paused insert is locked, got ' || coalesce(failure, 'null');

  failure := null;
  begin
    update public.devices set status = 'paused' where id = 'd2500000-0000-4000-8000-00000000000b';
    assert false, 'an owner must not pause a till directly';
  exception when others then failure := sqlerrm;
  end;
  assert failure = 'till_status_locked', 'direct pause is locked, got ' || coalesce(failure, 'null');

  assert public.choose_active_till('b2500000-0000-4000-8000-000000000001', 'd2500000-0000-4000-8000-00000000000a') = 1, 'the till choice still pauses';
  assert (select status::text from public.devices where id = 'd2500000-0000-4000-8000-00000000000b') = 'paused', 'till B is paused by the choice';

  failure := null;
  begin
    update public.devices set status = 'active' where id = 'd2500000-0000-4000-8000-00000000000b';
    assert false, 'an owner must not un-pause a till directly';
  exception when others then failure := sqlerrm;
  end;
  assert failure = 'till_status_locked', 'direct un-pause is locked, got ' || coalesce(failure, 'null');

  update public.devices set status = 'revoked' where id = 'd2500000-0000-4000-8000-00000000000b';
  assert (select status::text from public.devices where id = 'd2500000-0000-4000-8000-00000000000b') = 'revoked', 'an owner can remove a paused till';
  update public.devices set status = 'revoked' where id = 'd2500000-0000-4000-8000-00000000000a';
  assert (select status::text from public.devices where id = 'd2500000-0000-4000-8000-00000000000a') = 'revoked', 'revoking an active till still works';
end $$;
reset role;

-- 25g. onboarding_status: owner-only flags that flip as the shop sets up. Shop G is brand new (owner ...11).
insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-g@test.local');
insert into public.businesses (id, owner_id, legal_name, trn, address, phone)
values ('b2500000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000011', 'Shop G LLC', '100000000000009', 'Satwa, Dubai', '+971500000252');
insert into public.devices (id, business_id, name) values ('d2500000-0000-4000-8000-00000000000c', 'b2500000-0000-4000-8000-000000000002', 'Till G');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
do $$
declare
  biz constant uuid := 'b2500000-0000-4000-8000-000000000002';
  today constant date := (now() at time zone 'Asia/Dubai')::date;
begin
  assert public.onboarding_status(biz) = '{"hasProduct": false, "hasOpenedRegister": false, "hasSale": false}'::jsonb, 'a new shop has done nothing';
  insert into public.products (business_id, name, sku, price_fils, stock_quantity, low_stock_threshold)
  values (biz, 'Tea', 'tea-25g', 105, 10, 1);
  assert public.onboarding_status(biz) = '{"hasProduct": true, "hasOpenedRegister": false, "hasSale": false}'::jsonb, 'a product flips hasProduct';
  perform public.apply_register_sync(gen_random_uuid(), biz, 'e2500000-0000-4000-8000-00000000000c', jsonb_build_object(
    'deviceId', 'd2500000-0000-4000-8000-00000000000c', 'action', 'open',
    'register', jsonb_build_object('openingCashFils', 0, 'openedAt', now())));
  assert public.onboarding_status(biz) = '{"hasProduct": true, "hasOpenedRegister": true, "hasSale": false}'::jsonb, 'opening flips hasOpenedRegister';
  perform public.apply_sale_sync(gen_random_uuid(), biz, 'a2500000-0000-4000-8000-0000000000c1', jsonb_build_object(
    'deviceId', 'd2500000-0000-4000-8000-00000000000c', 'register', null,
    'sale', jsonb_build_object(
      'id', 'a2500000-0000-4000-8000-0000000000c1', 'invoiceNumber', 'T25G-1', 'status', 'completed',
      'createdAt', now(), 'supplyDate', today, 'paymentMethod', 'cash',
      'netFils', 100, 'vatFils', 5, 'grossFils', 105,
      'lines', jsonb_build_array(jsonb_build_object(
        'id', 'a2500000-0000-4000-8000-0000000c01a1', 'name', 'Tea', 'quantity', 1,
        'unitGrossFils', 105, 'netFils', 100, 'vatFils', 5, 'grossFils', 105)))));
  assert public.onboarding_status(biz) = '{"hasProduct": true, "hasOpenedRegister": true, "hasSale": true}'::jsonb, 'a sale flips hasSale';
end $$;

-- A cashier, and the owner of another shop, are refused.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000010","role":"authenticated"}', true);
do $$
declare
  failure text;
begin
  begin
    perform public.onboarding_status('b2500000-0000-4000-8000-000000000001');
    assert false, 'a cashier must not read onboarding status';
  exception when others then failure := sqlerrm;
  end;
  assert failure = 'not_authorized', 'cashier is refused, got ' || coalesce(failure, 'null');
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
do $$
declare
  failure text;
begin
  begin
    perform public.onboarding_status('b2500000-0000-4000-8000-000000000001');
    assert false, 'another shop owner must not read onboarding status';
  exception when others then failure := sqlerrm;
  end;
  assert failure = 'not_authorized', 'other owner is refused, got ' || coalesce(failure, 'null');
end $$;
reset role;

rollback;
