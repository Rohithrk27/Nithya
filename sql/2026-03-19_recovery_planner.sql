-- Recovery Planner
-- Depends on: 2026-03-18_focus_insights_party_challenges.sql

set search_path = public, extensions;

-- =========================================================
-- TABLES
-- =========================================================

create table if not exists public.recovery_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'manual' check (source in ('manual', 'quest_failed', 'punishment_timeout', 'punishment_refused', 'system')),
  source_ref text,
  reason text,
  title text not null default '48-Hour Recovery Protocol',
  status text not null default 'active' check (status in ('active', 'completed', 'abandoned', 'expired')),
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
  day_offset integer not null default 0 check (day_offset between 0 and 6),
  title text not null,
  description text,
  target_count integer not null default 1 check (target_count between 1 and 1000),
  progress_count integer not null default 0 check (progress_count >= 0),
  xp_reward integer not null default 60 check (xp_reward >= 0),
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed', 'skipped')),
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists recovery_plans_user_created_idx
  on public.recovery_plans (user_id, created_at desc);

create index if not exists recovery_plans_user_status_idx
  on public.recovery_plans (user_id, status, created_at desc);

create unique index if not exists recovery_plans_one_active_per_user_idx
  on public.recovery_plans (user_id)
  where status = 'active';

create index if not exists recovery_plan_steps_plan_status_idx
  on public.recovery_plan_steps (plan_id, status, created_at);

create index if not exists recovery_plan_steps_user_status_idx
  on public.recovery_plan_steps (user_id, status, created_at desc);

drop trigger if exists trg_touch_recovery_plans_updated_at on public.recovery_plans;
create trigger trg_touch_recovery_plans_updated_at
before update on public.recovery_plans
for each row
execute function public.touch_generic_updated_at();

drop trigger if exists trg_touch_recovery_steps_updated_at on public.recovery_plan_steps;
create trigger trg_touch_recovery_steps_updated_at
before update on public.recovery_plan_steps
for each row
execute function public.touch_generic_updated_at();

create or replace function public.sync_recovery_step_user_id()
returns trigger
language plpgsql
as $$
declare
  v_user_id uuid;
begin
  select rp.user_id
  into v_user_id
  from public.recovery_plans rp
  where rp.id = new.plan_id;

  if v_user_id is null then
    raise exception 'recovery plan not found';
  end if;

  new.user_id := v_user_id;
  return new;
end;
$$;

drop trigger if exists trg_sync_recovery_step_user_id on public.recovery_plan_steps;
create trigger trg_sync_recovery_step_user_id
before insert or update of plan_id
on public.recovery_plan_steps
for each row
execute function public.sync_recovery_step_user_id();

-- =========================================================
-- RLS
-- =========================================================

alter table public.recovery_plans enable row level security;
alter table public.recovery_plan_steps enable row level security;

drop policy if exists recovery_plans_select_own on public.recovery_plans;
create policy recovery_plans_select_own
on public.recovery_plans for select
using (auth.uid() = user_id);

drop policy if exists recovery_plans_insert_own on public.recovery_plans;
create policy recovery_plans_insert_own
on public.recovery_plans for insert
with check (auth.uid() = user_id);

drop policy if exists recovery_plans_update_own on public.recovery_plans;
create policy recovery_plans_update_own
on public.recovery_plans for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists recovery_plan_steps_select_own on public.recovery_plan_steps;
create policy recovery_plan_steps_select_own
on public.recovery_plan_steps for select
using (auth.uid() = user_id);

drop policy if exists recovery_plan_steps_insert_own on public.recovery_plan_steps;
create policy recovery_plan_steps_insert_own
on public.recovery_plan_steps for insert
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.recovery_plans rp
    where rp.id = plan_id
      and rp.user_id = auth.uid()
  )
);

drop policy if exists recovery_plan_steps_update_own on public.recovery_plan_steps;
create policy recovery_plan_steps_update_own
on public.recovery_plan_steps for update
using (
  auth.uid() = user_id
  and exists (
    select 1
    from public.recovery_plans rp
    where rp.id = plan_id
      and rp.user_id = auth.uid()
  )
)
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.recovery_plans rp
    where rp.id = plan_id
      and rp.user_id = auth.uid()
  )
);

-- =========================================================
-- HELPERS
-- =========================================================

create or replace function public._upsert_active_recovery_plan(
  p_user_id uuid,
  p_source text default 'manual',
  p_source_ref text default null,
  p_reason text default null,
  p_force_new boolean default false
)
returns public.recovery_plans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source text := lower(coalesce(nullif(trim(p_source), ''), 'manual'));
  v_existing public.recovery_plans%rowtype;
  v_plan public.recovery_plans%rowtype;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_missed_habits integer := 0;
  v_failed_quests integer := 0;
  v_top_habit text := null;
  v_top_habit_misses integer := 0;
  v_focus_target integer := 1;
  v_habit_target integer := 2;
  v_quest_target integer := 1;
begin
  if v_source not in ('manual', 'quest_failed', 'punishment_timeout', 'punishment_refused', 'system') then
    v_source := 'manual';
  end if;

  if not coalesce(p_force_new, false) then
    select *
    into v_existing
    from public.recovery_plans rp
    where rp.user_id = p_user_id
      and rp.status = 'active'
    order by rp.created_at desc
    limit 1
    for update;

    if found then
      return v_existing;
    end if;
  end if;

  select count(*)::integer
  into v_missed_habits
  from public.habit_logs hl
  where hl.user_id = p_user_id
    and hl.status = 'missed'
    and coalesce(hl.date, (hl.created_at at time zone 'utc')::date) >= (current_date - 14);

  select count(*)::integer
  into v_failed_quests
  from public.user_quests uq
  where uq.user_id = p_user_id
    and lower(coalesce(uq.status, '')) = 'failed'
    and coalesce(uq.completed_date, uq.date, (uq.created_at at time zone 'utc')::date) >= (current_date - 14);

  select h.title, count(*)::integer
  into v_top_habit, v_top_habit_misses
  from public.habit_logs hl
  join public.habits h on h.id = hl.habit_id
  where hl.user_id = p_user_id
    and hl.status = 'missed'
    and coalesce(hl.date, (hl.created_at at time zone 'utc')::date) >= (current_date - 14)
  group by h.title
  order by count(*) desc, h.title
  limit 1;

  if v_failed_quests >= 3 then
    v_quest_target := 2;
  end if;

  if v_missed_habits >= 8 then
    v_habit_target := 3;
  end if;

  if v_reason is null then
    v_reason := format(
      'Recent failures detected: %s missed habits and %s failed quests in the last 14 days.',
      v_missed_habits,
      v_failed_quests
    );
  end if;

  insert into public.recovery_plans (
    user_id,
    source,
    source_ref,
    reason,
    title,
    status,
    starts_on,
    ends_on,
    metadata
  )
  values (
    p_user_id,
    v_source,
    nullif(trim(coalesce(p_source_ref, '')), ''),
    v_reason,
    '48-Hour Recovery Protocol',
    'active',
    current_date,
    current_date + 1,
    jsonb_build_object(
      'missed_habits_14d', v_missed_habits,
      'failed_quests_14d', v_failed_quests,
      'top_missed_habit', v_top_habit,
      'top_missed_habit_count', coalesce(v_top_habit_misses, 0)
    )
  )
  returning *
  into v_plan;

  insert into public.recovery_plan_steps (
    plan_id,
    user_id,
    day_offset,
    title,
    description,
    target_count,
    xp_reward,
    status,
    metadata
  )
  values
    (
      v_plan.id,
      p_user_id,
      0,
      'Stabilize with one uninterrupted focus block',
      'Complete one uninterrupted focus session to restart momentum.',
      v_focus_target,
      70,
      'pending',
      jsonb_build_object('type', 'focus_session')
    ),
    (
      v_plan.id,
      p_user_id,
      0,
      format('Repair weakest habit: %s', coalesce(v_top_habit, 'daily core habit')),
      'Complete the weakest habit without missing once in this recovery window.',
      v_habit_target,
      90,
      'pending',
      jsonb_build_object('type', 'habit_repair', 'habit_title', v_top_habit)
    ),
    (
      v_plan.id,
      p_user_id,
      1,
      'Close one pending quest path',
      'Complete active quests or offset failed streak by taking one clean quest completion.',
      v_quest_target,
      100,
      'pending',
      jsonb_build_object('type', 'quest_repair')
    );

  return v_plan;
end;
$$;

create or replace function public.create_recovery_plan(
  p_user_id uuid,
  p_source text default 'manual',
  p_source_ref text default null,
  p_reason text default null,
  p_force_new boolean default false
)
returns public.recovery_plans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.recovery_plans%rowtype;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  select *
  into v_plan
  from public._upsert_active_recovery_plan(
    p_user_id,
    p_source,
    p_source_ref,
    p_reason,
    p_force_new
  );

  return v_plan;
end;
$$;

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

  select bool_and(status = 'completed')
  into v_all_completed
  from public.recovery_plan_steps
  where plan_id = v_plan.id;

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

create or replace function public.abandon_recovery_plan(
  p_user_id uuid,
  p_plan_id uuid
)
returns public.recovery_plans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.recovery_plans%rowtype;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  update public.recovery_plans rp
  set
    status = case when rp.status = 'active' then 'abandoned' else rp.status end,
    updated_at = now()
  where rp.id = p_plan_id
    and rp.user_id = p_user_id
  returning *
  into v_plan;

  if not found then
    raise exception 'recovery plan not found';
  end if;

  return v_plan;
end;
$$;

-- =========================================================
-- AUTO-CREATE ON FAILURE EVENTS
-- =========================================================

create or replace function public.handle_recovery_plan_from_quest_failure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and lower(coalesce(new.status, '')) = 'failed'
     and lower(coalesce(old.status, '')) <> 'failed' then
    perform public._upsert_active_recovery_plan(
      new.user_id,
      'quest_failed',
      new.id::text,
      coalesce(new.failure_reason, 'Quest failed'),
      false
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_recovery_plan_on_quest_failed on public.user_quests;
create trigger trg_recovery_plan_on_quest_failed
after update of status
on public.user_quests
for each row
execute function public.handle_recovery_plan_from_quest_failure();

create or replace function public.handle_recovery_plan_from_punishment_failure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source text;
  v_reason text;
begin
  if new.user_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and lower(coalesce(new.status, '')) in ('timed_out', 'refused')
     and lower(coalesce(old.status, '')) is distinct from lower(coalesce(new.status, '')) then

    v_source := case
      when lower(coalesce(new.status, '')) = 'timed_out' then 'punishment_timeout'
      else 'punishment_refused'
    end;

    v_reason := coalesce(new.reason, new.text, 'Punishment failed');

    perform public._upsert_active_recovery_plan(
      new.user_id,
      v_source,
      new.id::text,
      v_reason,
      false
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_recovery_plan_on_punishment_failed on public.punishments;
create trigger trg_recovery_plan_on_punishment_failed
after update of status
on public.punishments
for each row
execute function public.handle_recovery_plan_from_punishment_failure();

-- =========================================================
-- GRANTS + REALTIME
-- =========================================================

grant execute on function public.create_recovery_plan(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.progress_recovery_plan_step(uuid, uuid, integer) to authenticated;
grant execute on function public.abandon_recovery_plan(uuid, uuid) to authenticated;

do $$
declare
  v_table text;
  v_tables text[] := array[
    'recovery_plans',
    'recovery_plan_steps'
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
