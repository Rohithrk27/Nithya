-- User quest state repair (one-click recovery)
-- 1) Normalize legacy active statuses
-- 2) Backfill missing quest_type values
-- 3) Resolve orphan active rows
-- 4) Resolve duplicate active weekly rows

create extension if not exists pgcrypto;

alter table public.user_quests
  add column if not exists quest_type text,
  add column if not exists started_at timestamptz,
  add column if not exists failed boolean not null default false,
  add column if not exists penalty_applied boolean not null default false,
  add column if not exists failure_reason text,
  add column if not exists completed_date date,
  add column if not exists created_at timestamptz not null default now();

create or replace function public.repair_user_quest_state(
  p_user_id uuid
)
returns table(
  updated_rows integer,
  status_normalized integer,
  quest_type_backfilled integer,
  orphan_rows_resolved integer,
  duplicate_weekly_resolved integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status_norm integer := 0;
  v_type_backfill integer := 0;
  v_orphan integer := 0;
  v_weekly integer := 0;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  perform pg_advisory_xact_lock(hashtext('repair_user_quest_state'), hashtext(p_user_id::text));

  -- Normalize legacy synonyms so active quests are visible consistently.
  update public.user_quests uq
  set status = 'active'
  where uq.user_id = p_user_id
    and lower(trim(coalesce(uq.status, ''))) in ('inprogress', 'ongoing', 'started');
  get diagnostics v_status_norm = row_count;

  -- Backfill quest_type from quest templates.
  update public.user_quests uq
  set quest_type = coalesce(nullif(lower(trim(coalesce(q.type, ''))), ''), 'daily')
  from public.quests q
  where uq.user_id = p_user_id
    and uq.quest_id = q.id
    and nullif(trim(coalesce(uq.quest_type, '')), '') is null;
  get diagnostics v_type_backfill = row_count;

  -- Resolve active rows referencing missing/deleted quest templates.
  update public.user_quests uq
  set
    status = 'failed',
    failed = true,
    completed_date = coalesce(uq.completed_date, current_date),
    penalty_applied = coalesce(uq.penalty_applied, false),
    failure_reason = coalesce(nullif(trim(coalesce(uq.failure_reason, '')), ''), 'orphan_quest_repaired')
  where uq.user_id = p_user_id
    and lower(trim(coalesce(uq.status, ''))) in ('active', 'in_progress', 'accepted', 'inprogress', 'ongoing', 'started')
    and (
      uq.quest_id is null
      or not exists (
        select 1
        from public.quests q
        where q.id = uq.quest_id
      )
    );
  get diagnostics v_orphan = row_count;

  -- Keep only the latest active weekly row to satisfy weekly uniqueness.
  with ranked as (
    select
      uq.id,
      row_number() over (
        order by coalesce(uq.started_at, uq.created_at, now()) desc, uq.id desc
      ) as rn
    from public.user_quests uq
    left join public.quests q on q.id = uq.quest_id
    where uq.user_id = p_user_id
      and lower(trim(coalesce(uq.status, ''))) in ('active', 'in_progress', 'accepted', 'inprogress', 'ongoing', 'started')
      and lower(coalesce(nullif(trim(coalesce(uq.quest_type, '')), ''), q.type, 'daily')) = 'weekly'
  )
  update public.user_quests uq
  set
    status = 'failed',
    failed = true,
    completed_date = coalesce(uq.completed_date, current_date),
    penalty_applied = coalesce(uq.penalty_applied, false),
    failure_reason = coalesce(nullif(trim(coalesce(uq.failure_reason, '')), ''), 'duplicate_weekly_repaired')
  from ranked r
  where uq.id = r.id
    and r.rn > 1;
  get diagnostics v_weekly = row_count;

  return query
  select
    (v_status_norm + v_type_backfill + v_orphan + v_weekly)::integer,
    v_status_norm,
    v_type_backfill,
    v_orphan,
    v_weekly;
end;
$$;

grant execute on function public.repair_user_quest_state(uuid) to authenticated;

