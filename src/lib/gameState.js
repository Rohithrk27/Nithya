import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { supabase } from '@/lib/supabase';

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
  const { data, error } = await supabase
    .from('user_quests')
    .select('id, user_id, quest_id, status, date, created_at, completed_date, quest_type')
    .eq('user_id', userId)
    .eq('status', 'active')
    .eq('quest_type', 'weekly')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error && !String(error.message || '').toLowerCase().includes('quest_type')) {
    throw error;
  }
  if (data) return data;

  // Fallback for older rows where quest_type is missing or not populated.
  const { data: activeRows, error: activeError } = await supabase
    .from('user_quests')
    .select('id, user_id, quest_id, status, date, created_at, completed_date')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(25);
  if (activeError) throw activeError;
  if (!activeRows?.length) return null;

  const questIds = activeRows.map((row) => row.quest_id).filter(Boolean);
  if (!questIds.length) return null;
  const { data: weeklyQuests, error: weeklyError } = await supabase
    .from('quests')
    .select('id')
    .in('id', questIds)
    .eq('type', 'weekly');
  if (weeklyError) throw weeklyError;

  const weeklyIds = new Set((weeklyQuests || []).map((q) => q.id));
  return activeRows.find((row) => weeklyIds.has(row.quest_id)) || null;
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
