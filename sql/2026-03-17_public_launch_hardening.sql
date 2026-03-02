-- Public launch hardening.
-- Depends on: 2026-03-16_admin_suspension_enforcement_and_controls.sql
-- Depends on: 2026-03-16_admin_login_username_ambiguity_fix.sql

set search_path = public, extensions;

-- =========================================================
-- CRITICAL ADMIN HARDENING
-- =========================================================

-- Disable the known seeded default admin password if it is still unchanged.
do $$
begin
  if to_regclass('public.admin_users') is null then
    return;
  end if;

  update public.admin_users
  set
    is_active = false,
    updated_at = now()
  where username = 'admin'
    and is_active = true
    and password_hash is not null
    and crypt('nithya1811', password_hash) = password_hash;
end;
$$;

create table if not exists public.admin_login_attempts (
  id bigserial primary key,
  username text not null,
  success boolean not null default false,
  attempted_at timestamptz not null default now()
);

create index if not exists admin_login_attempts_username_attempted_idx
  on public.admin_login_attempts (username, attempted_at desc);

alter table public.admin_login_attempts enable row level security;

create or replace function public.admin_login(
  p_username text,
  p_password text,
  p_user_agent text default null
)
returns table(
  session_token uuid,
  expires_at timestamptz,
  username text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin public.admin_users%rowtype;
  v_session public.admin_sessions%rowtype;
  v_username text := lower(trim(coalesce(p_username, '')));
  v_recent_failures integer := 0;
begin
  if v_username = '' then
    raise exception 'invalid_admin_credentials';
  end if;

  select count(*)::integer
  into v_recent_failures
  from public.admin_login_attempts a
  where a.username = v_username
    and a.success = false
    and a.attempted_at > now() - interval '15 minutes';

  if v_recent_failures >= 8 then
    raise exception 'admin_login_rate_limited';
  end if;

  select *
  into v_admin
  from public.admin_users au
  where au.username = v_username
    and au.is_active = true
  limit 1;

  if not found then
    insert into public.admin_login_attempts (username, success)
    values (v_username, false);
    raise exception 'invalid_admin_credentials';
  end if;

  if v_admin.password_hash is null
     or crypt(coalesce(p_password, ''), v_admin.password_hash) <> v_admin.password_hash then
    insert into public.admin_login_attempts (username, success)
    values (v_username, false);
    raise exception 'invalid_admin_credentials';
  end if;

  insert into public.admin_login_attempts (username, success)
  values (v_username, true);

  insert into public.admin_sessions (admin_user_id, user_agent)
  values (v_admin.id, nullif(trim(coalesce(p_user_agent, '')), ''))
  returning * into v_session;

  perform public.write_admin_audit(
    v_admin.id,
    'admin_login',
    null,
    jsonb_build_object('username', v_admin.username)
  );

  return query
  select v_session.session_token, v_session.expires_at, v_admin.username;
end;
$$;

grant execute on function public.admin_login(text, text, text) to anon, authenticated;

-- =========================================================
-- PROFILES PRIVACY HARDENING
-- =========================================================

alter table if exists public.profiles enable row level security;

drop policy if exists profiles_select_all on public.profiles;
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles for select
to authenticated
using (auth.uid() = id);

create or replace function public.lookup_profile_by_user_code(
  p_user_code text
)
returns table(
  id uuid,
  name text,
  user_code text,
  total_xp bigint
)
language sql
security definer
set search_path = public
as $$
  select
    p.id::uuid,
    nullif(trim(coalesce(p.name, '')), '')::text as name,
    p.user_code::text,
    coalesce(p.total_xp, 0)::bigint as total_xp
  from public.profiles p
  where auth.uid() is not null
    and p.user_code = upper(trim(coalesce(p_user_code, '')))
  limit 1;
$$;

create or replace function public.get_profiles_basic(
  p_user_ids uuid[]
)
returns table(
  id uuid,
  name text,
  user_code text,
  total_xp bigint
)
language sql
security definer
set search_path = public
as $$
  select
    p.id::uuid,
    nullif(trim(coalesce(p.name, '')), '')::text as name,
    p.user_code::text,
    coalesce(p.total_xp, 0)::bigint as total_xp
  from public.profiles p
  where auth.uid() is not null
    and p.id = any(coalesce(p_user_ids, array[]::uuid[]));
$$;

grant execute on function public.lookup_profile_by_user_code(text) to authenticated;
grant execute on function public.get_profiles_basic(uuid[]) to authenticated;

-- =========================================================
-- MAINTENANCE MODE ENFORCEMENT
-- =========================================================

create or replace function public.auth_can_write()
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := 'user';
  v_is_suspended boolean := false;
  v_until timestamptz;
  v_maintenance_mode boolean := false;
begin
  if v_uid is null then
    return false;
  end if;

  select lower(coalesce(role, 'user')), coalesce(is_suspended, false), suspended_until
  into v_role, v_is_suspended, v_until
  from public.profiles
  where id = v_uid
  limit 1;

  if coalesce(v_role, 'user') = 'admin' then
    return true;
  end if;

  if to_regclass('public.system_controls') is not null then
    select coalesce(sc.enabled, false)
    into v_maintenance_mode
    from public.system_controls sc
    where sc.key = 'maintenance_mode'
    limit 1;
  end if;

  if coalesce(v_maintenance_mode, false) then
    return false;
  end if;

  if v_is_suspended and (v_until is null or v_until > now()) then
    return false;
  end if;

  return true;
end;
$$;

grant execute on function public.get_system_controls_public() to anon, authenticated;

notify pgrst, 'reload schema';
