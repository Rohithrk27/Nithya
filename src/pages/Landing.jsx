import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp } from 'lucide-react';
import { createPageUrl } from '../utils';

const LOGO_URL = '';

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
  const [step, setStep] = useState('loading');
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    age: '',
    height_cm: '',
    weight_kg: '',
    cheat_budget_min: 500,
    cheat_budget_max: 2000,
    reminder_time: '09:00'
  });

  useEffect(() => {
    const init = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          navigate(createPageUrl('Login'));
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
        navigate(createPageUrl('Login'));
      }
    };

    void init();
  }, [navigate]);

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
        navigate(createPageUrl('Login'));
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
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#8B5CF6]"></div>
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
            {LOGO_URL ? (
              <img src={LOGO_URL} alt="Logo" className="h-16 mx-auto mb-4" />
            ) : (
              <div className="mx-auto mb-4">
                <TrendingUp className="h-16 w-16 text-[#8B5CF6] mx-auto" />
              </div>
            )}
            <CardTitle className="text-3xl font-bold bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6] bg-clip-text text-transparent">
              Niത്യ
            </CardTitle>
            <CardDescription className="text-base text-[#94A3B8]">
              Complete your profile
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

              <div className="space-y-2">
                <Label className="text-[#94A3B8]">Cheat Day Budget Range (₹)</Label>
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    type="number"
                    value={formData.cheat_budget_min}
                    onChange={(e) => setFormData({ ...formData, cheat_budget_min: parseInt(e.target.value, 10) })}
                    placeholder="Min"
                    className="h-12 bg-[#0F172A] border-[#334155] text-[#F8FAFC]"
                  />
                  <Input
                    type="number"
                    value={formData.cheat_budget_max}
                    onChange={(e) => setFormData({ ...formData, cheat_budget_max: parseInt(e.target.value, 10) })}
                    placeholder="Max"
                    className="h-12 bg-[#0F172A] border-[#334155] text-[#F8FAFC]"
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-12 bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6] hover:from-[#3B82F6]/90 hover:to-[#8B5CF6]/90 text-white text-lg shadow-lg shadow-[#8B5CF6]/20"
              >
                {loading ? 'Setting up...' : 'Start Your Journey'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
