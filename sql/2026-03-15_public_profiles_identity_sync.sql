-- Ensure public profile payload stores user-visible identity fields.

alter table if exists public.public_profiles
  add column if not exists name text,
  add column if not exists user_code text;

update public.public_profiles pp
set
  name = p.name,
  user_code = p.user_code
from public.profiles p
where p.id = pp.user_id
  and (
    pp.name is distinct from p.name
    or pp.user_code is distinct from p.user_code
  );

create or replace function public.refresh_public_profile(p_user_id uuid)
returns public.public_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_row public.public_profiles%rowtype;
  v_username_base text;
  v_username text;
  v_stats jsonb;
  v_dungeon jsonb;
  v_profile_json jsonb;
begin
  select *
  into v_profile
  from public.profiles
  where id = p_user_id;

  if not found then
    raise exception 'profile not found';
  end if;

  v_profile_json := to_jsonb(v_profile);

  v_username_base := coalesce(
    nullif(v_profile.user_code, ''),
    nullif(v_profile.name, ''),
    left(replace(p_user_id::text, '-', ''), 12)
  );

  v_username := lower(regexp_replace(v_username_base, '[^a-zA-Z0-9_]+', '-', 'g'));
  if v_username is null or btrim(v_username) = '' then
    v_username := left(replace(p_user_id::text, '-', ''), 12);
  end if;

  v_stats := jsonb_build_object(
    'strength', coalesce(v_profile.stat_strength, 0),
    'discipline', coalesce(v_profile.stat_discipline, 0),
    'knowledge', coalesce(
      nullif(v_profile_json->>'stat_knowledge', '')::integer,
      nullif(v_profile_json->>'stat_intelligence', '')::integer,
      0
    ),
    'health', coalesce(v_profile.stat_health, 0),
    'social', coalesce(v_profile.stat_social, 0),
    'career', coalesce(v_profile.stat_career, 0),
    'consistency', coalesce(v_profile.stat_consistency, 0)
  );

  select jsonb_build_object(
    'completed', count(*) filter (where status = 'completed'),
    'failed', count(*) filter (where status = 'failed'),
    'active', count(*) filter (where status = 'active'),
    'best_completed_days', coalesce(max(completed_days), 0)
  )
  into v_dungeon
  from public.dungeon_runs
  where user_id = p_user_id;

  insert into public.public_profiles (
    user_id,
    username,
    name,
    user_code,
    avatar_url,
    level,
    total_xp,
    stat_distribution,
    dungeon_achievements,
    streak_count,
    is_public,
    updated_at
  )
  values (
    p_user_id,
    v_username,
    nullif(v_profile.name, ''),
    nullif(v_profile.user_code, ''),
    nullif(v_profile.avatar_url, ''),
    coalesce(v_profile.level, 0),
    coalesce(v_profile.total_xp, 0),
    coalesce(v_stats, '{}'::jsonb),
    coalesce(v_dungeon, '{}'::jsonb),
    coalesce(v_profile.daily_streak, 0),
    false,
    now()
  )
  on conflict (user_id) do update
  set
    username = excluded.username,
    name = excluded.name,
    user_code = excluded.user_code,
    avatar_url = excluded.avatar_url,
    level = excluded.level,
    total_xp = excluded.total_xp,
    stat_distribution = excluded.stat_distribution,
    dungeon_achievements = excluded.dungeon_achievements,
    streak_count = excluded.streak_count,
    updated_at = now()
  returning *
  into v_row;

  return v_row;
end;
$$;
