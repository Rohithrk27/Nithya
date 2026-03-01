-- Fix: column reference "shadow_debt_xp" is ambiguous in penalty_xp
-- Root cause: unqualified shadow_debt_xp inside UPDATE on public.stats
-- This migration is safe to re-run.

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

  update public.stats as s
  set shadow_debt_xp = coalesce(s.shadow_debt_xp, 0) + greatest(0, v_debt_added)
  where s.id = v_stats.id;

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

grant execute on function public.penalty_xp(uuid, integer, text, integer, text, jsonb) to authenticated;
