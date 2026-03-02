-- =========================================================
-- ADMIN RPC: MANAGEMENT / LOGS / COMMUNITY
-- Depends on: 2026-03-15_core_admin_community.sql
-- =========================================================

create or replace function public.admin_list_users(
  p_session_token uuid,
  p_limit integer default 200
)
returns table(
  user_id uuid,
  name text,
  email text,
  total_xp bigint,
  level integer,
  daily_streak integer,
  relic_count integer,
  completed_habits integer,
  failed_habits integer,
  is_suspended boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
begin
  select admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token)
  limit 1;

  perform public.write_admin_audit(
    v_admin_id,
    'admin_list_users',
    null,
    jsonb_build_object('limit', greatest(1, least(1000, coalesce(p_limit, 200))))
  );

  return query
  with base as (
    select
      au.id::uuid as user_id,
      coalesce(
        nullif(trim(coalesce(p.name, '')), ''),
        nullif(trim(coalesce(au.raw_user_meta_data->>'name', '')), ''),
        nullif(trim(coalesce(au.raw_user_meta_data->>'full_name', '')), '')
      )::text as user_name,
      au.email::text as email,
      coalesce(p.total_xp, 0)::bigint as total_xp,
      coalesce(p.level, 0)::integer as level,
      coalesce(p.daily_streak, 0)::integer as daily_streak,
      coalesce(p.is_suspended, false)::boolean as is_suspended
    from auth.users au
    left join public.profiles p on p.id = au.id
  )
  select
    b.user_id::uuid,
    coalesce(nullif(trim(coalesce(b.user_name, '')), ''), b.email, b.user_id::text)::text as name,
    b.email::text,
    b.total_xp::bigint,
    b.level::integer,
    b.daily_streak::integer,
    coalesce((
      select count(*)::integer
      from public.discipline_relics dr
      where dr.user_id = b.user_id
        and coalesce(dr.used, false) = false
        and (dr.expires_at is null or dr.expires_at > now())
    ), 0)::integer as relic_count,
    coalesce((
      select count(*)::integer
      from public.habit_logs hl
      where hl.user_id = b.user_id
        and hl.status = 'completed'
    ), 0)::integer as completed_habits,
    coalesce((
      select count(*)::integer
      from public.habit_logs hl
      where hl.user_id = b.user_id
        and (
          hl.status = 'failed'
          or coalesce(hl.failed, false) = true
        )
    ), 0)::integer as failed_habits,
    b.is_suspended::boolean
  from base b
  order by b.total_xp desc, b.user_id
  limit greatest(1, least(1000, coalesce(p_limit, 200)));
end;
$$;

create or replace function public.admin_set_user_suspension(
  p_session_token uuid,
  p_user_id uuid,
  p_suspended boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
begin
  select admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token)
  limit 1;

  update public.profiles
  set is_suspended = coalesce(p_suspended, false)
  where id = p_user_id;

  if not found then
    return false;
  end if;

  perform public.write_admin_audit(
    v_admin_id,
    'admin_set_user_suspension',
    p_user_id,
    jsonb_build_object('is_suspended', coalesce(p_suspended, false))
  );

  return true;
end;
$$;

create or replace function public.admin_delete_user(
  p_session_token uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_deleted boolean := false;
begin
  select admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token)
  limit 1;

  begin
    delete from auth.users where id = p_user_id;
    v_deleted := found;
  exception
    when insufficient_privilege then
      delete from public.profiles where id = p_user_id;
      v_deleted := found;
  end;

  if v_deleted then
    perform public.write_admin_audit(v_admin_id, 'admin_delete_user', p_user_id, '{}'::jsonb);
  end if;

  return v_deleted;
end;
$$;

create or replace function public.admin_create_challenge(
  p_session_token uuid,
  p_target_user_id uuid default null,
  p_title text default null,
  p_description text default null,
  p_xp_reward integer default 120,
  p_relic_reward integer default 0,
  p_deadline timestamptz default null,
  p_punishment_type text default 'xp_deduction',
  p_punishment_value integer default 40
)
returns table(
  quest_id uuid,
  assigned_to_user boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_quest_id uuid;
  v_type text := 'special';
  v_title text := coalesce(nullif(trim(p_title), ''), 'Admin Challenge');
  v_punish text := lower(coalesce(p_punishment_type, 'xp_deduction'));
begin
  select admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token)
  limit 1;

  if v_punish not in ('xp_deduction', 'streak_reset', 'relic_loss') then
    v_punish := 'xp_deduction';
  end if;

  insert into public.quests (
    title,
    description,
    type,
    xp_reward,
    relic_reward,
    status,
    date,
    expires_date,
    deadline_at,
    punishment_type,
    punishment_value,
    created_by_admin
  )
  values (
    v_title,
    coalesce(nullif(trim(p_description), ''), 'Admin-created challenge'),
    v_type,
    greatest(0, coalesce(p_xp_reward, 120)),
    greatest(0, coalesce(p_relic_reward, 0)),
    'active',
    current_date,
    case when p_deadline is null then null else (p_deadline at time zone 'utc')::date end,
    p_deadline,
    v_punish,
    greatest(0, coalesce(p_punishment_value, 40)),
    true
  )
  returning id into v_quest_id;

  if p_target_user_id is not null then
    insert into public.user_quests (
      user_id,
      quest_id,
      status,
      started_at,
      expires_at,
      deadline_at,
      quest_type,
      xp_reward,
      relic_reward,
      punishment_type,
      punishment_value,
      progress_current,
      progress_target
    )
    values (
      p_target_user_id,
      v_quest_id,
      'active',
      now(),
      p_deadline,
      p_deadline,
      v_type,
      greatest(0, coalesce(p_xp_reward, 120)),
      greatest(0, coalesce(p_relic_reward, 0)),
      v_punish,
      greatest(0, coalesce(p_punishment_value, 40)),
      0,
      1
    )
    on conflict do nothing;
  end if;

  perform public.write_admin_audit(
    v_admin_id,
    'admin_create_challenge',
    p_target_user_id,
    jsonb_build_object(
      'quest_id', v_quest_id,
      'xp_reward', greatest(0, coalesce(p_xp_reward, 120)),
      'relic_reward', greatest(0, coalesce(p_relic_reward, 0)),
      'deadline_at', p_deadline,
      'punishment_type', v_punish,
      'punishment_value', greatest(0, coalesce(p_punishment_value, 40))
    )
  );

  return query
  select v_quest_id::uuid, (p_target_user_id is not null)::boolean;
end;
$$;

create or replace function public.admin_create_relic_type(
  p_session_token uuid,
  p_code text,
  p_name text,
  p_description text default null,
  p_rarity text default 'common',
  p_effect_type text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_id uuid;
  v_rarity text := lower(coalesce(p_rarity, 'common'));
begin
  select admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token)
  limit 1;

  if v_rarity not in ('common', 'rare', 'epic', 'legendary') then
    v_rarity := 'common';
  end if;

  insert into public.relic_types (code, name, description, rarity, effect_type)
  values (
    lower(regexp_replace(coalesce(p_code, ''), '[^a-z0-9_]+', '_', 'g')),
    coalesce(nullif(trim(p_name), ''), 'Custom Relic'),
    p_description,
    v_rarity,
    p_effect_type
  )
  on conflict (code) do update
    set
      name = excluded.name,
      description = excluded.description,
      rarity = excluded.rarity,
      effect_type = excluded.effect_type
  returning id into v_id;

  perform public.write_admin_audit(
    v_admin_id,
    'admin_create_relic_type',
    null,
    jsonb_build_object('relic_type_id', v_id, 'code', p_code, 'rarity', v_rarity)
  );

  return v_id;
end;
$$;

create or replace function public.admin_grant_relic(
  p_session_token uuid,
  p_user_id uuid,
  p_relic_type_id uuid default null,
  p_source text default 'admin_grant',
  p_rarity text default 'rare',
  p_count integer default 1,
  p_label text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_rarity text := lower(coalesce(p_rarity, 'rare'));
  v_count integer := greatest(1, least(20, coalesce(p_count, 1)));
  v_inserted integer := 0;
  i integer;
begin
  select admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token)
  limit 1;

  if v_rarity not in ('common', 'rare', 'epic', 'legendary') then
    v_rarity := 'rare';
  end if;

  for i in 1..v_count loop
    insert into public.discipline_relics (
      user_id,
      source,
      event_id,
      earned_at,
      used,
      rarity,
      relic_type_id,
      label,
      metadata
    )
    values (
      p_user_id,
      coalesce(nullif(trim(p_source), ''), 'admin_grant'),
      'admin:' || gen_random_uuid()::text,
      now(),
      false,
      v_rarity,
      p_relic_type_id,
      nullif(trim(coalesce(p_label, '')), ''),
      jsonb_build_object('admin_user_id', v_admin_id)
    );
    v_inserted := v_inserted + 1;
  end loop;

  perform public.write_admin_audit(
    v_admin_id,
    'admin_grant_relic',
    p_user_id,
    jsonb_build_object('count', v_inserted, 'rarity', v_rarity, 'relic_type_id', p_relic_type_id)
  );

  perform public.log_activity_event(
    p_user_id,
    'relic_reward',
    jsonb_build_object('count', v_inserted, 'rarity', v_rarity, 'source', p_source, 'admin_user_id', v_admin_id)
  );

  return v_inserted;
end;
$$;

create or replace function public.admin_remove_relic(
  p_session_token uuid,
  p_relic_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_user_id uuid;
begin
  select admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token)
  limit 1;

  select user_id into v_user_id
  from public.discipline_relics
  where id = p_relic_id
  limit 1;

  update public.discipline_relics
  set
    used = true,
    used_for = 'admin_remove',
    used_at = now()
  where id = p_relic_id;

  if not found then
    return false;
  end if;

  perform public.write_admin_audit(
    v_admin_id,
    'admin_remove_relic',
    v_user_id,
    jsonb_build_object('relic_id', p_relic_id)
  );

  return true;
end;
$$;

create or replace function public.admin_create_announcement(
  p_session_token uuid,
  p_title text,
  p_message text,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_id uuid;
begin
  select admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token)
  limit 1;

  insert into public.announcements (title, message, active, created_by_admin_id, expires_at)
  values (
    coalesce(nullif(trim(p_title), ''), 'System Announcement'),
    coalesce(nullif(trim(p_message), ''), 'No message'),
    true,
    v_admin_id,
    p_expires_at
  )
  returning id into v_id;

  perform public.write_admin_audit(
    v_admin_id,
    'admin_create_announcement',
    null,
    jsonb_build_object('announcement_id', v_id, 'expires_at', p_expires_at)
  );

  return v_id;
end;
$$;

create or replace function public.admin_list_activity_logs(
  p_session_token uuid,
  p_limit integer default 200
)
returns table(
  id uuid,
  user_id uuid,
  user_name text,
  type text,
  metadata jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
begin
  select admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token)
  limit 1;

  perform public.write_admin_audit(
    v_admin_id,
    'admin_list_activity_logs',
    null,
    jsonb_build_object('limit', greatest(1, least(1000, coalesce(p_limit, 200))))
  );

  return query
  select
    al.id::uuid,
    al.user_id::uuid,
    p.name::text,
    al.type::text,
    al.metadata::jsonb,
    al.created_at::timestamptz
  from public.activity_logs al
  left join public.profiles p on p.id = al.user_id
  order by al.created_at desc
  limit greatest(1, least(1000, coalesce(p_limit, 200)));
end;
$$;

create or replace function public.admin_list_community_submissions(
  p_session_token uuid,
  p_status text default null
)
returns table(
  id uuid,
  user_id uuid,
  user_name text,
  category text,
  message text,
  status text,
  admin_reply text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_filter text := lower(trim(coalesce(p_status, '')));
begin
  select admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token)
  limit 1;

  return query
  select
    cs.id::uuid,
    cs.user_id::uuid,
    p.name::text,
    cs.category::text,
    cs.message::text,
    cs.status::text,
    cs.admin_reply::text,
    cs.created_at::timestamptz,
    cs.updated_at::timestamptz
  from public.community_submissions cs
  left join public.profiles p on p.id = cs.user_id
  where (
    v_filter = ''
    or cs.status = v_filter
  )
  order by cs.created_at desc;
end;
$$;

create or replace function public.admin_reply_community_submission(
  p_session_token uuid,
  p_submission_id uuid,
  p_admin_reply text,
  p_status text default 'reviewed'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_status text := lower(coalesce(p_status, 'reviewed'));
  v_user_id uuid;
begin
  select admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token)
  limit 1;

  if v_status not in ('pending', 'reviewed', 'resolved') then
    v_status := 'reviewed';
  end if;

  update public.community_submissions
  set
    admin_reply = p_admin_reply,
    status = v_status
  where id = p_submission_id
  returning user_id into v_user_id;

  if not found then
    return false;
  end if;

  perform public.write_admin_audit(
    v_admin_id,
    'admin_reply_community_submission',
    v_user_id,
    jsonb_build_object('submission_id', p_submission_id, 'status', v_status)
  );

  return true;
end;
$$;

grant execute on function public.admin_list_users(uuid, integer) to anon, authenticated;
grant execute on function public.admin_set_user_suspension(uuid, uuid, boolean) to anon, authenticated;
grant execute on function public.admin_delete_user(uuid, uuid) to anon, authenticated;
grant execute on function public.admin_create_challenge(uuid, uuid, text, text, integer, integer, timestamptz, text, integer) to anon, authenticated;
grant execute on function public.admin_create_relic_type(uuid, text, text, text, text, text) to anon, authenticated;
grant execute on function public.admin_grant_relic(uuid, uuid, uuid, text, text, integer, text) to anon, authenticated;
grant execute on function public.admin_remove_relic(uuid, uuid) to anon, authenticated;
grant execute on function public.admin_create_announcement(uuid, text, text, timestamptz) to anon, authenticated;
grant execute on function public.admin_list_activity_logs(uuid, integer) to anon, authenticated;
grant execute on function public.admin_list_community_submissions(uuid, text) to anon, authenticated;
grant execute on function public.admin_reply_community_submission(uuid, uuid, text, text) to anon, authenticated;

-- =========================================================
-- TASK PUNISHMENT ENGINE
-- =========================================================

create table if not exists public.task_deadline_failures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_kind text not null check (task_kind in ('habit', 'quest')),
  task_id uuid not null,
  created_at timestamptz not null default now(),
  unique (user_id, task_kind, task_id)
);

alter table public.task_deadline_failures enable row level security;

create or replace function public.apply_task_punishment(
  p_user_id uuid,
  p_punishment_type text,
  p_punishment_value integer,
  p_source text,
  p_event_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text := lower(coalesce(p_punishment_type, 'xp_deduction'));
  v_value integer := greatest(0, coalesce(p_punishment_value, 0));
  v_relic_id uuid;
begin
  if v_type not in ('xp_deduction', 'streak_reset', 'relic_loss') then
    v_type := 'xp_deduction';
  end if;

  if v_type = 'xp_deduction' then
    perform public.penalty_xp(
      p_user_id,
      greatest(1, v_value),
      coalesce(nullif(trim(p_source), ''), 'task_deadline_penalty'),
      null,
      p_event_id,
      coalesce(p_metadata, '{}'::jsonb)
    );
    return jsonb_build_object('type', v_type, 'value', greatest(1, v_value));
  elsif v_type = 'streak_reset' then
    update public.profiles
    set daily_streak = 0
    where id = p_user_id;
    return jsonb_build_object('type', v_type, 'value', 0);
  else
    update public.discipline_relics dr
    set
      used = true,
      used_for = 'deadline_penalty',
      used_at = now()
    where dr.id = (
      select id
      from public.discipline_relics
      where user_id = p_user_id
        and used = false
        and (expires_at is null or expires_at > now())
      order by earned_at asc
      limit 1
      for update skip locked
    )
    returning dr.id into v_relic_id;

    return jsonb_build_object('type', v_type, 'relic_id', v_relic_id);
  end if;
end;
$$;

create or replace function public.apply_overdue_punishments(
  p_user_id uuid default null
)
returns table(
  failed_habit_count integer,
  failed_quest_count integer,
  penalties_applied integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := coalesce(p_user_id, auth.uid());
  v_failed_h integer := 0;
  v_failed_q integer := 0;
  v_penalties integer := 0;
  v_rowcount integer := 0;
  v_result jsonb;
  h record;
  q record;
begin
  if v_uid is null then
    raise exception 'forbidden';
  end if;

  if auth.uid() is not null and auth.uid() <> v_uid then
    raise exception 'forbidden';
  end if;

  for h in
    select hb.*
    from public.habits hb
    where hb.user_id = v_uid
      and hb.deadline_at is not null
      and hb.deadline_at <= now()
      and not exists (
        select 1 from public.habit_logs hl
        where hl.user_id = hb.user_id
          and hl.habit_id = hb.id
          and hl.status = 'completed'
      )
  loop
    insert into public.task_deadline_failures (user_id, task_kind, task_id)
    values (v_uid, 'habit', h.id)
    on conflict do nothing;
    get diagnostics v_rowcount = row_count;
    if v_rowcount = 0 then
      continue;
    end if;

    update public.habit_logs
    set
      status = 'failed',
      failed = true
    where user_id = v_uid
      and habit_id = h.id
      and date = current_date;
    get diagnostics v_rowcount = row_count;

    if v_rowcount = 0 then
      insert into public.habit_logs (user_id, habit_id, status, date, failed)
      values (v_uid, h.id, 'failed', current_date, true);
    end if;

    v_result := public.apply_task_punishment(
      v_uid,
      h.punishment_type,
      h.punishment_value,
      'habit_deadline_fail',
      'habit_deadline:' || h.id::text,
      jsonb_build_object('habit_id', h.id, 'deadline_at', h.deadline_at)
    );

    perform public.log_activity_event(
      v_uid,
      'habit_failed',
      jsonb_build_object(
        'habit_id', h.id,
        'title', h.title,
        'deadline_at', h.deadline_at,
        'punishment', v_result
      )
    );
    v_failed_h := v_failed_h + 1;
    v_penalties := v_penalties + 1;
  end loop;

  for q in
    select
      uq.id as user_quest_id,
      uq.quest_id,
      uq.status,
      uq.deadline_at as uq_deadline_at,
      uq.expires_at as uq_expires_at,
      uq.punishment_type as uq_punishment_type,
      uq.punishment_value as uq_punishment_value,
      qu.title,
      qu.deadline_at as q_deadline_at,
      qu.punishment_type as q_punishment_type,
      qu.punishment_value as q_punishment_value
    from public.user_quests uq
    join public.quests qu on qu.id = uq.quest_id
    where uq.user_id = v_uid
      and lower(coalesce(uq.status, '')) in ('active', 'in_progress', 'accepted', 'inprogress', 'ongoing', 'started', 'start')
      and coalesce(uq.deadline_at, uq.expires_at, qu.deadline_at) is not null
      and coalesce(uq.deadline_at, uq.expires_at, qu.deadline_at) <= now()
  loop
    insert into public.task_deadline_failures (user_id, task_kind, task_id)
    values (v_uid, 'quest', q.user_quest_id)
    on conflict do nothing;
    get diagnostics v_rowcount = row_count;
    if v_rowcount = 0 then
      continue;
    end if;

    update public.user_quests
    set
      status = 'failed',
      failed = true,
      penalty_applied = true,
      completed_date = current_date
    where id = q.user_quest_id
      and user_id = v_uid;

    v_result := public.apply_task_punishment(
      v_uid,
      coalesce(q.uq_punishment_type, q.q_punishment_type, 'xp_deduction'),
      coalesce(q.uq_punishment_value, q.q_punishment_value, 40),
      'quest_deadline_fail',
      'quest_deadline:' || q.user_quest_id::text,
      jsonb_build_object('quest_id', q.quest_id, 'user_quest_id', q.user_quest_id)
    );

    perform public.log_activity_event(
      v_uid,
      'quest_failed',
      jsonb_build_object(
        'quest_id', q.quest_id,
        'user_quest_id', q.user_quest_id,
        'title', q.title,
        'deadline_at', coalesce(q.uq_deadline_at, q.uq_expires_at, q.q_deadline_at),
        'punishment', v_result
      )
    );
    v_failed_q := v_failed_q + 1;
    v_penalties := v_penalties + 1;
  end loop;

  return query
  select v_failed_h, v_failed_q, v_penalties;
end;
$$;

grant execute on function public.apply_overdue_punishments(uuid) to authenticated;

-- =========================================================
-- DAILY RESET + WEEKLY LEADERBOARD + RELIC BATCH
-- =========================================================

create or replace function public.run_daily_reset(
  p_user_id uuid
)
returns table(
  reset_date date,
  did_reset boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stats_id uuid;
  v_last date;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  select id, last_daily_reset
  into v_stats_id, v_last
  from public.stats
  where user_id = p_user_id
  order by created_at desc nulls last
  limit 1;

  if v_stats_id is null then
    insert into public.stats (user_id, voice_enabled, hardcore_mode, last_daily_reset)
    values (p_user_id, true, false, current_date)
    returning id, last_daily_reset into v_stats_id, v_last;
    return query select current_date, true;
    return;
  end if;

  if v_last is distinct from current_date then
    update public.stats
    set last_daily_reset = current_date
    where id = v_stats_id;
    return query select current_date, true;
    return;
  end if;

  return query select current_date, false;
end;
$$;

create or replace function public.get_weekly_leaderboard(
  p_limit integer default 50
)
returns table(
  user_id uuid,
  name text,
  total_weekly_xp bigint,
  level integer,
  rank_position integer
)
language sql
security definer
set search_path = public
as $$
  with bounds as (
    select (current_date - ((extract(isodow from current_date)::int - 1)))::date as week_start
  ),
  agg as (
    select
      p.id as user_id,
      p.name,
      coalesce(sum(case when coalesce(x.xp_change, x.change_amount, 0) > 0 then coalesce(x.xp_change, x.change_amount, 0) else 0 end), 0)::bigint as total_weekly_xp,
      coalesce(p.level, 0) as level
    from public.profiles p
    left join public.xp_logs x on x.user_id = p.id
      and coalesce(x.date, (x.created_at at time zone 'utc')::date) >= (select week_start from bounds)
    group by p.id, p.name, p.level
  )
  select
    a.user_id,
    a.name,
    a.total_weekly_xp,
    a.level,
    row_number() over (order by a.total_weekly_xp desc, a.level desc, a.user_id) as rank_position
  from agg a
  order by a.total_weekly_xp desc, a.level desc, a.user_id
  limit greatest(1, least(500, coalesce(p_limit, 50)));
$$;

create or replace function public.grant_relic_batch(
  p_user_id uuid,
  p_count integer default 1,
  p_source text default 'reward',
  p_event_id text default null,
  p_rarity text default 'rare',
  p_metadata jsonb default '{}'::jsonb
)
returns table(
  granted_count integer,
  current_balance integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rarity text := lower(coalesce(p_rarity, 'rare'));
  v_target integer := greatest(0, least(20, coalesce(p_count, 1)));
  v_current integer := 0;
  v_can_add integer := 0;
  i integer;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  if v_rarity not in ('common', 'rare', 'epic', 'legendary') then
    v_rarity := 'rare';
  end if;

  select count(*)::integer
  into v_current
  from public.discipline_relics dr
  where dr.user_id = p_user_id
    and dr.used = false
    and (dr.expires_at is null or dr.expires_at > now());

  v_can_add := greatest(0, least(v_target, 20 - coalesce(v_current, 0)));

  for i in 1..v_can_add loop
    insert into public.discipline_relics (
      user_id,
      source,
      event_id,
      earned_at,
      used,
      rarity,
      metadata
    )
    values (
      p_user_id,
      coalesce(nullif(trim(p_source), ''), 'reward'),
      case
        when p_event_id is null then null
        else p_event_id || ':' || i::text
      end,
      now(),
      false,
      v_rarity,
      coalesce(p_metadata, '{}'::jsonb)
    )
    on conflict do nothing;
  end loop;

  select count(*)::integer
  into v_current
  from public.discipline_relics dr
  where dr.user_id = p_user_id
    and dr.used = false
    and (dr.expires_at is null or dr.expires_at > now());

  perform public.log_activity_event(
    p_user_id,
    'relic_reward',
    jsonb_build_object('granted_count', v_can_add, 'rarity', v_rarity, 'source', p_source)
  );

  return query
  select v_can_add, v_current;
end;
$$;

grant execute on function public.run_daily_reset(uuid) to authenticated;
grant execute on function public.get_weekly_leaderboard(integer) to authenticated;
grant execute on function public.grant_relic_batch(uuid, integer, text, text, text, jsonb) to authenticated;
