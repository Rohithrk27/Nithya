-- Align quest activation with deadline/punishment/relic fields introduced in 2026-03-15 migrations.
-- This keeps quest acceptance authoritative on server-side state.

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
  v_default_deadline timestamptz;
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

  v_default_deadline := coalesce(
    v_quest.deadline_at,
    case
      when v_quest.expires_date is null then null
      else ((v_quest.expires_date + 1)::timestamp - interval '1 second')
    end,
    v_started + public.quest_duration_interval(coalesce(v_quest.type, 'daily'))
  );

  if coalesce(v_quest.type, 'daily') = 'weekly'
     and exists (
       select 1
       from public.user_quests uq
       where uq.user_id = p_user_id
         and lower(coalesce(uq.status, '')) in ('active', 'in_progress', 'accepted', 'inprogress', 'ongoing', 'started', 'start')
         and lower(coalesce(uq.quest_type, 'daily')) = 'weekly'
         and uq.quest_id <> p_quest_id
         and coalesce(
           uq.deadline_at,
           uq.expires_at,
           coalesce(uq.started_at, uq.created_at, now()) + interval '7 days'
         ) > now()
     ) then
    raise exception 'weekly quest already active';
  end if;

  update public.user_quests uq
  set
    status = 'active',
    failed = false,
    failure_reason = null,
    penalty_applied = false,
    completed_date = null,
    started_at = case
      when uq.started_at is null then v_started
      when lower(coalesce(uq.status, '')) in ('failed', 'completed') then v_started
      when coalesce(uq.deadline_at, uq.expires_at, v_started) <= now() then v_started
      else uq.started_at
    end,
    quest_type = coalesce(nullif(lower(trim(coalesce(uq.quest_type, ''))), ''), coalesce(v_quest.type, 'daily')),
    deadline_at = case
      when uq.deadline_at is null then v_default_deadline
      when lower(coalesce(uq.status, '')) in ('failed', 'completed') then v_default_deadline
      when uq.deadline_at <= now() then v_default_deadline
      else uq.deadline_at
    end,
    expires_at = case
      when uq.expires_at is null then coalesce(uq.deadline_at, v_default_deadline)
      when lower(coalesce(uq.status, '')) in ('failed', 'completed') then coalesce(uq.deadline_at, v_default_deadline)
      when uq.expires_at <= now() then coalesce(uq.deadline_at, v_default_deadline)
      else uq.expires_at
    end,
    xp_reward = case
      when coalesce(uq.xp_reward, 0) > 0 then uq.xp_reward
      else coalesce(v_quest.xp_reward, 0)
    end,
    relic_reward = case
      when coalesce(uq.relic_reward, 0) > 0 then uq.relic_reward
      else greatest(0, coalesce(v_quest.relic_reward, 0))
    end,
    punishment_type = coalesce(nullif(trim(coalesce(uq.punishment_type, '')), ''), coalesce(v_quest.punishment_type, 'xp_deduction')),
    punishment_value = case
      when coalesce(uq.punishment_value, 0) > 0 then uq.punishment_value
      else greatest(0, coalesce(v_quest.punishment_value, 0))
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
      deadline_at,
      expires_at,
      xp_reward,
      relic_reward,
      punishment_type,
      punishment_value,
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
      v_default_deadline,
      v_default_deadline,
      coalesce(v_quest.xp_reward, 0),
      greatest(0, coalesce(v_quest.relic_reward, 0)),
      coalesce(v_quest.punishment_type, 'xp_deduction'),
      greatest(0, coalesce(v_quest.punishment_value, 0)),
      false,
      false
    )
    returning *
    into v_result;
  end if;

  return v_result;
end;
$$;

grant execute on function public.activate_user_quest(uuid, uuid, timestamptz) to authenticated;
