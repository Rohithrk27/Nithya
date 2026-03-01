-- Social + party integrity follow-up
-- 1) Friends RPC actions on public.friends
-- 2) Party visibility/invite controls for scalable collab joins
-- 3) Friend active-dungeon discovery with secure server filtering

create extension if not exists pgcrypto;

-- =========================================================
-- FRIEND ACTION RPCS
-- =========================================================

create table if not exists public.friends (
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, friend_user_id),
  check (user_id <> friend_user_id)
);

alter table public.friends
  add column if not exists status text not null default 'pending',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.friends
  drop constraint if exists friends_status_check;

alter table public.friends
  add constraint friends_status_check
  check (status in ('pending', 'accepted', 'blocked'));

alter table public.friends enable row level security;

drop policy if exists friends_select_policy on public.friends;
create policy friends_select_policy
on public.friends for select
using (auth.uid() = user_id or auth.uid() = friend_user_id);

drop policy if exists friends_insert_policy on public.friends;
create policy friends_insert_policy
on public.friends for insert
with check (auth.uid() = user_id);

drop policy if exists friends_update_policy on public.friends;
create policy friends_update_policy
on public.friends for update
using (auth.uid() = user_id or auth.uid() = friend_user_id)
with check (auth.uid() = user_id or auth.uid() = friend_user_id);

create or replace function public.touch_friends_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_friends_updated_at on public.friends;
create trigger trg_touch_friends_updated_at
before update
on public.friends
for each row
execute function public.touch_friends_updated_at();

with ranked_pending as (
  select
    ctid as row_id,
    row_number() over (
      partition by least(user_id, friend_user_id), greatest(user_id, friend_user_id)
      order by updated_at desc nulls last, created_at desc nulls last
    ) as rn
  from public.friends
  where status = 'pending'
)
delete from public.friends f
using ranked_pending r
where f.ctid = r.row_id
  and r.rn > 1;

create unique index if not exists friends_pair_pending_unique_idx
  on public.friends (
    least(user_id, friend_user_id),
    greatest(user_id, friend_user_id)
  )
  where status = 'pending';

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
    update public.friends
    set status = 'accepted', updated_at = now()
    where user_id = p_friend_user_id
      and friend_user_id = p_user_id;

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
    update public.friends
    set status = 'accepted', updated_at = now()
    where user_id = p_friend_user_id
      and friend_user_id = p_user_id;

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
    update public.friends
    set status = 'blocked', updated_at = now()
    where user_id = p_friend_user_id
      and friend_user_id = p_user_id;

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
    delete from public.friends
    where user_id = p_friend_user_id
      and friend_user_id = p_user_id
      and status = 'pending';

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

-- =========================================================
-- COLLAB PARTY VISIBILITY + INVITES
-- =========================================================

-- Bootstrap party/collab base schema in case prior migration did not fully apply.
alter table public.dungeon_runs
  add column if not exists mode text not null default 'solo',
  add column if not exists party_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dungeon_runs_mode_check'
      and conrelid = 'public.dungeon_runs'::regclass
  ) then
    alter table public.dungeon_runs
      add constraint dungeon_runs_mode_check
      check (mode in ('solo', 'collab'));
  end if;
end;
$$;

create table if not exists public.dungeon_parties (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references auth.users(id) on delete cascade,
  dungeon_id uuid,
  title text,
  status text not null default 'waiting' check (status in ('waiting', 'active', 'completed')),
  shared_progress integer not null default 0 check (shared_progress >= 0 and shared_progress <= 100),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

alter table public.dungeon_parties
  add column if not exists host_user_id uuid references auth.users(id) on delete cascade,
  add column if not exists dungeon_id uuid,
  add column if not exists title text,
  add column if not exists status text not null default 'waiting',
  add column if not exists shared_progress integer not null default 0,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz;

update public.dungeon_parties
set
  status = coalesce(status, 'waiting'),
  shared_progress = greatest(0, least(100, coalesce(shared_progress, 0))),
  created_at = coalesce(created_at, now())
where status is null
   or shared_progress is null
   or shared_progress < 0
   or shared_progress > 100
   or created_at is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dungeon_parties_status_check'
      and conrelid = 'public.dungeon_parties'::regclass
  ) then
    alter table public.dungeon_parties
      add constraint dungeon_parties_status_check
      check (status in ('waiting', 'active', 'completed'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dungeon_parties_shared_progress_check'
      and conrelid = 'public.dungeon_parties'::regclass
  ) then
    alter table public.dungeon_parties
      add constraint dungeon_parties_shared_progress_check
      check (shared_progress >= 0 and shared_progress <= 100);
  end if;
end;
$$;

create table if not exists public.dungeon_party_members (
  party_id uuid not null references public.dungeon_parties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  status text not null default 'joined' check (status in ('joined', 'left', 'failed', 'completed')),
  joined_at timestamptz not null default now(),
  primary key (party_id, user_id)
);

alter table public.dungeon_party_members
  add column if not exists role text not null default 'member',
  add column if not exists status text not null default 'joined',
  add column if not exists joined_at timestamptz not null default now();

update public.dungeon_party_members
set
  role = coalesce(nullif(role, ''), 'member'),
  status = case
    when status in ('joined', 'left', 'failed', 'completed') then status
    else 'joined'
  end,
  joined_at = coalesce(joined_at, now())
where role is null
   or role = ''
   or status is null
   or status not in ('joined', 'left', 'failed', 'completed')
   or joined_at is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dungeon_party_members_status_check'
      and conrelid = 'public.dungeon_party_members'::regclass
  ) then
    alter table public.dungeon_party_members
      add constraint dungeon_party_members_status_check
      check (status in ('joined', 'left', 'failed', 'completed'));
  end if;
end;
$$;

alter table public.dungeon_parties
  add column if not exists visibility text not null default 'friends',
  add column if not exists max_members integer not null default 4,
  add column if not exists invite_code text;

update public.dungeon_parties
set
  visibility = coalesce(visibility, 'friends'),
  max_members = greatest(2, coalesce(max_members, 4))
where visibility is null
   or max_members is null
   or max_members < 2;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dungeon_parties_visibility_check'
      and conrelid = 'public.dungeon_parties'::regclass
  ) then
    alter table public.dungeon_parties
      add constraint dungeon_parties_visibility_check
      check (visibility in ('private', 'friends', 'public'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dungeon_parties_max_members_check'
      and conrelid = 'public.dungeon_parties'::regclass
  ) then
    alter table public.dungeon_parties
      add constraint dungeon_parties_max_members_check
      check (max_members >= 2 and max_members <= 16);
  end if;
end;
$$;

create unique index if not exists dungeon_parties_invite_code_idx
  on public.dungeon_parties (invite_code)
  where invite_code is not null;

create table if not exists public.dungeon_party_invites (
  party_id uuid not null references public.dungeon_parties(id) on delete cascade,
  invited_user_id uuid not null references auth.users(id) on delete cascade,
  invited_by_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (party_id, invited_user_id)
);

create index if not exists dungeon_party_invites_user_status_idx
  on public.dungeon_party_invites (invited_user_id, status, created_at desc);

create index if not exists dungeon_party_invites_party_status_idx
  on public.dungeon_party_invites (party_id, status, created_at desc);

alter table public.dungeon_party_invites enable row level security;

drop policy if exists dungeon_party_invites_select_policy on public.dungeon_party_invites;
create policy dungeon_party_invites_select_policy
on public.dungeon_party_invites for select
using (
  auth.uid() = invited_user_id
  or auth.uid() = invited_by_user_id
  or exists (
    select 1
    from public.dungeon_parties p
    where p.id = party_id
      and p.host_user_id = auth.uid()
  )
);

drop policy if exists dungeon_party_invites_insert_policy on public.dungeon_party_invites;
create policy dungeon_party_invites_insert_policy
on public.dungeon_party_invites for insert
with check (
  auth.uid() = invited_by_user_id
  and exists (
    select 1
    from public.dungeon_parties p
    where p.id = party_id
      and p.host_user_id = auth.uid()
  )
);

drop policy if exists dungeon_party_invites_update_policy on public.dungeon_party_invites;
create policy dungeon_party_invites_update_policy
on public.dungeon_party_invites for update
using (
  auth.uid() = invited_user_id
  or exists (
    select 1
    from public.dungeon_parties p
    where p.id = party_id
      and p.host_user_id = auth.uid()
  )
)
with check (
  auth.uid() = invited_user_id
  or exists (
    select 1
    from public.dungeon_parties p
    where p.id = party_id
      and p.host_user_id = auth.uid()
  )
);

create or replace function public.ensure_dungeon_party_invite_code()
returns trigger
language plpgsql
as $$
begin
  if new.invite_code is null or btrim(new.invite_code) = '' then
    new.invite_code := left(replace(gen_random_uuid()::text, '-', ''), 10);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ensure_dungeon_party_invite_code on public.dungeon_parties;
create trigger trg_ensure_dungeon_party_invite_code
before insert or update of invite_code
on public.dungeon_parties
for each row
execute function public.ensure_dungeon_party_invite_code();

create or replace function public.create_dungeon_party(
  p_user_id uuid,
  p_dungeon_id uuid default null,
  p_title text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party_id uuid;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  if exists (
    select 1
    from public.dungeon_runs dr
    where dr.user_id = p_user_id
      and dr.status = 'active'
  ) then
    raise exception 'user already has active dungeon';
  end if;

  insert into public.dungeon_parties (host_user_id, dungeon_id, title, status)
  values (p_user_id, p_dungeon_id, nullif(p_title, ''), 'waiting')
  returning id
  into v_party_id;

  insert into public.dungeon_party_members (party_id, user_id, role, status)
  values (v_party_id, p_user_id, 'host', 'joined')
  on conflict (party_id, user_id) do update
  set role = excluded.role, status = 'joined';

  return v_party_id;
end;
$$;

create or replace function public.create_dungeon_party_with_options(
  p_user_id uuid,
  p_dungeon_id uuid default null,
  p_title text default null,
  p_visibility text default 'friends',
  p_max_members integer default 4
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party_id uuid;
  v_visibility text := lower(coalesce(p_visibility, 'friends'));
  v_max_members integer := greatest(2, least(16, coalesce(p_max_members, 4)));
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  v_party_id := public.create_dungeon_party(p_user_id, p_dungeon_id, p_title);

  if v_visibility not in ('private', 'friends', 'public') then
    v_visibility := 'friends';
  end if;

  update public.dungeon_parties
  set
    visibility = v_visibility,
    max_members = v_max_members
  where id = v_party_id
    and host_user_id = p_user_id;

  return v_party_id;
end;
$$;

create or replace function public.invite_to_dungeon_party(
  p_user_id uuid,
  p_party_id uuid,
  p_invited_user_id uuid
)
returns table(
  party_id uuid,
  invited_user_id uuid,
  status text,
  created_at timestamptz
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

  if p_user_id = p_invited_user_id then
    raise exception 'cannot invite self';
  end if;

  select *
  into v_party
  from public.dungeon_parties
  where id = p_party_id
    and host_user_id = p_user_id
  for update;

  if not found then
    raise exception 'party not found or not host';
  end if;

  if v_party.status <> 'waiting' then
    raise exception 'party is not waiting';
  end if;

  insert into public.dungeon_party_invites (
    party_id,
    invited_user_id,
    invited_by_user_id,
    status
  )
  values (
    p_party_id,
    p_invited_user_id,
    p_user_id,
    'pending'
  )
  on conflict (party_id, invited_user_id) do update
  set
    status = 'pending',
    invited_by_user_id = excluded.invited_by_user_id,
    created_at = now(),
    responded_at = null;

  return query
  select i.party_id, i.invited_user_id, i.status, i.created_at
  from public.dungeon_party_invites i
  where i.party_id = p_party_id
    and i.invited_user_id = p_invited_user_id
  limit 1;
end;
$$;

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

  update public.dungeon_parties
  set
    visibility = v_visibility,
    max_members = case
      when p_max_members is null then max_members
      else greatest(2, least(16, p_max_members))
    end,
    completed_at = completed_at
  where id = p_party_id
    and host_user_id = p_user_id
  returning id, visibility, max_members
  into party_id, visibility, max_members;

  if party_id is null then
    raise exception 'party not found or not host';
  end if;

  return next;
end;
$$;

create or replace function public.join_dungeon_party(
  p_user_id uuid,
  p_party_id uuid,
  p_role text default 'member'
)
returns table(
  party_id uuid,
  party_status text,
  member_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party public.dungeon_parties%rowtype;
  v_member_count integer := 0;
  v_already_member boolean := false;
  v_is_friend boolean := false;
  v_is_invited boolean := false;
  v_can_join boolean := false;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  if exists (
    select 1
    from public.dungeon_runs dr
    where dr.user_id = p_user_id
      and dr.status = 'active'
  ) then
    raise exception 'user already has active dungeon';
  end if;

  select *
  into v_party
  from public.dungeon_parties
  where id = p_party_id
  for update;

  if not found then
    raise exception 'party not found';
  end if;

  if v_party.status <> 'waiting' then
    raise exception 'party is not joinable';
  end if;

  select exists (
    select 1
    from public.dungeon_party_members m
    where m.party_id = p_party_id
      and m.user_id = p_user_id
  ) into v_already_member;

  select count(*)::integer
  into v_member_count
  from public.dungeon_party_members m
  where m.party_id = p_party_id
    and m.status in ('joined', 'completed');

  if not v_already_member and v_member_count >= coalesce(v_party.max_members, 4) then
    raise exception 'party is full';
  end if;

  select exists (
    select 1
    from public.friends f
    where f.user_id = p_user_id
      and f.friend_user_id = v_party.host_user_id
      and f.status = 'accepted'
  ) into v_is_friend;

  select exists (
    select 1
    from public.dungeon_party_invites i
    where i.party_id = p_party_id
      and i.invited_user_id = p_user_id
      and i.status in ('pending', 'accepted')
  ) into v_is_invited;

  v_can_join := (
    p_user_id = v_party.host_user_id
    or v_party.visibility = 'public'
    or (v_party.visibility = 'friends' and (v_is_friend or v_is_invited))
    or (v_party.visibility = 'private' and v_is_invited)
  );

  if not v_can_join then
    raise exception 'party is private';
  end if;

  insert into public.dungeon_party_members (party_id, user_id, role, status)
  values (p_party_id, p_user_id, coalesce(nullif(p_role, ''), 'member'), 'joined')
  on conflict (party_id, user_id) do update
  set status = 'joined', role = excluded.role, joined_at = now();

  update public.dungeon_party_invites
  set status = 'accepted', responded_at = now()
  where party_id = p_party_id
    and invited_user_id = p_user_id
    and status = 'pending';

  return query
  select
    v_party.id,
    v_party.status,
    count(*)::integer
  from public.dungeon_party_members m
  where m.party_id = v_party.id
    and m.status in ('joined', 'completed')
  group by v_party.id, v_party.status;
end;
$$;

create or replace function public.join_dungeon_party_by_code(
  p_user_id uuid,
  p_invite_code text
)
returns table(
  party_id uuid,
  party_status text,
  member_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party_id uuid;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  select p.id
  into v_party_id
  from public.dungeon_parties p
  where p.invite_code = nullif(btrim(coalesce(p_invite_code, '')), '')
  limit 1;

  if v_party_id is null then
    raise exception 'party not found';
  end if;

  return query
  select *
  from public.join_dungeon_party(p_user_id, v_party_id, 'member');
end;
$$;

create or replace function public.get_friend_active_dungeons(
  p_user_id uuid
)
returns table(
  friend_user_id uuid,
  friend_name text,
  dungeon_run_id uuid,
  challenge_title text,
  mode text,
  party_id uuid,
  party_status text,
  party_visibility text,
  shared_progress integer,
  stability integer,
  can_join boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  return query
  with my_active as (
    select exists (
      select 1
      from public.dungeon_runs d
      where d.user_id = p_user_id
        and d.status = 'active'
    ) as has_active
  ),
  accepted_friends as (
    select f.friend_user_id as uid
    from public.friends f
    where f.user_id = p_user_id
      and f.status = 'accepted'
  )
  select
    dr.user_id as friend_user_id,
    coalesce(pr.name, pr.user_code, dr.user_id::text) as friend_name,
    dr.id as dungeon_run_id,
    dr.challenge_title,
    coalesce(dr.mode, 'solo') as mode,
    dr.party_id,
    coalesce(dp.status, dr.status) as party_status,
    coalesce(dp.visibility, 'private') as party_visibility,
    coalesce(dp.shared_progress, 0) as shared_progress,
    coalesce(dr.stability, 100) as stability,
    (
      not (select has_active from my_active)
      and dr.party_id is not null
      and coalesce(dp.status, 'waiting') = 'waiting'
      and (
        dp.visibility = 'public'
        or dp.visibility = 'friends'
        or exists (
          select 1
          from public.dungeon_party_invites i
          where i.party_id = dr.party_id
            and i.invited_user_id = p_user_id
            and i.status in ('pending', 'accepted')
        )
      )
    ) as can_join
  from public.dungeon_runs dr
  join accepted_friends af on af.uid = dr.user_id
  left join public.profiles pr on pr.id = dr.user_id
  left join public.dungeon_parties dp on dp.id = dr.party_id
  where dr.status = 'active'
  order by dr.created_at desc;
end;
$$;

grant execute on function public.create_dungeon_party(uuid, uuid, text) to authenticated;
grant execute on function public.create_dungeon_party_with_options(uuid, uuid, text, text, integer) to authenticated;
grant execute on function public.invite_to_dungeon_party(uuid, uuid, uuid) to authenticated;
grant execute on function public.set_dungeon_party_visibility(uuid, uuid, text, integer) to authenticated;
grant execute on function public.join_dungeon_party(uuid, uuid, text) to authenticated;
grant execute on function public.join_dungeon_party_by_code(uuid, text) to authenticated;
grant execute on function public.get_friend_active_dungeons(uuid) to authenticated;
