import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createPageUrl } from '../utils';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [messageType, setMessageType] = useState(null);

  useEffect(() => {
    let mounted = true;

    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      if (data?.session) {
        setReady(true);
      }
    };

    checkSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === 'PASSWORD_RECOVERY' || session) {
        setReady(true);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);
    setMessageType(null);

    if (password.length < 6) {
      setMessage('Password must be at least 6 characters.');
      setMessageType('error');
      return;
    }

    if (password !== confirmPassword) {
      setMessage('Passwords do not match.');
      setMessageType('error');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setMessage(error.message);
      setMessageType('error');
      return;
    }

    setMessage('Password updated successfully. You can sign in now.');
    setMessageType('success');
    setTimeout(() => navigate(createPageUrl('Login'), { replace: true }), 900);
  };

  return (
    <div className="min-h-screen bg-[#0F172A] flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full"
      >
        <Card className="border border-[#334155] shadow-2xl bg-[#1E293B]">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-3xl font-bold bg-gradient-to-r from-[#3B82F6] to-[#0EA5E9] bg-clip-text text-transparent">
              Set New Password
            </CardTitle>
            <CardDescription className="text-base text-[#94A3B8]">
              {ready ? 'Enter your new password below.' : 'Open this page from your email reset link.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {ready ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="password" className="text-[#94A3B8]">New Password</Label>
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
                <div>
                  <Label htmlFor="confirmPassword" className="text-[#94A3B8]">Confirm Password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="mt-1 h-12 bg-[#0F172A] border-[#334155] text-[#F8FAFC]"
                  />
                </div>
                <Button type="submit" disabled={loading} className="w-full h-12 bg-gradient-to-r from-[#3B82F6] to-[#0EA5E9] hover:from-[#3B82F6]/90 hover:to-[#0EA5E9]/90 text-white">
                  {loading ? 'Updating...' : 'Update Password'}
                </Button>
              </form>
            ) : (
              <Button onClick={() => navigate(createPageUrl('Login'))} className="w-full h-12 bg-gradient-to-r from-[#3B82F6] to-[#0EA5E9]">
                Back to Sign In
              </Button>
            )}

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

