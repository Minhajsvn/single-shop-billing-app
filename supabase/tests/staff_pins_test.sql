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
  assert (select pin_hash is null and pin_salt is null and pin_set_at is null from public.business_members where id = (select id from ids where name = 'cashier')), '2l PIN reset';
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

-- @task3

rollback;
