-- Stage 1A: team members with roles, and explicit branches.

create type public.member_role as enum ('cashier', 'manager', 'owner');
create type public.member_status as enum ('active', 'disabled');

create table public.business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  role public.member_role not null,
  status public.member_status not null default 'active',
  created_at timestamptz not null default now(),
  unique (business_id, user_id)
);

create index business_members_user_idx on public.business_members (user_id) where status = 'active';

create function public.role_rank(target_role public.member_role)
returns integer language sql immutable
as $$ select case target_role when 'owner' then 3 when 'manager' then 2 else 1 end $$;

create function public.has_role(target_business_id uuid, min_role public.member_role)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = target_business_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and public.role_rank(m.role) >= public.role_rank(min_role)
  )
$$;

-- Existing policies and RPCs call owns_business(); keep their meaning (owner only) until Stage 2 adds per-role policies.
create or replace function public.owns_business(target_business_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select public.has_role(target_business_id, 'owner') $$;

insert into public.business_members (business_id, user_id, role)
select id, owner_id, 'owner' from public.businesses
on conflict (business_id, user_id) do nothing;

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 80),
  address text not null default '',
  invoice_prefix text not null check (invoice_prefix ~ '^[A-Z0-9-]{1,8}$'),
  receipt_footer text not null default '',
  is_main boolean not null default false,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  unique (business_id, name),
  unique (id, business_id)
);

create unique index one_main_branch_per_business on public.branches (business_id) where is_main;

insert into public.branches (business_id, name, address, invoice_prefix, receipt_footer, is_main)
select id, 'Main branch', address, invoice_prefix, receipt_footer, true from public.businesses;

-- Rows that omit branch_id inherit it from their device, then their register session, then the main branch.
create function public.assign_default_branch()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  row_data jsonb := to_jsonb(new);
begin
  if new.branch_id is null and row_data->>'device_id' is not null then
    new.branch_id := (select d.branch_id from public.devices d where d.id = (row_data->>'device_id')::uuid);
  end if;
  if new.branch_id is null and row_data->>'register_session_id' is not null then
    new.branch_id := (select r.branch_id from public.register_sessions r where r.id = (row_data->>'register_session_id')::uuid);
  end if;
  if new.branch_id is null then
    new.branch_id := (select b.id from public.branches b where b.business_id = new.business_id and b.is_main);
  end if;
  return new;
end
$$;

do $$
declare
  target text;
begin
  foreach target in array array['devices', 'register_sessions', 'sales', 'stock_movements', 'cash_movements', 'credit_notes'] loop
    execute format('alter table public.%I add column branch_id uuid', target);
    execute format('update public.%I t set branch_id = b.id from public.branches b where b.business_id = t.business_id and b.is_main', target);
    execute format('alter table public.%I alter column branch_id set not null', target);
    execute format('alter table public.%I add constraint %I foreign key (branch_id, business_id) references public.branches (id, business_id) on delete restrict', target, target || '_branch_fk');
    execute format('create index %I on public.%I (branch_id)', target || '_branch_idx', target);
    execute format('create trigger assign_default_branch before insert on public.%I for each row execute function public.assign_default_branch()', target);
  end loop;
end
$$;

-- New businesses get their owner membership and main branch atomically.
create function public.bootstrap_business()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.business_members (business_id, user_id, role) values (new.id, new.owner_id, 'owner');
  insert into public.branches (business_id, name, address, invoice_prefix, receipt_footer, is_main)
  values (new.id, 'Main branch', new.address, new.invoice_prefix, new.receipt_footer, true);
  return new;
end
$$;

create trigger bootstrap_business after insert on public.businesses for each row execute function public.bootstrap_business();

create function public.prevent_owner_change()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception using errcode = 'P0001', message = 'owner_id_immutable';
  end if;
  return new;
end
$$;

create trigger prevent_owner_change before update on public.businesses for each row execute function public.prevent_owner_change();

create function public.prevent_branch_business_change()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.business_id is distinct from old.business_id then
    raise exception using errcode = 'P0001', message = 'branch_business_immutable';
  end if;
  return new;
end
$$;

create trigger prevent_branch_business_change before update on public.branches for each row execute function public.prevent_branch_business_change();

drop policy "owners manage their business" on public.businesses;
create policy "members read their business" on public.businesses for select using (owner_id = auth.uid() or public.has_role(id, 'cashier'));
create policy "users create their own business" on public.businesses for insert with check (owner_id = auth.uid());
create policy "owners update their business" on public.businesses for update using (public.has_role(id, 'owner')) with check (public.has_role(id, 'owner'));

alter table public.business_members enable row level security;
create policy "members read their team" on public.business_members for select using (public.has_role(business_id, 'cashier'));

alter table public.branches enable row level security;
create policy "members read branches" on public.branches for select using (public.has_role(business_id, 'cashier'));
create policy "owners create branches" on public.branches for insert with check (public.has_role(business_id, 'owner'));
create policy "owners update branches" on public.branches for update using (public.has_role(business_id, 'owner')) with check (public.has_role(business_id, 'owner'));
