-- Fix ambiguous "username" reference in admin_login RPC.

create extension if not exists pgcrypto;

create or replace function public.admin_login(
  p_username text,
  p_password text,
  p_user_agent text default null
)
returns table(
  session_token uuid,
  expires_at timestamptz,
  username text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin public.admin_users%rowtype;
  v_session public.admin_sessions%rowtype;
begin
  select *
  into v_admin
  from public.admin_users au
  where au.username = lower(trim(coalesce(p_username, '')))
    and au.is_active = true
  limit 1;

  if not found then
    raise exception 'invalid_admin_credentials';
  end if;

  if v_admin.password_hash is null
     or crypt(coalesce(p_password, ''), v_admin.password_hash) <> v_admin.password_hash then
    raise exception 'invalid_admin_credentials';
  end if;

  insert into public.admin_sessions (admin_user_id, user_agent)
  values (v_admin.id, nullif(trim(coalesce(p_user_agent, '')), ''))
  returning * into v_session;

  perform public.write_admin_audit(
    v_admin.id,
    'admin_login',
    null,
    jsonb_build_object('username', v_admin.username)
  );

  return query
  select v_session.session_token, v_session.expires_at, v_admin.username;
end;
$$;

grant execute on function public.admin_login(text, text, text) to anon, authenticated;
