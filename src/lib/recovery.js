import { supabase } from '@/lib/supabase';

const firstRow = (data) => (Array.isArray(data) ? (data[0] || null) : (data || null));

export async function fetchActiveRecoveryPlan(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('recovery_plans')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function fetchRecoveryPlanSteps(planId) {
  if (!planId) return [];
  const { data, error } = await supabase
    .from('recovery_plan_steps')
    .select('*')
    .eq('plan_id', planId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function fetchRecoveryPlanHistory(userId, limit = 8) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('recovery_plans')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(30, Number(limit || 8))));
  if (error) throw error;
  return data || [];
}

export async function createRecoveryPlan({ userId, source = 'manual', sourceRef = null, reason = '', forceNew = false }) {
  if (!userId) throw new Error('Missing user id');
  const { data, error } = await supabase.rpc('create_recovery_plan', {
    p_user_id: userId,
    p_source: source || 'manual',
    p_source_ref: sourceRef || null,
    p_reason: reason || null,
    p_force_new: forceNew === true,
  });
  if (error) throw error;
  return firstRow(data);
}

export async function progressRecoveryPlanStep({ userId, stepId, delta = 1 }) {
  if (!userId || !stepId) throw new Error('Missing recovery step details');
  const { data, error } = await supabase.rpc('progress_recovery_plan_step', {
    p_user_id: userId,
    p_step_id: stepId,
    p_progress_delta: Math.max(1, Number(delta || 1)),
  });
  if (error) throw error;
  return firstRow(data);
}

export async function abandonRecoveryPlan({ userId, planId }) {
  if (!userId || !planId) throw new Error('Missing recovery plan details');
  const { data, error } = await supabase.rpc('abandon_recovery_plan', {
    p_user_id: userId,
    p_plan_id: planId,
  });
  if (error) throw error;
  return firstRow(data);
}
