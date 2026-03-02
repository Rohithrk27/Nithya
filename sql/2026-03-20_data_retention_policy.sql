-- Data retention policy + scheduled cleanup job
-- Depends on: 2026-03-20_public_profile_rank_position.sql

set search_path = public, extensions;

create table if not exists public.retention_job_runs (
  id bigserial primary key,
  ran_at timestamptz not null default now(),
  dry_run boolean not null default false,
  summary jsonb not null default '{}'::jsonb
);

create index if not exists retention_job_runs_ran_at_idx
  on public.retention_job_runs (ran_at desc);

create or replace function public.run_retention_job(
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_cutoff_30 timestamptz := v_now - interval '30 days';
  v_cutoff_90 timestamptz := v_now - interval '90 days';
  v_cutoff_365 timestamptz := v_now - interval '365 days';

  v_chat_30 integer := 0;
  v_admin_attempts_30 integer := 0;
  v_admin_sessions_30 integer := 0;
  v_relic_attempts_30 integer := 0;

  v_activity_90 integer := 0;
  v_interruptions_90 integer := 0;
  v_focus_90 integer := 0;
  v_task_failures_90 integer := 0;

  v_xp_365 integer := 0;
  v_habit_logs_365 integer := 0;
  v_user_quests_365 integer := 0;
  v_punishments_365 integer := 0;
  v_dungeon_runs_365 integer := 0;
  v_party_challenges_365 integer := 0;
  v_party_contrib_365 integer := 0;
  v_party_rewards_365 integer := 0;
  v_insights_365 integer := 0;
  v_retention_logs_365 integer := 0;

  v_summary jsonb;
begin
  -- =======================================================
  -- 30-day retention
  -- =======================================================

  if to_regclass('public.community_chat_messages') is not null then
    if p_dry_run then
      select count(*)::integer into v_chat_30
      from public.community_chat_messages c
      where c.created_at < v_cutoff_30;
    else
      delete from public.community_chat_messages c
      where c.created_at < v_cutoff_30;
      get diagnostics v_chat_30 = row_count;
    end if;
  end if;

  if to_regclass('public.admin_login_attempts') is not null then
    if p_dry_run then
      select count(*)::integer into v_admin_attempts_30
      from public.admin_login_attempts a
      where a.attempted_at < v_cutoff_30;
    else
      delete from public.admin_login_attempts a
      where a.attempted_at < v_cutoff_30;
      get diagnostics v_admin_attempts_30 = row_count;
    end if;
  end if;

  if to_regclass('public.admin_sessions') is not null then
    if p_dry_run then
      select count(*)::integer into v_admin_sessions_30
      from public.admin_sessions s
      where (s.revoked_at is not null or s.expires_at < v_now)
        and coalesce(s.revoked_at, s.expires_at, s.created_at) < v_cutoff_30;
    else
      delete from public.admin_sessions s
      where (s.revoked_at is not null or s.expires_at < v_now)
        and coalesce(s.revoked_at, s.expires_at, s.created_at) < v_cutoff_30;
      get diagnostics v_admin_sessions_30 = row_count;
    end if;
  end if;

  if to_regclass('public.relic_redeem_attempts') is not null then
    if p_dry_run then
      select count(*)::integer into v_relic_attempts_30
      from public.relic_redeem_attempts r
      where r.attempted_at < v_cutoff_30;
    else
      delete from public.relic_redeem_attempts r
      where r.attempted_at < v_cutoff_30;
      get diagnostics v_relic_attempts_30 = row_count;
    end if;
  end if;

  -- =======================================================
  -- 90-day retention
  -- =======================================================

  if to_regclass('public.activity_logs') is not null then
    if p_dry_run then
      select count(*)::integer into v_activity_90
      from public.activity_logs a
      where a.created_at < v_cutoff_90;
    else
      delete from public.activity_logs a
      where a.created_at < v_cutoff_90;
      get diagnostics v_activity_90 = row_count;
    end if;
  end if;

  if to_regclass('public.interruptions') is not null then
    if p_dry_run then
      select count(*)::integer into v_interruptions_90
      from public.interruptions i
      where i.created_at < v_cutoff_90;
    else
      delete from public.interruptions i
      where i.created_at < v_cutoff_90;
      get diagnostics v_interruptions_90 = row_count;
    end if;
  end if;

  if to_regclass('public.focus_sessions') is not null then
    if p_dry_run then
      select count(*)::integer into v_focus_90
      from public.focus_sessions f
      where lower(coalesce(f.status, '')) in ('completed', 'interrupted', 'abandoned')
        and coalesce(f.ended_at, f.created_at) < v_cutoff_90;
    else
      delete from public.focus_sessions f
      where lower(coalesce(f.status, '')) in ('completed', 'interrupted', 'abandoned')
        and coalesce(f.ended_at, f.created_at) < v_cutoff_90;
      get diagnostics v_focus_90 = row_count;
    end if;
  end if;

  if to_regclass('public.task_deadline_failures') is not null then
    if p_dry_run then
      select count(*)::integer into v_task_failures_90
      from public.task_deadline_failures t
      where t.created_at < v_cutoff_90;
    else
      delete from public.task_deadline_failures t
      where t.created_at < v_cutoff_90;
      get diagnostics v_task_failures_90 = row_count;
    end if;
  end if;

  -- =======================================================
  -- 365-day retention
  -- =======================================================

  if to_regclass('public.xp_logs') is not null then
    if p_dry_run then
      select count(*)::integer into v_xp_365
      from public.xp_logs x
      where coalesce(
        nullif(to_jsonb(x)->>'created_at', '')::timestamptz,
        nullif(to_jsonb(x)->>'date', '')::timestamptz
      ) < v_cutoff_365;
    else
      delete from public.xp_logs x
      where coalesce(
        nullif(to_jsonb(x)->>'created_at', '')::timestamptz,
        nullif(to_jsonb(x)->>'date', '')::timestamptz
      ) < v_cutoff_365;
      get diagnostics v_xp_365 = row_count;
    end if;
  end if;

  if to_regclass('public.habit_logs') is not null then
    if p_dry_run then
      select count(*)::integer into v_habit_logs_365
      from public.habit_logs h
      where coalesce(
        nullif(to_jsonb(h)->>'date', '')::timestamptz,
        nullif(to_jsonb(h)->>'created_at', '')::timestamptz
      ) < v_cutoff_365;
    else
      delete from public.habit_logs h
      where coalesce(
        nullif(to_jsonb(h)->>'date', '')::timestamptz,
        nullif(to_jsonb(h)->>'created_at', '')::timestamptz
      ) < v_cutoff_365;
      get diagnostics v_habit_logs_365 = row_count;
    end if;
  end if;

  if to_regclass('public.user_quests') is not null then
    if p_dry_run then
      select count(*)::integer into v_user_quests_365
      from public.user_quests uq
      where coalesce(nullif(lower(replace(coalesce(uq.status, ''), '-', '_')), ''), 'inactive')
        not in ('active', 'in_progress', 'accepted', 'inprogress', 'ongoing', 'started', 'start')
        and coalesce(
          nullif(to_jsonb(uq)->>'completed_date', '')::timestamptz,
          nullif(to_jsonb(uq)->>'date', '')::timestamptz,
          nullif(to_jsonb(uq)->>'created_at', '')::timestamptz
        ) < v_cutoff_365;
    else
      delete from public.user_quests uq
      where coalesce(nullif(lower(replace(coalesce(uq.status, ''), '-', '_')), ''), 'inactive')
        not in ('active', 'in_progress', 'accepted', 'inprogress', 'ongoing', 'started', 'start')
        and coalesce(
          nullif(to_jsonb(uq)->>'completed_date', '')::timestamptz,
          nullif(to_jsonb(uq)->>'date', '')::timestamptz,
          nullif(to_jsonb(uq)->>'created_at', '')::timestamptz
        ) < v_cutoff_365;
      get diagnostics v_user_quests_365 = row_count;
    end if;
  end if;

  if to_regclass('public.punishments') is not null then
    if p_dry_run then
      select count(*)::integer into v_punishments_365
      from public.punishments p
      where (
        coalesce(p.resolved, false) = true
        or coalesce(p.penalty_applied, false) = true
        or lower(coalesce(p.status, '')) in ('completed', 'refused', 'timed_out', 'expired')
      )
      and coalesce(
        nullif(to_jsonb(p)->>'resolved_at', '')::timestamptz,
        nullif(to_jsonb(p)->>'expires_at', '')::timestamptz,
        nullif(to_jsonb(p)->>'created_at', '')::timestamptz
      ) < v_cutoff_365;
    else
      delete from public.punishments p
      where (
        coalesce(p.resolved, false) = true
        or coalesce(p.penalty_applied, false) = true
        or lower(coalesce(p.status, '')) in ('completed', 'refused', 'timed_out', 'expired')
      )
      and coalesce(
        nullif(to_jsonb(p)->>'resolved_at', '')::timestamptz,
        nullif(to_jsonb(p)->>'expires_at', '')::timestamptz,
        nullif(to_jsonb(p)->>'created_at', '')::timestamptz
      ) < v_cutoff_365;
      get diagnostics v_punishments_365 = row_count;
    end if;
  end if;

  if to_regclass('public.dungeon_runs') is not null then
    if p_dry_run then
      select count(*)::integer into v_dungeon_runs_365
      from public.dungeon_runs d
      where lower(coalesce(d.status, '')) <> 'active'
        and coalesce(
          nullif(to_jsonb(d)->>'end_date', '')::timestamptz,
          nullif(to_jsonb(d)->>'created_at', '')::timestamptz
        ) < v_cutoff_365;
    else
      delete from public.dungeon_runs d
      where lower(coalesce(d.status, '')) <> 'active'
        and coalesce(
          nullif(to_jsonb(d)->>'end_date', '')::timestamptz,
          nullif(to_jsonb(d)->>'created_at', '')::timestamptz
        ) < v_cutoff_365;
      get diagnostics v_dungeon_runs_365 = row_count;
    end if;
  end if;

  if to_regclass('public.party_challenges') is not null then
    -- Count cascade targets first (for observability).
    if to_regclass('public.party_challenge_contributions') is not null then
      select count(*)::integer into v_party_contrib_365
      from public.party_challenge_contributions c
      join public.party_challenges pc on pc.id = c.challenge_id
      where lower(coalesce(pc.status, '')) in ('completed', 'expired', 'cancelled')
        and coalesce(pc.completed_at, pc.due_at, pc.created_at) < v_cutoff_365;
    end if;

    if to_regclass('public.party_challenge_rewards') is not null then
      select count(*)::integer into v_party_rewards_365
      from public.party_challenge_rewards r
      join public.party_challenges pc on pc.id = r.challenge_id
      where lower(coalesce(pc.status, '')) in ('completed', 'expired', 'cancelled')
        and coalesce(pc.completed_at, pc.due_at, pc.created_at) < v_cutoff_365;
    end if;

    if p_dry_run then
      select count(*)::integer into v_party_challenges_365
      from public.party_challenges pc
      where lower(coalesce(pc.status, '')) in ('completed', 'expired', 'cancelled')
        and coalesce(pc.completed_at, pc.due_at, pc.created_at) < v_cutoff_365;
    else
      delete from public.party_challenges pc
      where lower(coalesce(pc.status, '')) in ('completed', 'expired', 'cancelled')
        and coalesce(pc.completed_at, pc.due_at, pc.created_at) < v_cutoff_365;
      get diagnostics v_party_challenges_365 = row_count;
    end if;
  end if;

  if to_regclass('public.weekly_personal_insights') is not null then
    if p_dry_run then
      select count(*)::integer into v_insights_365
      from public.weekly_personal_insights w
      where coalesce(
        nullif(to_jsonb(w)->>'generated_at', '')::timestamptz,
        nullif(to_jsonb(w)->>'created_at', '')::timestamptz,
        nullif(to_jsonb(w)->>'week_end', '')::timestamptz
      ) < v_cutoff_365;
    else
      delete from public.weekly_personal_insights w
      where coalesce(
        nullif(to_jsonb(w)->>'generated_at', '')::timestamptz,
        nullif(to_jsonb(w)->>'created_at', '')::timestamptz,
        nullif(to_jsonb(w)->>'week_end', '')::timestamptz
      ) < v_cutoff_365;
      get diagnostics v_insights_365 = row_count;
    end if;
  end if;

  if to_regclass('public.retention_job_runs') is not null then
    if p_dry_run then
      select count(*)::integer into v_retention_logs_365
      from public.retention_job_runs r
      where r.ran_at < v_cutoff_365;
    else
      delete from public.retention_job_runs r
      where r.ran_at < v_cutoff_365;
      get diagnostics v_retention_logs_365 = row_count;
    end if;
  end if;

  v_summary := jsonb_build_object(
    'ran_at', v_now,
    'dry_run', p_dry_run,
    'cutoffs', jsonb_build_object(
      'days_30', v_cutoff_30,
      'days_90', v_cutoff_90,
      'days_365', v_cutoff_365
    ),
    'deleted', jsonb_build_object(
      'community_chat_messages_30d', v_chat_30,
      'admin_login_attempts_30d', v_admin_attempts_30,
      'admin_sessions_30d', v_admin_sessions_30,
      'relic_redeem_attempts_30d', v_relic_attempts_30,
      'activity_logs_90d', v_activity_90,
      'interruptions_90d', v_interruptions_90,
      'focus_sessions_terminal_90d', v_focus_90,
      'task_deadline_failures_90d', v_task_failures_90,
      'xp_logs_365d', v_xp_365,
      'habit_logs_365d', v_habit_logs_365,
      'user_quests_terminal_365d', v_user_quests_365,
      'punishments_closed_365d', v_punishments_365,
      'dungeon_runs_terminal_365d', v_dungeon_runs_365,
      'party_challenges_terminal_365d', v_party_challenges_365,
      'party_challenge_contributions_cascade_365d', v_party_contrib_365,
      'party_challenge_rewards_cascade_365d', v_party_rewards_365,
      'weekly_personal_insights_365d', v_insights_365,
      'retention_job_runs_365d', v_retention_logs_365
    ),
    'total_deleted', (
      v_chat_30
      + v_admin_attempts_30
      + v_admin_sessions_30
      + v_relic_attempts_30
      + v_activity_90
      + v_interruptions_90
      + v_focus_90
      + v_task_failures_90
      + v_xp_365
      + v_habit_logs_365
      + v_user_quests_365
      + v_punishments_365
      + v_dungeon_runs_365
      + v_party_challenges_365
      + v_insights_365
      + v_retention_logs_365
    )
  );

  insert into public.retention_job_runs (dry_run, summary)
  values (p_dry_run, v_summary);

  return v_summary;
end;
$$;

do $$
declare
  v_job record;
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'cron'
      and table_name = 'job'
  ) then
    begin
      for v_job in
        select j.jobid
        from cron.job j
        where j.jobname = 'retention-daily'
      loop
        perform cron.unschedule(v_job.jobid);
      end loop;

      perform cron.schedule(
        'retention-daily',
        '15 3 * * *',
        $cmd$select public.run_retention_job(false);$cmd$
      );
    exception
      when others then
        -- Non-fatal: cron may be unavailable for this project/environment.
        null;
    end;
  end if;
end;
$$;

notify pgrst, 'reload schema';
