-- Public profile global rank position helper
-- Depends on: 2026-03-20_community_chat_mode.sql

set search_path = public, extensions;

create or replace function public.get_public_profile_rank(
  p_username text
)
returns table(
  user_id uuid,
  username text,
  rank_position integer
)
language sql
stable
security definer
set search_path = public
as $$
  with ranked as (
    select
      pp.user_id,
      pp.username,
      row_number() over (
        order by coalesce(pp.total_xp, 0) desc, coalesce(pp.level, 0) desc, pp.user_id
      ) as rank_position
    from public.public_profiles pp
    join public.profiles p on p.id = pp.user_id
    where pp.is_public = true
      and lower(coalesce(p.role, 'user')) <> 'admin'
  )
  select
    r.user_id::uuid,
    r.username::text,
    r.rank_position::integer
  from ranked r
  where lower(coalesce(r.username, '')) = lower(trim(coalesce(p_username, '')))
  limit 1;
$$;

grant execute on function public.get_public_profile_rank(text) to anon, authenticated;

notify pgrst, 'reload schema';
