import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createPageUrl } from '../utils';
import LogoMark from '../../logo/logo.svg';
import { toastError } from '@/lib/toast';
import './LandingIntro.css';

const generateUserCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i += 1) suffix += chars[Math.floor(Math.random() * chars.length)];
  return `HNTR-${suffix}`;
};

/**
 * @typedef IntroHeroProps
 * @property {() => void} onBeginJourney
 * @property {() => void} onSignIn
 */

/** @param {IntroHeroProps} props */
function IntroHero({ onBeginJourney, onSignIn }) {
  return (
    <div className="intro-page">
      <motion.div
        className="intro-bg-fade"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.75, ease: 'easeOut' }}
      />
      <div className="intro-bg-grid" aria-hidden="true" />
      <div className="intro-bg-particles" aria-hidden="true">
        <span className="intro-particle intro-particle--1" />
        <span className="intro-particle intro-particle--2" />
        <span className="intro-particle intro-particle--3" />
        <span className="intro-particle intro-particle--4" />
      </div>
      <div className="intro-bg-streaks" aria-hidden="true">
        <span className="intro-streak intro-streak--1" />
        <span className="intro-streak intro-streak--2" />
      </div>

      <main className="intro-hero" role="main">
        <div className="intro-main-content">
          <motion.section
            className="intro-logo-section"
            initial={{ opacity: 0, scale: 0.86 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.22, duration: 0.65, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className="intro-logo-wave" aria-hidden="true" />
            <div className="intro-avatar-silhouette" aria-hidden="true" />
            <div className="intro-logo-crop">
              <img
                src={LogoMark}
                alt="Nithya logo"
                width="220"
                height="220"
                loading="eager"
                fetchPriority="high"
                decoding="async"
                className="intro-logo-svg"
              />
            </div>
          </motion.section>

          <motion.p
            className="intro-brand"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.55, ease: 'easeOut' }}
          >
            NITHYA
          </motion.p>

          <motion.p
            className="intro-motto"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.58, ease: 'easeOut' }}
          >
            Discipline. Evolve. Conquer.
          </motion.p>

          <motion.h1
            className="intro-header-text"
            initial={{ opacity: 0, y: 26 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.42, duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
          >
            Build unstoppable discipline. One day at a time.
          </motion.h1>

          <motion.p
            className="intro-tagline"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.58, duration: 0.62, ease: 'easeOut' }}
          >
            Turn routines into streaks, streaks into levels, and levels into a stronger you.
          </motion.p>

          <motion.section
            className="intro-demo"
            aria-label="Live app demo preview"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.72, duration: 0.6, ease: 'easeOut' }}
          >
            <div className="intro-demo-header">
              <span>Today&apos;s Power Session</span>
              <span>Hunter Level 7</span>
            </div>
            <ul className="intro-demo-list">
              <li>
                <span>6:00 AM wake-up mission complete</span>
                <strong>+40 XP</strong>
              </li>
              <li>
                <span>45-minute deep-focus grind</span>
                <strong>+60 XP</strong>
              </li>
              <li>
                <span>30-minute workout finished strong</span>
                <strong>+50 XP</strong>
              </li>
            </ul>
            <div className="intro-demo-footer">
              <div className="intro-demo-streak">
                <span>Streak live</span>
                <strong>12 days</strong>
              </div>
              <div className="intro-demo-progress" role="presentation" aria-hidden="true">
                <div className="intro-demo-progress-bar" />
              </div>
            </div>
          </motion.section>

          <motion.div
            className="intro-cta"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.86, duration: 0.5, ease: 'easeOut' }}
          >
            <Button type="button" className="intro-btn intro-btn--primary" onClick={onBeginJourney}>
              Try Free
            </Button>
            <p className="intro-signin-hint">
              Already using Nithya?{' '}
              <button type="button" className="intro-text-link" onClick={onSignIn}>
                Sign in
              </button>
            </p>
          </motion.div>
        </div>

        <footer className="intro-footer" aria-label="Privacy and support">
          <a href="#intro-privacy-policy" className="intro-footer-link">Privacy Policy</a>
          <span className="intro-footer-divider" aria-hidden="true">|</span>
          <span id="intro-privacy-policy">We only use your account data to run habit tracking and progress insights.</span>
          <span className="intro-footer-divider" aria-hidden="true">|</span>
          <a href="mailto:itsnithyaapp@gmail.com" className="intro-footer-link">
            Contact us
          </a>
        </footer>
      </main>
    </div>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const [step, setStep] = useState('loading'); // loading | intro | onboarding
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    age: '',
    height_cm: '',
    weight_kg: '',
    reminder_time: '09:00',
  });

  const normalizeErrorMessage = (errorLike) => {
    const raw = typeof errorLike === 'string' ? errorLike : (errorLike?.message || 'Unexpected error occurred.');
    const lower = raw.toLowerCase();
    if (lower.includes('failed to fetch') || lower.includes('network error') || lower.includes('network timeout') || lower.includes('unable to reach supabase')) {
      return 'Network error: unable to reach server. Check internet/VPN/firewall and try again.';
    }
    return raw;
  };

  useEffect(() => {
    const init = async () => {
      const timeoutId = setTimeout(() => {
        setStep('intro');
      }, 5000);

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

  const goToAuthFlow = (mode) => {
    const loginTarget = `${createPageUrl('Login')}?mode=${mode}`;
    navigate(loginTarget);

    void supabase.auth.getUser()
      .then(async ({ data: { user } }) => {
        if (!user) return;
        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', user.id)
          .maybeSingle();
        navigate(existingProfile ? createPageUrl('Dashboard') : createPageUrl('Landing'), { replace: true });
      })
      .catch(() => {});
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
      toastError(`${normalizeErrorMessage(err)} Please try again.`, { ttl: 5200 });
    } finally {
      setLoading(false);
    }
  };

  const introHandlers = useMemo(() => ({
    onBeginJourney: () => goToAuthFlow('signup'),
    onSignIn: () => goToAuthFlow('login'),
  }), []);

  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-[#030712] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#22D3EE]" />
      </div>
    );
  }

  if (step === 'intro') {
    return <IntroHero {...introHandlers} />;
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
