import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { createPageUrl } from '@/utils';

/**
 * Shared auth bootstrap for protected pages.
 * Redirects unauthenticated users to `redirectPage`.
 */
export function useAuthedPageUser({ redirectPage = 'Landing' } = {}) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let active = true;

    const handleSessionUser = (sessionUser) => {
      if (!active) return;
      if (!sessionUser) {
        setUser(null);
        setAuthReady(true);
        navigate(createPageUrl(redirectPage), { replace: true });
        return;
      }
      setUser(sessionUser);
      setAuthReady(true);
    };

    const init = async () => {
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        handleSessionUser(authUser || null);
      } catch (_) {
        handleSessionUser(null);
      }
    };

    void init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      handleSessionUser(session?.user || null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [navigate, redirectPage]);

  return { user, authReady };
}

export default useAuthedPageUser;
