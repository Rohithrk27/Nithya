-- Focus Session Mode + Weekly Personal Insights + Party Challenges
-- Depends on: 2026-03-17_public_launch_hardening.sql

set search_path = public, extensions;

-- =========================================================
-- FOCUS SESSION MODE
-- =========================================================

create table if not exists public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  planned_minutes integer not null default 25 check (planned_minutes between 5 and 180),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'active' check (status in ('active', 'completed', 'interrupted', 'abandoned')),
  interruption_count integer not null default 0,
  interruption_reason text,
  xp_awarded integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists focus_sessions_user_created_idx
  on public.focus_sessions (user_id, created_at desc);

create index if not exists focus_sessions_user_status_started_idx
  on public.focus_sessions (user_id, status, started_at desc);

create unique index if not exists focus_sessions_one_active_per_user_idx
  on public.focus_sessions (user_id)
  where status = 'active';

drop trigger if exists trg_touch_focus_sessions_updated_at on public.focus_sessions;
create trigger trg_touch_focus_sessions_updated_at
before update on public.focus_sessions
for each row
execute function public.touch_generic_updated_at();

alter table public.focus_sessions enable row level security;

drop policy if exists focus_sessions_select_own on public.focus_sessions;
create policy focus_sessions_select_own
on public.focus_sessions for select
using (auth.uid() = user_id);

drop policy if exists focus_sessions_insert_own on public.focus_sessions;
create policy focus_sessions_insert_own
on public.focus_sessions for insert
with check (auth.uid() = user_id);

drop policy if exists focus_sessions_update_own on public.focus_sessions;
create policy focus_sessions_update_own
on public.focus_sessions for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.start_focus_session(
  p_user_id uuid,
  p_minutes integer default 25,
  p_metadata jsonb default '{}'::jsonb
)
returns public.focus_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minutes integer := greatest(5, least(180, coalesce(p_minutes, 25)));
  v_existing public.focus_sessions%rowtype;
  v_session public.focus_sessions%rowtype;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  select *
  into v_existing
  from public.focus_sessions fs
  where fs.user_id = p_user_id
    and fs.status = 'active'
  order by fs.started_at desc
  limit 1
  for update;

  if found then
    return v_existing;
  end if;

  insert into public.focus_sessions (
    user_id,
    planned_minutes,
    status,
    metadata
  )
  values (
    p_user_id,
    v_minutes,
    'active',
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning *
  into v_session;

  return v_session;
end;
$$;

create or replace function public.interrupt_focus_session(
  p_user_id uuid,
  p_session_id uuid,
  p_reason text default null
)
returns public.focus_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_session public.focus_sessions%rowtype;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  select *
  into v_session
  from public.focus_sessions fs
  where fs.id = p_session_id
    and fs.user_id = p_user_id
  for update;

  if not found then
    raise exception 'focus session not found';
  end if;

  if v_session.status <> 'active' then
    return v_session;
  end if;

  update public.focus_sessions fs
  set
    status = 'interrupted',
    interruption_count = coalesce(fs.interruption_count, 0) + 1,
    interruption_reason = coalesce(v_reason, fs.interruption_reason, 'session_interrupted'),
    ended_at = coalesce(fs.ended_at, now())
  where fs.id = p_session_id
  returning *
  into v_session;

  return v_session;
end;
$$;

create or replace function public.complete_focus_session(
  p_user_id uuid,
  p_session_id uuid,
  p_completed_at timestamptz default now()
)
returns table(
  session_id uuid,
  session_status text,
  xp_awarded integer,
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
  v_session public.focus_sessions%rowtype;
  v_completed_at timestamptz := coalesce(p_completed_at, now());
  v_elapsed_seconds integer := 0;
  v_required_seconds integer := 0;
  v_xp integer := 0;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  select *
  into v_session
  from public.focus_sessions fs
  where fs.id = p_session_id
    and fs.user_id = p_user_id
  for update;

  if not found then
    raise exception 'focus session not found';
  end if;

  if v_session.status = 'completed' then
    return query
    select
      v_session.id,
      v_session.status,
      coalesce(v_session.xp_awarded, 0),
      p.total_xp::bigint,
      p.current_xp::bigint,
      p.level,
      coalesce(s.shadow_debt_xp, 0)
    from public.profiles p
    left join public.stats s on s.user_id = p.id
    where p.id = p_user_id
    limit 1;
    return;
  end if;

  if v_session.status <> 'active' then
    raise exception 'focus session is not active';
  end if;

  if coalesce(v_session.interruption_count, 0) > 0 then
    raise exception 'session interrupted; uninterrupted completion required';
  end if;

  v_elapsed_seconds := greatest(0, floor(extract(epoch from (v_completed_at - v_session.started_at)))::integer);
  v_required_seconds := greatest(1, coalesce(v_session.planned_minutes, 25) * 60);

  -- Small grace period to prevent client clock drift edge-cases.
  if v_elapsed_seconds + 2 < v_required_seconds then
    raise exception 'focus block still in progress';
  end if;

  v_xp := greatest(15, least(360, coalesce(v_session.planned_minutes, 25) * 3));

  perform public.award_xp(
    p_user_id,
    v_xp,
    'focus_session',
    'focus_session:' || v_session.id::text || ':complete',
    jsonb_build_object(
      'focus_session_id', v_session.id,
      'planned_minutes', v_session.planned_minutes,
      'elapsed_seconds', v_elapsed_seconds
    )
  );

  update public.focus_sessions fs
  set
    status = 'completed',
    ended_at = coalesce(fs.ended_at, v_completed_at),
    xp_awarded = v_xp
  where fs.id = v_session.id
  returning *
  into v_session;

  return query
  select
    v_session.id,
    v_session.status,
    coalesce(v_session.xp_awarded, 0),
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

grant execute on function public.start_focus_session(uuid, integer, jsonb) to authenticated;
grant execute on function public.interrupt_focus_session(uuid, uuid, text) to authenticated;
grant execute on function public.complete_focus_session(uuid, uuid, timestamptz) to authenticated;

-- =========================================================
-- WEEKLY PERSONAL INSIGHTS
-- =========================================================

create table if not exists public.weekly_personal_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  worked_summary text not null,
  failed_summary text not null,
  recommendation text not null,
  metrics jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, week_start)
);

create index if not exists weekly_personal_insights_user_week_idx
  on public.weekly_personal_insights (user_id, week_start desc);

drop trigger if exists trg_touch_weekly_personal_insights_updated_at on public.weekly_personal_insights;
create trigger trg_touch_weekly_personal_insights_updated_at
before update on public.weekly_personal_insights
for each row
execute function public.touch_generic_updated_at();

alter table public.weekly_personal_insights enable row level security;

drop policy if exists weekly_personal_insights_select_own on public.weekly_personal_insights;
create policy weekly_personal_insights_select_own
on public.weekly_personal_insights for select
using (auth.uid() = user_id);

drop policy if exists weekly_personal_insights_insert_own on public.weekly_personal_insights;
create policy weekly_personal_insights_insert_own
on public.weekly_personal_insights for insert
with check (auth.uid() = user_id);

drop policy if exists weekly_personal_insights_update_own on public.weekly_personal_insights;
create policy weekly_personal_insights_update_own
on public.weekly_personal_insights for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.generate_weekly_personal_insight(
  p_user_id uuid,
  p_week_start date default null
)
returns public.weekly_personal_insights
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week_start date := coalesce(
    p_week_start,
    (current_date - ((extract(isodow from current_date)::int - 1)))::date
  );
  v_week_end date := v_week_start + 6;
  v_habit_completed integer := 0;
  v_habit_missed integer := 0;
  v_habit_attempts integer := 0;
  v_habit_rate numeric := 0;
  v_quest_completed integer := 0;
  v_quest_failed integer := 0;
  v_quest_attempts integer := 0;
  v_quest_rate numeric := 0;
  v_best_habit text := null;
  v_best_habit_rate numeric := 0;
  v_worst_habit text := null;
  v_worst_habit_rate numeric := 0;
  v_worked text;
  v_failed text;
  v_recommendation text;
  v_row public.weekly_personal_insights%rowtype;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  select
    count(*) filter (where hl.status = 'completed')::integer,
    count(*) filter (where hl.status = 'missed')::integer,
    count(*) filter (where hl.status in ('completed', 'missed'))::integer
  into
    v_habit_completed,
    v_habit_missed,
    v_habit_attempts
  from public.habit_logs hl
  where hl.user_id = p_user_id
    and coalesce(hl.date, (hl.created_at at time zone 'utc')::date) between v_week_start and v_week_end;

  if v_habit_attempts > 0 then
    v_habit_rate := round((v_habit_completed::numeric / v_habit_attempts::numeric) * 100.0, 1);
  end if;

  with per_habit as (
    select
      h.title,
      count(*) filter (where hl.status = 'completed')::integer as completed_count,
      count(*) filter (where hl.status = 'missed')::integer as missed_count,
      count(*) filter (where hl.status in ('completed', 'missed'))::integer as attempts
    from public.habits h
    left join public.habit_logs hl
      on hl.habit_id = h.id
      and hl.user_id = p_user_id
      and coalesce(hl.date, (hl.created_at at time zone 'utc')::date) between v_week_start and v_week_end
    where h.user_id = p_user_id
    group by h.id, h.title
  )
  select
    ph.title,
    round((ph.completed_count::numeric / ph.attempts::numeric) * 100.0, 1)
  into
    v_best_habit,
    v_best_habit_rate
  from per_habit ph
  where ph.attempts > 0
  order by (ph.completed_count::numeric / ph.attempts::numeric) desc, ph.attempts desc, ph.title
  limit 1;

  with per_habit as (
    select
      h.title,
      count(*) filter (where hl.status = 'completed')::integer as completed_count,
      count(*) filter (where hl.status = 'missed')::integer as missed_count,
      count(*) filter (where hl.status in ('completed', 'missed'))::integer as attempts
    from public.habits h
    left join public.habit_logs hl
      on hl.habit_id = h.id
      and hl.user_id = p_user_id
      and coalesce(hl.date, (hl.created_at at time zone 'utc')::date) between v_week_start and v_week_end
    where h.user_id = p_user_id
    group by h.id, h.title
  )
  select
    ph.title,
    round((ph.completed_count::numeric / ph.attempts::numeric) * 100.0, 1)
  into
    v_worst_habit,
    v_worst_habit_rate
  from per_habit ph
  where ph.attempts > 0
  order by (ph.completed_count::numeric / ph.attempts::numeric) asc, ph.attempts desc, ph.title
  limit 1;

  select
    count(*) filter (where uq.status = 'completed')::integer,
    count(*) filter (where uq.status = 'failed')::integer,
    count(*) filter (where uq.status in ('completed', 'failed'))::integer
  into
    v_quest_completed,
    v_quest_failed,
    v_quest_attempts
  from public.user_quests uq
  where uq.user_id = p_user_id
    and coalesce(uq.completed_date, uq.date, (uq.created_at at time zone 'utc')::date) between v_week_start and v_week_end;

  if v_quest_attempts > 0 then
    v_quest_rate := round((v_quest_completed::numeric / v_quest_attempts::numeric) * 100.0, 1);
  end if;

  v_worked := format(
    'Habit consistency %s%% (%s completed / %s attempts). Best habit: %s (%s%%). Quests cleared: %s.',
    to_char(v_habit_rate, 'FM999990D0'),
    v_habit_completed,
    greatest(v_habit_attempts, 0),
    coalesce(v_best_habit, 'n/a'),
    to_char(coalesce(v_best_habit_rate, 0), 'FM999990D0'),
    v_quest_completed
  );

  v_failed := format(
    'Missed habits: %s. Failed quests: %s. Weakest habit: %s (%s%%).',
    v_habit_missed,
    v_quest_failed,
    coalesce(v_worst_habit, 'n/a'),
    to_char(coalesce(v_worst_habit_rate, 0), 'FM999990D0')
  );

  if v_habit_attempts = 0 then
    v_recommendation := 'Track at least one daily habit this week so the system can generate meaningful improvement guidance.';
  elsif v_habit_rate < 60 and v_worst_habit is not null then
    v_recommendation := format(
      'Reduce friction on "%s": lock one fixed time window daily and lower the task scope by 20%% until you hit 5 consecutive completions.',
      v_worst_habit
    );
  elsif v_quest_failed > v_quest_completed then
    v_recommendation := 'Convert your hardest weekly quest into a daily micro-step and complete it before your first distraction window each day.';
  else
    v_recommendation := 'Stack your hardest habit immediately after your strongest habit to preserve momentum and raise weekly completion consistency.';
  end if;

  insert into public.weekly_personal_insights (
    user_id,
    week_start,
    week_end,
    worked_summary,
    failed_summary,
    recommendation,
    metrics,
    generated_at
  )
  values (
    p_user_id,
    v_week_start,
    v_week_end,
    v_worked,
    v_failed,
    v_recommendation,
    jsonb_build_object(
      'habit_completed', v_habit_completed,
      'habit_missed', v_habit_missed,
      'habit_attempts', v_habit_attempts,
      'habit_rate', v_habit_rate,
      'quest_completed', v_quest_completed,
      'quest_failed', v_quest_failed,
      'quest_attempts', v_quest_attempts,
      'quest_rate', v_quest_rate,
      'best_habit', v_best_habit,
      'best_habit_rate', v_best_habit_rate,
      'worst_habit', v_worst_habit,
      'worst_habit_rate', v_worst_habit_rate
    ),
    now()
  )
  on conflict (user_id, week_start) do update
  set
    week_end = excluded.week_end,
    worked_summary = excluded.worked_summary,
    failed_summary = excluded.failed_summary,
    recommendation = excluded.recommendation,
    metrics = excluded.metrics,
    generated_at = now(),
    updated_at = now()
  returning *
  into v_row;

  return v_row;
end;
$$;

create or replace function public.get_latest_weekly_personal_insight(
  p_user_id uuid
)
returns public.weekly_personal_insights
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.weekly_personal_insights%rowtype;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  select *
  into v_row
  from public.weekly_personal_insights wpi
  where wpi.user_id = p_user_id
  order by wpi.week_start desc
  limit 1;

  if found then
    return v_row;
  end if;

  return public.generate_weekly_personal_insight(p_user_id, null);
end;
$$;

grant execute on function public.generate_weekly_personal_insight(uuid, date) to authenticated;
grant execute on function public.get_latest_weekly_personal_insight(uuid) to authenticated;

-- =========================================================
-- PARTY CHALLENGES
-- =========================================================

create table if not exists public.party_challenges (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.dungeon_parties(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  target_total integer not null default 20 check (target_total between 1 and 100000),
  progress_total integer not null default 0 check (progress_total >= 0),
  xp_reward integer not null default 120 check (xp_reward >= 0),
  relic_reward integer not null default 0 check (relic_reward >= 0 and relic_reward <= 20),
  status text not null default 'active' check (status in ('active', 'completed', 'expired', 'cancelled')),
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
  progress integer not null default 0 check (progress >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);

create table if not exists public.party_challenge_rewards (
  challenge_id uuid not null references public.party_challenges(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  xp_amount integer not null default 0 check (xp_amount >= 0),
  relic_amount integer not null default 0 check (relic_amount >= 0),
  claimed boolean not null default false,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);

create index if not exists party_challenges_party_status_created_idx
  on public.party_challenges (party_id, status, created_at desc);

create index if not exists party_challenges_due_idx
  on public.party_challenges (status, due_at);

create index if not exists party_challenge_contributions_user_updated_idx
  on public.party_challenge_contributions (user_id, updated_at desc);

create index if not exists party_challenge_rewards_user_claimed_idx
  on public.party_challenge_rewards (user_id, claimed, created_at desc);

drop trigger if exists trg_touch_party_challenges_updated_at on public.party_challenges;
create trigger trg_touch_party_challenges_updated_at
before update on public.party_challenges
for each row
execute function public.touch_generic_updated_at();

drop trigger if exists trg_touch_party_challenge_contrib_updated_at on public.party_challenge_contributions;
create trigger trg_touch_party_challenge_contrib_updated_at
before update on public.party_challenge_contributions
for each row
execute function public.touch_generic_updated_at();

alter table public.party_challenges enable row level security;
alter table public.party_challenge_contributions enable row level security;
alter table public.party_challenge_rewards enable row level security;

drop policy if exists party_challenges_select_policy on public.party_challenges;
create policy party_challenges_select_policy
on public.party_challenges for select
using (public.is_dungeon_party_host_or_member(party_id));

drop policy if exists party_challenges_insert_policy on public.party_challenges;
create policy party_challenges_insert_policy
on public.party_challenges for insert
with check (
  auth.uid() = created_by
  and public.is_dungeon_party_host(party_id)
);

drop policy if exists party_challenges_update_policy on public.party_challenges;
create policy party_challenges_update_policy
on public.party_challenges for update
using (public.is_dungeon_party_host(party_id))
with check (public.is_dungeon_party_host(party_id));

drop policy if exists party_challenges_delete_policy on public.party_challenges;
create policy party_challenges_delete_policy
on public.party_challenges for delete
using (public.is_dungeon_party_host(party_id));

drop policy if exists party_challenge_contributions_select_policy on public.party_challenge_contributions;
create policy party_challenge_contributions_select_policy
on public.party_challenge_contributions for select
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.party_challenges pc
    where pc.id = challenge_id
      and public.is_dungeon_party_host_or_member(pc.party_id)
  )
);

drop policy if exists party_challenge_contributions_insert_policy on public.party_challenge_contributions;
create policy party_challenge_contributions_insert_policy
on public.party_challenge_contributions for insert
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.party_challenges pc
    where pc.id = challenge_id
      and public.is_dungeon_party_host_or_member(pc.party_id)
  )
);

drop policy if exists party_challenge_contributions_update_policy on public.party_challenge_contributions;
create policy party_challenge_contributions_update_policy
on public.party_challenge_contributions for update
using (
  auth.uid() = user_id
  and exists (
    select 1
    from public.party_challenges pc
    where pc.id = challenge_id
      and public.is_dungeon_party_host_or_member(pc.party_id)
  )
)
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.party_challenges pc
    where pc.id = challenge_id
      and public.is_dungeon_party_host_or_member(pc.party_id)
  )
);

drop policy if exists party_challenge_rewards_select_policy on public.party_challenge_rewards;
create policy party_challenge_rewards_select_policy
on public.party_challenge_rewards for select
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.party_challenges pc
    where pc.id = challenge_id
      and public.is_dungeon_party_host(pc.party_id)
  )
);

drop policy if exists party_challenge_rewards_update_policy on public.party_challenge_rewards;
create policy party_challenge_rewards_update_policy
on public.party_challenge_rewards for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.create_party_challenge(
  p_user_id uuid,
  p_party_id uuid,
  p_title text,
  p_description text default null,
  p_target_total integer default 20,
  p_xp_reward integer default 120,
  p_relic_reward integer default 0,
  p_due_at timestamptz default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.party_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_target integer := greatest(1, least(100000, coalesce(p_target_total, 20)));
  v_xp integer := greatest(0, coalesce(p_xp_reward, 120));
  v_relic integer := greatest(0, least(20, coalesce(p_relic_reward, 0)));
  v_due_at timestamptz := coalesce(p_due_at, now() + interval '7 days');
  v_active_count integer := 0;
  v_row public.party_challenges%rowtype;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  if not public.is_dungeon_party_host(p_party_id) then
    raise exception 'only party host can create challenges';
  end if;

  if v_title is null then
    raise exception 'challenge title required';
  end if;

  update public.party_challenges pc
  set status = 'expired'
  where pc.party_id = p_party_id
    and pc.status = 'active'
    and pc.due_at is not null
    and pc.due_at <= now();

  select count(*)::integer
  into v_active_count
  from public.party_challenges pc
  where pc.party_id = p_party_id
    and pc.status = 'active';

  if v_active_count >= 5 then
    raise exception 'active party challenge limit reached';
  end if;

  insert into public.party_challenges (
    party_id,
    created_by,
    title,
    description,
    target_total,
    progress_total,
    xp_reward,
    relic_reward,
    status,
    due_at,
    metadata
  )
  values (
    p_party_id,
    p_user_id,
    v_title,
    nullif(trim(coalesce(p_description, '')), ''),
    v_target,
    0,
    v_xp,
    v_relic,
    'active',
    v_due_at,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning *
  into v_row;

  return v_row;
end;
$$;

create or replace function public.contribute_party_challenge_progress(
  p_user_id uuid,
  p_challenge_id uuid,
  p_progress_delta integer default 1
)
returns table(
  challenge_id uuid,
  challenge_status text,
  progress_total integer,
  target_total integer,
  completed_now boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delta integer := greatest(0, coalesce(p_progress_delta, 0));
  v_row public.party_challenges%rowtype;
  v_next_progress integer := 0;
  v_completed_now boolean := false;
  v_was_distributed boolean := false;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  if v_delta <= 0 then
    raise exception 'progress delta must be positive';
  end if;

  select *
  into v_row
  from public.party_challenges pc
  where pc.id = p_challenge_id
  for update;

  if not found then
    raise exception 'party challenge not found';
  end if;

  if not exists (
    select 1
    from public.dungeon_party_members m
    where m.party_id = v_row.party_id
      and m.user_id = p_user_id
      and m.status in ('joined', 'completed')
  ) then
    raise exception 'not a party member';
  end if;

  if v_row.status = 'active'
     and v_row.due_at is not null
     and v_row.due_at <= now() then
    update public.party_challenges
    set status = 'expired'
    where id = v_row.id;
    v_row.status := 'expired';
  end if;

  if v_row.status <> 'active' then
    return query
    select
      v_row.id,
      v_row.status,
      coalesce(v_row.progress_total, 0),
      coalesce(v_row.target_total, 0),
      false;
    return;
  end if;

  insert into public.party_challenge_contributions (
    challenge_id,
    user_id,
    progress
  )
  values (
    v_row.id,
    p_user_id,
    v_delta
  )
  on conflict (challenge_id, user_id) do update
  set
    progress = public.party_challenge_contributions.progress + excluded.progress,
    updated_at = now();

  v_next_progress := least(coalesce(v_row.target_total, 0), coalesce(v_row.progress_total, 0) + v_delta);
  v_completed_now := v_next_progress >= coalesce(v_row.target_total, 0);
  v_was_distributed := coalesce(v_row.reward_distributed, false);

  update public.party_challenges pc
  set
    progress_total = v_next_progress,
    status = case
      when v_completed_now then 'completed'
      else pc.status
    end,
    completed_at = case
      when v_completed_now then coalesce(pc.completed_at, now())
      else pc.completed_at
    end
  where pc.id = v_row.id
  returning *
  into v_row;

  if v_completed_now and not v_was_distributed then
    insert into public.party_challenge_rewards (
      challenge_id,
      user_id,
      xp_amount,
      relic_amount
    )
    select
      v_row.id,
      m.user_id,
      greatest(0, coalesce(v_row.xp_reward, 0)),
      greatest(0, coalesce(v_row.relic_reward, 0))
    from public.dungeon_party_members m
    where m.party_id = v_row.party_id
      and m.status in ('joined', 'completed')
    on conflict (challenge_id, user_id) do update
    set
      xp_amount = excluded.xp_amount,
      relic_amount = excluded.relic_amount;

    update public.party_challenges
    set reward_distributed = true
    where id = v_row.id
    returning *
    into v_row;
  end if;

  return query
  select
    v_row.id,
    v_row.status,
    coalesce(v_row.progress_total, 0),
    coalesce(v_row.target_total, 0),
    v_completed_now;
end;
$$;

create or replace function public.claim_party_challenge_reward(
  p_user_id uuid,
  p_challenge_id uuid
)
returns table(
  challenge_id uuid,
  claimed boolean,
  xp_awarded integer,
  relics_awarded integer,
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
  v_reward public.party_challenge_rewards%rowtype;
  v_xp integer := 0;
  v_relics integer := 0;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  select *
  into v_reward
  from public.party_challenge_rewards r
  where r.challenge_id = p_challenge_id
    and r.user_id = p_user_id
  for update;

  if not found then
    raise exception 'party challenge reward not found';
  end if;

  if not coalesce(v_reward.claimed, false) then
    v_xp := greatest(0, coalesce(v_reward.xp_amount, 0));

    if v_xp > 0 then
      perform public.award_xp(
        p_user_id,
        v_xp,
        'party_challenge_complete',
        format('party_challenge:%s:%s:xp', p_challenge_id::text, p_user_id::text),
        jsonb_build_object('challenge_id', p_challenge_id)
      );
    end if;

    if coalesce(v_reward.relic_amount, 0) > 0 then
      begin
        select coalesce(granted_count, 0)
        into v_relics
        from public.grant_relic_batch(
          p_user_id,
          greatest(0, coalesce(v_reward.relic_amount, 0)),
          'party_challenge_reward',
          format('party_challenge:%s:%s:relic', p_challenge_id::text, p_user_id::text),
          'rare',
          jsonb_build_object('challenge_id', p_challenge_id)
        )
        limit 1;
      exception
        when undefined_function then
          v_relics := 0;
      end;
    end if;

    update public.party_challenge_rewards
    set
      claimed = true,
      claimed_at = coalesce(claimed_at, now())
    where challenge_id = p_challenge_id
      and user_id = p_user_id;
  end if;

  return query
  select
    p_challenge_id,
    true,
    v_xp,
    v_relics,
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

grant execute on function public.create_party_challenge(uuid, uuid, text, text, integer, integer, integer, timestamptz, jsonb) to authenticated;
grant execute on function public.contribute_party_challenge_progress(uuid, uuid, integer) to authenticated;
grant execute on function public.claim_party_challenge_reward(uuid, uuid) to authenticated;

-- =========================================================
-- REALTIME + POSTGREST RELOAD
-- =========================================================

do $$
declare
  v_table text;
  v_tables text[] := array[
    'focus_sessions',
    'weekly_personal_insights',
    'party_challenges',
    'party_challenge_contributions',
    'party_challenge_rewards'
  ];
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_table in array v_tables loop
      if exists (
        select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = v_table
      ) and not exists (
        select 1
        from pg_publication_tables pt
        where pt.pubname = 'supabase_realtime'
          and pt.schemaname = 'public'
          and pt.tablename = v_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      end if;
    end loop;
  end if;
end;
$$;

notify pgrst, 'reload schema';
