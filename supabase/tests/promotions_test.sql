-- Stage 2E tests: promotions. One transaction, rolled back.
begin;

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000007a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@promo.test'),
  ('00000000-0000-4000-8000-0000000007b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@promo.test'),
  ('00000000-0000-4000-8000-0000000007a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cashier-a@promo.test'),
  ('00000000-0000-4000-8000-0000000007a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'manager-a@promo.test');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000007a1","role":"authenticated"}', true);
insert into public.businesses (id, owner_id, legal_name, trn, address, phone)
values ('b0000000-0000-4000-8000-0000000007a0', '00000000-0000-4000-8000-0000000007a1', 'Promo Shop A LLC', '100000000000003', 'Dubai', '+971500000701');
select public.staff_add_member('b0000000-0000-4000-8000-0000000007a0', '00000000-0000-4000-8000-0000000007a2', 'cashier', 'Aisha');
select public.staff_add_member('b0000000-0000-4000-8000-0000000007a0', '00000000-0000-4000-8000-0000000007a3', 'manager', 'Omar');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000007b1","role":"authenticated"}', true);
insert into public.businesses (id, owner_id, legal_name, trn, address, phone)
values ('b0000000-0000-4000-8000-0000000007b0', '00000000-0000-4000-8000-0000000007b1', 'Promo Shop B LLC', '100000000000003', 'Deira', '+971500000702');
reset role;
update public.subscriptions set status = 'active', plan_id = 'starter', trial_ends_at = now() - interval '1 day'
where business_id = 'b0000000-0000-4000-8000-0000000007b0';

insert into public.devices (id, business_id, name) values ('d0000000-0000-4000-8000-0000000007a0', 'b0000000-0000-4000-8000-0000000007a0', 'Till 1');
insert into public.register_sessions (id, business_id, device_id, business_date, opening_cash_fils, opened_by)
values ('e0000000-0000-4000-8000-0000000007a0', 'b0000000-0000-4000-8000-0000000007a0', 'd0000000-0000-4000-8000-0000000007a0',
        (now() at time zone 'Asia/Dubai')::date, 0, '00000000-0000-4000-8000-0000000007a1');
insert into public.product_categories (id, business_id, name) values
  ('ca000000-0000-4000-8000-0000000007a1', 'b0000000-0000-4000-8000-0000000007a0', 'Drinks'),
  ('ca000000-0000-4000-8000-0000000007b1', 'b0000000-0000-4000-8000-0000000007b0', 'B drinks');
insert into public.products (id, business_id, name, sku, price_fils, stock_quantity, low_stock_threshold, status, category_id, cost_fils) values
  ('f3000000-0000-4000-8000-0000000007a1', 'b0000000-0000-4000-8000-0000000007a0', 'Cola', 'COLA', 600, 50, 0, 'active', 'ca000000-0000-4000-8000-0000000007a1', 300),
  ('f3000000-0000-4000-8000-0000000007b1', 'b0000000-0000-4000-8000-0000000007b0', 'B item', 'BI', 600, 5, 0, 'active', null, null);

create temp table promo_fixture (name text primary key, body jsonb) on commit drop;
insert into promo_fixture values ('today', to_jsonb((now() at time zone 'Asia/Dubai')::date::text));
grant all on promo_fixture to authenticated;

create function pg_temp.promo(p_id text, p_extra jsonb) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'name', 'Promo', 'targetType', 'all', 'startsOn', (now() at time zone 'Asia/Dubai')::date::text, 'active', true) || p_extra
$$;
grant execute on function pg_temp.promo(text, jsonb) to authenticated;

-- 1. Saving (Task 1).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000007a1","role":"authenticated"}', true);
select public.promotion_save('b0000000-0000-4000-8000-0000000007a0', pg_temp.promo('9e000000-0000-4000-8000-0000000007a1', '{"name":"Drinks 10%","kind":"percent_off","targetType":"category","targetId":"ca000000-0000-4000-8000-0000000007a1","percent":10}'));
select public.promotion_save('b0000000-0000-4000-8000-0000000007a0', pg_temp.promo('9e000000-0000-4000-8000-0000000007a2', '{"kind":"amount_off","targetType":"product","targetId":"f3000000-0000-4000-8000-0000000007a1","amountFils":100}'));
select public.promotion_save('b0000000-0000-4000-8000-0000000007a0', pg_temp.promo('9e000000-0000-4000-8000-0000000007a3', '{"name":"Buy 2 get 1","kind":"multi_buy_free","targetType":"product","targetId":"f3000000-0000-4000-8000-0000000007a1","buyQty":2,"getQty":1,"days":[5],"fromTime":"22:00","toTime":"02:00"}'));
select public.promotion_save('b0000000-0000-4000-8000-0000000007a0', pg_temp.promo('9e000000-0000-4000-8000-0000000007a4', '{"kind":"multi_buy_price","buyQty":3,"bundlePriceFils":1000}'));
select public.promotion_save('b0000000-0000-4000-8000-0000000007a0', pg_temp.promo('9e000000-0000-4000-8000-0000000007a5', '{"kind":"basket_percent","percent":5,"minBasketFils":20000}'));
do $$
declare
  list jsonb := public.promotion_list('b0000000-0000-4000-8000-0000000007a0');
  bad jsonb;
  bads jsonb[] := array[
    '{"kind":"percent_off","percent":0}', '{"kind":"percent_off","percent":99.5}', '{"kind":"amount_off","amountFils":0}',
    '{"kind":"multi_buy_free","buyQty":0,"getQty":1}', '{"kind":"multi_buy_price","buyQty":1,"bundlePriceFils":100}',
    '{"kind":"basket_percent","percent":5,"minBasketFils":0,"targetType":"product","targetId":"f3000000-0000-4000-8000-0000000007a1"}',
    '{"kind":"percent_off","percent":5,"endsOn":"2000-01-01"}', '{"kind":"percent_off","percent":5,"fromTime":"10:00"}',
    '{"kind":"percent_off","percent":5,"name":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}', '{"kind":"percent_off","percent":5,"days":[8]}'
  ]::jsonb[];
begin
  assert jsonb_array_length(list) = 5, '1a five saved: ' || jsonb_array_length(list);
  assert (select (e->>'percent')::numeric = 10 and e->>'targetType' = 'category' and e ? 'createdAt' from jsonb_array_elements(list) e where e->>'id' = '9e000000-0000-4000-8000-0000000007a1'), '1a camelCase keys';
  assert (select e->'days' = '[5]'::jsonb and e->>'fromTime' = '22:00' from jsonb_array_elements(list) e where e->>'id' = '9e000000-0000-4000-8000-0000000007a3'), '1a days and times';
  foreach bad in array bads loop
    begin
      perform public.promotion_save('b0000000-0000-4000-8000-0000000007a0', pg_temp.promo('9e000000-0000-4000-8000-0000000007a9', bad));
      assert false, '1b refused: ' || bad::text;
    exception when raise_exception then assert sqlerrm = 'invalid_promotion', '1b code ' || sqlerrm || ' for ' || bad::text; end;
  end loop;
  begin
    perform public.promotion_save('b0000000-0000-4000-8000-0000000007a0', pg_temp.promo('9e000000-0000-4000-8000-0000000007a9', '{"kind":"percent_off","percent":5,"targetType":"category","targetId":"ca000000-0000-4000-8000-0000000007b1"}'));
    assert false, '1c another shop''s category';
  exception when raise_exception then assert sqlerrm = 'target_not_found', '1c code ' || sqlerrm; end;
  begin
    perform public.promotion_save('b0000000-0000-4000-8000-0000000007a0', pg_temp.promo('9e000000-0000-4000-8000-0000000007a9', '{"kind":"percent_off","percent":5,"targetType":"product","targetId":"f3000000-0000-4000-8000-0000000007b1"}'));
    assert false, '1c another shop''s product';
  exception when raise_exception then assert sqlerrm = 'target_not_found', '1c code ' || sqlerrm; end;
end $$;

-- Archive one, end one (yesterday − 1 is hidden from members).
select public.promotion_save('b0000000-0000-4000-8000-0000000007a0', pg_temp.promo('9e000000-0000-4000-8000-0000000007a2', '{"kind":"amount_off","targetType":"product","targetId":"f3000000-0000-4000-8000-0000000007a1","amountFils":100,"archived":true}'));
select public.promotion_save('b0000000-0000-4000-8000-0000000007a0',
  pg_temp.promo('9e000000-0000-4000-8000-0000000007a4', jsonb_build_object('kind', 'multi_buy_price', 'buyQty', 3, 'bundlePriceFils', 1000,
    'startsOn', ((now() at time zone 'Asia/Dubai')::date - 10)::text, 'endsOn', ((now() at time zone 'Asia/Dubai')::date - 2)::text)));

-- Manager may; cashier reads live rows only and cannot write; Starter refused.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000007a3","role":"authenticated"}', true);
select public.promotion_save('b0000000-0000-4000-8000-0000000007a0', pg_temp.promo('9e000000-0000-4000-8000-0000000007a6', '{"kind":"percent_off","percent":15}'));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000007a2","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.promotions where business_id = 'b0000000-0000-4000-8000-0000000007a0') = 4, '1e cashier sees live only (5 + 1 − archived − ended)';
  assert not exists (select 1 from public.promotions where id in ('9e000000-0000-4000-8000-0000000007a2', '9e000000-0000-4000-8000-0000000007a4')), '1e archived and ended hidden';
  begin
    perform public.promotion_save('b0000000-0000-4000-8000-0000000007a0', pg_temp.promo('9e000000-0000-4000-8000-0000000007a7', '{"kind":"percent_off","percent":5}'));
    assert false, '1d cashier save';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.promotions (id, business_id, name, kind, target_type, starts_on) values (gen_random_uuid(), 'b0000000-0000-4000-8000-0000000007a0', 'x', 'percent_off', 'all', current_date);
    assert false, '1e cashier insert';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000007b1","role":"authenticated"}', true);
do $$ begin
  begin
    perform public.promotion_save('b0000000-0000-4000-8000-0000000007b0', pg_temp.promo('9e000000-0000-4000-8000-0000000007b2', '{"kind":"percent_off","percent":5}'));
    assert false, '1d starter';
  exception when raise_exception then assert sqlerrm = 'feature_not_in_plan', '1d code ' || sqlerrm; end;
end $$;

-- 1f: a synced sale stores each line's promotion and saving.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000007a1","role":"authenticated"}', true);
select public.apply_sale_sync_with_payments('05000000-0000-4000-8000-0000000007a1', 'b0000000-0000-4000-8000-0000000007a0', '5a000000-0000-4000-8000-0000000007a1',
  jsonb_build_object('deviceId', 'd0000000-0000-4000-8000-0000000007a0', 'sale', jsonb_build_object(
    'id', '5a000000-0000-4000-8000-0000000007a1', 'invoiceNumber', 'PR-1', 'createdAt', now()::text,
    'supplyDate', (now() at time zone 'Asia/Dubai')::date::text, 'status', 'completed', 'paymentMethod', 'cash',
    'netFils', 1715 + 571, 'vatFils', 85 + 29, 'grossFils', 1800 + 600,
    'lines', jsonb_build_array(
      jsonb_build_object('id', '11000000-0000-4000-8000-0000000007a1', 'productId', 'f3000000-0000-4000-8000-0000000007a1', 'name', 'Cola', 'quantity', 3,
        'unitGrossFils', 600, 'listUnitGrossFils', 900, 'netFils', 1715, 'vatFils', 85, 'grossFils', 1800,
        'promotionId', '9e000000-0000-4000-8000-0000000007a3', 'promotionSavingFils', 900),
      jsonb_build_object('id', '11000000-0000-4000-8000-0000000007a2', 'productId', 'f3000000-0000-4000-8000-0000000007a1', 'name', 'Cola', 'quantity', 1,
        'unitGrossFils', 600, 'netFils', 571, 'vatFils', 29, 'grossFils', 600)))));
reset role;
do $$
declare
  d date := (select (body #>> '{}')::date from promo_fixture where name = 'today');
  results jsonb;
begin
  assert (select promotion_id = '9e000000-0000-4000-8000-0000000007a3' and promotion_saving_fils = 900 and unit_cost_fils = 300
          from public.sale_items where id = '11000000-0000-4000-8000-0000000007a1'), '1f promotion stored, cost still stamped';
  assert (select promotion_id is null and promotion_saving_fils is null from public.sale_items where id = '11000000-0000-4000-8000-0000000007a2'), '1f plain line has none';
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000007a3","role":"authenticated"}', true);
  set local role authenticated;
  results := public.promotion_results('b0000000-0000-4000-8000-0000000007a0', d, d);
  assert jsonb_array_length(results) = 1, '1g one promotion used: ' || results::text;
  assert (select (r->>'uses')::int = 1 and (r->>'units')::int = 3 and (r->>'savingFils')::bigint = 900 and (r->>'netFils')::bigint = 1715
          and (r->>'costFils')::bigint = 900 and (r->>'profitFils')::bigint = 815 and r->>'name' = 'Buy 2 get 1'
          from jsonb_array_elements(results) r), '1g totals: ' || results::text;
  begin
    perform public.promotion_results('b0000000-0000-4000-8000-0000000007a0', d - 92, d);
    assert false, '1g range';
  exception when raise_exception then assert sqlerrm = 'invalid_range', '1g code ' || sqlerrm; end;
  reset role;
end $$;

rollback;
