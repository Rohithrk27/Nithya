-- Fix ambiguous "visibility" reference in set_dungeon_party_visibility RPC.

create or replace function public.set_dungeon_party_visibility(
  p_user_id uuid,
  p_party_id uuid,
  p_visibility text,
  p_max_members integer default null
)
returns table(
  party_id uuid,
  visibility text,
  max_members integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visibility text := lower(coalesce(p_visibility, 'friends'));
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  if v_visibility not in ('private', 'friends', 'public') then
    raise exception 'invalid visibility';
  end if;

  update public.dungeon_parties as dp
  set
    visibility = v_visibility,
    max_members = case
      when p_max_members is null then dp.max_members
      else greatest(2, least(16, p_max_members))
    end,
    completed_at = dp.completed_at
  where dp.id = p_party_id
    and dp.host_user_id = p_user_id
  returning dp.id, dp.visibility, dp.max_members
  into party_id, visibility, max_members;

  if party_id is null then
    raise exception 'party not found or not host';
  end if;

  return next;
end;
$$;

grant execute on function public.set_dungeon_party_visibility(uuid, uuid, text, integer) to authenticated;
