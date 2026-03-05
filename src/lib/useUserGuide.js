import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { createPageUrl } from '@/utils';
import {
  getActiveUserGuide,
  isGuideTerminalStatus,
  isUserGuideEnabled,
  upsertUserGuideProgress,
} from '@/lib/userGuide';

const GUIDE_OPEN_EVENT = 'nithya:user-guide:open';
const DASHBOARD_PATH = createPageUrl('Dashboard');
const FIRST_LOGIN_WINDOW_MINUTES = Math.max(
  1,
  Number(import.meta.env.VITE_USER_GUIDE_FIRST_LOGIN_WINDOW_MINUTES || 10),
);
const FIRST_LOGIN_MATCH_WINDOW_MS = FIRST_LOGIN_WINDOW_MINUTES * 60 * 1000;

const normalizePath = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '/';
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const normalized = withSlash.replace(/\/+$/, '');
  return normalized || '/';
};

const resolveStartIndex = (steps, lastStepOrder) => {
  if (!Array.isArray(steps) || steps.length === 0) return 0;
  const safeOrder = Number.isFinite(Number(lastStepOrder))
    ? Math.max(1, Number(lastStepOrder))
    : 1;
  const idx = steps.findIndex((step) => Number(step?.stepOrder || 0) >= safeOrder);
  return idx >= 0 ? idx : 0;
};

export function useUserGuide({ enabled = true, language = 'en' } = {}) {
  const { user, isAuthenticated, isLoadingAuth, profileRole } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const persistKeyRef = useRef('');

  const [loading, setLoading] = useState(true);
  const [guide, setGuide] = useState(null);
  const [progress, setProgress] = useState({ status: null, lastStepOrder: null });
  const [isOpen, setIsOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [autoOpenPending, setAutoOpenPending] = useState(false);
  const [manualRun, setManualRun] = useState(false);
  const [persistSteps, setPersistSteps] = useState(true);

  const canUseGuide = useMemo(() => (
    enabled
    && isUserGuideEnabled()
    && isAuthenticated
    && !isLoadingAuth
    && !!user?.id
    && profileRole !== 'admin'
  ), [enabled, isAuthenticated, isLoadingAuth, profileRole, user?.id]);

  const isFirstLoginSession = useMemo(() => {
    const createdAt = user?.created_at ? new Date(user.created_at).getTime() : NaN;
    if (!Number.isFinite(createdAt)) return false;
    const lastSignInAt = user?.last_sign_in_at ? new Date(user.last_sign_in_at).getTime() : createdAt;
    if (!Number.isFinite(lastSignInAt)) return false;
    return Math.abs(lastSignInAt - createdAt) <= FIRST_LOGIN_MATCH_WINDOW_MS;
  }, [user?.created_at, user?.last_sign_in_at]);

  const currentStep = useMemo(() => {
    if (!guide?.steps?.length) return null;
    if (stepIndex < 0 || stepIndex >= guide.steps.length) return guide.steps[0];
    return guide.steps[stepIndex];
  }, [guide?.steps, stepIndex]);

  const persistProgress = useCallback(async ({ status, lastStepOrder }) => {
    if (!canUseGuide || !guide?.guideKey || !guide?.version || !user?.id || !status) return null;
    const row = await upsertUserGuideProgress({
      userId: user.id,
      guideKey: guide.guideKey,
      version: guide.version,
      status,
      lastStepOrder,
    });
    setProgress({
      status: row?.status || status,
      lastStepOrder: Number.isFinite(Number(row?.lastStepOrder))
        ? Number(row.lastStepOrder)
        : (Number.isFinite(Number(lastStepOrder)) ? Number(lastStepOrder) : null),
    });
    return row;
  }, [canUseGuide, guide?.guideKey, guide?.version, user?.id]);

  const loadGuide = useCallback(async () => {
    if (!canUseGuide) {
      setGuide(null);
      setProgress({ status: null, lastStepOrder: null });
      setIsOpen(false);
      setAutoOpenPending(false);
      setManualRun(false);
      setPersistSteps(true);
      setStepIndex(0);
      setLoading(false);
      persistKeyRef.current = '';
      return;
    }

    setLoading(true);
    try {
      const activeGuide = await getActiveUserGuide(user.id, language);
      if (!activeGuide || !Array.isArray(activeGuide.steps) || activeGuide.steps.length === 0) {
        setGuide(null);
        setProgress({ status: null, lastStepOrder: null });
        setIsOpen(false);
        setAutoOpenPending(false);
        setStepIndex(0);
        setManualRun(false);
        setPersistSteps(true);
        persistKeyRef.current = '';
        return;
      }

      const nextStatus = String(activeGuide.progress?.status || '').trim().toLowerCase() || null;
      const lastStepOrder = Number.isFinite(Number(activeGuide.progress?.lastStepOrder))
        ? Number(activeGuide.progress.lastStepOrder)
        : null;
      const terminal = isGuideTerminalStatus(nextStatus);
      const shouldAutoOpen = !terminal && !nextStatus && isFirstLoginSession;

      setGuide(activeGuide);
      setProgress({ status: nextStatus, lastStepOrder });
      setStepIndex(resolveStartIndex(activeGuide.steps, lastStepOrder));
      setIsOpen(false);
      setAutoOpenPending(shouldAutoOpen);
      setManualRun(false);
      setPersistSteps(true);
      persistKeyRef.current = '';
    } catch (_) {
      setGuide(null);
      setProgress({ status: null, lastStepOrder: null });
      setIsOpen(false);
      setAutoOpenPending(false);
      setManualRun(false);
      setPersistSteps(true);
      setStepIndex(0);
      persistKeyRef.current = '';
    } finally {
      setLoading(false);
    }
  }, [canUseGuide, isFirstLoginSession, language, user?.id]);

  useEffect(() => {
    void loadGuide();
  }, [loadGuide]);

  useEffect(() => {
    if (!canUseGuide || !guide?.steps?.length || isOpen || !autoOpenPending) return;
    if (normalizePath(location.pathname) !== normalizePath(DASHBOARD_PATH)) return;
    const firstStepOrder = Number(guide?.steps?.[0]?.stepOrder || 1);
    // Mark as started immediately when auto-opening so first-run guide shows only once.
    setProgress((prev) => ({
      status: prev?.status || 'started',
      lastStepOrder: Number.isFinite(Number(prev?.lastStepOrder))
        ? Number(prev.lastStepOrder)
        : firstStepOrder,
    }));
    void persistProgress({
      status: 'started',
      lastStepOrder: firstStepOrder,
    });
    setManualRun(false);
    setPersistSteps(true);
    setIsOpen(true);
    setAutoOpenPending(false);
  }, [autoOpenPending, canUseGuide, guide?.steps, isOpen, location.pathname, persistProgress]);

  const openManualGuide = useCallback(() => {
    if (!guide?.steps?.length) return;
    setAutoOpenPending(false);
    setStepIndex(0);
    setManualRun(true);
    setPersistSteps(!isGuideTerminalStatus(progress?.status));
    setIsOpen(true);
    persistKeyRef.current = '';
  }, [guide?.steps, progress?.status]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onOpen = () => openManualGuide();
    window.addEventListener(GUIDE_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(GUIDE_OPEN_EVENT, onOpen);
  }, [openManualGuide]);

  useEffect(() => {
    if (!isOpen || !currentStep?.route) return;
    const currentPath = normalizePath(location.pathname);
    const stepPath = normalizePath(currentStep.route);
    if (currentPath === stepPath) return;
    navigate(stepPath);
  }, [currentStep?.route, isOpen, location.pathname, navigate]);

  useEffect(() => {
    if (!isOpen || !persistSteps || !currentStep?.stepOrder) return;
    const status = String(progress?.status || '').trim().toLowerCase();
    if (status === 'skipped' || status === 'completed') return;

    const persistKey = `${guide?.guideKey}:${guide?.version}:${currentStep.stepOrder}:${manualRun}:${persistSteps}`;
    if (persistKeyRef.current === persistKey) return;
    persistKeyRef.current = persistKey;

    void persistProgress({
      status: 'started',
      lastStepOrder: currentStep.stepOrder,
    });
  }, [
    currentStep?.stepOrder,
    guide?.guideKey,
    guide?.version,
    isOpen,
    manualRun,
    persistProgress,
    persistSteps,
    progress?.status,
  ]);

  const closeGuide = useCallback(() => {
    setIsOpen(false);
  }, []);

  const skipGuide = useCallback(async () => {
    if (!currentStep?.stepOrder) {
      setIsOpen(false);
      return;
    }
    try {
      await persistProgress({
        status: 'skipped',
        lastStepOrder: currentStep.stepOrder,
      });
    } catch (_) {
      // Ignore skip write errors to keep UX responsive.
    } finally {
      setIsOpen(false);
      setAutoOpenPending(false);
    }
  }, [currentStep?.stepOrder, persistProgress]);

  const completeGuide = useCallback(async () => {
    const finalOrder = guide?.steps?.[guide.steps.length - 1]?.stepOrder || currentStep?.stepOrder || 1;
    try {
      await persistProgress({
        status: 'completed',
        lastStepOrder: finalOrder,
      });
    } catch (_) {
      // Ignore completion write errors to keep UX responsive.
    } finally {
      setIsOpen(false);
      setAutoOpenPending(false);
    }
  }, [currentStep?.stepOrder, guide?.steps, persistProgress]);

  const nextStep = useCallback(async () => {
    if (!guide?.steps?.length) return;
    const lastIndex = guide.steps.length - 1;
    if (stepIndex >= lastIndex) {
      await completeGuide();
      return;
    }
    setStepIndex((prev) => Math.min(lastIndex, prev + 1));
  }, [completeGuide, guide?.steps, stepIndex]);

  const prevStep = useCallback(() => {
    setStepIndex((prev) => Math.max(0, prev - 1));
  }, []);

  return {
    enabled: canUseGuide,
    loading,
    guide,
    progress,
    isOpen,
    stepIndex,
    totalSteps: guide?.steps?.length || 0,
    currentStep,
    manualRun,
    openManualGuide,
    closeGuide,
    skipGuide,
    completeGuide,
    nextStep,
    prevStep,
    canGoBack: stepIndex > 0,
  };
}

export default useUserGuide;
