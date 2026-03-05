-- Enforce 24h punishment cap and fix recovery plan regeneration/xp recovery behavior.
-- Depends on: 2026-03-07_discipline_relics_system.sql
-- Depends on: 2026-03-19_recovery_planner.sql
-- Depends on: 2026-03-25_recovery_progress_plan_id_ambiguity_fix.sql

set search_path = public, extensions;

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
  v_shadow_debt integer := 0;
begin
  if v_source not in ('manual', 'quest_failed', 'punishment_timeout', 'punishment_refused', 'system') then
    v_source := 'manual';
  end if;

  -- Serialize plan creation per-user to avoid duplicate active rows under concurrent calls.
  perform 1
  from public.profiles p
  where p.id = p_user_id
  for update;

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
  else
    update public.recovery_plans rp
    set
      status = 'abandoned',
      completed_at = coalesce(rp.completed_at, now()),
      updated_at = now()
    where rp.user_id = p_user_id
      and rp.status = 'active';
  end if;

  select count(*)::integer
  into v_missed_habits
  from public.habit_logs hl
  where hl.user_id = p_user_id
    and (
      lower(coalesce(hl.status, '')) in ('missed', 'failed')
      or coalesce(hl.failed, false) = true
    )
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
    and (
      lower(coalesce(hl.status, '')) in ('missed', 'failed')
      or coalesce(hl.failed, false) = true
    )
    and coalesce(hl.date, (hl.created_at at time zone 'utc')::date) >= (current_date - 14)
  group by h.title
  order by count(*) desc, h.title
  limit 1;

  select coalesce(s.shadow_debt_xp, 0)::integer
  into v_shadow_debt
  from public.stats s
  where s.user_id = p_user_id
  order by s.created_at desc nulls last
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
      'top_missed_habit_count', coalesce(v_top_habit_misses, 0),
      'shadow_debt_xp', coalesce(v_shadow_debt, 0)
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

create or replace function public._grant_recovery_xp_offset(
  p_user_id uuid,
  p_xp integer,
  p_source text,
  p_event_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gain integer := greatest(0, coalesce(p_xp, 0));
  v_source text := coalesce(nullif(trim(p_source), ''), 'recovery_xp_offset');
  v_profile public.profiles%rowtype;
  v_new_total bigint;
  v_new_level integer;
  v_levels_gained integer;
  v_new_stat_points integer;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  if v_gain <= 0 then
    return 0;
  end if;

  if p_event_id is not null and exists (
    select 1
    from public.xp_logs x
    where x.user_id = p_user_id
      and x.source = v_source
      and x.event_id = p_event_id
  ) then
    return 0;
  end if;

  select *
  into v_profile
  from public.profiles p
  where p.id = p_user_id
  for update;

  if not found then
    raise exception 'profile not found';
  end if;

  v_new_total := greatest(0, coalesce(v_profile.total_xp, 0) + v_gain);
  v_new_level := public.compute_level_from_total_xp(v_new_total);
  v_levels_gained := greatest(0, v_new_level - coalesce(v_profile.level, 0));
  v_new_stat_points := coalesce(v_profile.stat_points, 0) + (v_levels_gained * 5);

  update public.profiles
  set
    total_xp = v_new_total,
    current_xp = v_new_total,
    level = v_new_level,
    stat_points = v_new_stat_points
  where id = p_user_id;

  insert into public.xp_logs (user_id, xp_change, source, date, event_id, metadata)
  values (
    p_user_id,
    v_gain,
    v_source,
    current_date,
    p_event_id,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('recovery_offset', true)
  )
  on conflict (user_id, source, event_id) do nothing;

  return v_gain;
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
  v_award record;
  v_step_debt_repaid integer := 0;
  v_bonus_debt_repaid integer := 0;
  v_step_offset integer := 0;
  v_bonus_offset integer := 0;
  v_step_net_awarded integer := 0;
  v_bonus_net_awarded integer := 0;
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
      select *
      into v_award
      from public.award_xp(
        p_user_id,
        v_xp,
        'recovery_step_complete',
        'recovery_step:' || v_step.id::text || ':complete',
        jsonb_build_object(
          'recovery_plan_id', v_plan.id,
          'recovery_step_id', v_step.id
        )
      );

      v_step_debt_repaid := greatest(0, coalesce(v_award.debt_repaid, 0));
      if v_step_debt_repaid > 0 then
        v_step_offset := public._grant_recovery_xp_offset(
          p_user_id,
          v_step_debt_repaid,
          'recovery_step_shadow_debt_offset',
          'recovery_step:' || v_step.id::text || ':debt_offset',
          jsonb_build_object(
            'recovery_plan_id', v_plan.id,
            'recovery_step_id', v_step.id,
            'debt_repaid', v_step_debt_repaid
          )
        );
      end if;
      v_step_net_awarded := greatest(0, v_xp - v_step_debt_repaid + v_step_offset);
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
    select *
    into v_award
    from public.award_xp(
      p_user_id,
      v_bonus,
      'recovery_plan_complete',
      'recovery_plan:' || v_plan.id::text || ':complete',
      jsonb_build_object('recovery_plan_id', v_plan.id)
    );

    v_bonus_debt_repaid := greatest(0, coalesce(v_award.debt_repaid, 0));
    if v_bonus_debt_repaid > 0 then
      v_bonus_offset := public._grant_recovery_xp_offset(
        p_user_id,
        v_bonus_debt_repaid,
        'recovery_plan_shadow_debt_offset',
        'recovery_plan:' || v_plan.id::text || ':debt_offset',
        jsonb_build_object(
          'recovery_plan_id', v_plan.id,
          'debt_repaid', v_bonus_debt_repaid
        )
      );
    end if;
    v_bonus_net_awarded := greatest(0, v_bonus - v_bonus_debt_repaid + v_bonus_offset);
  end if;

  return query
  select
    v_plan.id,
    v_step.id,
    v_step.status,
    coalesce(v_step.progress_count, 0),
    coalesce(v_step.target_count, 1),
    v_step_net_awarded + v_bonus_net_awarded,
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
  v_cheat_expires timestamptz := public.cheat_day_expires_at(p_user_id);
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
      and coalesce(
        p.expires_at,
        coalesce(p.started_at, p.created_at, now()) + interval '24 hours'
      ) <= now()
    for update skip locked
  loop
    if v_cheat_expires is not null and now() <= v_cheat_expires then
      update public.punishments
      set expires_at = greatest(coalesce(expires_at, v_cheat_expires), v_cheat_expires)
      where id = v_row.id
        and user_id = p_user_id;
      continue;
    end if;

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
          coalesce(v_row.expires_at, coalesce(v_row.started_at, v_row.created_at, now()) + interval '24 hours')
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

grant execute on function public.progress_recovery_plan_step(uuid, uuid, integer) to authenticated;
grant execute on function public.resolve_expired_punishments(uuid, text) to authenticated;
grant execute on function public.resolve_punishment_early(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
