-- Game integrity hardening
-- 1) tamper-resistant XP via RPC
-- 2) interruption persistence
-- 3) active-system conflict constraints
-- 4) streak system
-- 5) indexing for scalability

create extension if not exists pgcrypto;

-- ===== Schema additions =====

alter table public.profiles
  add column if not exists daily_streak integer not null default 0,
  add column if not exists last_active_date date;

alter table public.stats
  add column if not exists interruptions_paused boolean not null default false;

create table if not exists public.xp_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  xp_change integer not null default 0,
  source text not null default 'manual',
  date date not null default current_date,
  created_at timestamptz not null default now()
);

alter table public.xp_logs
  add column if not exists event_id text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

drop index if exists public.xp_logs_user_source_event_unique_idx;
create unique index if not exists xp_logs_user_source_event_unique_idx
  on public.xp_logs (user_id, source, event_id);

alter table public.quests
  add column if not exists progress_current integer not null default 0,
  add column if not exists progress_target integer not null default 100;

alter table public.user_quests
  add column if not exists quest_type text;

update public.user_quests uq
set quest_type = q.type
from public.quests q
where q.id = uq.quest_id
  and (uq.quest_type is null or uq.quest_type <> q.type);

create or replace function public.sync_user_quest_type()
returns trigger
language plpgsql
as $$
begin
  select q.type into new.quest_type
  from public.quests q
  where q.id = new.quest_id;
  return new;
end;
$$;

drop trigger if exists trg_sync_user_quest_type on public.user_quests;
create trigger trg_sync_user_quest_type
before insert or update of quest_id
on public.user_quests
for each row
execute function public.sync_user_quest_type();

-- Keep only latest active weekly quest per user before enforcing uniqueness.
with ranked as (
  select
    uq.id,
    row_number() over (
      partition by uq.user_id
      order by uq.created_at desc nulls last, uq.id desc
    ) as rn
  from public.user_quests uq
  where uq.status = 'active'
    and uq.quest_type = 'weekly'
)
update public.user_quests uq
set status = 'failed',
    completed_date = current_date
from ranked r
where uq.id = r.id
  and r.rn > 1;

create unique index if not exists user_quests_one_active_weekly_idx
  on public.user_quests (user_id)
  where status = 'active' and quest_type = 'weekly';

-- Dungeon run model now supports single active run per user.
with ranked as (
  select
    dr.id,
    row_number() over (
      partition by dr.user_id
      order by dr.created_at desc, dr.id desc
    ) as rn
  from public.dungeon_runs dr
  where dr.status = 'active'
)
update public.dungeon_runs dr
set status = 'quit',
    end_date = current_date
from ranked r
where dr.id = r.id
  and r.rn > 1;

create unique index if not exists dungeon_runs_one_active_idx
  on public.dungeon_runs (user_id)
  where status = 'active';

alter table public.dungeon_runs
  add column if not exists stability integer not null default 100 check (stability >= 0 and stability <= 100),
  add column if not exists interruptions_count integer not null default 0;

create table if not exists public.interruptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  interruption_code text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'ignored', 'expired')),
  started_at timestamptz not null default now(),
  grace_hours integer not null default 6 check (grace_hours > 0),
  reward_xp integer not null default 0,
  penalty_xp integer not null default 0,
  penalty_applied boolean not null default false,
  resolved_at timestamptz,
  event_date date not null default current_date,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Deduplicate before creating unique index.
with ranked as (
  select
    i.id,
    row_number() over (
      partition by i.user_id, i.interruption_code, i.event_date
      order by i.created_at desc nulls last, i.id desc
    ) as rn
  from public.interruptions i
)
delete from public.interruptions i
using ranked r
where i.id = r.id
  and r.rn > 1;

create unique index if not exists interruptions_user_code_day_unique_idx
  on public.interruptions (user_id, interruption_code, event_date);

create index if not exists interruptions_user_status_started_idx
  on public.interruptions (user_id, status, started_at desc);

alter table public.interruptions enable row level security;

drop policy if exists interruptions_select_own on public.interruptions;
create policy interruptions_select_own
on public.interruptions for select
using (auth.uid() = user_id);

drop policy if exists interruptions_insert_own on public.interruptions;
create policy interruptions_insert_own
on public.interruptions for insert
with check (auth.uid() = user_id);

drop policy if exists interruptions_update_own on public.interruptions;
create policy interruptions_update_own
on public.interruptions for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- ===== Indexing =====

create index if not exists profiles_last_active_date_idx
  on public.profiles (last_active_date);

create index if not exists xp_logs_user_created_at_idx
  on public.xp_logs (user_id, created_at desc);

create index if not exists xp_logs_user_source_idx
  on public.xp_logs (user_id, source);

create index if not exists user_quests_user_status_idx
  on public.user_quests (user_id, status);

create index if not exists user_quests_user_created_idx
  on public.user_quests (user_id, created_at desc);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quests'
      and column_name = 'status'
  ) then
    execute 'create index if not exists quests_type_status_idx on public.quests (type, status)';
  else
    execute 'create index if not exists quests_type_idx on public.quests (type)';
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'habit_logs'
      and column_name = 'date'
  ) then
    execute 'create index if not exists habit_logs_user_date_status_idx on public.habit_logs (user_id, date, status)';
  else
    execute 'create index if not exists habit_logs_user_status_created_idx on public.habit_logs (user_id, status, created_at desc)';
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'punishments'
      and column_name = 'created_at'
  ) then
    execute 'create index if not exists punishments_user_status_created_idx on public.punishments (user_id, status, created_at desc)';
  else
    execute 'create index if not exists punishments_user_status_idx on public.punishments (user_id, status)';
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'daily_challenges'
      and column_name = 'date'
  ) then
    execute 'create index if not exists daily_challenges_user_date_idx on public.daily_challenges (user_id, date)';
  else
    execute 'create index if not exists daily_challenges_user_created_idx on public.daily_challenges (user_id, created_at desc)';
  end if;
end;
$$;

create index if not exists stats_user_id_idx
  on public.stats (user_id);

-- ===== Utility functions =====

create or replace function public.compute_level_from_total_xp(p_total_xp bigint)
returns integer
language plpgsql
immutable
as $$
declare
  v_level integer := 0;
begin
  if coalesce(p_total_xp, 0) <= 0 then
    return 0;
  end if;

  while v_level < 1000
    and p_total_xp >= floor(120 * power(v_level + 1, 1.8))::bigint
  loop
    v_level := v_level + 1;
  end loop;

  return v_level;
end;
$$;

create or replace function public.sync_daily_streak(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_today date := current_date;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  select *
  into v_profile
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'profile not found';
  end if;

  if v_profile.last_active_date is null then
    return coalesce(v_profile.daily_streak, 0);
  end if;

  if v_profile.last_active_date < (v_today - 1) and coalesce(v_profile.daily_streak, 0) <> 0 then
    update public.profiles
    set daily_streak = 0
    where id = p_user_id;
    return 0;
  end if;

  return coalesce(v_profile.daily_streak, 0);
end;
$$;

-- ===== Secure XP mutations =====

create or replace function public.award_xp(
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
  v_profile public.profiles%rowtype;
  v_stats public.stats%rowtype;
  v_today date := current_date;
  v_raw_xp integer := greatest(0, coalesce(p_xp_amount, 0));
  v_effective_xp integer;
  v_new_total bigint;
  v_new_level integer;
  v_levels_gained integer;
  v_new_stat_points integer;
  v_debt_before integer := 0;
  v_debt_repaid integer := 0;
  v_next_streak integer;
  v_multiplier numeric := 1.0;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  perform public.sync_daily_streak(p_user_id);

  if p_event_id is not null and exists (
    select 1
    from public.xp_logs x
    where x.user_id = p_user_id
      and x.source = p_source
      and x.event_id = p_event_id
  ) then
    return query
    select
      p.total_xp::bigint,
      p.current_xp::bigint,
      p.level,
      coalesce(p.stat_points, 0),
      coalesce(p.daily_streak, 0),
      p.last_active_date,
      coalesce(s.shadow_debt_xp, 0),
      0
    from public.profiles p
    left join public.stats s on s.user_id = p.id
    where p.id = p_user_id
    limit 1;
    return;
  end if;

  select *
  into v_profile
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'profile not found';
  end if;

  select *
  into v_stats
  from public.stats
  where user_id = p_user_id
  order by created_at desc nulls last
  limit 1
  for update;

  if not found then
    insert into public.stats (user_id, shadow_debt_xp)
    values (p_user_id, 0)
    returning * into v_stats;
  end if;

  if p_source = 'habit_complete' then
    if v_profile.last_active_date is null then
      v_next_streak := 1;
    elsif v_profile.last_active_date = v_today then
      v_next_streak := greatest(1, coalesce(v_profile.daily_streak, 0));
    elsif v_profile.last_active_date = (v_today - 1) then
      v_next_streak := coalesce(v_profile.daily_streak, 0) + 1;
    else
      v_next_streak := 1;
    end if;
    v_multiplier := 1 + least(0.50, greatest(0, (v_next_streak - 1) * 0.02));
    v_raw_xp := floor(v_raw_xp * v_multiplier)::integer;
  else
    v_next_streak := coalesce(v_profile.daily_streak, 0);
  end if;

  v_debt_before := coalesce(v_stats.shadow_debt_xp, 0);
  if v_raw_xp > 0 and v_debt_before > 0 then
    v_debt_repaid := least(v_debt_before, ceil(v_raw_xp * 0.35)::integer);
  else
    v_debt_repaid := 0;
  end if;

  v_effective_xp := greatest(0, v_raw_xp - v_debt_repaid);
  v_new_total := greatest(0, coalesce(v_profile.total_xp, 0) + v_effective_xp);
  v_new_level := public.compute_level_from_total_xp(v_new_total);
  v_levels_gained := greatest(0, v_new_level - coalesce(v_profile.level, 0));
  v_new_stat_points := coalesce(v_profile.stat_points, 0) + (v_levels_gained * 5);

  update public.profiles
  set
    total_xp = v_new_total,
    current_xp = v_new_total,
    level = v_new_level,
    stat_points = v_new_stat_points,
    daily_streak = v_next_streak,
    last_active_date = case when p_source = 'habit_complete' then v_today else v_profile.last_active_date end
  where id = p_user_id;

  if v_debt_repaid > 0 then
    update public.stats
    set shadow_debt_xp = greatest(0, v_debt_before - v_debt_repaid)
    where id = v_stats.id;
  end if;

  insert into public.xp_logs (user_id, xp_change, source, date, event_id, metadata)
  values (
    p_user_id,
    v_effective_xp,
    p_source,
    v_today,
    p_event_id,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'raw_xp', v_raw_xp,
      'debt_repaid', v_debt_repaid,
      'streak_multiplier', v_multiplier
    )
  )
  on conflict (user_id, source, event_id) do nothing;

  return query
  select
    p.total_xp::bigint,
    p.current_xp::bigint,
    p.level,
    coalesce(p.stat_points, 0),
    coalesce(p.daily_streak, 0),
    p.last_active_date,
    coalesce(s.shadow_debt_xp, 0),
    v_debt_repaid
  from public.profiles p
  left join public.stats s on s.user_id = p.id
  where p.id = p_user_id
  limit 1;
end;
$$;

create or replace function public.penalty_xp(
  p_user_id uuid,
  p_xp_amount integer,
  p_source text default 'penalty',
  p_shadow_debt_amount integer default null,
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
  debt_added integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_stats public.stats%rowtype;
  v_today date := current_date;
  v_penalty integer := greatest(0, abs(coalesce(p_xp_amount, 0)));
  v_new_total bigint;
  v_new_level integer;
  v_levels_gained integer;
  v_new_stat_points integer;
  v_debt_added integer;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  perform public.sync_daily_streak(p_user_id);

  if p_event_id is not null and exists (
    select 1
    from public.xp_logs x
    where x.user_id = p_user_id
      and x.source = p_source
      and x.event_id = p_event_id
  ) then
    return query
    select
      p.total_xp::bigint,
      p.current_xp::bigint,
      p.level,
      coalesce(p.stat_points, 0),
      coalesce(p.daily_streak, 0),
      p.last_active_date,
      coalesce(s.shadow_debt_xp, 0),
      0
    from public.profiles p
    left join public.stats s on s.user_id = p.id
    where p.id = p_user_id
    limit 1;
    return;
  end if;

  select *
  into v_profile
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'profile not found';
  end if;

  select *
  into v_stats
  from public.stats
  where user_id = p_user_id
  order by created_at desc nulls last
  limit 1
  for update;

  if not found then
    insert into public.stats (user_id, shadow_debt_xp)
    values (p_user_id, 0)
    returning * into v_stats;
  end if;

  v_new_total := greatest(0, coalesce(v_profile.total_xp, 0) - v_penalty);
  v_new_level := public.compute_level_from_total_xp(v_new_total);
  v_levels_gained := greatest(0, v_new_level - coalesce(v_profile.level, 0));
  v_new_stat_points := coalesce(v_profile.stat_points, 0) + (v_levels_gained * 5);
  v_debt_added := coalesce(p_shadow_debt_amount, ceil(v_penalty * 0.5)::integer);

  update public.profiles
  set
    total_xp = v_new_total,
    current_xp = v_new_total,
    level = v_new_level,
    stat_points = v_new_stat_points
  where id = p_user_id;

  update public.stats
  set shadow_debt_xp = coalesce(shadow_debt_xp, 0) + greatest(0, v_debt_added)
  where id = v_stats.id;

  if p_event_id is not null then
    update public.interruptions
    set
      penalty_applied = true,
      resolved_at = coalesce(resolved_at, now()),
      status = case when status = 'pending' then 'expired' else status end
    where id::text = p_event_id
      and user_id = p_user_id;
  end if;

  insert into public.xp_logs (user_id, xp_change, source, date, event_id, metadata)
  values (
    p_user_id,
    -v_penalty,
    p_source,
    v_today,
    p_event_id,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'debt_added', greatest(0, v_debt_added)
    )
  )
  on conflict (user_id, source, event_id) do nothing;

  return query
  select
    p.total_xp::bigint,
    p.current_xp::bigint,
    p.level,
    coalesce(p.stat_points, 0),
    coalesce(p.daily_streak, 0),
    p.last_active_date,
    coalesce(s.shadow_debt_xp, 0),
    greatest(0, v_debt_added)
  from public.profiles p
  left join public.stats s on s.user_id = p.id
  where p.id = p_user_id
  limit 1;
end;
$$;

create or replace function public.resolve_interruption_timeout(
  p_user_id uuid,
  p_interruption_id uuid,
  p_source text default 'system_interrupt_timeout'
)
returns table(
  penalty_applied boolean,
  remaining_seconds integer,
  total_xp bigint,
  current_xp bigint,
  level integer,
  stat_points integer,
  daily_streak integer,
  last_active_date date,
  shadow_debt_xp integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_interrupt public.interruptions%rowtype;
  v_remaining interval;
  v_seconds integer;
  v_penalty integer;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  select *
  into v_interrupt
  from public.interruptions
  where id = p_interruption_id
    and user_id = p_user_id
  for update;

  if not found then
    raise exception 'interruption not found';
  end if;

  if v_interrupt.penalty_applied or v_interrupt.status in ('accepted', 'expired') then
    return query
    select
      coalesce(v_interrupt.penalty_applied, false),
      0,
      p.total_xp::bigint,
      p.current_xp::bigint,
      p.level,
      coalesce(p.stat_points, 0),
      coalesce(p.daily_streak, 0),
      p.last_active_date,
      coalesce(s.shadow_debt_xp, 0)
    from public.profiles p
    left join public.stats s on s.user_id = p.id
    where p.id = p_user_id
    limit 1;
    return;
  end if;

  v_remaining := (v_interrupt.started_at + make_interval(hours => v_interrupt.grace_hours)) - now();
  v_seconds := greatest(0, floor(extract(epoch from v_remaining))::integer);
  if v_seconds > 0 then
    return query
    select
      false,
      v_seconds,
      p.total_xp::bigint,
      p.current_xp::bigint,
      p.level,
      coalesce(p.stat_points, 0),
      coalesce(p.daily_streak, 0),
      p.last_active_date,
      coalesce(s.shadow_debt_xp, 0)
    from public.profiles p
    left join public.stats s on s.user_id = p.id
    where p.id = p_user_id
    limit 1;
    return;
  end if;

  v_penalty := greatest(0, coalesce(v_interrupt.penalty_xp, 0));
  perform public.penalty_xp(
    p_user_id,
    v_penalty,
    p_source,
    ceil(v_penalty * 0.25)::integer,
    v_interrupt.id::text,
    jsonb_build_object(
      'interruption_code', v_interrupt.interruption_code,
      'timeout', true
    )
  );

  update public.interruptions
  set
    status = 'expired',
    penalty_applied = true,
    resolved_at = coalesce(resolved_at, now())
  where id = v_interrupt.id
    and user_id = p_user_id;

  return query
  select
    true,
    0,
    p.total_xp::bigint,
    p.current_xp::bigint,
    p.level,
    coalesce(p.stat_points, 0),
    coalesce(p.daily_streak, 0),
    p.last_active_date,
    coalesce(s.shadow_debt_xp, 0)
  from public.profiles p
  left join public.stats s on s.user_id = p.id
  where p.id = p_user_id
  limit 1;
end;
$$;

grant execute on function public.sync_daily_streak(uuid) to authenticated;
grant execute on function public.award_xp(uuid, integer, text, text, jsonb) to authenticated;
grant execute on function public.penalty_xp(uuid, integer, text, integer, text, jsonb) to authenticated;
grant execute on function public.resolve_interruption_timeout(uuid, uuid, text) to authenticated;
