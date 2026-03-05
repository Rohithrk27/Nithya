import { supabase } from '@/lib/supabase';

const firstRow = (data) => (Array.isArray(data) ? (data[0] || null) : (data || null));

const normalizeRoute = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '/dashboard';
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return withSlash.toLowerCase();
};

const normalizeStep = (step) => ({
  id: step?.id || '',
  stepOrder: Math.max(1, Number(step?.stepOrder || step?.step_order || 1)),
  route: normalizeRoute(step?.route),
  targetSelector: String(step?.targetSelector || step?.target_selector || '').trim(),
  title: String(step?.title || '').trim() || 'Guide Step',
  description: String(step?.description || '').trim(),
  placement: String(step?.placement || 'auto').trim().toLowerCase() || 'auto',
  allowNextWithoutTarget: !!(step?.allowNextWithoutTarget ?? step?.allow_next_without_target),
});

export const isUserGuideEnabled = () => (
  String(import.meta.env.VITE_ENABLE_USER_GUIDE ?? 'true').trim().toLowerCase() !== 'false'
);

export const isGuideTerminalStatus = (value) => {
  const status = String(value || '').trim().toLowerCase();
  return status === 'skipped' || status === 'completed';
};

export async function getActiveUserGuide(userId, language = 'en') {
  if (!userId) return null;
  const { data, error } = await supabase.rpc('get_active_user_guide', {
    p_user_id: userId,
    p_language: language || 'en',
  });
  if (error) throw error;
  const row = firstRow(data);
  if (!row || !Array.isArray(row.steps) || row.steps.length === 0) return null;

  const steps = row.steps
    .map(normalizeStep)
    .sort((a, b) => a.stepOrder - b.stepOrder);

  return {
    guideKey: String(row.guide_key || 'user_main').trim() || 'user_main',
    version: Math.max(1, Number(row.version || 1)),
    title: String(row.title || 'Main Feature Guide').trim() || 'Main Feature Guide',
    language: String(row.language || language || 'en').trim() || 'en',
    steps,
    progress: {
      status: String(row.progress_status || '').trim().toLowerCase() || null,
      lastStepOrder: Number.isFinite(Number(row.progress_last_step_order))
        ? Number(row.progress_last_step_order)
        : null,
    },
  };
}

export async function upsertUserGuideProgress({
  userId,
  guideKey = 'user_main',
  version,
  status,
  lastStepOrder = null,
}) {
  if (!userId || !guideKey || !version || !status) return null;
  const safeOrder = Number.isFinite(Number(lastStepOrder))
    ? Math.max(1, Number(lastStepOrder))
    : null;
  const { data, error } = await supabase.rpc('upsert_user_guide_progress', {
    p_user_id: userId,
    p_guide_key: guideKey,
    p_version: Number(version),
    p_status: String(status || '').trim().toLowerCase(),
    p_last_step_order: safeOrder,
  });
  if (error) throw error;
  const row = firstRow(data);
  if (!row) return null;
  return {
    status: String(row.status || '').trim().toLowerCase() || null,
    lastStepOrder: Number.isFinite(Number(row.last_step_order))
      ? Number(row.last_step_order)
      : null,
    completedAt: row.completed_at || null,
    skippedAt: row.skipped_at || null,
    updatedAt: row.updated_at || null,
  };
}

