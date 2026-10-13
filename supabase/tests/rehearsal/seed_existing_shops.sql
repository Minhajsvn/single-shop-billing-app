-- Rehearsal seed: shops as they exist in production before Stage 1A (schema 0001-0009 only).
-- Run as the postgres user after `supabase db reset --version 202609140009`.
begin;

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-9000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rehearsal-owner-1@test.local'),
  ('00000000-0000-4000-9000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rehearsal-owner-2@test.local');

insert into public.businesses (id, owner_id, legal_name, trn, address, phone, invoice_prefix, receipt_footer) values
  ('b1000000-0000-4000-9000-000000000001', '00000000-0000-4000-9000-000000000001', 'Rehearsal Grocery LLC', '100000000000003', 'Al Barsha, Dubai', '+971500000101', 'RG', 'Thank you'),
  ('b1000000-0000-4000-9000-000000000002', '00000000-0000-4000-9000-000000000002', 'Rehearsal Hardware LLC', '100000000000004', 'Deira, Dubai', '+971500000102', 'RH', '');

-- Business 1: two tills, one product, one sale with its cash and stock movements, and a credit note.
insert into public.devices (id, business_id, name, status) values
  ('d1000000-0000-4000-9000-000000000011', 'b1000000-0000-4000-9000-000000000001', 'Till 1', 'active'),
  ('d1000000-0000-4000-9000-000000000012', 'b1000000-0000-4000-9000-000000000001', 'Till 2', 'active');

insert into public.products (id, business_id, name, sku, barcode, price_fils, stock_quantity) values
  ('a1000000-0000-4000-9000-000000000011', 'b1000000-0000-4000-9000-000000000001', 'Milk 1L', 'MILK-1L', '6291000000011', 1050, 9);

insert into public.register_sessions (id, business_id, device_id, business_date, status, opening_cash_fils, opened_by) values
  ('e1000000-0000-4000-9000-000000000011', 'b1000000-0000-4000-9000-000000000001', 'd1000000-0000-4000-9000-000000000011', '2026-10-01', 'open', 50000, '00000000-0000-4000-9000-000000000001');

insert into public.sales (id, business_id, device_id, register_session_id, invoice_number, operation_id, payment_method, supply_date, supplier_snapshot, net_fils, vat_fils, gross_fils, created_by) values
  ('5a100000-0000-4000-9000-000000000011', 'b1000000-0000-4000-9000-000000000001', 'd1000000-0000-4000-9000-000000000011', 'e1000000-0000-4000-9000-000000000011', 'RG-261001-0001', '0e100000-0000-4000-9000-000000000011', 'cash', '2026-10-01',
   '{"legalName":"Rehearsal Grocery LLC","trn":"100000000000003","address":"Al Barsha, Dubai"}'::jsonb, 1000, 50, 1050, '00000000-0000-4000-9000-000000000001');

insert into public.sale_items (id, business_id, sale_id, product_id, description, sku, quantity, unit_gross_fils, net_fils, vat_fils, gross_fils) values
  ('5b100000-0000-4000-9000-000000000011', 'b1000000-0000-4000-9000-000000000001', '5a100000-0000-4000-9000-000000000011', 'a1000000-0000-4000-9000-000000000011', 'Milk 1L', 'MILK-1L', 1, 1050, 1000, 50, 1050);

insert into public.cash_movements (id, business_id, register_session_id, sale_id, type, amount_fils, reason, created_by) values
  ('c1000000-0000-4000-9000-000000000011', 'b1000000-0000-4000-9000-000000000001', 'e1000000-0000-4000-9000-000000000011', '5a100000-0000-4000-9000-000000000011', 'sale', 1050, 'Sale RG-261001-0001', '00000000-0000-4000-9000-000000000001');

insert into public.stock_movements (id, business_id, product_id, type, quantity_delta, reason, source_id, operation_id, created_by) values
  ('51100000-0000-4000-9000-000000000011', 'b1000000-0000-4000-9000-000000000001', 'a1000000-0000-4000-9000-000000000011', 'sale', -1, 'Sale RG-261001-0001', '5a100000-0000-4000-9000-000000000011', '0e100000-0000-4000-9000-000000000012', '00000000-0000-4000-9000-000000000001');

insert into public.credit_notes (id, business_id, device_id, register_session_id, sale_id, credit_note_number, operation_id, payment_method, supplier_snapshot, net_fils, vat_fils, gross_fils, created_by) values
  ('cc100000-0000-4000-9000-000000000011', 'b1000000-0000-4000-9000-000000000001', 'd1000000-0000-4000-9000-000000000011', 'e1000000-0000-4000-9000-000000000011', '5a100000-0000-4000-9000-000000000011', 'RG-CN-261001-0001', '0e100000-0000-4000-9000-000000000013', 'cash',
   '{"legalName":"Rehearsal Grocery LLC","trn":"100000000000003","address":"Al Barsha, Dubai"}'::jsonb, 1000, 50, 1050, '00000000-0000-4000-9000-000000000001');

insert into public.credit_note_items (id, business_id, credit_note_id, sale_item_id, product_id, description, sku, quantity, unit_gross_fils, net_fils, vat_fils, gross_fils) values
  ('cd100000-0000-4000-9000-000000000011', 'b1000000-0000-4000-9000-000000000001', 'cc100000-0000-4000-9000-000000000011', '5b100000-0000-4000-9000-000000000011', 'a1000000-0000-4000-9000-000000000011', 'Milk 1L', 'MILK-1L', 1, 1050, 1000, 50, 1050);

-- Business 2: one till and one product, no trading yet.
insert into public.devices (id, business_id, name, status) values
  ('d1000000-0000-4000-9000-000000000021', 'b1000000-0000-4000-9000-000000000002', 'Counter', 'active');

insert into public.products (id, business_id, name, sku, price_fils, stock_quantity) values
  ('a1000000-0000-4000-9000-000000000021', 'b1000000-0000-4000-9000-000000000002', 'Hammer', 'HAM-01', 2500, 4);

commit;
