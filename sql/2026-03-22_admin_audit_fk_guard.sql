-- Harden admin audit logging when target users are deleted or missing.
-- Depends on: 2026-03-16_admin_dashboard_user_listing_and_type_fix.sql

set search_path = public, extensions;

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
declare
  v_action text := coalesce(nullif(trim(p_action), ''), 'unknown_admin_action');
  v_target_user_id uuid;
begin
  v_target_user_id := null;

  if p_target_user_id is not null and exists (
    select 1
    from auth.users au
    where au.id = p_target_user_id
  ) then
    v_target_user_id := p_target_user_id;
  end if;

  insert into public.admin_audit_logs (admin_user_id, action, target_user_id, metadata)
  values (
    p_admin_user_id,
    v_action,
    v_target_user_id,
    coalesce(p_metadata, '{}'::jsonb)
  );

  begin
    perform public.log_activity_event(
      v_target_user_id,
      'admin_action',
      jsonb_build_object(
        'action', v_action,
        'admin_user_id', p_admin_user_id
      ) || coalesce(p_metadata, '{}'::jsonb)
    );
  exception
    when others then
      null;
  end;
end;
$$;

create or replace function public.admin_delete_user(
  p_session_token uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_deleted boolean := false;
begin
  select ras.admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token) ras
  limit 1;

  begin
    delete from auth.users where id = p_user_id;
    v_deleted := found;
  exception
    when insufficient_privilege then
      delete from public.profiles where id = p_user_id;
      v_deleted := found;
  end;

  if v_deleted then
    perform public.write_admin_audit(
      v_admin_id,
      'admin_delete_user',
      p_user_id,
      jsonb_build_object('deleted_user_id', p_user_id)
    );
  end if;

  return v_deleted;
end;
$$;

grant execute on function public.admin_delete_user(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
