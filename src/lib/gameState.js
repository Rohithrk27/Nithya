import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { supabase } from '@/lib/supabase';

const ACTIVE_QUEST_STATUSES = ['active', 'in_progress', 'in progress', 'in-progress', 'accepted', 'inprogress', 'ongoing', 'started', 'start'];

const todayDateKey = () => format(new Date(), 'yyyy-MM-dd');

const selectActiveDungeonQuery = (userId) => (
  supabase
    .from('dungeon_runs')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
);

export async function fetchActiveDungeonRun(userId) {
  if (!userId) return null;
  const { data, error } = await selectActiveDungeonQuery(userId);
  if (error) throw error;
  return data || null;
}

export async function fetchActiveWeeklyQuest(userId) {
  if (!userId) return null;
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const isRowActiveNow = (row) => {
    if (!row) return false;
    const status = String(row.status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (!['active', 'in_progress', 'accepted', 'inprogress', 'ongoing', 'started', 'start'].includes(status)) {
      return false;
    }
    if (!row.expires_at) {
      const questType = String(row.quest_type || '').trim().toLowerCase();
      if (questType === 'weekly') {
        const startedMs = row.started_at ? new Date(row.started_at).getTime() : Number.NaN;
        if (Number.isFinite(startedMs)) return (startedMs + WEEK_MS) > Date.now();
        return false;
      }
      return true;
    }
    const expiresMs = new Date(row.expires_at).getTime();
    if (Number.isNaN(expiresMs)) return true;
    return expiresMs > Date.now();
  };

  const { data, error } = await supabase
    .from('user_quests')
    .select('id, user_id, quest_id, status, created_at, completed_date, quest_type, started_at, expires_at, failed, xp_reward, penalty_applied')
    .eq('user_id', userId)
    .in('status', ACTIVE_QUEST_STATUSES)
    .eq('quest_type', 'weekly')
    .order('created_at', { ascending: false })
    .limit(25);
  if (error && !String(error.message || '').toLowerCase().includes('quest_type')) {
    throw error;
  }
  const freshDirect = (data || []).find(isRowActiveNow) || null;
  if (freshDirect) return freshDirect;

  // Fallback for older rows where quest_type is missing or not populated.
  const { data: activeRows, error: activeError } = await supabase
    .from('user_quests')
    .select('id, user_id, quest_id, status, created_at, completed_date, started_at, expires_at, failed, xp_reward, penalty_applied')
    .eq('user_id', userId)
    .in('status', ACTIVE_QUEST_STATUSES)
    .order('created_at', { ascending: false })
    .limit(25);
  if (activeError) throw activeError;
  const freshActiveRows = (activeRows || []).filter(isRowActiveNow);
  if (!freshActiveRows.length) return null;

  const questIds = freshActiveRows.map((row) => row.quest_id).filter(Boolean);
  if (!questIds.length) return null;
  const { data: weeklyQuests, error: weeklyError } = await supabase
    .from('quests')
    .select('id')
    .in('id', questIds)
    .eq('type', 'weekly');
  if (weeklyError) throw weeklyError;

  const weeklyIds = new Set((weeklyQuests || []).map((q) => q.id));
  return freshActiveRows.find((row) => weeklyIds.has(row.quest_id) && isRowActiveNow({ ...row, quest_type: 'weekly' })) || null;
}

export function getQuestRemainingMs(questRow, now = new Date()) {
  if (!questRow) return 0;
  const expiryRaw = questRow.expires_at || questRow.expires_date || null;
  if (!expiryRaw) return 0;
  const expiresAt = new Date(expiryRaw);
  if (Number.isNaN(expiresAt.getTime())) return 0;
  return Math.max(0, expiresAt.getTime() - now.getTime());
}

export function formatCountdown(ms) {
  const safe = Math.max(0, Number(ms || 0));
  const totalSeconds = Math.floor(safe / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) {
    return `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`;
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export async function activateUserQuest({ userId, questId, startedAt = null }) {
  if (!userId || !questId) return null;
  const { data, error } = await supabase.rpc('activate_user_quest', {
    p_user_id: userId,
    p_quest_id: questId,
    p_started_at: startedAt || new Date().toISOString(),
  });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

export async function resolveExpiredQuests({ userId, source = 'quest_timeout', decayFactor = 0.5 }) {
  if (!userId) return null;
  const { data, error } = await supabase.rpc('resolve_expired_quests', {
    p_user_id: userId,
    p_source: source,
    p_decay_factor: decayFactor,
  });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

export async function resolveExpiredPunishments({ userId, source = 'punishment_timeout' }) {
  if (!userId) return null;
  const { data, error } = await supabase.rpc('resolve_expired_punishments', {
    p_user_id: userId,
    p_source: source,
  });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

export async function repairUserQuestState({ userId }) {
  if (!userId) return null;
  const { data, error } = await supabase.rpc('repair_user_quest_state', {
    p_user_id: userId,
  });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

export async function ensureInterruptRecord({ userId, interruptEvent, today = todayDateKey() }) {
  if (!userId || !interruptEvent?.code) return null;
  const { data: unresolved, error: unresolvedError } = await supabase
    .from('interruptions')
    .select('*')
    .eq('user_id', userId)
    .is('interruption_end', null)
    .in('status', ['active', 'penalized', 'paused'])
    .order('interruption_start', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (unresolvedError) throw unresolvedError;
  if (unresolved) return unresolved;

  const { data: existing, error: readError } = await supabase
    .from('interruptions')
    .select('*')
    .eq('user_id', userId)
    .eq('interruption_code', interruptEvent.code)
    .eq('event_date', today)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (readError) throw readError;
  if (existing) return existing;

  const { data: created, error: insertError } = await supabase
    .from('interruptions')
    .insert({
      user_id: userId,
      interruption_code: interruptEvent.code,
      status: 'paused',
      interruption_start: new Date().toISOString(),
      grace_hours: 6,
      grace_period_hours: 3,
      full_penalty_hours: 24,
      reward_xp: interruptEvent.rewardXp || 0,
      penalty_xp: interruptEvent.penaltyXp || 0,
      payload: {
        title: interruptEvent.title,
        description: interruptEvent.description,
        stat_reward: interruptEvent.statReward || null,
      },
    })
    .select('*')
    .single();

  if (insertError) throw insertError;
  return created;
}

export function getInterruptRemainingMs(interruptionRow, now = new Date()) {
  if (!interruptionRow) return 0;
  const startRaw = interruptionRow.interruption_start || interruptionRow.started_at;
  if (!startRaw) return 0;
  const startedAt = new Date(startRaw);
  if (Number.isNaN(startedAt.getTime())) return 0;
  const graceHours = Number(interruptionRow.grace_period_hours || interruptionRow.grace_hours || 3);
  const timeoutAtMs = startedAt.getTime() + (graceHours * 60 * 60 * 1000);
  return Math.max(0, timeoutAtMs - now.getTime());
}

export function getInterruptDurationMs(interruptionRow, now = new Date()) {
  if (!interruptionRow) return 0;
  const startRaw = interruptionRow.interruption_start || interruptionRow.started_at;
  if (!startRaw) return 0;
  const startedAt = new Date(startRaw);
  if (Number.isNaN(startedAt.getTime())) return 0;
  return Math.max(0, now.getTime() - startedAt.getTime());
}

export function getDungeonProgress(run) {
  if (!run) return { totalDays: 0, elapsedDays: 0, daysLeft: 0, pct: 0 };
  const totalDays = Math.max(1, Number(run.duration_days || 1));
  const parsedStart = run.start_date ? parseISO(run.start_date) : new Date();
  const start = Number.isNaN(parsedStart.getTime()) ? new Date() : parsedStart;
  const elapsedDays = Math.max(0, differenceInCalendarDays(new Date(), start) + 1);
  const daysLeft = Math.max(0, totalDays - elapsedDays);
  const pct = Math.min(100, Math.max(0, (elapsedDays / totalDays) * 100));
  return { totalDays, elapsedDays, daysLeft, pct };
}

export async function reduceActiveDungeonStability({ userId, amount, reason = 'interrupt' }) {
  if (!userId) return { run: null, failed: false };
  const safeAmount = Math.max(0, Number(amount || 0));
  if (safeAmount <= 0) return { run: null, failed: false };

  const { data: activeRun, error: fetchError } = await selectActiveDungeonQuery(userId);
  if (fetchError) throw fetchError;
  if (!activeRun) return { run: null, failed: false };

  const currentStability = Number(activeRun.stability ?? 100);
  const nextStability = Math.max(0, currentStability - safeAmount);
  const progress = getDungeonProgress(activeRun);
  const failed = nextStability <= 0;

  const updatePayload = {
    stability: nextStability,
    interruptions_count: Number(activeRun.interruptions_count || 0) + 1,
    ...(failed ? {
      status: 'failed',
      end_date: todayDateKey(),
      completed_days: progress.elapsedDays,
      xp_reward: Number(activeRun.xp_reward || 0),
      xp_penalty: Number(activeRun.xp_penalty || 0),
    } : {}),
  };

  const { data: updatedRun, error: updateError } = await supabase
    .from('dungeon_runs')
    .update(updatePayload)
    .eq('id', activeRun.id)
    .eq('user_id', userId)
    .eq('status', 'active')
    .select('*')
    .single();

  if (updateError && !updateError.message?.includes('0 rows')) {
    throw updateError;
  }

  return {
    run: updatedRun || { ...activeRun, ...updatePayload, stability: nextStability, status: failed ? 'failed' : 'active' },
    failed,
    reason,
  };
}
