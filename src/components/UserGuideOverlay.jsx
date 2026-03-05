import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const getViewport = () => ({
  width: typeof window !== 'undefined' ? window.innerWidth : 1280,
  height: typeof window !== 'undefined' ? window.innerHeight : 720,
});

const computeCardPosition = ({ placement, targetRect, cardWidth, cardHeight }) => {
  const viewport = getViewport();
  const margin = 12;
  const center = {
    top: Math.max(margin, (viewport.height / 2) - (cardHeight / 2)),
    left: Math.max(margin, (viewport.width / 2) - (cardWidth / 2)),
  };

  if (!targetRect || placement === 'center') {
    return {
      top: clamp(center.top, margin, Math.max(margin, viewport.height - cardHeight - margin)),
      left: clamp(center.left, margin, Math.max(margin, viewport.width - cardWidth - margin)),
    };
  }

  const toPosition = (top, left) => ({
    top: clamp(top, margin, Math.max(margin, viewport.height - cardHeight - margin)),
    left: clamp(left, margin, Math.max(margin, viewport.width - cardWidth - margin)),
  });

  const topCandidate = toPosition(targetRect.top - cardHeight - margin, targetRect.left + (targetRect.width / 2) - (cardWidth / 2));
  const bottomCandidate = toPosition(targetRect.bottom + margin, targetRect.left + (targetRect.width / 2) - (cardWidth / 2));
  const leftCandidate = toPosition(targetRect.top + (targetRect.height / 2) - (cardHeight / 2), targetRect.left - cardWidth - margin);
  const rightCandidate = toPosition(targetRect.top + (targetRect.height / 2) - (cardHeight / 2), targetRect.right + margin);

  if (placement === 'top') return topCandidate;
  if (placement === 'bottom') return bottomCandidate;
  if (placement === 'left') return leftCandidate;
  if (placement === 'right') return rightCandidate;

  const candidates = [bottomCandidate, topCandidate, rightCandidate, leftCandidate];
  const fits = (candidate) => (
    candidate.top >= margin
    && candidate.left >= margin
    && (candidate.top + cardHeight + margin) <= viewport.height
    && (candidate.left + cardWidth + margin) <= viewport.width
  );
  return candidates.find(fits) || candidates[0] || center;
};

export default function UserGuideOverlay({
  isOpen,
  guide,
  stepIndex,
  totalSteps,
  currentStep,
  canGoBack,
  nextStep,
  prevStep,
  skipGuide,
  closeGuide,
}) {
  const location = useLocation();
  const cardRef = useRef(null);
  const [targetRect, setTargetRect] = useState(null);
  const [targetMissing, setTargetMissing] = useState(false);

  const resolveTarget = useCallback(() => {
    if (!isOpen || !currentStep?.targetSelector || typeof document === 'undefined') {
      setTargetRect(null);
      setTargetMissing(false);
      return;
    }
    const target = document.querySelector(currentStep.targetSelector);
    if (!target || !(target instanceof HTMLElement)) {
      setTargetRect(null);
      setTargetMissing(true);
      return;
    }
    const rect = target.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      setTargetRect(null);
      setTargetMissing(true);
      return;
    }
    setTargetRect({
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      right: rect.right,
      bottom: rect.bottom,
    });
    setTargetMissing(false);
  }, [currentStep?.targetSelector, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setTargetRect(null);
      setTargetMissing(false);
      return undefined;
    }

    let rafId = 0;
    const timerId = setTimeout(() => {
      resolveTarget();
      if (currentStep?.targetSelector) {
        const target = document.querySelector(currentStep.targetSelector);
        if (target && target instanceof HTMLElement) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        }
      }
    }, 120);

    const onFrameUpdate = () => {
      resolveTarget();
      rafId = requestAnimationFrame(onFrameUpdate);
    };
    rafId = requestAnimationFrame(onFrameUpdate);

    window.addEventListener('resize', resolveTarget, { passive: true });
    window.addEventListener('scroll', resolveTarget, { passive: true, capture: true });

    return () => {
      clearTimeout(timerId);
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resolveTarget, { capture: false });
      window.removeEventListener('scroll', resolveTarget, { capture: true });
    };
  }, [currentStep?.id, currentStep?.targetSelector, isOpen, location.pathname, resolveTarget]);

  const canAdvance = useMemo(() => (
    !targetMissing || !!currentStep?.allowNextWithoutTarget
  ), [currentStep?.allowNextWithoutTarget, targetMissing]);

  const cardPosition = useMemo(() => {
    const viewport = getViewport();
    const cardWidth = Math.min(360, Math.max(280, viewport.width - 24));
    const cardHeight = Math.max(220, cardRef.current?.offsetHeight || 260);
    const placement = String(currentStep?.placement || 'auto').toLowerCase();
    const next = computeCardPosition({
      placement,
      targetRect,
      cardWidth,
      cardHeight,
    });
    return {
      width: cardWidth,
      top: next.top,
      left: next.left,
    };
  }, [currentStep?.placement, targetRect, stepIndex, totalSteps]);

  if (!isOpen || !guide || !currentStep) return null;

  const stepLabel = `${Math.min(totalSteps, stepIndex + 1)} / ${Math.max(1, totalSteps)}`;
  const lastStep = stepIndex >= (totalSteps - 1);

  return (
    <div
      className="fixed inset-0 z-[120] pointer-events-none"
      aria-live="polite"
      aria-label="User guide overlay"
    >
      <div className="absolute inset-0" style={{ background: 'rgba(2, 6, 23, 0.7)' }} />

      {targetRect && (
        <div
          className="absolute rounded-xl"
          style={{
            top: Math.max(0, targetRect.top - 8),
            left: Math.max(0, targetRect.left - 8),
            width: Math.max(24, targetRect.width + 16),
            height: Math.max(24, targetRect.height + 16),
            border: '2px solid rgba(34, 211, 238, 0.95)',
            boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.72), 0 0 20px rgba(34, 211, 238, 0.42)',
            pointerEvents: 'none',
          }}
        />
      )}

      <div
        ref={cardRef}
        className="absolute rounded-2xl border p-4 pointer-events-auto space-y-3"
        style={{
          top: `${cardPosition.top}px`,
          left: `${cardPosition.left}px`,
          width: `${cardPosition.width}px`,
          background: 'linear-gradient(165deg, rgba(15, 32, 39, 0.96), rgba(8, 47, 73, 0.95))',
          borderColor: 'rgba(56, 189, 248, 0.38)',
          boxShadow: '0 18px 50px rgba(2, 6, 23, 0.5)',
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-black tracking-widest text-cyan-300 uppercase">
            User Guide
          </p>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded border border-cyan-500/40 text-cyan-100 bg-cyan-900/30">
            {stepLabel}
          </span>
        </div>

        <div>
          <p className="text-base font-black text-white">{currentStep.title}</p>
          <p className="text-sm text-slate-200 mt-1">{currentStep.description}</p>
          <p className="text-[10px] text-slate-400 mt-2">
            Route: <span className="text-cyan-300">{currentStep.route}</span>
          </p>
          {targetMissing && (
            <p className="text-[11px] text-amber-300 mt-2">
              Target not visible on this screen. Continue or navigate manually.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 justify-between">
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={prevStep} disabled={!canGoBack}>
              Back
            </Button>
            <Button size="sm" variant="outline" onClick={skipGuide}>
              Skip
            </Button>
          </div>

          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={closeGuide}>
              Close
            </Button>
            <Button size="sm" onClick={nextStep} disabled={!canAdvance}>
              {lastStep ? 'Complete' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

