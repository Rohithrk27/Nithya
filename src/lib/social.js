import { supabase } from '@/lib/supabase';

const firstRow = (data) => (Array.isArray(data) ? (data[0] || null) : (data || null));

export const normalizeUserCode = (code) => {
  const raw = (code || '').toString().trim().toUpperCase();
  if (!raw) return '';

  // Accept variants like "@hntr abc123", "hntrabc123", or plain "ABC123".
  const compact = raw.replace(/[^A-Z0-9]/g, '');
  if (!compact) return '';

  if (compact.startsWith('HNTR')) {
    const suffix = compact.slice(4);
    return suffix ? `HNTR-${suffix}` : 'HNTR';
  }

  if (/^[A-Z0-9]{6}$/.test(compact)) {
    return `HNTR-${compact}`;
  }

  return raw.replace(/[^A-Z0-9-]/g, '');
};

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
  try {
    const { data, error } = await supabase.rpc('send_friend_request', {
      p_user_id: userId,
      p_friend_user_id: friendUserId,
    });
    if (error) throw error;
    return firstRow(data);
  } catch (error) {
    if (!isAmbiguousFriendRpcError(error)) throw error;
    return sendFriendRequestFallback({ userId, friendUserId });
  }
}

export async function respondFriendRequestRpc({ userId, friendUserId, action = 'accepted' }) {
  if (!userId || !friendUserId) throw new Error('Missing friend identifiers');
  try {
    const { data, error } = await supabase.rpc('respond_friend_request', {
      p_user_id: userId,
      p_friend_user_id: friendUserId,
      p_action: action,
    });
    if (error) throw error;
    return firstRow(data);
  } catch (error) {
    if (!isAmbiguousFriendRpcError(error)) throw error;
    return respondFriendRequestFallback({ userId, friendUserId, action });
  }
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

const isAmbiguousFriendRpcError = (error) => {
  const code = String(error?.code || '').trim();
  const text = [
    String(error?.message || ''),
    String(error?.details || ''),
    String(error?.hint || ''),
  ].join(' ').toLowerCase();
  if (code === '42702') return true;
  return text.includes('column reference')
    && text.includes('ambiguous');
};

async function fetchFriendPairRows({ userId, friendUserId }) {
  const [directRes, reverseRes] = await Promise.all([
    supabase
      .from('friends')
      .select('user_id, friend_user_id, status, updated_at')
      .eq('user_id', userId)
      .eq('friend_user_id', friendUserId)
      .maybeSingle(),
    supabase
      .from('friends')
      .select('user_id, friend_user_id, status, updated_at')
      .eq('user_id', friendUserId)
      .eq('friend_user_id', userId)
      .maybeSingle(),
  ]);

  if (directRes.error) throw directRes.error;
  if (reverseRes.error) throw reverseRes.error;

  return {
    direct: directRes.data || null,
    reverse: reverseRes.data || null,
  };
}

async function sendFriendRequestFallback({ userId, friendUserId }) {
  if (!userId || !friendUserId || userId === friendUserId) {
    throw new Error('invalid friend request');
  }

  const { direct, reverse } = await fetchFriendPairRows({ userId, friendUserId });
  const statusValues = [direct?.status, reverse?.status].filter(Boolean);

  if (statusValues.includes('blocked')) {
    throw new Error('friend request is blocked');
  }

  const shouldAccept = reverse?.status === 'pending'
    || direct?.status === 'accepted'
    || reverse?.status === 'accepted';

  const nextStatus = shouldAccept ? 'accepted' : 'pending';

  if (reverse?.status === 'pending') {
    const { error: reverseUpdateError } = await supabase
      .from('friends')
      .update({ status: 'accepted' })
      .eq('user_id', friendUserId)
      .eq('friend_user_id', userId);
    if (reverseUpdateError) throw reverseUpdateError;
  }

  const { data: upserted, error: upsertError } = await supabase
    .from('friends')
    .upsert(
      [{
        user_id: userId,
        friend_user_id: friendUserId,
        status: nextStatus,
      }],
      { onConflict: 'user_id,friend_user_id' }
    )
    .select('user_id, friend_user_id, status, updated_at')
    .maybeSingle();
  if (upsertError) throw upsertError;

  return upserted || {
    user_id: userId,
    friend_user_id: friendUserId,
    status: nextStatus,
    updated_at: new Date().toISOString(),
  };
}

async function respondFriendRequestFallback({ userId, friendUserId, action = 'accepted' }) {
  if (!userId || !friendUserId || userId === friendUserId) {
    throw new Error('invalid friend response');
  }
  const normalizedAction = String(action || 'accepted').toLowerCase();

  const { reverse } = await fetchFriendPairRows({ userId, friendUserId });
  if (!reverse || reverse.status !== 'pending') {
    throw new Error('pending friend request not found');
  }

  if (normalizedAction === 'accepted' || normalizedAction === 'blocked') {
    const nextStatus = normalizedAction === 'accepted' ? 'accepted' : 'blocked';
    const { error: reverseUpdateError } = await supabase
      .from('friends')
      .update({ status: nextStatus })
      .eq('user_id', friendUserId)
      .eq('friend_user_id', userId);
    if (reverseUpdateError) throw reverseUpdateError;

    const { data: upserted, error: upsertError } = await supabase
      .from('friends')
      .upsert(
        [{
          user_id: userId,
          friend_user_id: friendUserId,
          status: nextStatus,
        }],
        { onConflict: 'user_id,friend_user_id' }
      )
      .select('user_id, friend_user_id, status, updated_at')
      .maybeSingle();
    if (upsertError) throw upsertError;

    return upserted || {
      user_id: userId,
      friend_user_id: friendUserId,
      status: nextStatus,
      updated_at: new Date().toISOString(),
    };
  }

  if (normalizedAction === 'declined') {
    const { error: deleteError } = await supabase
      .from('friends')
      .delete()
      .eq('user_id', friendUserId)
      .eq('friend_user_id', userId)
      .eq('status', 'pending');
    if (deleteError) throw deleteError;

    return {
      user_id: userId,
      friend_user_id: friendUserId,
      status: 'declined',
      updated_at: new Date().toISOString(),
    };
  }

  throw new Error('unsupported friend action');
}

