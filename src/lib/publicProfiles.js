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

export function getPublicProfileShareUrl(username) {
  if (!username) return '';
  const safe = encodeURIComponent(username);
  return `${window.location.origin}/profile/${safe}`;
}

