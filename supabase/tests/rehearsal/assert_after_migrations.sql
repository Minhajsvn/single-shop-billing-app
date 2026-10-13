-- Rehearsal assertions: run after the Stage 1A migrations are applied on top of seed_existing_shops.sql.
-- Read-only checks inside a transaction that always rolls back.
begin;

do $$
declare
  target text;
  missing integer;
  wrong integer;
begin
  -- The seed is present, so the checks below are not vacuous.
  assert (select count(*) from public.businesses where id in ('b1000000-0000-4000-9000-000000000001', 'b1000000-0000-4000-9000-000000000002')) = 2, 'seeded businesses survive';
  assert (select count(*) from public.devices where business_id in ('b1000000-0000-4000-9000-000000000001', 'b1000000-0000-4000-9000-000000000002')) = 3, 'seeded devices survive';

  -- Every pre-existing operational row was backfilled onto its business's main branch.
  foreach target in array array['devices', 'register_sessions', 'sales', 'stock_movements', 'cash_movements', 'credit_notes'] loop
    execute format('select count(*) from public.%I where branch_id is null', target) into missing;
    assert missing = 0, format('%s has %s rows with null branch_id', target, missing);
    execute format('select count(*) from public.%I t left join public.branches b on b.business_id = t.business_id and b.is_main where b.id is null or t.branch_id <> b.id', target) into wrong;
    assert wrong = 0, format('%s has %s rows not on their business main branch', target, wrong);
    execute format('select count(*) from public.%I where business_id = %L', target, 'b1000000-0000-4000-9000-000000000001') into missing;
    assert missing >= 1, format('%s has no rows for business 1; seed did not exercise the backfill', target);
  end loop;

  -- Exactly one active owner membership (the business owner), one main branch and one Pro trial per business.
  assert not exists (
    select 1 from public.businesses b
    where (select count(*) from public.business_members m where m.business_id = b.id and m.role = 'owner' and m.status = 'active' and m.user_id = b.owner_id) <> 1
       or (select count(*) from public.business_members m where m.business_id = b.id) <> 1
  ), 'each business has exactly one active owner member';
  assert not exists (
    select 1 from public.businesses b
    where (select count(*) from public.branches r where r.business_id = b.id and r.is_main) <> 1
       or (select count(*) from public.branches r where r.business_id = b.id) <> 1
  ), 'each business has exactly one main branch';
  assert not exists (
    select 1 from public.businesses b
    where (select count(*) from public.subscriptions s where s.business_id = b.id and s.plan_id = 'pro' and s.status = 'trialing') <> 1
  ), 'each business has exactly one Pro trial subscription';
  assert (select bool_and(r.invoice_prefix = b.invoice_prefix and r.address = b.address and r.receipt_footer = b.receipt_footer)
          from public.branches r join public.businesses b on b.id = r.business_id), 'main branch copies business invoice settings';

  -- Existing invoice and credit-note lines get the UAE standard rate.
  assert (select count(*) from public.sale_items) = 1 and not exists (select 1 from public.sale_items where vat_rate_bp <> 500), 'sale_items vat_rate_bp = 500';
  assert (select count(*) from public.credit_note_items) = 1 and not exists (select 1 from public.credit_note_items where vat_rate_bp <> 500), 'credit_note_items vat_rate_bp = 500';
  assert not exists (select 1 from public.products where tax_category <> 'standard'), 'products default to standard tax category';

  -- Existing businesses are UAE / AED.
  assert not exists (select 1 from public.businesses where country <> 'AE' or currency <> 'AED'), 'businesses are AE / AED';

  -- Existing rows survive plan limits: business 1 keeps both tills active.
  assert (select count(*) from public.devices where business_id = 'b1000000-0000-4000-9000-000000000001' and status = 'active') = 2, 'business 1 keeps both devices active';
  assert (select count(*) from public.products where status = 'active') = 2, 'existing products stay active';

  -- The sync RPC search_path hotfix is applied.
  assert (select count(*) from pg_proc p, unnest(p.proconfig) c
          where p.proname in ('apply_customer_sync', 'apply_sale_sync', 'apply_register_sync', 'apply_credit_note_sync', 'apply_stock_sync')
            and c = 'search_path=public, extensions, pg_temp') = 5, 'all five sync RPCs have extensions on their search_path';
end $$;

rollback;
