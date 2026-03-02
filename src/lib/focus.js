import { supabase } from '@/lib/supabase';

const firstRow = (data) => (Array.isArray(data) ? (data[0] || null) : (data || null));

export async function fetchActiveFocusSession(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('focus_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function fetchRecentFocusSessions(userId, limit = 20) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('focus_sessions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(100, Number(limit || 20))));
  if (error) throw error;
  return data || [];
}

export async function startFocusSession({ userId, minutes = 25, metadata = {} }) {
  if (!userId) throw new Error('Missing user id');
  const { data, error } = await supabase.rpc('start_focus_session', {
    p_user_id: userId,
    p_minutes: Math.max(5, Math.min(180, Number(minutes || 25))),
    p_metadata: metadata && typeof metadata === 'object' ? metadata : {},
  });
  if (error) throw error;
  return firstRow(data);
}

export async function interruptFocusSession({ userId, sessionId, reason = 'manual_interrupt' }) {
  if (!userId || !sessionId) throw new Error('Missing focus session details');
  const { data, error } = await supabase.rpc('interrupt_focus_session', {
    p_user_id: userId,
    p_session_id: sessionId,
    p_reason: reason || 'manual_interrupt',
  });
  if (error) throw error;
  return firstRow(data);
}

export async function completeFocusSession({ userId, sessionId }) {
  if (!userId || !sessionId) throw new Error('Missing focus session details');
  const { data, error } = await supabase.rpc('complete_focus_session', {
    p_user_id: userId,
    p_session_id: sessionId,
    p_completed_at: new Date().toISOString(),
  });
  if (error) throw error;
  return firstRow(data);
}
