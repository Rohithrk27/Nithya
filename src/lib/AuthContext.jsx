import React, { createContext, useState, useContext, useEffect } from 'react';
import { supabase } from './supabase';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [emailConfirmationPending, setEmailConfirmationPending] = useState(false);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (authUser) {
          setUser(authUser);
          setIsAuthenticated(true);
        }
      } catch (error) {
        setAuthError(error?.message || 'Unable to load auth session');
      } finally {
        setIsLoadingAuth(false);
      }
    };

    loadUser();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        setUser(session.user);
        setIsAuthenticated(true);
        setEmailConfirmationPending(false);
      } else {
        setUser(null);
        setIsAuthenticated(false);
      }
      setIsLoadingAuth(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const login = async (email, password) => {
    setAuthError(null);
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      setAuthError(error.message);
      return { error };
    }

    return { data };
  };

  const signup = async (email, password) => {
    setAuthError(null);
    const { data, error } = await supabase.auth.signUp({
      email,
      password
    });

    if (error) {
      setAuthError(error.message);
      return { error };
    }

    // Check if email confirmation is required
    if (data?.user?.identities?.length === 0) {
      setEmailConfirmationPending(false);
      return { error: 'User already exists' };
    }

    if (!data.session) {
      // Email confirmation required
      setEmailConfirmationPending(true);
    }

    return { data };
  };

  const loginWithGoogle = async (redirectTo = `${window.location.origin}/dashboard`) => {
    setAuthError(null);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
      },
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

  return (
    <AuthContext.Provider value={{ 
      user, 
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
    }}>
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
