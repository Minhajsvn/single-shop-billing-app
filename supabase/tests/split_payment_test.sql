-- Stage 2B tests: payment methods, payment rows, sync with payments. One transaction, always rolled back.
begin;

-- 1. Methods (Task 1).
do $$ begin
  assert 'transfer' = any(enum_range(null::public.payment_method)::text[]), '1a transfer method';
  assert 'split' = any(enum_range(null::public.payment_method)::text[]), '1b split summary';
end $$;

-- 2. Payment rows (Task 2). Backfill: every sale and credit note already in the database has rows adding up to its total.
do $$ begin
  assert not exists (
    select 1 from public.sales s
    where s.gross_fils <> coalesce((select sum(p.amount_fils) from public.sale_payments p where p.sale_id = s.id), 0)
  ), '2a every existing sale is covered by its payment rows';
  assert not exists (
    select 1 from public.credit_notes c
    where c.gross_fils <> coalesce((select sum(p.amount_fils) from public.credit_note_payments p where p.credit_note_id = c.id), 0)
  ), '2b every existing credit note is covered by its payment rows';
end $$;

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000003a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@split.test'),
  ('00000000-0000-4000-8000-0000000003b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@split.test'),
  ('00000000-0000-4000-8000-0000000003a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cashier-a@split.test');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000003a1","role":"authenticated"}', true);
insert into public.businesses (id, owner_id, legal_name, trn, address, phone)
values ('b0000000-0000-4000-8000-0000000003a0', '00000000-0000-4000-8000-0000000003a1', 'Split Shop A LLC', '100000000000003', 'Al Barsha, Dubai', '+971500000301');
select public.staff_add_member('b0000000-0000-4000-8000-0000000003a0', '00000000-0000-4000-8000-0000000003a2', 'cashier', 'Aisha');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000003b1","role":"authenticated"}', true);
insert into public.businesses (id, owner_id, legal_name, trn, address, phone)
values ('b0000000-0000-4000-8000-0000000003b0', '00000000-0000-4000-8000-0000000003b1', 'Split Shop B LLC', '100000000000003', 'Deira, Dubai', '+971500000302');
reset role;

insert into public.devices (id, business_id, name) values ('d0000000-0000-4000-8000-0000000003a0', 'b0000000-0000-4000-8000-0000000003a0', 'Till 1');
insert into public.register_sessions (id, business_id, device_id, business_date, opening_cash_fils, opened_by)
values ('e0000000-0000-4000-8000-0000000003a0', 'b0000000-0000-4000-8000-0000000003a0', 'd0000000-0000-4000-8000-0000000003a0', current_date, 0, '00000000-0000-4000-8000-0000000003a1');
insert into public.sales (id, business_id, device_id, register_session_id, invoice_number, operation_id, payment_method, supply_date, supplier_snapshot, net_fils, vat_fils, gross_fils, created_by)
values ('5a000000-0000-4000-8000-000000000301', 'b0000000-0000-4000-8000-0000000003a0', 'd0000000-0000-4000-8000-0000000003a0', 'e0000000-0000-4000-8000-0000000003a0',
        'P-0001', gen_random_uuid(), 'split', current_date, '{}'::jsonb, 7352, 368, 7720, '00000000-0000-4000-8000-0000000003a1');
insert into public.sale_payments (id, business_id, sale_id, method, amount_fils) values
  (gen_random_uuid(), 'b0000000-0000-4000-8000-0000000003a0', '5a000000-0000-4000-8000-000000000301', 'cash', 5000),
  (gen_random_uuid(), 'b0000000-0000-4000-8000-0000000003a0', '5a000000-0000-4000-8000-000000000301', 'card', 2720);

do $$ begin
  begin
    insert into public.sale_payments (id, business_id, sale_id, method, amount_fils)
    values (gen_random_uuid(), 'b0000000-0000-4000-8000-0000000003a0', '5a000000-0000-4000-8000-000000000301', 'cash', 1);
    assert false, '2c one row per method';
  exception when unique_violation then null; end;
  begin
    insert into public.sale_payments (id, business_id, sale_id, method, amount_fils)
    values (gen_random_uuid(), 'b0000000-0000-4000-8000-0000000003a0', '5a000000-0000-4000-8000-000000000301', 'split', 1);
    assert false, '2d split is not a row method';
  exception when check_violation then null; end;
  begin
    insert into public.sale_payments (id, business_id, sale_id, method, amount_fils)
    values (gen_random_uuid(), 'b0000000-0000-4000-8000-0000000003a0', '5a000000-0000-4000-8000-000000000301', 'transfer', 0);
    assert false, '2e amount above zero';
  exception when check_violation then null; end;
  begin
    insert into public.sale_payments (id, business_id, sale_id, method, amount_fils, reference)
    values (gen_random_uuid(), 'b0000000-0000-4000-8000-0000000003a0', '5a000000-0000-4000-8000-000000000301', 'transfer', 1, repeat('x', 61));
    assert false, '2f reference at most 60';
  exception when check_violation then null; end;
end $$;

-- Owner B sees nothing of A; the cashier sees today's sale's rows; nobody writes rows directly.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000003b1","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.sale_payments where sale_id = '5a000000-0000-4000-8000-000000000301') = 0, '2g other shop sees none';
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000003a2","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.sale_payments where sale_id = '5a000000-0000-4000-8000-000000000301') = 2, '2h cashier sees today''s rows';
  begin
    insert into public.sale_payments (id, business_id, sale_id, method, amount_fils)
    values (gen_random_uuid(), 'b0000000-0000-4000-8000-0000000003a0', '5a000000-0000-4000-8000-000000000301', 'transfer', 1);
    assert false, '2i no direct writes';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 3. Sync with payments (Task 3). The owner's till syncs sales and a refund through the wrappers.
create temp table sale_payload (name text primary key, body jsonb) on commit drop;
insert into sale_payload values ('base', jsonb_build_object(
  'deviceId', 'd0000000-0000-4000-8000-0000000003a0',
  'sale', jsonb_build_object(
    'invoiceNumber', 'P-0002', 'createdAt', now()::text, 'supplyDate', current_date::text, 'status', 'completed',
    'netFils', 7352, 'vatFils', 368, 'grossFils', 7720,
    'lines', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'name', 'Medjool Dates 1kg', 'quantity', 1,
      'unitGrossFils', 7720, 'netFils', 7352, 'vatFils', 368, 'grossFils', 7720)))));
grant all on sale_payload to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000003a1","role":"authenticated"}', true);
do $$
declare
  base jsonb := (select body from sale_payload where name = 'base');
  op uuid := gen_random_uuid();
  ok_sale jsonb;
begin
  -- 3a cash + card split saved with its two rows.
  ok_sale := jsonb_set(jsonb_set(jsonb_set(jsonb_set(base, '{sale,lines,0,id}', to_jsonb(gen_random_uuid()::text)), '{sale,invoiceNumber}', '"P-302"'), '{sale,id}', '"5a000000-0000-4000-8000-000000000302"'), '{sale,paymentMethod}', '"split"');
  ok_sale := jsonb_set(ok_sale, '{sale,payments}', jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'method', 'cash', 'amountFils', 5000),
    jsonb_build_object('id', gen_random_uuid(), 'method', 'card', 'amountFils', 2720)));
  perform public.apply_sale_sync_with_payments(op, 'b0000000-0000-4000-8000-0000000003a0', '5a000000-0000-4000-8000-000000000302', ok_sale);
  -- 3e the same operation again changes nothing.
  perform public.apply_sale_sync_with_payments(op, 'b0000000-0000-4000-8000-0000000003a0', '5a000000-0000-4000-8000-000000000302', ok_sale);
  assert (select count(*) from public.sale_payments where sale_id = '5a000000-0000-4000-8000-000000000302') = 2, '3a/3e two rows, saved once';
  assert (select payment_method = 'split' from public.sales where id = '5a000000-0000-4000-8000-000000000302'), '3a summary split';

  -- 3b parts not adding up: refused, nothing saved.
  begin
    perform public.apply_sale_sync_with_payments(gen_random_uuid(), 'b0000000-0000-4000-8000-0000000003a0', '5a000000-0000-4000-8000-000000000303',
      jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(base, '{sale,lines,0,id}', to_jsonb(gen_random_uuid()::text)), '{sale,invoiceNumber}', '"P-303"'), '{sale,id}', '"5a000000-0000-4000-8000-000000000303"'), '{sale,paymentMethod}', '"split"'), '{sale,payments}',
        jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'method', 'cash', 'amountFils', 5000),
                          jsonb_build_object('id', gen_random_uuid(), 'method', 'card', 'amountFils', 2700))));
    assert false, '3b mismatch refused';
  exception when sqlstate 'P0001' then assert sqlerrm = 'payments_mismatch', '3b code ' || sqlerrm; end;
  assert not exists (select 1 from public.sales where id = '5a000000-0000-4000-8000-000000000303'), '3b no sale saved';

  -- 3c summary says cash but there are two rows: refused.
  begin
    perform public.apply_sale_sync_with_payments(gen_random_uuid(), 'b0000000-0000-4000-8000-0000000003a0', '5a000000-0000-4000-8000-000000000304',
      jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(base, '{sale,lines,0,id}', to_jsonb(gen_random_uuid()::text)), '{sale,invoiceNumber}', '"P-304"'), '{sale,id}', '"5a000000-0000-4000-8000-000000000304"'), '{sale,paymentMethod}', '"cash"'), '{sale,payments}',
        jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'method', 'cash', 'amountFils', 5000),
                          jsonb_build_object('id', gen_random_uuid(), 'method', 'card', 'amountFils', 2720))));
    assert false, '3c summary mismatch refused';
  exception when sqlstate 'P0001' then assert sqlerrm = 'payments_mismatch', '3c code ' || sqlerrm; end;

  -- 3d an older till: no payments, method transfer, gets one transfer row.
  perform public.apply_sale_sync_with_payments(gen_random_uuid(), 'b0000000-0000-4000-8000-0000000003a0', '5a000000-0000-4000-8000-000000000305',
    jsonb_set(jsonb_set(jsonb_set(jsonb_set(base, '{sale,lines,0,id}', to_jsonb(gen_random_uuid()::text)), '{sale,invoiceNumber}', '"P-305"'), '{sale,id}', '"5a000000-0000-4000-8000-000000000305"'), '{sale,paymentMethod}', '"transfer"'));
  assert (select count(*) = 1 and min(method::text) = 'transfer' and sum(amount_fils) = 7720 from public.sale_payments where sale_id = '5a000000-0000-4000-8000-000000000305'), '3d one transfer row';
end $$;
reset role;

do $$ begin
  assert not exists (
    select 1 from public.sales s where s.business_id = 'b0000000-0000-4000-8000-0000000003a0' and s.id <> '5a000000-0000-4000-8000-000000000301'
      and s.gross_fils <> coalesce((select sum(p.amount_fils) from public.sale_payments p where p.sale_id = s.id), 0)
  ), '3f synced sales are covered by their rows';
end $$;

-- @task3b

rollback;
