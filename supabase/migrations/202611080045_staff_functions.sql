-- Stage 2A: owner-run staff management, sharing one set of rules with the Stage 1I admin console.
-- The admin_* functions (service role, trust p_actor) and the new staff_* functions (owner's own session,
-- actor = auth.uid()) both call the *_internal functions below, so the rules and the audit rows match.
-- Spec 2026-11-08-stage-2a §4.4.

-- Shared rules ------------------------------------------------------------------------------------------------

create function public.member_add_internal(p_business_id uuid, p_user_id uuid, p_role public.member_role, p_display_name text, p_actor uuid, p_action text, p_note text)
returns uuid language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  new_id uuid;
  clean_name text := nullif(left(btrim(coalesce(p_display_name, '')), 60), '');
begin
  perform 1 from public.businesses where id = p_business_id for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'shop_not_found';
  end if;
  if p_role not in ('cashier', 'manager') then
    raise exception using errcode = 'P0001', message = 'role_not_allowed';
  end if;
  if exists (select 1 from public.business_members where business_id = p_business_id and user_id = p_user_id) then
    raise exception using errcode = 'P0001', message = 'already_member';
  end if;
  if exists (select 1 from public.business_members where user_id = p_user_id and business_id <> p_business_id and status = 'active') then
    raise exception using errcode = 'P0001', message = 'member_of_other_shop';
  end if;

  -- The plan limit trigger raises plan_limit_reached here when the shop is full.
  insert into public.business_members (business_id, user_id, role, status, display_name)
  values (p_business_id, p_user_id, p_role, 'active', clean_name)
  returning id into new_id;

  insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, summary)
  values (p_business_id, p_actor, p_action, 'business_member', new_id, jsonb_build_object(
    'before', jsonb_build_object('role', null, 'status', null),
    'after', jsonb_build_object('role', p_role, 'status', 'active', 'userId', p_user_id),
    'note', p_note));

  return new_id;
end
$$;

create function public.member_set_role_internal(p_member_id uuid, p_role public.member_role, p_actor uuid, p_action text, p_note text)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  member public.business_members;
begin
  select * into member from public.business_members where id = p_member_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'member_not_found';
  end if;
  if member.user_id = (select owner_id from public.businesses where id = member.business_id) then
    raise exception using errcode = 'P0001', message = 'owner_protected';
  end if;
  if p_role not in ('cashier', 'manager') then
    raise exception using errcode = 'P0001', message = 'role_not_allowed';
  end if;

  update public.business_members set role = p_role where id = p_member_id;

  insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, summary)
  values (member.business_id, p_actor, p_action, 'business_member', p_member_id, jsonb_build_object(
    'before', jsonb_build_object('role', member.role),
    'after', jsonb_build_object('role', p_role),
    'note', p_note));
end
$$;

-- Re-enabling counts against the member limit (trigger), so a full shop refuses it.
create function public.member_set_status_internal(p_member_id uuid, p_status public.member_status, p_actor uuid, p_action text, p_note text)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  member public.business_members;
begin
  select * into member from public.business_members where id = p_member_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'member_not_found';
  end if;
  if member.user_id = (select owner_id from public.businesses where id = member.business_id) then
    raise exception using errcode = 'P0001', message = 'owner_protected';
  end if;
  -- One active shop per person: re-enabling here is refused while they are active in another shop.
  if p_status = 'active' and member.status <> 'active'
     and exists (select 1 from public.business_members where user_id = member.user_id and business_id <> member.business_id and status = 'active') then
    raise exception using errcode = 'P0001', message = 'member_of_other_shop';
  end if;

  update public.business_members set status = p_status where id = p_member_id;

  insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, summary)
  values (member.business_id, p_actor, p_action, 'business_member', p_member_id, jsonb_build_object(
    'before', jsonb_build_object('status', member.status),
    'after', jsonb_build_object('status', p_status),
    'note', p_note));
end
$$;

revoke execute on function public.member_add_internal(uuid, uuid, public.member_role, text, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.member_set_role_internal(uuid, public.member_role, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.member_set_status_internal(uuid, public.member_status, uuid, text, text) from public, anon, authenticated;

-- Admin console: same signatures and behaviour as 202610290041, now through the shared rules ------------------

create or replace function public.admin_add_member(p_business_id uuid, p_user_id uuid, p_role public.member_role, p_actor uuid, p_note text)
returns uuid language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
begin
  return public.member_add_internal(p_business_id, p_user_id, p_role, null, p_actor, 'admin.add_member', public.admin_clean_note(p_note));
end
$$;

create or replace function public.admin_set_member_role(p_member_id uuid, p_role public.member_role, p_actor uuid, p_note text)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
begin
  perform public.member_set_role_internal(p_member_id, p_role, p_actor, 'admin.set_member_role', public.admin_clean_note(p_note));
end
$$;

create or replace function public.admin_set_member_status(p_member_id uuid, p_status public.member_status, p_actor uuid, p_note text)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
begin
  perform public.member_set_status_internal(p_member_id, p_status, p_actor, 'admin.set_member_status', public.admin_clean_note(p_note));
end
$$;

-- Owner's own session ------------------------------------------------------------------------------------------

create function public.staff_require_owner(p_business_id uuid)
returns void language plpgsql stable security definer set search_path = public, extensions, pg_temp
as $$
begin
  if auth.uid() is null or not public.owns_business(p_business_id) then
    raise exception using errcode = 'P0001', message = 'not_owner';
  end if;
end
$$;

create function public.staff_member_in_shop(p_business_id uuid, p_member_id uuid)
returns public.business_members language plpgsql stable security definer set search_path = public, extensions, pg_temp
as $$
declare
  member public.business_members;
begin
  select * into member from public.business_members where id = p_member_id and business_id = p_business_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'member_not_found';
  end if;
  return member;
end
$$;

revoke execute on function public.staff_require_owner(uuid) from public, anon, authenticated;
revoke execute on function public.staff_member_in_shop(uuid, uuid) from public, anon, authenticated;

create function public.staff_add_member(p_business_id uuid, p_user_id uuid, p_role public.member_role, p_display_name text)
returns uuid language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
begin
  perform public.staff_require_owner(p_business_id);
  return public.member_add_internal(p_business_id, p_user_id, p_role, p_display_name, auth.uid(), 'staff.add_member', null);
end
$$;

create function public.staff_set_role(p_business_id uuid, p_member_id uuid, p_role public.member_role)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
begin
  perform public.staff_require_owner(p_business_id);
  perform public.staff_member_in_shop(p_business_id, p_member_id);
  perform public.member_set_role_internal(p_member_id, p_role, auth.uid(), 'staff.set_role', null);
end
$$;

create function public.staff_set_status(p_business_id uuid, p_member_id uuid, p_status public.member_status)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
begin
  perform public.staff_require_owner(p_business_id);
  perform public.staff_member_in_shop(p_business_id, p_member_id);
  perform public.member_set_status_internal(p_member_id, p_status, auth.uid(), 'staff.set_status', null);
end
$$;

create function public.staff_reset_pin(p_business_id uuid, p_member_id uuid)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  member public.business_members;
begin
  perform public.staff_require_owner(p_business_id);
  member := public.staff_member_in_shop(p_business_id, p_member_id);
  update public.business_members set pin_hash = null, pin_salt = null, pin_set_at = null where id = p_member_id;
  insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, summary)
  values (p_business_id, auth.uid(), 'staff.reset_pin', 'business_member', p_member_id, jsonb_build_object(
    'before', jsonb_build_object('pinSet', member.pin_hash is not null),
    'after', jsonb_build_object('pinSet', false)));
end
$$;

-- The owner may set any member's PIN (the person types it at the till); a member may set their own.
create function public.staff_set_pin(p_business_id uuid, p_member_id uuid, p_pin_hash text, p_pin_salt text)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  member public.business_members;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'not_owner';
  end if;
  select * into member from public.business_members where id = p_member_id and business_id = p_business_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'member_not_found';
  end if;
  if member.user_id <> auth.uid() and not public.owns_business(p_business_id) then
    raise exception using errcode = 'P0001', message = 'not_owner';
  end if;
  if member.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'member_disabled';
  end if;
  -- base64 of 32 bytes is 44 characters, of 16 bytes is 24.
  if coalesce(p_pin_hash, '') !~ '^[A-Za-z0-9+/]{43}=$' or coalesce(p_pin_salt, '') !~ '^[A-Za-z0-9+/]{22}==$' then
    raise exception using errcode = 'P0001', message = 'invalid_pin_hash';
  end if;

  update public.business_members set pin_hash = p_pin_hash, pin_salt = p_pin_salt, pin_set_at = now() where id = p_member_id;
  insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, summary)
  values (p_business_id, auth.uid(), 'staff.set_pin', 'business_member', p_member_id, jsonb_build_object(
    'before', jsonb_build_object('pinSet', member.pin_hash is not null),
    'after', jsonb_build_object('pinSet', true)));
end
$$;

create function public.shop_set_lock_settings(p_business_id uuid, p_pin_lock_enabled boolean, p_idle_lock_minutes integer, p_manager_discount_pct integer)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  shop public.businesses;
begin
  perform public.staff_require_owner(p_business_id);
  if p_idle_lock_minutes is null or p_idle_lock_minutes not between 1 and 60
     or p_manager_discount_pct is null or p_manager_discount_pct not between 0 and 100 or p_pin_lock_enabled is null then
    raise exception using errcode = 'P0001', message = 'invalid_settings';
  end if;
  if p_pin_lock_enabled then
    if not coalesce(public.entitlements_internal(p_business_id) -> 'features' ? 'staff_roles', false) then
      raise exception using errcode = 'P0001', message = 'feature_not_in_plan';
    end if;
    if not exists (select 1 from public.business_members m join public.businesses b on b.id = m.business_id and b.owner_id = m.user_id
                   where m.business_id = p_business_id and m.pin_hash is not null) then
      raise exception using errcode = 'P0001', message = 'pin_not_set';
    end if;
  end if;

  select * into shop from public.businesses where id = p_business_id for update;
  update public.businesses
  set pin_lock_enabled = p_pin_lock_enabled, idle_lock_minutes = p_idle_lock_minutes, manager_discount_pct = p_manager_discount_pct
  where id = p_business_id;
  insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, summary)
  values (p_business_id, auth.uid(), 'staff.lock_settings', 'business', p_business_id, jsonb_build_object(
    'before', jsonb_build_object('pinLockEnabled', shop.pin_lock_enabled, 'idleLockMinutes', shop.idle_lock_minutes, 'managerDiscountPct', shop.manager_discount_pct),
    'after', jsonb_build_object('pinLockEnabled', p_pin_lock_enabled, 'idleLockMinutes', p_idle_lock_minutes, 'managerDiscountPct', p_manager_discount_pct)));
end
$$;

revoke execute on function public.staff_add_member(uuid, uuid, public.member_role, text) from public, anon;
revoke execute on function public.staff_set_role(uuid, uuid, public.member_role) from public, anon;
revoke execute on function public.staff_set_status(uuid, uuid, public.member_status) from public, anon;
revoke execute on function public.staff_reset_pin(uuid, uuid) from public, anon;
revoke execute on function public.staff_set_pin(uuid, uuid, text, text) from public, anon;
revoke execute on function public.shop_set_lock_settings(uuid, boolean, integer, integer) from public, anon;
grant execute on function public.staff_add_member(uuid, uuid, public.member_role, text) to authenticated;
grant execute on function public.staff_set_role(uuid, uuid, public.member_role) to authenticated;
grant execute on function public.staff_set_status(uuid, uuid, public.member_status) to authenticated;
grant execute on function public.staff_reset_pin(uuid, uuid) to authenticated;
grant execute on function public.staff_set_pin(uuid, uuid, text, text) to authenticated;
grant execute on function public.shop_set_lock_settings(uuid, boolean, integer, integer) to authenticated;
