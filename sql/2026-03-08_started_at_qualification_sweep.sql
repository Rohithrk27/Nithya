-- started_at qualification sweep
-- Purpose:
-- 1) Fix collab party start RPC ambiguity on started_at
-- 2) Fully qualify started_at usage in interruption penalty resolver

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

  update public.dungeon_parties as dp
  set
    status = 'active',
    started_at = coalesce(dp.started_at, now())
  where dp.id = p_party_id;

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

create or replace function public.resolve_interruption_penalty(
  p_user_id uuid,
  p_interruption_id uuid,
  p_source text default 'interruption'
)
returns table(
  interruption_status text,
  penalty_stage text,
  applied_xp integer,
  elapsed_seconds integer,
  remaining_to_grace_seconds integer,
  remaining_to_full_seconds integer,
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
  v_now timestamptz := now();
  v_elapsed integer := 0;
  v_grace integer := 10800;
  v_full integer := 86400;
  v_remaining_grace integer := 0;
  v_remaining_full integer := 0;
  v_applied integer := 0;
  v_stage text := 'none';
  v_mild_target integer := 0;
  v_full_target integer := 0;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  select *
  into v_interrupt
  from public.interruptions i
  where i.id = p_interruption_id
    and i.user_id = p_user_id
  for update;

  if not found then
    raise exception 'interruption not found';
  end if;

  if v_interrupt.interruption_start is null then
    update public.interruptions i
    set interruption_start = coalesce(i.started_at, now())
    where i.id = p_interruption_id
      and i.user_id = p_user_id;

    select *
    into v_interrupt
    from public.interruptions i
    where i.id = p_interruption_id
      and i.user_id = p_user_id
    for update;
  end if;

  if v_interrupt.status = 'resolved' then
    v_stage := coalesce(v_interrupt.penalty_state, 'none');
    return query
    select
      v_interrupt.status,
      v_stage,
      0,
      0,
      0,
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

  v_elapsed := greatest(0, floor(extract(epoch from (v_now - v_interrupt.interruption_start)))::integer);
  v_grace := greatest(1, coalesce(v_interrupt.grace_period_hours, 3)) * 3600;
  v_full := greatest(v_grace + 1, coalesce(v_interrupt.full_penalty_hours, 24) * 3600);
  v_remaining_grace := greatest(0, v_grace - v_elapsed);
  v_remaining_full := greatest(0, v_full - v_elapsed);
  v_mild_target := greatest(0, floor(coalesce(v_interrupt.penalty_xp, 0) * 0.4)::integer);
  v_full_target := greatest(v_mild_target, coalesce(v_interrupt.penalty_xp, 0));

  if v_elapsed >= v_full then
    v_stage := 'full';
    if not coalesce(v_interrupt.full_penalty_applied, false) then
      v_applied := greatest(0, v_full_target - coalesce(v_interrupt.mild_penalty_xp, 0) - coalesce(v_interrupt.full_penalty_xp, 0));
      if v_applied > 0 then
        perform public.deduct_xp(
          p_user_id,
          v_applied,
          p_source || '_full',
          ceil(v_applied * 0.25)::integer,
          p_interruption_id::text || ':full',
          jsonb_build_object(
            'interruption_id', p_interruption_id,
            'penalty_stage', 'full'
          )
        );
      end if;

      update public.interruptions
      set
        status = 'penalized',
        penalty_state = 'full',
        penalty_applied = true,
        full_penalty_applied = true,
        full_penalty_xp = coalesce(full_penalty_xp, 0) + v_applied,
        interruption_end = coalesce(interruption_end, v_now),
        resolved_at = coalesce(resolved_at, v_now)
      where id = p_interruption_id
        and user_id = p_user_id;
    end if;
  elsif v_elapsed >= v_grace then
    v_stage := 'mild';
    if not coalesce(v_interrupt.mild_penalty_applied, false) then
      v_applied := greatest(0, v_mild_target - coalesce(v_interrupt.mild_penalty_xp, 0));
      if v_applied > 0 then
        perform public.deduct_xp(
          p_user_id,
          v_applied,
          p_source || '_mild',
          ceil(v_applied * 0.15)::integer,
          p_interruption_id::text || ':mild',
          jsonb_build_object(
            'interruption_id', p_interruption_id,
            'penalty_stage', 'mild'
          )
        );
      end if;

      update public.interruptions
      set
        status = 'penalized',
        penalty_state = 'mild',
        penalty_applied = penalty_applied or (v_applied > 0),
        mild_penalty_applied = true,
        mild_penalty_xp = coalesce(mild_penalty_xp, 0) + v_applied
      where id = p_interruption_id
        and user_id = p_user_id;
    end if;
  else
    v_stage := 'none';
  end if;

  select *
  into v_interrupt
  from public.interruptions i
  where i.id = p_interruption_id
    and i.user_id = p_user_id;

  return query
  select
    coalesce(v_interrupt.status, 'active'),
    coalesce(v_interrupt.penalty_state, v_stage, 'none'),
    v_applied,
    v_elapsed,
    greatest(0, v_grace - v_elapsed),
    greatest(0, v_full - v_elapsed),
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

grant execute on function public.start_dungeon_party(uuid, uuid, integer, numeric) to authenticated;
grant execute on function public.resolve_interruption_penalty(uuid, uuid, text) to authenticated;
