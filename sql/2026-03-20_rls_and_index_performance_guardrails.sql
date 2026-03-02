-- RLS + index performance guardrails
-- Detects expensive per-row auth/current_setting policy calls and duplicate indexes.
-- Depends on: 2026-03-20_data_retention_policy.sql

set search_path = public, extensions;

-- =========================================================
-- RLS POLICY RUNTIME-CALL OPTIMIZATION
-- =========================================================

-- Wrap common auth calls so PostgreSQL can cache them as initPlan values
-- instead of re-evaluating per row in RLS checks.
create or replace function public.wrap_common_auth_calls_for_policy(
  p_expr text
)
returns text
language plpgsql
immutable
as $$
declare
  v_expr text := p_expr;
begin
  if v_expr is null or btrim(v_expr) = '' then
    return p_expr;
  end if;

  -- Protect already-wrapped calls to avoid double-wrapping.
  v_expr := regexp_replace(v_expr, '\(\s*select\s+auth\.uid\s*\(\s*\)\s*\)', '__WRAPPED_AUTH_UID__', 'gi');
  v_expr := regexp_replace(v_expr, '\(\s*select\s+auth\.role\s*\(\s*\)\s*\)', '__WRAPPED_AUTH_ROLE__', 'gi');
  v_expr := regexp_replace(v_expr, '\(\s*select\s+auth\.jwt\s*\(\s*\)\s*\)', '__WRAPPED_AUTH_JWT__', 'gi');

  -- Wrap unwrapped calls.
  v_expr := regexp_replace(v_expr, '\bauth\.uid\s*\(\s*\)', '(select auth.uid())', 'gi');
  v_expr := regexp_replace(v_expr, '\bauth\.role\s*\(\s*\)', '(select auth.role())', 'gi');
  v_expr := regexp_replace(v_expr, '\bauth\.jwt\s*\(\s*\)', '(select auth.jwt())', 'gi');

  -- Restore placeholders.
  v_expr := replace(v_expr, '__WRAPPED_AUTH_UID__', '(select auth.uid())');
  v_expr := replace(v_expr, '__WRAPPED_AUTH_ROLE__', '(select auth.role())');
  v_expr := replace(v_expr, '__WRAPPED_AUTH_JWT__', '(select auth.jwt())');

  return v_expr;
end;
$$;

create or replace view public.rls_policy_perf_warnings
with (security_invoker = true) as
with policy_rows as (
  select
    p.schemaname,
    p.tablename,
    p.policyname,
    p.cmd,
    p.permissive,
    p.roles,
    p.qual as using_expression,
    p.with_check as with_check_expression,
    coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') as full_expression
  from pg_policies p
  where p.schemaname not in ('pg_catalog', 'information_schema', 'pg_toast')
),
flags as (
  select
    pr.*,
    (pr.full_expression ~* '\bauth\.[a-z_][a-z0-9_]*\s*\(') as has_auth_calls,
    (pr.full_expression ~* '\bcurrent_setting\s*\(') as has_current_setting_calls,
    (
      pr.full_expression ~* '\bauth\.[a-z_][a-z0-9_]*\s*\('
      and pr.full_expression !~* '\(\s*select\s+auth\.[a-z_][a-z0-9_]*\s*\('
    ) as auth_calls_maybe_re_evaluated_per_row,
    (
      pr.full_expression ~* '\bcurrent_setting\s*\('
      and pr.full_expression !~* '\(\s*select\s+current_setting\s*\('
    ) as current_setting_maybe_re_evaluated_per_row
  from policy_rows pr
)
select
  f.schemaname as schema_name,
  f.tablename as table_name,
  f.policyname as policy_name,
  f.cmd,
  f.permissive,
  f.roles,
  f.using_expression,
  f.with_check_expression,
  f.has_auth_calls,
  f.has_current_setting_calls,
  f.auth_calls_maybe_re_evaluated_per_row,
  f.current_setting_maybe_re_evaluated_per_row,
  (
    f.using_expression is not null
    and public.wrap_common_auth_calls_for_policy(f.using_expression) <> f.using_expression
  ) as using_needs_auth_wrap,
  (
    f.with_check_expression is not null
    and public.wrap_common_auth_calls_for_policy(f.with_check_expression) <> f.with_check_expression
  ) as with_check_needs_auth_wrap,
  case
    when f.using_expression is not null
      and public.wrap_common_auth_calls_for_policy(f.using_expression) <> f.using_expression
    then format(
      'alter policy %I on %I.%I using (%s);',
      f.policyname, f.schemaname, f.tablename,
      public.wrap_common_auth_calls_for_policy(f.using_expression)
    )
    else null
  end as suggested_using_sql,
  case
    when f.with_check_expression is not null
      and public.wrap_common_auth_calls_for_policy(f.with_check_expression) <> f.with_check_expression
    then format(
      'alter policy %I on %I.%I with check (%s);',
      f.policyname, f.schemaname, f.tablename,
      public.wrap_common_auth_calls_for_policy(f.with_check_expression)
    )
    else null
  end as suggested_with_check_sql
from flags f
where f.auth_calls_maybe_re_evaluated_per_row
   or f.current_setting_maybe_re_evaluated_per_row;

create or replace function public.optimize_rls_auth_calls(
  p_schema text default 'public',
  p_apply boolean default false
)
returns table(
  schema_name text,
  table_name text,
  policy_name text,
  changed_using boolean,
  changed_with_check boolean,
  executed boolean,
  statement text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_policy record;
  v_new_using text;
  v_new_with_check text;
  v_changed_using boolean;
  v_changed_with_check boolean;
  v_stmt text;
begin
  for v_policy in
    select
      p.schemaname,
      p.tablename,
      p.policyname,
      p.qual as using_expression,
      p.with_check as with_check_expression
    from pg_policies p
    where p.schemaname not in ('pg_catalog', 'information_schema', 'pg_toast')
      and (p_schema is null or p.schemaname = p_schema)
  loop
    v_new_using := public.wrap_common_auth_calls_for_policy(v_policy.using_expression);
    v_new_with_check := public.wrap_common_auth_calls_for_policy(v_policy.with_check_expression);

    v_changed_using := (
      v_policy.using_expression is not null
      and v_new_using <> v_policy.using_expression
    );
    v_changed_with_check := (
      v_policy.with_check_expression is not null
      and v_new_with_check <> v_policy.with_check_expression
    );

    if not v_changed_using and not v_changed_with_check then
      continue;
    end if;

    v_stmt := format(
      'alter policy %I on %I.%I',
      v_policy.policyname,
      v_policy.schemaname,
      v_policy.tablename
    );

    if v_changed_using then
      v_stmt := v_stmt || format(' using (%s)', v_new_using);
    end if;

    if v_changed_with_check then
      v_stmt := v_stmt || format(' with check (%s)', v_new_with_check);
    end if;

    if p_apply then
      execute v_stmt;
    end if;

    return query
    select
      v_policy.schemaname::text,
      v_policy.tablename::text,
      v_policy.policyname::text,
      v_changed_using,
      v_changed_with_check,
      p_apply,
      v_stmt || ';';
  end loop;
end;
$$;

-- =========================================================
-- DUPLICATE INDEX DETECTION + CLEANUP
-- =========================================================

create or replace view public.duplicate_index_candidates
with (security_invoker = true) as
with index_rows as (
  select
    ns.nspname as schema_name,
    tbl.relname as table_name,
    idx.relname as index_name,
    i.indexrelid,
    am.amname as access_method,
    i.indisunique,
    i.indisprimary,
    i.indisexclusion,
    i.indkey,
    i.indclass,
    i.indcollation,
    i.indoption,
    coalesce(pg_get_expr(i.indexprs, i.indrelid), '') as index_exprs,
    coalesce(pg_get_expr(i.indpred, i.indrelid), '') as predicate,
    exists (
      select 1
      from pg_constraint c
      where c.conindid = i.indexrelid
    ) as backs_constraint
  from pg_index i
  join pg_class idx on idx.oid = i.indexrelid
  join pg_class tbl on tbl.oid = i.indrelid
  join pg_namespace ns on ns.oid = tbl.relnamespace
  join pg_am am on am.oid = idx.relam
  where ns.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
    and idx.relkind = 'i'
    and i.indisvalid = true
    and i.indisready = true
),
ranked as (
  select
    ir.*,
    count(*) over (
      partition by
        ir.schema_name,
        ir.table_name,
        ir.access_method,
        ir.indisunique,
        ir.indisprimary,
        ir.indisexclusion,
        ir.indkey,
        ir.indclass,
        ir.indcollation,
        ir.indoption,
        ir.index_exprs,
        ir.predicate
    ) as duplicate_count,
    row_number() over (
      partition by
        ir.schema_name,
        ir.table_name,
        ir.access_method,
        ir.indisunique,
        ir.indisprimary,
        ir.indisexclusion,
        ir.indkey,
        ir.indclass,
        ir.indcollation,
        ir.indoption,
        ir.index_exprs,
        ir.predicate
      order by ir.backs_constraint desc, ir.index_name
    ) as duplicate_rank,
    first_value(ir.index_name) over (
      partition by
        ir.schema_name,
        ir.table_name,
        ir.access_method,
        ir.indisunique,
        ir.indisprimary,
        ir.indisexclusion,
        ir.indkey,
        ir.indclass,
        ir.indcollation,
        ir.indoption,
        ir.index_exprs,
        ir.predicate
      order by ir.backs_constraint desc, ir.index_name
    ) as keep_index
  from index_rows ir
)
select
  r.schema_name,
  r.table_name,
  r.keep_index,
  r.index_name as duplicate_index,
  r.access_method,
  r.indisunique as is_unique,
  nullif(r.predicate, '') as predicate,
  r.duplicate_count,
  format('drop index if exists %I.%I;', r.schema_name, r.index_name) as suggested_drop_sql
from ranked r
where r.duplicate_count > 1
  and r.duplicate_rank > 1
  and r.backs_constraint = false;

create or replace function public.drop_duplicate_indexes(
  p_schema text default 'public',
  p_apply boolean default false
)
returns table(
  schema_name text,
  table_name text,
  keep_index text,
  duplicate_index text,
  executed boolean,
  statement text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_stmt text;
begin
  for v_row in
    select
      d.schema_name,
      d.table_name,
      d.keep_index,
      d.duplicate_index
    from public.duplicate_index_candidates d
    where p_schema is null or d.schema_name = p_schema
    order by d.schema_name, d.table_name, d.duplicate_index
  loop
    v_stmt := format('drop index if exists %I.%I', v_row.schema_name, v_row.duplicate_index);

    if p_apply then
      execute v_stmt;
    end if;

    return query
    select
      v_row.schema_name::text,
      v_row.table_name::text,
      v_row.keep_index::text,
      v_row.duplicate_index::text,
      p_apply,
      v_stmt || ';';
  end loop;
end;
$$;

notify pgrst, 'reload schema';
