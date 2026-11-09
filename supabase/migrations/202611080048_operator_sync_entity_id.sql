-- Stage 2A fix: apply_register_sync stores an opened session under the operation's entity id, not the register id
-- the till made, so the "open" names must be matched by the entity id. apply_operator_sync now takes it.
-- The 3-argument version from 202611080046 is replaced.

drop function public.apply_operator_sync(uuid, text, jsonb);

create function public.apply_operator_sync(p_business_id uuid, p_entity text, p_entity_id uuid, p_payload jsonb)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  rec jsonb;
  rec_id uuid;
  op uuid;
  ap uuid;
begin
  if auth.uid() is null or not public.has_role(p_business_id, 'cashier') then
    raise exception using errcode = 'P0001', message = 'not_member';
  end if;
  if jsonb_typeof(p_payload) <> 'object' then
    return;
  end if;

  if p_entity = 'sale' then
    rec := p_payload -> 'sale';
    rec_id := (rec ->> 'id')::uuid;
    if not exists (select 1 from public.sales where id = rec_id and business_id = p_business_id and operator_member_id is null and approved_by_member_id is null) then
      return;
    end if;
    op := public.operator_field(p_business_id, 'sale', rec_id, 'operator_member_id', rec ->> 'operatorMemberId', 'cashier');
    ap := public.operator_field(p_business_id, 'sale', rec_id, 'approved_by_member_id', rec ->> 'approvedByMemberId', 'manager');
    update public.sales set operator_member_id = op, approved_by_member_id = ap where id = rec_id and business_id = p_business_id;

  elsif p_entity = 'credit-note' then
    rec := p_payload -> 'creditNote';
    rec_id := (rec ->> 'id')::uuid;
    if not exists (select 1 from public.credit_notes where id = rec_id and business_id = p_business_id and operator_member_id is null and approved_by_member_id is null) then
      return;
    end if;
    op := public.operator_field(p_business_id, 'credit_note', rec_id, 'operator_member_id', rec ->> 'operatorMemberId', 'cashier');
    ap := public.operator_field(p_business_id, 'credit_note', rec_id, 'approved_by_member_id', rec ->> 'approvedByMemberId', 'manager');
    update public.credit_notes set operator_member_id = op, approved_by_member_id = ap where id = rec_id and business_id = p_business_id;

  elsif p_entity = 'stock' then
    rec := p_payload -> 'movement';
    rec_id := (rec ->> 'id')::uuid;
    if not exists (select 1 from public.stock_movements where id = rec_id and business_id = p_business_id and operator_member_id is null and approved_by_member_id is null) then
      return;
    end if;
    op := public.operator_field(p_business_id, 'stock_movement', rec_id, 'operator_member_id', rec ->> 'operatorMemberId', 'cashier');
    ap := public.operator_field(p_business_id, 'stock_movement', rec_id, 'approved_by_member_id', rec ->> 'approvedByMemberId', 'manager');
    update public.stock_movements set operator_member_id = op, approved_by_member_id = ap where id = rec_id and business_id = p_business_id;

  elsif p_entity = 'register' and p_payload ->> 'action' = 'adjustment' then
    rec := p_payload -> 'adjustment';
    rec_id := (rec ->> 'id')::uuid;
    if not exists (select 1 from public.cash_movements where id = rec_id and business_id = p_business_id and operator_member_id is null and approved_by_member_id is null) then
      return;
    end if;
    op := public.operator_field(p_business_id, 'cash_movement', rec_id, 'operator_member_id', rec ->> 'operatorMemberId', 'cashier');
    ap := public.operator_field(p_business_id, 'cash_movement', rec_id, 'approved_by_member_id', rec ->> 'approvedByMemberId', 'manager');
    update public.cash_movements set operator_member_id = op, approved_by_member_id = ap where id = rec_id and business_id = p_business_id;

  elsif p_entity = 'register' and p_payload ->> 'action' = 'open' then
    rec := p_payload -> 'register';
    -- The opened session is stored under the operation's entity id (apply_register_sync).
    rec_id := p_entity_id;
    if not exists (select 1 from public.register_sessions where id = rec_id and business_id = p_business_id and opened_operator_member_id is null and opened_approved_by_member_id is null) then
      return;
    end if;
    op := public.operator_field(p_business_id, 'register_session', rec_id, 'opened_operator_member_id', rec ->> 'openedOperatorMemberId', 'cashier');
    ap := public.operator_field(p_business_id, 'register_session', rec_id, 'opened_approved_by_member_id', rec ->> 'openedApprovedByMemberId', 'manager');
    update public.register_sessions set opened_operator_member_id = op, opened_approved_by_member_id = ap where id = rec_id and business_id = p_business_id;

  elsif p_entity = 'register' and p_payload ->> 'action' = 'close' then
    rec := p_payload -> 'register';
    rec_id := (rec ->> 'id')::uuid;
    if not exists (select 1 from public.register_sessions where id = rec_id and business_id = p_business_id and closed_operator_member_id is null and closed_approved_by_member_id is null) then
      return;
    end if;
    op := public.operator_field(p_business_id, 'register_session', rec_id, 'closed_operator_member_id', rec ->> 'closedOperatorMemberId', 'cashier');
    ap := public.operator_field(p_business_id, 'register_session', rec_id, 'closed_approved_by_member_id', rec ->> 'closedApprovedByMemberId', 'manager');
    update public.register_sessions set closed_operator_member_id = op, closed_approved_by_member_id = ap where id = rec_id and business_id = p_business_id;
  end if;
end
$$;

revoke execute on function public.apply_operator_sync(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.apply_operator_sync(uuid, text, uuid, jsonb) to authenticated;
