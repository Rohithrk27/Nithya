-- Admin tools for payment verification requests.
-- Depends on: 2026-03-15_core_admin_community.sql
-- Depends on: 2026-03-16_payment_verification_requests.sql

create or replace function public.admin_list_payment_verification_requests(
  p_session_token uuid,
  p_status text default null,
  p_limit integer default 200
)
returns table(
  id uuid,
  user_id uuid,
  user_name text,
  user_email text,
  amount_inr numeric(10,2),
  utr_reference text,
  payer_name text,
  payment_app text,
  paid_at timestamptz,
  notes text,
  proof_path text,
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

  perform public.write_admin_audit(
    v_admin_id,
    'admin_list_payment_verification_requests',
    null,
    jsonb_build_object(
      'status', nullif(v_filter, ''),
      'limit', greatest(1, least(1000, coalesce(p_limit, 200)))
    )
  );

  return query
  select
    pvr.id::uuid,
    pvr.user_id::uuid,
    coalesce(
      nullif(trim(coalesce(p.name, '')), ''),
      au.email,
      pvr.user_id::text
    )::text as user_name,
    au.email::text as user_email,
    pvr.amount_inr::numeric(10,2),
    pvr.utr_reference::text,
    pvr.payer_name::text,
    pvr.payment_app::text,
    pvr.paid_at::timestamptz,
    pvr.notes::text,
    pvr.proof_path::text,
    pvr.status::text,
    pvr.admin_reply::text,
    pvr.created_at::timestamptz,
    pvr.updated_at::timestamptz
  from public.payment_verification_requests pvr
  left join public.profiles p on p.id = pvr.user_id
  left join auth.users au on au.id = pvr.user_id
  where (
    v_filter = ''
    or pvr.status = v_filter
  )
  order by pvr.created_at desc
  limit greatest(1, least(1000, coalesce(p_limit, 200)));
end;
$$;

create or replace function public.admin_update_payment_verification_request(
  p_session_token uuid,
  p_request_id uuid,
  p_status text,
  p_admin_reply text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_user_id uuid;
  v_status text := lower(trim(coalesce(p_status, 'reviewed')));
begin
  select ras.admin_user_id into v_admin_id
  from public.require_admin_session(p_session_token) ras
  limit 1;

  if v_status not in ('pending', 'reviewed', 'verified', 'rejected') then
    raise exception 'invalid_status';
  end if;

  update public.payment_verification_requests pvr
  set
    status = v_status,
    admin_reply = nullif(trim(coalesce(p_admin_reply, '')), '')
  where pvr.id = p_request_id
  returning pvr.user_id into v_user_id;

  if not found then
    return false;
  end if;

  perform public.write_admin_audit(
    v_admin_id,
    'admin_update_payment_verification_request',
    v_user_id,
    jsonb_build_object(
      'request_id', p_request_id,
      'status', v_status
    )
  );

  return true;
end;
$$;

grant execute on function public.admin_list_payment_verification_requests(uuid, text, integer) to anon, authenticated;
grant execute on function public.admin_update_payment_verification_request(uuid, uuid, text, text) to anon, authenticated;

-- Force PostgREST schema cache refresh so new RPCs are immediately available.
notify pgrst, 'reload schema';
