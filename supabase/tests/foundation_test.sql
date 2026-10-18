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

rollback;
