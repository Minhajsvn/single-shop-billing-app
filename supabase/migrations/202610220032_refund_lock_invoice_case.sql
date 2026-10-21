-- Stage 1G final review fixes, made in place on the latest bodies (each replaced text must occur exactly once).
--   1. find_sale_by_invoice matches the invoice number ignoring case and surrounding spaces, as the till does. The
--      unique key (business_id, invoice_number) is case-sensitive, so two numbers could differ only by case: the exact
--      match wins, then the oldest sale, so the lookup still returns one row.
--   2. (below) apply_credit_note_sync locks the refunded sale line.

do $$
declare
  def text;
  old_match constant text := 'and s.invoice_number = p_invoice;';
  new_match constant text := 'and upper(s.invoice_number) = upper(btrim(p_invoice))
  order by (s.invoice_number = btrim(p_invoice)) desc, s.created_at, s.id
  limit 1;';
begin
  select pg_get_functiondef('public.find_sale_by_invoice(uuid, text)'::regprocedure) into def;
  if (length(def) - length(replace(def, old_match, ''))) / length(old_match) <> 1 then
    raise exception 'expected exactly one invoice match in find_sale_by_invoice';
  end if;
  execute replace(def, old_match, new_match);
end
$$;

--   2. apply_credit_note_sync locks the sale line it refunds before reading the quantity already refunded, so two
--      tills refunding the same line at once are serialised: the later one waits, then sees the first refund and is
--      refused with credit_note_quantity_exceeds_sale instead of over-refunding.
do $$
declare
  def text;
  old_lookup constant text := 'and si.business_id = p_business_id;';
  new_lookup constant text := 'and si.business_id = p_business_id
    for update;';
begin
  select pg_get_functiondef('public.apply_credit_note_sync(uuid, uuid, uuid, jsonb)'::regprocedure) into def;
  if (length(def) - length(replace(def, old_lookup, ''))) / length(old_lookup) <> 1 then
    raise exception 'expected exactly one sale line lookup in apply_credit_note_sync';
  end if;
  execute replace(def, old_lookup, new_lookup);
end
$$;

-- The case-insensitive lookup stays an index search.
create index sales_business_invoice_upper_idx on public.sales (business_id, upper(invoice_number));
