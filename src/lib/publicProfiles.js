import { supabase } from '@/lib/supabase';

const firstRow = (data) => (Array.isArray(data) ? (data[0] || null) : (data || null));

export async function refreshPublicProfile(userId) {
  if (!userId) throw new Error('Missing user id');
  const { data, error } = await supabase.rpc('refresh_public_profile', {
    p_user_id: userId,
  });
  if (error) throw error;
  return firstRow(data);
}

export async function setPublicProfileVisibility({ userId, isPublic }) {
  if (!userId) throw new Error('Missing user id');
  const { data, error } = await supabase.rpc('set_public_profile_visibility', {
    p_user_id: userId,
    p_is_public: !!isPublic,
  });
  if (error) throw error;
  return firstRow(data);
}

export async function fetchOwnPublicProfile(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('public_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function fetchPublicProfileByUsername(username) {
  const normalized = (username || '').toString().trim().toLowerCase();
  if (!normalized) return null;
  const preferred = await supabase
    .from('public_profiles')
    .select('user_id,username,name,user_code,avatar_url,level,total_xp,stat_distribution,dungeon_achievements,streak_count,is_public')
    .eq('username', normalized)
    .eq('is_public', true)
    .maybeSingle();
  if (!preferred.error) return preferred.data || null;

  const msg = String(preferred.error?.message || '').toLowerCase();
  if (!msg.includes('name')) throw preferred.error;

  const fallback = await supabase
    .from('public_profiles')
    .select('user_id,username,user_code,avatar_url,level,total_xp,stat_distribution,dungeon_achievements,streak_count,is_public')
    .eq('username', normalized)
    .eq('is_public', true)
    .maybeSingle();
  if (fallback.error) throw fallback.error;
  return fallback.data || null;
}

export async function fetchPublicProfileRank(username) {
  const normalized = (username || '').toString().trim().toLowerCase();
  if (!normalized) return null;

  const rpcRes = await supabase.rpc('get_public_profile_rank', {
    p_username: normalized,
  });
  if (!rpcRes.error) {
    const row = firstRow(rpcRes.data);
    const rank = Number(row?.rank_position || 0);
    return Number.isFinite(rank) && rank > 0 ? rank : null;
  }

  const rpcErrorText = String(rpcRes.error?.message || '').toLowerCase();
  const rpcMissing = rpcErrorText.includes('get_public_profile_rank')
    || rpcErrorText.includes('function public.get_public_profile_rank');
  if (!rpcMissing) throw rpcRes.error;

  // Backward-compatible fallback if RPC isn't deployed yet.
  const { data: targetRow, error: targetError } = await supabase
    .from('public_profiles')
    .select('user_id,total_xp,level')
    .eq('username', normalized)
    .eq('is_public', true)
    .maybeSingle();
  if (targetError) throw targetError;
  if (!targetRow?.user_id) return null;

  const xp = Number(targetRow.total_xp || 0);
  const level = Number(targetRow.level || 0);
  const userId = String(targetRow.user_id);
  const rankFilter = `total_xp.gt.${xp},and(total_xp.eq.${xp},level.gt.${level}),and(total_xp.eq.${xp},level.eq.${level},user_id.lt.${userId})`;

  const { count, error: countError } = await supabase
    .from('public_profiles')
    .select('user_id', { head: true, count: 'exact' })
    .eq('is_public', true)
    .or(rankFilter);
  if (countError) throw countError;

  return Number(count || 0) + 1;
}

const APP_PROFILE_DEEP_LINK_BASE = 'com.rohith.nithya://profile';

const trimTrailingSlash = (value) => String(value || '').replace(/\/+$/, '');
const isNativePlatform = () => (
  typeof window !== 'undefined'
  && typeof window?.Capacitor?.isNativePlatform === 'function'
  && window.Capacitor.isNativePlatform()
);

const normalizeUsername = (value) => String(value || '').trim();
const encodeUsername = (value) => {
  const normalized = normalizeUsername(value);
  if (!normalized) return '';
  try {
    return encodeURIComponent(decodeURIComponent(normalized));
  } catch (_) {
    return encodeURIComponent(normalized);
  }
};

export function getPublicProfileShareUrl(username) {
  const safe = encodeUsername(username);
  if (!safe) return '';
  if (isNativePlatform()) {
    return `${APP_PROFILE_DEEP_LINK_BASE}/${safe}`;
  }
  const configuredBase = trimTrailingSlash(import.meta?.env?.VITE_PUBLIC_WEB_URL);
  const runtimeBase = typeof window !== 'undefined' ? trimTrailingSlash(window.location.origin) : '';
  const base = configuredBase || runtimeBase;
  if (!base) return '';
  return `${base}/profile/${safe}`;
}

