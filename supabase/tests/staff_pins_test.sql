-- Stage 2A tests: staff PINs, lock settings, owner staff functions, operator on synced records.
-- Runs inside one transaction and always rolls back.
begin;

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000002a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@staff.test'),
  ('00000000-0000-4000-8000-0000000002b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@staff.test'),
  ('00000000-0000-4000-8000-0000000002a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cashier-a@staff.test'),
  ('00000000-0000-4000-8000-0000000002a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'manager-a@staff.test'),
  ('00000000-0000-4000-8000-0000000002a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'extra-a@staff.test'),
  ('00000000-0000-4000-8000-0000000002b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cashier-b@staff.test');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000002a1","role":"authenticated"}', true);
insert into public.businesses (id, owner_id, legal_name, trn, address, phone)
values ('b0000000-0000-4000-8000-0000000002a0', '00000000-0000-4000-8000-0000000002a1', 'Staff Shop A LLC', '100000000000003', 'Al Barsha, Dubai', '+971500000201');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000002b1","role":"authenticated"}', true);
insert into public.businesses (id, owner_id, legal_name, trn, address, phone)
values ('b0000000-0000-4000-8000-0000000002b0', '00000000-0000-4000-8000-0000000002b1', 'Staff Shop B LLC', '100000000000003', 'Deira, Dubai', '+971500000202');
reset role;

-- 1. Columns and defaults (Task 1).
do $$
declare
  t text;
  c text;
begin
  assert (select pin_lock_enabled = false and idle_lock_minutes = 5 and manager_discount_pct = 10
          from public.businesses where id = 'b0000000-0000-4000-8000-0000000002a0'), '1a lock defaults';
  assert (select pin_hash is null and pin_salt is null and pin_set_at is null and display_name = 'owner-a'
          from public.business_members where business_id = 'b0000000-0000-4000-8000-0000000002a0' and role = 'owner'), '1b owner has no PIN, display name from email';
  foreach t in array array['sales', 'credit_notes', 'cash_movements', 'stock_movements'] loop
    foreach c in array array['operator_member_id', 'approved_by_member_id'] loop
      assert exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = c and is_nullable = 'YES'), format('1c %s.%s', t, c);
    end loop;
  end loop;
  foreach c in array array['opened_operator_member_id', 'opened_approved_by_member_id', 'closed_operator_member_id', 'closed_approved_by_member_id'] loop
    assert exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'register_sessions' and column_name = c), format('1d register_sessions.%s', c);
  end loop;
end $$;

do $$ begin
  begin
    update public.businesses set idle_lock_minutes = 0 where id = 'b0000000-0000-4000-8000-0000000002a0';
    assert false, '1e idle 0 refused';
  exception when check_violation then null;
  end;
  begin
    update public.businesses set idle_lock_minutes = 61 where id = 'b0000000-0000-4000-8000-0000000002a0';
    assert false, '1f idle 61 refused';
  exception when check_violation then null;
  end;
  begin
    update public.businesses set manager_discount_pct = 101 where id = 'b0000000-0000-4000-8000-0000000002a0';
    assert false, '1g pct 101 refused';
  exception when check_violation then null;
  end;
end $$;

-- 2. Owner staff functions (Task 2). Owner A adds a cashier and a manager.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000002a1","role":"authenticated"}', true);
create temp table ids (name text primary key, id uuid) on commit drop;
insert into ids values
  ('cashier', public.staff_add_member('b0000000-0000-4000-8000-0000000002a0', '00000000-0000-4000-8000-0000000002a2', 'cashier', 'Aisha')),
  ('manager', public.staff_add_member('b0000000-0000-4000-8000-0000000002a0', '00000000-0000-4000-8000-0000000002a3', 'manager', null));
reset role;

do $$ begin
  assert (select display_name = 'Aisha' and role = 'cashier' and status = 'active' from public.business_members where id = (select id from ids where name = 'cashier')), '2a cashier added with name';
  assert (select display_name = 'manager-a' from public.business_members where id = (select id from ids where name = 'manager')), '2b name defaults from email';
  assert (select count(*) from public.audit_events where action = 'staff.add_member' and business_id = 'b0000000-0000-4000-8000-0000000002a0') = 2, '2c audit rows';
end $$;

-- Owner B and cashier A are refused on A's staff.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000002b1","role":"authenticated"}', true);
do $$ begin
  begin perform public.staff_set_role('b0000000-0000-4000-8000-0000000002a0', (select id from ids where name = 'cashier'), 'manager'); assert false, '2d owner B refused';
  exception when sqlstate 'P0001' then assert sqlerrm = 'not_owner', '2d code ' || sqlerrm; end;
  begin perform public.staff_reset_pin('b0000000-0000-4000-8000-0000000002a0', (select id from ids where name = 'cashier')); assert false, '2e owner B refused reset';
  exception when sqlstate 'P0001' then assert sqlerrm = 'not_owner', '2e code ' || sqlerrm; end;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000002a2","role":"authenticated"}', true);
do $$ begin
  begin perform public.staff_add_member('b0000000-0000-4000-8000-0000000002a0', '00000000-0000-4000-8000-0000000002a4', 'cashier', null); assert false, '2f cashier refused';
  exception when sqlstate 'P0001' then assert sqlerrm = 'not_owner', '2f code ' || sqlerrm; end;
  -- A member may set their own PIN, but not another member's.
  perform public.staff_set_pin('b0000000-0000-4000-8000-0000000002a0', (select id from ids where name = 'cashier'), 'JpGjAh9aPug1yuS6zmq1z8aMM0a3EHBhmBDCxrUiWqk=', 'BwcHBwcHBwcHBwcHBwcHBw==');
  begin perform public.staff_set_pin('b0000000-0000-4000-8000-0000000002a0', (select id from ids where name = 'manager'), 'JpGjAh9aPug1yuS6zmq1z8aMM0a3EHBhmBDCxrUiWqk=', 'BwcHBwcHBwcHBwcHBwcHBw=='); assert false, '2g other PIN refused';
  exception when sqlstate 'P0001' then assert sqlerrm = 'not_owner', '2g code ' || sqlerrm; end;
end $$;
reset role;
do $$ begin
  assert (select pin_hash is not null and pin_set_at is not null from public.business_members where id = (select id from ids where name = 'cashier')), '2h own PIN stored';
end $$;

-- Owner A: owner row protected, bad hash refused, reset, disabled member, lock settings.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000002a1","role":"authenticated"}', true);
do $$
declare
  owner_member uuid := (select id from public.business_members where business_id = 'b0000000-0000-4000-8000-0000000002a0' and role = 'owner');
begin
  begin perform public.staff_set_role('b0000000-0000-4000-8000-0000000002a0', owner_member, 'cashier'); assert false, '2i owner role protected';
  exception when sqlstate 'P0001' then assert sqlerrm = 'owner_protected', '2i code ' || sqlerrm; end;
  begin perform public.staff_set_status('b0000000-0000-4000-8000-0000000002a0', owner_member, 'disabled'); assert false, '2j owner status protected';
  exception when sqlstate 'P0001' then assert sqlerrm = 'owner_protected', '2j code ' || sqlerrm; end;
  begin perform public.staff_set_pin('b0000000-0000-4000-8000-0000000002a0', owner_member, 'short', 'BwcHBwcHBwcHBwcHBwcHBw=='); assert false, '2k bad hash refused';
  exception when sqlstate 'P0001' then assert sqlerrm = 'invalid_pin_hash', '2k code ' || sqlerrm; end;
  perform public.staff_reset_pin('b0000000-0000-4000-8000-0000000002a0', (select id from ids where name = 'cashier'));
  assert (select pin_hash is null and pin_salt is null and pin_set_at is null from public.staff_list('b0000000-0000-4000-8000-0000000002a0') where member_id = (select id from ids where name = 'cashier')), '2l PIN reset';
  perform public.staff_set_status('b0000000-0000-4000-8000-0000000002a0', (select id from ids where name = 'manager'), 'disabled');
  begin perform public.staff_set_pin('b0000000-0000-4000-8000-0000000002a0', (select id from ids where name = 'manager'), 'JpGjAh9aPug1yuS6zmq1z8aMM0a3EHBhmBDCxrUiWqk=', 'BwcHBwcHBwcHBwcHBwcHBw=='); assert false, '2m disabled refused';
  exception when sqlstate 'P0001' then assert sqlerrm = 'member_disabled', '2m code ' || sqlerrm; end;
  perform public.staff_set_status('b0000000-0000-4000-8000-0000000002a0', (select id from ids where name = 'manager'), 'active');
  -- Pro trial, but the owner has no PIN yet.
  begin perform public.shop_set_lock_settings('b0000000-0000-4000-8000-0000000002a0', true, 5, 10); assert false, '2n owner PIN required';
  exception when sqlstate 'P0001' then assert sqlerrm = 'pin_not_set', '2n code ' || sqlerrm; end;
  begin perform public.shop_set_lock_settings('b0000000-0000-4000-8000-0000000002a0', false, 0, 10); assert false, '2o invalid settings';
  exception when sqlstate 'P0001' then assert sqlerrm = 'invalid_settings', '2o code ' || sqlerrm; end;
  -- With only the owner's PIN set, the lock can be turned on.
  perform public.staff_set_pin('b0000000-0000-4000-8000-0000000002a0', owner_member, 'JpGjAh9aPug1yuS6zmq1z8aMM0a3EHBhmBDCxrUiWqk=', 'BwcHBwcHBwcHBwcHBwcHBw==');
  perform public.shop_set_lock_settings('b0000000-0000-4000-8000-0000000002a0', true, 3, 15);
end $$;
reset role;
do $$ begin
  assert (select pin_lock_enabled and idle_lock_minutes = 3 and manager_discount_pct = 15 from public.businesses where id = 'b0000000-0000-4000-8000-0000000002a0'), '2p lock settings saved';
end $$;

-- Starter: no staff_roles, so the lock is refused; the member limit (2) refuses a third member.
update public.subscriptions set plan_id = 'starter', status = 'active', trial_ends_at = null, current_period_end = now() + interval '30 days'
where business_id = 'b0000000-0000-4000-8000-0000000002b0';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000002b1","role":"authenticated"}', true);
do $$
declare
  owner_member uuid := (select id from public.business_members where business_id = 'b0000000-0000-4000-8000-0000000002b0' and role = 'owner');
begin
  perform public.staff_set_pin('b0000000-0000-4000-8000-0000000002b0', owner_member, 'JpGjAh9aPug1yuS6zmq1z8aMM0a3EHBhmBDCxrUiWqk=', 'BwcHBwcHBwcHBwcHBwcHBw==');
  begin perform public.shop_set_lock_settings('b0000000-0000-4000-8000-0000000002b0', true, 5, 10); assert false, '2q Starter refused';
  exception when sqlstate 'P0001' then assert sqlerrm = 'feature_not_in_plan', '2q code ' || sqlerrm; end;
  perform public.staff_add_member('b0000000-0000-4000-8000-0000000002b0', '00000000-0000-4000-8000-0000000002b2', 'cashier', null);
  begin perform public.staff_add_member('b0000000-0000-4000-8000-0000000002b0', '00000000-0000-4000-8000-0000000002a4', 'cashier', null); assert false, '2r member limit';
  exception when sqlstate 'P0001' then assert sqlerrm = 'plan_limit_reached', '2r code ' || sqlerrm; end;
end $$;
reset role;

-- 3. Operator and approver on synced records (Task 3). Records are inserted as the sync RPCs do; then the
-- cashier's session calls apply_operator_sync with the same payload.
insert into public.devices (id, business_id, name) values ('d0000000-0000-4000-8000-0000000002a0', 'b0000000-0000-4000-8000-0000000002a0', 'Till 1');
insert into public.register_sessions (id, business_id, device_id, business_date, opening_cash_fils, opened_by)
values ('e0000000-0000-4000-8000-0000000002a0', 'b0000000-0000-4000-8000-0000000002a0', 'd0000000-0000-4000-8000-0000000002a0', current_date, 0, '00000000-0000-4000-8000-0000000002a1');
insert into public.sales (id, business_id, device_id, register_session_id, invoice_number, operation_id, payment_method, supply_date, supplier_snapshot, net_fils, vat_fils, gross_fils, created_by)
select ('5a000000-0000-4000-8000-00000000020' || n)::uuid, 'b0000000-0000-4000-8000-0000000002a0', 'd0000000-0000-4000-8000-0000000002a0', 'e0000000-0000-4000-8000-0000000002a0',
       'S-000' || n, gen_random_uuid(), 'cash', current_date, '{}'::jsonb, 100, 5, 105, '00000000-0000-4000-8000-0000000002a1'
from generate_series(1, 4) n;
insert into public.credit_notes (id, business_id, device_id, register_session_id, sale_id, credit_note_number, operation_id, payment_method, supplier_snapshot, net_fils, vat_fils, gross_fils, created_by)
values ('c1000000-0000-4000-8000-0000000002a1', 'b0000000-0000-4000-8000-0000000002a0', 'd0000000-0000-4000-8000-0000000002a0', 'e0000000-0000-4000-8000-0000000002a0',
        '5a000000-0000-4000-8000-000000000201', 'CN-0001', gen_random_uuid(), 'cash', '{}'::jsonb, 100, 5, 105, '00000000-0000-4000-8000-0000000002a1');
insert into ids values ('other_shop', (select id from public.business_members where business_id = 'b0000000-0000-4000-8000-0000000002b0' and role = 'cashier'));

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000002a2","role":"authenticated"}', true);
do $$
declare
  cashier text := (select id from ids where name = 'cashier')::text;
  manager text := (select id from ids where name = 'manager')::text;
  other text := (select id from ids where name = 'other_shop')::text;
  biz uuid := 'b0000000-0000-4000-8000-0000000002a0';
begin
  perform public.apply_operator_sync(biz, 'sale', jsonb_build_object('sale', jsonb_build_object('id', '5a000000-0000-4000-8000-000000000201', 'operatorMemberId', cashier, 'approvedByMemberId', manager)));
  perform public.apply_operator_sync(biz, 'sale', jsonb_build_object('sale', jsonb_build_object('id', '5a000000-0000-4000-8000-000000000202', 'operatorMemberId', other)));
  perform public.apply_operator_sync(biz, 'sale', jsonb_build_object('sale', jsonb_build_object('id', '5a000000-0000-4000-8000-000000000203', 'operatorMemberId', cashier, 'approvedByMemberId', cashier)));
  perform public.apply_operator_sync(biz, 'sale', jsonb_build_object('sale', jsonb_build_object('id', '5a000000-0000-4000-8000-000000000204')));
  -- A retry with different ids changes nothing.
  perform public.apply_operator_sync(biz, 'sale', jsonb_build_object('sale', jsonb_build_object('id', '5a000000-0000-4000-8000-000000000201', 'operatorMemberId', manager)));
  perform public.apply_operator_sync(biz, 'credit-note', jsonb_build_object('creditNote', jsonb_build_object('id', 'c1000000-0000-4000-8000-0000000002a1', 'operatorMemberId', cashier, 'approvedByMemberId', manager)));
  perform public.apply_operator_sync(biz, 'register', jsonb_build_object('action', 'open', 'register', jsonb_build_object('id', 'e0000000-0000-4000-8000-0000000002a0', 'openedOperatorMemberId', cashier, 'openedApprovedByMemberId', manager)));
  perform public.apply_operator_sync(biz, 'register', jsonb_build_object('action', 'close', 'register', jsonb_build_object('id', 'e0000000-0000-4000-8000-0000000002a0', 'closedOperatorMemberId', 'not-a-uuid', 'closedApprovedByMemberId', cashier)));
end $$;
reset role;

do $$
declare
  cashier uuid := (select id from ids where name = 'cashier');
  manager uuid := (select id from ids where name = 'manager');
begin
  assert (select operator_member_id = cashier and approved_by_member_id = manager from public.sales where id = '5a000000-0000-4000-8000-000000000201'), '3a valid ids stored, retry ignored';
  assert (select operator_member_id is null from public.sales where id = '5a000000-0000-4000-8000-000000000202'), '3b other shop member -> null';
  assert (select operator_member_id = cashier and approved_by_member_id is null from public.sales where id = '5a000000-0000-4000-8000-000000000203'), '3c cashier cannot approve';
  assert (select operator_member_id is null and approved_by_member_id is null from public.sales where id = '5a000000-0000-4000-8000-000000000204'), '3d no fields -> nulls';
  assert (select count(*) from public.sales where business_id = 'b0000000-0000-4000-8000-0000000002a0') = 4, '3e no sale removed';
  assert (select count(*) from public.audit_events where action = 'sync.operator_unverified' and entity_id = '5a000000-0000-4000-8000-000000000202') = 1, '3f logged other shop';
  assert (select count(*) from public.audit_events where action = 'sync.operator_unverified' and entity_id = '5a000000-0000-4000-8000-000000000203' and summary ->> 'field' = 'approved_by_member_id') = 1, '3g logged approver';
  assert (select count(*) from public.audit_events where action = 'sync.operator_unverified' and entity_id = '5a000000-0000-4000-8000-000000000204') = 0, '3h nothing to log';
  assert (select operator_member_id = cashier and approved_by_member_id = manager from public.credit_notes where id = 'c1000000-0000-4000-8000-0000000002a1'), '3i credit note';
  assert (select opened_operator_member_id = cashier and opened_approved_by_member_id = manager and closed_operator_member_id is null and closed_approved_by_member_id is null
          from public.register_sessions where id = 'e0000000-0000-4000-8000-0000000002a0'), '3j register open stored, close nulls';
  assert (select count(*) from public.audit_events where action = 'sync.operator_unverified' and entity_id = 'e0000000-0000-4000-8000-0000000002a0') = 2, '3k close logged twice (two fields)';
end $$;

-- 4. PIN hashes: hidden from the table for everyone; staff_list gives them to the owner only.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000002a2","role":"authenticated"}', true);
do $$ begin
  begin perform pin_hash from public.business_members limit 1; assert false, '4a cashier cannot read hashes';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from public.business_members where business_id = 'b0000000-0000-4000-8000-0000000002a0') >= 3, '4b cashier still reads the team';
  begin perform * from public.staff_list('b0000000-0000-4000-8000-0000000002a0'); assert false, '4c cashier refused staff_list';
  exception when sqlstate 'P0001' then assert sqlerrm = 'not_owner', '4c code ' || sqlerrm; end;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000002a1","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.staff_list('b0000000-0000-4000-8000-0000000002a0')) = 3, '4d owner lists staff';
  assert (select role = 'owner' and pin_hash is not null and email = 'owner-a@staff.test' from public.staff_list('b0000000-0000-4000-8000-0000000002a0') limit 1), '4e owner first, with hash and email';
  assert (select last_sale_at is not null from public.staff_list('b0000000-0000-4000-8000-0000000002a0') where display_name = 'Aisha'), '4f last till use from operator records';
end $$;
reset role;

-- A non-member cannot call it.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000002b1","role":"authenticated"}', true);
do $$ begin
  begin perform public.apply_operator_sync('b0000000-0000-4000-8000-0000000002a0', 'sale', '{}'::jsonb); assert false, '3l non-member refused';
  exception when sqlstate 'P0001' then assert sqlerrm = 'not_member', '3l code ' || sqlerrm; end;
end $$;
reset role;

rollback;
