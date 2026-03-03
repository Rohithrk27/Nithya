import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { createPageUrl } from '../utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { resolveAccountDisplayName } from '@/lib/accountSessions';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('login'); // 'login', 'signup', 'forgotPassword'
  const [message, setMessage] = useState(null);
  const [messageType, setMessageType] = useState(null); // 'success' or 'error'
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [switchingSavedAccountId, setSwitchingSavedAccountId] = useState('');
  
  const navigate = useNavigate();
  const location = useLocation();
  const {
    user,
    accounts,
    login,
    signup,
    resetPassword,
    loginWithGoogle,
    switchAccount,
    isSwitchingAccount,
    isAuthenticated,
    isLoadingAuth,
  } = useAuth();
  const defaultRedirect = createPageUrl('Dashboard');
  const landingPath = createPageUrl('Landing');
  const [pendingPostAuthRedirect, setPendingPostAuthRedirect] = useState(false);
  const addAccountMode = useMemo(() => new URLSearchParams(location.search).get('add_account') === '1', [location.search]);
  const savedAccounts = useMemo(() => (Array.isArray(accounts) ? accounts : []), [accounts]);

  const normalizeErrorMessage = (errorLike) => {
    const raw = typeof errorLike === 'string' ? errorLike : (errorLike?.message || 'Unexpected error occurred.');
    const lower = raw.toLowerCase();
    if (lower.includes('admin_login_rate_limited')) {
      return 'Too many admin login attempts. Please wait 15 minutes before trying again.';
    }
    if (lower.includes('failed to fetch') || lower.includes('network error') || lower.includes('network timeout') || lower.includes('unable to reach supabase')) {
      return 'Network error: unable to reach server. Check internet/VPN/firewall and try again.';
    }
    return raw;
  };
  
  useEffect(() => {
    const qMode = new URLSearchParams(location.search).get('mode');
    if (qMode === 'signup' || qMode === 'login' || qMode === 'forgotPassword') {
      setMode(qMode);
    }
  }, [location.search]);

  const redirectTarget = useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get('redirect');
    if (!raw) return defaultRedirect;
    try {
      const url = new URL(raw, window.location.origin);
      if (url.origin === window.location.origin) {
        return `${url.pathname}${url.search}${url.hash}`;
      }
    } catch {
      // Ignore malformed redirect and fallback
    }
    if (raw.startsWith('/')) return raw.toLowerCase();
    return defaultRedirect;
  }, [defaultRedirect]);

  const resolvePostAuthPath = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return createPageUrl('Login');
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, role')
        .eq('id', user.id)
        .maybeSingle();
      if (profileError) return redirectTarget;
      if (!profile) return landingPath;
      const role = String(profile.role || 'user').trim().toLowerCase();
      if (role === 'admin' && redirectTarget === defaultRedirect) {
        return '/admin-dashboard';
      }
      return redirectTarget;
    } catch {
      return redirectTarget;
    }
  }, [defaultRedirect, landingPath, redirectTarget]);

  useEffect(() => {
    if (!pendingPostAuthRedirect) return;
    if (isLoadingAuth || !isAuthenticated) return;
    let cancelled = false;
    const finishRedirect = async () => {
      const nextPath = await resolvePostAuthPath();
      if (!cancelled) {
        navigate(nextPath, { replace: true });
        setPendingPostAuthRedirect(false);
      }
    };
    void finishRedirect();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isLoadingAuth, navigate, pendingPostAuthRedirect, resolvePostAuthPath]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);
    setMessageType(null);
    setLoading(true);

    try {
      if (mode === 'login') {
        const { error } = await login(email, password);
        
        if (error) {
          setMessage(normalizeErrorMessage(error));
          setMessageType('error');
        } else {
          setMessage(addAccountMode ? 'Account added. Switching now...' : 'Login successful! Redirecting...');
          setMessageType('success');
          setPendingPostAuthRedirect(true);
        }
        
      } else if (mode === 'signup') {
        const { data, error } = await signup(email, password);
        
        if (error) {
          setMessage(normalizeErrorMessage(error));
          setMessageType('error');
        } else {
          if (data?.session) {
            setMessage('Account created! Redirecting to profile setup...');
            setMessageType('success');
            setTimeout(() => navigate(landingPath, { replace: true }), 500);
          } else {
            setMessage('Account created! Please check your email to verify your account, then sign in.');
            setMessageType('success');
          }
        }
        
      } else if (mode === 'forgotPassword') {
        const { error } = await resetPassword(email);
        
        if (error) {
          setMessage(normalizeErrorMessage(error));
          setMessageType('error');
        } else {
          setMessage('Password reset link sent! Check your email.');
          setMessageType('success');
        }
      }
    } catch (err) {
      setMessage(normalizeErrorMessage(err));
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setMessage(null);
    setMessageType(null);
    setGoogleLoading(true);
    try {
      const oauthRedirect = `${window.location.origin}${redirectTarget}`;
      const { error } = await loginWithGoogle(oauthRedirect);
      if (error) {
        setMessage(normalizeErrorMessage(error));
        setMessageType('error');
      }
    } catch (err) {
      setMessage(normalizeErrorMessage(err) || 'Google sign-in failed.');
      setMessageType('error');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleSavedAccountSwitch = async (accountId) => {
    const safeId = String(accountId || '').trim();
    if (!safeId) return;
    setMessage(null);
    setMessageType(null);
    setSwitchingSavedAccountId(safeId);
    try {
      const { error } = await switchAccount(safeId);
      if (error) {
        setMessage(normalizeErrorMessage(error));
        setMessageType('error');
      } else {
        setMessage('Account switched successfully. Redirecting...');
        setMessageType('success');
        setPendingPostAuthRedirect(true);
      }
    } catch (err) {
      setMessage(normalizeErrorMessage(err));
      setMessageType('error');
    } finally {
      setSwitchingSavedAccountId('');
    }
  };

  const renderForm = () => {
    if (mode === 'forgotPassword') {
      return (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="email" className="text-[#94A3B8]">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="mt-1 h-12 bg-[#0F172A] border-[#334155] text-[#F8FAFC]"
            />
          </div>
          <Button type="submit" disabled={loading} className="w-full h-12 bg-gradient-to-r from-[#3B82F6] to-[#0EA5E9] hover:from-[#3B82F6]/90 hover:to-[#0EA5E9]/90 text-white">
            {loading ? 'Sending...' : 'Send Reset Link'}
          </Button>
          <button
            type="button"
            onClick={() => { setMode('login'); setMessage(null); }}
            className="w-full text-sm text-[#94A3B8] hover:text-[#F8FAFC] underline"
          >
            Back to Sign In
          </button>
        </form>
      );
    }

    return (
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="email" className="text-[#94A3B8]">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            className="mt-1 h-12 bg-[#0F172A] border-[#334155] text-[#F8FAFC]"
          />
        </div>
        <div>
          <Label htmlFor="password" className="text-[#94A3B8]">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            className="mt-1 h-12 bg-[#0F172A] border-[#334155] text-[#F8FAFC]"
          />
        </div>

        {mode === 'login' && (
          <div className="text-right">
            <button
              type="button"
              onClick={() => { setMode('forgotPassword'); setMessage(null); }}
              className="text-sm text-[#94A3B8] hover:text-[#F8FAFC] underline"
            >
              Forgot Password?
            </button>
          </div>
        )}

        <Button type="submit" disabled={loading} className="w-full h-12 bg-gradient-to-r from-[#3B82F6] to-[#0EA5E9] hover:from-[#3B82F6]/90 hover:to-[#0EA5E9]/90 text-white">
          {loading ? (mode === 'login' ? 'Signing in...' : 'Signing up...') : (mode === 'login' ? 'Sign In' : 'Sign Up')}
        </Button>
        {(mode === 'login' || mode === 'signup') && (
          <>
            <div className="relative py-1">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-[#334155]" />
              </div>
              <div className="relative flex justify-center text-[10px] uppercase tracking-widest">
                <span className="bg-[#1E293B] px-2 text-[#64748B]">Or</span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={googleLoading}
              className="w-full h-12 rounded-md border border-slate-200 bg-white text-slate-900 hover:bg-slate-100 disabled:opacity-60 disabled:cursor-not-allowed font-semibold inline-flex items-center justify-center gap-2"
              style={{ color: '#0f172a', fontWeight: 700 }}
            >
              <span className="text-base leading-none" style={{ color: '#ea4335' }}>G</span>
              <span style={{ color: '#0f172a' }}>
                {googleLoading ? 'Connecting...' : (mode === 'login' ? 'Sign in with Google' : 'Sign up with Google')}
              </span>
            </button>
          </>
        )}

        <div className="text-center mt-4">
          <button
            type="button"
            onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setMessage(null); }}
            className="text-sm text-[#94A3B8] hover:text-[#F8FAFC] underline"
          >
            {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
          </button>
        </div>

        {mode === 'login' && savedAccounts.length > 0 && (
          <div className="mt-4 rounded-lg border border-[#334155] bg-[#0F172A]/70 p-3 space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-[#64748B] font-bold">Saved Accounts</p>
            <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
              {savedAccounts.map((account) => {
                const accountId = String(account?.account_id || account?.user_id || '');
                const isCurrent = !!user?.id && accountId === String(user.id);
                const isBusy = switchingSavedAccountId === accountId || (isSwitchingAccount && switchingSavedAccountId);
                return (
                  <div
                    key={accountId}
                    className="rounded-md border border-[#334155] bg-[#1E293B]/80 px-2.5 py-2 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs text-[#E2E8F0] truncate">
                        {resolveAccountDisplayName(account)}
                      </p>
                      <p className="text-[10px] text-[#94A3B8] truncate">
                        {String(account?.email || account?.user_id || '')}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={isCurrent || !!isBusy}
                      onClick={() => void handleSavedAccountSwitch(accountId)}
                      className="text-[11px] font-semibold px-2 py-1 rounded-md border disabled:opacity-60 disabled:cursor-not-allowed"
                      style={{
                        borderColor: isCurrent ? 'rgba(56,189,248,0.5)' : 'rgba(148,163,184,0.35)',
                        color: isCurrent ? '#38BDF8' : '#E2E8F0',
                        background: isCurrent ? 'rgba(2,132,199,0.15)' : 'rgba(15,23,42,0.7)',
                      }}
                    >
                      {isCurrent ? 'Current' : (isBusy ? 'Switching...' : 'Switch')}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </form>
    );
  };

  return (
    <div className="min-h-screen bg-[#0F172A] flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full"
      >
        <Card className="border border-[#334155] shadow-2xl bg-[#1E293B]">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-3xl font-bold bg-gradient-to-r from-[#3B82F6] to-[#0EA5E9] bg-clip-text text-transparent">
              {mode === 'forgotPassword' ? 'Reset Password' : (mode === 'login' ? 'Welcome Back' : 'Create Account')}
            </CardTitle>
            <CardDescription className="text-base text-[#94A3B8]">
              {mode === 'forgotPassword' 
                ? 'Enter your email to receive a reset link' 
                : (mode === 'login' 
                  ? 'Sign in to continue your journey' 
                  : 'Start your discipline journey')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {addAccountMode && (
              <div className="mb-3 rounded-lg border border-[#1d4ed8]/40 bg-[#1d4ed8]/10 p-2 text-xs text-[#93c5fd]">
                Add account mode: sign in to store this account for quick switching.
              </div>
            )}
            {renderForm()}
            {message && (
              <div className={`mt-4 p-3 rounded-lg text-sm ${messageType === 'success' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                {message}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

