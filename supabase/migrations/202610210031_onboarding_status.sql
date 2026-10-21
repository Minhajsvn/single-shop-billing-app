-- Stage 1G: the three "get ready to sell" facts the owner's checklist strip shows.
create or replace function public.onboarding_status(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if auth.uid() is null or not public.owns_business(p_business_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'hasProduct', exists (select 1 from public.products where business_id = p_business_id),
    'hasOpenedRegister', exists (select 1 from public.register_sessions where business_id = p_business_id),
    'hasSale', exists (select 1 from public.sales where business_id = p_business_id)
  );
end;
$$;

revoke all on function public.onboarding_status(uuid) from public;
grant execute on function public.onboarding_status(uuid) to authenticated;
