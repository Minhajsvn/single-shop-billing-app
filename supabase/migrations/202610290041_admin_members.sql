-- Stage 1I: member management for platform staff. Service role only; the staff check lives in the app and these
-- functions trust p_actor. Staff may add members and set their role (cashier or manager) and status. The shop owner's
-- own member row is never changed here. The member limit is enforced by the existing business_members_plan_limit trigger.

-- Find the account for an email so the app can add it as a member. Returns {"userId": uuid|null}; null means no account
-- yet (the app then sends an invite). An account that has not confirmed its email still counts as existing.
-- Refuses early when the account could not be added: already a member here, active in another shop, or the shop is full.
create function public.admin_member_lookup(p_business_id uuid, p_email text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  found_id uuid;
  limit_value jsonb;
begin
  perform 1 from public.businesses where id = p_business_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'shop_not_found';
  end if;

  select u.id into found_id from auth.users u where lower(btrim(u.email)) = lower(btrim(coalesce(p_email, ''))) limit 1;

  if found_id is not null then
    if exists (select 1 from public.business_members where business_id = p_business_id and user_id = found_id) then
      raise exception using errcode = 'P0001', message = 'already_member';
    end if;
    if exists (select 1 from public.business_members where user_id = found_id and business_id <> p_business_id and status = 'active') then
      raise exception using errcode = 'P0001', message = 'member_of_other_shop';
    end if;
  end if;

  limit_value := public.entitlements_internal(p_business_id) -> 'limits' -> 'members';
  if limit_value is not null and jsonb_typeof(limit_value) <> 'null'
     and (select count(*) from public.business_members where business_id = p_business_id and status = 'active') >= limit_value::integer then
    raise exception using errcode = 'P0001', message = 'plan_limit_reached';
  end if;

  return jsonb_build_object('userId', found_id);
end
$$;

create function public.admin_add_member(p_business_id uuid, p_user_id uuid, p_role public.member_role, p_actor uuid, p_note text)
returns uuid language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  clean_note text := public.admin_clean_note(p_note);
  new_id uuid;
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
  insert into public.business_members (business_id, user_id, role, status)
  values (p_business_id, p_user_id, p_role, 'active')
  returning id into new_id;

  insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, summary)
  values (p_business_id, p_actor, 'admin.add_member', 'business_member', new_id, jsonb_build_object(
    'before', jsonb_build_object('role', null, 'status', null),
    'after', jsonb_build_object('role', p_role, 'status', 'active', 'userId', p_user_id),
    'note', clean_note));

  return new_id;
end
$$;

create function public.admin_set_member_role(p_member_id uuid, p_role public.member_role, p_actor uuid, p_note text)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  clean_note text := public.admin_clean_note(p_note);
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
  values (member.business_id, p_actor, 'admin.set_member_role', 'business_member', p_member_id, jsonb_build_object(
    'before', jsonb_build_object('role', member.role),
    'after', jsonb_build_object('role', p_role),
    'note', clean_note));
end
$$;

-- Disable or re-enable. Re-enabling counts against the member limit (trigger), so a full shop refuses it.
create function public.admin_set_member_status(p_member_id uuid, p_status public.member_status, p_actor uuid, p_note text)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  clean_note text := public.admin_clean_note(p_note);
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
  values (member.business_id, p_actor, 'admin.set_member_status', 'business_member', p_member_id, jsonb_build_object(
    'before', jsonb_build_object('status', member.status),
    'after', jsonb_build_object('status', p_status),
    'note', clean_note));
end
$$;

-- The app sends the reset email through Supabase Auth; this records that staff did it. Audit only.
create function public.admin_log_password_reset(p_member_id uuid, p_actor uuid, p_note text)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  clean_note text := public.admin_clean_note(p_note);
  member public.business_members;
begin
  select * into member from public.business_members where id = p_member_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'member_not_found';
  end if;

  insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, summary)
  values (member.business_id, p_actor, 'admin.send_password_reset', 'business_member', p_member_id, jsonb_build_object(
    'before', jsonb_build_object('userId', member.user_id),
    'after', jsonb_build_object('userId', member.user_id),
    'note', clean_note));
end
$$;

revoke execute on function public.admin_member_lookup(uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_add_member(uuid, uuid, public.member_role, uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_set_member_role(uuid, public.member_role, uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_set_member_status(uuid, public.member_status, uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_log_password_reset(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_member_lookup(uuid, text) to service_role;
grant execute on function public.admin_add_member(uuid, uuid, public.member_role, uuid, text) to service_role;
grant execute on function public.admin_set_member_role(uuid, public.member_role, uuid, text) to service_role;
grant execute on function public.admin_set_member_status(uuid, public.member_status, uuid, text) to service_role;
grant execute on function public.admin_log_password_reset(uuid, uuid, text) to service_role;
