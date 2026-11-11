-- Stage 2F tests: weighed items and scale labels. One transaction, rolled back.
begin;

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000008a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@weigh.test'),
  ('00000000-0000-4000-8000-0000000008b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@weigh.test'),
  ('00000000-0000-4000-8000-0000000008a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'manager-a@weigh.test');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000008a1","role":"authenticated"}', true);
insert into public.businesses (id, owner_id, legal_name, trn, address, phone)
values ('b0000000-0000-4000-8000-0000000008a0', '00000000-0000-4000-8000-0000000008a1', 'Weigh Shop A LLC', '100000000000003', 'Dubai', '+971500000801');
select public.staff_add_member('b0000000-0000-4000-8000-0000000008a0', '00000000-0000-4000-8000-0000000008a3', 'manager', 'Omar');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000008b1","role":"authenticated"}', true);
insert into public.businesses (id, owner_id, legal_name, trn, address, phone)
values ('b0000000-0000-4000-8000-0000000008b0', '00000000-0000-4000-8000-0000000008b1', 'Weigh Shop B LLC', '100000000000003', 'Deira', '+971500000802');
reset role;
update public.subscriptions set status = 'active', plan_id = 'starter', trial_ends_at = now() - interval '1 day'
where business_id = 'b0000000-0000-4000-8000-0000000008b0';

insert into public.devices (id, business_id, name) values
  ('d0000000-0000-4000-8000-0000000008a0', 'b0000000-0000-4000-8000-0000000008a0', 'Till 1'),
  ('d0000000-0000-4000-8000-0000000008b0', 'b0000000-0000-4000-8000-0000000008b0', 'Till 1');
insert into public.register_sessions (id, business_id, device_id, business_date, opening_cash_fils, opened_by)
values ('e0000000-0000-4000-8000-0000000008a0', 'b0000000-0000-4000-8000-0000000008a0', 'd0000000-0000-4000-8000-0000000008a0',
        (now() at time zone 'Asia/Dubai')::date, 0, '00000000-0000-4000-8000-0000000008a1');
-- Dates (weighed, stock set after switching), Cola (ordinary), Nuts (ordinary, stock 5), B item on the Starter shop.
insert into public.products (id, business_id, name, sku, price_fils, stock_quantity, low_stock_threshold, status, cost_fils) values
  ('f4000000-0000-4000-8000-0000000008a1', 'b0000000-0000-4000-8000-0000000008a0', 'Medjool Dates', 'DATES', 4000, 0, 0, 'active', 3000),
  ('f4000000-0000-4000-8000-0000000008a2', 'b0000000-0000-4000-8000-0000000008a0', 'Cola', 'COLA', 600, 50, 0, 'active', 300),
  ('f4000000-0000-4000-8000-0000000008a3', 'b0000000-0000-4000-8000-0000000008a0', 'Nuts', 'NUTS', 5000, 5, 0, 'active', null),
  ('f4000000-0000-4000-8000-0000000008b1', 'b0000000-0000-4000-8000-0000000008b0', 'B item', 'BI', 600, 0, 0, 'active', null);
insert into public.suppliers (id, business_id, name) values ('5b000000-0000-4000-8000-0000000008a1', 'b0000000-0000-4000-8000-0000000008a0', 'Farm');

create function pg_temp.product(p_shop text, p_id text, p_sku text, p_extra jsonb) returns jsonb language sql as $$
  select jsonb_build_object('deviceId', case when p_shop = 'a' then 'd0000000-0000-4000-8000-0000000008a0' else 'd0000000-0000-4000-8000-0000000008b0' end,
    'product', jsonb_build_object('id', p_id, 'name', p_sku, 'sku', p_sku, 'priceFils', 4000, 'lowStockThreshold', 0, 'active', true, 'taxCategory', 'standard') || p_extra)
$$;
-- Lines: [productId, quantity, unitGross, net, vat, lineId, weightGrams or null]
create function pg_temp.sale_payload(p_id uuid, p_invoice text, p_lines jsonb) returns jsonb language sql as $$
  select jsonb_build_object('deviceId', 'd0000000-0000-4000-8000-0000000008a0', 'sale', jsonb_build_object(
    'id', p_id, 'invoiceNumber', p_invoice, 'createdAt', now()::text, 'supplyDate', (now() at time zone 'Asia/Dubai')::date::text,
    'status', 'completed', 'paymentMethod', 'cash',
    'netFils', (select sum((l->>3)::bigint) from jsonb_array_elements(p_lines) l),
    'vatFils', (select sum((l->>4)::bigint) from jsonb_array_elements(p_lines) l),
    'grossFils', (select sum((l->>3)::bigint + (l->>4)::bigint) from jsonb_array_elements(p_lines) l),
    'lines', (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', l->>5, 'productId', l->>0, 'name', 'Line', 'quantity', (l->>1)::int,
      'unitGrossFils', (l->>2)::bigint, 'netFils', (l->>3)::bigint, 'vatFils', (l->>4)::bigint, 'grossFils', (l->>3)::bigint + (l->>4)::bigint,
      'weightGrams', l->6)))
      from jsonb_array_elements(p_lines) l)))
$$;
create function pg_temp.note_payload(p_id uuid, p_number text, p_sale uuid, p_line uuid, p_original uuid, p_qty int, p_net bigint, p_vat bigint) returns jsonb language sql as $$
  select jsonb_build_object('deviceId', 'd0000000-0000-4000-8000-0000000008a0', 'creditNote', jsonb_build_object(
    'id', p_id, 'creditNoteNumber', p_number, 'saleId', p_sale, 'createdAt', now()::text, 'paymentMethod', 'cash',
    'netFils', p_net * p_qty, 'vatFils', p_vat * p_qty, 'grossFils', (p_net + p_vat) * p_qty,
    'lines', jsonb_build_array(jsonb_build_object('id', p_line, 'originalLineId', p_original, 'name', 'Line', 'quantity', p_qty,
      'unitGrossFils', p_net + p_vat, 'netFils', p_net * p_qty, 'vatFils', p_vat * p_qty, 'grossFils', (p_net + p_vat) * p_qty))))
$$;
grant execute on function pg_temp.product(text, text, text, jsonb) to authenticated;
grant execute on function pg_temp.sale_payload(uuid, text, jsonb) to authenticated;
grant execute on function pg_temp.note_payload(uuid, text, uuid, uuid, uuid, int, bigint, bigint) to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000008a1","role":"authenticated"}', true);

-- 1. Switching to sold by weight, scale codes.
select public.apply_product_sync('06000000-0000-4000-8000-0000000008a1', 'b0000000-0000-4000-8000-0000000008a0', 'f4000000-0000-4000-8000-0000000008a1',
  pg_temp.product('a', 'f4000000-0000-4000-8000-0000000008a1', 'DATES', '{"soldByWeight":true,"scaleCode":1234}'));
do $$
begin
  assert (select sold_by_weight and scale_code = 1234 from public.products where id = 'f4000000-0000-4000-8000-0000000008a1'), '1a switched on with code';
  begin
    perform public.apply_product_sync('06000000-0000-4000-8000-0000000008a2', 'b0000000-0000-4000-8000-0000000008a0', 'f4000000-0000-4000-8000-0000000008a3',
      pg_temp.product('a', 'f4000000-0000-4000-8000-0000000008a3', 'NUTS', '{"soldByWeight":true}'));
    assert false, '1b stock 5 refused';
  exception when raise_exception then assert sqlerrm = 'weight_switch_needs_zero_stock', '1b code ' || sqlerrm; end;
  begin
    perform public.apply_product_sync('06000000-0000-4000-8000-0000000008a3', 'b0000000-0000-4000-8000-0000000008a0', 'f4000000-0000-4000-8000-0000000008a2',
      pg_temp.product('a', 'f4000000-0000-4000-8000-0000000008a2', 'COLA', '{"scaleCode":1234}'));
    assert false, '1c duplicate scale code';
  exception when raise_exception then assert sqlerrm = 'scale_code_taken', '1c code ' || sqlerrm; end;
  begin
    perform public.apply_product_sync('06000000-0000-4000-8000-0000000008a4', 'b0000000-0000-4000-8000-0000000008a0', 'f4000000-0000-4000-8000-0000000008a2',
      pg_temp.product('a', 'f4000000-0000-4000-8000-0000000008a2', 'COLA', '{"scaleCode":0}'));
    assert false, '1d scale code 0';
  exception when raise_exception then assert sqlerrm = 'invalid_scale_code', '1d code ' || sqlerrm; end;
  -- An edit without the new keys (an older till) keeps both.
  perform public.apply_product_sync('06000000-0000-4000-8000-0000000008a5', 'b0000000-0000-4000-8000-0000000008a0', 'f4000000-0000-4000-8000-0000000008a1',
    pg_temp.product('a', 'f4000000-0000-4000-8000-0000000008a1', 'DATES', '{}'));
  assert (select sold_by_weight and scale_code = 1234 and name = 'DATES' from public.products where id = 'f4000000-0000-4000-8000-0000000008a1'), '1e older till keeps weight fields';
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000008b1","role":"authenticated"}', true);
do $$
begin
  -- Another shop may reuse 1234 (but Starter cannot switch on).
  perform public.apply_product_sync('06000000-0000-4000-8000-0000000008b1', 'b0000000-0000-4000-8000-0000000008b0', 'f4000000-0000-4000-8000-0000000008b1',
    pg_temp.product('b', 'f4000000-0000-4000-8000-0000000008b1', 'BI', '{"scaleCode":1234}'));
  assert (select scale_code = 1234 from public.products where id = 'f4000000-0000-4000-8000-0000000008b1'), '1f other shop reuses code';
  begin
    perform public.apply_product_sync('06000000-0000-4000-8000-0000000008b2', 'b0000000-0000-4000-8000-0000000008b0', 'f4000000-0000-4000-8000-0000000008b1',
      pg_temp.product('b', 'f4000000-0000-4000-8000-0000000008b1', 'BI', '{"soldByWeight":true}'));
    assert false, '1g Starter refused';
  exception when raise_exception then assert sqlerrm = 'feature_not_in_plan', '1g code ' || sqlerrm; end;
end $$;
reset role;

-- Dates now hold 5 kg.
update public.products set stock_quantity = 5000 where id = 'f4000000-0000-4000-8000-0000000008a1';

-- 2. Sales.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000008a1","role":"authenticated"}', true);
-- W1: 750 g of dates at 40.00/kg = 30.00 (net 2857 + VAT 143), plus 2 × Cola.
select public.apply_sale_sync_with_payments('07000000-0000-4000-8000-0000000008a1', 'b0000000-0000-4000-8000-0000000008a0', '5a000000-0000-4000-8000-0000000008a1',
  pg_temp.sale_payload('5a000000-0000-4000-8000-0000000008a1', 'W-0001',
    '[["f4000000-0000-4000-8000-0000000008a1",1,3000,2857,143,"12000000-0000-4000-8000-0000000008a1",750],["f4000000-0000-4000-8000-0000000008a2",2,600,1143,57,"12000000-0000-4000-8000-0000000008a2",null]]'));
do $$
declare
  bads jsonb[] := array[
    '[["f4000000-0000-4000-8000-0000000008a1",1,3000,2857,143,"12000000-0000-4000-8000-0000000008a9",null]]',
    '[["f4000000-0000-4000-8000-0000000008a1",2,1500,2857,143,"12000000-0000-4000-8000-0000000008a9",750]]',
    '[["f4000000-0000-4000-8000-0000000008a2",1,600,571,29,"12000000-0000-4000-8000-0000000008a9",750]]',
    '[["f4000000-0000-4000-8000-0000000008a1",1,3000,2857,143,"12000000-0000-4000-8000-0000000008a9",100001]]',
    '[["f4000000-0000-4000-8000-0000000008a1",1,3000,2857,143,"12000000-0000-4000-8000-0000000008a9",0]]'
  ]::jsonb[];
  bad jsonb;
  n int := 0;
begin
  assert (select stock_quantity = 4250 from public.products where id = 'f4000000-0000-4000-8000-0000000008a1'), '2a dates 4250 g';
  assert (select stock_quantity = 48 from public.products where id = 'f4000000-0000-4000-8000-0000000008a2'), '2a cola 48';
  assert (select quantity_delta = -750 from public.stock_movements where source_id = '5a000000-0000-4000-8000-0000000008a1' and product_id = 'f4000000-0000-4000-8000-0000000008a1'), '2a movement -750';
  assert (select weight_grams = 750 and quantity = 1 from public.sale_items where id = '12000000-0000-4000-8000-0000000008a1'), '2a weighed line grams';
  assert (select weight_grams is null from public.sale_items where id = '12000000-0000-4000-8000-0000000008a2'), '2a ordinary line no grams';
  foreach bad in array bads loop
    n := n + 1;
    begin
      perform public.apply_sale_sync_with_payments(('07000000-0000-4000-8000-00000000080' || n)::uuid, 'b0000000-0000-4000-8000-0000000008a0', ('5a000000-0000-4000-8000-00000000080' || n)::uuid,
        pg_temp.sale_payload(('5a000000-0000-4000-8000-00000000080' || n)::uuid, 'W-X' || n, bad));
      assert false, '2b refused: ' || bad::text;
    exception when raise_exception then assert sqlerrm = 'weight_mismatch', '2b code ' || sqlerrm || ' for ' || bad::text; end;
  end loop;
  assert (select stock_quantity = 4250 from public.products where id = 'f4000000-0000-4000-8000-0000000008a1'), '2b stock untouched';
end $$;
-- Costs are hidden from members (2C): read them as the test superuser.
reset role;
do $$
begin
  assert (select unit_cost_fils = 2250 from public.sale_items where id = '12000000-0000-4000-8000-0000000008a1'), '2a weighed cost by grams';
  assert (select unit_cost_fils = 300 from public.sale_items where id = '12000000-0000-4000-8000-0000000008a2'), '2a ordinary cost unchanged';
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000008a1","role":"authenticated"}', true);

-- 3. Refunds: the weighed line comes back whole with its grams.
select public.apply_credit_note_sync_with_payments('08000000-0000-4000-8000-0000000008a1', 'b0000000-0000-4000-8000-0000000008a0', '6c000000-0000-4000-8000-0000000008a1',
  pg_temp.note_payload('6c000000-0000-4000-8000-0000000008a1', 'CN-W1', '5a000000-0000-4000-8000-0000000008a1', '13000000-0000-4000-8000-0000000008a1', '12000000-0000-4000-8000-0000000008a1', 1, 2857, 143));
do $$
begin
  assert (select stock_quantity = 5000 from public.products where id = 'f4000000-0000-4000-8000-0000000008a1'), '3a grams back';
  assert (select weight_grams = 750 from public.credit_note_items where id = '13000000-0000-4000-8000-0000000008a1'), '3a refund line grams and cost';
  assert (select quantity_delta = 750 from public.stock_movements where source_id = '6c000000-0000-4000-8000-0000000008a1'), '3a movement +750';
end $$;

-- 4. Profit: kg sold per product (sold 750, refunded 750).
do $$
declare
  report jsonb;
begin
  report := public.profit_report('b0000000-0000-4000-8000-0000000008a0', (now() at time zone 'Asia/Dubai')::date, (now() at time zone 'Asia/Dubai')::date);
  assert (select (e->>'weightGrams')::int = 0 from jsonb_array_elements(report->'byProduct') e where e->>'productId' = 'f4000000-0000-4000-8000-0000000008a1'), '4a dates weightGrams 0: ' || (report->'byProduct')::text;
  assert (select e->'weightGrams' = 'null'::jsonb from jsonb_array_elements(report->'byProduct') e where e->>'productId' = 'f4000000-0000-4000-8000-0000000008a2'), '4a cola weightGrams null';
end $$;
-- W2: another 500 g (20.00), kept.
select public.apply_sale_sync_with_payments('07000000-0000-4000-8000-0000000008a2', 'b0000000-0000-4000-8000-0000000008a0', '5a000000-0000-4000-8000-0000000008a2',
  pg_temp.sale_payload('5a000000-0000-4000-8000-0000000008a2', 'W-0002', '[["f4000000-0000-4000-8000-0000000008a1",1,2000,1905,95,"12000000-0000-4000-8000-0000000008a3",500]]'));
do $$
declare
  report jsonb := public.profit_report('b0000000-0000-4000-8000-0000000008a0', (now() at time zone 'Asia/Dubai')::date, (now() at time zone 'Asia/Dubai')::date);
begin
  assert (select (e->>'weightGrams')::int = 500 and (e->>'costFils')::int = 1500 from jsonb_array_elements(report->'byProduct') e where e->>'productId' = 'f4000000-0000-4000-8000-0000000008a1'), '4b 500 g sold, cost 15.00: ' || (report->'byProduct')::text;
end $$;

-- 5. Deliveries in kg: 25.5 kg at 20.00/kg onto 4.5 kg at 30.00/kg.
select public.record_purchase_receipt('b0000000-0000-4000-8000-0000000008a0', jsonb_build_object(
  'id', '9d000000-0000-4000-8000-0000000008a1', 'supplierId', '5b000000-0000-4000-8000-0000000008a1', 'invoiceDate', (now() at time zone 'Asia/Dubai')::date::text,
  'vatFils', 0, 'lines', jsonb_build_array(jsonb_build_object('productId', 'f4000000-0000-4000-8000-0000000008a1', 'quantity', 25500, 'unitCostFils', 2000))));
do $$
begin
  assert (select stock_quantity = 30000 from public.products where id = 'f4000000-0000-4000-8000-0000000008a1'), '5a stock in grams';
  begin
    perform public.record_purchase_receipt('b0000000-0000-4000-8000-0000000008a0', jsonb_build_object(
      'id', '9d000000-0000-4000-8000-0000000008a2', 'supplierId', '5b000000-0000-4000-8000-0000000008a1', 'invoiceDate', (now() at time zone 'Asia/Dubai')::date::text,
      'vatFils', 0, 'lines', jsonb_build_array(jsonb_build_object('productId', 'f4000000-0000-4000-8000-0000000008a2', 'quantity', 100001, 'unitCostFils', 100))));
    assert false, '5b ordinary product above 100000 units';
  exception when raise_exception then assert sqlerrm = 'invalid_receipt', '5b code ' || sqlerrm; end;
end $$;
reset role;
do $$
begin
  assert (select line_net_fils = 51000 and by_weight from public.purchase_receipt_lines where receipt_id = '9d000000-0000-4000-8000-0000000008a1'), '5a line net and by_weight';
  assert (select net_fils = 51000 from public.purchase_receipts where id = '9d000000-0000-4000-8000-0000000008a1'), '5a receipt net';
  -- round((4500 × 3000 + 25500 × 2000) / 30000) = 2150
  assert (select cost_fils = 2150 from public.products where id = 'f4000000-0000-4000-8000-0000000008a1'), '5a per-kg average by grams';
  assert (select unit_cost_fils = 2250 from public.credit_note_items where id = '13000000-0000-4000-8000-0000000008a1'), '3a refund cost copied';
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000008a1","role":"authenticated"}', true);
select public.void_purchase_receipt('b0000000-0000-4000-8000-0000000008a0', '9d000000-0000-4000-8000-0000000008a1', 'Wrong supplier');
reset role;
do $$
begin
  assert (select stock_quantity = 4500 and cost_fils = 2150 from public.products where id = 'f4000000-0000-4000-8000-0000000008a1'), '5c void takes grams back, cost stays';
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000008a1","role":"authenticated"}', true);

-- 6. A product switched since the sale: the refund pays back but does not restock.
reset role;
update public.products set stock_quantity = 0 where id = 'f4000000-0000-4000-8000-0000000008a2';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000008a1","role":"authenticated"}', true);
select public.apply_product_sync('06000000-0000-4000-8000-0000000008a6', 'b0000000-0000-4000-8000-0000000008a0', 'f4000000-0000-4000-8000-0000000008a2',
  pg_temp.product('a', 'f4000000-0000-4000-8000-0000000008a2', 'COLA', '{"soldByWeight":true}'));
select public.apply_credit_note_sync_with_payments('08000000-0000-4000-8000-0000000008a2', 'b0000000-0000-4000-8000-0000000008a0', '6c000000-0000-4000-8000-0000000008a2',
  pg_temp.note_payload('6c000000-0000-4000-8000-0000000008a2', 'CN-W2', '5a000000-0000-4000-8000-0000000008a1', '13000000-0000-4000-8000-0000000008a2', '12000000-0000-4000-8000-0000000008a2', 1, 571, 29));
do $$
begin
  assert (select stock_quantity = 0 from public.products where id = 'f4000000-0000-4000-8000-0000000008a2'), '6a no restock after a switch';
  assert exists (select 1 from public.credit_notes where id = '6c000000-0000-4000-8000-0000000008a2'), '6a refund saved';
end $$;

-- 7. Scale label setting.
do $$
begin
  assert (select scale_label = '{"prefixes":["21","22"],"codeLength":5,"value":"weight"}'::jsonb from public.businesses where id = 'b0000000-0000-4000-8000-0000000008a0'), '7a default';
  perform public.shop_set_scale_label('b0000000-0000-4000-8000-0000000008a0', '{"prefixes":["23"],"codeLength":4,"value":"price"}');
  assert (select scale_label = '{"prefixes":["23"],"codeLength":4,"value":"price"}'::jsonb from public.businesses where id = 'b0000000-0000-4000-8000-0000000008a0'), '7b stored';
  begin
    perform public.shop_set_scale_label('b0000000-0000-4000-8000-0000000008a0', '{"prefixes":["19"],"codeLength":5,"value":"weight"}');
    assert false, '7c prefix 19';
  exception when raise_exception then assert sqlerrm = 'invalid_scale_label', '7c code ' || sqlerrm; end;
  begin
    perform public.shop_set_scale_label('b0000000-0000-4000-8000-0000000008a0', '{"prefixes":["21"],"codeLength":7,"value":"weight"}');
    assert false, '7c length 7';
  exception when raise_exception then assert sqlerrm = 'invalid_scale_label', '7c code ' || sqlerrm; end;
  begin
    update public.businesses set scale_label = '{"prefixes":["29"],"codeLength":5,"value":"weight"}' where id = 'b0000000-0000-4000-8000-0000000008a0';
    assert false, '7d direct update refused';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000008a3","role":"authenticated"}', true);
do $$
begin
  perform public.shop_set_scale_label('b0000000-0000-4000-8000-0000000008a0', '{"prefixes":["21"],"codeLength":5,"value":"weight"}');
  assert false, '7e manager refused';
exception when raise_exception then assert sqlerrm = 'not_owner', '7e code ' || sqlerrm; end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000008b1","role":"authenticated"}', true);
do $$
begin
  perform public.shop_set_scale_label('b0000000-0000-4000-8000-0000000008b0', '{"prefixes":["21"],"codeLength":5,"value":"weight"}');
  assert false, '7f Starter refused';
exception when raise_exception then assert sqlerrm = 'feature_not_in_plan', '7f code ' || sqlerrm; end $$;
reset role;

rollback;
