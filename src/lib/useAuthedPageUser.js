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
  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  const authReady = !isLoadingAuth;

  useEffect(() => {
    if (!authReady) return;
    if (!isAuthenticated || !user?.id) {
      navigate(createPageUrl(redirectPage), { replace: true });
    }
  }, [authReady, isAuthenticated, navigate, redirectPage, user?.id]);

  return { user: isAuthenticated ? user : null, authReady };
}

export default useAuthedPageUser;
