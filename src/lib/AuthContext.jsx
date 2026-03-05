import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import { supabase } from './supabase';
import {
  NATIVE_AUTH_CALLBACK,
  buildOAuthRedirect,
  buildResetPasswordRedirect,
  isNativeAndroid,
  normalizeAppPath,
  rememberOAuthNextPath,
} from './authRedirect';

const AuthContext = createContext(null);

const firstRow = (data) => (Array.isArray(data) ? (data[0] || null) : (data || null));
const AUTH_SNAPSHOT_KEY = '__nithya_auth_snapshot_v1__';
const AUTH_SNAPSHOT_TTL_MS = 2 * 60 * 60 * 1000;
const SYSTEM_CONTROLS_CACHE_TTL_MS = 30 * 1000;

const isLikelyNativeAndroidRuntime = () => {
  if (isNativeAndroid()) return true;
  if (typeof window === 'undefined') return false;

  try {
    const cap = window?.Capacitor;
    const capNative = typeof cap?.isNativePlatform === 'function' ? !!cap.isNativePlatform() : false;
    const capPlatform = typeof cap?.getPlatform === 'function' ? String(cap.getPlatform() || '').toLowerCase() : '';
    if (capNative && (capPlatform === 'android' || capPlatform === '')) return true;
    if (window.location.protocol === 'capacitor:') return true;
  } catch (_) {
    // Ignore runtime probe failures.
  }
  return false;
};

const forceNativeOAuthRedirect = (urlLike) => {
  if (!urlLike) return '';
  try {
    const parsed = new URL(urlLike);
    parsed.searchParams.set('redirect_to', NATIVE_AUTH_CALLBACK);
    return parsed.toString();
  } catch (_) {
    return String(urlLike);
  }
};

const forceOAuthRedirectTarget = (urlLike, redirectTo) => {
  if (!urlLike) return '';
  try {
    const parsed = new URL(urlLike);
    if (redirectTo) {
      parsed.searchParams.set('redirect_to', redirectTo);
    }
    return parsed.toString();
  } catch (_) {
    return String(urlLike);
  }
};

const isLocalWebHost = () => {
  if (typeof window === 'undefined') return false;
  const host = String(window.location.hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
};

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

const readAuthSnapshot = () => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(AUTH_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const ts = Number(parsed?.ts || 0);
    if (Number.isFinite(ts) && Date.now() - ts > AUTH_SNAPSHOT_TTL_MS) {
      window.localStorage.removeItem(AUTH_SNAPSHOT_KEY);
      return null;
    }
    return {
      user: parsed?.user || null,
      profile: parsed?.profile || null,
      maintenanceMode: !!parsed?.maintenanceMode,
    };
  } catch (_) {
    return null;
  }
};

const writeAuthSnapshot = ({ user = null, profile = null, maintenanceMode = false } = {}) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      AUTH_SNAPSHOT_KEY,
      JSON.stringify({
        ts: Date.now(),
        user,
        profile,
        maintenanceMode: !!maintenanceMode,
      }),
    );
  } catch (_) {
    // Ignore storage failures.
  }
};

const getSessionSignature = (session) => {
  const userId = String(session?.user?.id || 'anon');
  const accessToken = String(session?.access_token || '');
  const tokenTail = accessToken.slice(-20);
  return `${userId}:${tokenTail}`;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [emailConfirmationPending, setEmailConfirmationPending] = useState(false);
  const [profile, setProfile] = useState(null);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const controlsCacheRef = useRef({ ts: 0, value: false });
  const lastSessionSignatureRef = useRef('');
  const hydratedFromSnapshotRef = useRef(false);

  const loadSystemControls = useCallback(async ({ force = false } = {}) => {
    const now = Date.now();
    if (!force && (now - controlsCacheRef.current.ts) < SYSTEM_CONTROLS_CACHE_TTL_MS) {
      const cachedValue = !!controlsCacheRef.current.value;
      setMaintenanceMode(cachedValue);
      return cachedValue;
    }

    try {
      const { data, error } = await supabase.rpc('get_system_controls_public');
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      const maintenanceRow = rows.find((row) => row?.key === 'maintenance_mode');
      const enabled = !!maintenanceRow?.enabled;
      controlsCacheRef.current = { ts: Date.now(), value: enabled };
      setMaintenanceMode(enabled);
      return enabled;
    } catch (_) {
      controlsCacheRef.current = { ts: Date.now(), value: false };
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

  const applySession = useCallback((session, { force = false } = {}) => {
    const signature = getSessionSignature(session);
    if (!force && signature === lastSessionSignatureRef.current) {
      return;
    }
    lastSessionSignatureRef.current = signature;

    const authUser = session?.user || null;
    if (!authUser) {
      setUser(null);
      setProfile(null);
      setIsAuthenticated(false);
      setEmailConfirmationPending(false);
      setAuthError(null);
      setIsLoadingAuth(false);
      void loadSystemControls();
      return;
    }
    setUser(authUser);
    setIsAuthenticated(true);
    setEmailConfirmationPending(false);
    setAuthError(null);
    setIsLoadingAuth(false);
    void Promise.allSettled([
      loadProfileStatus(authUser),
      loadSystemControls(),
    ]);
  }, [loadProfileStatus, loadSystemControls]);

  useEffect(() => {
    if (!hydratedFromSnapshotRef.current) {
      hydratedFromSnapshotRef.current = true;
      const snapshot = readAuthSnapshot();
      if (snapshot) {
        setUser(snapshot.user || null);
        setProfile(snapshot.profile || null);
        setMaintenanceMode(!!snapshot.maintenanceMode);
        setIsAuthenticated(!!snapshot.user);
        setIsLoadingAuth(false);
      }
    }

    const loadUser = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        applySession(session || null, { force: true });
      } catch (error) {
        setAuthError(error?.message || 'Unable to load auth session');
        setIsLoadingAuth(false);
      }
    };

    loadUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      applySession(session || null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [applySession]);

  useEffect(() => {
    const syncAuthFromCallback = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        applySession(session || null, { force: true });
      } catch (_) {
        // Ignore callback sync errors; normal listeners still apply.
      }
    };

    window.addEventListener('nithya-auth-complete', syncAuthFromCallback);
    return () => {
      window.removeEventListener('nithya-auth-complete', syncAuthFromCallback);
    };
  }, [applySession]);

  useEffect(() => {
    if (isLoadingAuth) return;
    writeAuthSnapshot({
      user: user || null,
      profile: profile || null,
      maintenanceMode: !!maintenanceMode,
    });
  }, [isLoadingAuth, maintenanceMode, profile, user]);

  useEffect(() => {
    if (!isAuthenticated) return undefined;
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
  }, [isAuthenticated, loadSystemControls]);

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

  const loginWithGoogle = async (redirectPath = '/dashboard') => {
    setAuthError(null);
    const safeNextPath = normalizeAppPath(redirectPath, '/dashboard');
    rememberOAuthNextPath(safeNextPath);
    const nativeRuntime = isLikelyNativeAndroidRuntime();
    const redirectTo = nativeRuntime ? NATIVE_AUTH_CALLBACK : buildOAuthRedirect(safeNextPath);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    });

    if (error) {
      setAuthError(error.message);
      return { error };
    }

    if (!data?.url) {
      const missingUrlError = new Error('Google login did not return an authorization URL.');
      setAuthError(missingUrlError.message);
      return { error: missingUrlError };
    }

    const authUrl = nativeRuntime
      ? forceNativeOAuthRedirect(data.url)
      : forceOAuthRedirectTarget(data.url, redirectTo);

    // Hard guard: when developing on localhost web, never continue if Supabase
    // still points OAuth callback to production.
    if (!nativeRuntime && isLocalWebHost()) {
      try {
        const parsedAuth = new URL(authUrl);
        const redirectToValue = parsedAuth.searchParams.get('redirect_to');
        const expectedCallback = new URL(redirectTo);
        const returnedCallback = redirectToValue ? new URL(redirectToValue) : null;
        const callbackMismatch = !returnedCallback
          || returnedCallback.origin !== expectedCallback.origin
          || returnedCallback.pathname !== expectedCallback.pathname;
        if (callbackMismatch) {
          const cfgError = new Error(
            `Supabase redirect misconfigured for localhost. Add ${expectedCallback.toString()} to Auth Redirect URLs.`,
          );
          setAuthError(cfgError.message);
          return { error: cfgError };
        }
      } catch (_) {
        const cfgError = new Error('Could not validate OAuth redirect target for localhost.');
        setAuthError(cfgError.message);
        return { error: cfgError };
      }
    }

    // Guardrail: if Android is expected but Supabase generated a web callback,
    // fail fast with a clear action instead of silently opening web auth flow.
    if (nativeRuntime) {
      const encodedNative = encodeURIComponent(NATIVE_AUTH_CALLBACK);
      const hasNativeCallback = data.url.includes(encodedNative) || data.url.includes(NATIVE_AUTH_CALLBACK);
      if (!hasNativeCallback) {
        const cfgError = new Error(`Supabase redirect misconfigured. Add ${NATIVE_AUTH_CALLBACK} to Auth Redirect URLs.`);
        setAuthError(cfgError.message);
        return { error: cfgError };
      }
    }

    window.location.assign(authUrl);
    return { data: { ...data, url: authUrl } };
  };

  const logout = async () => {
    setAuthError(null);
    const { error } = await supabase.auth.signOut({ scope: 'local' });
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
      redirectTo: buildResetPasswordRedirect(),
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
