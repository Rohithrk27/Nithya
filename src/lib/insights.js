import { supabase } from '@/lib/supabase';

const firstRow = (data) => (Array.isArray(data) ? (data[0] || null) : (data || null));

export async function generateWeeklyPersonalInsight({ userId, weekStart = null }) {
  if (!userId) throw new Error('Missing user id');
  const { data, error } = await supabase.rpc('generate_weekly_personal_insight', {
    p_user_id: userId,
    p_week_start: weekStart || null,
  });
  if (error) throw error;
  return firstRow(data);
}

export async function fetchLatestWeeklyPersonalInsight(userId) {
  if (!userId) return null;
  const rpcRes = await supabase.rpc('get_latest_weekly_personal_insight', {
    p_user_id: userId,
  });
  if (!rpcRes.error) return firstRow(rpcRes.data);

  const fallback = await supabase
    .from('weekly_personal_insights')
    .select('*')
    .eq('user_id', userId)
    .order('week_start', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (fallback.error) throw rpcRes.error;
  return fallback.data || null;
}

export async function fetchWeeklyPersonalInsightHistory(userId, limit = 8) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('weekly_personal_insights')
    .select('*')
    .eq('user_id', userId)
    .order('week_start', { ascending: false })
    .limit(Math.max(1, Math.min(52, Number(limit || 8))));
  if (error) throw error;
  return data || [];
}
