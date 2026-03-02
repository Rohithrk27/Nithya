-- Admin suspension enforcement + control-plane upgrades.
-- Depends on: 2026-03-15_core_admin_community.sql
-- Depends on: 2026-03-15_task_punishment_and_leaderboard.sql

create extension if not exists pgcrypto;
set search_path = public, extensions;

-- =========================================================
-- PROFILE ROLE + SUSPENSION COLUMNS
-- =========================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user',
  is_suspended boolean not null default false,
  suspension_reason text,
  suspended_until timestamptz,
  created_at timestamptz not null default now()
);

alter table if exists public.profiles
  add column if not exists role text default 'user',
  add column if not exists is_suspended boolean default false,
  add column if not exists suspension_reason text,
  add column if not exists suspended_until timestamptz,
  add column if not exists created_at timestamptz default now();

do $$
begin
  if to_regclass('public.profiles') is null then
    return;
  end if;

  update public.profiles
  set role = case when lower(trim(coalesce(role, ''))) = 'admin' then 'admin' else 'user' end
  where role is null or trim(role) = '' or lower(trim(role)) not in ('user', 'admin');

  update public.profiles set is_suspended = false where is_suspended is null;
  update public.profiles set created_at = now() where created_at is null;

  alter table public.profiles
    alter column role set default 'user',
    alter column role set not null,
    alter column is_suspended set default false,
    alter column is_suspended set not null,
    alter column created_at set default now(),
    alter column created_at set not null;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_role_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_role_check
      check (lower(role) in ('user', 'admin'));
  end if;
end $$;

create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists profiles_suspension_idx on public.profiles (is_suspended, suspended_until);

alter table if exists public.admin_users
  add column if not exists linked_profile_id uuid references auth.users(id) on delete set null;

do $$
begin
  if to_regclass('public.admin_users') is null then
    return;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'admin_users_linked_profile_id_key'
      and conrelid = 'public.admin_users'::regclass
  ) then
    alter table public.admin_users
      add constraint admin_users_linked_profile_id_key unique (linked_profile_id);
  end if;
end $$;

-- =========================================================
-- SUSPENSION HELPERS
-- =========================================================

create or replace function public.auth_is_admin()
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role, 'user')) = 'admin'
  );
$$;

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
begin
  if v_uid is null then
    return false;
  end if;

  select lower(coalesce(role, 'user')), coalesce(is_suspended, false), suspended_until
  into v_role, v_is_suspended, v_until
  from public.profiles
  where id = v_uid
  limit 1;

  if v_role = 'admin' then
    return true;
  end if;

  if v_is_suspended and (v_until is null or v_until > now()) then
    return false;
  end if;

  return true;
end;
$$;

create or replace function public.protect_profile_admin_fields()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text := 'user';
begin
  new.role := lower(coalesce(nullif(trim(new.role), ''), 'user'));
  if new.role not in ('user', 'admin') then
    new.role := 'user';
  end if;
  new.is_suspended := coalesce(new.is_suspended, false);
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
  else
    new.created_at := coalesce(new.created_at, old.created_at, now());
  end if;

  if current_setting('nithya.allow_profile_admin_field_write', true) = '1' then
    return new;
  end if;

  if v_actor_id is null then
    return new;
  end if;

  select lower(coalesce(role, 'user'))
  into v_actor_role
  from public.profiles
  where id = v_actor_id
  limit 1;

  if coalesce(v_actor_role, 'user') = 'admin' then
    return new;
  end if;

  if new.id is distinct from v_actor_id then
    raise exception 'forbidden_profile_write';
  end if;

  if tg_op = 'INSERT' then
    new.role := 'user';
    new.is_suspended := false;
    new.suspension_reason := null;
    new.suspended_until := null;
    return new;
  end if;

  if old.role is distinct from new.role
     or old.is_suspended is distinct from new.is_suspended
     or old.suspension_reason is distinct from new.suspension_reason
     or old.suspended_until is distinct from new.suspended_until then
    raise exception 'forbidden_profile_admin_fields';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_profile_admin_fields on public.profiles;
create trigger trg_protect_profile_admin_fields
before insert or update on public.profiles
for each row
execute function public.protect_profile_admin_fields();

create or replace function public.resolve_own_profile_status()
returns table(
  user_id uuid,
  role text,
  is_suspended boolean,
  suspension_reason text,
  suspended_until timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles%rowtype;
begin
  if v_uid is null then
    raise exception 'forbidden';
  end if;

  select *
  into v_profile
  from public.profiles
  where id = v_uid
  for update;

  if not found then
    return query
    select v_uid::uuid, 'user'::text, false::boolean, null::text, null::timestamptz;
    return;
  end if;

  if coalesce(v_profile.is_suspended, false)
     and v_profile.suspended_until is not null
     and v_profile.suspended_until <= now() then
    perform set_config('nithya.allow_profile_admin_field_write', '1', true);
    update public.profiles
    set
      is_suspended = false,
      suspension_reason = null,
      suspended_until = null
    where id = v_uid;

    select *
    into v_profile
    from public.profiles
    where id = v_uid
    limit 1;
  end if;

  return query
  select
    v_uid::uuid,
    lower(coalesce(v_profile.role, 'user'))::text,
    coalesce(v_profile.is_suspended, false)::boolean,
    v_profile.suspension_reason::text,
    v_profile.suspended_until::timestamptz;
end;
$$;

grant execute on function public.resolve_own_profile_status() to authenticated;

do $$
declare
  v_table text;
  v_tables text[] := array[
    'profiles',
    'stats',
    'habits',
    'habit_logs',
    'habit_subtasks',
    'user_quests',
    'daily_challenges',
    'punishments',
    'interruptions',
    'friend_requests',
    'friends',
    'community_submissions',
    'web_push_subscriptions',
    'payment_verification_requests',
    'dungeon_parties',
    'dungeon_party_members',
    'dungeon_party_invites',
    'public_profiles'
  ];
begin
  foreach v_table in array v_tables loop
    if to_regclass('public.' || v_table) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', v_table);
    execute format('drop policy if exists susp_write_insert on public.%I', v_table);
    execute format('drop policy if exists susp_write_update on public.%I', v_table);
    execute format('drop policy if exists susp_write_delete on public.%I', v_table);

    execute format(
      'create policy susp_write_insert on public.%I as restrictive for insert to authenticated with check (public.auth_can_write())',
      v_table
    );
    execute format(
      'create policy susp_write_update on public.%I as restrictive for update to authenticated using (public.auth_can_write()) with check (public.auth_can_write())',
      v_table
    );
    execute format(
      'create policy susp_write_delete on public.%I as restrictive for delete to authenticated using (public.auth_can_write())',
      v_table
    );
  end loop;
end $$;

-- =========================================================
-- SYSTEM CONTROLS + ADMIN RPCS
-- =========================================================

create table if not exists public.system_controls (
  key text primary key,
  enabled boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by_admin_id uuid references public.admin_users(id) on delete set null
);

insert into public.system_controls (key, enabled, payload)
values
  ('announcements_enabled', true, '{}'::jsonb),
  ('maintenance_mode', false, '{}'::jsonb),
  ('double_xp_mode', false, '{}'::jsonb)
on conflict (key) do nothing;

alter table public.system_controls enable row level security;
drop policy if exists system_controls_select_all on public.system_controls;
create policy system_controls_select_all on public.system_controls for select using (true);

create or replace function public.award_xp_with_controls(
  p_user_id uuid,
  p_xp_amount integer,
  p_source text default 'manual',
  p_event_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table(
  total_xp bigint,
  current_xp bigint,
  level integer,
  stat_points integer,
  daily_streak integer,
  last_active_date date,
  shadow_debt_xp integer,
  debt_repaid integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount integer := greatest(0, coalesce(p_xp_amount, 0));
  v_double_xp boolean := false;
begin
  select coalesce(sc.enabled, false)
  into v_double_xp
  from public.system_controls sc
  where sc.key = 'double_xp_mode'
  limit 1;

  if v_double_xp and v_amount > 0 then
    v_amount := v_amount * 2;
  end if;

  return query
  select *
  from public.award_xp(
    p_user_id,
    v_amount,
    p_source,
    p_event_id,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('double_xp_mode', v_double_xp)
  );
end;
$$;

create or replace function public.get_system_controls_public()
returns table(key text, enabled boolean, payload jsonb, updated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select sc.key::text, sc.enabled::boolean, sc.payload::jsonb, sc.updated_at::timestamptz
  from public.system_controls sc
  where sc.key in ('announcements_enabled', 'maintenance_mode', 'double_xp_mode')
  order by sc.key;
$$;

grant execute on function public.get_system_controls_public() to authenticated;

do $$
begin
  if to_regclass('public.announcements') is null then
    return;
  end if;

  drop policy if exists announcements_select_active on public.announcements;
  create policy announcements_select_active
  on public.announcements
  for select
  using (
    coalesce((
      select sc.enabled
      from public.system_controls sc
      where sc.key = 'announcements_enabled'
      limit 1
    ), true)
    and active = true
    and (expires_at is null or expires_at > now())
  );
end $$;

create or replace function public.admin_set_user_suspension(
  p_session_token uuid,
  p_user_id uuid,
  p_suspended boolean,
  p_reason text default null,
  p_suspended_until timestamptz default null,
  p_revoke_auth_sessions boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_suspended boolean := coalesce(p_suspended, false);
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select ras.admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token) ras
  limit 1;

  if v_suspended and p_suspended_until is not null and p_suspended_until <= now() then
    raise exception 'invalid_suspended_until';
  end if;

  insert into public.profiles (id, role, is_suspended, created_at)
  values (p_user_id, 'user', false, now())
  on conflict (id) do nothing;

  update public.profiles
  set
    is_suspended = v_suspended,
    suspension_reason = case when v_suspended then v_reason else null end,
    suspended_until = case when v_suspended then p_suspended_until else null end
  where id = p_user_id;

  if not found then
    return false;
  end if;

  if v_suspended and coalesce(p_revoke_auth_sessions, true) then
    begin
      execute 'update auth.sessions set not_after = now() where user_id = $1 and (not_after is null or not_after > now())'
      using p_user_id;
    exception
      when undefined_table or undefined_column or insufficient_privilege then
        null;
    end;
  end if;

  perform public.write_admin_audit(
    v_admin_id,
    'admin_set_user_suspension',
    p_user_id,
    jsonb_build_object(
      'is_suspended', v_suspended,
      'reason', v_reason,
      'suspended_until', p_suspended_until,
      'revoke_auth_sessions', coalesce(p_revoke_auth_sessions, true)
    )
  );

  perform public.log_activity_event(
    p_user_id,
    case when v_suspended then 'user_suspended' else 'user_unsuspended' end,
    jsonb_build_object('reason', v_reason, 'suspended_until', p_suspended_until, 'admin_user_id', v_admin_id)
  );

  return true;
end;
$$;

create or replace function public.admin_list_users_detailed(
  p_session_token uuid,
  p_limit integer default 200
)
returns table(
  user_id uuid,
  name text,
  email text,
  total_xp bigint,
  level integer,
  daily_streak integer,
  relic_count integer,
  completed_habits integer,
  failed_habits integer,
  is_suspended boolean,
  role text,
  suspension_reason text,
  suspended_until timestamptz,
  last_active_date date
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
begin
  select ras.admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token) ras
  limit 1;

  perform public.write_admin_audit(
    v_admin_id,
    'admin_list_users_detailed',
    null,
    jsonb_build_object('limit', greatest(1, least(1000, coalesce(p_limit, 200))))
  );

  return query
  with base as (
    select
      au.id::uuid as user_id,
      coalesce(
        nullif(trim(coalesce(p.name, '')), ''),
        nullif(trim(coalesce(au.raw_user_meta_data->>'name', '')), ''),
        nullif(trim(coalesce(au.raw_user_meta_data->>'full_name', '')), '')
      )::text as user_name,
      au.email::text as email,
      coalesce(p.total_xp, 0)::bigint as total_xp,
      coalesce(p.level, 0)::integer as level,
      coalesce(p.daily_streak, 0)::integer as daily_streak,
      coalesce(p.is_suspended, false)::boolean as is_suspended,
      lower(coalesce(p.role, 'user'))::text as role,
      p.suspension_reason::text as suspension_reason,
      p.suspended_until::timestamptz as suspended_until,
      p.last_active_date::date as last_active_date
    from auth.users au
    left join public.profiles p on p.id = au.id
  )
  select
    b.user_id::uuid,
    coalesce(nullif(trim(coalesce(b.user_name, '')), ''), b.email, b.user_id::text)::text as name,
    b.email::text,
    b.total_xp::bigint,
    b.level::integer,
    b.daily_streak::integer,
    coalesce((
      select count(*)::integer
      from public.discipline_relics dr
      where dr.user_id = b.user_id
        and coalesce(dr.used, false) = false
        and (dr.expires_at is null or dr.expires_at > now())
    ), 0)::integer as relic_count,
    coalesce((
      select count(*)::integer
      from public.habit_logs hl
      where hl.user_id = b.user_id
        and hl.status = 'completed'
    ), 0)::integer as completed_habits,
    coalesce((
      select count(*)::integer
      from public.habit_logs hl
      where hl.user_id = b.user_id
        and (hl.status = 'failed' or coalesce(hl.failed, false) = true)
    ), 0)::integer as failed_habits,
    b.is_suspended::boolean,
    b.role::text,
    b.suspension_reason::text,
    b.suspended_until::timestamptz,
    b.last_active_date::date
  from base b
  order by b.total_xp desc, b.user_id
  limit greatest(1, least(1000, coalesce(p_limit, 200)));
end;
$$;

create or replace function public.admin_set_user_suspension(
  p_session_token uuid,
  p_user_id uuid,
  p_suspended boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.admin_set_user_suspension(p_session_token, p_user_id, p_suspended, null, null, true);
end;
$$;

create or replace function public.admin_reset_user_xp(p_session_token uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
begin
  select ras.admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token) ras
  limit 1;

  update public.profiles
  set total_xp = 0, current_xp = 0, level = 0, stat_points = 0
  where id = p_user_id;

  if not found then
    return false;
  end if;

  perform public.write_admin_audit(v_admin_id, 'admin_reset_user_xp', p_user_id, '{}'::jsonb);
  return true;
end;
$$;

create or replace function public.admin_reset_user_streak(p_session_token uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
begin
  select ras.admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token) ras
  limit 1;

  update public.profiles
  set daily_streak = 0, last_active_date = null
  where id = p_user_id;

  if not found then
    return false;
  end if;

  perform public.write_admin_audit(v_admin_id, 'admin_reset_user_streak', p_user_id, '{}'::jsonb);
  return true;
end;
$$;

create or replace function public.admin_set_user_role(
  p_session_token uuid,
  p_user_id uuid,
  p_role text default 'admin'
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin_id uuid;
  v_role text := lower(trim(coalesce(p_role, 'admin')));
begin
  select ras.admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token) ras
  limit 1;

  if v_role not in ('user', 'admin') then
    raise exception 'invalid_role';
  end if;

  insert into public.profiles (id, role, is_suspended, created_at)
  values (p_user_id, v_role, false, now())
  on conflict (id) do nothing;

  update public.profiles
  set role = v_role
  where id = p_user_id;

  if not found then
    return false;
  end if;

  if v_role = 'admin' then
    insert into public.admin_users (username, password_hash, is_active, linked_profile_id)
    values ('profile:' || p_user_id::text, crypt(gen_random_uuid()::text, gen_salt('bf')), true, p_user_id)
    on conflict (linked_profile_id) do update set is_active = true;
  end if;

  perform public.write_admin_audit(v_admin_id, 'admin_set_user_role', p_user_id, jsonb_build_object('role', v_role));
  return true;
end;
$$;

create or replace function public.admin_issue_session_from_profile(
  p_user_agent text default null
)
returns table(session_token uuid, expires_at timestamptz, username text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_admin_id uuid;
begin
  if v_uid is null then
    raise exception 'forbidden';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = v_uid and lower(coalesce(p.role, 'user')) = 'admin'
  ) then
    raise exception 'forbidden';
  end if;

  insert into public.admin_users (username, password_hash, is_active, linked_profile_id)
  values ('profile:' || v_uid::text, crypt(gen_random_uuid()::text, gen_salt('bf')), true, v_uid)
  on conflict (linked_profile_id) do update set is_active = true
  returning id, admin_users.username into v_admin_id, username;

  insert into public.admin_sessions (admin_user_id, user_agent)
  values (v_admin_id, nullif(trim(coalesce(p_user_agent, '')), ''))
  returning admin_sessions.session_token, admin_sessions.expires_at
  into session_token, expires_at;

  return next;
end;
$$;

create or replace function public.admin_get_dashboard_analytics(
  p_session_token uuid,
  p_days integer default 14
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_days integer := greatest(7, least(90, coalesce(p_days, 14)));
  v_total_users bigint := 0;
  v_active_today bigint := 0;
  v_total_donations numeric(12,2) := 0;
  v_total_xp bigint := 0;
  v_most_active jsonb := '{}'::jsonb;
  v_daily jsonb := '[]'::jsonb;
begin
  select ras.admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token) ras
  limit 1;

  select count(*)::bigint into v_total_users from auth.users;
  select count(*)::bigint into v_active_today from public.profiles where last_active_date = current_date;
  if to_regclass('public.payment_verification_requests') is not null then
    select coalesce(sum(amount_inr), 0)::numeric(12,2) into v_total_donations
    from public.payment_verification_requests
    where status = 'verified';
  end if;
  if to_regclass('public.xp_logs') is not null then
    select coalesce(sum(case when coalesce(xp_change, change_amount, 0) > 0 then coalesce(xp_change, change_amount, 0) else 0 end), 0)::bigint
    into v_total_xp
    from public.xp_logs;
  end if;

  if to_regclass('public.activity_logs') is not null then
    with ranked as (
      select al.user_id, count(*)::bigint as event_count
      from public.activity_logs al
      where al.user_id is not null
        and al.created_at >= now() - interval '7 days'
      group by al.user_id
      order by count(*) desc, al.user_id
      limit 1
    )
    select coalesce(
      jsonb_build_object(
        'user_id', r.user_id,
        'name', coalesce(nullif(trim(coalesce(p.name, '')), ''), au.email, r.user_id::text),
        'event_count', r.event_count
      ),
      '{}'::jsonb
    )
    into v_most_active
    from ranked r
    left join public.profiles p on p.id = r.user_id
    left join auth.users au on au.id = r.user_id;

    with bounds as (
      select (current_date - (v_days - 1))::date as start_day, current_date::date as end_day
    ),
    days as (
      select generate_series((select start_day from bounds), (select end_day from bounds), interval '1 day')::date as day
    ),
    counts as (
      select (al.created_at at time zone 'utc')::date as day, count(*)::bigint as c
      from public.activity_logs al
      where (al.created_at at time zone 'utc')::date >= (select start_day from bounds)
      group by 1
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object('date', d.day, 'count', coalesce(c.c, 0))
        order by d.day
      ),
      '[]'::jsonb
    )
    into v_daily
    from days d
    left join counts c on c.day = d.day;
  end if;

  perform public.write_admin_audit(v_admin_id, 'admin_get_dashboard_analytics', null, jsonb_build_object('days', v_days));

  return jsonb_build_object(
    'total_users', coalesce(v_total_users, 0),
    'active_today', coalesce(v_active_today, 0),
    'total_donations', coalesce(v_total_donations, 0),
    'total_xp_distributed', coalesce(v_total_xp, 0),
    'most_active_user', coalesce(v_most_active, '{}'::jsonb),
    'daily_activity', coalesce(v_daily, '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_get_system_controls(p_session_token uuid)
returns table(key text, enabled boolean, payload jsonb, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1 from public.require_admin_session(p_session_token) limit 1;
  return query
  select sc.key::text, sc.enabled::boolean, sc.payload::jsonb, sc.updated_at::timestamptz
  from public.system_controls sc
  where sc.key in ('announcements_enabled', 'maintenance_mode', 'double_xp_mode')
  order by sc.key;
end;
$$;

create or replace function public.admin_set_system_control(
  p_session_token uuid,
  p_key text,
  p_enabled boolean,
  p_payload jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_key text := lower(trim(coalesce(p_key, '')));
begin
  select ras.admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token) ras
  limit 1;

  if v_key not in ('announcements_enabled', 'maintenance_mode', 'double_xp_mode') then
    raise exception 'invalid_system_control';
  end if;

  insert into public.system_controls (key, enabled, payload, updated_by_admin_id)
  values (v_key, coalesce(p_enabled, false), coalesce(p_payload, '{}'::jsonb), v_admin_id)
  on conflict (key) do update
    set enabled = excluded.enabled, payload = excluded.payload, updated_by_admin_id = v_admin_id, updated_at = now();

  perform public.write_admin_audit(v_admin_id, 'admin_set_system_control', null, jsonb_build_object('key', v_key, 'enabled', p_enabled));
  return true;
end;
$$;

create or replace function public.admin_trigger_daily_quest_reset(
  p_session_token uuid,
  p_target_date date default current_date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_rows integer := 0;
begin
  select ras.admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token) ras
  limit 1;

  if to_regclass('public.daily_challenges') is not null then
    update public.daily_challenges
    set completed = false
    where date = coalesce(p_target_date, current_date);
    get diagnostics v_rows = row_count;
  end if;

  perform public.write_admin_audit(v_admin_id, 'admin_trigger_daily_quest_reset', null, jsonb_build_object('rows', v_rows, 'target_date', p_target_date));
  return v_rows;
end;
$$;

grant execute on function public.admin_set_user_suspension(uuid, uuid, boolean) to anon, authenticated;
grant execute on function public.admin_set_user_suspension(uuid, uuid, boolean, text, timestamptz, boolean) to anon, authenticated;
grant execute on function public.admin_list_users_detailed(uuid, integer) to anon, authenticated;
grant execute on function public.admin_reset_user_xp(uuid, uuid) to anon, authenticated;
grant execute on function public.admin_reset_user_streak(uuid, uuid) to anon, authenticated;
grant execute on function public.admin_set_user_role(uuid, uuid, text) to anon, authenticated;
grant execute on function public.admin_issue_session_from_profile(text) to authenticated;
grant execute on function public.admin_get_dashboard_analytics(uuid, integer) to anon, authenticated;
grant execute on function public.admin_get_system_controls(uuid) to anon, authenticated;
grant execute on function public.admin_set_system_control(uuid, text, boolean, jsonb) to anon, authenticated;
grant execute on function public.admin_trigger_daily_quest_reset(uuid, date) to anon, authenticated;
grant execute on function public.award_xp_with_controls(uuid, integer, text, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
