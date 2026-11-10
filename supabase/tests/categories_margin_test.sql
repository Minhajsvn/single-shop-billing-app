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

-- @@COST@@

rollback;
