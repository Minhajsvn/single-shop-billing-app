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

rollback;
