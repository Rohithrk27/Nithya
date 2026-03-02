-- Tight safe-limits retention + compaction policy for free-plan scaling.
-- Depends on: 2026-03-20_disable_payment_proof_upload.sql

set search_path = public, extensions;

create or replace view public.retention_policy_current
with (security_invoker = true) as
select *
from (
  values
    ('community_chat_messages', 'delete', '14 days', 'all rows'),
    ('admin_login_attempts', 'delete', '14 days', 'all rows'),
    ('relic_redeem_attempts', 'delete', '14 days', 'all rows'),
    ('dungeon_party_invites', 'delete', '14 days', 'pending only'),
    ('admin_sessions', 'delete', '30 days', 'revoked or expired only'),
    ('payment_verification_requests', 'delete', '30 days', 'pending only'),
    ('friend_requests', 'delete', '30 days', 'pending only'),
    ('activity_logs', 'compact', '7 to 45 days', 'metadata minimized'),
    ('activity_logs', 'delete', '45 days', 'all rows'),
    ('interruptions', 'delete', '45 days', 'all rows'),
    ('focus_sessions', 'delete', '45 days', 'terminal statuses only'),
    ('task_deadline_failures', 'delete', '45 days', 'all rows'),
    ('dungeon_party_invites', 'delete', '45 days', 'non-pending statuses'),
    ('web_push_subscriptions', 'delete', '90 days', 'inactive only'),
    ('friend_requests', 'delete', '90 days', 'accepted/rejected'),
    ('xp_logs', 'compact', '30 to 120 days', 'metadata stripped'),
    ('xp_logs', 'delete', '120 days', 'all rows'),
    ('habit_logs', 'delete', '120 days', 'all rows'),
    ('user_quests', 'delete', '120 days', 'non-active statuses'),
    ('punishments', 'delete', '120 days', 'resolved/closed'),
    ('dungeon_runs', 'delete', '120 days', 'non-active statuses'),
    ('party_challenges', 'delete', '120 days', 'terminal statuses'),
    ('recovery_plans', 'delete', '120 days', 'terminal statuses'),
    ('rank_evaluations', 'delete', '120 days', 'cleared/failed only'),
    ('payment_verification_requests', 'compact', '30 to 120 days', 'trim notes/reply and clear proof_path'),
    ('payment_verification_requests', 'delete', '120 days', 'reviewed/verified/rejected'),
    ('relic_logs', 'delete', '120 days', 'all rows'),
    ('relic_code_redemptions', 'delete', '120 days', 'all rows'),
    ('discipline_relic_effects', 'delete', '120 days', 'non-active statuses'),
    ('security_exploit_states', 'delete', '120 days', 'resolved only'),
    ('community_submissions', 'compact', '30 to 180 days', 'trim message/reply for reviewed/resolved'),
    ('community_submissions', 'delete', '180 days', 'reviewed/resolved'),
    ('weekly_personal_insights', 'delete', '180 days', 'all rows'),
    ('admin_audit_logs', 'compact', '30 to 180 days', 'metadata minimized'),
    ('admin_audit_logs', 'delete', '180 days', 'all rows'),
    ('announcements', 'delete', '180 days', 'inactive or expired'),
    ('retention_job_runs', 'delete', '180 days', 'all rows')
) as t(table_name, action, retention_window, criteria);

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
  v_cutoff_7 timestamptz := v_now - interval '7 days';
  v_cutoff_14 timestamptz := v_now - interval '14 days';
  v_cutoff_30 timestamptz := v_now - interval '30 days';
  v_cutoff_45 timestamptz := v_now - interval '45 days';
  v_cutoff_90 timestamptz := v_now - interval '90 days';
  v_cutoff_120 timestamptz := v_now - interval '120 days';
  v_cutoff_180 timestamptz := v_now - interval '180 days';

  -- compaction counters
  v_compact_activity_7_45 integer := 0;
  v_compact_xp_meta_30_120 integer := 0;
  v_compact_payment_text_30_120 integer := 0;
  v_compact_community_submission_30_180 integer := 0;
  v_compact_admin_audit_30_180 integer := 0;

  -- delete counters
  v_chat_14 integer := 0;
  v_admin_attempts_14 integer := 0;
  v_relic_attempts_14 integer := 0;
  v_party_invites_pending_14 integer := 0;

  v_admin_sessions_30 integer := 0;
  v_payment_pending_30 integer := 0;
  v_friend_requests_pending_30 integer := 0;

  v_activity_45 integer := 0;
  v_interruptions_45 integer := 0;
  v_focus_45 integer := 0;
  v_task_failures_45 integer := 0;
  v_party_invites_terminal_45 integer := 0;

  v_web_push_inactive_90 integer := 0;
  v_friend_requests_terminal_90 integer := 0;

  v_xp_120 integer := 0;
  v_habit_logs_120 integer := 0;
  v_user_quests_120 integer := 0;
  v_punishments_120 integer := 0;
  v_dungeon_runs_120 integer := 0;
  v_party_challenges_120 integer := 0;
  v_party_contrib_120 integer := 0;
  v_party_rewards_120 integer := 0;
  v_recovery_plans_120 integer := 0;
  v_recovery_steps_120 integer := 0;
  v_rank_evals_120 integer := 0;
  v_payment_closed_120 integer := 0;
  v_relic_logs_120 integer := 0;
  v_relic_code_redemptions_120 integer := 0;
  v_relic_effects_120 integer := 0;
  v_security_exploit_states_120 integer := 0;

  v_insights_180 integer := 0;
  v_community_submissions_180 integer := 0;
  v_admin_audit_180 integer := 0;
  v_announcements_180 integer := 0;
  v_retention_logs_180 integer := 0;

  v_summary jsonb;
begin
  -- =======================================================
  -- COMPACTION PHASE (before deletes)
  -- =======================================================

  if to_regclass('public.activity_logs') is not null then
    if p_dry_run then
      select count(*)::integer
      into v_compact_activity_7_45
      from public.activity_logs a
      where a.created_at < v_cutoff_7
        and a.created_at >= v_cutoff_45
        and coalesce(lower(a.metadata->>'compacted'), 'false') <> 'true';
    else
      update public.activity_logs a
      set metadata = jsonb_build_object(
        'compacted', true,
        'type', a.type
      )
      where a.created_at < v_cutoff_7
        and a.created_at >= v_cutoff_45
        and coalesce(lower(a.metadata->>'compacted'), 'false') <> 'true';
      get diagnostics v_compact_activity_7_45 = row_count;
    end if;
  end if;

  if to_regclass('public.xp_logs') is not null then
    if p_dry_run then
      select count(*)::integer
      into v_compact_xp_meta_30_120
      from public.xp_logs x
      where x.created_at < v_cutoff_30
        and x.created_at >= v_cutoff_120
        and coalesce(x.metadata, '{}'::jsonb) <> '{}'::jsonb;
    else
      update public.xp_logs x
      set metadata = '{}'::jsonb
      where x.created_at < v_cutoff_30
        and x.created_at >= v_cutoff_120
        and coalesce(x.metadata, '{}'::jsonb) <> '{}'::jsonb;
      get diagnostics v_compact_xp_meta_30_120 = row_count;
    end if;
  end if;

  if to_regclass('public.payment_verification_requests') is not null then
    if p_dry_run then
      select count(*)::integer
      into v_compact_payment_text_30_120
      from public.payment_verification_requests pvr
      where pvr.status in ('reviewed', 'verified', 'rejected')
        and pvr.created_at < v_cutoff_30
        and pvr.created_at >= v_cutoff_120
        and (
          coalesce(char_length(pvr.notes), 0) > 240
          or coalesce(char_length(pvr.admin_reply), 0) > 240
          or pvr.proof_path is not null
        );
    else
      update public.payment_verification_requests pvr
      set
        notes = case
          when pvr.notes is null then null
          else left(pvr.notes, 240)
        end,
        admin_reply = case
          when pvr.admin_reply is null then null
          else left(pvr.admin_reply, 240)
        end,
        proof_path = null
      where pvr.status in ('reviewed', 'verified', 'rejected')
        and pvr.created_at < v_cutoff_30
        and pvr.created_at >= v_cutoff_120
        and (
          coalesce(char_length(pvr.notes), 0) > 240
          or coalesce(char_length(pvr.admin_reply), 0) > 240
          or pvr.proof_path is not null
        );
      get diagnostics v_compact_payment_text_30_120 = row_count;
    end if;
  end if;

  if to_regclass('public.community_submissions') is not null then
    if p_dry_run then
      select count(*)::integer
      into v_compact_community_submission_30_180
      from public.community_submissions cs
      where cs.status in ('reviewed', 'resolved')
        and cs.created_at < v_cutoff_30
        and cs.created_at >= v_cutoff_180
        and (
          coalesce(char_length(cs.message), 0) > 320
          or coalesce(char_length(cs.admin_reply), 0) > 320
        );
    else
      update public.community_submissions cs
      set
        message = left(cs.message, 320),
        admin_reply = case
          when cs.admin_reply is null then null
          else left(cs.admin_reply, 320)
        end
      where cs.status in ('reviewed', 'resolved')
        and cs.created_at < v_cutoff_30
        and cs.created_at >= v_cutoff_180
        and (
          coalesce(char_length(cs.message), 0) > 320
          or coalesce(char_length(cs.admin_reply), 0) > 320
        );
      get diagnostics v_compact_community_submission_30_180 = row_count;
    end if;
  end if;

  if to_regclass('public.admin_audit_logs') is not null then
    if p_dry_run then
      select count(*)::integer
      into v_compact_admin_audit_30_180
      from public.admin_audit_logs aal
      where aal.created_at < v_cutoff_30
        and aal.created_at >= v_cutoff_180
        and coalesce(aal.metadata, '{}'::jsonb) <> '{}'::jsonb;
    else
      update public.admin_audit_logs aal
      set metadata = jsonb_build_object(
        'compacted', true,
        'action', aal.action
      )
      where aal.created_at < v_cutoff_30
        and aal.created_at >= v_cutoff_180
        and coalesce(aal.metadata, '{}'::jsonb) <> '{}'::jsonb;
      get diagnostics v_compact_admin_audit_30_180 = row_count;
    end if;
  end if;

  -- =======================================================
  -- DELETE PHASE
  -- =======================================================

  if to_regclass('public.community_chat_messages') is not null then
    if p_dry_run then
      select count(*)::integer into v_chat_14
      from public.community_chat_messages c
      where c.created_at < v_cutoff_14;
    else
      delete from public.community_chat_messages c
      where c.created_at < v_cutoff_14;
      get diagnostics v_chat_14 = row_count;
    end if;
  end if;

  if to_regclass('public.admin_login_attempts') is not null then
    if p_dry_run then
      select count(*)::integer into v_admin_attempts_14
      from public.admin_login_attempts a
      where a.attempted_at < v_cutoff_14;
    else
      delete from public.admin_login_attempts a
      where a.attempted_at < v_cutoff_14;
      get diagnostics v_admin_attempts_14 = row_count;
    end if;
  end if;

  if to_regclass('public.relic_redeem_attempts') is not null then
    if p_dry_run then
      select count(*)::integer into v_relic_attempts_14
      from public.relic_redeem_attempts r
      where r.attempted_at < v_cutoff_14;
    else
      delete from public.relic_redeem_attempts r
      where r.attempted_at < v_cutoff_14;
      get diagnostics v_relic_attempts_14 = row_count;
    end if;
  end if;

  if to_regclass('public.dungeon_party_invites') is not null then
    if p_dry_run then
      select count(*)::integer into v_party_invites_pending_14
      from public.dungeon_party_invites i
      where i.status = 'pending'
        and i.created_at < v_cutoff_14;
    else
      delete from public.dungeon_party_invites i
      where i.status = 'pending'
        and i.created_at < v_cutoff_14;
      get diagnostics v_party_invites_pending_14 = row_count;
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

  if to_regclass('public.payment_verification_requests') is not null then
    if p_dry_run then
      select count(*)::integer into v_payment_pending_30
      from public.payment_verification_requests pvr
      where pvr.status = 'pending'
        and pvr.created_at < v_cutoff_30;
    else
      delete from public.payment_verification_requests pvr
      where pvr.status = 'pending'
        and pvr.created_at < v_cutoff_30;
      get diagnostics v_payment_pending_30 = row_count;
    end if;
  end if;

  if to_regclass('public.friend_requests') is not null then
    if p_dry_run then
      select count(*)::integer into v_friend_requests_pending_30
      from public.friend_requests fr
      where fr.status = 'pending'
        and fr.created_at < v_cutoff_30;
    else
      delete from public.friend_requests fr
      where fr.status = 'pending'
        and fr.created_at < v_cutoff_30;
      get diagnostics v_friend_requests_pending_30 = row_count;
    end if;
  end if;

  if to_regclass('public.activity_logs') is not null then
    if p_dry_run then
      select count(*)::integer into v_activity_45
      from public.activity_logs a
      where a.created_at < v_cutoff_45;
    else
      delete from public.activity_logs a
      where a.created_at < v_cutoff_45;
      get diagnostics v_activity_45 = row_count;
    end if;
  end if;

  if to_regclass('public.interruptions') is not null then
    if p_dry_run then
      select count(*)::integer into v_interruptions_45
      from public.interruptions i
      where i.created_at < v_cutoff_45;
    else
      delete from public.interruptions i
      where i.created_at < v_cutoff_45;
      get diagnostics v_interruptions_45 = row_count;
    end if;
  end if;

  if to_regclass('public.focus_sessions') is not null then
    if p_dry_run then
      select count(*)::integer into v_focus_45
      from public.focus_sessions f
      where lower(coalesce(f.status, '')) in ('completed', 'interrupted', 'abandoned')
        and coalesce(f.ended_at, f.created_at) < v_cutoff_45;
    else
      delete from public.focus_sessions f
      where lower(coalesce(f.status, '')) in ('completed', 'interrupted', 'abandoned')
        and coalesce(f.ended_at, f.created_at) < v_cutoff_45;
      get diagnostics v_focus_45 = row_count;
    end if;
  end if;

  if to_regclass('public.task_deadline_failures') is not null then
    if p_dry_run then
      select count(*)::integer into v_task_failures_45
      from public.task_deadline_failures t
      where t.created_at < v_cutoff_45;
    else
      delete from public.task_deadline_failures t
      where t.created_at < v_cutoff_45;
      get diagnostics v_task_failures_45 = row_count;
    end if;
  end if;

  if to_regclass('public.dungeon_party_invites') is not null then
    if p_dry_run then
      select count(*)::integer into v_party_invites_terminal_45
      from public.dungeon_party_invites i
      where i.status in ('accepted', 'declined', 'revoked')
        and coalesce(i.responded_at, i.created_at) < v_cutoff_45;
    else
      delete from public.dungeon_party_invites i
      where i.status in ('accepted', 'declined', 'revoked')
        and coalesce(i.responded_at, i.created_at) < v_cutoff_45;
      get diagnostics v_party_invites_terminal_45 = row_count;
    end if;
  end if;

  if to_regclass('public.web_push_subscriptions') is not null then
    if p_dry_run then
      select count(*)::integer into v_web_push_inactive_90
      from public.web_push_subscriptions s
      where s.is_active = false
        and coalesce(s.last_seen_at, s.updated_at, s.created_at) < v_cutoff_90;
    else
      delete from public.web_push_subscriptions s
      where s.is_active = false
        and coalesce(s.last_seen_at, s.updated_at, s.created_at) < v_cutoff_90;
      get diagnostics v_web_push_inactive_90 = row_count;
    end if;
  end if;

  if to_regclass('public.friend_requests') is not null then
    if p_dry_run then
      select count(*)::integer into v_friend_requests_terminal_90
      from public.friend_requests fr
      where fr.status in ('accepted', 'rejected')
        and coalesce(fr.updated_at, fr.created_at) < v_cutoff_90;
    else
      delete from public.friend_requests fr
      where fr.status in ('accepted', 'rejected')
        and coalesce(fr.updated_at, fr.created_at) < v_cutoff_90;
      get diagnostics v_friend_requests_terminal_90 = row_count;
    end if;
  end if;

  if to_regclass('public.xp_logs') is not null then
    if p_dry_run then
      select count(*)::integer into v_xp_120
      from public.xp_logs x
      where coalesce(x.created_at, x.date::timestamptz) < v_cutoff_120;
    else
      delete from public.xp_logs x
      where coalesce(x.created_at, x.date::timestamptz) < v_cutoff_120;
      get diagnostics v_xp_120 = row_count;
    end if;
  end if;

  if to_regclass('public.habit_logs') is not null then
    if p_dry_run then
      select count(*)::integer into v_habit_logs_120
      from public.habit_logs h
      where coalesce(
        nullif(to_jsonb(h)->>'date', '')::timestamptz,
        nullif(to_jsonb(h)->>'created_at', '')::timestamptz
      ) < v_cutoff_120;
    else
      delete from public.habit_logs h
      where coalesce(
        nullif(to_jsonb(h)->>'date', '')::timestamptz,
        nullif(to_jsonb(h)->>'created_at', '')::timestamptz
      ) < v_cutoff_120;
      get diagnostics v_habit_logs_120 = row_count;
    end if;
  end if;

  if to_regclass('public.user_quests') is not null then
    if p_dry_run then
      select count(*)::integer into v_user_quests_120
      from public.user_quests uq
      where coalesce(nullif(lower(replace(coalesce(uq.status, ''), '-', '_')), ''), 'inactive')
        not in ('active', 'in_progress', 'accepted', 'inprogress', 'ongoing', 'started', 'start')
        and coalesce(
          nullif(to_jsonb(uq)->>'completed_date', '')::timestamptz,
          nullif(to_jsonb(uq)->>'date', '')::timestamptz,
          nullif(to_jsonb(uq)->>'created_at', '')::timestamptz
        ) < v_cutoff_120;
    else
      delete from public.user_quests uq
      where coalesce(nullif(lower(replace(coalesce(uq.status, ''), '-', '_')), ''), 'inactive')
        not in ('active', 'in_progress', 'accepted', 'inprogress', 'ongoing', 'started', 'start')
        and coalesce(
          nullif(to_jsonb(uq)->>'completed_date', '')::timestamptz,
          nullif(to_jsonb(uq)->>'date', '')::timestamptz,
          nullif(to_jsonb(uq)->>'created_at', '')::timestamptz
        ) < v_cutoff_120;
      get diagnostics v_user_quests_120 = row_count;
    end if;
  end if;

  if to_regclass('public.punishments') is not null then
    if p_dry_run then
      select count(*)::integer into v_punishments_120
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
      ) < v_cutoff_120;
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
      ) < v_cutoff_120;
      get diagnostics v_punishments_120 = row_count;
    end if;
  end if;

  if to_regclass('public.dungeon_runs') is not null then
    if p_dry_run then
      select count(*)::integer into v_dungeon_runs_120
      from public.dungeon_runs d
      where lower(coalesce(d.status, '')) <> 'active'
        and coalesce(
          nullif(to_jsonb(d)->>'end_date', '')::timestamptz,
          nullif(to_jsonb(d)->>'created_at', '')::timestamptz
        ) < v_cutoff_120;
    else
      delete from public.dungeon_runs d
      where lower(coalesce(d.status, '')) <> 'active'
        and coalesce(
          nullif(to_jsonb(d)->>'end_date', '')::timestamptz,
          nullif(to_jsonb(d)->>'created_at', '')::timestamptz
        ) < v_cutoff_120;
      get diagnostics v_dungeon_runs_120 = row_count;
    end if;
  end if;

  if to_regclass('public.party_challenges') is not null then
    if to_regclass('public.party_challenge_contributions') is not null then
      select count(*)::integer into v_party_contrib_120
      from public.party_challenge_contributions c
      join public.party_challenges pc on pc.id = c.challenge_id
      where lower(coalesce(pc.status, '')) in ('completed', 'expired', 'cancelled')
        and coalesce(pc.completed_at, pc.due_at, pc.created_at) < v_cutoff_120;
    end if;

    if to_regclass('public.party_challenge_rewards') is not null then
      select count(*)::integer into v_party_rewards_120
      from public.party_challenge_rewards r
      join public.party_challenges pc on pc.id = r.challenge_id
      where lower(coalesce(pc.status, '')) in ('completed', 'expired', 'cancelled')
        and coalesce(pc.completed_at, pc.due_at, pc.created_at) < v_cutoff_120;
    end if;

    if p_dry_run then
      select count(*)::integer into v_party_challenges_120
      from public.party_challenges pc
      where lower(coalesce(pc.status, '')) in ('completed', 'expired', 'cancelled')
        and coalesce(pc.completed_at, pc.due_at, pc.created_at) < v_cutoff_120;
    else
      delete from public.party_challenges pc
      where lower(coalesce(pc.status, '')) in ('completed', 'expired', 'cancelled')
        and coalesce(pc.completed_at, pc.due_at, pc.created_at) < v_cutoff_120;
      get diagnostics v_party_challenges_120 = row_count;
    end if;
  end if;
  if to_regclass('public.recovery_plans') is not null then
    if to_regclass('public.recovery_plan_steps') is not null then
      select count(*)::integer into v_recovery_steps_120
      from public.recovery_plan_steps s
      join public.recovery_plans p on p.id = s.plan_id
      where lower(coalesce(p.status, '')) in ('completed', 'abandoned', 'expired')
        and coalesce(p.completed_at, p.updated_at, p.created_at) < v_cutoff_120;
    end if;

    if p_dry_run then
      select count(*)::integer into v_recovery_plans_120
      from public.recovery_plans p
      where lower(coalesce(p.status, '')) in ('completed', 'abandoned', 'expired')
        and coalesce(p.completed_at, p.updated_at, p.created_at) < v_cutoff_120;
    else
      delete from public.recovery_plans p
      where lower(coalesce(p.status, '')) in ('completed', 'abandoned', 'expired')
        and coalesce(p.completed_at, p.updated_at, p.created_at) < v_cutoff_120;
      get diagnostics v_recovery_plans_120 = row_count;
    end if;
  end if;

  if to_regclass('public.rank_evaluations') is not null then
    if p_dry_run then
      select count(*)::integer into v_rank_evals_120
      from public.rank_evaluations re
      where re.status in ('cleared', 'failed')
        and coalesce(re.resolved_date::timestamptz, re.created_at) < v_cutoff_120;
    else
      delete from public.rank_evaluations re
      where re.status in ('cleared', 'failed')
        and coalesce(re.resolved_date::timestamptz, re.created_at) < v_cutoff_120;
      get diagnostics v_rank_evals_120 = row_count;
    end if;
  end if;

  if to_regclass('public.payment_verification_requests') is not null then
    if p_dry_run then
      select count(*)::integer into v_payment_closed_120
      from public.payment_verification_requests pvr
      where pvr.status in ('reviewed', 'verified', 'rejected')
        and coalesce(pvr.updated_at, pvr.created_at) < v_cutoff_120;
    else
      delete from public.payment_verification_requests pvr
      where pvr.status in ('reviewed', 'verified', 'rejected')
        and coalesce(pvr.updated_at, pvr.created_at) < v_cutoff_120;
      get diagnostics v_payment_closed_120 = row_count;
    end if;
  end if;

  if to_regclass('public.relic_logs') is not null then
    if p_dry_run then
      select count(*)::integer into v_relic_logs_120
      from public.relic_logs rl
      where rl.created_at < v_cutoff_120;
    else
      delete from public.relic_logs rl
      where rl.created_at < v_cutoff_120;
      get diagnostics v_relic_logs_120 = row_count;
    end if;
  end if;

  if to_regclass('public.relic_code_redemptions') is not null then
    if p_dry_run then
      select count(*)::integer into v_relic_code_redemptions_120
      from public.relic_code_redemptions rcr
      where rcr.redeemed_at < v_cutoff_120;
    else
      delete from public.relic_code_redemptions rcr
      where rcr.redeemed_at < v_cutoff_120;
      get diagnostics v_relic_code_redemptions_120 = row_count;
    end if;
  end if;

  if to_regclass('public.discipline_relic_effects') is not null then
    if p_dry_run then
      select count(*)::integer into v_relic_effects_120
      from public.discipline_relic_effects dre
      where lower(coalesce(dre.status, '')) in ('consumed', 'expired', 'cancelled')
        and coalesce(dre.updated_at, dre.expires_at, dre.created_at) < v_cutoff_120;
    else
      delete from public.discipline_relic_effects dre
      where lower(coalesce(dre.status, '')) in ('consumed', 'expired', 'cancelled')
        and coalesce(dre.updated_at, dre.expires_at, dre.created_at) < v_cutoff_120;
      get diagnostics v_relic_effects_120 = row_count;
    end if;
  end if;

  if to_regclass('public.security_exploit_states') is not null then
    if p_dry_run then
      select count(*)::integer into v_security_exploit_states_120
      from public.security_exploit_states ses
      where (ses.resolved = true or lower(coalesce(ses.status, '')) = 'resolved')
        and coalesce(ses.resolved_at, ses.created_at) < v_cutoff_120;
    else
      delete from public.security_exploit_states ses
      where (ses.resolved = true or lower(coalesce(ses.status, '')) = 'resolved')
        and coalesce(ses.resolved_at, ses.created_at) < v_cutoff_120;
      get diagnostics v_security_exploit_states_120 = row_count;
    end if;
  end if;

  if to_regclass('public.weekly_personal_insights') is not null then
    if p_dry_run then
      select count(*)::integer into v_insights_180
      from public.weekly_personal_insights w
      where coalesce(w.generated_at, w.updated_at, w.week_end::timestamptz) < v_cutoff_180;
    else
      delete from public.weekly_personal_insights w
      where coalesce(w.generated_at, w.updated_at, w.week_end::timestamptz) < v_cutoff_180;
      get diagnostics v_insights_180 = row_count;
    end if;
  end if;

  if to_regclass('public.community_submissions') is not null then
    if p_dry_run then
      select count(*)::integer into v_community_submissions_180
      from public.community_submissions cs
      where cs.status in ('reviewed', 'resolved')
        and coalesce(cs.updated_at, cs.created_at) < v_cutoff_180;
    else
      delete from public.community_submissions cs
      where cs.status in ('reviewed', 'resolved')
        and coalesce(cs.updated_at, cs.created_at) < v_cutoff_180;
      get diagnostics v_community_submissions_180 = row_count;
    end if;
  end if;

  if to_regclass('public.admin_audit_logs') is not null then
    if p_dry_run then
      select count(*)::integer into v_admin_audit_180
      from public.admin_audit_logs aal
      where aal.created_at < v_cutoff_180;
    else
      delete from public.admin_audit_logs aal
      where aal.created_at < v_cutoff_180;
      get diagnostics v_admin_audit_180 = row_count;
    end if;
  end if;

  if to_regclass('public.announcements') is not null then
    if p_dry_run then
      select count(*)::integer into v_announcements_180
      from public.announcements a
      where (a.active = false or (a.expires_at is not null and a.expires_at < v_now))
        and coalesce(a.expires_at, a.created_at) < v_cutoff_180;
    else
      delete from public.announcements a
      where (a.active = false or (a.expires_at is not null and a.expires_at < v_now))
        and coalesce(a.expires_at, a.created_at) < v_cutoff_180;
      get diagnostics v_announcements_180 = row_count;
    end if;
  end if;

  if to_regclass('public.retention_job_runs') is not null then
    if p_dry_run then
      select count(*)::integer into v_retention_logs_180
      from public.retention_job_runs r
      where r.ran_at < v_cutoff_180;
    else
      delete from public.retention_job_runs r
      where r.ran_at < v_cutoff_180;
      get diagnostics v_retention_logs_180 = row_count;
    end if;
  end if;

  v_summary := jsonb_build_object(
    'policy_version', '2026-03-20-tight-safe-limits-v1',
    'ran_at', v_now,
    'dry_run', p_dry_run,
    'cutoffs', jsonb_build_object(
      'days_7', v_cutoff_7,
      'days_14', v_cutoff_14,
      'days_30', v_cutoff_30,
      'days_45', v_cutoff_45,
      'days_90', v_cutoff_90,
      'days_120', v_cutoff_120,
      'days_180', v_cutoff_180
    ),
    'compacted', jsonb_build_object(
      'activity_logs_metadata_7_to_45d', v_compact_activity_7_45,
      'xp_logs_metadata_30_to_120d', v_compact_xp_meta_30_120,
      'payment_verification_text_30_to_120d', v_compact_payment_text_30_120,
      'community_submissions_text_30_to_180d', v_compact_community_submission_30_180,
      'admin_audit_logs_metadata_30_to_180d', v_compact_admin_audit_30_180
    ),
    'deleted', jsonb_build_object(
      'community_chat_messages_14d', v_chat_14,
      'admin_login_attempts_14d', v_admin_attempts_14,
      'relic_redeem_attempts_14d', v_relic_attempts_14,
      'dungeon_party_invites_pending_14d', v_party_invites_pending_14,
      'admin_sessions_30d', v_admin_sessions_30,
      'payment_verification_pending_30d', v_payment_pending_30,
      'friend_requests_pending_30d', v_friend_requests_pending_30,
      'activity_logs_45d', v_activity_45,
      'interruptions_45d', v_interruptions_45,
      'focus_sessions_terminal_45d', v_focus_45,
      'task_deadline_failures_45d', v_task_failures_45,
      'dungeon_party_invites_terminal_45d', v_party_invites_terminal_45,
      'web_push_subscriptions_inactive_90d', v_web_push_inactive_90,
      'friend_requests_terminal_90d', v_friend_requests_terminal_90,
      'xp_logs_120d', v_xp_120,
      'habit_logs_120d', v_habit_logs_120,
      'user_quests_terminal_120d', v_user_quests_120,
      'punishments_closed_120d', v_punishments_120,
      'dungeon_runs_terminal_120d', v_dungeon_runs_120,
      'party_challenges_terminal_120d', v_party_challenges_120,
      'party_challenge_contributions_cascade_120d', v_party_contrib_120,
      'party_challenge_rewards_cascade_120d', v_party_rewards_120,
      'recovery_plans_terminal_120d', v_recovery_plans_120,
      'recovery_plan_steps_cascade_120d', v_recovery_steps_120,
      'rank_evaluations_terminal_120d', v_rank_evals_120,
      'payment_verification_closed_120d', v_payment_closed_120,
      'relic_logs_120d', v_relic_logs_120,
      'relic_code_redemptions_120d', v_relic_code_redemptions_120,
      'discipline_relic_effects_terminal_120d', v_relic_effects_120,
      'security_exploit_states_resolved_120d', v_security_exploit_states_120,
      'weekly_personal_insights_180d', v_insights_180,
      'community_submissions_closed_180d', v_community_submissions_180,
      'admin_audit_logs_180d', v_admin_audit_180,
      'announcements_expired_180d', v_announcements_180,
      'retention_job_runs_180d', v_retention_logs_180
    ),
    'total_compacted', (
      v_compact_activity_7_45
      + v_compact_xp_meta_30_120
      + v_compact_payment_text_30_120
      + v_compact_community_submission_30_180
      + v_compact_admin_audit_30_180
    ),
    'total_deleted', (
      v_chat_14
      + v_admin_attempts_14
      + v_relic_attempts_14
      + v_party_invites_pending_14
      + v_admin_sessions_30
      + v_payment_pending_30
      + v_friend_requests_pending_30
      + v_activity_45
      + v_interruptions_45
      + v_focus_45
      + v_task_failures_45
      + v_party_invites_terminal_45
      + v_web_push_inactive_90
      + v_friend_requests_terminal_90
      + v_xp_120
      + v_habit_logs_120
      + v_user_quests_120
      + v_punishments_120
      + v_dungeon_runs_120
      + v_party_challenges_120
      + v_recovery_plans_120
      + v_rank_evals_120
      + v_payment_closed_120
      + v_relic_logs_120
      + v_relic_code_redemptions_120
      + v_relic_effects_120
      + v_security_exploit_states_120
      + v_insights_180
      + v_community_submissions_180
      + v_admin_audit_180
      + v_announcements_180
      + v_retention_logs_180
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
        null;
    end;
  end if;
end;
$$;

notify pgrst, 'reload schema';
