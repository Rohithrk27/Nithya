import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, Sword, Trophy } from 'lucide-react';
import { createPageUrl } from '../utils';

const generateUserCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i += 1) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `HNTR-${suffix}`;
};

export default function Landing() {
  const navigate = useNavigate();
  const [step, setStep] = useState('loading'); // loading | intro | onboarding
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    age: '',
    height_cm: '',
    weight_kg: '',
    reminder_time: '09:00'
  });

  useEffect(() => {
    const init = async () => {
      // Set a timeout to prevent getting stuck on loading
      const timeoutId = setTimeout(() => {
        setStep('intro');
      }, 5000); // 5 second timeout as fallback

      try {
        const { data: { user } } = await supabase.auth.getUser();

        clearTimeout(timeoutId);

        if (!user) {
          setStep('intro');
          return;
        }

        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('id,user_code')
          .eq('id', user.id)
          .maybeSingle();

        if (existingProfile) {
          if (!existingProfile.user_code) {
            await supabase.from('profiles').update({ user_code: generateUserCode() }).eq('id', user.id);
          }
          navigate(createPageUrl('Dashboard'), { replace: true });
          return;
        }

        setStep('onboarding');
      } catch (_) {
        clearTimeout(timeoutId);
        setStep('intro');
      }
    };

    void init();
  }, [navigate]);

  const goToAuthFlow = async (mode) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      navigate(createPageUrl('Landing'), { replace: true });
      return;
    }
    navigate(`${createPageUrl('Login')}?mode=${mode}`);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    const height_ft = formData.height_cm ? (parseFloat(formData.height_cm) / 30.48).toFixed(2) : null;
    const bmi = formData.height_cm && formData.weight_kg
      ? (parseFloat(formData.weight_kg) / Math.pow(parseFloat(formData.height_cm) / 100, 2)).toFixed(1)
      : null;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate(`${createPageUrl('Login')}?mode=signup`);
        return;
      }

      const profilePayload = {
        id: user.id,
        email: user.email,
        user_code: generateUserCode(),
        name: formData.name,
        age: formData.age ? parseInt(formData.age, 10) : null,
        height_cm: formData.height_cm ? parseFloat(formData.height_cm) : null,
        height_ft: height_ft ? parseFloat(height_ft) : null,
        weight_kg: formData.weight_kg ? parseFloat(formData.weight_kg) : null,
        bmi: bmi ? parseFloat(bmi) : null,
        reminder_time: formData.reminder_time,
      };

      const { error: profileError } = await supabase
        .from('profiles')
        .upsert(profilePayload, { onConflict: 'id' });
      if (profileError) throw profileError;

      const { error: statsError } = await supabase
        .from('stats')
        .upsert({
          user_id: user.id,
          voice_enabled: true,
          greeted_once: false,
          hardcore_mode: false,
          punishment_ignored_count: 0,
        }, { onConflict: 'user_id' });
      if (statsError) throw statsError;

      navigate(createPageUrl('Dashboard'), { replace: true });
    } catch (err) {
      alert(`Error: ${err.message}. Please try again.`);
    } finally {
      setLoading(false);
    }
  };

  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#0EA5E9]"></div>
      </div>
    );
  }

  if (step === 'intro') {
    return (
      <div className="min-h-screen relative overflow-hidden bg-[#071229] text-white">
        <div className="absolute inset-0 pointer-events-none" style={{
          background: 'radial-gradient(circle at 20% 20%, rgba(56,189,248,0.18), transparent 45%), radial-gradient(circle at 80% 30%, rgba(56,189,248,0.16), transparent 48%)'
        }} />
        <div className="absolute inset-0 pointer-events-none" style={{
          backgroundImage: 'linear-gradient(rgba(56,189,248,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,0.05) 1px, transparent 1px)',
          backgroundSize: '70px 70px',
        }} />

        <div className="relative z-10 min-h-screen max-w-5xl mx-auto px-6 py-12 flex flex-col justify-center">
          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl">
            <p className="text-cyan-300 text-xs tracking-[0.2em] font-black mb-3">SYSTEM BOOTING</p>
            <h1 className="text-3xl md:text-5xl lg:text-6xl font-black leading-tight">
              Awaken Your <span className="text-cyan-300">Limitless Self</span>
            </h1>
            <p className="text-slate-300 mt-5 text-base md:text-lg max-w-2xl">
              Nithya transforms daily habits into a Solo Leveling style progression: quests, ranks, stats, and strict consequences.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-8"
          >
            <div className="rounded-xl border border-cyan-400/20 bg-[#0f1f34cc] p-4">
              <Sword className="w-5 h-5 text-cyan-300 mb-2" />
              <p className="font-bold">Daily Quests</p>
              <p className="text-xs text-slate-400 mt-1">One completion per day. No grinding loopholes.</p>
            </div>
            <div className="rounded-xl border border-cyan-400/20 bg-[#0f1f34cc] p-4">
              <Shield className="w-5 h-5 text-cyan-300 mb-2" />
              <p className="font-bold">Strict Penalties</p>
              <p className="text-xs text-slate-400 mt-1">Missed tasks trigger punishments and strike sanctions.</p>
            </div>
            <div className="rounded-xl border border-cyan-400/20 bg-[#0f1f34cc] p-4">
              <Trophy className="w-5 h-5 text-cyan-300 mb-2" />
              <p className="font-bold">Rank Progression</p>
              <p className="text-xs text-slate-400 mt-1">Unlock gates, clear evaluations, rise through ranks.</p>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="mt-8 flex flex-wrap gap-3">
            <Button className="h-11 px-6" onClick={() => { void goToAuthFlow('signup'); }}>Create Account</Button>
            <Button variant="outline" className="h-11 px-6 border-cyan-500/40 text-cyan-300" onClick={() => { void goToAuthFlow('login'); }}>Sign In</Button>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0F172A] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full"
      >
        <Card className="border border-[#334155] shadow-2xl bg-[#1E293B]">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-3xl font-bold bg-gradient-to-r from-[#3B82F6] to-[#0EA5E9] bg-clip-text text-transparent">
              Complete Profile
            </CardTitle>
            <CardDescription className="text-base text-[#94A3B8]">
              Set your hunter baseline
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-[#94A3B8]">Name</Label>
                <Input
                  id="name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Your name"
                  required
                  className="h-12 bg-[#0F172A] border-[#334155] text-[#F8FAFC]"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="age" className="text-[#94A3B8]">Age</Label>
                  <Input
                    id="age"
                    type="number"
                    value={formData.age}
                    onChange={(e) => setFormData({ ...formData, age: e.target.value })}
                    placeholder="25"
                    required
                    min={13}
                    max={120}
                    className="h-12 bg-[#0F172A] border-[#334155] text-[#F8FAFC]"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="height" className="text-[#94A3B8]">Height (cm)</Label>
                  <Input
                    id="height"
                    type="number"
                    value={formData.height_cm}
                    onChange={(e) => setFormData({ ...formData, height_cm: e.target.value })}
                    placeholder="170"
                    required
                    className="h-12 bg-[#0F172A] border-[#334155] text-[#F8FAFC]"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="weight" className="text-[#94A3B8]">Weight (kg)</Label>
                <Input
                  id="weight"
                  type="number"
                  value={formData.weight_kg}
                  onChange={(e) => setFormData({ ...formData, weight_kg: e.target.value })}
                  placeholder="70"
                  required
                  className="h-12 bg-[#0F172A] border-[#334155] text-[#F8FAFC]"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="reminder" className="text-[#94A3B8]">Daily Reminder Time</Label>
                <Input
                  id="reminder"
                  type="time"
                  value={formData.reminder_time}
                  onChange={(e) => setFormData({ ...formData, reminder_time: e.target.value })}
                  className="h-12 bg-[#0F172A] border-[#334155] text-[#F8FAFC]"
                />
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-12 bg-gradient-to-r from-[#3B82F6] to-[#0EA5E9] hover:from-[#3B82F6]/90 hover:to-[#0EA5E9]/90 text-white text-lg shadow-lg shadow-[#0EA5E9]/20"
              >
                {loading ? 'Setting up...' : 'Enter the System'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
