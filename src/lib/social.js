import { supabase } from '@/lib/supabase';

const firstRow = (data) => (Array.isArray(data) ? (data[0] || null) : (data || null));

const normalizeUserCode = (code) => (code || '').toString().trim().toUpperCase();

export async function searchProfileByUserCode(code) {
  const normalized = normalizeUserCode(code);
  if (!normalized) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id,name,email,user_code,total_xp')
    .eq('user_code', normalized)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function sendFriendRequestRpc({ userId, friendUserId }) {
  if (!userId || !friendUserId) throw new Error('Missing friend identifiers');
  const { data, error } = await supabase.rpc('send_friend_request', {
    p_user_id: userId,
    p_friend_user_id: friendUserId,
  });
  if (error) throw error;
  return firstRow(data);
}

export async function respondFriendRequestRpc({ userId, friendUserId, action = 'accepted' }) {
  if (!userId || !friendUserId) throw new Error('Missing friend identifiers');
  const { data, error } = await supabase.rpc('respond_friend_request', {
    p_user_id: userId,
    p_friend_user_id: friendUserId,
    p_action: action,
  });
  if (error) throw error;
  return firstRow(data);
}

export async function fetchFriendsState(userId) {
  if (!userId) {
    return {
      accepted: [],
      incoming: [],
      outgoing: [],
      blocked: [],
      profilesById: {},
    };
  }

  const { data: rows, error } = await supabase
    .from('friends')
    .select('user_id, friend_user_id, status, created_at, updated_at')
    .or(`user_id.eq.${userId},friend_user_id.eq.${userId}`);

  if (error) throw error;

  const allRows = rows || [];
  const accepted = [];
  const incoming = [];
  const outgoing = [];
  const blocked = [];
  const profileIds = new Set([userId]);

  for (const row of allRows) {
    profileIds.add(row.user_id);
    profileIds.add(row.friend_user_id);
    if (row.status === 'accepted') {
      if (row.user_id === userId) accepted.push(row);
      continue;
    }
    if (row.status === 'pending') {
      if (row.friend_user_id === userId) incoming.push(row);
      if (row.user_id === userId) outgoing.push(row);
      continue;
    }
    if (row.status === 'blocked') {
      if (row.user_id === userId || row.friend_user_id === userId) blocked.push(row);
    }
  }

  const idsToFetch = Array.from(profileIds);
  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id,name,user_code,email,total_xp')
    .in('id', idsToFetch);

  if (profileError) throw profileError;

  const profilesById = {};
  for (const profile of profiles || []) profilesById[profile.id] = profile;

  return {
    accepted,
    incoming,
    outgoing,
    blocked,
    profilesById,
  };
}

