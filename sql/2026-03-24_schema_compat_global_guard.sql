-- Global schema compatibility guard.
-- Goal: prevent runtime "column/table does not exist" failures across app features.
-- Depends on: 2026-03-23_admin_dashboard_challenge_relic_compat.sql

create extension if not exists pgcrypto;
set search_path = public, extensions;

-- =========================================================
-- CORE TABLE BASELINES (create only when missing)
-- =========================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  user_code text,
  name text,
  age integer,
  height_cm numeric(6,2),
  height_ft numeric(6,2),
  weight_kg numeric(6,2),
  bmi numeric(6,2),
  reminder_time text,
  total_xp bigint not null default 0,
  current_xp bigint not null default 0,
  level integer not null default 0,
  daily_streak integer not null default 0,
  stat_points integer not null default 0,
  quests_completed integer not null default 0,
  dungeon_completed_count integer not null default 0,
  stat_strength integer not null default 0,
  stat_intelligence integer not null default 0,
  stat_discipline integer not null default 0,
  stat_health integer not null default 0,
  stat_social integer not null default 0,
  stat_career integer not null default 0,
  stat_consistency integer not null default 0,
  role text not null default 'user',
  is_suspended boolean not null default false,
  suspension_reason text,
  suspended_until timestamptz,
  last_active_date date,
  created_at timestamptz not null default now()
);

create table if not exists public.stats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  voice_enabled boolean not null default true,
  greeted_once boolean not null default false,
  hardcore_mode boolean not null default false,
  equipped_title text,
  strict_strikes integer not null default 0,
  punishment_ignored_count integer not null default 0,
  daily_challenge_date date,
  daily_challenge_index integer not null default 0,
  daily_challenge_completed boolean not null default false,
  daily_challenge_history jsonb not null default '[]'::jsonb,
  shadow_debt_xp integer not null default 0,
  interruptions_paused boolean not null default false,
  last_daily_reset date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  frequency text not null default 'daily',
  xp_value integer not null default 50,
  description text,
  difficulty text not null default 'medium',
  punishment_text text,
  punishment_difficulty text not null default 'medium',
  punishment_xp_penalty_pct integer not null default 10,
  punishment_type text not null default 'xp_deduction',
  punishment_value integer not null default 30,
  deadline_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.habit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid references public.habits(id) on delete cascade,
  status text not null default 'completed',
  date date not null default current_date,
  failed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.quests (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  type text not null default 'daily',
  xp_reward integer not null default 0,
  relic_reward integer not null default 0,
  stat_reward text,
  stat_reward_amount integer not null default 1,
  min_level_required integer not null default 0,
  progress_current integer not null default 0,
  progress_target integer not null default 100,
  status text not null default 'active',
  date date not null default current_date,
  expires_date date,
  deadline_at timestamptz,
  punishment_type text not null default 'xp_deduction',
  punishment_value integer not null default 40,
  created_by_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.user_quests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  quest_id uuid not null references public.quests(id) on delete cascade,
  status text not null default 'active',
  date date not null default current_date,
  quest_type text,
  started_at timestamptz,
  expires_at timestamptz,
  deadline_at timestamptz,
  xp_reward integer not null default 0,
  relic_reward integer not null default 0,
  punishment_type text,
  punishment_value integer,
  progress integer not null default 0,
  progress_current integer not null default 0,
  progress_target integer not null default 1,
  failed boolean not null default false,
  penalty_applied boolean not null default false,
  failure_reason text,
  completed_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, quest_id)
);

create table if not exists public.daily_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  stat_reward text,
  xp_reward integer not null default 0,
  completed boolean not null default false,
  date date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.punishments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid references public.habits(id) on delete set null,
  habit_log_id uuid references public.habit_logs(id) on delete set null,
  status text not null default 'pending',
  text text,
  reason text,
  total_xp_penalty integer not null default 0,
  accumulated_penalty integer not null default 0,
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  resolved boolean not null default false,
  penalty_applied boolean not null default false,
  warning_notified boolean not null default false,
  urgency_notified boolean not null default false,
  resolved_at timestamptz,
  action_taken text,
  created_at timestamptz not null default now()
);

create table if not exists public.interruptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  interruption_code text not null,
  status text not null default 'paused',
  interruption_start timestamptz not null default now(),
  interruption_end timestamptz,
  started_at timestamptz,
  resolved_at timestamptz,
  grace_hours integer not null default 6,
  grace_period_hours integer not null default 3,
  full_penalty_hours integer not null default 24,
  reward_xp integer not null default 0,
  penalty_xp integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  event_date date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.dungeon_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  challenge_title text,
  challenge_description text,
  start_date date not null default current_date,
  end_date date,
  status text not null default 'active',
  xp_bonus_multiplier numeric(6,2) not null default 1,
  xp_reward integer not null default 0,
  xp_penalty integer not null default 0,
  punishment_mode text,
  custom_punishment_text text,
  duration_days integer not null default 7,
  completed_days integer not null default 0,
  stability integer not null default 100,
  interruptions_count integer not null default 0,
  mode text not null default 'solo',
  party_id uuid,
  party_status text,
  created_at timestamptz not null default now()
);

create table if not exists public.rank_evaluations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  required_level integer not null default 0,
  title text not null default 'Rank Evaluation',
  status text not null default 'pending',
  resolved_date date,
  last_penalty_date date,
  created_at timestamptz not null default now()
);

create table if not exists public.habit_subtasks (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references public.habits(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  title text not null,
  xp_value integer not null default 10,
  sort_order integer not null default 0,
  completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.friends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, friend_user_id)
);

create table if not exists public.bmi_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bmi numeric(6,2) not null,
  weight_kg numeric(6,2),
  height_cm numeric(6,2),
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  title text not null,
  description text,
  icon text,
  category text,
  unlocked_date date,
  created_at timestamptz not null default now(),
  unique (user_id, key)
);

create table if not exists public.payment_verification_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount_inr numeric(10,2) not null default 0,
  utr_reference text not null,
  payer_name text,
  payment_app text,
  paid_at timestamptz,
  notes text,
  proof_path text,
  status text not null default 'pending',
  admin_reply text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  content_encoding text,
  reminder_time text not null default '21:00',
  timezone text not null default 'UTC',
  is_active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  last_notified_at timestamptz,
  last_notified_local_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================
-- COLUMN NORMALIZATION (existing tables)
-- =========================================================

alter table if exists public.profiles
  add column if not exists email text,
  add column if not exists user_code text,
  add column if not exists name text,
  add column if not exists age integer,
  add column if not exists height_cm numeric(6,2),
  add column if not exists height_ft numeric(6,2),
  add column if not exists weight_kg numeric(6,2),
  add column if not exists bmi numeric(6,2),
  add column if not exists reminder_time text,
  add column if not exists total_xp bigint not null default 0,
  add column if not exists current_xp bigint not null default 0,
  add column if not exists level integer not null default 0,
  add column if not exists daily_streak integer not null default 0,
  add column if not exists stat_points integer not null default 0,
  add column if not exists quests_completed integer not null default 0,
  add column if not exists dungeon_completed_count integer not null default 0,
  add column if not exists stat_strength integer not null default 0,
  add column if not exists stat_intelligence integer not null default 0,
  add column if not exists stat_discipline integer not null default 0,
  add column if not exists stat_health integer not null default 0,
  add column if not exists stat_social integer not null default 0,
  add column if not exists stat_career integer not null default 0,
  add column if not exists stat_consistency integer not null default 0,
  add column if not exists role text default 'user',
  add column if not exists is_suspended boolean default false,
  add column if not exists suspension_reason text,
  add column if not exists suspended_until timestamptz,
  add column if not exists last_active_date date,
  add column if not exists created_at timestamptz default now();

alter table if exists public.stats
  add column if not exists id uuid,
  add column if not exists user_id uuid,
  add column if not exists voice_enabled boolean default true,
  add column if not exists greeted_once boolean default false,
  add column if not exists hardcore_mode boolean default false,
  add column if not exists equipped_title text,
  add column if not exists strict_strikes integer default 0,
  add column if not exists punishment_ignored_count integer default 0,
  add column if not exists daily_challenge_date date,
  add column if not exists daily_challenge_index integer default 0,
  add column if not exists daily_challenge_completed boolean default false,
  add column if not exists daily_challenge_history jsonb default '[]'::jsonb,
  add column if not exists shadow_debt_xp integer default 0,
  add column if not exists interruptions_paused boolean default false,
  add column if not exists last_daily_reset date,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table if exists public.habits
  add column if not exists user_id uuid,
  add column if not exists title text,
  add column if not exists frequency text default 'daily',
  add column if not exists xp_value integer default 50,
  add column if not exists description text,
  add column if not exists difficulty text default 'medium',
  add column if not exists punishment_text text,
  add column if not exists punishment_difficulty text default 'medium',
  add column if not exists punishment_xp_penalty_pct integer default 10,
  add column if not exists punishment_type text default 'xp_deduction',
  add column if not exists punishment_value integer default 30,
  add column if not exists deadline_at timestamptz,
  add column if not exists created_at timestamptz default now();

alter table if exists public.habit_logs
  add column if not exists user_id uuid,
  add column if not exists habit_id uuid,
  add column if not exists status text default 'completed',
  add column if not exists date date default current_date,
  add column if not exists failed boolean default false,
  add column if not exists created_at timestamptz default now();

alter table if exists public.quests
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists type text default 'daily',
  add column if not exists xp_reward integer default 0,
  add column if not exists relic_reward integer default 0,
  add column if not exists stat_reward text,
  add column if not exists stat_reward_amount integer default 1,
  add column if not exists min_level_required integer default 0,
  add column if not exists progress_current integer default 0,
  add column if not exists progress_target integer default 100,
  add column if not exists status text default 'active',
  add column if not exists date date default current_date,
  add column if not exists expires_date date,
  add column if not exists deadline_at timestamptz,
  add column if not exists punishment_type text default 'xp_deduction',
  add column if not exists punishment_value integer default 40,
  add column if not exists created_by_admin boolean default false,
  add column if not exists created_at timestamptz default now();

alter table if exists public.user_quests
  add column if not exists id uuid,
  add column if not exists user_id uuid,
  add column if not exists quest_id uuid,
  add column if not exists status text default 'active',
  add column if not exists date date default current_date,
  add column if not exists quest_type text,
  add column if not exists started_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists deadline_at timestamptz,
  add column if not exists xp_reward integer default 0,
  add column if not exists relic_reward integer default 0,
  add column if not exists punishment_type text,
  add column if not exists punishment_value integer,
  add column if not exists progress integer default 0,
  add column if not exists progress_current integer default 0,
  add column if not exists progress_target integer default 1,
  add column if not exists failed boolean default false,
  add column if not exists penalty_applied boolean default false,
  add column if not exists failure_reason text,
  add column if not exists completed_date date,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table if exists public.daily_challenges
  add column if not exists id uuid,
  add column if not exists user_id uuid,
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists stat_reward text,
  add column if not exists xp_reward integer default 0,
  add column if not exists completed boolean default false,
  add column if not exists date date default current_date,
  add column if not exists created_at timestamptz default now();

alter table if exists public.punishments
  add column if not exists id uuid,
  add column if not exists user_id uuid,
  add column if not exists habit_id uuid,
  add column if not exists habit_log_id uuid,
  add column if not exists status text default 'pending',
  add column if not exists text text,
  add column if not exists reason text,
  add column if not exists total_xp_penalty integer default 0,
  add column if not exists accumulated_penalty integer default 0,
  add column if not exists started_at timestamptz default now(),
  add column if not exists expires_at timestamptz,
  add column if not exists resolved boolean default false,
  add column if not exists penalty_applied boolean default false,
  add column if not exists warning_notified boolean default false,
  add column if not exists urgency_notified boolean default false,
  add column if not exists resolved_at timestamptz,
  add column if not exists action_taken text,
  add column if not exists created_at timestamptz default now();

alter table if exists public.interruptions
  add column if not exists user_id uuid,
  add column if not exists interruption_code text,
  add column if not exists status text default 'paused',
  add column if not exists interruption_start timestamptz default now(),
  add column if not exists interruption_end timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists grace_hours integer default 6,
  add column if not exists grace_period_hours integer default 3,
  add column if not exists full_penalty_hours integer default 24,
  add column if not exists reward_xp integer default 0,
  add column if not exists penalty_xp integer default 0,
  add column if not exists payload jsonb default '{}'::jsonb,
  add column if not exists event_date date default current_date,
  add column if not exists created_at timestamptz default now();

alter table if exists public.dungeon_runs
  add column if not exists user_id uuid,
  add column if not exists challenge_title text,
  add column if not exists challenge_description text,
  add column if not exists start_date date default current_date,
  add column if not exists end_date date,
  add column if not exists status text default 'active',
  add column if not exists xp_bonus_multiplier numeric(6,2) default 1,
  add column if not exists xp_reward integer default 0,
  add column if not exists xp_penalty integer default 0,
  add column if not exists punishment_mode text,
  add column if not exists custom_punishment_text text,
  add column if not exists duration_days integer default 7,
  add column if not exists completed_days integer default 0,
  add column if not exists stability integer default 100,
  add column if not exists interruptions_count integer default 0,
  add column if not exists mode text default 'solo',
  add column if not exists party_id uuid,
  add column if not exists party_status text,
  add column if not exists created_at timestamptz default now();

alter table if exists public.rank_evaluations
  add column if not exists user_id uuid,
  add column if not exists required_level integer default 0,
  add column if not exists title text default 'Rank Evaluation',
  add column if not exists status text default 'pending',
  add column if not exists resolved_date date,
  add column if not exists last_penalty_date date,
  add column if not exists created_at timestamptz default now();

alter table if exists public.payment_verification_requests
  add column if not exists user_id uuid,
  add column if not exists amount_inr numeric(10,2),
  add column if not exists utr_reference text,
  add column if not exists payer_name text,
  add column if not exists payment_app text,
  add column if not exists paid_at timestamptz,
  add column if not exists notes text,
  add column if not exists proof_path text,
  add column if not exists status text default 'pending',
  add column if not exists admin_reply text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table if exists public.web_push_subscriptions
  add column if not exists user_id uuid,
  add column if not exists endpoint text,
  add column if not exists p256dh text,
  add column if not exists auth text,
  add column if not exists content_encoding text,
  add column if not exists reminder_time text,
  add column if not exists timezone text,
  add column if not exists is_active boolean default true,
  add column if not exists last_seen_at timestamptz,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table if exists public.habit_subtasks
  add column if not exists habit_id uuid,
  add column if not exists user_id uuid,
  add column if not exists title text,
  add column if not exists xp_value integer default 10,
  add column if not exists sort_order integer default 0,
  add column if not exists completed boolean default false,
  add column if not exists completed_at timestamptz,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table if exists public.friends
  add column if not exists user_id uuid,
  add column if not exists friend_user_id uuid,
  add column if not exists status text default 'pending',
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table if exists public.bmi_records
  add column if not exists user_id uuid,
  add column if not exists bmi numeric(6,2),
  add column if not exists weight_kg numeric(6,2),
  add column if not exists height_cm numeric(6,2),
  add column if not exists recorded_at timestamptz default now(),
  add column if not exists created_at timestamptz default now();

alter table if exists public.achievements
  add column if not exists user_id uuid,
  add column if not exists key text,
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists icon text,
  add column if not exists category text,
  add column if not exists unlocked_date date,
  add column if not exists created_at timestamptz default now();

-- =========================================================
-- DATA REPAIRS / COMPATIBILITY SYNC
-- =========================================================

do $$
begin
  if to_regclass('public.stats') is not null then
    update public.stats
    set id = coalesce(id, gen_random_uuid())
    where id is null;
  end if;

  if to_regclass('public.user_quests') is not null then
    update public.user_quests
    set
      progress_current = greatest(0, coalesce(progress_current, progress, 0)),
      progress = greatest(0, coalesce(progress, progress_current, 0)),
      progress_target = greatest(1, coalesce(progress_target, 1)),
      status = coalesce(nullif(trim(status), ''), 'active'),
      date = coalesce(date, current_date);
  end if;

  if to_regclass('public.interruptions') is not null then
    update public.interruptions
    set
      started_at = coalesce(started_at, interruption_start),
      interruption_start = coalesce(interruption_start, started_at, now()),
      event_date = coalesce(event_date, current_date)
    where true;
  end if;
end $$;

create unique index if not exists stats_id_unique_idx on public.stats (id);
create index if not exists user_quests_user_quest_idx on public.user_quests (user_id, quest_id);
create index if not exists daily_challenges_user_date_idx on public.daily_challenges (user_id, date);
create index if not exists punishments_user_status_idx on public.punishments (user_id, status, expires_at);
create index if not exists payment_verification_requests_user_utr_idx
  on public.payment_verification_requests (user_id, utr_reference);
create index if not exists web_push_subscriptions_user_idx
  on public.web_push_subscriptions (user_id, is_active);
create index if not exists web_push_subscriptions_active_schedule_idx
  on public.web_push_subscriptions (is_active, reminder_time, timezone);

do $$
begin
  if to_regclass('public.web_push_subscriptions') is null then
    return;
  end if;

  -- Keep one row per (user_id, endpoint) so ON CONFLICT(user_id, endpoint) works reliably.
  with ranked as (
    select
      s.id,
      row_number() over (
        partition by s.user_id, s.endpoint
        order by coalesce(s.updated_at, s.created_at, now()) desc, s.id desc
      ) as rn
    from public.web_push_subscriptions s
    where s.user_id is not null
      and s.endpoint is not null
      and trim(s.endpoint) <> ''
  )
  delete from public.web_push_subscriptions s
  using ranked r
  where s.id = r.id
    and r.rn > 1;
end $$;

create unique index if not exists web_push_subscriptions_user_endpoint_idx
  on public.web_push_subscriptions (user_id, endpoint);

create or replace function public.sync_user_quests_progress_compat()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.progress_current := greatest(0, coalesce(new.progress_current, new.progress, 0));
  new.progress := greatest(0, coalesce(new.progress, new.progress_current, 0));
  new.progress_target := greatest(1, coalesce(new.progress_target, 1));
  return new;
end;
$$;

drop trigger if exists trg_sync_user_quests_progress_compat on public.user_quests;
create trigger trg_sync_user_quests_progress_compat
before insert or update on public.user_quests
for each row
execute function public.sync_user_quests_progress_compat();

-- =========================================================
-- GRANTS (best-effort compatibility for runtime table access)
-- =========================================================

do $$
declare
  v_table text;
  v_tables text[] := array[
    'profiles',
    'stats',
    'habits',
    'habit_logs',
    'habit_subtasks',
    'quests',
    'user_quests',
    'daily_challenges',
    'punishments',
    'interruptions',
    'dungeon_runs',
    'rank_evaluations',
    'bmi_records',
    'achievements',
    'friends',
    'payment_verification_requests',
    'web_push_subscriptions',
    'community_submissions',
    'community_chat_messages',
    'public_profiles',
    'relic_types',
    'discipline_relics',
    'discipline_relic_effects',
    'focus_sessions',
    'recovery_plans',
    'recovery_plan_steps',
    'party_challenges',
    'party_challenge_contributions',
    'party_challenge_rewards'
  ];
begin
  foreach v_table in array v_tables loop
    if to_regclass('public.' || v_table) is null then
      continue;
    end if;
    execute format('grant select on public.%I to anon', v_table);
    execute format('grant select, insert, update, delete on public.%I to authenticated', v_table);
  end loop;
end $$;

notify pgrst, 'reload schema';
