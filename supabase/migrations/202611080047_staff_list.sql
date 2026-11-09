-- Stage 2A: PIN hashes are readable only through staff_list(), which only the owner may call.
-- Row security lets every member read their team (202610110010), so the hash columns are withheld from the
-- table grant instead; everything else stays readable as before. Spec 2026-11-08-stage-2a §4.5.

revoke select on public.business_members from anon, authenticated;
grant select (id, business_id, user_id, role, status, created_at, display_name, pin_set_at) on public.business_members to authenticated;

-- The till's staff list, with hashes, for the owner's session. Includes email and last till use for Settings → Staff.
create function public.staff_list(p_business_id uuid)
returns table (
  member_id uuid, user_id uuid, display_name text, email text, role public.member_role, status public.member_status,
  pin_hash text, pin_salt text, pin_set_at timestamptz, last_sale_at timestamptz
)
language plpgsql stable security definer set search_path = public, extensions, pg_temp
as $$
begin
  perform public.staff_require_owner(p_business_id);
  return query
  select m.id, m.user_id, m.display_name, u.email::text, m.role, m.status, m.pin_hash, m.pin_salt, m.pin_set_at,
         (select max(s.created_at) from public.sales s where s.business_id = p_business_id and s.operator_member_id = m.id)
  from public.business_members m
  join auth.users u on u.id = m.user_id
  where m.business_id = p_business_id
  order by (m.role = 'owner') desc, m.created_at, m.id;
end
$$;

revoke execute on function public.staff_list(uuid) from public, anon;
grant execute on function public.staff_list(uuid) to authenticated;
