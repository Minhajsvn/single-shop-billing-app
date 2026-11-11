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

-- 2. Deliveries (Task 2). P1 stock 10 cost 5.00; P2 stock 0 no cost; P3 stock 0 cost 4.00; P4 archived; PB is shop B's.
insert into public.products (id, business_id, name, sku, price_fils, stock_quantity, low_stock_threshold, status, cost_fils) values
  ('f2000000-0000-4000-8000-0000000006a1', 'b0000000-0000-4000-8000-0000000006a0', 'Dates 1kg', 'DT-1', 1000, 10, 0, 'active', 500),
  ('f2000000-0000-4000-8000-0000000006a2', 'b0000000-0000-4000-8000-0000000006a0', 'Tea box', 'TB-1', 800, 0, 0, 'active', null),
  ('f2000000-0000-4000-8000-0000000006a3', 'b0000000-0000-4000-8000-0000000006a0', 'Coffee', 'CF-1', 900, 0, 0, 'active', 400),
  ('f2000000-0000-4000-8000-0000000006a4', 'b0000000-0000-4000-8000-0000000006a0', 'Old item', 'OI-1', 900, 5, 0, 'inactive', 100),
  ('f2000000-0000-4000-8000-0000000006b1', 'b0000000-0000-4000-8000-0000000006b0', 'B item', 'BI-1', 900, 5, 0, 'active', 100);

create function pg_temp.receipt(p_id uuid, p_invoice text, p_vat bigint, p_lines jsonb, p_supplier uuid default '5c000000-0000-4000-8000-0000000006a1') returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'supplierId', p_supplier, 'supplierInvoice', p_invoice,
    'invoiceDate', (now() at time zone 'Asia/Dubai')::date::text, 'vatFils', p_vat,
    'lines', (select jsonb_agg(jsonb_build_object('productId', l->>0, 'quantity', (l->>1)::int, 'unitCostFils', (l->>2)::bigint)) from jsonb_array_elements(p_lines) l))
$$;
grant execute on function pg_temp.receipt(uuid, text, bigint, jsonb, uuid) to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000006a1","role":"authenticated"}', true);
select public.record_purchase_receipt('b0000000-0000-4000-8000-0000000006a0', pg_temp.receipt('de000000-0000-4000-8000-0000000006a1', 'INV-1', 363,
  '[["f2000000-0000-4000-8000-0000000006a1",10,600],["f2000000-0000-4000-8000-0000000006a2",5,250]]'));
-- 2h: the same id again changes nothing.
select public.record_purchase_receipt('b0000000-0000-4000-8000-0000000006a0', pg_temp.receipt('de000000-0000-4000-8000-0000000006a1', 'INV-1', 363,
  '[["f2000000-0000-4000-8000-0000000006a1",10,600],["f2000000-0000-4000-8000-0000000006a2",5,250]]'));
-- 2f: stock 0 with an old cost takes the new price; 2g: a free line moves the average toward 0.
select public.record_purchase_receipt('b0000000-0000-4000-8000-0000000006a0', pg_temp.receipt('de000000-0000-4000-8000-0000000006a2', null, 0,
  '[["f2000000-0000-4000-8000-0000000006a3",10,700]]'));
select public.record_purchase_receipt('b0000000-0000-4000-8000-0000000006a0', pg_temp.receipt('de000000-0000-4000-8000-0000000006a3', null, 0,
  '[["f2000000-0000-4000-8000-0000000006a3",10,0]]'));
reset role;

do $$
declare
  r record;
begin
  select stock_quantity, cost_fils into r from public.products where id = 'f2000000-0000-4000-8000-0000000006a1';
  assert r.stock_quantity = 20 and r.cost_fils = 550, '2a P1 stock 20 cost 550: ' || r::text;
  select stock_quantity, cost_fils into r from public.products where id = 'f2000000-0000-4000-8000-0000000006a2';
  assert r.stock_quantity = 5 and r.cost_fils = 250, '2a P2 stock 5 cost 250: ' || r::text;
  assert (select count(*) from public.stock_movements where source_id = 'de000000-0000-4000-8000-0000000006a1' and type = 'receipt' and reason like 'Delivery%') = 2, '2b two receipt movements';
  assert (select cost_before_fils = 500 and cost_after_fils = 550 from public.purchase_receipt_lines where receipt_id = 'de000000-0000-4000-8000-0000000006a1' and product_id = 'f2000000-0000-4000-8000-0000000006a1'), '2c P1 before/after';
  assert (select cost_before_fils is null and cost_after_fils = 250 from public.purchase_receipt_lines where receipt_id = 'de000000-0000-4000-8000-0000000006a1' and product_id = 'f2000000-0000-4000-8000-0000000006a2'), '2c P2 before/after';
  assert (select net_fils = 7250 and vat_fils = 363 and gross_fils = 7613 from public.purchase_receipts where id = 'de000000-0000-4000-8000-0000000006a1'), '2d totals';
  assert (select count(*) from public.audit_events where action = 'purchase.receipt' and entity_id = 'de000000-0000-4000-8000-0000000006a1') = 1, '2e receipt audit (once, despite the retry)';
  assert (select count(*) from public.audit_events where action = 'product.cost' and summary->>'receiptId' = 'de000000-0000-4000-8000-0000000006a1') = 2, '2e cost audits';
  assert (select count(*) from public.purchase_receipts where id = 'de000000-0000-4000-8000-0000000006a1') = 1, '2h saved once';
  select stock_quantity, cost_fils into r from public.products where id = 'f2000000-0000-4000-8000-0000000006a3';
  assert r.stock_quantity = 20 and r.cost_fils = 350, '2f/2g P3 0@400 +10@700 = 700, then +10@0 = 350: ' || r::text;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000006a1","role":"authenticated"}', true);
do $$
declare
  big jsonb := (select jsonb_agg(jsonb_build_array('f2000000-0000-4000-8000-0000000006a1', 1, 100)) from generate_series(1, 201));
begin
  begin
    perform public.record_purchase_receipt('b0000000-0000-4000-8000-0000000006a0', pg_temp.receipt('de000000-0000-4000-8000-0000000006a4', 'inv-1', 0, '[["f2000000-0000-4000-8000-0000000006a1",1,100]]'));
    assert false, '2i duplicate supplier invoice';
  exception when raise_exception then assert sqlerrm = 'duplicate_supplier_invoice', '2i code: ' || sqlerrm; end;
  begin
    perform public.record_purchase_receipt('b0000000-0000-4000-8000-0000000006a0', pg_temp.receipt('de000000-0000-4000-8000-0000000006a4', null, 0,
      '[["f2000000-0000-4000-8000-0000000006a1",1,100],["f2000000-0000-4000-8000-0000000006a1",2,100]]'));
    assert false, '2j duplicate line';
  exception when raise_exception then assert sqlerrm = 'duplicate_line', '2j code: ' || sqlerrm; end;
  begin
    perform public.record_purchase_receipt('b0000000-0000-4000-8000-0000000006a0', pg_temp.receipt('de000000-0000-4000-8000-0000000006a4', null, 0, big));
    assert false, '2j 201 lines';
  exception when raise_exception then assert sqlerrm = 'invalid_receipt', '2j code: ' || sqlerrm; end;
  begin
    perform public.record_purchase_receipt('b0000000-0000-4000-8000-0000000006a0', pg_temp.receipt('de000000-0000-4000-8000-0000000006a4', null, 0, '[["f2000000-0000-4000-8000-0000000006a1",0,100]]'));
    assert false, '2j quantity 0';
  exception when raise_exception then assert sqlerrm = 'invalid_receipt', '2j code: ' || sqlerrm; end;
  begin
    perform public.record_purchase_receipt('b0000000-0000-4000-8000-0000000006a0', pg_temp.receipt('de000000-0000-4000-8000-0000000006a4', null, 101, '[["f2000000-0000-4000-8000-0000000006a1",1,100]]'));
    assert false, '2j VAT above net';
  exception when raise_exception then assert sqlerrm = 'invalid_vat', '2j code: ' || sqlerrm; end;
  begin
    perform public.record_purchase_receipt('b0000000-0000-4000-8000-0000000006a0', pg_temp.receipt('de000000-0000-4000-8000-0000000006a4', null, 0, '[["f2000000-0000-4000-8000-0000000006a4",1,100]]'));
    assert false, '2j archived product';
  exception when raise_exception then
    assert sqlerrm = 'product_archived', '2j code: ' || sqlerrm;
  end;
  begin
    perform public.record_purchase_receipt('b0000000-0000-4000-8000-0000000006a0', pg_temp.receipt('de000000-0000-4000-8000-0000000006a4', null, 0, '[["f2000000-0000-4000-8000-0000000006b1",1,100]]'));
    assert false, '2j another shop''s product';
  exception when raise_exception then assert sqlerrm = 'product_not_found', '2j code: ' || sqlerrm; end;
  begin
    perform public.record_purchase_receipt('b0000000-0000-4000-8000-0000000006a0', pg_temp.receipt('de000000-0000-4000-8000-0000000006a4', null, 0, '[["f2000000-0000-4000-8000-0000000006a1",1,100]]', '5c000000-0000-4000-8000-0000000006b1'));
    assert false, '2j another shop''s supplier';
  exception when raise_exception then assert sqlerrm = 'supplier_not_found', '2j code: ' || sqlerrm; end;
end $$;

-- 2k: void the first delivery: stock back, cost unchanged; then the invoice number is free again.
select public.void_purchase_receipt('b0000000-0000-4000-8000-0000000006a0', 'de000000-0000-4000-8000-0000000006a1', 'Wrong supplier');
select public.record_purchase_receipt('b0000000-0000-4000-8000-0000000006a0', pg_temp.receipt('de000000-0000-4000-8000-0000000006a5', 'inv-1', 0,
  '[["f2000000-0000-4000-8000-0000000006a1",10,500]]'));
reset role;
do $$
declare
  r record;
begin
  select stock_quantity, cost_fils into r from public.products where id = 'f2000000-0000-4000-8000-0000000006a1';
  -- 20 − 10 (void) + 10 = 20; cost: void leaves 550, then (10×550 + 10×500)/20 = 525.
  assert r.stock_quantity = 20 and r.cost_fils = 525, '2k void reverses stock, keeps cost: ' || r::text;
  assert (select count(*) from public.stock_movements where source_id = 'de000000-0000-4000-8000-0000000006a1' and type = 'correction_out') = 2, '2k correction movements';
  assert (select voided_at is not null and void_reason = 'Wrong supplier' and voided_by = '00000000-0000-4000-8000-0000000006a1' from public.purchase_receipts where id = 'de000000-0000-4000-8000-0000000006a1'), '2k voided fields';
  assert (select stock_quantity = 0 from public.products where id = 'f2000000-0000-4000-8000-0000000006a2'), '2k P2 back to 0';
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000006a1","role":"authenticated"}', true);
do $$ begin
  begin
    perform public.void_purchase_receipt('b0000000-0000-4000-8000-0000000006a0', 'de000000-0000-4000-8000-0000000006a1', 'Again');
    assert false, '2l void twice';
  exception when raise_exception then assert sqlerrm = 'already_voided', '2l code: ' || sqlerrm; end;
  begin
    perform public.void_purchase_receipt('b0000000-0000-4000-8000-0000000006a0', 'de000000-0000-4000-8000-0000000006a5', '  ');
    assert false, '2l empty reason';
  exception when raise_exception then assert sqlerrm = 'invalid_reason', '2l code: ' || sqlerrm; end;
end $$;
reset role;
-- 2m: most of P1 sold; voiding the 10-unit delivery would go below 0.
update public.products set stock_quantity = 5 where id = 'f2000000-0000-4000-8000-0000000006a1';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000006a1","role":"authenticated"}', true);
do $$
declare
  detail text;
begin
  begin
    perform public.void_purchase_receipt('b0000000-0000-4000-8000-0000000006a0', 'de000000-0000-4000-8000-0000000006a5', 'Too late');
    assert false, '2m stock too low';
  exception when raise_exception then
    get stacked diagnostics detail = pg_exception_detail;
    assert sqlerrm = 'stock_too_low' and detail = 'Dates 1kg:5', '2m code/detail: ' || sqlerrm || ' ' || coalesce(detail, '');
  end;
end $$;

-- 2n: reads.
do $$
declare
  d date := (now() at time zone 'Asia/Dubai')::date;
  list jsonb := public.purchase_receipt_list('b0000000-0000-4000-8000-0000000006a0', d, d);
  one jsonb := public.purchase_receipt_get('b0000000-0000-4000-8000-0000000006a0', 'de000000-0000-4000-8000-0000000006a1');
begin
  assert jsonb_array_length(list) = 4, '2n four deliveries today: ' || jsonb_array_length(list);
  assert (select count(*) from jsonb_array_elements(list) e where e->>'voidedAt' is not null) = 1, '2n one voided';
  assert (select (e->>'lineCount')::int = 2 and e->>'supplierName' = 'Al Noor Trading' and e->>'supplierTrn' = '100000000000003'
          from jsonb_array_elements(list) e where e->>'id' = 'de000000-0000-4000-8000-0000000006a1'), '2n header fields';
  assert jsonb_array_length(one->'lines') = 2 and (one #>> '{lines,0,productName}') is not null and one->>'voidReason' = 'Wrong supplier', '2n get with lines';
  begin
    perform public.purchase_receipt_list('b0000000-0000-4000-8000-0000000006a0', d - 92, d);
    assert false, '2n 93 days';
  exception when raise_exception then assert sqlerrm = 'invalid_range', '2n code: ' || sqlerrm; end;
  assert (select unit_cost_fils = 500 from public.product_last_delivery('b0000000-0000-4000-8000-0000000006a0') where product_id = 'f2000000-0000-4000-8000-0000000006a1'), '2n last delivery skips the voided one';
  assert not exists (select 1 from public.product_last_delivery('b0000000-0000-4000-8000-0000000006a0') where product_id = 'f2000000-0000-4000-8000-0000000006a2'), '2n P2 only had a voided delivery';
end $$;

-- 2o: who may.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000006a3","role":"authenticated"}', true);
select public.record_purchase_receipt('b0000000-0000-4000-8000-0000000006a0', pg_temp.receipt('de000000-0000-4000-8000-0000000006a6', null, 0, '[["f2000000-0000-4000-8000-0000000006a2",3,250]]'));
select public.void_purchase_receipt('b0000000-0000-4000-8000-0000000006a0', 'de000000-0000-4000-8000-0000000006a6', 'Manager test');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000006a2","role":"authenticated"}', true);
do $$ begin
  begin perform public.record_purchase_receipt('b0000000-0000-4000-8000-0000000006a0', '{}'::jsonb); assert false, '2o cashier record';
  exception when insufficient_privilege then null; end;
  begin perform public.void_purchase_receipt('b0000000-0000-4000-8000-0000000006a0', 'de000000-0000-4000-8000-0000000006a5', 'x'); assert false, '2o cashier void';
  exception when insufficient_privilege then null; end;
  begin perform public.purchase_receipt_list('b0000000-0000-4000-8000-0000000006a0', current_date, current_date); assert false, '2o cashier list';
  exception when insufficient_privilege then null; end;
  begin perform public.purchase_receipt_get('b0000000-0000-4000-8000-0000000006a0', 'de000000-0000-4000-8000-0000000006a5'); assert false, '2o cashier get';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.product_last_delivery('b0000000-0000-4000-8000-0000000006a0'); assert false, '2o cashier last delivery';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.purchase_receipts; assert false, '2o cashier table';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.purchase_receipt_lines; assert false, '2o cashier lines table';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000006b1","role":"authenticated"}', true);
do $$ begin
  begin perform public.purchase_receipt_list('b0000000-0000-4000-8000-0000000006b0', current_date, current_date); assert false, '2o starter';
  exception when raise_exception then assert sqlerrm = 'feature_not_in_plan', '2o code: ' || sqlerrm; end;
end $$;
reset role;

rollback;
