create extension if not exists "pgcrypto";

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  parent_id uuid references public.departments(id) on delete set null,
  sort_order integer not null default 0,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  role text not null,
  email text unique,
  department_id uuid references public.departments(id) on delete set null,
  manager_id uuid references public.people(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  department_sort_order integer,
  hierarchy_order integer not null default 99,
  hierarchy_level text,
  rule_applied text,
  source_row text,
  updated_at timestamptz not null default now()
);

create table if not exists public.authorized_users (
  email text primary key,
  is_admin boolean not null default false,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now()
);

create table if not exists public.change_history (
  id uuid primary key default gen_random_uuid(),
  actor text,
  action text not null,
  target text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

alter table public.departments enable row level security;
alter table public.people enable row level security;
alter table public.authorized_users enable row level security;
alter table public.change_history enable row level security;

create or replace function public.current_user_email()
returns text
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.is_epayco_email()
returns boolean
language sql
stable
as $$
  select public.current_user_email() like '%@epayco.com';
$$;

create or replace function public.is_authorized()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_epayco_email()
    or exists (
    select 1
    from public.authorized_users
    where lower(email) = public.current_user_email()
      and status = 'active'
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_email() = 'julian.tobon@epayco.com'
    or exists (
    select 1
    from public.authorized_users
    where lower(email) = public.current_user_email()
      and is_admin = true
      and status = 'active'
  );
$$;

create policy "authorized users read departments"
on public.departments for select
to authenticated
using (public.is_authorized());

create policy "admins write departments"
on public.departments for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "authorized users read people"
on public.people for select
to authenticated
using (public.is_authorized());

create policy "admins write people"
on public.people for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "users read own authorization"
on public.authorized_users for select
to authenticated
using (lower(email) = public.current_user_email() or public.is_admin());

create policy "admins manage authorization"
on public.authorized_users for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "authorized users read history"
on public.change_history for select
to authenticated
using (public.is_authorized());

create policy "admins write history"
on public.change_history for insert
to authenticated
with check (public.is_admin());

create index if not exists people_department_id_idx on public.people(department_id);
create index if not exists people_manager_id_idx on public.people(manager_id);
create index if not exists people_status_idx on public.people(status);
create index if not exists departments_parent_id_idx on public.departments(parent_id);

-- Primer administrador ePayco.
insert into public.authorized_users (email, is_admin)
values ('julian.tobon@epayco.com', true)
on conflict (email) do update set is_admin = excluded.is_admin, status = 'active';
