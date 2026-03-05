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

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('login'); // 'login', 'signup', 'forgotPassword'
  const [message, setMessage] = useState(null);
  const [messageType, setMessageType] = useState(null); // 'success' or 'error'
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  
  const navigate = useNavigate();
  const location = useLocation();
  const {
    login,
    signup,
    resetPassword,
    loginWithGoogle,
    isAuthenticated,
    isLoadingAuth,
  } = useAuth();
  const defaultRedirect = createPageUrl('Dashboard');
  const landingPath = createPageUrl('Landing');
  const [pendingPostAuthRedirect, setPendingPostAuthRedirect] = useState(false);

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

  useEffect(() => {
    const oauthError = new URLSearchParams(location.search).get('oauth_error');
    if (!oauthError) return;

    const messageByCode = {
      callback_failed: 'Google sign-in callback failed. Please try again.',
    };
    setMessage(messageByCode[oauthError] || 'Google sign-in failed. Please try again.');
    setMessageType('error');
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

  useEffect(() => {
    if (isLoadingAuth || !isAuthenticated) return;
    let cancelled = false;
    const finishRedirect = async () => {
      const nextPath = await resolvePostAuthPath();
      if (!cancelled) {
        navigate(nextPath, { replace: true });
      }
    };
    void finishRedirect();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isLoadingAuth, navigate, resolvePostAuthPath]);

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
          setMessage('Login successful! Redirecting...');
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
      const { error } = await loginWithGoogle(redirectTarget);
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

  const primaryActionClass =
    'w-full h-12 tap-target tap-ripple active:scale-[0.99] bg-gradient-to-r from-[#2563EB] via-[#0EA5E9] to-[#06B6D4] text-white shadow-[0_10px_30px_rgba(37,99,235,0.35)] hover:brightness-110 transition';
  const inputClass =
    'mt-1 h-12 tap-target bg-[#0A1424]/90 border-[#2E405E] text-[#E5ECF6] placeholder:text-[#6C7B95] focus-visible:ring-2 focus-visible:ring-[#38BDF8]/50 focus-visible:border-[#38BDF8]';
  const ghostLinkClass =
    'text-sm text-[#95A4BC] active:text-[#F8FAFC] focus-visible:text-[#F8FAFC] underline underline-offset-4 decoration-[#334155]';

  const renderForm = () => {
    if (mode === 'forgotPassword') {
      return (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="email" className="text-[#A6B4C8]">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className={inputClass}
            />
          </div>
          <Button type="submit" disabled={loading} className={primaryActionClass}>
            {loading ? 'Sending...' : 'Send Reset Link'}
          </Button>
          <button
            type="button"
            onClick={() => { setMode('login'); setMessage(null); }}
            className={`w-full ${ghostLinkClass}`}
          >
            Back to Sign In
          </button>
        </form>
      );
    }

    return (
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="email" className="text-[#A6B4C8]">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            className={inputClass}
          />
        </div>
        <div>
          <Label htmlFor="password" className="text-[#A6B4C8]">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            className={inputClass}
          />
        </div>

        {mode === 'login' && (
          <div className="text-right">
            <button
              type="button"
              onClick={() => { setMode('forgotPassword'); setMessage(null); }}
              className={ghostLinkClass}
            >
              Forgot Password?
            </button>
          </div>
        )}

        <Button type="submit" disabled={loading} className={primaryActionClass}>
          {loading ? (mode === 'login' ? 'Signing in...' : 'Signing up...') : (mode === 'login' ? 'Sign In' : 'Sign Up')}
        </Button>
        {(mode === 'login' || mode === 'signup') && (
          <>
            <div className="relative py-1">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-[#2B3A52]" />
              </div>
              <div className="relative flex justify-center text-[10px] uppercase tracking-widest">
                <span className="bg-[#121E30] px-2 text-[#667891]">Or continue with</span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={googleLoading}
              className="w-full h-12 tap-target tap-ripple rounded-md border border-[#314666] bg-white text-slate-900 active:bg-slate-100 disabled:opacity-60 disabled:cursor-not-allowed font-semibold inline-flex items-center justify-center gap-2 shadow-[0_8px_24px_rgba(15,23,42,0.28)]"
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
            className={ghostLinkClass}
          >
            {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
          </button>
        </div>
      </form>
    );
  };

  return (
    <div className="relative min-h-screen bg-[#07111F] safe-top safe-bottom flex items-center justify-center p-6 overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-20 -left-20 h-72 w-72 rounded-full bg-[#2563EB]/30 blur-3xl" />
        <div className="absolute top-1/3 -right-24 h-80 w-80 rounded-full bg-[#0EA5E9]/20 blur-3xl" />
        <div className="absolute -bottom-24 left-1/3 h-72 w-72 rounded-full bg-[#14B8A6]/20 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(148,163,184,0.35) 1px, transparent 0)',
            backgroundSize: '22px 22px',
          }}
        />
      </div>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative max-w-md w-full"
      >
        <Card className="border border-[#2E405E] shadow-[0_24px_60px_rgba(2,6,23,0.58)] bg-[linear-gradient(165deg,rgba(15,26,43,0.98),rgba(17,34,53,0.95))] backdrop-blur-sm">
          <CardHeader className="text-center pb-4">
            {mode !== 'forgotPassword' && (
              <div className="mx-auto mb-4 grid w-full max-w-xs grid-cols-2 rounded-xl border border-[#2E405E] bg-[#0A1424]/80 p-1">
                <button
                  type="button"
                  onClick={() => { setMode('login'); setMessage(null); }}
                  className={`h-9 rounded-lg text-sm font-semibold transition ${mode === 'login' ? 'bg-gradient-to-r from-[#2563EB] to-[#0EA5E9] text-white shadow-[0_8px_20px_rgba(37,99,235,0.35)]' : 'text-[#93A4BC] hover:text-[#E2E8F0]'}`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => { setMode('signup'); setMessage(null); }}
                  className={`h-9 rounded-lg text-sm font-semibold transition ${mode === 'signup' ? 'bg-gradient-to-r from-[#2563EB] to-[#0EA5E9] text-white shadow-[0_8px_20px_rgba(37,99,235,0.35)]' : 'text-[#93A4BC] hover:text-[#E2E8F0]'}`}
                >
                  Sign Up
                </button>
              </div>
            )}
            <CardTitle className="text-3xl font-bold bg-gradient-to-r from-[#60A5FA] via-[#38BDF8] to-[#22D3EE] bg-clip-text text-transparent">
              {mode === 'forgotPassword' ? 'Reset Password' : (mode === 'login' ? 'Welcome Back' : 'Create Account')}
            </CardTitle>
            <CardDescription className="text-base text-[#A1B2C9] mobile-readable">
              {mode === 'forgotPassword' 
                ? 'Enter your email to receive a reset link' 
                : (mode === 'login' 
                  ? 'Sign in to continue your journey' 
                  : 'Start your discipline journey')}
            </CardDescription>
            {mode !== 'forgotPassword' && (
              <div className="mx-auto mt-3 inline-flex items-center rounded-full border border-[#2D3F5B] bg-[#0A1424]/80 px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-[#7FA6D1]">
                Secure Access
              </div>
            )}
          </CardHeader>
          <CardContent>
            {renderForm()}
            {message && (
              <div className={`mt-4 p-3 rounded-lg text-sm border ${messageType === 'success' ? 'bg-green-500/20 text-green-300 border-green-400/30' : 'bg-red-500/20 text-red-300 border-red-400/30'}`}>
                {message}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

