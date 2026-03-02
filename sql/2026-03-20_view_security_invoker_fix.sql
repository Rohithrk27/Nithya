-- Fix view security mode to avoid SECURITY DEFINER semantics.
-- Depends on: 2026-03-20_tight_safe_limits_retention.sql

set search_path = public, extensions;

do $$
begin
  if to_regclass('public.rls_policy_perf_warnings') is not null then
    execute 'alter view public.rls_policy_perf_warnings set (security_invoker = true)';
  end if;

  if to_regclass('public.duplicate_index_candidates') is not null then
    execute 'alter view public.duplicate_index_candidates set (security_invoker = true)';
  end if;

  if to_regclass('public.retention_policy_current') is not null then
    execute 'alter view public.retention_policy_current set (security_invoker = true)';
  end if;
end;
$$;

notify pgrst, 'reload schema';
