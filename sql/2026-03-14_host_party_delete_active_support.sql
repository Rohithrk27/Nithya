create or replace function public.delete_dungeon_party(
  p_user_id uuid,
  p_party_id uuid
)
returns table(
  party_id uuid,
  deleted boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party public.dungeon_parties%rowtype;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
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

  if coalesce(v_party.status, 'waiting') not in ('waiting', 'active') then
    raise exception 'only waiting or active party can be deleted';
  end if;

  if coalesce(v_party.status, 'waiting') = 'active' then
    update public.dungeon_runs dr
    set
      status = 'quit',
      end_date = coalesce(dr.end_date, current_date),
      completed_days = greatest(0, coalesce(dr.completed_days, 0))
    where dr.party_id = p_party_id
      and dr.status = 'active';
  end if;

  delete from public.dungeon_parties dp
  where dp.id = p_party_id
    and dp.host_user_id = p_user_id;

  return query
  select p_party_id, true;
end;
$$;

grant execute on function public.delete_dungeon_party(uuid, uuid) to authenticated;
