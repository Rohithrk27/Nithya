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

create table if not exists public.xp_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  xp_change integer not null default 0,
  change_amount integer,
  source text not null default 'manual',
  reason text,
  event_id text,
  related_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  date date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  active boolean not null default true,
  created_by_admin_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create table if not exists public.community_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  message text not null,
  status text not null default 'pending',
  admin_reply text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.community_chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  room text not null default 'global',
  sender_label text not null default 'Anonymous',
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.relic_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  rarity text not null default 'common',
  effect_type text,
  created_at timestamptz not null default now()
);

create table if not exists public.discipline_relics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'unknown',
  event_id text,
  relic_type_id uuid references public.relic_types(id) on delete set null,
  rarity text not null default 'rare',
  label text,
  earned_at timestamptz not null default now(),
  expires_at timestamptz,
  used boolean not null default false,
  used_for text,
  used_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.discipline_relic_effects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  relic_id uuid references public.discipline_relics(id) on delete set null,
  effect_type text not null,
  status text not null default 'active',
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.public_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  name text,
  user_code text,
  avatar_url text,
  level integer not null default 0,
  total_xp bigint not null default 0,
  stat_distribution jsonb not null default '{}'::jsonb,
  dungeon_achievements jsonb not null default '{}'::jsonb,
  streak_count integer not null default 0,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dungeon_parties (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references auth.users(id) on delete cascade,
  dungeon_id uuid,
  title text,
  status text not null default 'waiting',
  shared_progress integer not null default 0,
  visibility text not null default 'friends',
  max_members integer not null default 4,
  invite_code text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create table if not exists public.dungeon_party_members (
  party_id uuid not null references public.dungeon_parties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  status text not null default 'joined',
  joined_at timestamptz not null default now(),
  primary key (party_id, user_id)
);

create table if not exists public.dungeon_party_rewards (
  party_id uuid not null references public.dungeon_parties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  xp_amount integer not null default 0,
  claimed boolean not null default false,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (party_id, user_id)
);

create table if not exists public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  planned_minutes integer not null default 25,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'active',
  interruption_count integer not null default 0,
  interruption_reason text,
  xp_awarded integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.weekly_personal_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  worked_summary text not null default '',
  failed_summary text not null default '',
  recommendation text not null default '',
  metrics jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_start)
);

create table if not exists public.recovery_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'manual',
  source_ref text,
  reason text,
  title text not null default '48-Hour Recovery Protocol',
  status text not null default 'active',
  starts_on date not null default current_date,
  ends_on date not null default (current_date + 1),
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recovery_plan_steps (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.recovery_plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  day_offset integer not null default 0,
  title text not null,
  description text,
  target_count integer not null default 1,
  progress_count integer not null default 0,
  xp_reward integer not null default 60,
  status text not null default 'pending',
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.party_challenges (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.dungeon_parties(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  target_total integer not null default 20,
  progress_total integer not null default 0,
  xp_reward integer not null default 120,
  relic_reward integer not null default 0,
  status text not null default 'active',
  due_at timestamptz,
  completed_at timestamptz,
  reward_distributed boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.party_challenge_contributions (
  challenge_id uuid not null references public.party_challenges(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  progress integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);

create table if not exists public.party_challenge_rewards (
  challenge_id uuid not null references public.party_challenges(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  xp_amount integer not null default 0,
  relic_amount integer not null default 0,
  claimed boolean not null default false,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
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
  add column if not exists last_notified_at timestamptz,
  add column if not exists last_notified_local_date date,
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

alter table if exists public.xp_logs
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid,
  add column if not exists xp_change integer default 0,
  add column if not exists change_amount integer,
  add column if not exists source text default 'manual',
  add column if not exists reason text,
  add column if not exists event_id text,
  add column if not exists related_id uuid,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists date date default current_date,
  add column if not exists created_at timestamptz default now();

alter table if exists public.announcements
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists title text,
  add column if not exists message text,
  add column if not exists active boolean default true,
  add column if not exists created_by_admin_id uuid,
  add column if not exists created_at timestamptz default now(),
  add column if not exists expires_at timestamptz;

alter table if exists public.community_submissions
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid,
  add column if not exists category text,
  add column if not exists message text,
  add column if not exists status text default 'pending',
  add column if not exists admin_reply text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table if exists public.community_chat_messages
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid,
  add column if not exists room text default 'global',
  add column if not exists sender_label text default 'Anonymous',
  add column if not exists message text,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table if exists public.relic_types
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists code text,
  add column if not exists name text,
  add column if not exists description text,
  add column if not exists rarity text default 'common',
  add column if not exists effect_type text,
  add column if not exists created_at timestamptz default now();

alter table if exists public.discipline_relics
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid,
  add column if not exists source text default 'unknown',
  add column if not exists event_id text,
  add column if not exists relic_type_id uuid,
  add column if not exists rarity text default 'rare',
  add column if not exists label text,
  add column if not exists earned_at timestamptz default now(),
  add column if not exists expires_at timestamptz,
  add column if not exists used boolean default false,
  add column if not exists used_for text,
  add column if not exists used_at timestamptz,
  add column if not exists metadata jsonb default '{}'::jsonb;

alter table if exists public.discipline_relic_effects
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid,
  add column if not exists relic_id uuid,
  add column if not exists effect_type text,
  add column if not exists status text default 'active',
  add column if not exists starts_at timestamptz default now(),
  add column if not exists expires_at timestamptz,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table if exists public.public_profiles
  add column if not exists user_id uuid,
  add column if not exists username text,
  add column if not exists name text,
  add column if not exists user_code text,
  add column if not exists avatar_url text,
  add column if not exists level integer default 0,
  add column if not exists total_xp bigint default 0,
  add column if not exists stat_distribution jsonb default '{}'::jsonb,
  add column if not exists dungeon_achievements jsonb default '{}'::jsonb,
  add column if not exists streak_count integer default 0,
  add column if not exists is_public boolean default false,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table if exists public.dungeon_parties
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists host_user_id uuid,
  add column if not exists dungeon_id uuid,
  add column if not exists title text,
  add column if not exists status text default 'waiting',
  add column if not exists shared_progress integer default 0,
  add column if not exists visibility text default 'friends',
  add column if not exists max_members integer default 4,
  add column if not exists invite_code text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz;

alter table if exists public.dungeon_party_members
  add column if not exists party_id uuid,
  add column if not exists user_id uuid,
  add column if not exists role text default 'member',
  add column if not exists status text default 'joined',
  add column if not exists joined_at timestamptz default now();

alter table if exists public.dungeon_party_rewards
  add column if not exists party_id uuid,
  add column if not exists user_id uuid,
  add column if not exists xp_amount integer default 0,
  add column if not exists claimed boolean default false,
  add column if not exists claimed_at timestamptz,
  add column if not exists created_at timestamptz default now();

alter table if exists public.focus_sessions
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid,
  add column if not exists planned_minutes integer default 25,
  add column if not exists started_at timestamptz default now(),
  add column if not exists ended_at timestamptz,
  add column if not exists status text default 'active',
  add column if not exists interruption_count integer default 0,
  add column if not exists interruption_reason text,
  add column if not exists xp_awarded integer default 0,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table if exists public.weekly_personal_insights
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid,
  add column if not exists week_start date,
  add column if not exists week_end date,
  add column if not exists worked_summary text default '',
  add column if not exists failed_summary text default '',
  add column if not exists recommendation text default '',
  add column if not exists metrics jsonb default '{}'::jsonb,
  add column if not exists generated_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table if exists public.recovery_plans
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid,
  add column if not exists source text default 'manual',
  add column if not exists source_ref text,
  add column if not exists reason text,
  add column if not exists title text default '48-Hour Recovery Protocol',
  add column if not exists status text default 'active',
  add column if not exists starts_on date default current_date,
  add column if not exists ends_on date default (current_date + 1),
  add column if not exists completed_at timestamptz,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table if exists public.recovery_plan_steps
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists plan_id uuid,
  add column if not exists user_id uuid,
  add column if not exists day_offset integer default 0,
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists target_count integer default 1,
  add column if not exists progress_count integer default 0,
  add column if not exists xp_reward integer default 60,
  add column if not exists status text default 'pending',
  add column if not exists completed_at timestamptz,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table if exists public.party_challenges
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists party_id uuid,
  add column if not exists created_by uuid,
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists target_total integer default 20,
  add column if not exists progress_total integer default 0,
  add column if not exists xp_reward integer default 120,
  add column if not exists relic_reward integer default 0,
  add column if not exists status text default 'active',
  add column if not exists due_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists reward_distributed boolean default false,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table if exists public.party_challenge_contributions
  add column if not exists challenge_id uuid,
  add column if not exists user_id uuid,
  add column if not exists progress integer default 0,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table if exists public.party_challenge_rewards
  add column if not exists challenge_id uuid,
  add column if not exists user_id uuid,
  add column if not exists xp_amount integer default 0,
  add column if not exists relic_amount integer default 0,
  add column if not exists claimed boolean default false,
  add column if not exists claimed_at timestamptz,
  add column if not exists created_at timestamptz default now();

-- =========================================================
-- DATA REPAIRS / COMPATIBILITY SYNC
-- =========================================================

do $$
declare
  v_table text;
  v_tables text[] := array[
    'xp_logs',
    'announcements',
    'community_submissions',
    'community_chat_messages',
    'relic_types',
    'discipline_relics',
    'discipline_relic_effects',
    'dungeon_parties',
    'focus_sessions',
    'weekly_personal_insights',
    'recovery_plans',
    'recovery_plan_steps',
    'party_challenges'
  ];
begin
  if to_regclass('public.stats') is not null then
    update public.stats
    set id = coalesce(id, gen_random_uuid())
    where id is null;
  end if;

  foreach v_table in array v_tables loop
    if to_regclass('public.' || v_table) is null then
      continue;
    end if;
    if exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = v_table
        and c.column_name = 'id'
    ) then
      execute format(
        'update public.%I set id = coalesce(id, gen_random_uuid()) where id is null',
        v_table
      );
    end if;
  end loop;

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

  if to_regclass('public.xp_logs') is not null then
    update public.xp_logs
    set date = coalesce(date, (coalesce(created_at, now()) at time zone 'utc')::date)
    where date is null;
  end if;

  if to_regclass('public.public_profiles') is not null then
    update public.public_profiles
    set
      username = coalesce(
        nullif(trim(username), ''),
        lower(
          left(
            replace(
              coalesce(nullif(user_code, ''), user_id::text, gen_random_uuid()::text),
              ' ',
              '-'
            ),
            64
          )
        )
      ),
      level = coalesce(level, 0),
      total_xp = coalesce(total_xp, 0),
      stat_distribution = coalesce(stat_distribution, '{}'::jsonb),
      dungeon_achievements = coalesce(dungeon_achievements, '{}'::jsonb),
      streak_count = coalesce(streak_count, 0),
      is_public = coalesce(is_public, false),
      updated_at = coalesce(updated_at, now())
    where true;
  end if;

  if to_regclass('public.dungeon_parties') is not null then
    update public.dungeon_parties
    set
      status = coalesce(nullif(trim(status), ''), 'waiting'),
      shared_progress = greatest(0, coalesce(shared_progress, 0)),
      visibility = coalesce(nullif(trim(visibility), ''), 'friends'),
      max_members = greatest(2, coalesce(max_members, 4)),
      created_at = coalesce(created_at, now())
    where true;
  end if;

  if to_regclass('public.focus_sessions') is not null then
    update public.focus_sessions
    set
      status = coalesce(nullif(trim(status), ''), 'active'),
      planned_minutes = greatest(1, coalesce(planned_minutes, 25)),
      interruption_count = greatest(0, coalesce(interruption_count, 0)),
      xp_awarded = coalesce(xp_awarded, 0),
      metadata = coalesce(metadata, '{}'::jsonb),
      created_at = coalesce(created_at, now()),
      updated_at = coalesce(updated_at, created_at, now())
    where true;
  end if;

  if to_regclass('public.recovery_plans') is not null then
    update public.recovery_plans
    set
      status = coalesce(nullif(trim(status), ''), 'active'),
      starts_on = coalesce(starts_on, current_date),
      ends_on = coalesce(ends_on, coalesce(starts_on, current_date) + 1),
      metadata = coalesce(metadata, '{}'::jsonb),
      created_at = coalesce(created_at, now()),
      updated_at = coalesce(updated_at, created_at, now())
    where true;
  end if;

  if to_regclass('public.recovery_plan_steps') is not null then
    update public.recovery_plan_steps
    set
      status = coalesce(nullif(trim(status), ''), 'pending'),
      target_count = greatest(1, coalesce(target_count, 1)),
      progress_count = greatest(0, coalesce(progress_count, 0)),
      xp_reward = coalesce(xp_reward, 60),
      metadata = coalesce(metadata, '{}'::jsonb),
      created_at = coalesce(created_at, now()),
      updated_at = coalesce(updated_at, created_at, now())
    where true;
  end if;
end $$;

do $$
begin
  if to_regclass('public.stats') is not null then
    with ranked as (
      select
        ctid,
        row_number() over (
          partition by user_id
          order by coalesce(updated_at, created_at, now()) desc, ctid desc
        ) as rn
      from public.stats
      where user_id is not null
    )
    delete from public.stats s
    using ranked r
    where s.ctid = r.ctid
      and r.rn > 1;
  end if;

  if to_regclass('public.friends') is not null then
    with ranked as (
      select
        ctid,
        row_number() over (
          partition by user_id, friend_user_id
          order by coalesce(updated_at, created_at, now()) desc, ctid desc
        ) as rn
      from public.friends
      where user_id is not null
        and friend_user_id is not null
    )
    delete from public.friends f
    using ranked r
    where f.ctid = r.ctid
      and r.rn > 1;
  end if;

  if to_regclass('public.public_profiles') is not null then
    with ranked_user as (
      select
        ctid,
        row_number() over (
          partition by user_id
          order by coalesce(updated_at, created_at, now()) desc, ctid desc
        ) as rn
      from public.public_profiles
      where user_id is not null
    )
    delete from public.public_profiles pp
    using ranked_user r
    where pp.ctid = r.ctid
      and r.rn > 1;

    with ranked_username as (
      select
        ctid,
        user_id,
        username,
        row_number() over (
          partition by lower(trim(username))
          order by coalesce(updated_at, created_at, now()) desc, ctid desc
        ) as rn
      from public.public_profiles
      where username is not null
        and trim(username) <> ''
    )
    update public.public_profiles pp
    set username = left(
      coalesce(nullif(trim(pp.username), ''), 'user')
      || '-' ||
      left(replace(coalesce(pp.user_id::text, gen_random_uuid()::text), '-', ''), 8),
      64
    )
    from ranked_username r
    where pp.ctid = r.ctid
      and r.rn > 1;
  end if;

  if to_regclass('public.user_quests') is not null then
    with ranked as (
      select
        ctid,
        row_number() over (
          partition by user_id, quest_id
          order by coalesce(updated_at, created_at, now()) desc, ctid desc
        ) as rn
      from public.user_quests
      where user_id is not null
        and quest_id is not null
    )
    delete from public.user_quests uq
    using ranked r
    where uq.ctid = r.ctid
      and r.rn > 1;
  end if;

  if to_regclass('public.web_push_subscriptions') is not null then
    -- Keep one row per (user_id, endpoint) so ON CONFLICT(user_id, endpoint) works reliably.
    with ranked as (
      select
        ctid,
        row_number() over (
          partition by user_id, endpoint
          order by coalesce(updated_at, created_at, now()) desc, ctid desc
        ) as rn
      from public.web_push_subscriptions
      where user_id is not null
        and endpoint is not null
        and trim(endpoint) <> ''
    )
    delete from public.web_push_subscriptions s
    using ranked r
    where s.ctid = r.ctid
      and r.rn > 1;
  end if;
end $$;

create unique index if not exists stats_id_unique_idx on public.stats (id);
create unique index if not exists stats_user_id_unique_idx on public.stats (user_id);
create unique index if not exists friends_user_friend_unique_idx on public.friends (user_id, friend_user_id);
create unique index if not exists user_quests_user_quest_unique_idx on public.user_quests (user_id, quest_id);
create unique index if not exists public_profiles_user_id_unique_idx on public.public_profiles (user_id);
create unique index if not exists public_profiles_username_unique_idx on public.public_profiles (username);
create unique index if not exists web_push_subscriptions_user_endpoint_idx
  on public.web_push_subscriptions (user_id, endpoint);

create index if not exists user_quests_user_quest_idx on public.user_quests (user_id, quest_id);
create index if not exists daily_challenges_user_date_idx on public.daily_challenges (user_id, date);
create index if not exists punishments_user_status_idx on public.punishments (user_id, status, expires_at);
create index if not exists payment_verification_requests_user_utr_idx
  on public.payment_verification_requests (user_id, utr_reference);
create index if not exists web_push_subscriptions_user_idx
  on public.web_push_subscriptions (user_id, is_active);
create index if not exists web_push_subscriptions_active_schedule_idx
  on public.web_push_subscriptions (is_active, reminder_time, timezone);
create index if not exists xp_logs_user_date_idx
  on public.xp_logs (user_id, date desc, created_at desc);
create index if not exists announcements_active_created_idx
  on public.announcements (active, created_at desc);
create index if not exists community_submissions_user_idx
  on public.community_submissions (user_id, created_at desc);
create index if not exists community_submissions_status_idx
  on public.community_submissions (status, created_at desc);
create index if not exists community_chat_messages_room_created_idx
  on public.community_chat_messages (room, created_at desc);
create index if not exists discipline_relics_user_used_expires_idx
  on public.discipline_relics (user_id, used, expires_at);
create index if not exists discipline_relic_effects_user_status_idx
  on public.discipline_relic_effects (user_id, effect_type, status, expires_at);
create index if not exists public_profiles_is_public_rank_idx
  on public.public_profiles (is_public, total_xp desc, level desc);
create index if not exists public_profiles_user_code_idx
  on public.public_profiles (user_code);
create index if not exists dungeon_parties_host_status_idx
  on public.dungeon_parties (host_user_id, status, created_at desc);
create index if not exists dungeon_party_members_user_status_idx
  on public.dungeon_party_members (user_id, status, joined_at desc);
create index if not exists dungeon_party_rewards_user_claimed_idx
  on public.dungeon_party_rewards (user_id, claimed, created_at desc);
create index if not exists focus_sessions_user_status_started_idx
  on public.focus_sessions (user_id, status, started_at desc);
create index if not exists weekly_personal_insights_user_week_idx
  on public.weekly_personal_insights (user_id, week_start desc);
create index if not exists recovery_plans_user_status_idx
  on public.recovery_plans (user_id, status, created_at desc);
create index if not exists recovery_plan_steps_plan_status_idx
  on public.recovery_plan_steps (plan_id, status, created_at);
create index if not exists party_challenges_party_status_created_idx
  on public.party_challenges (party_id, status, created_at desc);
create index if not exists party_challenge_contributions_user_updated_idx
  on public.party_challenge_contributions (user_id, updated_at desc);
create index if not exists party_challenge_rewards_user_claimed_idx
  on public.party_challenge_rewards (user_id, claimed, created_at desc);

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

create or replace function public.progress_recovery_plan_step(
  p_user_id uuid,
  p_step_id uuid,
  p_progress_delta integer default 1
)
returns table(
  plan_id uuid,
  step_id uuid,
  step_status text,
  step_progress integer,
  step_target integer,
  xp_awarded integer,
  plan_status text,
  total_xp bigint,
  current_xp bigint,
  level integer,
  shadow_debt_xp integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step public.recovery_plan_steps%rowtype;
  v_plan public.recovery_plans%rowtype;
  v_delta integer := greatest(0, coalesce(p_progress_delta, 0));
  v_next integer := 0;
  v_xp integer := 0;
  v_bonus integer := 0;
  v_all_completed boolean := false;
  v_was_completed boolean := false;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  if v_delta <= 0 then
    raise exception 'progress delta must be positive';
  end if;

  select *
  into v_step
  from public.recovery_plan_steps rps
  where rps.id = p_step_id
    and rps.user_id = p_user_id
  for update;

  if not found then
    raise exception 'recovery step not found';
  end if;

  select *
  into v_plan
  from public.recovery_plans rp
  where rp.id = v_step.plan_id
    and rp.user_id = p_user_id
  for update;

  if not found then
    raise exception 'recovery plan not found';
  end if;

  if v_plan.status <> 'active' then
    raise exception 'recovery plan is not active';
  end if;

  v_was_completed := lower(coalesce(v_step.status, '')) = 'completed';
  v_next := least(coalesce(v_step.target_count, 1), coalesce(v_step.progress_count, 0) + v_delta);

  update public.recovery_plan_steps
  set
    progress_count = v_next,
    status = case when v_next >= coalesce(v_step.target_count, 1) then 'completed' else status end,
    completed_at = case when v_next >= coalesce(v_step.target_count, 1) then coalesce(completed_at, now()) else completed_at end
  where id = v_step.id
  returning *
  into v_step;

  if not v_was_completed
     and v_step.status = 'completed'
     and coalesce(v_step.progress_count, 0) = v_next
     and v_next = coalesce(v_step.target_count, 1) then
    v_xp := greatest(0, coalesce(v_step.xp_reward, 0));
    if v_xp > 0 then
      perform public.award_xp(
        p_user_id,
        v_xp,
        'recovery_step_complete',
        'recovery_step:' || v_step.id::text || ':complete',
        jsonb_build_object(
          'recovery_plan_id', v_plan.id,
          'recovery_step_id', v_step.id
        )
      );
    end if;
  end if;

  select bool_and(rps.status = 'completed')
  into v_all_completed
  from public.recovery_plan_steps rps
  where rps.plan_id = v_plan.id;

  if coalesce(v_all_completed, false) and v_plan.status = 'active' then
    update public.recovery_plans
    set
      status = 'completed',
      completed_at = coalesce(completed_at, now())
    where id = v_plan.id
    returning *
    into v_plan;

    v_bonus := 120;
    perform public.award_xp(
      p_user_id,
      v_bonus,
      'recovery_plan_complete',
      'recovery_plan:' || v_plan.id::text || ':complete',
      jsonb_build_object('recovery_plan_id', v_plan.id)
    );
  end if;

  return query
  select
    v_plan.id,
    v_step.id,
    v_step.status,
    coalesce(v_step.progress_count, 0),
    coalesce(v_step.target_count, 1),
    v_xp + v_bonus,
    v_plan.status,
    p.total_xp::bigint,
    p.current_xp::bigint,
    p.level,
    coalesce(s.shadow_debt_xp, 0)
  from public.profiles p
  left join public.stats s on s.user_id = p.id
  where p.id = p_user_id
  limit 1;
end;
$$;

grant execute on function public.progress_recovery_plan_step(uuid, uuid, integer) to authenticated;

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
    'xp_logs',
    'friends',
    'announcements',
    'payment_verification_requests',
    'web_push_subscriptions',
    'community_submissions',
    'community_chat_messages',
    'public_profiles',
    'relic_types',
    'discipline_relics',
    'discipline_relic_effects',
    'focus_sessions',
    'weekly_personal_insights',
    'recovery_plans',
    'recovery_plan_steps',
    'dungeon_parties',
    'dungeon_party_members',
    'dungeon_party_rewards',
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
