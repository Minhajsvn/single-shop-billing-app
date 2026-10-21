-- Stage 1G: cashiers get exactly what selling needs (owner decisions 7 and 8): products, customers, today's sales and
-- register, and the selling sync paths. Owner policies are unchanged; member policies are read-only and every member
-- write goes through the security-definer sync functions.

create function public.dubai_today()
returns date language sql stable set search_path = public, pg_temp
as $$ select (now() at time zone 'Asia/Dubai')::date $$;

-- True when the register session exists and is still open (security definer so policies can ask without recursion).
create function public.register_session_open(p_register_session_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.register_sessions where id = p_register_session_id and status = 'open') $$;

-- A sale is visible to an owner always, and to a member when it is from today (Dubai) or belongs to a shift that is
-- still open (a shift that runs past midnight keeps its sales).
create function public.member_sees_sale(p_business_id uuid, p_supply_date date, p_register_session_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select public.has_role(p_business_id, 'owner')
      or (public.has_role(p_business_id, 'cashier')
          and (p_supply_date = public.dubai_today() or public.register_session_open(p_register_session_id)))
$$;

revoke execute on function public.register_session_open(uuid) from public, anon;
revoke execute on function public.member_sees_sale(uuid, date, uuid) from public, anon;
grant execute on function public.dubai_today() to authenticated;
grant execute on function public.register_session_open(uuid) to authenticated;
grant execute on function public.member_sees_sale(uuid, date, uuid) to authenticated;

create policy "members read products" on public.products for select using (public.has_role(business_id, 'cashier'));
create policy "members read customers" on public.customers for select using (public.has_role(business_id, 'cashier'));
create policy "members read today's sales" on public.sales for select
  using (public.member_sees_sale(business_id, supply_date, register_session_id));
create policy "members read items of visible sales" on public.sale_items for select
  using (public.has_role(business_id, 'cashier') and exists (select 1 from public.sales s where s.id = sale_id));
create policy "members read credit notes of visible sales, open shifts or today" on public.credit_notes for select
  using (public.has_role(business_id, 'cashier')
         and (exists (select 1 from public.sales s where s.id = sale_id)
              or public.register_session_open(register_session_id)
              or (created_at at time zone 'Asia/Dubai')::date = public.dubai_today()));
create policy "members read items of visible credit notes" on public.credit_note_items for select
  using (public.has_role(business_id, 'cashier') and exists (select 1 from public.credit_notes c where c.id = credit_note_id));
create policy "members read today's and open shifts" on public.register_sessions for select
  using (public.has_role(business_id, 'cashier') and (status = 'open' or business_date = public.dubai_today()));
create policy "members read cash movements of visible shifts" on public.cash_movements for select
  using (public.has_role(business_id, 'cashier')
         and exists (select 1 from public.register_sessions r where r.id = register_session_id));

-- The selling sync functions accept any member (cashier and above); product and stock sync stay owner-only.
-- Each body is the latest one, changed only in its access check; the check must appear exactly once.
do $$
declare
  fn text;
  def text;
  guard constant text := 'if auth.uid() is null or not public.owns_business(p_business_id) then';
  member_guard constant text := 'if auth.uid() is null or not public.has_role(p_business_id, ''cashier'') then';
begin
  foreach fn in array array['apply_customer_sync', 'apply_sale_sync', 'apply_register_sync', 'apply_credit_note_sync'] loop
    if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = fn) <> 1 then
      raise exception 'expected exactly one function named %', fn;
    end if;
    select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = fn;
    if (length(def) - length(replace(def, guard, ''))) / length(guard) <> 1 then
      raise exception 'expected exactly one owner check in %', fn;
    end if;
    def := replace(def, guard, member_guard);
    -- Pre-existing defect (since 202610130016): the refund line check compared the column with an unqualified
    -- variable of the same name, which plpgsql rejects as ambiguous, so no refund with lines could sync.
    if fn = 'apply_credit_note_sync' then
      if (length(def) - length(replace(def, 'cni.sale_item_id = sale_item_id', ''))) / length('cni.sale_item_id = sale_item_id') <> 1 then
        raise exception 'expected exactly one refund line check in apply_credit_note_sync';
      end if;
      -- The variable holds exactly this value (assigned just above the check in the loop).
      def := replace(def, 'cni.sale_item_id = sale_item_id', 'cni.sale_item_id = (line_record->>''originalLineId'')::uuid');
    end if;
    execute def;
  end loop;
end
$$;

-- Refund by exact invoice number (owner decision 8): one sale of this business, with its items and the credit notes
-- already issued against it, in the snapshot row shape. Null when absent. Members only. Invoice numbers can be guessed,
-- so every lookup is written to the audit log (owner-readable) to make bulk browsing of past sales visible.
create function public.find_sale_by_invoice(p_business_id uuid, p_invoice text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not public.has_role(p_business_id, 'cashier') then
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
    ), '[]'::jsonb),
    'credit_notes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'credit_note_number', c.credit_note_number,
        'created_at', c.created_at,
        'gross_fils', c.gross_fils,
        'credit_note_items', coalesce((
          select jsonb_agg(jsonb_build_object('sale_item_id', ci.sale_item_id, 'quantity', ci.quantity))
          from public.credit_note_items ci where ci.credit_note_id = c.id
        ), '[]'::jsonb)
      ) order by c.created_at)
      from public.credit_notes c
      where c.sale_id = s.id
    ), '[]'::jsonb)
  )
  into result
  from public.sales s
  where s.business_id = p_business_id
    and s.invoice_number = p_invoice;

  insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, summary)
  values (p_business_id, auth.uid(), 'sale.lookup_by_invoice', 'sale',
    coalesce((result->>'id')::uuid, '00000000-0000-0000-0000-000000000000'),
    jsonb_build_object('invoiceNumber', left(p_invoice, 64), 'found', result is not null));

  return result;
end;
$$;

revoke all on function public.find_sale_by_invoice(uuid, text) from public;
grant execute on function public.find_sale_by_invoice(uuid, text) to authenticated;
