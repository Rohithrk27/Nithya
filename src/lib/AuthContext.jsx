import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { supabase } from './supabase';
import {
  activateStoredAccountSession,
  listStoredAccountSessions,
  removeStoredAccountSession,
  upsertStoredAccountSession,
  markStoredAccountUsed,
} from './accountSessions';
import { clearAdminSessionToken } from './admin';

// Simple in-memory cache with TTL for faster account switching
const CACHE_TTL_MS = 30000; // 30 seconds
const createCache = () => {
  let cache = { data: null, timestamp: 0 };
  return {
    get: () => {
      if (cache.data && Date.now() - cache.timestamp < CACHE_TTL_MS) {
        return cache.data;
      }
      return null;
    },
    set: (value) => {
      cache = { data: value, timestamp: Date.now() };
    },
    invalidate: () => {
      cache = { data: null, timestamp: 0 };
    },
  };
};

const profileCache = createCache();
const systemControlsCache = createCache();

const AuthContext = createContext(null);

const firstRow = (data) => (Array.isArray(data) ? (data[0] || null) : (data || null));

const normalizeProfileStatus = (row, userId) => {
  const role = String(row?.role || 'user').trim().toLowerCase() || 'user';
  const suspendedUntil = row?.suspended_until || null;
  const isSuspended = !!row?.is_suspended && (!suspendedUntil || new Date(suspendedUntil).getTime() > Date.now());
  return {
    id: userId || null,
    role,
    is_suspended: isSuspended,
    suspension_reason: row?.suspension_reason || null,
    suspended_until: suspendedUntil,
  };
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isSwitchingAccount, setIsSwitchingAccount] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [emailConfirmationPending, setEmailConfirmationPending] = useState(false);
  const [profile, setProfile] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [maintenanceMode, setMaintenanceMode] = useState(false);

  const refreshSavedAccounts = useCallback(() => {
    const rows = listStoredAccountSessions();
    setAccounts(rows);
    return rows;
  }, []);

const loadSystemControls = useCallback(async (skipCache = false) => {
    // Check cache first unless explicitly skipped
    if (!skipCache) {
      const cached = systemControlsCache.get();
      if (cached !== null) {
        setMaintenanceMode(cached);
        return cached;
      }
    }

    try {
      const { data, error } = await supabase.rpc('get_system_controls_public');
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      const maintenanceRow = rows.find((row) => row?.key === 'maintenance_mode');
      const enabled = !!maintenanceRow?.enabled;
      setMaintenanceMode(enabled);
      systemControlsCache.set(enabled);
      return enabled;
    } catch (_) {
      setMaintenanceMode(false);
      systemControlsCache.set(false);
      return false;
    }
  }, []);

const loadProfileStatus = useCallback(async (authUser, skipCache = false) => {
    if (!authUser?.id) {
      setProfile(null);
      profileCache.invalidate();
      return null;
    }

    // Check cache first unless explicitly skipped
    if (!skipCache) {
      const cached = profileCache.get();
      if (cached) {
        setProfile(cached);
        return cached;
      }
    }

    try {
      const { data, error } = await supabase.rpc('resolve_own_profile_status');
      if (!error) {
        const row = normalizeProfileStatus(firstRow(data), authUser.id);
        setProfile(row);
        profileCache.set(row);
        return row;
      }
    } catch (_) {
      // Fall through to direct profile lookup.
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, role, is_suspended, suspension_reason, suspended_until')
        .eq('id', authUser.id)
        .maybeSingle();
      if (error) throw error;
      const row = normalizeProfileStatus(data || null, authUser.id);
      setProfile(row);
      profileCache.set(row);
      return row;
    } catch (_) {
      const fallback = normalizeProfileStatus(null, authUser.id);
      setProfile(fallback);
      profileCache.set(fallback);
      return fallback;
    }
  }, []);

const applySession = useCallback(async (session, { markAccountUsed = true } = {}) => {
    const authUser = session?.user || null;
    if (!authUser) {
      setUser(null);
      setProfile(null);
      setIsAuthenticated(false);
      setEmailConfirmationPending(false);
      refreshSavedAccounts();
      await loadSystemControls();
      setIsLoadingAuth(false);
      return;
    }
    setUser(authUser);
    setIsAuthenticated(true);
    setEmailConfirmationPending(false);
    setAuthError(null);
    upsertStoredAccountSession(session, { markUsed: markAccountUsed });
    refreshSavedAccounts();
    
    // Invalidate caches when switching users to ensure fresh data
    // This is critical for proper admin role verification on account switch
    profileCache.invalidate();
    systemControlsCache.invalidate();
    
    // Parallelize profile and system controls loading for faster account switching
    // Pass skipCache=true to force fresh data fetch (important for admin verification)
    await Promise.all([
      loadProfileStatus(authUser, true),
      loadSystemControls(true),
    ]);
    
    setIsLoadingAuth(false);
  }, [loadProfileStatus, loadSystemControls, refreshSavedAccounts]);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        await applySession(session || null, { markAccountUsed: true });
      } catch (error) {
        setAuthError(error?.message || 'Unable to load auth session');
        refreshSavedAccounts();
        setIsLoadingAuth(false);
      }
    };

    loadUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      await applySession(session || null, { markAccountUsed: event !== 'TOKEN_REFRESHED' });
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [applySession, refreshSavedAccounts]);

  useEffect(() => {
    const channel = supabase
      .channel('system-controls-listener')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'system_controls' },
        () => {
          void loadSystemControls();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadSystemControls]);

  const login = async (email, password) => {
    setAuthError(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setAuthError(error.message);
      return { error };
    }

    return { data };
  };

  const signup = async (email, password) => {
    setAuthError(null);
    const { data, error } = await supabase.auth.signUp({ email, password });

    if (error) {
      setAuthError(error.message);
      return { error };
    }

    if (data?.user?.identities?.length === 0) {
      setEmailConfirmationPending(false);
      return { error: 'User already exists' };
    }

    if (!data.session) {
      setEmailConfirmationPending(true);
    }

    return { data };
  };

  const loginWithGoogle = async (redirectTo = `${window.location.origin}/dashboard`) => {
    setAuthError(null);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });

    if (error) {
      setAuthError(error.message);
      return { error };
    }

    return { data };
  };

  const logout = async () => {
    setAuthError(null);
    const currentUserId = user?.id ? String(user.id) : '';
    clearAdminSessionToken();
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) {
      setAuthError(error.message);
    }
    if (currentUserId) {
      removeStoredAccountSession(currentUserId);
    }
    refreshSavedAccounts();
    setUser(null);
    setProfile(null);
    setIsAuthenticated(false);
    setEmailConfirmationPending(false);
  };

  const navigateToLogin = (redirectUrl = window.location.href) => {
    window.location.href = '/login?redirect=' + encodeURIComponent(redirectUrl);
  };

  const checkEmailConfirmation = async () => {
    return user?.email_confirmed_at || false;
  };

  const resetPassword = async (email) => {
    setAuthError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) {
      setAuthError(error.message);
      return { error };
    }

    return { data: { message: 'Password reset email sent' } };
  };

const refreshProfileStatus = async () => {
    if (!user?.id) return null;
    // Force refresh by skipping cache
    return loadProfileStatus(user, true);
  };

  const refreshSystemControls = async () => {
    // Force refresh by skipping cache
    return loadSystemControls(true);
  };

  const listAccounts = () => refreshSavedAccounts();

  const addCurrentSessionToSwitcher = async () => {
    setAuthError(null);
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      setAuthError(error.message || 'Unable to read active session.');
      return { error };
    }
    const currentSession = data?.session || null;
    if (!currentSession) {
      return { error: new Error('No active session available to save.') };
    }
    upsertStoredAccountSession(currentSession, { markUsed: true });
    refreshSavedAccounts();
    return { data: currentSession };
  };

  const switchAccount = async (accountId) => {
    const safeId = String(accountId || '').trim();
    if (!safeId) {
      return { error: new Error('Invalid account selected.') };
    }

    if (user?.id && safeId === String(user.id)) {
      markStoredAccountUsed(safeId);
      refreshSavedAccounts();
      return { data: { already_active: true } };
    }

    setAuthError(null);
    setIsSwitchingAccount(true);
    setIsLoadingAuth(true);
    clearAdminSessionToken();

    try {
      const { data, error } = await activateStoredAccountSession(safeId);
      if (error) {
        removeStoredAccountSession(safeId);
        refreshSavedAccounts();
        setAuthError(error.message || 'Unable to switch account.');
        setIsLoadingAuth(false);
        return { error };
      }

      await applySession(data || null, { markAccountUsed: true });
      return { data };
    } catch (error) {
      removeStoredAccountSession(safeId);
      refreshSavedAccounts();
      setAuthError(error?.message || 'Unable to switch account.');
      setIsLoadingAuth(false);
      return { error };
    } finally {
      setIsSwitchingAccount(false);
    }
  };

  const removeSavedAccount = (accountId) => {
    const safeId = String(accountId || '').trim();
    if (!safeId) return { error: new Error('Invalid account selected.') };
    if (user?.id && safeId === String(user.id)) {
      return { error: new Error('Cannot remove currently active account.') };
    }
    const nextRows = removeStoredAccountSession(safeId);
    setAccounts(nextRows);
    return { data: nextRows };
  };

  const profileRole = profile?.role || 'user';
  const isSuspended = !!profile?.is_suspended;
  const suspensionReason = profile?.suspension_reason || null;
  const suspendedUntil = profile?.suspended_until || null;

  return (
    <AuthContext.Provider value={{
      user,
      profile,
      profileRole,
      isSuspended,
      suspensionReason,
      suspendedUntil,
      maintenanceMode,
      isAuthenticated,
      isLoadingAuth,
      isSwitchingAccount,
      authError,
      emailConfirmationPending,
      accounts,
      login,
      loginWithGoogle,
      signup,
      logout,
      listAccounts,
      switchAccount,
      addCurrentSessionToSwitcher,
      removeSavedAccount,
      navigateToLogin,
      checkEmailConfirmation,
      resetPassword,
      refreshProfileStatus,
      refreshSystemControls,
    }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
