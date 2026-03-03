-- Global leaderboard should include all non-admin users.
-- Depends on: 2026-03-24_schema_compat_global_guard.sql

set search_path = public, extensions;

create or replace function public.get_public_leaderboard(
  p_limit integer default 10000
)
returns table(
  user_id uuid,
  name text,
  user_code text,
  level integer,
  total_xp bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id::uuid as user_id,
    nullif(trim(coalesce(p.name, '')), '')::text as name,
    p.user_code::text,
    coalesce(p.level, 0)::integer as level,
    coalesce(p.total_xp, 0)::bigint as total_xp
  from public.profiles p
  where lower(coalesce(p.role, 'user')) <> 'admin'
  order by coalesce(p.total_xp, 0) desc, coalesce(p.level, 0) desc, p.id
  limit greatest(1, least(10000, coalesce(p_limit, 10000)));
$$;

grant execute on function public.get_public_leaderboard(integer) to authenticated;
