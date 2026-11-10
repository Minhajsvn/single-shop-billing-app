-- Stage 2D tests: suppliers and deliveries. One transaction, rolled back.
begin;

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000006a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@purchase.test'),
  ('00000000-0000-4000-8000-0000000006b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@purchase.test'),
  ('00000000-0000-4000-8000-0000000006a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cashier-a@purchase.test'),
  ('00000000-0000-4000-8000-0000000006a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'manager-a@purchase.test');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000006a1","role":"authenticated"}', true);
insert into public.businesses (id, owner_id, legal_name, trn, address, phone)
values ('b0000000-0000-4000-8000-0000000006a0', '00000000-0000-4000-8000-0000000006a1', 'Purchase Shop A LLC', '100000000000003', 'Dubai', '+971500000601');
select public.staff_add_member('b0000000-0000-4000-8000-0000000006a0', '00000000-0000-4000-8000-0000000006a2', 'cashier', 'Aisha');
select public.staff_add_member('b0000000-0000-4000-8000-0000000006a0', '00000000-0000-4000-8000-0000000006a3', 'manager', 'Omar');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000006b1","role":"authenticated"}', true);
insert into public.businesses (id, owner_id, legal_name, trn, address, phone)
values ('b0000000-0000-4000-8000-0000000006b0', '00000000-0000-4000-8000-0000000006b1', 'Purchase Shop B LLC', '100000000000003', 'Deira', '+971500000602');
reset role;
-- Shop B on Starter.
update public.subscriptions set status = 'active', plan_id = 'starter', trial_ends_at = now() - interval '1 day'
where business_id = 'b0000000-0000-4000-8000-0000000006b0';

-- 1. Suppliers (Task 1).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000006a1","role":"authenticated"}', true);
select public.supplier_save('b0000000-0000-4000-8000-0000000006a0',
  '{"id":"5c000000-0000-4000-8000-0000000006a1","name":" Al Noor Trading ","trn":"100000000000003"}');
select public.supplier_save('b0000000-0000-4000-8000-0000000006a0',
  '{"id":"5c000000-0000-4000-8000-0000000006a1","name":"Al Noor Trading","trn":"100000000000003","phone":"+971 4 000 0000"}');
do $$ begin
  assert (select count(*) from public.supplier_list('b0000000-0000-4000-8000-0000000006a0')) = 1, '1a/1b one supplier';
  assert (select name = 'Al Noor Trading' and phone = '+971 4 000 0000' from public.supplier_list('b0000000-0000-4000-8000-0000000006a0')), '1a trimmed, 1b updated';
  begin
    perform public.supplier_save('b0000000-0000-4000-8000-0000000006a0', '{"id":"5c000000-0000-4000-8000-0000000006a2","name":"al noor trading"}');
    assert false, '1c live name clash';
  exception when raise_exception then assert sqlerrm = 'supplier_name_taken', '1c code: ' || sqlerrm; end;
  begin
    perform public.supplier_save('b0000000-0000-4000-8000-0000000006a0', '{"id":"5c000000-0000-4000-8000-0000000006a3","name":"  "}');
    assert false, '1d blank name';
  exception when raise_exception then assert sqlerrm = 'invalid_supplier', '1d code: ' || sqlerrm; end;
  begin
    perform public.supplier_save('b0000000-0000-4000-8000-0000000006a0', jsonb_build_object('id', '5c000000-0000-4000-8000-0000000006a3', 'name', repeat('x', 81)));
    assert false, '1d long name';
  exception when raise_exception then assert sqlerrm = 'invalid_supplier', '1d code: ' || sqlerrm; end;
  begin
    perform public.supplier_save('b0000000-0000-4000-8000-0000000006a0', '{"id":"5c000000-0000-4000-8000-0000000006a3","name":"Bad TRN","trn":"12345"}');
    assert false, '1d bad TRN';
  exception when raise_exception then assert sqlerrm = 'invalid_supplier', '1d code: ' || sqlerrm; end;
end $$;
-- Archive, then the name is free again.
select public.supplier_save('b0000000-0000-4000-8000-0000000006a0',
  '{"id":"5c000000-0000-4000-8000-0000000006a1","name":"Al Noor Trading","trn":"100000000000003","archived":true}');
select public.supplier_save('b0000000-0000-4000-8000-0000000006a0', '{"id":"5c000000-0000-4000-8000-0000000006a2","name":"al noor trading"}');
select public.supplier_save('b0000000-0000-4000-8000-0000000006a0',
  '{"id":"5c000000-0000-4000-8000-0000000006a2","name":"Gulf Foods"}');
select public.supplier_save('b0000000-0000-4000-8000-0000000006a0',
  '{"id":"5c000000-0000-4000-8000-0000000006a1","name":"Al Noor Trading","trn":"100000000000003","archived":false}');
do $$ begin
  assert (select count(*) from public.supplier_list('b0000000-0000-4000-8000-0000000006a0') where not archived) = 2, '1c archive frees the name';
end $$;

-- Shop B owns a supplier; A cannot touch it.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000006b1","role":"authenticated"}', true);
do $$ begin
  begin
    perform public.supplier_save('b0000000-0000-4000-8000-0000000006b0', '{"id":"5c000000-0000-4000-8000-0000000006b1","name":"B supplier"}');
    assert false, '1f starter refused';
  exception when raise_exception then assert sqlerrm = 'feature_not_in_plan', '1f code: ' || sqlerrm; end;
end $$;
reset role;
insert into public.suppliers (id, business_id, name) values ('5c000000-0000-4000-8000-0000000006b1', 'b0000000-0000-4000-8000-0000000006b0', 'B supplier');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000006a1","role":"authenticated"}', true);
do $$ begin
  begin
    perform public.supplier_save('b0000000-0000-4000-8000-0000000006a0', '{"id":"5c000000-0000-4000-8000-0000000006b1","name":"Stolen"}');
    assert false, '1e another shop''s supplier';
  exception when raise_exception then assert sqlerrm = 'supplier_not_found', '1e code: ' || sqlerrm; end;
end $$;

-- Manager may; cashier may not, and cannot read the table.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000006a3","role":"authenticated"}', true);
select public.supplier_save('b0000000-0000-4000-8000-0000000006a0', '{"id":"5c000000-0000-4000-8000-0000000006a4","name":"Manager Supplies"}');
do $$ begin
  assert (select count(*) from public.supplier_list('b0000000-0000-4000-8000-0000000006a0')) = 3, '1f manager lists';
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000006a2","role":"authenticated"}', true);
do $$ begin
  begin
    perform public.supplier_list('b0000000-0000-4000-8000-0000000006a0');
    assert false, '1f cashier refused';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.suppliers;
    assert false, '1g cashier cannot read the table';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- @@RECEIPTS@@

rollback;
