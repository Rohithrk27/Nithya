-- Admin dashboard compatibility hardening for Challenge + Relic tools.
-- Depends on: 2026-03-22_admin_audit_fk_guard.sql

create extension if not exists pgcrypto;
set search_path = public, extensions;

-- =========================================================
-- SCHEMA NORMALIZATION
-- =========================================================

create table if not exists public.relic_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  rarity text not null default 'common' check (rarity in ('common', 'rare', 'epic', 'legendary')),
  effect_type text,
  created_at timestamptz not null default now()
);

alter table if exists public.relic_types enable row level security;
drop policy if exists relic_types_select_all on public.relic_types;
create policy relic_types_select_all
on public.relic_types
for select
using (true);

grant select on public.relic_types to anon, authenticated;

alter table if exists public.quests
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists type text,
  add column if not exists xp_reward integer not null default 0,
  add column if not exists relic_reward integer not null default 0,
  add column if not exists status text not null default 'active',
  add column if not exists date date not null default current_date,
  add column if not exists expires_date date,
  add column if not exists deadline_at timestamptz,
  add column if not exists punishment_type text not null default 'xp_deduction',
  add column if not exists punishment_value integer not null default 40,
  add column if not exists created_by_admin boolean not null default false;

do $$
begin
  if to_regclass('public.quests') is null then
    return;
  end if;

  update public.quests
  set
    type = coalesce(nullif(trim(type), ''), 'daily'),
    status = coalesce(nullif(trim(status), ''), 'active'),
    xp_reward = greatest(0, coalesce(xp_reward, 0)),
    relic_reward = greatest(0, coalesce(relic_reward, 0)),
    punishment_type = lower(coalesce(nullif(trim(punishment_type), ''), 'xp_deduction')),
    punishment_value = greatest(0, coalesce(punishment_value, 0))
  where true;

  if not exists (
    select 1 from pg_constraint
    where conname = 'quests_punishment_type_check'
      and conrelid = 'public.quests'::regclass
  ) then
    alter table public.quests
      add constraint quests_punishment_type_check
      check (punishment_type in ('xp_deduction', 'streak_reset', 'relic_loss'));
  end if;
end $$;

alter table if exists public.user_quests
  add column if not exists status text not null default 'active',
  add column if not exists date date not null default current_date,
  add column if not exists quest_type text,
  add column if not exists started_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists deadline_at timestamptz,
  add column if not exists xp_reward integer not null default 0,
  add column if not exists relic_reward integer not null default 0,
  add column if not exists punishment_type text,
  add column if not exists punishment_value integer,
  add column if not exists progress_current integer not null default 0,
  add column if not exists progress_target integer not null default 1,
  add column if not exists failed boolean not null default false,
  add column if not exists penalty_applied boolean not null default false;

do $$
begin
  if to_regclass('public.user_quests') is null then
    return;
  end if;

  update public.user_quests
  set
    status = coalesce(nullif(trim(status), ''), 'active'),
    date = coalesce(date, current_date),
    quest_type = coalesce(nullif(trim(quest_type), ''), 'special'),
    xp_reward = greatest(0, coalesce(xp_reward, 0)),
    relic_reward = greatest(0, coalesce(relic_reward, 0)),
    punishment_type = lower(coalesce(nullif(trim(punishment_type), ''), 'xp_deduction')),
    punishment_value = greatest(0, coalesce(punishment_value, 40)),
    progress_current = greatest(0, coalesce(progress_current, 0)),
    progress_target = greatest(1, coalesce(progress_target, 1));

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_quests'
      and column_name = 'progress'
  ) then
    execute $q$
      update public.user_quests
      set progress_current = greatest(0, coalesce(progress_current, progress, 0))
      where true
    $q$;
  end if;
end $$;

alter table if exists public.discipline_relics
  add column if not exists source text not null default 'unknown',
  add column if not exists event_id text,
  add column if not exists earned_at timestamptz not null default now(),
  add column if not exists expires_at timestamptz,
  add column if not exists used boolean not null default false,
  add column if not exists used_for text,
  add column if not exists used_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists rarity text not null default 'rare',
  add column if not exists relic_type_id uuid references public.relic_types(id) on delete set null,
  add column if not exists label text;

do $$
begin
  if to_regclass('public.discipline_relics') is null then
    return;
  end if;

  update public.discipline_relics
  set rarity = lower(coalesce(nullif(trim(rarity), ''), 'rare'))
  where true;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'discipline_relics_rarity_check'
      and conrelid = 'public.discipline_relics'::regclass
  ) then
    alter table public.discipline_relics
      add constraint discipline_relics_rarity_check
      check (rarity in ('common', 'rare', 'epic', 'legendary'));
  end if;
end $$;

-- =========================================================
-- ADMIN RPCS
-- =========================================================

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
  v_desc text := coalesce(nullif(trim(p_description), ''), 'Admin-created challenge');
  v_punish text := lower(coalesce(nullif(trim(p_punishment_type), ''), 'xp_deduction'));
  v_now timestamptz := now();
begin
  select ras.admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token) ras
  limit 1;

  if v_punish not in ('xp_deduction', 'streak_reset', 'relic_loss') then
    v_punish := 'xp_deduction';
  end if;

  if p_target_user_id is not null and not exists (
    select 1
    from auth.users au
    where au.id = p_target_user_id
  ) then
    raise exception 'target_user_not_found';
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
    v_desc,
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
      date,
      quest_type,
      started_at,
      expires_at,
      deadline_at,
      xp_reward,
      relic_reward,
      punishment_type,
      punishment_value,
      progress_current,
      progress_target,
      failed,
      penalty_applied
    )
    values (
      p_target_user_id,
      v_quest_id,
      'active',
      current_date,
      v_type,
      v_now,
      p_deadline,
      p_deadline,
      greatest(0, coalesce(p_xp_reward, 120)),
      greatest(0, coalesce(p_relic_reward, 0)),
      v_punish,
      greatest(0, coalesce(p_punishment_value, 40)),
      0,
      1,
      false,
      false
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
  v_rarity text := lower(coalesce(nullif(trim(p_rarity), ''), 'common'));
  v_code text := lower(regexp_replace(coalesce(p_code, ''), '[^a-z0-9_]+', '_', 'g'));
begin
  select ras.admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token) ras
  limit 1;

  if v_rarity not in ('common', 'rare', 'epic', 'legendary') then
    v_rarity := 'common';
  end if;

  v_code := nullif(trim(v_code), '');
  if v_code is null then
    raise exception 'invalid_relic_code';
  end if;

  insert into public.relic_types (code, name, description, rarity, effect_type)
  values (
    v_code,
    coalesce(nullif(trim(p_name), ''), 'Custom Relic'),
    nullif(trim(coalesce(p_description, '')), ''),
    v_rarity,
    nullif(trim(coalesce(p_effect_type, '')), '')
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
    jsonb_build_object('relic_type_id', v_id, 'code', v_code, 'rarity', v_rarity)
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
  v_rarity text := lower(coalesce(nullif(trim(p_rarity), ''), 'rare'));
  v_count integer := greatest(1, least(20, coalesce(p_count, 1)));
  v_inserted integer := 0;
  v_source text := coalesce(nullif(trim(p_source), ''), 'admin_grant');
  i integer;
begin
  select ras.admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token) ras
  limit 1;

  if not exists (
    select 1
    from auth.users au
    where au.id = p_user_id
  ) then
    raise exception 'target_user_not_found';
  end if;

  if p_relic_type_id is not null and not exists (
    select 1
    from public.relic_types rt
    where rt.id = p_relic_type_id
  ) then
    raise exception 'invalid_relic_type';
  end if;

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
      v_source,
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
    jsonb_build_object(
      'count', v_inserted,
      'rarity', v_rarity,
      'relic_type_id', p_relic_type_id,
      'source', v_source
    )
  );

  perform public.log_activity_event(
    p_user_id,
    'relic_reward',
    jsonb_build_object('count', v_inserted, 'rarity', v_rarity, 'source', v_source, 'admin_user_id', v_admin_id)
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
  select ras.admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token) ras
  limit 1;

  select dr.user_id into v_user_id
  from public.discipline_relics dr
  where dr.id = p_relic_id
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

grant execute on function public.admin_create_challenge(uuid, uuid, text, text, integer, integer, timestamptz, text, integer) to anon, authenticated;
grant execute on function public.admin_create_relic_type(uuid, text, text, text, text, text) to anon, authenticated;
grant execute on function public.admin_grant_relic(uuid, uuid, uuid, text, text, integer, text) to anon, authenticated;
grant execute on function public.admin_remove_relic(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
