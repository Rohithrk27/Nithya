create extension if not exists pgcrypto;
set search_path = public, extensions;

-- =========================================================
-- TASK / PROFILE / RELIC COLUMNS
-- =========================================================

alter table if exists public.habits
  add column if not exists description text,
  add column if not exists deadline_at timestamptz,
  add column if not exists punishment_type text not null default 'xp_deduction',
  add column if not exists punishment_value integer not null default 30;

do $$
begin
  if to_regclass('public.habits') is null then
    return;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'habits_punishment_type_check'
      and conrelid = 'public.habits'::regclass
  ) then
    alter table public.habits
      add constraint habits_punishment_type_check
      check (punishment_type in ('xp_deduction', 'streak_reset', 'relic_loss'));
  end if;
end $$;

alter table if exists public.quests
  add column if not exists deadline_at timestamptz,
  add column if not exists punishment_type text not null default 'xp_deduction',
  add column if not exists punishment_value integer not null default 40,
  add column if not exists relic_reward integer not null default 0,
  add column if not exists created_by_admin boolean not null default false;

do $$
begin
  if to_regclass('public.quests') is null then
    return;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'quests_punishment_type_check'
      and conrelid = 'public.quests'::regclass
  ) then
    alter table public.quests
      add constraint quests_punishment_type_check
      check (punishment_type in ('xp_deduction', 'streak_reset', 'relic_loss'));
  end if;
end $$;

alter table if exists public.user_quests
  add column if not exists deadline_at timestamptz,
  add column if not exists punishment_type text,
  add column if not exists punishment_value integer,
  add column if not exists relic_reward integer not null default 0;

alter table if exists public.habit_logs
  add column if not exists failed boolean not null default false;

alter table if exists public.profiles
  add column if not exists is_suspended boolean not null default false;

alter table if exists public.stats
  add column if not exists last_daily_reset date;

create table if not exists public.relic_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  rarity text not null default 'common' check (rarity in ('common', 'rare', 'epic', 'legendary')),
  effect_type text,
  created_at timestamptz not null default now()
);

alter table if exists public.discipline_relics
  add column if not exists relic_type_id uuid references public.relic_types(id) on delete set null,
  add column if not exists rarity text not null default 'rare',
  add column if not exists label text;

do $$
begin
  if to_regclass('public.discipline_relics') is null then
    return;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'discipline_relics_rarity_check'
      and conrelid = 'public.discipline_relics'::regclass
  ) then
    alter table public.discipline_relics
      add constraint discipline_relics_rarity_check
      check (rarity in ('common', 'rare', 'epic', 'legendary'));
  end if;
end $$;

insert into public.relic_types (code, name, description, rarity, effect_type)
values
  ('common_focus', 'Focus Fragment', 'Minor momentum relic.', 'common', 'cheat_day'),
  ('rare_guard', 'Guardian Sigil', 'Reliable defensive relic.', 'rare', 'punishment_waiver'),
  ('epic_phoenix', 'Phoenix Core', 'High-impact recovery relic.', 'epic', 'dungeon_revive'),
  ('legendary_ascendant', 'Ascendant Crown', 'Top-tier relic of mastery.', 'legendary', 'xp_insurance')
on conflict (code) do nothing;

-- =========================================================
-- CORE TABLES
-- =========================================================

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_logs_user_created_idx
  on public.activity_logs (user_id, created_at desc);
create index if not exists activity_logs_type_created_idx
  on public.activity_logs (type, created_at desc);

create table if not exists public.community_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('suggestion', 'feature_request', 'bug_report')),
  message text not null,
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'resolved')),
  admin_reply text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists community_submissions_user_idx
  on public.community_submissions (user_id, created_at desc);
create index if not exists community_submissions_status_idx
  on public.community_submissions (status, created_at desc);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  active boolean not null default true,
  created_by_admin_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists announcements_active_created_idx
  on public.announcements (active, created_at desc);

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.admin_users(id) on delete cascade,
  session_token uuid not null unique default gen_random_uuid(),
  expires_at timestamptz not null default (now() + interval '12 hours'),
  user_agent text,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists admin_sessions_token_idx
  on public.admin_sessions (session_token);
create index if not exists admin_sessions_admin_exp_idx
  on public.admin_sessions (admin_user_id, expires_at desc);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references public.admin_users(id) on delete set null,
  action text not null,
  target_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_idx
  on public.admin_audit_logs (created_at desc);

-- =========================================================
-- TOUCH HELPERS
-- =========================================================

create or replace function public.touch_generic_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_community_submissions_updated_at on public.community_submissions;
create trigger trg_touch_community_submissions_updated_at
before update on public.community_submissions
for each row
execute function public.touch_generic_updated_at();

drop trigger if exists trg_touch_admin_users_updated_at on public.admin_users;
create trigger trg_touch_admin_users_updated_at
before update on public.admin_users
for each row
execute function public.touch_generic_updated_at();

-- =========================================================
-- RLS
-- =========================================================

alter table public.activity_logs enable row level security;
alter table public.community_submissions enable row level security;
alter table public.announcements enable row level security;
alter table public.relic_types enable row level security;
alter table public.admin_users enable row level security;
alter table public.admin_sessions enable row level security;
alter table public.admin_audit_logs enable row level security;

drop policy if exists activity_logs_select_own on public.activity_logs;
create policy activity_logs_select_own
on public.activity_logs
for select
using (auth.uid() = user_id);

drop policy if exists activity_logs_insert_own on public.activity_logs;
create policy activity_logs_insert_own
on public.activity_logs
for insert
with check (auth.uid() = user_id);

drop policy if exists community_submissions_select_own on public.community_submissions;
create policy community_submissions_select_own
on public.community_submissions
for select
using (auth.uid() = user_id);

drop policy if exists community_submissions_insert_own on public.community_submissions;
create policy community_submissions_insert_own
on public.community_submissions
for insert
with check (auth.uid() = user_id);

drop policy if exists community_submissions_update_own on public.community_submissions;
create policy community_submissions_update_own
on public.community_submissions
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists announcements_select_active on public.announcements;
create policy announcements_select_active
on public.announcements
for select
using (active = true and (expires_at is null or expires_at > now()));

drop policy if exists relic_types_select_all on public.relic_types;
create policy relic_types_select_all
on public.relic_types
for select
using (true);

-- =========================================================
-- ACTIVITY + ADMIN HELPER FUNCTIONS
-- =========================================================

create or replace function public.log_activity_event(
  p_user_id uuid,
  p_type text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
begin
  insert into public.activity_logs (user_id, type, metadata)
  values (p_user_id, coalesce(nullif(trim(p_type), ''), 'unknown'), coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.require_admin_session(
  p_session_token uuid
)
returns table(
  admin_user_id uuid,
  admin_username text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select s.admin_user_id::uuid, u.username::text
  from public.admin_sessions s
  join public.admin_users u on u.id = s.admin_user_id
  where s.session_token = p_session_token
    and s.revoked_at is null
    and s.expires_at > now()
    and u.is_active = true
  limit 1;

  if not found then
    raise exception 'invalid_admin_session';
  end if;
end;
$$;

create or replace function public.write_admin_audit(
  p_admin_user_id uuid,
  p_action text,
  p_target_user_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.admin_audit_logs (admin_user_id, action, target_user_id, metadata)
  values (
    p_admin_user_id,
    coalesce(nullif(trim(p_action), ''), 'unknown_admin_action'),
    p_target_user_id,
    coalesce(p_metadata, '{}'::jsonb)
  );

  begin
    perform public.log_activity_event(
      p_target_user_id,
      'admin_action',
      jsonb_build_object(
        'action', coalesce(nullif(trim(p_action), ''), 'unknown_admin_action'),
        'admin_user_id', p_admin_user_id
      ) || coalesce(p_metadata, '{}'::jsonb)
    );
  exception
    when others then
      -- Keep admin action writes non-blocking if activity mirror fails.
      null;
  end;
end;
$$;

-- =========================================================
-- ADMIN AUTH RPC
-- =========================================================

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
begin
  select *
  into v_admin
  from public.admin_users au
  where au.username = lower(trim(coalesce(p_username, '')))
    and au.is_active = true
  limit 1;

  if not found then
    raise exception 'invalid_admin_credentials';
  end if;

  if v_admin.password_hash is null
     or crypt(coalesce(p_password, ''), v_admin.password_hash) <> v_admin.password_hash then
    raise exception 'invalid_admin_credentials';
  end if;

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

create or replace function public.admin_validate_session(
  p_session_token uuid
)
returns table(
  is_valid boolean,
  username text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_username text;
  v_expires timestamptz;
begin
  select s.admin_user_id, u.username, s.expires_at
  into v_admin_id, v_username, v_expires
  from public.admin_sessions s
  join public.admin_users u on u.id = s.admin_user_id
  where s.session_token = p_session_token
    and s.revoked_at is null
    and s.expires_at > now()
    and u.is_active = true
  limit 1;

  if not found then
    return query select false::boolean, null::text, null::timestamptz;
    return;
  end if;

  return query select true::boolean, v_username::text, v_expires::timestamptz;
end;
$$;

create or replace function public.admin_logout(
  p_session_token uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
begin
  select admin_user_id
  into v_admin_id
  from public.admin_sessions
  where session_token = p_session_token
    and revoked_at is null
  limit 1;

  update public.admin_sessions
  set revoked_at = now()
  where session_token = p_session_token
    and revoked_at is null;

  if v_admin_id is not null then
    perform public.write_admin_audit(v_admin_id, 'admin_logout', null, '{}'::jsonb);
  end if;
end;
$$;

grant execute on function public.log_activity_event(uuid, text, jsonb) to authenticated;
grant execute on function public.admin_login(text, text, text) to anon, authenticated;
grant execute on function public.admin_validate_session(uuid) to anon, authenticated;
grant execute on function public.admin_logout(uuid) to anon, authenticated;
