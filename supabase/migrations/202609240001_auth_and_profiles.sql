-- MEAH authentication and personnel access foundation.
-- Run through Supabase CLI migrations or the Supabase SQL Editor before enabling app login.

create type public.profile_role as enum (
  'administrator',
  'administrative_staff',
  'fulfillment_staff',
  'delivery_staff'
);

create type public.account_status as enum ('active', 'inactive');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text not null,
  role public.profile_role not null default 'administrative_staff',
  status public.account_status not null default 'inactive',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_email_lowercase_key on public.profiles (lower(email));

-- This function is security definer to avoid recursive RLS evaluation when an
-- administrator policy checks the caller's profile. It is only executable by
-- authenticated Supabase users.
create function public.is_active_administrator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'administrator'
      and status = 'active'
  );
$$;

revoke all on function public.is_active_administrator() from public;
grant execute on function public.is_active_administrator() to authenticated;

-- Profile rows are created only by an auth.users trigger. New personnel remain
-- inactive until an administrator explicitly activates them.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    lower(new.email)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

alter table public.profiles enable row level security;

revoke all on table public.profiles from anon;
revoke all on table public.profiles from authenticated;
grant select, update on table public.profiles to authenticated;

-- A signed-in employee can read only their own profile. Administrators may
-- read all personnel records for the user-management screen.
create policy "profiles_select_self_or_administrator"
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_active_administrator());

-- Profile fields that affect authorization cannot be changed by ordinary
-- employees. Administrators may update staff roles and active state.
create policy "profiles_update_administrator_only"
  on public.profiles for update to authenticated
  using (public.is_active_administrator())
  with check (public.is_active_administrator());

-- Bootstrap one administrator after creating the first Auth user through the
-- Supabase Dashboard. Replace the email and run once in the SQL Editor:
-- update public.profiles
-- set role = 'administrator', status = 'active'
-- where email = 'admin@your-company.example';

-- Auth users must be provisioned through the Supabase Dashboard or a protected
-- Edge Function. Never call auth.admin.* or use a service-role key from Expo.
