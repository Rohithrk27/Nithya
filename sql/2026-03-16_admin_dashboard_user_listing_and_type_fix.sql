-- Admin dashboard stability fix:
-- 1) Make admin list-users include every auth user, not only profile rows.
-- 2) Add explicit output casts to prevent return-type mismatch errors.
-- 3) Keep audit mirroring non-blocking so read actions still work.

create or replace function public.require_admin_session(
  p_session_token uuid
)
returns table(
  admin_user_id uuid,
  admin_username text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select s.admin_user_id::uuid, u.username::text
  from public.admin_sessions s
  join public.admin_users u on u.id = s.admin_user_id
  where s.session_token = p_session_token
    and s.revoked_at is null
    and s.expires_at > now()
    and u.is_active = true
  limit 1;

  if not found then
    raise exception 'invalid_admin_session';
  end if;
end;
$$;

create or replace function public.write_admin_audit(
  p_admin_user_id uuid,
  p_action text,
  p_target_user_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.admin_audit_logs (admin_user_id, action, target_user_id, metadata)
  values (
    p_admin_user_id,
    coalesce(nullif(trim(p_action), ''), 'unknown_admin_action'),
    p_target_user_id,
    coalesce(p_metadata, '{}'::jsonb)
  );

  begin
    perform public.log_activity_event(
      p_target_user_id,
      'admin_action',
      jsonb_build_object(
        'action', coalesce(nullif(trim(p_action), ''), 'unknown_admin_action'),
        'admin_user_id', p_admin_user_id
      ) || coalesce(p_metadata, '{}'::jsonb)
    );
  exception
    when others then
      null;
  end;
end;
$$;

create or replace function public.admin_validate_session(
  p_session_token uuid
)
returns table(
  is_valid boolean,
  username text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_username text;
  v_expires timestamptz;
begin
  select s.admin_user_id, u.username, s.expires_at
  into v_admin_id, v_username, v_expires
  from public.admin_sessions s
  join public.admin_users u on u.id = s.admin_user_id
  where s.session_token = p_session_token
    and s.revoked_at is null
    and s.expires_at > now()
    and u.is_active = true
  limit 1;

  if not found then
    return query select false::boolean, null::text, null::timestamptz;
    return;
  end if;

  return query select true::boolean, v_username::text, v_expires::timestamptz;
end;
$$;

create or replace function public.admin_list_users(
  p_session_token uuid,
  p_limit integer default 200
)
returns table(
  user_id uuid,
  name text,
  email text,
  total_xp bigint,
  level integer,
  daily_streak integer,
  relic_count integer,
  completed_habits integer,
  failed_habits integer,
  is_suspended boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
begin
  select ras.admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token) ras
  limit 1;

  perform public.write_admin_audit(
    v_admin_id,
    'admin_list_users',
    null,
    jsonb_build_object('limit', greatest(1, least(1000, coalesce(p_limit, 200))))
  );

  return query
  with base as (
    select
      au.id::uuid as user_id,
      coalesce(
        nullif(trim(coalesce(p.name, '')), ''),
        nullif(trim(coalesce(au.raw_user_meta_data->>'name', '')), ''),
        nullif(trim(coalesce(au.raw_user_meta_data->>'full_name', '')), '')
      )::text as user_name,
      au.email::text as email,
      coalesce(p.total_xp, 0)::bigint as total_xp,
      coalesce(p.level, 0)::integer as level,
      coalesce(p.daily_streak, 0)::integer as daily_streak,
      coalesce(p.is_suspended, false)::boolean as is_suspended
    from auth.users au
    left join public.profiles p on p.id = au.id
  )
  select
    b.user_id::uuid,
    coalesce(nullif(trim(coalesce(b.user_name, '')), ''), b.email, b.user_id::text)::text as name,
    b.email::text,
    b.total_xp::bigint,
    b.level::integer,
    b.daily_streak::integer,
    coalesce((
      select count(*)::integer
      from public.discipline_relics dr
      where dr.user_id = b.user_id
        and coalesce(dr.used, false) = false
        and (dr.expires_at is null or dr.expires_at > now())
    ), 0)::integer as relic_count,
    coalesce((
      select count(*)::integer
      from public.habit_logs hl
      where hl.user_id = b.user_id
        and hl.status = 'completed'
    ), 0)::integer as completed_habits,
    coalesce((
      select count(*)::integer
      from public.habit_logs hl
      where hl.user_id = b.user_id
        and (
          hl.status = 'failed'
          or coalesce(hl.failed, false) = true
        )
    ), 0)::integer as failed_habits,
    b.is_suspended::boolean
  from base b
  order by b.total_xp desc, b.user_id
  limit greatest(1, least(1000, coalesce(p_limit, 200)));
end;
$$;

create or replace function public.admin_list_activity_logs(
  p_session_token uuid,
  p_limit integer default 200
)
returns table(
  id uuid,
  user_id uuid,
  user_name text,
  type text,
  metadata jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
begin
  select ras.admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token) ras
  limit 1;

  perform public.write_admin_audit(
    v_admin_id,
    'admin_list_activity_logs',
    null,
    jsonb_build_object('limit', greatest(1, least(1000, coalesce(p_limit, 200))))
  );

  return query
  select
    al.id::uuid,
    al.user_id::uuid,
    p.name::text,
    al.type::text,
    al.metadata::jsonb,
    al.created_at::timestamptz
  from public.activity_logs al
  left join public.profiles p on p.id = al.user_id
  order by al.created_at desc
  limit greatest(1, least(1000, coalesce(p_limit, 200)));
end;
$$;

create or replace function public.admin_list_community_submissions(
  p_session_token uuid,
  p_status text default null
)
returns table(
  id uuid,
  user_id uuid,
  user_name text,
  category text,
  message text,
  status text,
  admin_reply text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_filter text := lower(trim(coalesce(p_status, '')));
begin
  select ras.admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token) ras
  limit 1;

  return query
  select
    cs.id::uuid,
    cs.user_id::uuid,
    p.name::text,
    cs.category::text,
    cs.message::text,
    cs.status::text,
    cs.admin_reply::text,
    cs.created_at::timestamptz,
    cs.updated_at::timestamptz
  from public.community_submissions cs
  left join public.profiles p on p.id = cs.user_id
  where (v_filter = '' or cs.status = v_filter)
  order by cs.created_at desc;
end;
$$;

grant execute on function public.admin_validate_session(uuid) to anon, authenticated;
grant execute on function public.admin_list_users(uuid, integer) to anon, authenticated;
grant execute on function public.admin_list_activity_logs(uuid, integer) to anon, authenticated;
grant execute on function public.admin_list_community_submissions(uuid, text) to anon, authenticated;
