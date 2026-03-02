import { supabase } from '@/lib/supabase';

const ADMIN_SESSION_STORAGE_KEY = 'nithya_admin_session_token';

export const getAdminSessionToken = () => {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(ADMIN_SESSION_STORAGE_KEY) || '';
  } catch (_) {
    return '';
  }
};

export const setAdminSessionToken = (token) => {
  if (typeof window === 'undefined') return;
  try {
    if (!token) {
      localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
      return;
    }
    localStorage.setItem(ADMIN_SESSION_STORAGE_KEY, token);
  } catch (_) {
    // Ignore storage failures.
  }
};

export const clearAdminSessionToken = () => setAdminSessionToken('');

const firstRow = (data) => (Array.isArray(data) ? (data[0] || null) : (data || null));

export async function adminLogin({ username, password, userAgent = '' }) {
  const { data, error } = await supabase.rpc('admin_login', {
    p_username: username,
    p_password: password,
    p_user_agent: userAgent || null,
  });
  if (error) throw error;
  const row = firstRow(data);
  const token = row?.session_token || '';
  if (token) setAdminSessionToken(token);
  return row;
}

export async function adminValidateSession(sessionToken = getAdminSessionToken()) {
  if (!sessionToken) return { is_valid: false };
  const { data, error } = await supabase.rpc('admin_validate_session', {
    p_session_token: sessionToken,
  });
  if (error) throw error;
  return firstRow(data) || { is_valid: false };
}

export async function adminLogout(sessionToken = getAdminSessionToken()) {
  if (!sessionToken) {
    clearAdminSessionToken();
    return;
  }
  await supabase.rpc('admin_logout', {
    p_session_token: sessionToken,
  });
  clearAdminSessionToken();
}

export async function adminListUsers({ sessionToken = getAdminSessionToken(), limit = 200 } = {}) {
  const { data, error } = await supabase.rpc('admin_list_users', {
    p_session_token: sessionToken,
    p_limit: Math.max(1, Math.min(1000, Number(limit || 200))),
  });
  if (error) throw error;
  return data || [];
}

export async function adminSetUserSuspension({ sessionToken = getAdminSessionToken(), userId, suspended }) {
  const { data, error } = await supabase.rpc('admin_set_user_suspension', {
    p_session_token: sessionToken,
    p_user_id: userId,
    p_suspended: !!suspended,
  });
  if (error) throw error;
  return !!data;
}

export async function adminDeleteUser({ sessionToken = getAdminSessionToken(), userId }) {
  const { data, error } = await supabase.rpc('admin_delete_user', {
    p_session_token: sessionToken,
    p_user_id: userId,
  });
  if (error) throw error;
  return !!data;
}

export async function adminCreateChallenge({
  sessionToken = getAdminSessionToken(),
  targetUserId = null,
  title,
  description,
  xpReward = 120,
  relicReward = 0,
  deadline = null,
  punishmentType = 'xp_deduction',
  punishmentValue = 40,
}) {
  const { data, error } = await supabase.rpc('admin_create_challenge', {
    p_session_token: sessionToken,
    p_target_user_id: targetUserId || null,
    p_title: title || null,
    p_description: description || null,
    p_xp_reward: Math.max(0, Number(xpReward || 0)),
    p_relic_reward: Math.max(0, Number(relicReward || 0)),
    p_deadline: deadline || null,
    p_punishment_type: punishmentType || 'xp_deduction',
    p_punishment_value: Math.max(0, Number(punishmentValue || 0)),
  });
  if (error) throw error;
  return firstRow(data);
}

export async function adminCreateRelicType({
  sessionToken = getAdminSessionToken(),
  code,
  name,
  description = '',
  rarity = 'common',
  effectType = '',
}) {
  const { data, error } = await supabase.rpc('admin_create_relic_type', {
    p_session_token: sessionToken,
    p_code: code,
    p_name: name,
    p_description: description || null,
    p_rarity: rarity,
    p_effect_type: effectType || null,
  });
  if (error) throw error;
  return data;
}

export async function adminGrantRelic({
  sessionToken = getAdminSessionToken(),
  userId,
  relicTypeId = null,
  source = 'admin_grant',
  rarity = 'rare',
  count = 1,
  label = '',
}) {
  const { data, error } = await supabase.rpc('admin_grant_relic', {
    p_session_token: sessionToken,
    p_user_id: userId,
    p_relic_type_id: relicTypeId || null,
    p_source: source,
    p_rarity: rarity,
    p_count: Math.max(1, Number(count || 1)),
    p_label: label || null,
  });
  if (error) throw error;
  return Number(data || 0);
}

export async function adminRemoveRelic({ sessionToken = getAdminSessionToken(), relicId }) {
  const { data, error } = await supabase.rpc('admin_remove_relic', {
    p_session_token: sessionToken,
    p_relic_id: relicId,
  });
  if (error) throw error;
  return !!data;
}

export async function adminCreateAnnouncement({
  sessionToken = getAdminSessionToken(),
  title,
  message,
  expiresAt = null,
}) {
  const { data, error } = await supabase.rpc('admin_create_announcement', {
    p_session_token: sessionToken,
    p_title: title,
    p_message: message,
    p_expires_at: expiresAt || null,
  });
  if (error) throw error;
  return data;
}

export async function adminListActivityLogs({ sessionToken = getAdminSessionToken(), limit = 200 } = {}) {
  const { data, error } = await supabase.rpc('admin_list_activity_logs', {
    p_session_token: sessionToken,
    p_limit: Math.max(1, Math.min(1000, Number(limit || 200))),
  });
  if (error) throw error;
  return data || [];
}

export async function adminListCommunitySubmissions({ sessionToken = getAdminSessionToken(), status = '' } = {}) {
  const { data, error } = await supabase.rpc('admin_list_community_submissions', {
    p_session_token: sessionToken,
    p_status: status || null,
  });
  if (error) throw error;
  return data || [];
}

export async function adminReplyCommunitySubmission({
  sessionToken = getAdminSessionToken(),
  submissionId,
  adminReply,
  status = 'reviewed',
}) {
  const { data, error } = await supabase.rpc('admin_reply_community_submission', {
    p_session_token: sessionToken,
    p_submission_id: submissionId,
    p_admin_reply: adminReply || null,
    p_status: status || 'reviewed',
  });
  if (error) throw error;
  return !!data;
}

export async function adminListPaymentVerifications({
  sessionToken = getAdminSessionToken(),
  status = '',
  limit = 200,
} = {}) {
  const { data, error } = await supabase.rpc('admin_list_payment_verification_requests', {
    p_session_token: sessionToken,
    p_status: status || null,
    p_limit: Math.max(1, Math.min(1000, Number(limit || 200))),
  });
  if (error) throw error;
  return data || [];
}

export async function adminUpdatePaymentVerification({
  sessionToken = getAdminSessionToken(),
  requestId,
  status = 'reviewed',
  adminReply = '',
}) {
  const { data, error } = await supabase.rpc('admin_update_payment_verification_request', {
    p_session_token: sessionToken,
    p_request_id: requestId,
    p_status: status || 'reviewed',
    p_admin_reply: adminReply || null,
  });
  if (error) throw error;
  return !!data;
}

export async function fetchRelicTypes() {
  const { data, error } = await supabase
    .from('relic_types')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
