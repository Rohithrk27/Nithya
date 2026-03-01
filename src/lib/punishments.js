import { supabase } from '@/lib/supabase';
import { punishmentRefusalPenalty } from '@/components/gameEngine';

const firstRow = (data) => (Array.isArray(data) ? (data[0] || null) : (data || null));

export function isOpenPunishment(row) {
  if (!row) return false;
  if (row.resolved || row.penalty_applied) return false;
  if (row.status === 'completed' || row.status === 'timed_out' || row.status === 'refused') return false;
  return true;
}

export function getPunishmentRemainingMs(punishment, now = Date.now()) {
  if (!punishment) return 0;
  const expiresRaw = punishment.expires_at || null;
  if (!expiresRaw) return 0;
  const expiry = new Date(expiresRaw).getTime();
  if (!Number.isFinite(expiry)) return 0;
  return Math.max(0, expiry - now);
}

export function getPunishmentProjectedLoss(punishment) {
  const raw = Number(punishment?.total_xp_penalty ?? punishment?.accumulated_penalty ?? 0);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.floor(raw));
}

export async function ensurePendingPunishmentsForMissedHabits({
  userId,
  profile,
  habits,
  logs,
  punishments,
  timeLimitHours = 8,
}) {
  if (!userId) return [];

  let allPunishments = Array.isArray(punishments) ? punishments : [];
  if (!Array.isArray(punishments)) {
    const { data, error } = await supabase
      .from('punishments')
      .select('*')
      .eq('user_id', userId);
    if (error) throw error;
    allPunishments = data || [];
  }

  const habitsData = Array.isArray(habits) ? habits : [];
  const logsData = Array.isArray(logs) ? logs : [];
  const habitMap = new Map(habitsData.map((h) => [h.id, h]));
  const punishmentLogIds = new Set(allPunishments.map((p) => p.habit_log_id).filter(Boolean));
  const ttlMs = Math.max(1, Number(timeLimitHours) || 8) * 60 * 60 * 1000;

  const missingPunishments = logsData
    .filter((l) => l.status === 'missed')
    .filter((l) => !punishmentLogIds.has(l.id))
    .map((l) => {
      const habit = habitMap.get(l.habit_id);
      if (!habit?.punishment_text) return null;
      const penaltyEstimate = punishmentRefusalPenalty(profile || null, habit?.punishment_xp_penalty_pct || 10);
      const startIso = new Date().toISOString();
      const expiryIso = new Date(Date.now() + ttlMs).toISOString();
      return {
        user_id: userId,
        habit_id: habit.id,
        habit_log_id: l.id,
        status: 'pending',
        text: habit.punishment_text,
        reason: habit.punishment_text,
        total_xp_penalty: penaltyEstimate,
        accumulated_penalty: penaltyEstimate,
        started_at: startIso,
        expires_at: expiryIso,
        resolved: false,
        penalty_applied: false,
        warning_notified: false,
        urgency_notified: false,
      };
    })
    .filter(Boolean);

  if (missingPunishments.length === 0) return allPunishments;

  const { data: inserted, error: insertError } = await supabase
    .from('punishments')
    .insert(missingPunishments)
    .select('*');
  if (insertError) throw insertError;

  return [...allPunishments, ...(inserted || [])];
}

export async function fetchActivePunishments(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('punishments')
    .select('*')
    .eq('user_id', userId)
    .order('expires_at', { ascending: true });
  if (error) throw error;
  return (data || []).filter(isOpenPunishment);
}

export async function resolvePunishmentEarly({ userId, punishmentId, source = 'punishment_resolved_early' }) {
  if (!userId || !punishmentId) throw new Error('Missing punishment identifiers');
  const { data, error } = await supabase.rpc('resolve_punishment_early', {
    p_user_id: userId,
    p_punishment_id: punishmentId,
    p_source: source,
  });
  if (error) throw error;
  return firstRow(data);
}

export async function resolvePunishmentTimeouts({ userId, source = 'punishment_timeout' }) {
  if (!userId) return null;
  const { data, error } = await supabase.rpc('resolve_expired_punishments', {
    p_user_id: userId,
    p_source: source,
  });
  if (error) throw error;
  return firstRow(data);
}

export async function markPunishmentWarningNotified({ userId, punishmentId }) {
  if (!userId || !punishmentId) return;
  await supabase
    .from('punishments')
    .update({ warning_notified: true })
    .eq('user_id', userId)
    .eq('id', punishmentId)
    .eq('warning_notified', false);
}

export async function markPunishmentUrgencyNotified({ userId, punishmentId }) {
  if (!userId || !punishmentId) return;
  await supabase
    .from('punishments')
    .update({ urgency_notified: true })
    .eq('user_id', userId)
    .eq('id', punishmentId)
    .eq('urgency_notified', false);
}
