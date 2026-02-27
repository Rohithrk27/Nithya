import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { createPageUrl } from '../utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '../lib/AuthContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('login'); // 'login', 'signup', 'forgotPassword'
  const [message, setMessage] = useState(null);
  const [messageType, setMessageType] = useState(null); // 'success' or 'error'
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  
  const navigate = useNavigate();
  const { login, signup, resetPassword, loginWithGoogle, isAuthenticated, isLoadingAuth } = useAuth();
  const defaultRedirect = createPageUrl('Dashboard');

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

  useEffect(() => {
    if (!isLoadingAuth && isAuthenticated) {
      navigate(redirectTarget, { replace: true });
    }
  }, [isAuthenticated, isLoadingAuth, navigate, redirectTarget]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);
    setMessageType(null);
    setLoading(true);

    try {
      if (mode === 'login') {
        const { error } = await login(email, password);
        
        if (error) {
          setMessage(error);
          setMessageType('error');
        } else {
          setMessage('Login successful! Redirecting...');
          setMessageType('success');
          // Redirect after short delay
          setTimeout(() => {
            navigate(redirectTarget, { replace: true });
          }, 1000);
        }
        
      } else if (mode === 'signup') {
        const { error } = await signup(email, password);
        
        if (error) {
          setMessage(error);
          setMessageType('error');
        } else {
          setMessage('Account created! Please check your email to verify your account, or log in if auto-confirmation is enabled.');
          setMessageType('success');
        }
        
      } else if (mode === 'forgotPassword') {
        const { error } = await resetPassword(email);
        
        if (error) {
          setMessage(error);
          setMessageType('error');
        } else {
          setMessage('Password reset link sent! Check your email.');
          setMessageType('success');
        }
      }
    } catch (err) {
      setMessage(err.message);
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
        setMessage(error.message || error);
        setMessageType('error');
      }
    } catch (err) {
      setMessage(err.message || 'Google sign-in failed.');
      setMessageType('error');
    } finally {
      setGoogleLoading(false);
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
          <Button type="submit" disabled={loading} className="w-full h-12 bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6] hover:from-[#3B82F6]/90 hover:to-[#8B5CF6]/90 text-white">
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

        <Button type="submit" disabled={loading} className="w-full h-12 bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6] hover:from-[#3B82F6]/90 hover:to-[#8B5CF6]/90 text-white">
          {loading ? (mode === 'login' ? 'Signing in...' : 'Signing up...') : (mode === 'login' ? 'Sign In' : 'Sign Up')}
        </Button>
        {mode === 'login' && (
          <>
            <div className="relative py-1">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-[#334155]" />
              </div>
              <div className="relative flex justify-center text-[10px] uppercase tracking-widest">
                <span className="bg-[#1E293B] px-2 text-[#64748B]">Or</span>
              </div>
            </div>
            <Button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={googleLoading}
              className="w-full h-12 bg-white text-slate-900 hover:bg-slate-100"
            >
              {googleLoading ? 'Connecting...' : 'Continue with Google'}
            </Button>
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
            <CardTitle className="text-3xl font-bold bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6] bg-clip-text text-transparent">
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
