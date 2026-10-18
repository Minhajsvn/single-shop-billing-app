-- Stage 1E: owners search sales older than the 90 days a browser keeps, and open one to view and reprint.

create index if not exists sales_business_supply_date_idx on public.sales (business_id, supply_date desc, created_at desc);

-- Mirrors normalizePhone in lib/lists/search.ts: digits only, without 00971/971 and the trunk 0.
create or replace function public.normalize_uae_phone(p_text text)
returns text
language sql
immutable
set search_path = public, extensions, pg_temp
as $$
  select regexp_replace(regexp_replace(regexp_replace(coalesce(p_text, ''), '\D', '', 'g'), '^(00971|971)', ''), '^0', '');
$$;

create or replace function public.search_sales(
  p_business_id uuid,
  p_query text,
  p_from date,
  p_to date,
  p_limit integer,
  p_offset integer
)
returns table (
  id uuid,
  invoice_number text,
  customer_name text,
  customer_phone text,
  supply_date date,
  created_at timestamptz,
  payment_method text,
  gross_fils bigint,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  term text := btrim(coalesce(p_query, ''));
  term_digits text := regexp_replace(btrim(coalesce(p_query, '')), '\D', '', 'g');
  term_phone text := public.normalize_uae_phone(p_query);
begin
  -- Owners only, matching the RLS on sales; staff roles arrive in Stage 2.
  if auth.uid() is null or not public.owns_business(p_business_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return query
  select
    s.id,
    s.invoice_number,
    s.customer_snapshot->>'name',
    s.customer_snapshot->>'phone',
    s.supply_date,
    s.created_at,
    s.payment_method::text,
    s.gross_fils,
    count(*) over ()
  from public.sales s
  where s.business_id = p_business_id
    and (p_from is null or s.supply_date >= p_from)
    and s.supply_date <= p_to
    and (
      term = ''
      or s.invoice_number ilike '%' || term || '%'
      or (s.customer_snapshot->>'name') ilike '%' || term || '%'
      or (
        length(term_digits) >= 4
        and (
          (length(term_phone) >= 4 and public.normalize_uae_phone(s.customer_snapshot->>'phone') like '%' || term_phone || '%')
          or regexp_replace(coalesce(s.customer_snapshot->>'phone', ''), '\D', '', 'g') like '%' || term_digits || '%'
        )
      )
    )
  order by s.created_at desc, s.id
  limit least(greatest(coalesce(p_limit, 50), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- One sale with its items, in the snapshot row shape (so the app maps it with mapSaleRow). Null when absent.
create or replace function public.get_sale_detail(p_business_id uuid, p_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not public.owns_business(p_business_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', s.id,
    'device_id', s.device_id,
    'invoice_number', s.invoice_number,
    'created_at', s.created_at,
    'supply_date', s.supply_date,
    'payment_method', s.payment_method,
    'net_fils', s.net_fils,
    'vat_fils', s.vat_fils,
    'gross_fils', s.gross_fils,
    'status', s.status,
    'customer_snapshot', s.customer_snapshot,
    'supplier_snapshot', s.supplier_snapshot,
    'sale_items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'product_id', i.product_id,
        'description', i.description,
        'sku', i.sku,
        'quantity', i.quantity,
        'unit_gross_fils', i.unit_gross_fils,
        'list_unit_gross_fils', i.list_unit_gross_fils,
        'net_fils', i.net_fils,
        'vat_fils', i.vat_fils,
        'gross_fils', i.gross_fils
      ) order by i.id)
      from public.sale_items i
      where i.sale_id = s.id
    ), '[]'::jsonb)
  )
  into result
  from public.sales s
  where s.id = p_sale_id
    and s.business_id = p_business_id;

  return result;
end;
$$;

revoke all on function public.search_sales(uuid, text, date, date, integer, integer) from public;
grant execute on function public.search_sales(uuid, text, date, date, integer, integer) to authenticated;
revoke all on function public.get_sale_detail(uuid, uuid) from public;
grant execute on function public.get_sale_detail(uuid, uuid) to authenticated;
