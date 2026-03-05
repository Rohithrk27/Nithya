-- User guide system (core user onboarding) with admin-managed versioned content.
-- Scope: user_main guide (user audience, en language), progress persistence per user/version.
-- Depends on: 2026-03-15_core_admin_community.sql

set search_path = public, extensions;

create table if not exists public.user_guides (
  id uuid primary key default gen_random_uuid(),
  guide_key text not null,
  audience text not null default 'user',
  language text not null default 'en',
  version integer not null,
  status text not null default 'draft',
  title text not null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_guide_steps (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references public.user_guides(id) on delete cascade,
  step_order integer not null,
  route text not null,
  target_selector text,
  title text not null,
  description text not null,
  placement text not null default 'auto',
  allow_next_without_target boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_guide_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  guide_key text not null,
  version integer not null,
  status text not null default 'started',
  last_step_order integer,
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  skipped_at timestamptz,
  primary key (user_id, guide_key, version)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_guides_status_check'
      and conrelid = 'public.user_guides'::regclass
  ) then
    alter table public.user_guides
      add constraint user_guides_status_check
      check (status in ('draft', 'published'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_guide_steps_step_order_check'
      and conrelid = 'public.user_guide_steps'::regclass
  ) then
    alter table public.user_guide_steps
      add constraint user_guide_steps_step_order_check
      check (step_order > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_guide_steps_placement_check'
      and conrelid = 'public.user_guide_steps'::regclass
  ) then
    alter table public.user_guide_steps
      add constraint user_guide_steps_placement_check
      check (placement in ('auto', 'top', 'bottom', 'left', 'right', 'center'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_guide_progress_status_check'
      and conrelid = 'public.user_guide_progress'::regclass
  ) then
    alter table public.user_guide_progress
      add constraint user_guide_progress_status_check
      check (status in ('started', 'skipped', 'completed'));
  end if;
end $$;

create unique index if not exists user_guides_version_unique_idx
  on public.user_guides (guide_key, audience, language, version);

create unique index if not exists user_guides_one_published_idx
  on public.user_guides (guide_key, audience, language)
  where status = 'published';

create unique index if not exists user_guide_steps_guide_step_unique_idx
  on public.user_guide_steps (guide_id, step_order);

create index if not exists user_guide_steps_guide_order_idx
  on public.user_guide_steps (guide_id, step_order);

create index if not exists user_guide_progress_user_idx
  on public.user_guide_progress (user_id, guide_key, version);

alter table public.user_guides enable row level security;
alter table public.user_guide_steps enable row level security;
alter table public.user_guide_progress enable row level security;

drop policy if exists user_guides_select_published on public.user_guides;
create policy user_guides_select_published
on public.user_guides
for select
using (status = 'published');

drop policy if exists user_guide_steps_select_published on public.user_guide_steps;
create policy user_guide_steps_select_published
on public.user_guide_steps
for select
using (
  exists (
    select 1
    from public.user_guides g
    where g.id = user_guide_steps.guide_id
      and g.status = 'published'
  )
);

drop policy if exists user_guide_progress_select_own on public.user_guide_progress;
create policy user_guide_progress_select_own
on public.user_guide_progress
for select
using (auth.uid() = user_id);

drop policy if exists user_guide_progress_insert_own on public.user_guide_progress;
create policy user_guide_progress_insert_own
on public.user_guide_progress
for insert
with check (auth.uid() = user_id);

drop policy if exists user_guide_progress_update_own on public.user_guide_progress;
create policy user_guide_progress_update_own
on public.user_guide_progress
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

grant select on public.user_guides to authenticated;
grant select on public.user_guide_steps to authenticated;
grant select, insert, update on public.user_guide_progress to authenticated;

create or replace function public.get_active_user_guide(
  p_user_id uuid,
  p_language text default 'en'
)
returns table(
  guide_key text,
  version integer,
  title text,
  language text,
  steps jsonb,
  progress_status text,
  progress_last_step_order integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_language text := lower(coalesce(nullif(trim(p_language), ''), 'en'));
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  return query
  with active_guide as (
    select ug.*
    from public.user_guides ug
    where ug.guide_key = 'user_main'
      and ug.audience = 'user'
      and ug.language = v_language
      and ug.status = 'published'
    order by ug.version desc, ug.updated_at desc
    limit 1
  ),
  progress as (
    select gp.*
    from public.user_guide_progress gp
    join active_guide ag
      on ag.guide_key = gp.guide_key
      and ag.version = gp.version
    where gp.user_id = p_user_id
    limit 1
  )
  select
    ag.guide_key::text,
    ag.version::integer,
    ag.title::text,
    ag.language::text,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', s.id,
            'stepOrder', s.step_order,
            'route', s.route,
            'targetSelector', s.target_selector,
            'title', s.title,
            'description', s.description,
            'placement', s.placement,
            'allowNextWithoutTarget', s.allow_next_without_target
          )
          order by s.step_order
        )
        from public.user_guide_steps s
        where s.guide_id = ag.id
      ),
      '[]'::jsonb
    ) as steps,
    (select p.status::text from progress p),
    (select p.last_step_order::integer from progress p)
  from active_guide ag;
end;
$$;

create or replace function public.upsert_user_guide_progress(
  p_user_id uuid,
  p_guide_key text,
  p_version integer,
  p_status text,
  p_last_step_order integer default null
)
returns public.user_guide_progress
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guide_key text := coalesce(nullif(trim(p_guide_key), ''), 'user_main');
  v_status text := lower(coalesce(nullif(trim(p_status), ''), 'started'));
  v_last_step_order integer := case
    when p_last_step_order is null then null
    else greatest(1, p_last_step_order)
  end;
  v_row public.user_guide_progress%rowtype;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  if v_status not in ('started', 'skipped', 'completed') then
    raise exception 'invalid_guide_progress_status';
  end if;

  if not exists (
    select 1
    from public.user_guides ug
    where ug.guide_key = v_guide_key
      and ug.version = p_version
  ) then
    raise exception 'guide_version_not_found';
  end if;

  insert into public.user_guide_progress (
    user_id,
    guide_key,
    version,
    status,
    last_step_order,
    updated_at,
    completed_at,
    skipped_at
  )
  values (
    p_user_id,
    v_guide_key,
    p_version,
    v_status,
    v_last_step_order,
    now(),
    case when v_status = 'completed' then now() else null end,
    case when v_status = 'skipped' then now() else null end
  )
  on conflict (user_id, guide_key, version) do update
  set
    status = excluded.status,
    last_step_order = coalesce(excluded.last_step_order, user_guide_progress.last_step_order),
    updated_at = now(),
    completed_at = case
      when excluded.status = 'completed' then coalesce(user_guide_progress.completed_at, now())
      else user_guide_progress.completed_at
    end,
    skipped_at = case
      when excluded.status = 'skipped' then coalesce(user_guide_progress.skipped_at, now())
      else user_guide_progress.skipped_at
    end
  returning *
  into v_row;

  return v_row;
end;
$$;

create or replace function public.admin_list_user_guides(
  p_session_token uuid,
  p_guide_key text default 'user_main',
  p_language text default 'en',
  p_include_drafts boolean default true
)
returns table(
  id uuid,
  guide_key text,
  audience text,
  language text,
  version integer,
  status text,
  title text,
  published_at timestamptz,
  updated_at timestamptz,
  step_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_guide_key text := coalesce(nullif(trim(p_guide_key), ''), 'user_main');
  v_language text := lower(coalesce(nullif(trim(p_language), ''), 'en'));
  v_include_drafts boolean := coalesce(p_include_drafts, true);
begin
  select admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token)
  limit 1;

  perform public.write_admin_audit(
    v_admin_id,
    'admin_list_user_guides',
    null,
    jsonb_build_object(
      'guide_key', v_guide_key,
      'language', v_language,
      'include_drafts', v_include_drafts
    )
  );

  return query
  select
    g.id,
    g.guide_key,
    g.audience,
    g.language,
    g.version,
    g.status,
    g.title,
    g.published_at,
    g.updated_at,
    coalesce((select count(*)::integer from public.user_guide_steps s where s.guide_id = g.id), 0)::integer as step_count
  from public.user_guides g
  where g.guide_key = v_guide_key
    and g.language = v_language
    and (v_include_drafts or g.status = 'published')
  order by g.version desc, g.updated_at desc;
end;
$$;

create or replace function public.admin_create_user_guide(
  p_session_token uuid,
  p_guide_key text default 'user_main',
  p_audience text default 'user',
  p_language text default 'en',
  p_title text default 'Main User Guide',
  p_version integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_guide_key text := coalesce(nullif(trim(p_guide_key), ''), 'user_main');
  v_audience text := lower(coalesce(nullif(trim(p_audience), ''), 'user'));
  v_language text := lower(coalesce(nullif(trim(p_language), ''), 'en'));
  v_title text := coalesce(nullif(trim(p_title), ''), 'Main User Guide');
  v_version integer;
  v_id uuid;
begin
  select admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token)
  limit 1;

  if p_version is not null and p_version > 0 then
    v_version := p_version;
  else
    select coalesce(max(g.version), 0) + 1
    into v_version
    from public.user_guides g
    where g.guide_key = v_guide_key
      and g.audience = v_audience
      and g.language = v_language;
  end if;

  insert into public.user_guides (
    guide_key,
    audience,
    language,
    version,
    status,
    title,
    published_at,
    created_at,
    updated_at
  )
  values (
    v_guide_key,
    v_audience,
    v_language,
    v_version,
    'draft',
    v_title,
    null,
    now(),
    now()
  )
  returning id
  into v_id;

  perform public.write_admin_audit(
    v_admin_id,
    'admin_create_user_guide',
    null,
    jsonb_build_object(
      'guide_id', v_id,
      'guide_key', v_guide_key,
      'audience', v_audience,
      'language', v_language,
      'version', v_version
    )
  );

  return v_id;
end;
$$;

create or replace function public.admin_update_user_guide(
  p_session_token uuid,
  p_guide_id uuid,
  p_title text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_row public.user_guides%rowtype;
begin
  select admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token)
  limit 1;

  update public.user_guides g
  set
    title = coalesce(nullif(trim(p_title), ''), g.title),
    updated_at = now()
  where g.id = p_guide_id
  returning *
  into v_row;

  if not found then
    return false;
  end if;

  perform public.write_admin_audit(
    v_admin_id,
    'admin_update_user_guide',
    null,
    jsonb_build_object(
      'guide_id', v_row.id,
      'version', v_row.version,
      'status', v_row.status
    )
  );

  return true;
end;
$$;

create or replace function public.admin_publish_user_guide(
  p_session_token uuid,
  p_guide_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_row public.user_guides%rowtype;
begin
  select admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token)
  limit 1;

  select *
  into v_row
  from public.user_guides g
  where g.id = p_guide_id
  for update;

  if not found then
    return false;
  end if;

  update public.user_guides g
  set
    status = 'draft',
    updated_at = now()
  where g.guide_key = v_row.guide_key
    and g.audience = v_row.audience
    and g.language = v_row.language
    and g.id <> v_row.id
    and g.status = 'published';

  update public.user_guides
  set
    status = 'published',
    published_at = coalesce(published_at, now()),
    updated_at = now()
  where id = v_row.id;

  perform public.write_admin_audit(
    v_admin_id,
    'admin_publish_user_guide',
    null,
    jsonb_build_object(
      'guide_id', v_row.id,
      'guide_key', v_row.guide_key,
      'version', v_row.version
    )
  );

  return true;
end;
$$;

create or replace function public.admin_list_user_guide_steps(
  p_session_token uuid,
  p_guide_id uuid
)
returns table(
  id uuid,
  guide_id uuid,
  step_order integer,
  route text,
  target_selector text,
  title text,
  description text,
  placement text,
  allow_next_without_target boolean,
  updated_at timestamptz
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
    'admin_list_user_guide_steps',
    null,
    jsonb_build_object('guide_id', p_guide_id)
  );

  return query
  select
    s.id,
    s.guide_id,
    s.step_order,
    s.route,
    s.target_selector,
    s.title,
    s.description,
    s.placement,
    s.allow_next_without_target,
    s.updated_at
  from public.user_guide_steps s
  where s.guide_id = p_guide_id
  order by s.step_order asc, s.updated_at desc;
end;
$$;

create or replace function public.admin_create_user_guide_step(
  p_session_token uuid,
  p_guide_id uuid,
  p_step_order integer,
  p_route text,
  p_target_selector text default null,
  p_title text default null,
  p_description text default null,
  p_placement text default 'auto',
  p_allow_next_without_target boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_id uuid;
  v_route text := coalesce(nullif(trim(p_route), ''), '/dashboard');
  v_title text := coalesce(nullif(trim(p_title), ''), 'Guide Step');
  v_description text := coalesce(nullif(trim(p_description), ''), '');
  v_placement text := lower(coalesce(nullif(trim(p_placement), ''), 'auto'));
begin
  select admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token)
  limit 1;

  if v_placement not in ('auto', 'top', 'bottom', 'left', 'right', 'center') then
    v_placement := 'auto';
  end if;

  insert into public.user_guide_steps (
    guide_id,
    step_order,
    route,
    target_selector,
    title,
    description,
    placement,
    allow_next_without_target,
    created_at,
    updated_at
  )
  values (
    p_guide_id,
    greatest(1, coalesce(p_step_order, 1)),
    v_route,
    nullif(trim(coalesce(p_target_selector, '')), ''),
    v_title,
    v_description,
    v_placement,
    coalesce(p_allow_next_without_target, false),
    now(),
    now()
  )
  returning id
  into v_id;

  perform public.write_admin_audit(
    v_admin_id,
    'admin_create_user_guide_step',
    null,
    jsonb_build_object(
      'guide_id', p_guide_id,
      'step_id', v_id,
      'step_order', greatest(1, coalesce(p_step_order, 1))
    )
  );

  return v_id;
end;
$$;

create or replace function public.admin_update_user_guide_step(
  p_session_token uuid,
  p_step_id uuid,
  p_step_order integer default null,
  p_route text default null,
  p_target_selector text default null,
  p_title text default null,
  p_description text default null,
  p_placement text default null,
  p_allow_next_without_target boolean default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_step public.user_guide_steps%rowtype;
  v_placement text;
begin
  select admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token)
  limit 1;

  select *
  into v_step
  from public.user_guide_steps s
  where s.id = p_step_id
  for update;

  if not found then
    return false;
  end if;

  v_placement := lower(coalesce(nullif(trim(p_placement), ''), v_step.placement));
  if v_placement not in ('auto', 'top', 'bottom', 'left', 'right', 'center') then
    v_placement := v_step.placement;
  end if;

  update public.user_guide_steps s
  set
    step_order = coalesce(greatest(1, p_step_order), s.step_order),
    route = coalesce(nullif(trim(p_route), ''), s.route),
    target_selector = case
      when p_target_selector is null then s.target_selector
      else nullif(trim(p_target_selector), '')
    end,
    title = coalesce(nullif(trim(p_title), ''), s.title),
    description = coalesce(nullif(trim(p_description), ''), s.description),
    placement = v_placement,
    allow_next_without_target = coalesce(p_allow_next_without_target, s.allow_next_without_target),
    updated_at = now()
  where s.id = p_step_id;

  perform public.write_admin_audit(
    v_admin_id,
    'admin_update_user_guide_step',
    null,
    jsonb_build_object(
      'step_id', p_step_id,
      'guide_id', v_step.guide_id
    )
  );

  return true;
end;
$$;

create or replace function public.admin_delete_user_guide_step(
  p_session_token uuid,
  p_step_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_step public.user_guide_steps%rowtype;
begin
  select admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token)
  limit 1;

  delete from public.user_guide_steps s
  where s.id = p_step_id
  returning *
  into v_step;

  if not found then
    return false;
  end if;

  perform public.write_admin_audit(
    v_admin_id,
    'admin_delete_user_guide_step',
    null,
    jsonb_build_object(
      'step_id', v_step.id,
      'guide_id', v_step.guide_id,
      'step_order', v_step.step_order
    )
  );

  return true;
end;
$$;

grant execute on function public.get_active_user_guide(uuid, text) to authenticated;
grant execute on function public.upsert_user_guide_progress(uuid, text, integer, text, integer) to authenticated;
grant execute on function public.admin_list_user_guides(uuid, text, text, boolean) to anon, authenticated;
grant execute on function public.admin_create_user_guide(uuid, text, text, text, text, integer) to anon, authenticated;
grant execute on function public.admin_update_user_guide(uuid, uuid, text) to anon, authenticated;
grant execute on function public.admin_publish_user_guide(uuid, uuid) to anon, authenticated;
grant execute on function public.admin_list_user_guide_steps(uuid, uuid) to anon, authenticated;
grant execute on function public.admin_create_user_guide_step(uuid, uuid, integer, text, text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.admin_update_user_guide_step(uuid, uuid, integer, text, text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.admin_delete_user_guide_step(uuid, uuid) to anon, authenticated;

do $$
declare
  v_guide_id uuid;
begin
  insert into public.user_guides (
    guide_key,
    audience,
    language,
    version,
    status,
    title,
    published_at,
    created_at,
    updated_at
  )
  values (
    'user_main',
    'user',
    'en',
    1,
    'published',
    'Main Feature Guide',
    now(),
    now(),
    now()
  )
  on conflict (guide_key, audience, language, version) do update
  set
    title = excluded.title,
    status = 'published',
    published_at = coalesce(public.user_guides.published_at, now()),
    updated_at = now()
  returning id
  into v_guide_id;

  update public.user_guides
  set
    status = 'draft',
    updated_at = now()
  where guide_key = 'user_main'
    and audience = 'user'
    and language = 'en'
    and id <> v_guide_id
    and status = 'published';

  insert into public.user_guide_steps (
    guide_id, step_order, route, target_selector, title, description, placement, allow_next_without_target, created_at, updated_at
  )
  values
    (v_guide_id, 1, '/dashboard', '[data-guide-id="dashboard-overview"]', 'Dashboard Overview', 'This is your command center for level, XP, and today''s mission status.', 'bottom', true, now(), now()),
    (v_guide_id, 2, '/dashboard', '[data-guide-id="dashboard-core-stats"]', 'Core Stat Panel', 'Use stat points to strengthen your build. Stats influence growth and progression outcomes.', 'left', true, now(), now()),
    (v_guide_id, 3, '/dashboard', '[data-guide-id="dashboard-active-quests"]', 'Active Quests Widget', 'Your currently active quests appear here. Open Quests to continue, complete, or fail them.', 'top', true, now(), now()),
    (v_guide_id, 4, '/habits', '[data-guide-id="habits-add-edit"]', 'Habits: Add / Edit', 'Create habits and edit details anytime. Habit completion drives consistency and XP growth.', 'bottom', true, now(), now()),
    (v_guide_id, 5, '/habits', '[data-guide-id="habits-punishment-rules"]', 'Habits: Punishment Rules', 'Each habit carries punishment rules. Refusing or missing can trigger penalties and debt.', 'right', true, now(), now()),
    (v_guide_id, 6, '/quests', '[data-guide-id="quests-tab-available"]', 'Quests: Accept Flow', 'Open AVAILABLE to accept quests. Accepted quests move into your in-progress queue.', 'bottom', true, now(), now()),
    (v_guide_id, 7, '/quests', '[data-guide-id="quests-tab-progress"]', 'Quests: Complete vs Fail', 'Use PROGRESS to complete or fail active quests. Outcomes change XP, streaks, and discipline pressure.', 'bottom', true, now(), now()),
    (v_guide_id, 8, '/punishments', '[data-guide-id="punishments-active-section"]', 'Punishments', 'Active punishments show a timer and projected loss. Resolve before expiry to reduce damage.', 'top', true, now(), now()),
    (v_guide_id, 9, '/recovery', '[data-guide-id="recovery-steps-section"]', 'Recovery Plan', 'Recovery steps help regain momentum. Clear steps for XP and to stabilize your system state.', 'top', true, now(), now()),
    (v_guide_id, 10, '/insights', '[data-guide-id="insights-regenerate-section"]', 'Insights', 'Regenerate to refresh worked/failed analysis and adjustment advice from your latest activity.', 'bottom', true, now(), now())
  on conflict (guide_id, step_order) do update
  set
    route = excluded.route,
    target_selector = excluded.target_selector,
    title = excluded.title,
    description = excluded.description,
    placement = excluded.placement,
    allow_next_without_target = excluded.allow_next_without_target,
    updated_at = now();
end $$;

notify pgrst, 'reload schema';
