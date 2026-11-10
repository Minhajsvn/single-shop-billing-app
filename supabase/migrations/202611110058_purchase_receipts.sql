-- Stage 2D (spec §4): deliveries from suppliers. One function records a delivery: it adds stock (receipt movements),
-- moves each product's cost to the weighted average and keeps the supplier invoice's VAT. Voiding takes the stock back
-- out and leaves cost alone. Pro (`purchasing`), owner and manager only; members have no table privileges.

create table public.purchase_receipts (
  id uuid primary key,
  business_id uuid not null references public.businesses (id) on delete restrict,
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  supplier_invoice text check (supplier_invoice = btrim(supplier_invoice) and char_length(supplier_invoice) between 1 and 40),
  invoice_date date not null,
  net_fils bigint not null check (net_fils >= 0),
  vat_fils bigint not null check (vat_fils >= 0 and vat_fils <= net_fils),
  gross_fils bigint not null check (gross_fils = net_fils + vat_fils),
  note text check (char_length(note) <= 300),
  received_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users (id) on delete restrict,
  void_reason text check (char_length(void_reason) between 1 and 200),
  check ((voided_at is null) = (void_reason is null))
);

create unique index purchase_receipts_live_invoice on public.purchase_receipts (business_id, supplier_id, lower(supplier_invoice))
  where supplier_invoice is not null and voided_at is null;
create index purchase_receipts_business_date on public.purchase_receipts (business_id, invoice_date);

create table public.purchase_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.purchase_receipts (id) on delete restrict,
  business_id uuid not null references public.businesses (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  quantity integer not null check (quantity between 1 and 100000),
  unit_cost_fils bigint not null check (unit_cost_fils between 0 and 100000000),
  line_net_fils bigint not null check (line_net_fils = quantity * unit_cost_fils),
  cost_before_fils bigint,
  cost_after_fils bigint not null,
  unique (receipt_id, product_id)
);

create index purchase_receipt_lines_product on public.purchase_receipt_lines (product_id);

alter table public.purchase_receipts enable row level security;
alter table public.purchase_receipt_lines enable row level security;
revoke all on public.purchase_receipts from public, anon, authenticated;
revoke all on public.purchase_receipt_lines from public, anon, authenticated;

-- One delivery as the screens read it: header, supplier, and lines with product names.
create function public.purchase_receipt_get(p_business_id uuid, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions, pg_temp
as $$
declare
  result jsonb;
begin
  perform public.purchasing_check(p_business_id);
  select jsonb_build_object(
    'id', r.id, 'supplierId', r.supplier_id, 'supplierName', s.name, 'supplierTrn', s.trn,
    'supplierInvoice', r.supplier_invoice, 'invoiceDate', r.invoice_date, 'netFils', r.net_fils, 'vatFils', r.vat_fils,
    'grossFils', r.gross_fils, 'note', r.note, 'receivedBy', r.received_by, 'createdAt', r.created_at,
    'voidedAt', r.voided_at, 'voidReason', r.void_reason,
    'lineCount', (select count(*) from public.purchase_receipt_lines l where l.receipt_id = r.id),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'productId', l.product_id, 'productName', p.name, 'sku', p.sku, 'quantity', l.quantity,
        'unitCostFils', l.unit_cost_fils, 'lineNetFils', l.line_net_fils,
        'costBeforeFils', l.cost_before_fils, 'costAfterFils', l.cost_after_fils) order by p.name)
      from public.purchase_receipt_lines l join public.products p on p.id = l.product_id
      where l.receipt_id = r.id), '[]'::jsonb))
  into result
  from public.purchase_receipts r join public.suppliers s on s.id = r.supplier_id
  where r.id = p_id and r.business_id = p_business_id;
  if result is null then
    raise exception 'receipt_not_found' using errcode = 'P0001';
  end if;
  return result;
end
$$;

-- Records a delivery. Payload: { id, supplierId, supplierInvoice?, invoiceDate, vatFils, note?,
-- lines: [{ productId, quantity, unitCostFils }] }. The same id again returns the saved delivery (a retry).
create function public.record_purchase_receipt(p_business_id uuid, p_receipt jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  receipt_id uuid;
  supplier public.suppliers;
  invoice text := nullif(btrim(coalesce(p_receipt->>'supplierInvoice', '')), '');
  note_text text := nullif(btrim(coalesce(p_receipt->>'note', '')), '');
  inv_date date;
  vat bigint;
  net bigint := 0;
  line jsonb;
  product public.products;
  qty integer;
  unit bigint;
  base integer;
  new_cost bigint;
  earlier date;
begin
  perform public.purchasing_check(p_business_id);

  -- Shape first: every field, every line.
  if jsonb_typeof(p_receipt) <> 'object' or coalesce(p_receipt->>'id', '') !~* uuid_re or coalesce(p_receipt->>'supplierId', '') !~* uuid_re
     or jsonb_typeof(p_receipt->'lines') <> 'array' or jsonb_array_length(p_receipt->'lines') not between 1 and 200
     or coalesce(p_receipt->>'invoiceDate', '') !~ '^\d{4}-\d{2}-\d{2}$'
     or jsonb_typeof(p_receipt->'vatFils') <> 'number' or (p_receipt->>'vatFils') !~ '^\d+$'
     or char_length(coalesce(invoice, '')) > 40 or char_length(coalesce(note_text, '')) > 300 then
    raise exception 'invalid_receipt' using errcode = 'P0001';
  end if;
  for line in select value from jsonb_array_elements(p_receipt->'lines') loop
    if coalesce(line->>'productId', '') !~* uuid_re
       or jsonb_typeof(line->'quantity') <> 'number' or (line->>'quantity') !~ '^\d+$' or (line->>'quantity')::bigint not between 1 and 100000
       or jsonb_typeof(line->'unitCostFils') <> 'number' or (line->>'unitCostFils') !~ '^\d+$' or (line->>'unitCostFils')::bigint > 100000000 then
      raise exception 'invalid_receipt' using errcode = 'P0001';
    end if;
  end loop;
  if (select count(distinct value->>'productId') from jsonb_array_elements(p_receipt->'lines')) <> jsonb_array_length(p_receipt->'lines') then
    raise exception 'duplicate_line' using errcode = 'P0001';
  end if;
  begin
    inv_date := (p_receipt->>'invoiceDate')::date;
  exception when others then
    raise exception 'invalid_receipt' using errcode = 'P0001';
  end;
  receipt_id := (p_receipt->>'id')::uuid;
  vat := (p_receipt->>'vatFils')::bigint;

  -- A retry returns what was saved; an id from another shop is refused.
  if exists (select 1 from public.purchase_receipts r where r.id = receipt_id) then
    if exists (select 1 from public.purchase_receipts r where r.id = receipt_id and r.business_id = p_business_id) then
      return public.purchase_receipt_get(p_business_id, receipt_id);
    end if;
    raise exception 'invalid_receipt' using errcode = 'P0001';
  end if;

  select * into supplier from public.suppliers s
  where s.id = (p_receipt->>'supplierId')::uuid and s.business_id = p_business_id and s.archived_at is null;
  if not found then
    raise exception 'supplier_not_found' using errcode = 'P0001';
  end if;

  for line in select value from jsonb_array_elements(p_receipt->'lines') loop
    select * into product from public.products p where p.id = (line->>'productId')::uuid and p.business_id = p_business_id;
    if not found then
      raise exception 'product_not_found' using errcode = 'P0001';
    end if;
    if product.status <> 'active' then
      raise exception using errcode = 'P0001', message = 'product_archived', detail = product.name;
    end if;
    net := net + (line->>'quantity')::bigint * (line->>'unitCostFils')::bigint;
  end loop;
  if vat > net then
    raise exception 'invalid_vat' using errcode = 'P0001';
  end if;

  if invoice is not null then
    select r.invoice_date into earlier from public.purchase_receipts r
    where r.business_id = p_business_id and r.supplier_id = supplier.id and lower(r.supplier_invoice) = lower(invoice) and r.voided_at is null;
    if found then
      raise exception using errcode = 'P0001', message = 'duplicate_supplier_invoice', detail = earlier::text;
    end if;
  end if;

  begin
    insert into public.purchase_receipts (id, business_id, supplier_id, supplier_invoice, invoice_date, net_fils, vat_fils, gross_fils, note, received_by)
    values (receipt_id, p_business_id, supplier.id, invoice, inv_date, net, vat, net + vat, note_text, auth.uid());
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'duplicate_supplier_invoice', detail = inv_date::text;
  end;

  -- Lines in product-id order, each product locked while its stock and cost change.
  for line in select value from jsonb_array_elements(p_receipt->'lines') order by value->>'productId' loop
    select * into product from public.products p where p.id = (line->>'productId')::uuid for update;
    qty := (line->>'quantity')::integer;
    unit := (line->>'unitCostFils')::bigint;
    base := greatest(product.stock_quantity, 0);
    new_cost := round((base::numeric * coalesce(product.cost_fils, unit) + qty::numeric * unit) / (base + qty));

    update public.products set stock_quantity = stock_quantity + qty, cost_fils = new_cost, updated_at = now() where id = product.id;
    insert into public.stock_movements (business_id, product_id, type, quantity_delta, reason, source_id, created_by)
    values (p_business_id, product.id, 'receipt', qty,
            left('Delivery · ' || supplier.name || coalesce(' · ' || invoice, ''), 300), receipt_id, auth.uid());
    insert into public.purchase_receipt_lines (receipt_id, business_id, product_id, quantity, unit_cost_fils, line_net_fils, cost_before_fils, cost_after_fils)
    values (receipt_id, p_business_id, product.id, qty, unit, qty * unit, product.cost_fils, new_cost);
    if product.cost_fils is distinct from new_cost then
      insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, summary)
      values (p_business_id, auth.uid(), 'product.cost', 'product', product.id,
              jsonb_build_object('before', product.cost_fils, 'after', new_cost, 'receiptId', receipt_id));
    end if;
  end loop;

  insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, summary)
  values (p_business_id, auth.uid(), 'purchase.receipt', 'purchase_receipt', receipt_id,
          jsonb_build_object('supplier', supplier.name, 'invoice', invoice, 'lines', jsonb_array_length(p_receipt->'lines'),
                             'netFils', net, 'vatFils', vat, 'grossFils', net + vat));
  return public.purchase_receipt_get(p_business_id, receipt_id);
end
$$;

-- Voids a delivery: stock goes back out (correction_out), cost stays. Refused when stock has already gone below
-- what it would take out (detail "<product name>:<stock>").
create function public.void_purchase_receipt(p_business_id uuid, p_receipt_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  receipt public.purchase_receipts;
  clean_reason text := btrim(coalesce(p_reason, ''));
  line record;
begin
  perform public.purchasing_check(p_business_id);
  if char_length(clean_reason) not between 1 and 200 then
    raise exception 'invalid_reason' using errcode = 'P0001';
  end if;
  select * into receipt from public.purchase_receipts r where r.id = p_receipt_id and r.business_id = p_business_id for update;
  if not found then
    raise exception 'receipt_not_found' using errcode = 'P0001';
  end if;
  if receipt.voided_at is not null then
    raise exception 'already_voided' using errcode = 'P0001';
  end if;

  for line in
    select l.product_id, l.quantity, p.name, p.stock_quantity
    from public.purchase_receipt_lines l join public.products p on p.id = l.product_id
    where l.receipt_id = receipt.id order by l.product_id
    for update of p
  loop
    if line.stock_quantity < line.quantity then
      raise exception using errcode = 'P0001', message = 'stock_too_low', detail = line.name || ':' || line.stock_quantity;
    end if;
    update public.products set stock_quantity = stock_quantity - line.quantity, updated_at = now() where id = line.product_id;
    insert into public.stock_movements (business_id, product_id, type, quantity_delta, reason, source_id, created_by)
    values (p_business_id, line.product_id, 'correction_out', -line.quantity, left('Delivery voided · ' || clean_reason, 300), receipt.id, auth.uid());
  end loop;

  update public.purchase_receipts set voided_at = now(), voided_by = auth.uid(), void_reason = clean_reason where id = receipt.id;
  insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, summary)
  values (p_business_id, auth.uid(), 'purchase.void', 'purchase_receipt', receipt.id, jsonb_build_object('reason', clean_reason));
end
$$;

-- Deliveries between two invoice dates (at most 92 days), newest first; optionally one supplier's.
create function public.purchase_receipt_list(p_business_id uuid, p_from date, p_to date, p_supplier uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public, extensions, pg_temp
as $$
begin
  perform public.purchasing_check(p_business_id);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 91 then
    raise exception 'invalid_range' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'supplierId', r.supplier_id, 'supplierName', s.name, 'supplierTrn', s.trn,
      'supplierInvoice', r.supplier_invoice, 'invoiceDate', r.invoice_date,
      'lineCount', (select count(*) from public.purchase_receipt_lines l where l.receipt_id = r.id),
      'netFils', r.net_fils, 'vatFils', r.vat_fils, 'grossFils', r.gross_fils, 'createdAt', r.created_at, 'voidedAt', r.voided_at)
      order by r.invoice_date desc, r.created_at desc)
    from public.purchase_receipts r join public.suppliers s on s.id = r.supplier_id
    where r.business_id = p_business_id and r.invoice_date between p_from and p_to
      and (p_supplier is null or r.supplier_id = p_supplier)), '[]'::jsonb);
end
$$;

-- Per product, the latest delivery that was not voided.
create function public.product_last_delivery(p_business_id uuid)
returns table (product_id uuid, invoice_date date, supplier_name text, unit_cost_fils bigint)
language plpgsql stable security definer set search_path = public, extensions, pg_temp
as $$
begin
  perform public.purchasing_check(p_business_id);
  return query
  select distinct on (l.product_id) l.product_id, r.invoice_date, s.name, l.unit_cost_fils
  from public.purchase_receipt_lines l
  join public.purchase_receipts r on r.id = l.receipt_id
  join public.suppliers s on s.id = r.supplier_id
  where r.business_id = p_business_id and r.voided_at is null
  order by l.product_id, r.invoice_date desc, r.created_at desc;
end
$$;

revoke all on function public.purchase_receipt_get(uuid, uuid) from public, anon;
revoke all on function public.record_purchase_receipt(uuid, jsonb) from public, anon;
revoke all on function public.void_purchase_receipt(uuid, uuid, text) from public, anon;
revoke all on function public.purchase_receipt_list(uuid, date, date, uuid) from public, anon;
revoke all on function public.product_last_delivery(uuid) from public, anon;
grant execute on function public.purchase_receipt_get(uuid, uuid) to authenticated;
grant execute on function public.record_purchase_receipt(uuid, jsonb) to authenticated;
grant execute on function public.void_purchase_receipt(uuid, uuid, text) to authenticated;
grant execute on function public.purchase_receipt_list(uuid, date, date, uuid) to authenticated;
grant execute on function public.product_last_delivery(uuid) to authenticated;
