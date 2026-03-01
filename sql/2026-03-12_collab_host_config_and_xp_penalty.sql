-- Collab host config + fail XP penalty
-- Adds host-editable challenge/punishment/reward settings and
-- applies XP deduction on party failure events.

alter table public.dungeon_parties
  add column if not exists challenge_title text,
  add column if not exists challenge_description text,
  add column if not exists punishment_mode text not null default 'random',
  add column if not exists custom_punishment_text text not null default '',
  add column if not exists reward_xp_pool integer not null default 600,
  add column if not exists fail_xp_penalty integer not null default 0;

update public.dungeon_parties
set
  punishment_mode = case
    when lower(coalesce(punishment_mode, '')) in ('random', 'custom') then lower(punishment_mode)
    else 'random'
  end,
  custom_punishment_text = coalesce(custom_punishment_text, ''),
  reward_xp_pool = greatest(0, coalesce(reward_xp_pool, 600)),
  fail_xp_penalty = greatest(0, coalesce(fail_xp_penalty, 0))
where punishment_mode is null
   or lower(coalesce(punishment_mode, '')) not in ('random', 'custom')
   or custom_punishment_text is null
   or reward_xp_pool is null
   or reward_xp_pool < 0
   or fail_xp_penalty is null
   or fail_xp_penalty < 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dungeon_parties_punishment_mode_check'
      and conrelid = 'public.dungeon_parties'::regclass
  ) then
    alter table public.dungeon_parties
      add constraint dungeon_parties_punishment_mode_check
      check (punishment_mode in ('random', 'custom'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dungeon_parties_reward_xp_pool_check'
      and conrelid = 'public.dungeon_parties'::regclass
  ) then
    alter table public.dungeon_parties
      add constraint dungeon_parties_reward_xp_pool_check
      check (reward_xp_pool >= 0 and reward_xp_pool <= 200000);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dungeon_parties_fail_xp_penalty_check'
      and conrelid = 'public.dungeon_parties'::regclass
  ) then
    alter table public.dungeon_parties
      add constraint dungeon_parties_fail_xp_penalty_check
      check (fail_xp_penalty >= 0 and fail_xp_penalty <= 200000);
  end if;
end;
$$;

create or replace function public.set_dungeon_party_config(
  p_user_id uuid,
  p_party_id uuid,
  p_challenge_title text default null,
  p_challenge_description text default null,
  p_punishment_mode text default 'random',
  p_custom_punishment_text text default null,
  p_reward_xp_pool integer default null,
  p_fail_xp_penalty integer default null
)
returns table(
  party_id uuid,
  challenge_title text,
  challenge_description text,
  punishment_mode text,
  custom_punishment_text text,
  reward_xp_pool integer,
  fail_xp_penalty integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party public.dungeon_parties%rowtype;
  v_mode text := lower(coalesce(p_punishment_mode, 'random'));
  v_custom text := nullif(btrim(coalesce(p_custom_punishment_text, '')), '');
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  if v_mode not in ('random', 'custom') then
    v_mode := 'random';
  end if;

  select *
  into v_party
  from public.dungeon_parties dp
  where dp.id = p_party_id
    and dp.host_user_id = p_user_id
  for update;

  if not found then
    raise exception 'party not found or not host';
  end if;

  if coalesce(v_party.status, 'waiting') <> 'waiting' then
    raise exception 'party is not waiting';
  end if;

  update public.dungeon_parties as dp
  set
    challenge_title = case
      when p_challenge_title is null then dp.challenge_title
      else nullif(btrim(p_challenge_title), '')
    end,
    challenge_description = case
      when p_challenge_description is null then dp.challenge_description
      else nullif(btrim(p_challenge_description), '')
    end,
    punishment_mode = v_mode,
    custom_punishment_text = case
      when v_mode = 'custom' then coalesce(v_custom, dp.custom_punishment_text, '')
      else ''
    end,
    reward_xp_pool = greatest(0, least(200000, coalesce(p_reward_xp_pool, dp.reward_xp_pool, 600))),
    fail_xp_penalty = greatest(0, least(200000, coalesce(p_fail_xp_penalty, dp.fail_xp_penalty, 0)))
  where dp.id = p_party_id
    and dp.host_user_id = p_user_id
  returning
    dp.id,
    dp.challenge_title,
    dp.challenge_description,
    dp.punishment_mode,
    dp.custom_punishment_text,
    dp.reward_xp_pool,
    dp.fail_xp_penalty
  into
    party_id,
    challenge_title,
    challenge_description,
    punishment_mode,
    custom_punishment_text,
    reward_xp_pool,
    fail_xp_penalty;

  if party_id is null then
    raise exception 'party not found or not host';
  end if;

  return next;
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
    coalesce(
      nullif(btrim(coalesce(v_party.challenge_title, '')), ''),
      nullif(btrim(coalesce(v_party.title, '')), ''),
      'Collaborative Dungeon'
    ),
    coalesce(
      nullif(btrim(coalesce(v_party.challenge_description, '')), ''),
      'Complete party objectives together'
    ),
    current_date,
    (current_date + v_duration),
    'active',
    greatest(1, coalesce(p_xp_multiplier, 1.5)),
    case
      when lower(coalesce(v_party.punishment_mode, 'random')) = 'custom' then 'custom'
      else 'random'
    end,
    case
      when lower(coalesce(v_party.punishment_mode, 'random')) = 'custom' then coalesce(v_party.custom_punishment_text, '')
      else ''
    end,
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
  v_xp_pool integer := 0;
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

  v_xp_pool := greatest(0, coalesce(p_xp_pool, v_party.reward_xp_pool, 600));

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
    v_xp_each := greatest(0, floor((v_xp_pool::numeric / v_member_count::numeric) * v_bonus)::integer);

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
  v_party public.dungeon_parties%rowtype;
  v_failed_user uuid := coalesce(p_failed_user_id, p_user_id);
  v_penalty integer := greatest(0, coalesce(p_stability_penalty, 15));
  v_penalty_xp integer := 0;
  v_failed_run_id uuid := null;
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

  if not exists (
    select 1
    from public.dungeon_party_members m
    where m.party_id = p_party_id
      and m.user_id = v_failed_user
      and m.status in ('joined', 'completed')
  ) then
    raise exception 'failed user not in party';
  end if;

  select *
  into v_party
  from public.dungeon_parties p
  where p.id = p_party_id
  for update;

  if not found then
    raise exception 'party not found';
  end if;

  v_penalty_xp := greatest(0, coalesce(v_party.fail_xp_penalty, 0));

  update public.dungeon_party_members
  set status = 'failed'
  where party_id = p_party_id
    and user_id = v_failed_user
    and status in ('joined', 'completed');

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
    and status = 'active'
  returning id
  into v_failed_run_id;

  if v_failed_run_id is not null and v_penalty_xp > 0 then
    perform public.deduct_xp(
      v_failed_user,
      v_penalty_xp,
      'dungeon_party_fail',
      ceil(v_penalty_xp * 0.25)::integer,
      'party_fail:' || p_party_id::text || ':' || v_failed_user::text,
      jsonb_build_object(
        'party_id', p_party_id,
        'failed_user_id', v_failed_user
      )
    );
  end if;

  return query
  select p.status, p.shared_progress, v_failed_user
  from public.dungeon_parties p
  where p.id = p_party_id
  limit 1;
end;
$$;

grant execute on function public.set_dungeon_party_config(uuid, uuid, text, text, text, text, integer, integer) to authenticated;
grant execute on function public.start_dungeon_party(uuid, uuid, integer, numeric) to authenticated;
grant execute on function public.update_dungeon_party_progress(uuid, uuid, integer, integer) to authenticated;
grant execute on function public.register_dungeon_party_failure(uuid, uuid, uuid, integer) to authenticated;
