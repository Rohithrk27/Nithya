-- Fix ambiguous "plan_id" reference in progress_recovery_plan_step RPC.

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

notify pgrst, 'reload schema';
