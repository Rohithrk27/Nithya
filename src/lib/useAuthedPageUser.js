import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { useAuth } from '@/lib/AuthContext';

/**
 * Shared auth bootstrap for protected pages.
 * Redirects unauthenticated users to `redirectPage`.
 */
export function useAuthedPageUser({ redirectPage = 'Landing' } = {}) {
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoadingAuth, isSuspended, maintenanceMode, profileRole } = useAuth();
  const authReady = !isLoadingAuth;

  useEffect(() => {
    if (!authReady) return;
    if (!isAuthenticated || !user?.id) {
      navigate(createPageUrl(redirectPage), { replace: true });
      return;
    }
    if (isSuspended) {
      navigate('/suspended', { replace: true });
      return;
    }
    if (maintenanceMode && profileRole !== 'admin') {
      navigate('/maintenance', { replace: true });
    }
  }, [authReady, isAuthenticated, isSuspended, maintenanceMode, navigate, profileRole, redirectPage, user?.id]);

  return { user: isAuthenticated ? user : null, authReady, isSuspended, maintenanceMode };
}

export default useAuthedPageUser;
