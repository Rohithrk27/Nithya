import { supabase } from '@/lib/supabase';

const firstRow = (data) => (Array.isArray(data) ? (data[0] || null) : (data || null));

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

export async function fetchActivePunishments(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('punishments')
    .select('*')
    .eq('user_id', userId)
    .eq('resolved', false)
    .eq('penalty_applied', false)
    .order('expires_at', { ascending: true });
  if (error) throw error;
  return data || [];
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
