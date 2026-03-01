-- Quest board rebuild:
-- 1) deterministic quest pools (daily/weekly/special/epic)
-- 2) robust weekly activation guard (ignore expired stale rows)
-- 3) explicit user_quests RLS policies for select/insert/update/delete

create extension if not exists pgcrypto;

alter table public.quests
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists type text,
  add column if not exists xp_reward integer not null default 0,
  add column if not exists stat_reward text,
  add column if not exists stat_reward_amount integer not null default 1,
  add column if not exists min_level_required integer not null default 0,
  add column if not exists progress_current integer not null default 0,
  add column if not exists progress_target integer not null default 100,
  add column if not exists status text not null default 'active',
  add column if not exists date date not null default current_date,
  add column if not exists expires_date date;

alter table public.user_quests
  add column if not exists quest_type text,
  add column if not exists started_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists xp_reward integer not null default 0,
  add column if not exists failed boolean not null default false,
  add column if not exists penalty_applied boolean not null default false,
  add column if not exists failure_reason text,
  add column if not exists completed_date date,
  add column if not exists date date not null default current_date;

create or replace function public.quest_duration_interval(p_quest_type text)
returns interval
language sql
immutable
as $$
  select case lower(coalesce(p_quest_type, 'daily'))
    when 'weekly' then interval '7 days'
    when 'special' then interval '30 days'
    when 'epic' then interval '45 days'
    else interval '1 day'
  end;
$$;

update public.quests
set
  type = coalesce(nullif(lower(trim(coalesce(type, ''))), ''), 'daily'),
  xp_reward = greatest(0, coalesce(xp_reward, 0)),
  stat_reward_amount = greatest(1, coalesce(stat_reward_amount, 1)),
  min_level_required = greatest(0, coalesce(min_level_required, 0)),
  progress_target = greatest(1, coalesce(progress_target, 100)),
  progress_current = greatest(0, least(coalesce(progress_current, 0), greatest(1, coalesce(progress_target, 100)))),
  status = coalesce(nullif(lower(trim(coalesce(status, ''))), ''), 'active'),
  date = coalesce(date, current_date)
where true;

create index if not exists quests_type_level_idx
  on public.quests (type, min_level_required, title);

create index if not exists user_quests_user_type_status_idx
  on public.user_quests (user_id, quest_type, status, expires_at);

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
         and lower(coalesce(uq.status, '')) in ('active', 'in_progress', 'accepted', 'inprogress', 'ongoing', 'started', 'start')
         and lower(coalesce(uq.quest_type, 'daily')) = 'weekly'
         and uq.quest_id <> p_quest_id
         and coalesce(
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

do $$
declare
  v_template jsonb;
  v_title text;
  v_type text;
  v_seed_user_id uuid := null;
  v_has_user_id boolean := false;
  v_user_id_required boolean := false;
  v_existing_id uuid;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quests'
      and column_name = 'user_id'
  ) into v_has_user_id;

  if v_has_user_id then
    select (c.is_nullable = 'NO')
    into v_user_id_required
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'quests'
      and c.column_name = 'user_id'
    limit 1;

    begin
      execute 'select q.user_id from public.quests q where q.user_id is not null order by q.created_at desc nulls last limit 1'
      into v_seed_user_id;
    exception
      when undefined_column then
        v_seed_user_id := null;
    end;

    if v_seed_user_id is null then
      select u.id into v_seed_user_id
      from auth.users u
      order by u.created_at asc
      limit 1;
    end if;
  end if;

  for v_template in
    select value
    from jsonb_array_elements(
      '[
        {"type":"daily","title":"Hydration Protocol","description":"Drink 8 glasses of water today.","xp_reward":70,"stat_reward":"health","stat_reward_amount":1,"min_level_required":0,"progress_target":1},
        {"type":"daily","title":"Deep Study Session","description":"Focus on study or reading for 30 minutes.","xp_reward":85,"stat_reward":"intelligence","stat_reward_amount":1,"min_level_required":0,"progress_target":1},
        {"type":"daily","title":"Movement Discipline","description":"Complete at least one workout today.","xp_reward":90,"stat_reward":"strength","stat_reward_amount":1,"min_level_required":0,"progress_target":1},
        {"type":"daily","title":"Career Sprint","description":"Do one career-focused action today.","xp_reward":80,"stat_reward":"career","stat_reward_amount":1,"min_level_required":0,"progress_target":1},
        {"type":"daily","title":"Social Pulse","description":"Initiate one meaningful conversation.","xp_reward":75,"stat_reward":"social","stat_reward_amount":1,"min_level_required":0,"progress_target":1},

        {"type":"weekly","title":"Iron Will Week","description":"Complete all habits for 5 days this week.","xp_reward":420,"stat_reward":"discipline","stat_reward_amount":1,"min_level_required":0,"progress_target":5},
        {"type":"weekly","title":"Scholar Momentum","description":"Log 5 study blocks this week.","xp_reward":390,"stat_reward":"intelligence","stat_reward_amount":1,"min_level_required":0,"progress_target":5},
        {"type":"weekly","title":"Strength Rhythm","description":"Finish 4 workouts this week.","xp_reward":410,"stat_reward":"strength","stat_reward_amount":1,"min_level_required":0,"progress_target":4},
        {"type":"weekly","title":"Social Circuit","description":"Reach out to 5 people this week.","xp_reward":360,"stat_reward":"social","stat_reward_amount":1,"min_level_required":0,"progress_target":5},

        {"type":"special","title":"Special Quest Lv20","description":"Maintain a 7-day consistency streak.","xp_reward":650,"stat_reward":"consistency","stat_reward_amount":1,"min_level_required":20,"progress_target":7},
        {"type":"special","title":"Special Quest Lv40","description":"Complete 14 focused sessions in one cycle.","xp_reward":820,"stat_reward":"discipline","stat_reward_amount":1,"min_level_required":40,"progress_target":14},
        {"type":"special","title":"Special Quest Lv60","description":"Complete 20 deep work blocks.","xp_reward":980,"stat_reward":"career","stat_reward_amount":1,"min_level_required":60,"progress_target":20},
        {"type":"special","title":"Special Quest Lv80","description":"Track health goals for 21 days.","xp_reward":1140,"stat_reward":"health","stat_reward_amount":1,"min_level_required":80,"progress_target":21},
        {"type":"special","title":"Special Quest Lv100","description":"Finish 30 study sessions at high focus.","xp_reward":1300,"stat_reward":"intelligence","stat_reward_amount":1,"min_level_required":100,"progress_target":30},

        {"type":"epic","title":"Epic Quest Lv100","description":"Sustain elite discipline for 30 days.","xp_reward":5200,"stat_reward":"discipline","stat_reward_amount":1,"min_level_required":100,"progress_target":30},
        {"type":"epic","title":"Epic Quest Lv200","description":"Hit advanced multi-stat growth checkpoints.","xp_reward":7900,"stat_reward":"consistency","stat_reward_amount":1,"min_level_required":200,"progress_target":40},
        {"type":"epic","title":"Epic Quest Lv300","description":"Complete a full-system mastery cycle.","xp_reward":10800,"stat_reward":"career","stat_reward_amount":1,"min_level_required":300,"progress_target":50}
      ]'::jsonb
    )
  loop
    v_title := nullif(trim(coalesce(v_template->>'title', '')), '');
    v_type := coalesce(nullif(lower(trim(coalesce(v_template->>'type', ''))), ''), 'daily');

    if v_title is null then
      continue;
    end if;

    v_existing_id := null;

    update public.quests q
    set
      description = coalesce(v_template->>'description', q.description),
      type = v_type,
      xp_reward = greatest(0, coalesce((v_template->>'xp_reward')::integer, q.xp_reward, 0)),
      stat_reward = nullif(trim(coalesce(v_template->>'stat_reward', '')), ''),
      stat_reward_amount = greatest(1, coalesce((v_template->>'stat_reward_amount')::integer, q.stat_reward_amount, 1)),
      min_level_required = greatest(0, coalesce((v_template->>'min_level_required')::integer, q.min_level_required, 0)),
      progress_target = greatest(1, coalesce((v_template->>'progress_target')::integer, q.progress_target, 100)),
      progress_current = least(
        greatest(0, coalesce(q.progress_current, 0)),
        greatest(1, coalesce((v_template->>'progress_target')::integer, q.progress_target, 100))
      ),
      status = 'active',
      date = coalesce(q.date, current_date),
      expires_date = null
    where lower(trim(coalesce(q.title, ''))) = lower(v_title)
      and lower(coalesce(q.type, 'daily')) = v_type
    returning q.id
    into v_existing_id;

    if v_existing_id is not null then
      continue;
    end if;

    if v_has_user_id then
      if v_seed_user_id is null and v_user_id_required then
        raise notice 'Skipping quest seed for %, user_id required but no auth.users row available', v_title;
        continue;
      end if;

      insert into public.quests (
        user_id,
        title,
        description,
        type,
        xp_reward,
        stat_reward,
        stat_reward_amount,
        min_level_required,
        progress_target,
        progress_current,
        status,
        date,
        expires_date
      )
      values (
        v_seed_user_id,
        v_title,
        coalesce(v_template->>'description', ''),
        v_type,
        greatest(0, coalesce((v_template->>'xp_reward')::integer, 0)),
        nullif(trim(coalesce(v_template->>'stat_reward', '')), ''),
        greatest(1, coalesce((v_template->>'stat_reward_amount')::integer, 1)),
        greatest(0, coalesce((v_template->>'min_level_required')::integer, 0)),
        greatest(1, coalesce((v_template->>'progress_target')::integer, 100)),
        0,
        'active',
        current_date,
        null
      );
    else
      insert into public.quests (
        title,
        description,
        type,
        xp_reward,
        stat_reward,
        stat_reward_amount,
        min_level_required,
        progress_target,
        progress_current,
        status,
        date,
        expires_date
      )
      values (
        v_title,
        coalesce(v_template->>'description', ''),
        v_type,
        greatest(0, coalesce((v_template->>'xp_reward')::integer, 0)),
        nullif(trim(coalesce(v_template->>'stat_reward', '')), ''),
        greatest(1, coalesce((v_template->>'stat_reward_amount')::integer, 1)),
        greatest(0, coalesce((v_template->>'min_level_required')::integer, 0)),
        greatest(1, coalesce((v_template->>'progress_target')::integer, 100)),
        0,
        'active',
        current_date,
        null
      );
    end if;
  end loop;
end;
$$;

alter table public.user_quests enable row level security;

drop policy if exists user_quests_select_own on public.user_quests;
create policy user_quests_select_own
on public.user_quests for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists user_quests_insert_own on public.user_quests;
create policy user_quests_insert_own
on public.user_quests for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists user_quests_update_own on public.user_quests;
create policy user_quests_update_own
on public.user_quests for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists user_quests_delete_own on public.user_quests;
create policy user_quests_delete_own
on public.user_quests for delete
to authenticated
using (auth.uid() = user_id);

do $$
declare
  v_quests_rls boolean := false;
begin
  select c.relrowsecurity
  into v_quests_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'quests'
  limit 1;

  if coalesce(v_quests_rls, false) then
    execute 'drop policy if exists quests_select_templates on public.quests';
    execute 'create policy quests_select_templates on public.quests for select to authenticated using (true)';
  end if;
end;
$$;
