-- Friend accept ambiguity + hosted collab delete support
-- Fixes:
-- 1) "column reference \"user_id\" is ambiguous" on respond_friend_request
-- 2) Add host RPC to delete waiting collab parties

create or replace function public.send_friend_request(
  p_user_id uuid,
  p_friend_user_id uuid
)
returns table(
  user_id uuid,
  friend_user_id uuid,
  status text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.friends%rowtype;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  if p_user_id is null or p_friend_user_id is null or p_user_id = p_friend_user_id then
    raise exception 'invalid friend request';
  end if;

  if exists (
    select 1
    from public.friends f
    where (
      (f.user_id = p_user_id and f.friend_user_id = p_friend_user_id)
      or (f.user_id = p_friend_user_id and f.friend_user_id = p_user_id)
    )
    and f.status = 'blocked'
  ) then
    raise exception 'friend request is blocked';
  end if;

  if exists (
    select 1
    from public.friends f
    where f.user_id = p_friend_user_id
      and f.friend_user_id = p_user_id
      and f.status = 'pending'
  ) then
    update public.friends as f
    set status = 'accepted', updated_at = now()
    where f.user_id = p_friend_user_id
      and f.friend_user_id = p_user_id;

    insert into public.friends (user_id, friend_user_id, status)
    values (p_user_id, p_friend_user_id, 'accepted')
    on conflict (user_id, friend_user_id) do update
    set status = 'accepted', updated_at = now()
    returning *
    into v_row;

    return query
    select v_row.user_id, v_row.friend_user_id, v_row.status, v_row.updated_at;
    return;
  end if;

  insert into public.friends (user_id, friend_user_id, status)
  values (p_user_id, p_friend_user_id, 'pending')
  on conflict (user_id, friend_user_id) do update
  set
    status = case
      when public.friends.status = 'accepted' then 'accepted'
      else 'pending'
    end,
    updated_at = now()
  returning *
  into v_row;

  return query
  select v_row.user_id, v_row.friend_user_id, v_row.status, v_row.updated_at;
end;
$$;

create or replace function public.respond_friend_request(
  p_user_id uuid,
  p_friend_user_id uuid,
  p_action text default 'accepted'
)
returns table(
  user_id uuid,
  friend_user_id uuid,
  status text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text := lower(coalesce(p_action, 'accepted'));
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  if p_user_id is null or p_friend_user_id is null or p_user_id = p_friend_user_id then
    raise exception 'invalid friend response';
  end if;

  if not exists (
    select 1
    from public.friends f
    where f.user_id = p_friend_user_id
      and f.friend_user_id = p_user_id
      and f.status = 'pending'
  ) then
    raise exception 'pending friend request not found';
  end if;

  if v_action = 'accepted' then
    update public.friends as f
    set status = 'accepted', updated_at = now()
    where f.user_id = p_friend_user_id
      and f.friend_user_id = p_user_id;

    insert into public.friends (user_id, friend_user_id, status)
    values (p_user_id, p_friend_user_id, 'accepted')
    on conflict (user_id, friend_user_id) do update
    set status = 'accepted', updated_at = now();

    return query
    select f.user_id, f.friend_user_id, f.status, f.updated_at
    from public.friends f
    where f.user_id = p_user_id
      and f.friend_user_id = p_friend_user_id
    limit 1;
    return;
  elsif v_action = 'blocked' then
    update public.friends as f
    set status = 'blocked', updated_at = now()
    where f.user_id = p_friend_user_id
      and f.friend_user_id = p_user_id;

    insert into public.friends (user_id, friend_user_id, status)
    values (p_user_id, p_friend_user_id, 'blocked')
    on conflict (user_id, friend_user_id) do update
    set status = 'blocked', updated_at = now();

    return query
    select f.user_id, f.friend_user_id, f.status, f.updated_at
    from public.friends f
    where f.user_id = p_user_id
      and f.friend_user_id = p_friend_user_id
    limit 1;
    return;
  elsif v_action = 'declined' then
    delete from public.friends as f
    where f.user_id = p_friend_user_id
      and f.friend_user_id = p_user_id
      and f.status = 'pending';

    return query
    select p_user_id, p_friend_user_id, 'declined'::text, now();
    return;
  else
    raise exception 'unsupported friend action';
  end if;
end;
$$;

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

  if coalesce(v_party.status, 'waiting') <> 'waiting' then
    raise exception 'only waiting party can be deleted';
  end if;

  delete from public.dungeon_parties dp
  where dp.id = p_party_id
    and dp.host_user_id = p_user_id;

  return query
  select p_party_id, true;
end;
$$;

grant execute on function public.send_friend_request(uuid, uuid) to authenticated;
grant execute on function public.respond_friend_request(uuid, uuid, text) to authenticated;
grant execute on function public.delete_dungeon_party(uuid, uuid) to authenticated;
