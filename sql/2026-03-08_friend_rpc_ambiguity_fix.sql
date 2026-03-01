-- Friend RPC ambiguity fix
-- Ensures column references are fully qualified to avoid
-- "column reference \"user_id\" is ambiguous" errors in RPC calls.

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

grant execute on function public.send_friend_request(uuid, uuid) to authenticated;
grant execute on function public.respond_friend_request(uuid, uuid, text) to authenticated;
