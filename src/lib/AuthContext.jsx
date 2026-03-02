import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { supabase } from './supabase';

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
  const [authError, setAuthError] = useState(null);
  const [emailConfirmationPending, setEmailConfirmationPending] = useState(false);
  const [profile, setProfile] = useState(null);
  const [maintenanceMode, setMaintenanceMode] = useState(false);

  const loadSystemControls = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_system_controls_public');
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      const maintenanceRow = rows.find((row) => row?.key === 'maintenance_mode');
      const enabled = !!maintenanceRow?.enabled;
      setMaintenanceMode(enabled);
      return enabled;
    } catch (_) {
      setMaintenanceMode(false);
      return false;
    }
  }, []);

  const loadProfileStatus = useCallback(async (authUser) => {
    if (!authUser?.id) {
      setProfile(null);
      return null;
    }

    try {
      const { data, error } = await supabase.rpc('resolve_own_profile_status');
      if (!error) {
        const row = normalizeProfileStatus(firstRow(data), authUser.id);
        setProfile(row);
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
      return row;
    } catch (_) {
      const fallback = normalizeProfileStatus(null, authUser.id);
      setProfile(fallback);
      return fallback;
    }
  }, []);

  const applySession = useCallback(async (session) => {
    const authUser = session?.user || null;
    if (!authUser) {
      setUser(null);
      setProfile(null);
      setIsAuthenticated(false);
      setEmailConfirmationPending(false);
      await loadSystemControls();
      setIsLoadingAuth(false);
      return;
    }
    setUser(authUser);
    setIsAuthenticated(true);
    setEmailConfirmationPending(false);
    await loadProfileStatus(authUser);
    await loadSystemControls();
    setIsLoadingAuth(false);
  }, [loadProfileStatus, loadSystemControls]);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        await applySession(session || null);
      } catch (error) {
        setAuthError(error?.message || 'Unable to load auth session');
        setIsLoadingAuth(false);
      }
    };

    loadUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      await applySession(session || null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [applySession]);

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
    const { error } = await supabase.auth.signOut();
    if (error) {
      setAuthError(error.message);
    }
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
    return loadProfileStatus(user);
  };

  const refreshSystemControls = async () => loadSystemControls();

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
      authError,
      emailConfirmationPending,
      login,
      loginWithGoogle,
      signup,
      logout,
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
