-- Admin announcement management RPCs: list + update + delete.
-- Depends on: 2026-03-15_task_punishment_and_leaderboard.sql

set search_path = public, extensions;

create or replace function public.admin_list_announcements(
  p_session_token uuid,
  p_limit integer default 200,
  p_include_inactive boolean default true
)
returns table(
  id uuid,
  title text,
  message text,
  active boolean,
  created_by_admin_id uuid,
  created_by_admin_username text,
  created_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_safe_limit integer := greatest(1, least(1000, coalesce(p_limit, 200)));
  v_include_inactive boolean := coalesce(p_include_inactive, true);
begin
  select admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token)
  limit 1;

  perform public.write_admin_audit(
    v_admin_id,
    'admin_list_announcements',
    null,
    jsonb_build_object(
      'limit', v_safe_limit,
      'include_inactive', v_include_inactive
    )
  );

  return query
  select
    a.id::uuid,
    a.title::text,
    a.message::text,
    coalesce(a.active, false)::boolean,
    a.created_by_admin_id::uuid,
    au.username::text,
    a.created_at::timestamptz,
    a.expires_at::timestamptz
  from public.announcements a
  left join public.admin_users au on au.id = a.created_by_admin_id
  where v_include_inactive or coalesce(a.active, false) = true
  order by a.created_at desc, a.id desc
  limit v_safe_limit;
end;
$$;

create or replace function public.admin_update_announcement(
  p_session_token uuid,
  p_announcement_id uuid,
  p_title text default null,
  p_message text default null,
  p_active boolean default null,
  p_expires_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_updated public.announcements%rowtype;
begin
  select admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token)
  limit 1;

  update public.announcements a
  set
    title = coalesce(nullif(trim(p_title), ''), a.title),
    message = coalesce(nullif(trim(p_message), ''), a.message),
    active = coalesce(p_active, a.active),
    expires_at = p_expires_at
  where a.id = p_announcement_id
  returning *
  into v_updated;

  if not found then
    return false;
  end if;

  perform public.write_admin_audit(
    v_admin_id,
    'admin_update_announcement',
    null,
    jsonb_build_object(
      'announcement_id', v_updated.id,
      'active', v_updated.active,
      'expires_at', v_updated.expires_at
    )
  );

  return true;
end;
$$;

create or replace function public.admin_delete_announcement(
  p_session_token uuid,
  p_announcement_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_deleted public.announcements%rowtype;
begin
  select admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token)
  limit 1;

  delete from public.announcements a
  where a.id = p_announcement_id
  returning *
  into v_deleted;

  if not found then
    return false;
  end if;

  perform public.write_admin_audit(
    v_admin_id,
    'admin_delete_announcement',
    null,
    jsonb_build_object(
      'announcement_id', v_deleted.id,
      'title', v_deleted.title
    )
  );

  return true;
end;
$$;

grant execute on function public.admin_list_announcements(uuid, integer, boolean) to anon, authenticated;
grant execute on function public.admin_update_announcement(uuid, uuid, text, text, boolean, timestamptz) to anon, authenticated;
grant execute on function public.admin_delete_announcement(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
