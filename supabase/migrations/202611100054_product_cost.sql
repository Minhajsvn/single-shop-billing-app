-- Stage 2C (spec §4.2): cost price excl. VAT on products, and the cost stamped on each sale and refund line (§4.3).
-- Cost is Pro (`categories_margin`) and for owners and managers only. Cashiers can read these tables through RLS, so
-- the cost columns are hidden with column privileges: table-wide SELECT is revoked and every other column is granted
-- back. A column added to these tables later must be granted explicitly, or members cannot read it.

alter table public.products add column cost_fils bigint check (cost_fils between 0 and 100000000);
alter table public.sale_items add column unit_cost_fils bigint check (unit_cost_fils >= 0);
alter table public.credit_note_items add column unit_cost_fils bigint check (unit_cost_fils >= 0);

revoke select, insert, update on public.products from anon, authenticated;
grant select (id, business_id, name, sku, barcode, price_fils, stock_quantity, low_stock_threshold, status, created_at, updated_at, tax_category, category_id)
  on public.products to authenticated;
-- Owners still write products directly in the sample-to-hosted move (lib/supabase/catalog-sync.ts); never the cost.
grant insert (id, business_id, name, sku, barcode, price_fils, stock_quantity, low_stock_threshold, status, created_at, updated_at, tax_category, category_id),
      update (id, business_id, name, sku, barcode, price_fils, stock_quantity, low_stock_threshold, status, created_at, updated_at, tax_category, category_id)
  on public.products to authenticated;

revoke select, insert on public.sale_items from anon, authenticated;
grant select (id, business_id, sale_id, product_id, description, sku, quantity, unit_gross_fils, net_fils, vat_fils, gross_fils, vat_rate_bp, list_unit_gross_fils),
      insert (id, business_id, sale_id, product_id, description, sku, quantity, unit_gross_fils, net_fils, vat_fils, gross_fils, vat_rate_bp, list_unit_gross_fils)
  on public.sale_items to authenticated;

revoke select, insert on public.credit_note_items from anon, authenticated;
grant select (id, business_id, credit_note_id, sale_item_id, product_id, description, sku, quantity, unit_gross_fils, net_fils, vat_fils, gross_fils, vat_rate_bp),
      insert (id, business_id, credit_note_id, sale_item_id, product_id, description, sku, quantity, unit_gross_fils, net_fils, vat_fils, gross_fils, vat_rate_bp)
  on public.credit_note_items to authenticated;

-- Raises unless the caller is an owner or manager of the shop (42501 not_authorized) on a plan with
-- categories_margin (P0001 feature_not_in_plan).
create function public.cost_reader_check(p_business_id uuid)
returns void language plpgsql stable security definer set search_path = public, extensions, pg_temp
as $$
begin
  if auth.uid() is null or not public.has_role(p_business_id, 'manager') then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not coalesce(public.entitlements_internal(p_business_id) -> 'features' ? 'categories_margin', false) then
    raise exception 'feature_not_in_plan' using errcode = 'P0001';
  end if;
end
$$;

revoke all on function public.cost_reader_check(uuid) from public, anon, authenticated;

-- Sets (or, with null, clears) one product's cost. Owner only, Pro only. Audited with the cost before and after.
create function public.set_product_cost(p_business_id uuid, p_product_id uuid, p_cost_fils bigint)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  before_cost bigint;
begin
  if auth.uid() is null or not public.owns_business(p_business_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform public.cost_reader_check(p_business_id);
  if p_cost_fils is not null and (p_cost_fils < 0 or p_cost_fils > 100000000) then
    raise exception 'invalid_cost' using errcode = 'P0001';
  end if;

  select cost_fils into before_cost from public.products
  where id = p_product_id and business_id = p_business_id for update;
  if not found then
    raise exception 'product_not_found' using errcode = 'P0001';
  end if;
  if before_cost is not distinct from p_cost_fils then
    return;
  end if;

  update public.products set cost_fils = p_cost_fils, updated_at = now() where id = p_product_id;
  insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, summary)
  values (p_business_id, auth.uid(), 'product.cost', 'product', p_product_id,
          jsonb_build_object('before', before_cost, 'after', p_cost_fils));
end
$$;

revoke all on function public.set_product_cost(uuid, uuid, bigint) from public, anon;
grant execute on function public.set_product_cost(uuid, uuid, bigint) to authenticated;

-- Every costed product of the shop, for an owner or manager on Pro.
create function public.product_costs(p_business_id uuid)
returns table (product_id uuid, cost_fils bigint) language plpgsql stable security definer set search_path = public, extensions, pg_temp
as $$
begin
  perform public.cost_reader_check(p_business_id);
  return query select p.id, p.cost_fils from public.products p where p.business_id = p_business_id and p.cost_fils is not null;
end
$$;

revoke all on function public.product_costs(uuid) from public, anon;
grant execute on function public.product_costs(uuid) to authenticated;
