-- Admin control: clear a user's shadow debt in one audited action.
-- Safe to run multiple times.

set search_path = public, extensions;

create or replace function public.admin_clear_user_shadow_debt(
  p_session_token uuid,
  p_user_id uuid,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_previous_shadow_debt integer := 0;
begin
  select ras.admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token) ras
  limit 1;

  if p_user_id is null then
    raise exception 'missing_user_id';
  end if;

  if not exists (select 1 from auth.users au where au.id = p_user_id) then
    return false;
  end if;

  insert into public.stats (user_id, shadow_debt_xp)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select coalesce(s.shadow_debt_xp, 0)::integer
  into v_previous_shadow_debt
  from public.stats s
  where s.user_id = p_user_id
  for update;

  update public.stats
  set
    shadow_debt_xp = 0,
    updated_at = now()
  where user_id = p_user_id;

  perform public.write_admin_audit(
    v_admin_id,
    'admin_clear_user_shadow_debt',
    p_user_id,
    jsonb_build_object(
      'previous_shadow_debt_xp', v_previous_shadow_debt,
      'reason', v_reason
    )
  );

  perform public.log_activity_event(
    p_user_id,
    'shadow_debt_cleared_by_admin',
    jsonb_build_object(
      'admin_user_id', v_admin_id,
      'previous_shadow_debt_xp', v_previous_shadow_debt,
      'reason', v_reason
    )
  );

  return true;
end;
$$;

grant execute on function public.admin_clear_user_shadow_debt(uuid, uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
