import { supabase } from '@/lib/supabase';

export async function logActivityEvent({
  userId = null,
  type,
  metadata = {},
}) {
  if (!type) return null;
  try {
    const { data, error } = await supabase.rpc('log_activity_event', {
      p_user_id: userId || null,
      p_type: type,
      p_metadata: metadata && typeof metadata === 'object' ? metadata : {},
    });
    if (error) return null;
    return data || null;
  } catch (_) {
    return null;
  }
}
