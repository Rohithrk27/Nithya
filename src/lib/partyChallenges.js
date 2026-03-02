import { supabase } from '@/lib/supabase';

const firstRow = (data) => (Array.isArray(data) ? (data[0] || null) : (data || null));

export async function fetchPartyChallenges(partyId) {
  if (!partyId) return [];
  const { data, error } = await supabase
    .from('party_challenges')
    .select('*')
    .eq('party_id', partyId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function fetchPartyChallengeContributions(challengeIds) {
  const ids = Array.from(new Set((challengeIds || []).filter(Boolean)));
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from('party_challenge_contributions')
    .select('*')
    .in('challenge_id', ids)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function fetchPartyChallengeRewards(challengeIds) {
  const ids = Array.from(new Set((challengeIds || []).filter(Boolean)));
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from('party_challenge_rewards')
    .select('*')
    .in('challenge_id', ids)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createPartyChallenge({
  userId,
  partyId,
  title,
  description = '',
  targetTotal = 20,
  xpReward = 120,
  relicReward = 0,
  dueAt = null,
  metadata = {},
}) {
  if (!userId || !partyId) throw new Error('Missing party challenge context');
  if (!String(title || '').trim()) throw new Error('Challenge title is required');
  const { data, error } = await supabase.rpc('create_party_challenge', {
    p_user_id: userId,
    p_party_id: partyId,
    p_title: String(title || '').trim(),
    p_description: String(description || '').trim(),
    p_target_total: Math.max(1, Number(targetTotal || 20)),
    p_xp_reward: Math.max(0, Number(xpReward || 120)),
    p_relic_reward: Math.max(0, Number(relicReward || 0)),
    p_due_at: dueAt || null,
    p_metadata: metadata && typeof metadata === 'object' ? metadata : {},
  });
  if (error) throw error;
  return firstRow(data);
}

export async function contributePartyChallengeProgress({ userId, challengeId, delta = 1 }) {
  if (!userId || !challengeId) throw new Error('Missing party challenge context');
  const { data, error } = await supabase.rpc('contribute_party_challenge_progress', {
    p_user_id: userId,
    p_challenge_id: challengeId,
    p_progress_delta: Math.max(1, Number(delta || 1)),
  });
  if (error) throw error;
  return firstRow(data);
}

export async function claimPartyChallengeReward({ userId, challengeId }) {
  if (!userId || !challengeId) throw new Error('Missing party challenge context');
  const { data, error } = await supabase.rpc('claim_party_challenge_reward', {
    p_user_id: userId,
    p_challenge_id: challengeId,
  });
  if (error) throw error;
  return firstRow(data);
}
