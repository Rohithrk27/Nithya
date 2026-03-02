import { supabase } from '@/lib/supabase';
import { logActivityEvent } from '@/lib/activity';

const firstRow = (data) => (Array.isArray(data) ? (data[0] || null) : (data || null));
const toSafeInt = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
};

const toSafeMetadata = (metadata) => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  return metadata;
};

export async function syncDailyStreak(userId) {
  if (!userId) return 0;
  const { data, error } = await supabase.rpc('sync_daily_streak', { p_user_id: userId });
  if (error) throw error;
  return toSafeInt(data, 0);
}

export async function awardXpRpc({
  userId,
  xpAmount,
  source = 'manual',
  eventId = null,
  metadata = {},
}) {
  if (!userId) throw new Error('Missing user id for awardXpRpc');
  const safeXp = Math.max(0, toSafeInt(xpAmount, 0));
  const { data, error } = await supabase.rpc('award_xp', {
    p_user_id: userId,
    p_xp_amount: safeXp,
    p_source: source || 'manual',
    p_event_id: eventId || null,
    p_metadata: toSafeMetadata(metadata),
  });
  if (error) throw error;
  const row = firstRow(data);
  void logActivityEvent({
    userId,
    type: 'xp_reward',
    metadata: {
      source: source || 'manual',
      xp_amount: safeXp,
      event_id: eventId || null,
      ...(metadata || {}),
    },
  });
  return row;
}

export async function penaltyXpRpc({
  userId,
  xpAmount,
  source = 'penalty',
  shadowDebtAmount = null,
  eventId = null,
  metadata = {},
}) {
  if (!userId) throw new Error('Missing user id for penaltyXpRpc');
  const safeXp = Math.max(0, Math.abs(toSafeInt(xpAmount, 0)));
  const safeDebt = shadowDebtAmount === null ? null : Math.max(0, toSafeInt(shadowDebtAmount, 0));
  const payload = {
    p_user_id: userId,
    p_xp_amount: safeXp,
    p_reason: source || 'penalty',
    p_shadow_debt_amount: safeDebt,
    p_related_id: eventId || null,
    p_metadata: toSafeMetadata(metadata),
  };

  const deductRes = await supabase.rpc('deduct_xp', payload);
  if (!deductRes.error) {
    void logActivityEvent({
      userId,
      type: 'xp_penalty',
      metadata: {
        source: source || 'penalty',
        xp_amount: safeXp,
        event_id: eventId || null,
        ...(metadata || {}),
      },
    });
    return firstRow(deductRes.data);
  }

  const legacyRes = await supabase.rpc('penalty_xp', {
    p_user_id: userId,
    p_xp_amount: safeXp,
    p_source: source || 'penalty',
    p_shadow_debt_amount: safeDebt,
    p_event_id: eventId || null,
    p_metadata: toSafeMetadata(metadata),
  });
  if (legacyRes.error) throw legacyRes.error;
  void logActivityEvent({
    userId,
    type: 'xp_penalty',
    metadata: {
      source: source || 'penalty',
      xp_amount: safeXp,
      event_id: eventId || null,
      ...(metadata || {}),
    },
  });
  return firstRow(legacyRes.data);
}

export function applyProgressionSnapshot(profile, systemState, snapshot) {
  if (!snapshot) {
    return { nextProfile: profile, nextSystemState: systemState };
  }

  const profilePatch = {
    total_xp: snapshot.total_xp,
    current_xp: snapshot.current_xp,
    level: snapshot.level,
    stat_points: snapshot.stat_points,
    daily_streak: snapshot.daily_streak,
    last_active_date: snapshot.last_active_date,
  };

  const nextProfile = profile ? { ...profile, ...profilePatch } : profile;
  const nextSystemState = systemState
    ? { ...systemState, shadow_debt_xp: snapshot.shadow_debt_xp }
    : systemState;

  return { nextProfile, nextSystemState };
}
