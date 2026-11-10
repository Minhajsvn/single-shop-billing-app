-- Stage 2C tests: categories, cost hidden from cashiers, cost stamped on sync, profit report. One transaction, rolled back.
begin;

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000004a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@margin.test'),
  ('00000000-0000-4000-8000-0000000004b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@margin.test'),
  ('00000000-0000-4000-8000-0000000004a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cashier-a@margin.test'),
  ('00000000-0000-4000-8000-0000000004a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'manager-a@margin.test');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000004a1","role":"authenticated"}', true);
insert into public.businesses (id, owner_id, legal_name, trn, address, phone)
values ('b0000000-0000-4000-8000-0000000004a0', '00000000-0000-4000-8000-0000000004a1', 'Margin Shop A LLC', '100000000000003', 'Al Barsha, Dubai', '+971500000401');
select public.staff_add_member('b0000000-0000-4000-8000-0000000004a0', '00000000-0000-4000-8000-0000000004a2', 'cashier', 'Aisha');
select public.staff_add_member('b0000000-0000-4000-8000-0000000004a0', '00000000-0000-4000-8000-0000000004a3', 'manager', 'Omar');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000004b1","role":"authenticated"}', true);
insert into public.businesses (id, owner_id, legal_name, trn, address, phone)
values ('b0000000-0000-4000-8000-0000000004b0', '00000000-0000-4000-8000-0000000004b1', 'Margin Shop B LLC', '100000000000003', 'Deira, Dubai', '+971500000402');
reset role;

insert into public.devices (id, business_id, name) values
  ('d0000000-0000-4000-8000-0000000004a0', 'b0000000-0000-4000-8000-0000000004a0', 'Till 1'),
  ('d0000000-0000-4000-8000-0000000004b0', 'b0000000-0000-4000-8000-0000000004b0', 'Till 1');

-- 1. Categories (Task 1).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000004b1","role":"authenticated"}', true);
select public.apply_category_sync('0c000000-0000-4000-8000-0000000004b1', 'b0000000-0000-4000-8000-0000000004b0', 'ca000000-0000-4000-8000-0000000004b1',
  '{"category":{"id":"ca000000-0000-4000-8000-0000000004b1","name":"B stuff","sortOrder":0,"archived":false},"deviceId":"d0000000-0000-4000-8000-0000000004b0"}');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000004a1","role":"authenticated"}', true);
select public.apply_category_sync('0c000000-0000-4000-8000-0000000004a1', 'b0000000-0000-4000-8000-0000000004a0', 'ca000000-0000-4000-8000-0000000004a1',
  '{"category":{"id":"ca000000-0000-4000-8000-0000000004a1","name":" Drinks ","sortOrder":1,"archived":false},"deviceId":"d0000000-0000-4000-8000-0000000004a0"}');
-- Same operation again: no second row, no error.
select public.apply_category_sync('0c000000-0000-4000-8000-0000000004a1', 'b0000000-0000-4000-8000-0000000004a0', 'ca000000-0000-4000-8000-0000000004a1',
  '{"category":{"id":"ca000000-0000-4000-8000-0000000004a1","name":" Drinks ","sortOrder":1,"archived":false},"deviceId":"d0000000-0000-4000-8000-0000000004a0"}');

do $$ begin
  assert (select name from public.product_categories where id = 'ca000000-0000-4000-8000-0000000004a1') = 'Drinks', '1a name trimmed';
  assert (select count(*) from public.product_categories where business_id = 'b0000000-0000-4000-8000-0000000004a0') = 1, '1b retry makes no second row';
  begin
    perform public.apply_category_sync('0c000000-0000-4000-8000-0000000004a2', 'b0000000-0000-4000-8000-0000000004a0', 'ca000000-0000-4000-8000-0000000004a2',
      '{"category":{"id":"ca000000-0000-4000-8000-0000000004a2","name":"drinks","sortOrder":2,"archived":false},"deviceId":"d0000000-0000-4000-8000-0000000004a0"}');
    assert false, '1c duplicate live name refused';
  exception when raise_exception then
    assert sqlerrm = 'category_name_taken', '1c code: ' || sqlerrm;
  end;
  begin
    perform public.apply_category_sync('0c000000-0000-4000-8000-0000000004a3', 'b0000000-0000-4000-8000-0000000004a0', 'ca000000-0000-4000-8000-0000000004a3',
      '{"category":{"id":"ca000000-0000-4000-8000-0000000004a3","name":"  ","sortOrder":2,"archived":false},"deviceId":"d0000000-0000-4000-8000-0000000004a0"}');
    assert false, '1d blank name refused';
  exception when raise_exception then
    assert sqlerrm = 'invalid_category', '1d code: ' || sqlerrm;
  end;
  begin
    perform public.apply_category_sync('0c000000-0000-4000-8000-0000000004a4', 'b0000000-0000-4000-8000-0000000004a0', 'ca000000-0000-4000-8000-0000000004a4',
      jsonb_build_object('category', jsonb_build_object('id', 'ca000000-0000-4000-8000-0000000004a4', 'name', repeat('x', 41), 'sortOrder', 2, 'archived', false), 'deviceId', 'd0000000-0000-4000-8000-0000000004a0'));
    assert false, '1e 41 characters refused';
  exception when raise_exception then
    assert sqlerrm = 'invalid_category', '1e code: ' || sqlerrm;
  end;
  begin
    perform public.apply_category_sync('0c000000-0000-4000-8000-0000000004a5', 'b0000000-0000-4000-8000-0000000004a0', 'ca000000-0000-4000-8000-0000000004b1',
      '{"category":{"id":"ca000000-0000-4000-8000-0000000004b1","name":"Stolen","sortOrder":2,"archived":false},"deviceId":"d0000000-0000-4000-8000-0000000004a0"}');
    assert false, '1f another shop''s category refused';
  exception when raise_exception then
    assert sqlerrm = 'category_not_found', '1f code: ' || sqlerrm;
  end;
end $$;

-- Archive Drinks, then a new live "drinks" is allowed; restore Drinks would clash, so archive the new one again.
select public.apply_category_sync('0c000000-0000-4000-8000-0000000004a6', 'b0000000-0000-4000-8000-0000000004a0', 'ca000000-0000-4000-8000-0000000004a1',
  '{"category":{"id":"ca000000-0000-4000-8000-0000000004a1","name":"Drinks","sortOrder":1,"archived":true},"deviceId":"d0000000-0000-4000-8000-0000000004a0"}');
select public.apply_category_sync('0c000000-0000-4000-8000-0000000004a7', 'b0000000-0000-4000-8000-0000000004a0', 'ca000000-0000-4000-8000-0000000004a7',
  '{"category":{"id":"ca000000-0000-4000-8000-0000000004a7","name":"drinks","sortOrder":2,"archived":false},"deviceId":"d0000000-0000-4000-8000-0000000004a0"}');
select public.apply_category_sync('0c000000-0000-4000-8000-0000000004a8', 'b0000000-0000-4000-8000-0000000004a0', 'ca000000-0000-4000-8000-0000000004a7',
  '{"category":{"id":"ca000000-0000-4000-8000-0000000004a7","name":"drinks","sortOrder":2,"archived":true},"deviceId":"d0000000-0000-4000-8000-0000000004a0"}');
select public.apply_category_sync('0c000000-0000-4000-8000-0000000004a9', 'b0000000-0000-4000-8000-0000000004a0', 'ca000000-0000-4000-8000-0000000004a1',
  '{"category":{"id":"ca000000-0000-4000-8000-0000000004a1","name":"Drinks","sortOrder":1,"archived":false},"deviceId":"d0000000-0000-4000-8000-0000000004a0"}');

do $$ begin
  assert (select archived_at is null from public.product_categories where id = 'ca000000-0000-4000-8000-0000000004a1'), '1g restored';
  assert (select archived_at is not null from public.product_categories where id = 'ca000000-0000-4000-8000-0000000004a7'), '1h second drinks archived';
  begin
    insert into public.product_categories (id, business_id, name) values (gen_random_uuid(), 'b0000000-0000-4000-8000-0000000004a0', 'Direct');
    assert false, '1i no direct writes';
  exception when insufficient_privilege then null; end;
end $$;

-- Products with a category.
select public.apply_product_sync('0d000000-0000-4000-8000-0000000004a1', 'b0000000-0000-4000-8000-0000000004a0', 'f0000000-0000-4000-8000-0000000004a1',
  '{"product":{"id":"f0000000-0000-4000-8000-0000000004a1","name":"Cola","sku":"COLA","priceFils":2100,"lowStockThreshold":0,"active":true,"taxCategory":"standard","categoryId":"ca000000-0000-4000-8000-0000000004a1"},"deviceId":"d0000000-0000-4000-8000-0000000004a0"}');
select public.apply_product_sync('0d000000-0000-4000-8000-0000000004a2', 'b0000000-0000-4000-8000-0000000004a0', 'f0000000-0000-4000-8000-0000000004a2',
  '{"product":{"id":"f0000000-0000-4000-8000-0000000004a2","name":"Soap","sku":"SOAP","priceFils":1050,"lowStockThreshold":0,"active":true,"taxCategory":"standard"},"deviceId":"d0000000-0000-4000-8000-0000000004a0"}');

do $$ begin
  assert (select category_id from public.products where id = 'f0000000-0000-4000-8000-0000000004a1') = 'ca000000-0000-4000-8000-0000000004a1', '1j product category set';
  assert (select category_id is null from public.products where id = 'f0000000-0000-4000-8000-0000000004a2'), '1k no category';
  begin
    perform public.apply_product_sync('0d000000-0000-4000-8000-0000000004a3', 'b0000000-0000-4000-8000-0000000004a0', 'f0000000-0000-4000-8000-0000000004a2',
      '{"product":{"id":"f0000000-0000-4000-8000-0000000004a2","name":"Soap","sku":"SOAP","priceFils":1050,"lowStockThreshold":0,"active":true,"taxCategory":"standard","categoryId":"ca000000-0000-4000-8000-0000000004b1"},"deviceId":"d0000000-0000-4000-8000-0000000004a0"}');
    assert false, '1l another shop''s category refused on a product';
  exception when raise_exception then
    assert sqlerrm = 'category_not_found', '1l code: ' || sqlerrm;
  end;
end $$;

-- Key absent keeps the category; null clears it.
select public.apply_product_sync('0d000000-0000-4000-8000-0000000004a4', 'b0000000-0000-4000-8000-0000000004a0', 'f0000000-0000-4000-8000-0000000004a1',
  '{"product":{"id":"f0000000-0000-4000-8000-0000000004a1","name":"Cola Can","sku":"COLA","priceFils":2100,"lowStockThreshold":0,"active":true,"taxCategory":"standard"},"deviceId":"d0000000-0000-4000-8000-0000000004a0"}');
do $$ begin
  assert (select category_id from public.products where id = 'f0000000-0000-4000-8000-0000000004a1') = 'ca000000-0000-4000-8000-0000000004a1', '1m absent key keeps category';
end $$;
select public.apply_product_sync('0d000000-0000-4000-8000-0000000004a5', 'b0000000-0000-4000-8000-0000000004a0', 'f0000000-0000-4000-8000-0000000004a2',
  '{"product":{"id":"f0000000-0000-4000-8000-0000000004a2","name":"Soap","sku":"SOAP","priceFils":1050,"lowStockThreshold":0,"active":true,"taxCategory":"standard","categoryId":"ca000000-0000-4000-8000-0000000004a1"},"deviceId":"d0000000-0000-4000-8000-0000000004a0"}');
select public.apply_product_sync('0d000000-0000-4000-8000-0000000004a6', 'b0000000-0000-4000-8000-0000000004a0', 'f0000000-0000-4000-8000-0000000004a2',
  '{"product":{"id":"f0000000-0000-4000-8000-0000000004a2","name":"Soap","sku":"SOAP","priceFils":1050,"lowStockThreshold":0,"active":true,"taxCategory":"standard","categoryId":null},"deviceId":"d0000000-0000-4000-8000-0000000004a0"}');
do $$ begin
  assert (select category_id is null from public.products where id = 'f0000000-0000-4000-8000-0000000004a2'), '1n null clears category';
end $$;

-- Cashier: reads the shop's categories, cannot write them; owner B sees none of A's.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000004a2","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.product_categories where business_id = 'b0000000-0000-4000-8000-0000000004a0') = 2, '1o cashier reads categories';
  begin
    perform public.apply_category_sync('0c000000-0000-4000-8000-0000000004aa', 'b0000000-0000-4000-8000-0000000004a0', 'ca000000-0000-4000-8000-0000000004aa',
      '{"category":{"id":"ca000000-0000-4000-8000-0000000004aa","name":"Mine","sortOrder":3,"archived":false},"deviceId":"d0000000-0000-4000-8000-0000000004a0"}');
    assert false, '1p cashier cannot sync categories';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000004b1","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.product_categories where business_id = 'b0000000-0000-4000-8000-0000000004a0') = 0, '1q other shop sees none';
end $$;
reset role;

-- 2. Cost hidden from cashiers (Task 2). Shop A is on its Pro trial; shop B is moved to Starter.
update public.subscriptions set status = 'active', plan_id = 'starter', trial_ends_at = now() - interval '1 day'
where business_id = 'b0000000-0000-4000-8000-0000000004b0';
do $$ begin
  assert coalesce(public.entitlements_internal('b0000000-0000-4000-8000-0000000004a0') -> 'features' ? 'categories_margin', false), '2-pre A has categories_margin';
  assert not coalesce(public.entitlements_internal('b0000000-0000-4000-8000-0000000004b0') -> 'features' ? 'categories_margin', false), '2-pre B lacks it';
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000004a2","role":"authenticated"}', true);
do $$ begin
  begin
    perform cost_fils from public.products limit 1;
    assert false, '2a cashier cannot read products.cost_fils';
  exception when insufficient_privilege then null; end;
  begin
    perform unit_cost_fils from public.sale_items limit 1;
    assert false, '2b cashier cannot read sale_items.unit_cost_fils';
  exception when insufficient_privilege then null; end;
  begin
    perform unit_cost_fils from public.credit_note_items limit 1;
    assert false, '2c cashier cannot read credit_note_items.unit_cost_fils';
  exception when insufficient_privilege then null; end;
  -- The snapshot's own column lists still work.
  perform id, name, sku, barcode, price_fils, stock_quantity, low_stock_threshold, status, tax_category, category_id from public.products;
  perform s.id, i.id, i.product_id, i.description, i.sku, i.quantity, i.unit_gross_fils, i.list_unit_gross_fils, i.net_fils, i.vat_fils, i.gross_fils
  from public.sales s join public.sale_items i on i.sale_id = s.id;
  perform c.id, i.id, i.sale_item_id, i.product_id, i.description, i.sku, i.quantity, i.unit_gross_fils, i.net_fils, i.vat_fils, i.gross_fils
  from public.credit_notes c join public.credit_note_items i on i.credit_note_id = c.id;
  begin
    perform public.product_costs('b0000000-0000-4000-8000-0000000004a0');
    assert false, '2d cashier cannot list costs';
  exception when insufficient_privilege then null; end;
  begin
    perform public.set_product_cost('b0000000-0000-4000-8000-0000000004a0', 'f0000000-0000-4000-8000-0000000004a1', 100);
    assert false, '2e cashier cannot set costs';
  exception when insufficient_privilege then null; end;
end $$;

-- The owner cannot write a cost straight into the table either; only set_product_cost does.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000004a1","role":"authenticated"}', true);
do $$ begin
  begin
    update public.products set cost_fils = 1 where id = 'f0000000-0000-4000-8000-0000000004a1';
    assert false, '2f no direct cost write';
  exception when insufficient_privilege then null; end;
end $$;

select public.set_product_cost('b0000000-0000-4000-8000-0000000004a0', 'f0000000-0000-4000-8000-0000000004a1', 1250);
do $$ begin
  assert (select cost_fils from public.product_costs('b0000000-0000-4000-8000-0000000004a0') where product_id = 'f0000000-0000-4000-8000-0000000004a1') = 1250, '2g owner sets and reads cost';
  assert (select count(*) from public.product_costs('b0000000-0000-4000-8000-0000000004a0')) = 1, '2h only costed products listed';
  begin
    perform public.set_product_cost('b0000000-0000-4000-8000-0000000004a0', 'f0000000-0000-4000-8000-0000000004a1', -1);
    assert false, '2i negative cost refused';
  exception when raise_exception then assert sqlerrm = 'invalid_cost', '2i code: ' || sqlerrm; end;
  begin
    perform public.set_product_cost('b0000000-0000-4000-8000-0000000004a0', 'f0000000-0000-4000-8000-0000000004a1', 100000001);
    assert false, '2j cost over AED 1,000,000 refused';
  exception when raise_exception then assert sqlerrm = 'invalid_cost', '2j code: ' || sqlerrm; end;
  begin
    perform public.set_product_cost('b0000000-0000-4000-8000-0000000004a0', gen_random_uuid(), 100);
    assert false, '2k unknown product refused';
  exception when raise_exception then assert sqlerrm = 'product_not_found', '2k code: ' || sqlerrm; end;
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.audit_events where action = 'product.cost' and entity_id = 'f0000000-0000-4000-8000-0000000004a1'
    and summary = '{"before":null,"after":1250}'::jsonb), '2l audit event with before and after';
end $$;

-- Null clears; set it back for later tests.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000004a1","role":"authenticated"}', true);
select public.set_product_cost('b0000000-0000-4000-8000-0000000004a0', 'f0000000-0000-4000-8000-0000000004a1', null);
do $$ begin
  assert (select count(*) from public.product_costs('b0000000-0000-4000-8000-0000000004a0')) = 0, '2m null clears cost';
end $$;
select public.set_product_cost('b0000000-0000-4000-8000-0000000004a0', 'f0000000-0000-4000-8000-0000000004a1', 1000);

-- Manager reads, cannot set.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000004a3","role":"authenticated"}', true);
do $$ begin
  assert (select cost_fils from public.product_costs('b0000000-0000-4000-8000-0000000004a0') where product_id = 'f0000000-0000-4000-8000-0000000004a1') = 1000, '2n manager reads costs';
  begin
    perform public.set_product_cost('b0000000-0000-4000-8000-0000000004a0', 'f0000000-0000-4000-8000-0000000004a1', 100);
    assert false, '2o manager cannot set';
  exception when insufficient_privilege then null; end;
end $$;

-- Owner B: another shop's product, and Starter.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000004b1","role":"authenticated"}', true);
do $$ begin
  begin
    perform public.product_costs('b0000000-0000-4000-8000-0000000004b0');
    assert false, '2p starter cannot list costs';
  exception when raise_exception then assert sqlerrm = 'feature_not_in_plan', '2p code: ' || sqlerrm; end;
  begin
    perform public.set_product_cost('b0000000-0000-4000-8000-0000000004b0', 'f0000000-0000-4000-8000-0000000004a1', 100);
    assert false, '2q starter cannot set';
  exception when raise_exception then assert sqlerrm = 'feature_not_in_plan', '2q code: ' || sqlerrm; end;
  begin
    perform public.product_costs('b0000000-0000-4000-8000-0000000004a0');
    assert false, '2r owner of another shop refused';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 3. Cost stamped on sync, and the profit report (Task 3).
-- Cola (Drinks, cost 1000, AED 21.00 incl. VAT), Soap (no category, no cost, AED 10.50), Gum (no category, no cost).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000004a1","role":"authenticated"}', true);
select public.apply_product_sync('0d000000-0000-4000-8000-0000000004a7', 'b0000000-0000-4000-8000-0000000004a0', 'f0000000-0000-4000-8000-0000000004a5',
  '{"product":{"id":"f0000000-0000-4000-8000-0000000004a5","name":"Gum","sku":"GUM","priceFils":1050,"lowStockThreshold":0,"active":true,"taxCategory":"standard"},"deviceId":"d0000000-0000-4000-8000-0000000004a0"}');
reset role;
update public.products set stock_quantity = 100 where business_id = 'b0000000-0000-4000-8000-0000000004a0';
insert into public.register_sessions (id, business_id, device_id, business_date, opening_cash_fils, opened_by)
values ('e0000000-0000-4000-8000-0000000004a0', 'b0000000-0000-4000-8000-0000000004a0', 'd0000000-0000-4000-8000-0000000004a0',
        (now() at time zone 'Asia/Dubai')::date, 0, '00000000-0000-4000-8000-0000000004a1');

create temp table margin_fixture (name text primary key, body jsonb) on commit drop;
insert into margin_fixture values ('day', to_jsonb((now() at time zone 'Asia/Dubai')::date::text));
grant all on margin_fixture to authenticated;

-- sale(id, invoice, lines) where lines = [[productId, qty, unitGross, net, vat, lineId]].
create function pg_temp.sale_payload(p_id uuid, p_invoice text, p_lines jsonb) returns jsonb language sql as $$
  select jsonb_build_object('deviceId', 'd0000000-0000-4000-8000-0000000004a0', 'sale', jsonb_build_object(
    'id', p_id, 'invoiceNumber', p_invoice, 'createdAt', now()::text, 'supplyDate', (now() at time zone 'Asia/Dubai')::date::text,
    'status', 'completed', 'paymentMethod', 'cash',
    'netFils', (select sum((l->>3)::bigint) from jsonb_array_elements(p_lines) l),
    'vatFils', (select sum((l->>4)::bigint) from jsonb_array_elements(p_lines) l),
    'grossFils', (select sum((l->>3)::bigint + (l->>4)::bigint) from jsonb_array_elements(p_lines) l),
    'lines', (select jsonb_agg(jsonb_build_object('id', l->>5, 'productId', l->>0, 'name', 'Line', 'quantity', (l->>1)::int,
      'unitGrossFils', (l->>2)::bigint, 'netFils', (l->>3)::bigint, 'vatFils', (l->>4)::bigint, 'grossFils', (l->>3)::bigint + (l->>4)::bigint))
      from jsonb_array_elements(p_lines) l)))
$$;
create function pg_temp.note_payload(p_id uuid, p_number text, p_sale uuid, p_line uuid, p_original uuid, p_net bigint, p_vat bigint) returns jsonb language sql as $$
  select jsonb_build_object('deviceId', 'd0000000-0000-4000-8000-0000000004a0', 'creditNote', jsonb_build_object(
    'id', p_id, 'creditNoteNumber', p_number, 'saleId', p_sale, 'createdAt', now()::text, 'paymentMethod', 'cash',
    'netFils', p_net, 'vatFils', p_vat, 'grossFils', p_net + p_vat,
    'lines', jsonb_build_array(jsonb_build_object('id', p_line, 'originalLineId', p_original, 'name', 'Line', 'quantity', 1,
      'unitGrossFils', p_net + p_vat, 'netFils', p_net, 'vatFils', p_vat, 'grossFils', p_net + p_vat))))
$$;
grant execute on function pg_temp.sale_payload(uuid, text, jsonb) to authenticated;
grant execute on function pg_temp.note_payload(uuid, text, uuid, uuid, uuid, bigint, bigint) to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000004a1","role":"authenticated"}', true);
-- S1: 2 × Cola + 1 × Soap. S3: 1 × Gum (sold while it has no cost).
select public.apply_sale_sync_with_payments('05000000-0000-4000-8000-0000000004a1', 'b0000000-0000-4000-8000-0000000004a0', '5a000000-0000-4000-8000-0000000004a1',
  pg_temp.sale_payload('5a000000-0000-4000-8000-0000000004a1', 'M-0001', '[["f0000000-0000-4000-8000-0000000004a1",2,2100,4000,200,"11000000-0000-4000-8000-0000000004a1"],["f0000000-0000-4000-8000-0000000004a2",1,1050,1000,50,"11000000-0000-4000-8000-0000000004a2"]]'));
select public.apply_sale_sync_with_payments('05000000-0000-4000-8000-0000000004a3', 'b0000000-0000-4000-8000-0000000004a0', '5a000000-0000-4000-8000-0000000004a3',
  pg_temp.sale_payload('5a000000-0000-4000-8000-0000000004a3', 'M-0003', '[["f0000000-0000-4000-8000-0000000004a5",1,1050,1000,50,"11000000-0000-4000-8000-0000000004a5"]]'));
-- Cola's cost goes up; S2 sells one more; S1 is synced again (a retry).
select public.set_product_cost('b0000000-0000-4000-8000-0000000004a0', 'f0000000-0000-4000-8000-0000000004a1', 1500);
select public.set_product_cost('b0000000-0000-4000-8000-0000000004a0', 'f0000000-0000-4000-8000-0000000004a5', 700);
select public.apply_sale_sync_with_payments('05000000-0000-4000-8000-0000000004a2', 'b0000000-0000-4000-8000-0000000004a0', '5a000000-0000-4000-8000-0000000004a2',
  pg_temp.sale_payload('5a000000-0000-4000-8000-0000000004a2', 'M-0002', '[["f0000000-0000-4000-8000-0000000004a1",1,2100,2000,100,"11000000-0000-4000-8000-0000000004a3"]]'));
select public.apply_sale_sync_with_payments('05000000-0000-4000-8000-0000000004a1', 'b0000000-0000-4000-8000-0000000004a0', '5a000000-0000-4000-8000-0000000004a1',
  pg_temp.sale_payload('5a000000-0000-4000-8000-0000000004a1', 'M-0001', '[["f0000000-0000-4000-8000-0000000004a1",2,2100,4000,200,"11000000-0000-4000-8000-0000000004a1"],["f0000000-0000-4000-8000-0000000004a2",1,1050,1000,50,"11000000-0000-4000-8000-0000000004a2"]]'));
-- R1 returns one Cola from S1; R3 returns the Gum sold before it had a cost.
select public.apply_credit_note_sync_with_payments('0e000000-0000-4000-8000-0000000004a1', 'b0000000-0000-4000-8000-0000000004a0', 'c0000000-0000-4000-8000-0000000004a1',
  pg_temp.note_payload('c0000000-0000-4000-8000-0000000004a1', 'MCN-0001', '5a000000-0000-4000-8000-0000000004a1', '12000000-0000-4000-8000-0000000004a1', '11000000-0000-4000-8000-0000000004a1', 2000, 100));
select public.apply_credit_note_sync_with_payments('0e000000-0000-4000-8000-0000000004a3', 'b0000000-0000-4000-8000-0000000004a0', 'c0000000-0000-4000-8000-0000000004a3',
  pg_temp.note_payload('c0000000-0000-4000-8000-0000000004a3', 'MCN-0002', '5a000000-0000-4000-8000-0000000004a3', '12000000-0000-4000-8000-0000000004a3', '11000000-0000-4000-8000-0000000004a5', 1000, 50));
reset role;

do $$ begin
  assert (select unit_cost_fils from public.sale_items where id = '11000000-0000-4000-8000-0000000004a1') = 1000, '3a S1 Cola stamped 1000 and kept after the cost change and the retry';
  assert (select unit_cost_fils is null from public.sale_items where id = '11000000-0000-4000-8000-0000000004a2'), '3b S1 Soap has no cost';
  assert (select unit_cost_fils from public.sale_items where id = '11000000-0000-4000-8000-0000000004a3') = 1500, '3c S2 Cola stamped 1500';
  assert (select unit_cost_fils is null from public.sale_items where id = '11000000-0000-4000-8000-0000000004a5'), '3d Gum sold before its cost stays uncosted';
  assert (select unit_cost_fils from public.credit_note_items where id = '12000000-0000-4000-8000-0000000004a1') = 1000, '3e refund copies the sale line''s cost';
  assert (select unit_cost_fils is null from public.credit_note_items where id = '12000000-0000-4000-8000-0000000004a3'), '3f refund of uncosted sale stays uncosted';
end $$;

-- Report for today. Costed: S1 Cola 4000/2000, S2 Cola 2000/1500, R1 Cola −2000/−1000 → net 4000, cost 2500, profit 1500.
-- Uncosted: Soap 1000, Gum 1000, Gum refund −1000 → 1000 net, 2 sold lines.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000004a3","role":"authenticated"}', true);
do $$
declare
  d date := (select (body #>> '{}')::date from margin_fixture where name = 'day');
  r jsonb := public.profit_report('b0000000-0000-4000-8000-0000000004a0', d, d);
  t jsonb := r -> 'totals';
begin
  assert (t->>'netFils')::bigint = 5000, '3g net ' || t;
  assert (t->>'costedNetFils')::bigint = 4000, '3h costed net ' || t;
  assert (t->>'costFils')::bigint = 2500, '3i cost ' || t;
  assert (t->>'profitFils')::bigint = 1500, '3j profit ' || t;
  assert (t->>'marginPct')::numeric = 37.5, '3k margin ' || t;
  assert (t->>'uncostedNetFils')::bigint = 1000, '3l uncosted net ' || t;
  assert (t->>'uncostedLines')::int = 2, '3m uncosted sold lines ' || t;
  assert jsonb_array_length(r -> 'byDay') = 1 and (r #>> '{byDay,0,date}') = d::text and (r #>> '{byDay,0,profitFils}')::bigint = 1500, '3n by day ' || (r -> 'byDay');
  assert (select (c->>'profitFils')::bigint = 1500 and (c->>'marginPct')::numeric = 37.5 and c->>'name' = 'Drinks'
          from jsonb_array_elements(r -> 'byCategory') c where c->>'categoryId' = 'ca000000-0000-4000-8000-0000000004a1'), '3o Drinks row ' || (r -> 'byCategory');
  assert (select (c->>'netFils')::bigint = 1000 and (c->>'profitFils')::bigint = 0 and c->'marginPct' = 'null'::jsonb
          from jsonb_array_elements(r -> 'byCategory') c where c->>'name' = 'Uncategorised' and c->'categoryId' = 'null'::jsonb), '3p Uncategorised row ' || (r -> 'byCategory');
  assert (select (p->>'quantity')::int = 2 and (p->>'profitFils')::bigint = 1500
          from jsonb_array_elements(r -> 'byProduct') p where p->>'productId' = 'f0000000-0000-4000-8000-0000000004a1'), '3q Cola product row (3 sold, 1 returned) ' || (r -> 'byProduct');
  begin
    perform public.profit_report('b0000000-0000-4000-8000-0000000004a0', d - 92, d);
    assert false, '3r 93 days refused';
  exception when raise_exception then assert sqlerrm = 'invalid_range', '3r code: ' || sqlerrm; end;
  perform public.profit_report('b0000000-0000-4000-8000-0000000004a0', d - 91, d);
  begin
    perform public.profit_report('b0000000-0000-4000-8000-0000000004a0', d, d - 1);
    assert false, '3s reversed range refused';
  exception when raise_exception then assert sqlerrm = 'invalid_range', '3s code: ' || sqlerrm; end;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000004a2","role":"authenticated"}', true);
do $$ begin
  begin
    perform public.profit_report('b0000000-0000-4000-8000-0000000004a0', current_date, current_date);
    assert false, '3t cashier refused';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000004b1","role":"authenticated"}', true);
do $$ begin
  begin
    perform public.profit_report('b0000000-0000-4000-8000-0000000004b0', current_date, current_date);
    assert false, '3u starter refused';
  exception when raise_exception then assert sqlerrm = 'feature_not_in_plan', '3u code: ' || sqlerrm; end;
end $$;

-- Archiving Drinks moves its history to Uncategorised (the cost stays frozen).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000004a1","role":"authenticated"}', true);
select public.apply_category_sync('0c000000-0000-4000-8000-0000000004ab', 'b0000000-0000-4000-8000-0000000004a0', 'ca000000-0000-4000-8000-0000000004a1',
  '{"category":{"id":"ca000000-0000-4000-8000-0000000004a1","name":"Drinks","sortOrder":1,"archived":true},"deviceId":"d0000000-0000-4000-8000-0000000004a0"}');
do $$
declare
  d date := (select (body #>> '{}')::date from margin_fixture where name = 'day');
  r jsonb := public.profit_report('b0000000-0000-4000-8000-0000000004a0', d, d);
begin
  assert jsonb_array_length(r -> 'byCategory') = 1 and (r #>> '{byCategory,0,name}') = 'Uncategorised'
         and (r #>> '{byCategory,0,profitFils}')::bigint = 1500, '3v archived category reports as Uncategorised ' || (r -> 'byCategory');
end $$;
reset role;

-- Top 50 products plus "Rest": 51 costed products sold yesterday (inserted directly).
insert into public.products (id, business_id, name, sku, price_fils, stock_quantity, low_stock_threshold, status, cost_fils)
select ('f1000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'b0000000-0000-4000-8000-0000000004a0', 'Item ' || n, 'ITEM-' || n, 2100, 0, 0, 'active', 1000
from generate_series(1, 51) n;
insert into public.sales (id, business_id, device_id, register_session_id, invoice_number, operation_id, payment_method, supply_date, supplier_snapshot, net_fils, vat_fils, gross_fils, created_by, created_at)
values ('5a100000-0000-4000-8000-0000000004a1', 'b0000000-0000-4000-8000-0000000004a0', 'd0000000-0000-4000-8000-0000000004a0', 'e0000000-0000-4000-8000-0000000004a0',
        'M-0100', gen_random_uuid(), 'cash', (now() at time zone 'Asia/Dubai')::date - 1, '{}'::jsonb, 102000, 5100, 107100, '00000000-0000-4000-8000-0000000004a1', now() - interval '1 day');
insert into public.sale_items (id, business_id, sale_id, product_id, description, quantity, unit_gross_fils, net_fils, vat_fils, gross_fils, unit_cost_fils)
select gen_random_uuid(), 'b0000000-0000-4000-8000-0000000004a0', '5a100000-0000-4000-8000-0000000004a1', ('f1000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       'Item ' || n, 1, 2100, 2000, 100, 2100, 1000 - n
from generate_series(1, 51) n;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000004a1","role":"authenticated"}', true);
do $$
declare
  d date := (select (body #>> '{}')::date from margin_fixture where name = 'day') - 1;
  r jsonb := public.profit_report('b0000000-0000-4000-8000-0000000004a0', d, d);
begin
  assert jsonb_array_length(r -> 'byProduct') = 51, '3w 50 rows plus Rest: ' || jsonb_array_length(r -> 'byProduct');
  assert (r #>> '{byProduct,0,name}') = 'Item 51', '3x highest profit first';
  assert (r #>> '{byProduct,50,name}') = 'Rest' and (r #> '{byProduct,50,productId}') = 'null'::jsonb
         and (r #>> '{byProduct,50,profitFils}')::bigint = 1001, '3y Rest row holds the 51st ' || (r #> '{byProduct,50}');
end $$;
reset role;

rollback;
