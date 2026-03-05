import { supabase } from '@/lib/supabase';
import { punishmentRefusalPenalty } from '@/components/gameEngine';

const DEFAULT_PUNISHMENT_HOURS = 24;
const MIN_PUNISHMENT_HOURS = 1;
const MAX_PUNISHMENT_HOURS = 24;

const firstRow = (data) => (Array.isArray(data) ? (data[0] || null) : (data || null));
const isMissedLikeLog = (row) => {
  const status = String(row?.status || '').trim().toLowerCase();
  return status === 'missed' || status === 'failed';
};
const rowDateKey = (row) => (
  row?.date
  || row?.logged_at
  || row?.completed_at
  || row?.created_at
  || ''
).toString().slice(0, 10);
const toLocalDateKey = (value = new Date()) => {
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};
const parseDateKey = (value) => {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00`);
  if (!Number.isFinite(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
};
const listDateKeysInclusive = (startKey, endKey) => {
  const start = parseDateKey(startKey);
  const end = parseDateKey(endKey);
  if (!start || !end || start > end) return [];
  const keys = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    keys.push(toLocalDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
};
const getYesterdayLocalDateKey = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - 1);
  return toLocalDateKey(d);
};

export function clampPunishmentHours(value, fallback = DEFAULT_PUNISHMENT_HOURS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return clampPunishmentHours(fallback, DEFAULT_PUNISHMENT_HOURS);
  return Math.max(MIN_PUNISHMENT_HOURS, Math.min(MAX_PUNISHMENT_HOURS, Math.round(parsed)));
}

export function getPunishmentConfiguredHours(punishment, fallback = DEFAULT_PUNISHMENT_HOURS) {
  const safeFallback = clampPunishmentHours(fallback, DEFAULT_PUNISHMENT_HOURS);
  if (!punishment) return safeFallback;

  const startMs = new Date(punishment.started_at || punishment.created_at || 0).getTime();
  const endMs = new Date(punishment.expires_at || 0).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return safeFallback;

  const hours = Math.ceil((endMs - startMs) / (60 * 60 * 1000));
  return clampPunishmentHours(hours, safeFallback);
}

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
  timeLimitHours = DEFAULT_PUNISHMENT_HOURS,
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
  let logsData = Array.isArray(logs) ? [...logs] : [];

  // Bridge inferred misses (analytics) into concrete logs so punishments can be generated.
  const yesterdayKey = getYesterdayLocalDateKey();
  if (yesterdayKey && habitsData.length > 0) {
    const existingLogKeys = new Set(
      logsData
        .map((row) => {
          const dayKey = rowDateKey(row);
          return row?.habit_id && dayKey ? `${row.habit_id}:${dayKey}` : '';
        })
        .filter(Boolean)
    );
    const historicalMissingLogs = [];

    habitsData
      .filter((habit) => Boolean(habit?.id) && Boolean(habit?.punishment_text))
      .forEach((habit) => {
        const createdKey = rowDateKey(habit) || yesterdayKey;
        const dayKeys = listDateKeysInclusive(createdKey, yesterdayKey);
        dayKeys.forEach((dayKey) => {
          const pairKey = `${habit.id}:${dayKey}`;
          if (existingLogKeys.has(pairKey)) return;
          existingLogKeys.add(pairKey);
          historicalMissingLogs.push({
            user_id: userId,
            habit_id: habit.id,
            status: 'failed',
            date: dayKey,
            failed: true,
          });
        });
      });

    if (historicalMissingLogs.length > 0) {
      const batchSize = 500;
      let supportsFailedColumn = true;
      const insertedLogs = [];

      for (let start = 0; start < historicalMissingLogs.length; start += batchSize) {
        const slice = historicalMissingLogs.slice(start, start + batchSize);
        let payload = slice;
        if (!supportsFailedColumn) {
          payload = slice.map(({ failed, ...row }) => row);
        }

        let insertRes = await supabase.from('habit_logs').insert(payload).select('*');
        if (insertRes.error && supportsFailedColumn) {
          const maybeMissingFailedColumn = String(insertRes.error?.message || '').toLowerCase().includes('failed');
          if (maybeMissingFailedColumn) {
            supportsFailedColumn = false;
            payload = slice.map(({ failed, ...row }) => row);
            insertRes = await supabase.from('habit_logs').insert(payload).select('*');
          }
        }

        if (insertRes.error) throw insertRes.error;
        insertedLogs.push(...(insertRes.data || []));
      }

      if (insertedLogs.length > 0) {
        logsData = [...logsData, ...insertedLogs];
      }
    }
  }

  const habitMap = new Map(habitsData.map((h) => [h.id, h]));
  const punishmentLogIds = new Set(allPunishments.map((p) => p.habit_log_id).filter(Boolean));
  const ttlMs = clampPunishmentHours(timeLimitHours, DEFAULT_PUNISHMENT_HOURS) * 60 * 60 * 1000;

  const missingPunishments = logsData
    .filter((l) => isMissedLikeLog(l))
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

export async function configurePunishmentTimer({
  userId,
  punishmentId,
  hours,
  source = 'punishment_timer_configured',
}) {
  if (!userId || !punishmentId) throw new Error('Missing punishment identifiers');
  const safeHours = clampPunishmentHours(hours, DEFAULT_PUNISHMENT_HOURS);
  const startedAt = new Date();
  const expiresAt = new Date(startedAt.getTime() + (safeHours * 60 * 60 * 1000));

  const { data, error } = await supabase
    .from('punishments')
    .update({
      started_at: startedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      warning_notified: false,
      urgency_notified: false,
      action_taken: source || 'punishment_timer_configured',
      status: 'pending',
      resolved: false,
      penalty_applied: false,
      resolved_at: null,
    })
    .eq('user_id', userId)
    .eq('id', punishmentId)
    .eq('resolved', false)
    .select('*')
    .single();

  if (error) throw error;
  return data || null;
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
