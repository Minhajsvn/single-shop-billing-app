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

-- @task2

rollback;
