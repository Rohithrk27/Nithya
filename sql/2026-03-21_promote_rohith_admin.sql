-- Promote the fixed account to admin.
-- Depends on: 2026-03-16_admin_suspension_enforcement_and_controls.sql

create extension if not exists pgcrypto;
set search_path = public, extensions;

do $$
declare
  v_target_email constant text := 'rohithkrishna2732003@gmail.com';
  v_user_id uuid;
begin
  select au.id
  into v_user_id
  from auth.users au
  where lower(trim(coalesce(au.email, ''))) = lower(v_target_email)
  order by au.created_at asc
  limit 1;

  if v_user_id is null then
    raise notice 'No auth user found for %; admin promotion skipped.', v_target_email;
    return;
  end if;

  perform set_config('nithya.allow_profile_admin_field_write', '1', true);

  insert into public.profiles (id, role, is_suspended, created_at)
  values (v_user_id, 'admin', false, now())
  on conflict (id) do update
  set
    role = 'admin',
    is_suspended = false,
    suspension_reason = null,
    suspended_until = null;

  insert into public.admin_users (username, password_hash, is_active, linked_profile_id)
  values ('profile:' || v_user_id::text, crypt(gen_random_uuid()::text, gen_salt('bf')), true, v_user_id)
  on conflict (linked_profile_id) do update
  set
    is_active = true,
    updated_at = now();
end;
$$;
