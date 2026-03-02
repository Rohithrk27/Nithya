import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SystemBackground from '@/components/SystemBackground';
import HoloPanel from '@/components/HoloPanel';
import { useAuth } from '@/lib/AuthContext';
import { createPageUrl } from '@/utils';

const formatDateTime = (value) => {
  if (!value) return 'Permanent suspension';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Until further review';
  return d.toLocaleString();
};

export default function Suspended() {
  const navigate = useNavigate();
  const {
    isAuthenticated,
    isLoadingAuth,
    isSuspended,
    suspensionReason,
    suspendedUntil,
    refreshProfileStatus,
    logout,
  } = useAuth();
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) {
      navigate(createPageUrl('Login'), { replace: true });
      return;
    }
    if (!isSuspended) {
      navigate(createPageUrl('Dashboard'), { replace: true });
    }
  }, [isAuthenticated, isLoadingAuth, isSuspended, navigate]);

  const reason = useMemo(
    () => (suspensionReason || 'Your account is temporarily restricted by admin moderation.'),
    [suspensionReason]
  );

  const handleRefresh = async () => {
    setChecking(true);
    try {
      await refreshProfileStatus();
    } finally {
      setChecking(false);
    }
  };

  if (isLoadingAuth) {
    return (
      <SystemBackground>
        <div className="min-h-screen flex items-center justify-center text-slate-300">Checking account status...</div>
      </SystemBackground>
    );
  }

  return (
    <SystemBackground>
      <div className="max-w-xl mx-auto p-4 md:p-6 min-h-screen flex items-center">
        <HoloPanel glowColor="#F87171" active>
          <div className="space-y-3">
            <p className="text-red-300 text-xs tracking-widest font-black flex items-center gap-2">
              <ShieldAlert className="w-3.5 h-3.5" /> ACCOUNT SUSPENDED
            </p>
            <p className="text-white text-lg font-black">Access is currently restricted.</p>
            <p className="text-sm text-slate-300 whitespace-pre-wrap break-words">{reason}</p>
            <p className="text-xs text-slate-400">
              {suspendedUntil ? `Suspended until: ${formatDateTime(suspendedUntil)}` : 'Suspension duration: Permanent until admin review'}
            </p>
            <div className="pt-2 flex flex-col sm:flex-row gap-2">
              <Button onClick={handleRefresh} disabled={checking}>
                <RefreshCcw className="w-4 h-4 mr-2" />
                {checking ? 'Checking...' : 'Recheck Access'}
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  await logout();
                  navigate(createPageUrl('Login'), { replace: true });
                }}
              >
                Sign Out
              </Button>
            </div>
          </div>
        </HoloPanel>
      </div>
    </SystemBackground>
  );
}
