import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Save, Volume2, VolumeX } from 'lucide-react';
import BMIMeter from '../components/BMIMeter';
import HabitReminderSetup from '../components/HabitReminderSetup';
import RPGHumanoidAvatar, { getAvatarTier } from '../components/RPGHumanoidAvatar';
import StatGrid from '../components/StatGrid';
import { computeLevel, getRankTitle, computeAllStats } from '../components/gameEngine';

const LOGO_URL = "";

export default function Profile() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [systemState, setSystemState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [habits, setHabits] = useState([]);
  const [heightUnit, setHeightUnit] = useState('cm');
  const [form, setForm] = useState({});
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [hardcoreMode, setHardcoreMode] = useState(false);

  useEffect(() => {
    const init = async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        navigate(createPageUrl('Landing'));
        return;
      }
      await loadProfile(authUser.id);
    };
    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session?.user) {
        navigate(createPageUrl('Landing'));
        return;
      }
      await loadProfile(session.user.id);
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadProfile = async (userId) => {
    if (!userId) return;
    
    const [profilesRes, habitsRes, statsRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).limit(1),
      supabase.from('habits').select('*').eq('user_id', userId),
      supabase.from('stats').select('*').eq('user_id', userId).limit(1),
    ]);

    const profiles = profilesRes.data || [];
    const habitData = habitsRes.data || [];
    const stateData = statsRes.data || [];
    
    if (!profiles || profiles.length === 0) { navigate(createPageUrl('Landing')); return; }
    const p = profiles[0];
    const computedLevelVal = computeLevel(p.total_xp || 0);
    if (p.level !== computedLevelVal) {
      await supabase.from('profiles').update({ level: computedLevelVal }).eq('id', p.id);
      p.level = computedLevelVal;
    }
    const ss = stateData && stateData[0] ? stateData[0] : null;
    setProfile(p);
    setSystemState(ss);
    setVoiceEnabled(ss?.voice_enabled !== false);
    setHardcoreMode(!!ss?.hardcore_mode);
    setHabits(habitData || []);
    setForm({
      name: p.name || '',
      age: p.age || '',
      height_cm: p.height_cm || '',
      weight_kg: p.weight_kg || '',
      reminder_time: p.reminder_time || '09:00',
    });
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    
    // Safely parse height and weight, handling empty/invalid inputs
    const heightCm = form.height_cm ? parseFloat(form.height_cm) : null;
    const weightKg = form.weight_kg ? parseFloat(form.weight_kg) : null;
    
    // Calculate height in feet and BMI only if we have valid values
    let height_ft = null;
    let bmi = null;
    
    if (heightCm && heightCm > 0) {
      height_ft = parseFloat((heightCm / 30.48).toFixed(2));
    }
    
    if (weightKg && weightKg > 0 && heightCm && heightCm > 0) {
      bmi = parseFloat((weightKg / Math.pow(heightCm / 100, 2)).toFixed(1));
    }

    const payload = {
      name: form.name || null,
      height_cm: heightCm,
      height_ft: height_ft,
      weight_kg: weightKg,
      bmi: Number.isFinite(bmi) ? bmi : null,
      reminder_time: form.reminder_time || '21:00',
    };

    try {
      const withAge = { ...payload, age: form.age ? parseInt(form.age) : null };
      await supabase.from('profiles').update(withAge).eq('id', profile.id);
      if (withAge.bmi !== null) {
        await supabase.from('bmi_records').insert({
          user_id: profile.id,
          bmi: withAge.bmi,
          weight_kg: withAge.weight_kg,
          height_cm: withAge.height_cm,
          recorded_at: new Date().toISOString(),
        });
      }
    } catch (err) {
      setSaving(false);
      return;
    }
    
    // Handle systemState - create if it doesn't exist
    if (systemState) {
      await supabase.from('stats').update({
        voice_enabled: voiceEnabled,
        hardcore_mode: hardcoreMode 
      }).eq('id', systemState.id).eq('user_id', profile.id);
    } else {
      await supabase.from('stats').insert({
        user_id: profile.id,
        voice_enabled: voiceEnabled,
        hardcore_mode: hardcoreMode,
      });
    }
    
    setSaving(false);
    navigate(createPageUrl('Dashboard'));
  };

  const toggleVoice = async () => {
    const next = !voiceEnabled;
    setVoiceEnabled(next);
    if (systemState) {
      await supabase.from('stats').update({ voice_enabled: next }).eq('id', systemState.id).eq('user_id', profile.id);
    }
  };

  const level = useMemo(() => computeLevel(profile?.total_xp || 0), [profile]);
  const tier = useMemo(() => getAvatarTier(level), [level]);
  const rankTitle = useMemo(() => getRankTitle(level), [level]);
  const finalStats = useMemo(() => profile ? computeAllStats(profile, level) : {}, [profile, level]);
  const liveBMI = form.weight_kg && form.height_cm
    ? parseFloat(form.weight_kg) / Math.pow(parseFloat(form.height_cm) / 100, 2)
    : 0;

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0f2027, #203a43, #2c5364)' }}>
      <div className="w-8 h-8 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
    </div>
  );

  const section = (title, children) => (
    <div className="rounded-2xl p-5 space-y-4"
      style={{ background: 'rgba(15,32,39,0.7)', backdropFilter: 'blur(16px)', border: '1px solid rgba(56,189,248,0.15)' }}>
      <h2 className="text-xs font-bold tracking-widest" style={{ color: '#38BDF8' }}>{title}</h2>
      {children}
    </div>
  );

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #0f2027, #203a43, #2c5364)' }}>
      <div className="max-w-xl mx-auto p-4 md:p-6 space-y-5">

        <div className="flex items-center gap-3">
          <button onClick={() => navigate(createPageUrl('Dashboard'))}
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ background: 'rgba(15,32,39,0.8)', border: '1px solid #1e3a4a' }}>
            <ArrowLeft className="w-4 h-4 text-white" />
          </button>
          <div className="flex items-center gap-2">
            {LOGO_URL && <img src={LOGO_URL} alt="" className="w-7 h-7 object-contain" />}
            <h1 className="text-lg font-black tracking-widest text-white">STATUS FILE</h1>
          </div>
        </div>

        {section('PLAYER IDENTITY', (
          <div className="flex gap-5 items-center">
            <RPGHumanoidAvatar level={level} />
            <div className="flex-1 space-y-1">
              <p className="text-2xl font-black text-white">{profile?.name}</p>
              <p className="text-xs font-bold tracking-widest" style={{ color: '#38BDF8' }}>Lv. {level} · {rankTitle}</p>
              <p className="text-xs" style={{ color: '#64748B' }}>Tier {tier} Avatar</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
                {[
                  ['Total XP', (profile?.total_xp || 0).toLocaleString()],
                  ['Quests Done', profile?.quests_completed || 0],
                  ['Streak', `${profile?.global_streak || 0}d`],
                  ['Stat Pts', profile?.stat_points || 0],
                ].map(([k, v]) => (
                  <div key={k}>
                    <p className="text-xs" style={{ color: '#64748B' }}>{k}</p>
                    <p className="text-sm font-bold text-white">{v}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}

        {section('BODY METRICS', (
          <div className="flex flex-col items-center">
            <BMIMeter bmi={liveBMI} />
          </div>
        ))}

        {section('STAT SUMMARY', (
          <StatGrid profile={profile} level={level} statPoints={0} onAllocate={() => {}} />
        ))}

        {section('EDIT DETAILS', (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs tracking-widest font-bold" style={{ color: '#64748B' }}>NAME</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                style={{ background: 'rgba(15,32,39,0.8)', border: '1px solid #1e3a4a', color: '#F1F5F9' }} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs tracking-widest font-bold" style={{ color: '#64748B' }}>AGE</Label>
                <Input type="number" value={form.age} onChange={e => setForm({ ...form, age: e.target.value })}
                  style={{ background: 'rgba(15,32,39,0.8)', border: '1px solid #1e3a4a', color: '#F1F5F9' }} />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs tracking-widest font-bold" style={{ color: '#64748B' }}>HEIGHT</Label>
                  <button onClick={() => setHeightUnit(u => u === 'cm' ? 'ft' : 'cm')}
                    className="text-xs" style={{ color: '#38BDF8' }}>
                    {heightUnit === 'cm' ? '→ ft' : '→ cm'}
                  </button>
                </div>
                {heightUnit === 'cm' ? (
                  <Input type="number" placeholder="cm" value={form.height_cm}
                    onChange={e => setForm({ ...form, height_cm: e.target.value })}
                    style={{ background: 'rgba(15,32,39,0.8)', border: '1px solid #1e3a4a', color: '#F1F5F9' }} />
                ) : (
                  <Input type="number" placeholder="ft"
                    value={form.height_cm ? (parseFloat(form.height_cm) / 30.48).toFixed(1) : ''}
                    onChange={e => setForm({ ...form, height_cm: e.target.value ? Math.round(parseFloat(e.target.value) * 30.48) : '' })}
                    style={{ background: 'rgba(15,32,39,0.8)', border: '1px solid #1e3a4a', color: '#F1F5F9' }} />
                )}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs tracking-widest font-bold" style={{ color: '#64748B' }}>WEIGHT (kg)</Label>
              <Input type="number" value={form.weight_kg} onChange={e => setForm({ ...form, weight_kg: e.target.value })}
                style={{ background: 'rgba(15,32,39,0.8)', border: '1px solid #1e3a4a', color: '#F1F5F9' }} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs tracking-widest font-bold" style={{ color: '#64748B' }}>REMINDER TIME</Label>
              <HabitReminderSetup reminderTime={form.reminder_time} habits={habits}
                onTimeChange={t => setForm(f => ({ ...f, reminder_time: t }))} />
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl"
              style={{ background: 'rgba(15,32,39,0.6)', border: '1px solid rgba(56,189,248,0.12)' }}>
              <div className="flex items-center gap-2">
                {voiceEnabled ? <Volume2 className="w-4 h-4" style={{ color: '#38BDF8' }} /> : <VolumeX className="w-4 h-4" style={{ color: '#475569' }} />}
                <div>
                  <p className="text-xs font-black tracking-widest" style={{ color: voiceEnabled ? '#38BDF8' : '#475569' }}>SYSTEM VOICE</p>
                  <p className="text-xs" style={{ color: '#334155' }}>Personalized greeting on login</p>
                </div>
              </div>
              <button onClick={toggleVoice}
                className="w-11 h-6 rounded-full transition-all relative flex-shrink-0"
                style={{ background: voiceEnabled ? 'rgba(56,189,248,0.3)' : 'rgba(71,85,105,0.3)', border: `1px solid ${voiceEnabled ? 'rgba(56,189,248,0.5)' : 'rgba(71,85,105,0.4)'}` }}>
                <span className="absolute top-0.5 w-5 h-5 rounded-full transition-all"
                  style={{ left: voiceEnabled ? '22px' : '2px', background: voiceEnabled ? '#38BDF8' : '#475569' }} />
              </button>
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl"
              style={{ background: hardcoreMode ? 'rgba(167,139,250,0.06)' : 'rgba(15,32,39,0.6)', border: `1px solid ${hardcoreMode ? 'rgba(167,139,250,0.3)' : 'rgba(56,189,248,0.12)'}` }}>
              <div className="flex items-center gap-2">
                <div>
                  <p className="text-xs font-black tracking-widest" style={{ color: hardcoreMode ? '#A78BFA' : '#475569' }}>HARDCORE MODE</p>
                  <p className="text-xs" style={{ color: '#334155' }}>10s hold-to-confirm · stronger penalties · stat decay</p>
                </div>
              </div>
              <button onClick={() => setHardcoreMode(h => !h)}
                className="w-11 h-6 rounded-full transition-all relative flex-shrink-0"
                style={{ background: hardcoreMode ? 'rgba(167,139,250,0.3)' : 'rgba(71,85,105,0.3)', border: `1px solid ${hardcoreMode ? 'rgba(167,139,250,0.5)' : 'rgba(71,85,105,0.4)'}` }}>
                <span className="absolute top-0.5 w-5 h-5 rounded-full transition-all"
                  style={{ left: hardcoreMode ? '22px' : '2px', background: hardcoreMode ? '#A78BFA' : '#475569' }} />
              </button>
            </div>

            <Button onClick={handleSave} disabled={saving} className="w-full font-bold tracking-widest"
              style={{ background: 'linear-gradient(90deg, rgba(56,189,248,0.2), rgba(167,139,250,0.2))', border: '1px solid rgba(56,189,248,0.4)', color: '#38BDF8' }}>
              <Save className="w-4 h-4 mr-2" />{saving ? 'SAVING...' : 'SAVE CHANGES'}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
