import { supabase } from '@/lib/supabase';

const firstRow = (data) => (Array.isArray(data) ? (data[0] || null) : (data || null));

const asInt = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
};

export async function createDungeonParty({
  userId,
  dungeonId = null,
  title = null,
  visibility = 'friends',
  maxMembers = 4,
}) {
  if (!userId) throw new Error('Missing user id');

  const preferred = await supabase.rpc('create_dungeon_party_with_options', {
    p_user_id: userId,
    p_dungeon_id: dungeonId,
    p_title: title,
    p_visibility: visibility,
    p_max_members: Math.max(2, Math.min(16, asInt(maxMembers, 4))),
  });
  if (!preferred.error) return firstRow(preferred.data);

  const fallback = await supabase.rpc('create_dungeon_party', {
    p_user_id: userId,
    p_dungeon_id: dungeonId,
    p_title: title,
  });
  if (fallback.error) throw fallback.error;
  return firstRow(fallback.data);
}

export async function setDungeonPartyVisibility({
  userId,
  partyId,
  visibility,
  maxMembers = null,
}) {
  if (!userId || !partyId) return null;
  const { data, error } = await supabase.rpc('set_dungeon_party_visibility', {
    p_user_id: userId,
    p_party_id: partyId,
    p_visibility: visibility,
    p_max_members: maxMembers,
  });
  if (error) throw error;
  return firstRow(data);
}

export async function inviteToDungeonParty({
  userId,
  partyId,
  invitedUserId,
}) {
  if (!userId || !partyId || !invitedUserId) return null;
  const { data, error } = await supabase.rpc('invite_to_dungeon_party', {
    p_user_id: userId,
    p_party_id: partyId,
    p_invited_user_id: invitedUserId,
  });
  if (error) throw error;
  return firstRow(data);
}

export async function joinDungeonParty({ userId, partyId, role = 'member' }) {
  if (!userId || !partyId) throw new Error('Missing party details');
  const { data, error } = await supabase.rpc('join_dungeon_party', {
    p_user_id: userId,
    p_party_id: partyId,
    p_role: role,
  });
  if (error) throw error;
  return firstRow(data);
}

export async function joinDungeonPartyByCode({ userId, inviteCode }) {
  if (!userId || !inviteCode?.trim()) throw new Error('Missing invite code');
  const { data, error } = await supabase.rpc('join_dungeon_party_by_code', {
    p_user_id: userId,
    p_invite_code: inviteCode.trim(),
  });
  if (error) throw error;
  return firstRow(data);
}

export async function startDungeonParty({
  userId,
  partyId,
  durationDays = 7,
  xpMultiplier = 1.5,
}) {
  if (!userId || !partyId) throw new Error('Missing party details');
  const { data, error } = await supabase.rpc('start_dungeon_party', {
    p_user_id: userId,
    p_party_id: partyId,
    p_duration_days: Math.max(1, asInt(durationDays, 7)),
    p_xp_multiplier: Math.max(1, Number(xpMultiplier || 1.5)),
  });
  if (error) throw error;
  return firstRow(data);
}

export async function updateDungeonPartyProgress({
  userId,
  partyId,
  progressDelta,
  xpPool = 600,
}) {
  if (!userId || !partyId) throw new Error('Missing party details');
  const { data, error } = await supabase.rpc('update_dungeon_party_progress', {
    p_user_id: userId,
    p_party_id: partyId,
    p_progress_delta: asInt(progressDelta, 0),
    p_xp_pool: Math.max(0, asInt(xpPool, 600)),
  });
  if (error) throw error;
  return firstRow(data);
}

export async function registerDungeonPartyFailure({
  userId,
  partyId,
  failedUserId = null,
  stabilityPenalty = 15,
}) {
  if (!userId || !partyId) throw new Error('Missing party details');
  const { data, error } = await supabase.rpc('register_dungeon_party_failure', {
    p_user_id: userId,
    p_party_id: partyId,
    p_failed_user_id: failedUserId,
    p_stability_penalty: Math.max(0, asInt(stabilityPenalty, 15)),
  });
  if (error) throw error;
  return firstRow(data);
}

export async function claimDungeonPartyXp({ userId, partyId }) {
  if (!userId || !partyId) throw new Error('Missing party details');
  const { data, error } = await supabase.rpc('claim_dungeon_party_xp', {
    p_user_id: userId,
    p_party_id: partyId,
  });
  if (error) throw error;
  return firstRow(data);
}

export async function fetchFriendActiveDungeons(userId) {
  if (!userId) return [];
  const { data, error } = await supabase.rpc('get_friend_active_dungeons', {
    p_user_id: userId,
  });
  if (error) throw error;
  return data || [];
}

export async function fetchOwnedParty(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('dungeon_parties')
    .select('*')
    .eq('host_user_id', userId)
    .in('status', ['waiting', 'active'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function fetchPartyForMember(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('dungeon_party_members')
    .select('party_id,status,role,joined_at,dungeon_parties(*)')
    .eq('user_id', userId)
    .in('status', ['joined', 'completed'])
    .order('joined_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.dungeon_parties || null;
}

export async function fetchPartyMembers(partyId) {
  if (!partyId) return [];
  const { data, error } = await supabase
    .from('dungeon_party_members')
    .select('party_id,user_id,role,status,joined_at')
    .eq('party_id', partyId)
    .order('joined_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function fetchPartyRewards(partyId) {
  if (!partyId) return [];
  const { data, error } = await supabase
    .from('dungeon_party_rewards')
    .select('party_id,user_id,xp_amount,claimed,claimed_at,created_at')
    .eq('party_id', partyId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export function subscribeToPartyRealtime({
  partyId,
  userId,
  onPartyChange,
  onMemberChange,
  onRewardChange,
  onXpLog,
}) {
  if (!partyId && !userId) return () => {};
  const channel = supabase.channel(`dungeon-party-${partyId || 'any'}-${userId || 'anon'}`);

  if (partyId) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'dungeon_parties', filter: `id=eq.${partyId}` },
      (payload) => onPartyChange?.(payload)
    );
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'dungeon_party_members', filter: `party_id=eq.${partyId}` },
      (payload) => onMemberChange?.(payload)
    );
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'dungeon_party_rewards', filter: `party_id=eq.${partyId}` },
      (payload) => onRewardChange?.(payload)
    );
  }

  if (userId) {
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'xp_logs', filter: `user_id=eq.${userId}` },
      (payload) => onXpLog?.(payload)
    );
  }

  channel.subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

