-- Weekly insights: ensure best and worst habits are distinct when possible
-- Depends on: 2026-03-19_recovery_planner.sql

set search_path = public, extensions;

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
  v_habits_with_attempts integer := 0;
  v_best_habit_id uuid := null;
  v_best_habit text := null;
  v_best_habit_rate numeric := 0;
  v_worst_habit_id uuid := null;
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
      h.id,
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
    count(*)::integer
  into
    v_habits_with_attempts
  from per_habit ph
  where ph.attempts > 0;

  with per_habit as (
    select
      h.id,
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
    ph.id,
    ph.title,
    round((ph.completed_count::numeric / ph.attempts::numeric) * 100.0, 1)
  into
    v_best_habit_id,
    v_best_habit,
    v_best_habit_rate
  from per_habit ph
  where ph.attempts > 0
  order by (ph.completed_count::numeric / ph.attempts::numeric) desc, ph.attempts desc, ph.title
  limit 1;

  -- Keep worst_habit distinct from best_habit whenever multiple habits have attempts.
  if coalesce(v_habits_with_attempts, 0) > 1 then
    with per_habit as (
      select
        h.id,
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
      ph.id,
      ph.title,
      round((ph.completed_count::numeric / ph.attempts::numeric) * 100.0, 1)
    into
      v_worst_habit_id,
      v_worst_habit,
      v_worst_habit_rate
    from per_habit ph
    where ph.attempts > 0
      and (v_best_habit_id is null or ph.id <> v_best_habit_id)
    order by (ph.completed_count::numeric / ph.attempts::numeric) asc, ph.attempts desc, ph.title
    limit 1;
  else
    v_worst_habit_id := null;
    v_worst_habit := null;
    v_worst_habit_rate := 0;
  end if;

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

grant execute on function public.generate_weekly_personal_insight(uuid, date) to authenticated;

notify pgrst, 'reload schema';
