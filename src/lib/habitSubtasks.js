import { supabase } from '@/lib/supabase';

const firstRow = (data) => (Array.isArray(data) ? (data[0] || null) : (data || null));

export async function fetchHabitSubtasks({ userId, habitIds = [] }) {
  if (!userId || !habitIds.length) return [];
  const { data, error } = await supabase
    .from('habit_subtasks')
    .select('*')
    .eq('user_id', userId)
    .in('habit_id', habitIds)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createHabitSubtask({
  habitId,
  title,
  xpValue = 10,
  sortOrder = 0,
}) {
  if (!habitId || !title?.trim()) throw new Error('Missing habit subtask details');
  const { data, error } = await supabase
    .from('habit_subtasks')
    .insert({
      habit_id: habitId,
      title: title.trim(),
      xp_value: Math.max(0, Math.floor(Number(xpValue || 0))),
      sort_order: Math.max(0, Math.floor(Number(sortOrder || 0))),
      completed: false,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function updateHabitSubtask({ userId, subtaskId, patch }) {
  if (!userId || !subtaskId || !patch) return null;
  const { data, error } = await supabase
    .from('habit_subtasks')
    .update(patch)
    .eq('id', subtaskId)
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteHabitSubtask({ userId, subtaskId }) {
  if (!userId || !subtaskId) return;
  const { error } = await supabase
    .from('habit_subtasks')
    .delete()
    .eq('id', subtaskId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function completeHabitSubtask({ userId, subtaskId, complete = true }) {
  if (!userId || !subtaskId) throw new Error('Missing habit subtask details');
  const { data, error } = await supabase.rpc('complete_habit_subtask', {
    p_user_id: userId,
    p_subtask_id: subtaskId,
    p_complete: !!complete,
  });
  if (error) throw error;
  return firstRow(data);
}

export function mapSubtasksByHabit(subtasks = []) {
  const grouped = {};
  for (const subtask of subtasks) {
    const key = subtask.habit_id;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(subtask);
  }
  return grouped;
}

