-- Stage 2A: record the person behind the PIN (and any approving manager) on synced records.
-- Called by the sync route right after an apply_*_sync call succeeds, with the same payload, so the large sync
-- functions stay unchanged. Never rejects or removes a record: an id that fails verification is stored as null
-- and logged as sync.operator_unverified (spec 2026-11-08-stage-2a §4.3). Only fills columns that are still null,
-- so a retried operation changes nothing.

create function public.verified_member(p_business_id uuid, p_member_id uuid, p_min_role public.member_role)
returns uuid language sql stable security definer set search_path = public, extensions, pg_temp
as $$
  select m.id from public.business_members m
  where m.id = p_member_id and m.business_id = p_business_id and m.status = 'active'
    and public.role_rank(m.role) >= public.role_rank(p_min_role)
$$;

create function public.log_operator_unverified(p_business_id uuid, p_entity_type text, p_entity_id uuid, p_field text, p_member_id text)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
begin
  if exists (select 1 from public.audit_events where business_id = p_business_id and action = 'sync.operator_unverified'
             and entity_id = p_entity_id and summary ->> 'field' = p_field) then
    return;
  end if;
  insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, summary)
  values (p_business_id, auth.uid(), 'sync.operator_unverified', p_entity_type, p_entity_id,
          jsonb_build_object('field', p_field, 'memberId', p_member_id));
end
$$;

-- Verify one id from the payload: null in, null out; a valid id comes back; anything else is logged and becomes null.
create function public.operator_field(p_business_id uuid, p_entity_type text, p_entity_id uuid, p_field text, p_value text, p_min_role public.member_role)
returns uuid language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  result uuid;
begin
  if p_value is null or p_value = '' then
    return null;
  end if;
  if p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    result := public.verified_member(p_business_id, p_value::uuid, p_min_role);
  end if;
  if result is null then
    perform public.log_operator_unverified(p_business_id, p_entity_type, p_entity_id, p_field, p_value);
  end if;
  return result;
end
$$;

revoke execute on function public.verified_member(uuid, uuid, public.member_role) from public, anon, authenticated;
revoke execute on function public.log_operator_unverified(uuid, text, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.operator_field(uuid, text, uuid, text, text, public.member_role) from public, anon, authenticated;

create function public.apply_operator_sync(p_business_id uuid, p_entity text, p_payload jsonb)
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
    rec_id := (rec ->> 'id')::uuid;
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

revoke execute on function public.apply_operator_sync(uuid, text, jsonb) from public, anon;
grant execute on function public.apply_operator_sync(uuid, text, jsonb) to authenticated;
