-- Stage 2A: staff PINs, till lock settings, and who-did-what columns on synced records.
-- PINs are hashed on the device (PBKDF2-SHA256); only hash and salt are stored. Spec 2026-11-08-stage-2a §4.

alter table public.business_members
  add column display_name text,
  add column pin_hash text,
  add column pin_salt text,
  add column pin_set_at timestamptz;

-- A member's display name starts as the part of their email before "@".
create function public.default_member_display_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.display_name is null or btrim(new.display_name) = '' then
    select split_part(u.email, '@', 1) into new.display_name from auth.users u where u.id = new.user_id;
  end if;
  return new;
end;
$$;

revoke execute on function public.default_member_display_name() from public, anon, authenticated;

create trigger business_members_default_display_name
before insert on public.business_members
for each row execute function public.default_member_display_name();

update public.business_members m
set display_name = split_part(u.email, '@', 1)
from auth.users u
where u.id = m.user_id and m.display_name is null;

alter table public.businesses
  add column pin_lock_enabled boolean not null default false,
  add column idle_lock_minutes smallint not null default 5 constraint businesses_idle_lock_minutes_range check (idle_lock_minutes between 1 and 60),
  add column manager_discount_pct smallint not null default 10 constraint businesses_manager_discount_pct_range check (manager_discount_pct between 0 and 100);

-- The person behind the PIN, and the approving manager where one was needed. Null on records made before 2A,
-- with the PIN lock off, or when sync could not verify the person (see 202611080046).
alter table public.sales
  add column operator_member_id uuid references public.business_members(id) on delete restrict,
  add column approved_by_member_id uuid references public.business_members(id) on delete restrict;
alter table public.credit_notes
  add column operator_member_id uuid references public.business_members(id) on delete restrict,
  add column approved_by_member_id uuid references public.business_members(id) on delete restrict;
alter table public.cash_movements
  add column operator_member_id uuid references public.business_members(id) on delete restrict,
  add column approved_by_member_id uuid references public.business_members(id) on delete restrict;
alter table public.stock_movements
  add column operator_member_id uuid references public.business_members(id) on delete restrict,
  add column approved_by_member_id uuid references public.business_members(id) on delete restrict;
alter table public.register_sessions
  add column opened_operator_member_id uuid references public.business_members(id) on delete restrict,
  add column opened_approved_by_member_id uuid references public.business_members(id) on delete restrict,
  add column closed_operator_member_id uuid references public.business_members(id) on delete restrict,
  add column closed_approved_by_member_id uuid references public.business_members(id) on delete restrict;

create index sales_operator_member_idx on public.sales (operator_member_id) where operator_member_id is not null;
