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

-- @@STAMP@@

rollback;
