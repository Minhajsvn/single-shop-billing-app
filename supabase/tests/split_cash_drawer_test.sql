-- 2B fix (shipped with 2C, migration 056): the cash part of a split sale or refund counts in the drawer, so the server's
-- expected cash matches the till's and the register can close. One transaction, rolled back.
begin;

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000005a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@splitcash.test');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000005a1","role":"authenticated"}', true);
insert into public.businesses (id, owner_id, legal_name, trn, address, phone)
values ('b0000000-0000-4000-8000-0000000005a0', '00000000-0000-4000-8000-0000000005a1', 'Split Cash LLC', '100000000000003', 'Dubai', '+971500000501');
reset role;
insert into public.devices (id, business_id, name) values ('d0000000-0000-4000-8000-0000000005a0', 'b0000000-0000-4000-8000-0000000005a0', 'Till 1');
insert into public.register_sessions (id, business_id, device_id, business_date, opening_cash_fils, opened_by)
values ('e0000000-0000-4000-8000-0000000005a0', 'b0000000-0000-4000-8000-0000000005a0', 'd0000000-0000-4000-8000-0000000005a0',
        (now() at time zone 'Asia/Dubai')::date, 20000, '00000000-0000-4000-8000-0000000005a1');

create function pg_temp.sale(p_id uuid, p_invoice text, p_line uuid, p_method text, p_payments jsonb) returns jsonb language sql as $$
  select jsonb_build_object('deviceId', 'd0000000-0000-4000-8000-0000000005a0', 'sale', jsonb_build_object(
    'id', p_id, 'invoiceNumber', p_invoice, 'createdAt', now()::text, 'supplyDate', (now() at time zone 'Asia/Dubai')::date::text,
    'status', 'completed', 'paymentMethod', p_method, 'netFils', 2000, 'vatFils', 100, 'grossFils', 2100,
    'lines', jsonb_build_array(jsonb_build_object('id', p_line, 'name', 'Tea', 'quantity', 1, 'unitGrossFils', 2100, 'netFils', 2000, 'vatFils', 100, 'grossFils', 2100)))
    || case when p_payments is null then '{}'::jsonb else jsonb_build_object('payments', p_payments) end)
$$;
grant execute on function pg_temp.sale(uuid, text, uuid, text, jsonb) to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000005a1","role":"authenticated"}', true);
-- A cash sale (21.00), a split sale (cash 10.00 + card 11.00), and the split sale synced again (a retry).
select public.apply_sale_sync_with_payments('05000000-0000-4000-8000-0000000005a1', 'b0000000-0000-4000-8000-0000000005a0', '5a000000-0000-4000-8000-0000000005a1',
  pg_temp.sale('5a000000-0000-4000-8000-0000000005a1', 'SC-1', '11000000-0000-4000-8000-0000000005a1', 'cash', null));
select public.apply_sale_sync_with_payments('05000000-0000-4000-8000-0000000005a2', 'b0000000-0000-4000-8000-0000000005a0', '5a000000-0000-4000-8000-0000000005a2',
  pg_temp.sale('5a000000-0000-4000-8000-0000000005a2', 'SC-2', '11000000-0000-4000-8000-0000000005a2', 'split',
    '[{"id":"9a000000-0000-4000-8000-0000000005a1","method":"cash","amountFils":1000},{"id":"9a000000-0000-4000-8000-0000000005a2","method":"card","amountFils":1100}]'));
select public.apply_sale_sync_with_payments('05000000-0000-4000-8000-0000000005a2', 'b0000000-0000-4000-8000-0000000005a0', '5a000000-0000-4000-8000-0000000005a2',
  pg_temp.sale('5a000000-0000-4000-8000-0000000005a2', 'SC-2', '11000000-0000-4000-8000-0000000005a2', 'split',
    '[{"id":"9a000000-0000-4000-8000-0000000005a1","method":"cash","amountFils":1000},{"id":"9a000000-0000-4000-8000-0000000005a2","method":"card","amountFils":1100}]'));
-- The split sale is refunded: cash 4.00 + card 17.00.
select public.apply_credit_note_sync_with_payments('0e000000-0000-4000-8000-0000000005a1', 'b0000000-0000-4000-8000-0000000005a0', 'c0000000-0000-4000-8000-0000000005a1',
  jsonb_build_object('deviceId', 'd0000000-0000-4000-8000-0000000005a0', 'creditNote', jsonb_build_object(
    'id', 'c0000000-0000-4000-8000-0000000005a1', 'creditNoteNumber', 'SCN-1', 'saleId', '5a000000-0000-4000-8000-0000000005a2',
    'createdAt', now()::text, 'paymentMethod', 'split', 'netFils', 2000, 'vatFils', 100, 'grossFils', 2100,
    'payments', '[{"id":"9b000000-0000-4000-8000-0000000005a1","method":"cash","amountFils":400},{"id":"9b000000-0000-4000-8000-0000000005a2","method":"card","amountFils":1700}]'::jsonb,
    'lines', jsonb_build_array(jsonb_build_object('id', '12000000-0000-4000-8000-0000000005a1', 'originalLineId', '11000000-0000-4000-8000-0000000005a2',
      'name', 'Tea', 'quantity', 1, 'unitGrossFils', 2100, 'netFils', 2000, 'vatFils', 100, 'grossFils', 2100)))));
reset role;

do $$ begin
  assert (select count(*) from public.cash_movements where sale_id = '5a000000-0000-4000-8000-0000000005a2') = 1, 'a split sale''s cash part is one drawer movement, not repeated by a retry';
  assert (select amount_fils from public.cash_movements where sale_id = '5a000000-0000-4000-8000-0000000005a2') = 1000, 'only the cash part enters the drawer';
  assert (select amount_fils from public.cash_movements where register_session_id = 'e0000000-0000-4000-8000-0000000005a0' and type = 'refund') = -400,
    'a split refund takes only its cash part out of the drawer';
  assert (select sum(amount_fils) from public.cash_movements where register_session_id = 'e0000000-0000-4000-8000-0000000005a0') = 2100 + 1000 - 400,
    'expected cash = opening + cash sale + split cash part − split cash refund';
end $$;

rollback;
