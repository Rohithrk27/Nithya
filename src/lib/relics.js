import { supabase } from '@/lib/supabase';

const firstRow = (data) => (Array.isArray(data) ? (data[0] || null) : (data || null));
export const RELIC_MAX_BALANCE = 20;
const RELIC_AWARD_SOFT_FAILURES = [
  'weekly streak requirement not met',
  'weekly 120% target requirement not met',
  'shadow debt is not cleared',
  'dungeon interruption-free completion not verified',
  'group bet still active',
  'relic cap reached',
];

const toSafeMetadata = (metadata) => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  return metadata;
};

export async function fetchRelicInventory(userId) {
  if (!userId) return [];
  const { data, error } = await supabase.rpc('get_relic_inventory', {
    p_user_id: userId,
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function fetchRelicBalance(userId) {
  if (!userId) return 0;
  const rpcRes = await supabase.rpc('get_relic_balance', {
    p_user_id: userId,
  });
  if (!rpcRes.error) return Math.max(0, Number(rpcRes.data || 0));

  const fallback = await supabase
    .from('discipline_relics')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('used', false)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  if (fallback.error) throw rpcRes.error;
  return Math.max(0, Number(fallback.count || 0));
}

export async function fetchActiveRelicEffects(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('discipline_relic_effects')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('expires_at', { ascending: true });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function awardRelicRpc({
  userId,
  source,
  eventId = null,
  metadata = {},
}) {
  if (!userId || !source) throw new Error('Missing relic award inputs');
  const { data, error } = await supabase.rpc('award_relic', {
    p_user_id: userId,
    p_source: source,
    p_event_id: eventId || null,
    p_metadata: toSafeMetadata(metadata),
  });
  if (error) throw error;
  return firstRow(data);
}

export function isRelicAwardSoftFailure(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  if (!msg) return false;
  return RELIC_AWARD_SOFT_FAILURES.some((needle) => msg.includes(needle));
}

export async function maybeAwardRelic(params) {
  try {
    const row = await awardRelicRpc(params);
    return {
      awarded: Boolean(row?.success),
      reason: row?.reason || null,
      relicId: row?.relic_id || null,
      relicCount: Number(row?.relic_count || 0),
      row,
    };
  } catch (error) {
    if (isRelicAwardSoftFailure(error)) {
      return {
        awarded: false,
        reason: 'not_eligible',
        relicId: null,
        relicCount: 0,
        row: null,
      };
    }
    throw error;
  }
}

export async function redeemRelicAction({
  userId,
  relicId,
  action,
  referenceId = null,
}) {
  if (!userId || !relicId || !action) throw new Error('Missing relic redemption inputs');
  const { data, error } = await supabase.rpc('redeem_relic', {
    p_user_id: userId,
    p_relic_id: relicId,
    p_action: action,
    p_reference_id: referenceId || null,
  });
  if (error) throw error;
  return firstRow(data);
}

export async function redeemRelicCode({ userId, code }) {
  if (!userId) throw new Error('Missing user id');
  const normalized = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!normalized) throw new Error('Enter a valid code');
  const { data, error } = await supabase.rpc('redeem_relic_code', {
    p_user_id: userId,
    p_code: normalized,
  });
  if (error) throw error;
  return firstRow(data);
}

export function relicExpiryMs(relic, now = Date.now()) {
  const raw = relic?.expires_at;
  if (!raw) return Number.POSITIVE_INFINITY;
  const ts = new Date(raw).getTime();
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, ts - now);
}

export function formatRelicCountdown(ms) {
  if (!Number.isFinite(ms)) return 'No expiry';
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function mapRedeemCodeError(errorCode) {
  const code = String(errorCode || '').toLowerCase();
  if (code === 'code_expired') return 'This code has expired.';
  if (code === 'usage_limit_reached') return 'Usage limit reached for this code.';
  if (code === 'invalid_code') return 'Invalid code.';
  if (code === 'code_inactive') return 'This code is inactive.';
  if (code === 'relic_cap_reached') return `Relic cap reached (${RELIC_MAX_BALANCE}). Use or expire relics before redeeming.`;
  if (code === 'rate_limited') return 'Too many attempts. Wait a minute and try again.';
  if (code === 'invalid_code_config') return 'Code configuration is invalid.';
  return 'Unable to redeem this code right now.';
}
