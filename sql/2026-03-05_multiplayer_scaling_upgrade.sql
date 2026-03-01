-- Multiplayer scaling + server-timer hardening
-- 1) Quest timers + one-time XP decay on expiry
-- 2) Expanded XP history support
-- 3) Habit subtasks with partial XP RPC
-- 4) Punishment accumulation + expiry/early-resolution RPC
-- 5) Public profile sharing model
-- 6) Collaborative dungeon parties baseline
-- 7) Friends table + sync from friend_requests
-- 8) Realtime publication + indexing

create extension if not exists pgcrypto;

-- =========================================================
-- QUEST TIMERS + XP DECAY
-- =========================================================

alter table public.user_quests
  add column if not exists started_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists failed boolean not null default false,
  add column if not exists xp_reward integer not null default 0,
  add column if not exists penalty_applied boolean not null default false,
  add column if not exists failure_reason text;

alter table public.user_quests
  add column if not exists quest_type text;

create or replace function public.quest_duration_interval(p_quest_type text)
returns interval
language sql
immutable
as $$
  select case lower(coalesce(p_quest_type, 'daily'))
    when 'weekly' then interval '7 days'
    when 'special' then interval '30 days'
    when 'epic' then interval '45 days'
    else interval '1 day'
  end;
$$;

create or replace function public.sync_user_quest_timer_fields()
returns trigger
language plpgsql
as $$
declare
  v_type text;
  v_xp integer := 0;
begin
  if new.quest_id is not null then
    select q.type, coalesce(q.xp_reward, 0)
    into v_type, v_xp
    from public.quests q
    where q.id = new.quest_id;
  end if;

  new.quest_type := coalesce(new.quest_type, v_type, 'daily');
  if coalesce(new.xp_reward, 0) <= 0 then
    new.xp_reward := coalesce(v_xp, 0);
  end if;

  if new.status = 'active' then
    new.failed := false;
    if new.started_at is null then
      new.started_at := now();
    end if;
    if new.expires_at is null then
      new.expires_at := new.started_at + public.quest_duration_interval(new.quest_type);
    end if;
  end if;

  if new.status = 'failed' then
    new.failed := true;
    new.completed_date := coalesce(new.completed_date, current_date);
  end if;

  if new.status = 'completed' then
    new.completed_date := coalesce(new.completed_date, current_date);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_user_quest_timer_fields on public.user_quests;
create trigger trg_sync_user_quest_timer_fields
before insert or update of status, quest_id, quest_type, started_at, expires_at
on public.user_quests
for each row
execute function public.sync_user_quest_timer_fields();

update public.user_quests uq
set
  quest_type = coalesce(uq.quest_type, q.type, 'daily'),
  started_at = coalesce(uq.started_at, uq.created_at, now()),
  expires_at = coalesce(
    uq.expires_at,
    coalesce(uq.started_at, uq.created_at, now()) + public.quest_duration_interval(coalesce(uq.quest_type, q.type, 'daily'))
  ),
  xp_reward = case
    when coalesce(uq.xp_reward, 0) > 0 then uq.xp_reward
    else coalesce(q.xp_reward, 0)
  end,
  failed = coalesce(uq.failed, false) or uq.status = 'failed'
from public.quests q
where q.id = uq.quest_id
  and (
    uq.quest_type is null
    or uq.started_at is null
    or uq.expires_at is null
    or coalesce(uq.xp_reward, 0) <= 0
    or uq.status = 'failed'
  );

create index if not exists user_quests_user_status_expires_idx
  on public.user_quests (user_id, status, expires_at);

create index if not exists user_quests_user_failed_idx
  on public.user_quests (user_id, failed, created_at desc);

create or replace function public.activate_user_quest(
  p_user_id uuid,
  p_quest_id uuid,
  p_started_at timestamptz default now()
)
returns public.user_quests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quest public.quests%rowtype;
  v_result public.user_quests%rowtype;
  v_started timestamptz := coalesce(p_started_at, now());
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  select *
  into v_quest
  from public.quests
  where id = p_quest_id;

  if not found then
    raise exception 'quest not found';
  end if;

  if coalesce(v_quest.type, 'daily') = 'weekly'
     and exists (
       select 1
       from public.user_quests uq
       where uq.user_id = p_user_id
         and uq.status = 'active'
         and coalesce(uq.quest_type, 'daily') = 'weekly'
         and uq.quest_id <> p_quest_id
     ) then
    raise exception 'weekly quest already active';
  end if;

  update public.user_quests uq
  set
    status = 'active',
    failed = false,
    failure_reason = null,
    penalty_applied = false,
    started_at = coalesce(uq.started_at, v_started),
    expires_at = coalesce(uq.expires_at, v_started + public.quest_duration_interval(coalesce(uq.quest_type, v_quest.type, 'daily'))),
    quest_type = coalesce(uq.quest_type, v_quest.type, 'daily'),
    xp_reward = case
      when coalesce(uq.xp_reward, 0) > 0 then uq.xp_reward
      else coalesce(v_quest.xp_reward, 0)
    end,
    date = coalesce(uq.date, current_date)
  where uq.user_id = p_user_id
    and uq.quest_id = p_quest_id
  returning *
  into v_result;

  if not found then
    insert into public.user_quests (
      user_id,
      quest_id,
      status,
      date,
      quest_type,
      started_at,
      expires_at,
      xp_reward,
      failed,
      penalty_applied
    )
    values (
      p_user_id,
      p_quest_id,
      'active',
      current_date,
      coalesce(v_quest.type, 'daily'),
      v_started,
      v_started + public.quest_duration_interval(coalesce(v_quest.type, 'daily')),
      coalesce(v_quest.xp_reward, 0),
      false,
      false
    )
    returning *
    into v_result;
  end if;

  return v_result;
end;
$$;

create or replace function public.resolve_expired_quests(
  p_user_id uuid,
  p_source text default 'quest_timeout',
  p_decay_factor numeric default 0.50
)
returns table(
  failed_count integer,
  total_penalty integer,
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
  v_row record;
  v_penalty integer := 0;
  v_failed_count integer := 0;
  v_total_penalty integer := 0;
  v_safe_decay numeric := greatest(0, least(1, coalesce(p_decay_factor, 0.50)));
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  for v_row in
    select
      uq.id,
      uq.user_id,
      uq.quest_id,
      uq.status,
      uq.expires_at,
      uq.penalty_applied,
      coalesce(nullif(uq.xp_reward, 0), q.xp_reward, 0) as effective_xp
    from public.user_quests uq
    left join public.quests q on q.id = uq.quest_id
    where uq.user_id = p_user_id
      and uq.status = 'active'
      and uq.expires_at is not null
      and uq.expires_at <= now()
      and coalesce(uq.failed, false) = false
    for update of uq skip locked
  loop
    update public.user_quests
    set
      status = 'failed',
      failed = true,
      failure_reason = 'expired',
      completed_date = coalesce(completed_date, current_date)
    where id = v_row.id
      and user_id = p_user_id;

    v_failed_count := v_failed_count + 1;

    if not coalesce(v_row.penalty_applied, false) then
      v_penalty := greatest(0, floor(coalesce(v_row.effective_xp, 0) * v_safe_decay)::integer);

      if v_penalty > 0 then
        perform public.penalty_xp(
          p_user_id,
          v_penalty,
          p_source,
          ceil(v_penalty * 0.25)::integer,
          'quest_timeout:' || v_row.id::text,
          jsonb_build_object(
            'user_quest_id', v_row.id,
            'quest_id', v_row.quest_id,
            'expired_at', now()
          )
        );
      end if;

      update public.user_quests
      set penalty_applied = true
      where id = v_row.id
        and user_id = p_user_id;

      v_total_penalty := v_total_penalty + v_penalty;
    end if;
  end loop;

  if exists (select 1 from public.profiles p where p.id = p_user_id) then
    return query
    select
      v_failed_count,
      v_total_penalty,
      p.total_xp::bigint,
      p.current_xp::bigint,
      p.level,
      coalesce(s.shadow_debt_xp, 0)
    from public.profiles p
    left join public.stats s on s.user_id = p.id
    where p.id = p_user_id
    limit 1;
  else
    return query
    select v_failed_count, v_total_penalty, 0::bigint, 0::bigint, 0, 0;
  end if;
end;
$$;

grant execute on function public.activate_user_quest(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.resolve_expired_quests(uuid, text, numeric) to authenticated;

-- =========================================================
-- XP LOG HISTORY SUPPORT
-- =========================================================

alter table public.xp_logs
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists xp_logs_user_created_desc_idx
  on public.xp_logs (user_id, created_at desc);

create index if not exists xp_logs_user_source_created_idx
  on public.xp_logs (user_id, source, created_at desc);

-- =========================================================
-- HABIT SUBTASKS
-- =========================================================

create table if not exists public.habit_subtasks (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references public.habits(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  completed boolean not null default false,
  xp_value integer not null default 10,
  sort_order integer not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists habit_subtasks_user_habit_idx
  on public.habit_subtasks (user_id, habit_id, completed, created_at desc);

create or replace function public.sync_habit_subtask_user_id()
returns trigger
language plpgsql
as $$
declare
  v_owner uuid;
begin
  select h.user_id into v_owner
  from public.habits h
  where h.id = new.habit_id;

  if v_owner is null then
    raise exception 'habit not found';
  end if;

  new.user_id := v_owner;
  if new.completed and new.completed_at is null then
    new.completed_at := now();
  elsif not new.completed then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_habit_subtask_user_id on public.habit_subtasks;
create trigger trg_sync_habit_subtask_user_id
before insert or update of habit_id, completed
on public.habit_subtasks
for each row
execute function public.sync_habit_subtask_user_id();

alter table public.habit_subtasks enable row level security;

drop policy if exists habit_subtasks_select_own on public.habit_subtasks;
create policy habit_subtasks_select_own
on public.habit_subtasks for select
using (auth.uid() = user_id);

drop policy if exists habit_subtasks_insert_own on public.habit_subtasks;
create policy habit_subtasks_insert_own
on public.habit_subtasks for insert
with check (auth.uid() = user_id);

drop policy if exists habit_subtasks_update_own on public.habit_subtasks;
create policy habit_subtasks_update_own
on public.habit_subtasks for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists habit_subtasks_delete_own on public.habit_subtasks;
create policy habit_subtasks_delete_own
on public.habit_subtasks for delete
using (auth.uid() = user_id);

create or replace function public.complete_habit_subtask(
  p_user_id uuid,
  p_subtask_id uuid,
  p_complete boolean default true
)
returns table(
  subtask_id uuid,
  habit_id uuid,
  subtask_completed boolean,
  habit_completed boolean,
  xp_applied integer,
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
  v_subtask public.habit_subtasks%rowtype;
  v_habit public.habits%rowtype;
  v_all_done boolean := false;
  v_xp_applied integer := 0;
  v_rows integer := 0;
  v_habit_event_id text;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  select *
  into v_subtask
  from public.habit_subtasks
  where id = p_subtask_id
    and user_id = p_user_id
  for update;

  if not found then
    raise exception 'subtask not found';
  end if;

  select *
  into v_habit
  from public.habits
  where id = v_subtask.habit_id
    and user_id = p_user_id;

  if not found then
    raise exception 'habit not found';
  end if;

  if not p_complete then
    update public.habit_subtasks
    set completed = false, completed_at = null
    where id = v_subtask.id
      and user_id = p_user_id;
  elsif not coalesce(v_subtask.completed, false) then
    update public.habit_subtasks
    set completed = true, completed_at = now()
    where id = v_subtask.id
      and user_id = p_user_id;

    v_xp_applied := greatest(0, coalesce(v_subtask.xp_value, 0));
    if v_xp_applied > 0 then
      perform public.award_xp(
        p_user_id,
        v_xp_applied,
        'habit_subtask_complete',
        'habit_subtask:' || v_subtask.id::text,
        jsonb_build_object(
          'habit_subtask_id', v_subtask.id,
          'habit_id', v_subtask.habit_id
        )
      );
    end if;
  end if;

  select
    count(*) > 0
    and count(*) = count(*) filter (where completed)
  into v_all_done
  from public.habit_subtasks
  where habit_id = v_subtask.habit_id
    and user_id = p_user_id;

  if v_all_done then
    begin
      execute $sql$
        update public.habit_logs
        set status = 'completed'
        where user_id = $1
          and habit_id = $2
          and coalesce(date::date, (created_at at time zone 'utc')::date) = current_date
      $sql$
      using p_user_id, v_subtask.habit_id;
      get diagnostics v_rows = row_count;
    exception
      when undefined_column then
        execute $sql$
          update public.habit_logs
          set status = 'completed'
          where user_id = $1
            and habit_id = $2
            and (created_at at time zone 'utc')::date = current_date
        $sql$
        using p_user_id, v_subtask.habit_id;
        get diagnostics v_rows = row_count;
    end;

    if v_rows = 0 then
      begin
        execute $sql$
          insert into public.habit_logs (user_id, habit_id, status, date)
          values ($1, $2, 'completed', current_date)
        $sql$
        using p_user_id, v_subtask.habit_id;
      exception
        when undefined_column then
          execute $sql$
            insert into public.habit_logs (user_id, habit_id, status)
            values ($1, $2, 'completed')
          $sql$
          using p_user_id, v_subtask.habit_id;
      end;
    end if;

    v_habit_event_id := 'habit_complete:' || v_subtask.habit_id::text || ':' || current_date::text;
    perform public.award_xp(
      p_user_id,
      greatest(0, coalesce(v_habit.xp_value, 0)),
      'habit_complete',
      v_habit_event_id,
      jsonb_build_object(
        'habit_id', v_subtask.habit_id,
        'source', 'habit_subtasks'
      )
    );
  end if;

  return query
  select
    v_subtask.id,
    v_subtask.habit_id,
    coalesce((select hs.completed from public.habit_subtasks hs where hs.id = v_subtask.id), false),
    v_all_done,
    v_xp_applied,
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

grant execute on function public.complete_habit_subtask(uuid, uuid, boolean) to authenticated;

-- =========================================================
-- PUNISHMENT ACCUMULATION
-- =========================================================

alter table public.punishments
  add column if not exists reason text,
  add column if not exists total_xp_penalty integer not null default 0,
  add column if not exists accumulated_penalty integer not null default 0,
  add column if not exists started_at timestamptz not null default now(),
  add column if not exists expires_at timestamptz,
  add column if not exists resolved boolean not null default false,
  add column if not exists resolved_at timestamptz,
  add column if not exists penalty_applied boolean not null default false,
  add column if not exists warning_notified boolean not null default false,
  add column if not exists urgency_notified boolean not null default false;

update public.punishments
set
  started_at = coalesce(started_at, created_at, now()),
  expires_at = coalesce(expires_at, coalesce(started_at, created_at, now()) + interval '8 hours'),
  total_xp_penalty = coalesce(nullif(total_xp_penalty, 0), accumulated_penalty, 0),
  accumulated_penalty = coalesce(accumulated_penalty, 0),
  resolved = coalesce(resolved, false) or status in ('completed', 'refused', 'timed_out'),
  penalty_applied = coalesce(penalty_applied, false) or status = 'timed_out',
  resolved_at = case
    when resolved_at is not null then resolved_at
    when status in ('completed', 'refused', 'timed_out') then coalesce(created_at, now())
    else null
  end
where
  expires_at is null
  or started_at is null
  or total_xp_penalty is null
  or accumulated_penalty is null
  or resolved_at is null
  or resolved = false and status in ('completed', 'refused', 'timed_out');

create index if not exists punishments_user_status_expires_idx
  on public.punishments (user_id, status, expires_at);

create index if not exists punishments_user_resolved_expires_idx
  on public.punishments (user_id, resolved, penalty_applied, expires_at);

create or replace function public.resolve_expired_punishments(
  p_user_id uuid,
  p_source text default 'punishment_timeout'
)
returns table(
  resolved_count integer,
  total_penalty integer,
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
  v_row record;
  v_penalty integer := 0;
  v_resolved_count integer := 0;
  v_total_penalty integer := 0;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  for v_row in
    select p.*
    from public.punishments p
    where p.user_id = p_user_id
      and coalesce(p.resolved, false) = false
      and coalesce(p.penalty_applied, false) = false
      and coalesce(p.expires_at, p.started_at + interval '8 hours') <= now()
    for update skip locked
  loop
    v_penalty := greatest(0, coalesce(v_row.total_xp_penalty, v_row.accumulated_penalty, 0));

    if v_penalty > 0 then
      perform public.penalty_xp(
        p_user_id,
        v_penalty,
        p_source,
        ceil(v_penalty * 0.25)::integer,
        'punishment_timeout:' || v_row.id::text,
        jsonb_build_object('punishment_id', v_row.id, 'timeout', true)
      );
      v_total_penalty := v_total_penalty + v_penalty;
    end if;

    update public.punishments
    set
      status = 'timed_out',
      resolved = true,
      penalty_applied = true,
      resolved_at = coalesce(resolved_at, now())
    where id = v_row.id
      and user_id = p_user_id;

    v_resolved_count := v_resolved_count + 1;
  end loop;

  if exists (select 1 from public.profiles p where p.id = p_user_id) then
    return query
    select
      v_resolved_count,
      v_total_penalty,
      p.total_xp::bigint,
      p.current_xp::bigint,
      p.level,
      coalesce(s.shadow_debt_xp, 0)
    from public.profiles p
    left join public.stats s on s.user_id = p.id
    where p.id = p_user_id
    limit 1;
  else
    return query
    select v_resolved_count, v_total_penalty, 0::bigint, 0::bigint, 0, 0;
  end if;
end;
$$;

create or replace function public.resolve_punishment_early(
  p_user_id uuid,
  p_punishment_id uuid,
  p_source text default 'punishment_resolved_early'
)
returns table(
  applied_penalty integer,
  reduced_by integer,
  remaining_seconds integer,
  punishment_status text,
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
  v_row public.punishments%rowtype;
  v_total integer := 0;
  v_window_seconds integer := 1;
  v_remaining_seconds integer := 0;
  v_reduction_pct numeric := 0;
  v_applied integer := 0;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  select *
  into v_row
  from public.punishments
  where id = p_punishment_id
    and user_id = p_user_id
  for update;

  if not found then
    raise exception 'punishment not found';
  end if;

  if coalesce(v_row.penalty_applied, false) or coalesce(v_row.resolved, false) then
    v_remaining_seconds := greatest(
      0,
      floor(extract(epoch from (coalesce(v_row.expires_at, now()) - now())))::integer
    );
    return query
    select
      0,
      0,
      v_remaining_seconds,
      coalesce(v_row.status, 'completed'),
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

  v_total := greatest(0, coalesce(v_row.total_xp_penalty, v_row.accumulated_penalty, 0));
  v_window_seconds := greatest(
    1,
    floor(
      extract(
        epoch from (
          coalesce(v_row.expires_at, v_row.started_at + interval '8 hours')
          - coalesce(v_row.started_at, v_row.created_at, now())
        )
      )
    )::integer
  );
  v_remaining_seconds := greatest(
    0,
    floor(extract(epoch from (coalesce(v_row.expires_at, now()) - now())))::integer
  );

  -- Up to 60% reduction if solved immediately, decreasing linearly toward expiry.
  v_reduction_pct := least(0.60, greatest(0, (v_remaining_seconds::numeric / v_window_seconds::numeric) * 0.60));
  v_applied := greatest(0, floor(v_total * (1 - v_reduction_pct))::integer);

  if v_applied > 0 then
    perform public.penalty_xp(
      p_user_id,
      v_applied,
      p_source,
      ceil(v_applied * 0.20)::integer,
      'punishment_resolve:' || v_row.id::text,
      jsonb_build_object(
        'punishment_id', v_row.id,
        'base_penalty', v_total,
        'reduction_pct', v_reduction_pct
      )
    );
  end if;

  update public.punishments
  set
    status = 'completed',
    resolved = true,
    penalty_applied = true,
    accumulated_penalty = v_applied,
    resolved_at = coalesce(resolved_at, now())
  where id = v_row.id
    and user_id = p_user_id;

  return query
  select
    v_applied,
    greatest(0, v_total - v_applied),
    v_remaining_seconds,
    'completed'::text,
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

grant execute on function public.resolve_expired_punishments(uuid, text) to authenticated;
grant execute on function public.resolve_punishment_early(uuid, uuid, text) to authenticated;

-- =========================================================
-- PUBLIC PROFILE SHARING
-- =========================================================

create table if not exists public.public_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
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

create index if not exists public_profiles_username_idx
  on public.public_profiles (username);

create index if not exists public_profiles_is_public_idx
  on public.public_profiles (is_public, updated_at desc);

create or replace function public.refresh_public_profile(p_user_id uuid)
returns public.public_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_row public.public_profiles%rowtype;
  v_username_base text;
  v_username text;
  v_stats jsonb;
  v_dungeon jsonb;
  v_profile_json jsonb;
begin
  select *
  into v_profile
  from public.profiles
  where id = p_user_id;

  if not found then
    raise exception 'profile not found';
  end if;

  v_profile_json := to_jsonb(v_profile);

  v_username_base := coalesce(
    nullif(v_profile.user_code, ''),
    nullif(v_profile.name, ''),
    left(replace(p_user_id::text, '-', ''), 12)
  );

  v_username := lower(regexp_replace(v_username_base, '[^a-zA-Z0-9_]+', '-', 'g'));
  if v_username is null or btrim(v_username) = '' then
    v_username := left(replace(p_user_id::text, '-', ''), 12);
  end if;

  v_stats := jsonb_build_object(
    'strength', coalesce(v_profile.stat_strength, 0),
    'discipline', coalesce(v_profile.stat_discipline, 0),
    'knowledge', coalesce(
      nullif(v_profile_json->>'stat_knowledge', '')::integer,
      nullif(v_profile_json->>'stat_intelligence', '')::integer,
      0
    ),
    'health', coalesce(v_profile.stat_health, 0),
    'social', coalesce(v_profile.stat_social, 0),
    'career', coalesce(v_profile.stat_career, 0),
    'consistency', coalesce(v_profile.stat_consistency, 0)
  );

  select jsonb_build_object(
    'completed', count(*) filter (where status = 'completed'),
    'failed', count(*) filter (where status = 'failed'),
    'active', count(*) filter (where status = 'active'),
    'best_completed_days', coalesce(max(completed_days), 0)
  )
  into v_dungeon
  from public.dungeon_runs
  where user_id = p_user_id;

  insert into public.public_profiles (
    user_id,
    username,
    avatar_url,
    level,
    total_xp,
    stat_distribution,
    dungeon_achievements,
    streak_count,
    is_public,
    updated_at
  )
  values (
    p_user_id,
    v_username,
    nullif(v_profile.avatar_url, ''),
    coalesce(v_profile.level, 0),
    coalesce(v_profile.total_xp, 0),
    coalesce(v_stats, '{}'::jsonb),
    coalesce(v_dungeon, '{}'::jsonb),
    coalesce(v_profile.daily_streak, 0),
    false,
    now()
  )
  on conflict (user_id) do update
  set
    username = excluded.username,
    avatar_url = excluded.avatar_url,
    level = excluded.level,
    total_xp = excluded.total_xp,
    stat_distribution = excluded.stat_distribution,
    dungeon_achievements = excluded.dungeon_achievements,
    streak_count = excluded.streak_count,
    updated_at = now()
  returning *
  into v_row;

  return v_row;
end;
$$;

create or replace function public.set_public_profile_visibility(
  p_user_id uuid,
  p_is_public boolean
)
returns public.public_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.public_profiles%rowtype;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  perform public.refresh_public_profile(p_user_id);

  update public.public_profiles
  set
    is_public = coalesce(p_is_public, false),
    updated_at = now()
  where user_id = p_user_id
  returning *
  into v_row;

  return v_row;
end;
$$;

create or replace function public.trg_refresh_public_profile_from_profile()
returns trigger
language plpgsql
as $$
begin
  begin
    perform public.refresh_public_profile(new.id);
  exception
    when others then
      null;
  end;
  return new;
end;
$$;

drop trigger if exists trg_refresh_public_profile_from_profile on public.profiles;
do $$
declare
  v_cols text;
  v_sql text;
begin
  select string_agg(quote_ident(c.column_name), ', ' order by c.ord)
  into v_cols
  from (
    select
      ic.column_name,
      case ic.column_name
        when 'user_code' then 1
        when 'name' then 2
        when 'avatar_url' then 3
        when 'level' then 4
        when 'total_xp' then 5
        when 'stat_strength' then 6
        when 'stat_discipline' then 7
        when 'stat_knowledge' then 8
        when 'stat_intelligence' then 9
        when 'stat_health' then 10
        when 'stat_social' then 11
        when 'stat_career' then 12
        when 'stat_consistency' then 13
        when 'daily_streak' then 14
        else 999
      end as ord
    from information_schema.columns ic
    where ic.table_schema = 'public'
      and ic.table_name = 'profiles'
      and ic.column_name in (
        'user_code',
        'name',
        'avatar_url',
        'level',
        'total_xp',
        'stat_strength',
        'stat_discipline',
        'stat_knowledge',
        'stat_intelligence',
        'stat_health',
        'stat_social',
        'stat_career',
        'stat_consistency',
        'daily_streak'
      )
  ) c;

  if v_cols is null or btrim(v_cols) = '' then
    v_sql := '
      create trigger trg_refresh_public_profile_from_profile
      after insert or update
      on public.profiles
      for each row
      execute function public.trg_refresh_public_profile_from_profile()
    ';
  else
    v_sql := format(
      '
      create trigger trg_refresh_public_profile_from_profile
      after insert or update of %s
      on public.profiles
      for each row
      execute function public.trg_refresh_public_profile_from_profile()
      ',
      v_cols
    );
  end if;

  execute v_sql;
end;
$$;

create or replace function public.trg_refresh_public_profile_from_dungeon()
returns trigger
language plpgsql
as $$
declare
  v_user_id uuid;
begin
  v_user_id := coalesce(new.user_id, old.user_id);
  if v_user_id is not null then
    begin
      perform public.refresh_public_profile(v_user_id);
    exception
      when others then
        null;
    end;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_refresh_public_profile_from_dungeon on public.dungeon_runs;
create trigger trg_refresh_public_profile_from_dungeon
after insert or update or delete
on public.dungeon_runs
for each row
execute function public.trg_refresh_public_profile_from_dungeon();

alter table public.public_profiles enable row level security;

drop policy if exists public_profiles_select_policy on public.public_profiles;
create policy public_profiles_select_policy
on public.public_profiles for select
using (is_public = true or auth.uid() = user_id);

drop policy if exists public_profiles_insert_policy on public.public_profiles;
create policy public_profiles_insert_policy
on public.public_profiles for insert
with check (auth.uid() = user_id);

drop policy if exists public_profiles_update_policy on public.public_profiles;
create policy public_profiles_update_policy
on public.public_profiles for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists public_profiles_delete_policy on public.public_profiles;
create policy public_profiles_delete_policy
on public.public_profiles for delete
using (auth.uid() = user_id);

grant execute on function public.refresh_public_profile(uuid) to authenticated;
grant execute on function public.set_public_profile_visibility(uuid, boolean) to authenticated;

-- =========================================================
-- COLLABORATIVE DUNGEON MODE
-- =========================================================

alter table public.dungeon_runs
  add column if not exists mode text not null default 'solo',
  add column if not exists party_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dungeon_runs_mode_check'
      and conrelid = 'public.dungeon_runs'::regclass
  ) then
    alter table public.dungeon_runs
      add constraint dungeon_runs_mode_check
      check (mode in ('solo', 'collab'));
  end if;
end;
$$;

create table if not exists public.dungeon_parties (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references auth.users(id) on delete cascade,
  dungeon_id uuid,
  title text,
  status text not null default 'waiting' check (status in ('waiting', 'active', 'completed')),
  shared_progress integer not null default 0 check (shared_progress >= 0 and shared_progress <= 100),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create table if not exists public.dungeon_party_members (
  party_id uuid not null references public.dungeon_parties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  status text not null default 'joined' check (status in ('joined', 'left', 'failed', 'completed')),
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

create index if not exists dungeon_parties_host_status_idx
  on public.dungeon_parties (host_user_id, status, created_at desc);

create index if not exists dungeon_parties_status_created_idx
  on public.dungeon_parties (status, created_at desc);

create index if not exists dungeon_party_members_user_status_idx
  on public.dungeon_party_members (user_id, status, joined_at desc);

create index if not exists dungeon_party_rewards_user_claimed_idx
  on public.dungeon_party_rewards (user_id, claimed, created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dungeon_runs_party_id_fkey'
      and conrelid = 'public.dungeon_runs'::regclass
  ) then
    alter table public.dungeon_runs
      add constraint dungeon_runs_party_id_fkey
      foreign key (party_id) references public.dungeon_parties(id) on delete set null;
  end if;
end;
$$;

alter table public.dungeon_parties enable row level security;
alter table public.dungeon_party_members enable row level security;
alter table public.dungeon_party_rewards enable row level security;

drop policy if exists dungeon_parties_select_policy on public.dungeon_parties;
create policy dungeon_parties_select_policy
on public.dungeon_parties for select
using (
  auth.uid() = host_user_id
  or exists (
    select 1
    from public.dungeon_party_members m
    where m.party_id = id
      and m.user_id = auth.uid()
  )
);

drop policy if exists dungeon_parties_insert_policy on public.dungeon_parties;
create policy dungeon_parties_insert_policy
on public.dungeon_parties for insert
with check (auth.uid() = host_user_id);

drop policy if exists dungeon_parties_update_policy on public.dungeon_parties;
create policy dungeon_parties_update_policy
on public.dungeon_parties for update
using (auth.uid() = host_user_id)
with check (auth.uid() = host_user_id);

drop policy if exists dungeon_party_members_select_policy on public.dungeon_party_members;
create policy dungeon_party_members_select_policy
on public.dungeon_party_members for select
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.dungeon_parties p
    where p.id = party_id
      and p.host_user_id = auth.uid()
  )
);

drop policy if exists dungeon_party_members_insert_policy on public.dungeon_party_members;
create policy dungeon_party_members_insert_policy
on public.dungeon_party_members for insert
with check (auth.uid() = user_id);

drop policy if exists dungeon_party_members_update_policy on public.dungeon_party_members;
create policy dungeon_party_members_update_policy
on public.dungeon_party_members for update
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.dungeon_parties p
    where p.id = party_id
      and p.host_user_id = auth.uid()
  )
)
with check (
  auth.uid() = user_id
  or exists (
    select 1
    from public.dungeon_parties p
    where p.id = party_id
      and p.host_user_id = auth.uid()
  )
);

drop policy if exists dungeon_party_rewards_select_policy on public.dungeon_party_rewards;
create policy dungeon_party_rewards_select_policy
on public.dungeon_party_rewards for select
using (auth.uid() = user_id);

drop policy if exists dungeon_party_rewards_update_policy on public.dungeon_party_rewards;
create policy dungeon_party_rewards_update_policy
on public.dungeon_party_rewards for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.create_dungeon_party(
  p_user_id uuid,
  p_dungeon_id uuid default null,
  p_title text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party_id uuid;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  if exists (
    select 1
    from public.dungeon_runs dr
    where dr.user_id = p_user_id
      and dr.status = 'active'
  ) then
    raise exception 'user already has active dungeon';
  end if;

  insert into public.dungeon_parties (host_user_id, dungeon_id, title, status)
  values (p_user_id, p_dungeon_id, nullif(p_title, ''), 'waiting')
  returning id
  into v_party_id;

  insert into public.dungeon_party_members (party_id, user_id, role, status)
  values (v_party_id, p_user_id, 'host', 'joined')
  on conflict (party_id, user_id) do update
  set role = excluded.role, status = 'joined';

  return v_party_id;
end;
$$;

create or replace function public.join_dungeon_party(
  p_user_id uuid,
  p_party_id uuid,
  p_role text default 'member'
)
returns table(
  party_id uuid,
  party_status text,
  member_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party public.dungeon_parties%rowtype;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  if exists (
    select 1
    from public.dungeon_runs dr
    where dr.user_id = p_user_id
      and dr.status = 'active'
  ) then
    raise exception 'user already has active dungeon';
  end if;

  select *
  into v_party
  from public.dungeon_parties
  where id = p_party_id
  for update;

  if not found then
    raise exception 'party not found';
  end if;

  if v_party.status <> 'waiting' then
    raise exception 'party is not joinable';
  end if;

  insert into public.dungeon_party_members (party_id, user_id, role, status)
  values (p_party_id, p_user_id, coalesce(nullif(p_role, ''), 'member'), 'joined')
  on conflict (party_id, user_id) do update
  set status = 'joined', role = excluded.role, joined_at = now();

  return query
  select
    v_party.id,
    v_party.status,
    count(*)::integer
  from public.dungeon_party_members m
  where m.party_id = v_party.id
    and m.status in ('joined', 'completed')
  group by v_party.id, v_party.status;
end;
$$;

create or replace function public.start_dungeon_party(
  p_user_id uuid,
  p_party_id uuid,
  p_duration_days integer default 7,
  p_xp_multiplier numeric default 1.5
)
returns table(
  party_id uuid,
  party_status text,
  started_at timestamptz,
  member_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party public.dungeon_parties%rowtype;
  v_duration integer := greatest(1, coalesce(p_duration_days, 7));
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  select *
  into v_party
  from public.dungeon_parties
  where id = p_party_id
    and host_user_id = p_user_id
  for update;

  if not found then
    raise exception 'party not found or not host';
  end if;

  if v_party.status <> 'waiting' then
    raise exception 'party already started';
  end if;

  update public.dungeon_parties
  set
    status = 'active',
    started_at = coalesce(started_at, now())
  where id = p_party_id;

  insert into public.dungeon_runs (
    user_id,
    challenge_title,
    challenge_description,
    start_date,
    end_date,
    status,
    xp_bonus_multiplier,
    punishment_mode,
    custom_punishment_text,
    duration_days,
    completed_days,
    stability,
    interruptions_count,
    mode,
    party_id
  )
  select
    m.user_id,
    coalesce(v_party.title, 'Collaborative Dungeon'),
    'Complete party objectives together',
    current_date,
    (current_date + v_duration),
    'active',
    greatest(1, coalesce(p_xp_multiplier, 1.5)),
    'random',
    '',
    v_duration,
    0,
    100,
    0,
    'collab',
    p_party_id
  from public.dungeon_party_members m
  where m.party_id = p_party_id
    and m.status = 'joined'
    and not exists (
      select 1
      from public.dungeon_runs dr
      where dr.user_id = m.user_id
        and dr.status = 'active'
    );

  return query
  select
    p.id,
    p.status,
    p.started_at,
    count(*)::integer
  from public.dungeon_parties p
  join public.dungeon_party_members m on m.party_id = p.id
  where p.id = p_party_id
    and m.status in ('joined', 'completed')
  group by p.id, p.status, p.started_at;
end;
$$;

create or replace function public.update_dungeon_party_progress(
  p_user_id uuid,
  p_party_id uuid,
  p_progress_delta integer,
  p_xp_pool integer default 600
)
returns table(
  party_status text,
  shared_progress integer,
  xp_each integer,
  member_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party public.dungeon_parties%rowtype;
  v_next_progress integer := 0;
  v_member_count integer := 0;
  v_xp_each integer := 0;
  v_bonus numeric := 1.0;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  if not exists (
    select 1
    from public.dungeon_party_members m
    where m.party_id = p_party_id
      and m.user_id = p_user_id
      and m.status in ('joined', 'completed')
  ) then
    raise exception 'not a party member';
  end if;

  select *
  into v_party
  from public.dungeon_parties
  where id = p_party_id
  for update;

  if not found then
    raise exception 'party not found';
  end if;

  if v_party.status = 'completed' then
    select count(*)::integer
    into v_member_count
    from public.dungeon_party_members
    where party_id = p_party_id
      and status in ('joined', 'completed');

    select coalesce(min(xp_amount), 0)
    into v_xp_each
    from public.dungeon_party_rewards
    where party_id = p_party_id;

    return query
    select v_party.status, v_party.shared_progress, v_xp_each, v_member_count;
    return;
  end if;

  v_next_progress := greatest(0, least(100, coalesce(v_party.shared_progress, 0) + coalesce(p_progress_delta, 0)));

  update public.dungeon_parties
  set
    status = case when v_next_progress >= 100 then 'completed' else 'active' end,
    shared_progress = v_next_progress,
    completed_at = case when v_next_progress >= 100 then coalesce(completed_at, now()) else completed_at end
  where id = p_party_id;

  select count(*)::integer
  into v_member_count
  from public.dungeon_party_members
  where party_id = p_party_id
    and status in ('joined', 'completed');

  if v_next_progress >= 100 and v_member_count > 0 then
    v_bonus := least(1.50, 1.10 + greatest(0, (v_member_count - 2)) * 0.05);
    v_xp_each := greatest(0, floor((greatest(0, coalesce(p_xp_pool, 600))::numeric / v_member_count::numeric) * v_bonus)::integer);

    insert into public.dungeon_party_rewards (party_id, user_id, xp_amount)
    select p_party_id, m.user_id, v_xp_each
    from public.dungeon_party_members m
    where m.party_id = p_party_id
      and m.status in ('joined', 'completed')
    on conflict (party_id, user_id) do update
    set xp_amount = excluded.xp_amount;
  end if;

  return query
  select
    p.status,
    p.shared_progress,
    v_xp_each,
    v_member_count
  from public.dungeon_parties p
  where p.id = p_party_id
  limit 1;
end;
$$;

create or replace function public.register_dungeon_party_failure(
  p_user_id uuid,
  p_party_id uuid,
  p_failed_user_id uuid default null,
  p_stability_penalty integer default 15
)
returns table(
  party_status text,
  shared_progress integer,
  failed_user_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_failed_user uuid := coalesce(p_failed_user_id, p_user_id);
  v_penalty integer := greatest(0, coalesce(p_stability_penalty, 15));
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  if not exists (
    select 1
    from public.dungeon_party_members m
    where m.party_id = p_party_id
      and m.user_id = p_user_id
      and m.status in ('joined', 'completed')
  ) then
    raise exception 'not a party member';
  end if;

  update public.dungeon_party_members
  set status = 'failed'
  where party_id = p_party_id
    and user_id = v_failed_user;

  update public.dungeon_parties
  set shared_progress = greatest(0, shared_progress - v_penalty)
  where id = p_party_id;

  update public.dungeon_runs
  set
    stability = greatest(0, coalesce(stability, 100) - v_penalty),
    status = case when greatest(0, coalesce(stability, 100) - v_penalty) = 0 then 'failed' else status end,
    end_date = case when greatest(0, coalesce(stability, 100) - v_penalty) = 0 then current_date else end_date end
  where party_id = p_party_id
    and user_id = v_failed_user
    and status = 'active';

  return query
  select p.status, p.shared_progress, v_failed_user
  from public.dungeon_parties p
  where p.id = p_party_id
  limit 1;
end;
$$;

create or replace function public.claim_dungeon_party_xp(
  p_user_id uuid,
  p_party_id uuid
)
returns table(
  claimed boolean,
  xp_amount integer,
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
  v_reward public.dungeon_party_rewards%rowtype;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  select *
  into v_reward
  from public.dungeon_party_rewards
  where party_id = p_party_id
    and user_id = p_user_id
  for update;

  if not found then
    raise exception 'reward not found';
  end if;

  if not coalesce(v_reward.claimed, false) and coalesce(v_reward.xp_amount, 0) > 0 then
    perform public.award_xp(
      p_user_id,
      greatest(0, v_reward.xp_amount),
      'dungeon_party_complete',
      'party_complete:' || p_party_id::text || ':' || p_user_id::text,
      jsonb_build_object('party_id', p_party_id)
    );
  end if;

  update public.dungeon_party_rewards
  set
    claimed = true,
    claimed_at = coalesce(claimed_at, now())
  where party_id = p_party_id
    and user_id = p_user_id;

  update public.dungeon_party_members
  set status = 'completed'
  where party_id = p_party_id
    and user_id = p_user_id
    and status = 'joined';

  update public.dungeon_runs
  set
    status = 'completed',
    end_date = coalesce(end_date, current_date)
  where party_id = p_party_id
    and user_id = p_user_id
    and status = 'active';

  return query
  select
    true,
    greatest(0, coalesce(v_reward.xp_amount, 0)),
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

grant execute on function public.create_dungeon_party(uuid, uuid, text) to authenticated;
grant execute on function public.join_dungeon_party(uuid, uuid, text) to authenticated;
grant execute on function public.start_dungeon_party(uuid, uuid, integer, numeric) to authenticated;
grant execute on function public.update_dungeon_party_progress(uuid, uuid, integer, integer) to authenticated;
grant execute on function public.register_dungeon_party_failure(uuid, uuid, uuid, integer) to authenticated;
grant execute on function public.claim_dungeon_party_xp(uuid, uuid) to authenticated;

-- =========================================================
-- FRIEND SYSTEM
-- =========================================================

create table if not exists public.friends (
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, friend_user_id),
  check (user_id <> friend_user_id)
);

create index if not exists friends_user_status_idx
  on public.friends (user_id, status, updated_at desc);

create index if not exists friends_friend_status_idx
  on public.friends (friend_user_id, status, updated_at desc);

alter table public.friends enable row level security;

drop policy if exists friends_select_policy on public.friends;
create policy friends_select_policy
on public.friends for select
using (auth.uid() = user_id or auth.uid() = friend_user_id);

drop policy if exists friends_insert_policy on public.friends;
create policy friends_insert_policy
on public.friends for insert
with check (auth.uid() = user_id);

drop policy if exists friends_update_policy on public.friends;
create policy friends_update_policy
on public.friends for update
using (auth.uid() = user_id or auth.uid() = friend_user_id)
with check (auth.uid() = user_id or auth.uid() = friend_user_id);

create or replace function public.touch_friends_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_friends_updated_at on public.friends;
create trigger trg_touch_friends_updated_at
before update
on public.friends
for each row
execute function public.touch_friends_updated_at();

create or replace function public.sync_friends_from_requests()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'accepted' then
    insert into public.friends (user_id, friend_user_id, status)
    values (new.requester_id, new.receiver_id, 'accepted')
    on conflict (user_id, friend_user_id) do update
    set status = 'accepted', updated_at = now();

    insert into public.friends (user_id, friend_user_id, status)
    values (new.receiver_id, new.requester_id, 'accepted')
    on conflict (user_id, friend_user_id) do update
    set status = 'accepted', updated_at = now();
  end if;
  return new;
end;
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'friend_requests'
  ) then
    execute 'drop trigger if exists trg_sync_friends_from_requests on public.friend_requests';
    execute '
      create trigger trg_sync_friends_from_requests
      after insert or update of status
      on public.friend_requests
      for each row
      execute function public.sync_friends_from_requests()
    ';
  end if;
end;
$$;

-- =========================================================
-- REALTIME + INDEXING
-- =========================================================

do $$
declare
  v_table text;
  v_tables text[] := array[
    'dungeon_runs',
    'dungeon_parties',
    'dungeon_party_members',
    'dungeon_party_rewards',
    'xp_logs',
    'interruptions'
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

-- Stronger timer/index support for scale
create index if not exists interruptions_user_status_start_expiry_idx
  on public.interruptions (user_id, status, interruption_start desc);

create index if not exists user_quests_expires_active_idx
  on public.user_quests (expires_at)
  where status = 'active';

create index if not exists punishments_expires_open_idx
  on public.punishments (expires_at)
  where coalesce(resolved, false) = false and coalesce(penalty_applied, false) = false;
