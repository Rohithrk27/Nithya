-- Fix weekly/daily reactivation so stale timer fields do not immediately expire quests.

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
         and lower(coalesce(uq.status, '')) = 'active'
         and lower(coalesce(uq.quest_type, 'daily')) = 'weekly'
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
    completed_date = null,
    started_at = case
      when uq.started_at is null then v_started
      when lower(coalesce(uq.status, '')) in ('failed', 'completed') then v_started
      when uq.expires_at is not null and uq.expires_at <= now() then v_started
      else uq.started_at
    end,
    quest_type = coalesce(nullif(lower(trim(coalesce(uq.quest_type, ''))), ''), coalesce(v_quest.type, 'daily')),
    expires_at = case
      when uq.expires_at is null then v_started + public.quest_duration_interval(coalesce(uq.quest_type, v_quest.type, 'daily'))
      when lower(coalesce(uq.status, '')) in ('failed', 'completed') then v_started + public.quest_duration_interval(coalesce(uq.quest_type, v_quest.type, 'daily'))
      when uq.expires_at <= now() then v_started + public.quest_duration_interval(coalesce(uq.quest_type, v_quest.type, 'daily'))
      else uq.expires_at
    end,
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

grant execute on function public.activate_user_quest(uuid, uuid, timestamptz) to authenticated;

