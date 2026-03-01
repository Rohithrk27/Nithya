import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Save, Volume2, VolumeX, LogOut, Globe, Share2, RefreshCcw } from 'lucide-react';
import BMIMeter from '../components/BMIMeter';
import HabitReminderSetup from '../components/HabitReminderSetup';
import RPGHumanoidAvatar, { getAvatarTier } from '../components/RPGHumanoidAvatar';
import StatGrid from '../components/StatGrid';
import { computeLevel, getRankTitle, computeAllStats } from '../components/gameEngine';
import html2canvas from 'html2canvas';
import {
  fetchOwnPublicProfile,
  getPublicProfileShareUrl,
  refreshPublicProfile,
  setPublicProfileVisibility,
} from '@/lib/publicProfiles';
import { fetchRelicBalance } from '@/lib/relics';
import { fetchActiveDungeonRun } from '@/lib/gameState';

const LOGO_URL = "";
const EMPTY_FORM = {
  name: '',
  age: '',
  height_cm: '',
  weight_kg: '',
  reminder_time: '09:00',
};

export default function Profile() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [systemState, setSystemState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [habits, setHabits] = useState([]);
  const [heightUnit, setHeightUnit] = useState('cm');
  const [form, setForm] = useState(EMPTY_FORM);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [hardcoreMode, setHardcoreMode] = useState(false);
  const [publicProfile, setPublicProfile] = useState(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareMessage, setShareMessage] = useState('');
  const [relicBalance, setRelicBalance] = useState(0);
  const [avatarStability, setAvatarStability] = useState(100);
  const shareCaptureRef = useRef(null);

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

  const syncPublicShare = async (userId, shouldRefresh = true) => {
    if (!userId) return null;
    try {
      const row = shouldRefresh
        ? await refreshPublicProfile(userId)
        : await fetchOwnPublicProfile(userId);
      setPublicProfile(row || null);
      return row || null;
    } catch (_) {
      return null;
    }
  };

  const loadProfile = async (userId) => {
    if (!userId) return;
    
    const [profilesRes, habitsRes, statsRes, relicBalanceSnapshot, activeDungeonRun] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).limit(1),
      supabase.from('habits').select('*').eq('user_id', userId),
      supabase.from('stats').select('*').eq('user_id', userId).limit(1),
      Promise.resolve(fetchRelicBalance(userId)).catch(() => 0),
      Promise.resolve(fetchActiveDungeonRun(userId)).catch(() => null),
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
    setRelicBalance(Math.max(0, Number(relicBalanceSnapshot || 0)));
    setAvatarStability(Math.max(0, Math.min(100, Number(activeDungeonRun?.stability ?? 100))));
    setVoiceEnabled(ss?.voice_enabled !== false);
    setHardcoreMode(!!ss?.hardcore_mode);
    setHabits(habitData || []);
    setForm({
      name: p.name || '',
      age: p.age !== null && p.age !== undefined ? String(p.age) : '',
      height_cm: p.height_cm !== null && p.height_cm !== undefined ? String(p.height_cm) : '',
      weight_kg: p.weight_kg !== null && p.weight_kg !== undefined ? String(p.weight_kg) : '',
      reminder_time: p.reminder_time || '09:00',
    });
    await syncPublicShare(userId, true);
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    
    // Safely parse height and weight, handling empty/invalid inputs
    const heightCm = form.height_cm ? Number(form.height_cm) : null;
    const weightKg = form.weight_kg ? Number(form.weight_kg) : null;
    
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
      const parsedAge = form.age ? Number(form.age) : null;
      const withAge = { ...payload, age: Number.isFinite(parsedAge) ? parsedAge : null };
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
    
    await syncPublicShare(profile.id, true);
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
    ? Number(form.weight_kg) / Math.pow(Number(form.height_cm) / 100, 2)
    : 0;
  const shareUrl = useMemo(() => getPublicProfileShareUrl(publicProfile?.username), [publicProfile?.username]);

  const togglePublicShare = async () => {
    if (!profile?.id || shareBusy) return;
    setShareBusy(true);
    setShareMessage('');
    try {
      const row = await setPublicProfileVisibility({
        userId: profile.id,
        isPublic: !publicProfile?.is_public,
      });
      setPublicProfile(row || null);
      setShareMessage(row?.is_public ? 'Public profile enabled.' : 'Public profile hidden.');
    } catch (err) {
      setShareMessage(err?.message || 'Failed to update share visibility.');
    } finally {
      setShareBusy(false);
    }
  };

  const sharePublicLink = async () => {
    if (!profile?.id || shareBusy) return;
    setShareBusy(true);
    setShareMessage('');
    try {
      let row = publicProfile?.username ? publicProfile : await syncPublicShare(profile.id, true);
      if (!row?.is_public) {
        row = await setPublicProfileVisibility({
          userId: profile.id,
          isPublic: true,
        });
        setPublicProfile(row || null);
      }

      const link = getPublicProfileShareUrl(row?.username);
      if (!link) {
        throw new Error('Unable to generate share link.');
      }

      const subjectName = (profile?.name || 'Player').trim() || 'Player';
      const shareTitle = `${subjectName}'s Profile`;
      const shareText = `Check out ${subjectName}'s RPG progress profile.`;

      const captureNode = shareCaptureRef.current;
      let screenshotFile = null;
      if (captureNode) {
        const canvas = await html2canvas(captureNode, {
          backgroundColor: '#0f2027',
          scale: Math.min(2, window.devicePixelRatio || 1),
          useCORS: true,
          logging: false,
        });
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (blob) {
          screenshotFile = new File([blob], `${subjectName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'player'}-profile.png`, {
            type: 'image/png',
          });
        }
      }

      if (screenshotFile) {
        if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
          const canShareFiles = typeof navigator.canShare === 'function'
            ? navigator.canShare({ files: [screenshotFile] })
            : true;

          if (canShareFiles) {
            await navigator.share({
              title: shareTitle,
              text: `${shareText}\n${link}`,
              files: [screenshotFile],
            });
            setShareMessage('Shared successfully.');
            return;
          }
        }

        const tempUrl = URL.createObjectURL(screenshotFile);
        const anchor = document.createElement('a');
        anchor.href = tempUrl;
        anchor.download = screenshotFile.name;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(tempUrl);
        setShareMessage('Share not supported here. Screenshot downloaded.');
        return;
      }

      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({
          title: shareTitle,
          text: `${shareText}\n${link}`,
        });
        setShareMessage('Shared successfully.');
        return;
      }

      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
        setShareMessage('Share not supported here. Link copied.');
        return;
      }

      setShareMessage('Share not supported on this device.');
    } catch (err) {
      if (err?.name === 'AbortError') {
        setShareMessage('Share cancelled.');
      } else {
        setShareMessage(err?.message || 'Failed to share link.');
      }
    } finally {
      setShareBusy(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0f2027, #203a43, #2c5364)' }}>
      <div className="w-8 h-8 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
    </div>
  );

  const section = (title, children) => (
    <div className="w-full overflow-hidden rounded-2xl p-5 space-y-4"
      style={{ background: 'rgba(15,32,39,0.7)', backdropFilter: 'blur(16px)', border: '1px solid rgba(56,189,248,0.15)' }}>
      <h2 className="text-xs font-bold tracking-widest" style={{ color: '#38BDF8' }}>{title}</h2>
      {children}
    </div>
  );

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: 'linear-gradient(135deg, #0f2027, #203a43, #2c5364)' }}>
      <div className="max-w-xl mx-auto p-4 md:p-6 space-y-5 overflow-x-hidden">

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

        <div ref={shareCaptureRef}>
          {section('PLAYER IDENTITY', (
            <div className="flex flex-col sm:flex-row gap-4 sm:gap-5 items-center">
              <RPGHumanoidAvatar
                level={level}
                totalXp={profile?.total_xp || 0}
                streak={profile?.daily_streak ?? profile?.global_streak ?? 0}
                shadowDebt={systemState?.shadow_debt_xp || 0}
                stability={avatarStability}
                relicCount={relicBalance}
              />
              <div className="w-full min-w-0 flex-1 space-y-1">
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
        </div>

        {section('BODY METRICS', (
          <div className="flex flex-col items-center">
            <BMIMeter bmi={liveBMI} />
          </div>
        ))}

        {section('STAT SUMMARY', (
          <StatGrid profile={profile} level={level} statPoints={0} onAllocate={() => {}} />
        ))}

        {section('PROFILE SHARING', (
          <div className="space-y-3">
            <div className="rounded-xl p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
              style={{ background: 'rgba(15,32,39,0.6)', border: '1px solid rgba(56,189,248,0.12)' }}>
              <div className="flex items-start gap-2 min-w-0 flex-1">
                <Globe className="w-4 h-4 mt-0.5 shrink-0" style={{ color: publicProfile?.is_public ? '#34D399' : '#64748B' }} />
                <div className="min-w-0">
                  <p className="text-xs font-black tracking-widest" style={{ color: publicProfile?.is_public ? '#34D399' : '#64748B' }}>
                    PUBLIC PROFILE
                  </p>
                  <p className="text-xs break-words" style={{ color: '#334155' }}>
                    {publicProfile?.is_public ? 'Visible at /profile/:username' : 'Hidden from share link'}
                  </p>
                </div>
              </div>
              <button onClick={togglePublicShare}
                className="w-11 h-6 rounded-full transition-all relative flex-shrink-0"
                style={{ background: publicProfile?.is_public ? 'rgba(52,211,153,0.3)' : 'rgba(71,85,105,0.3)', border: `1px solid ${publicProfile?.is_public ? 'rgba(52,211,153,0.5)' : 'rgba(71,85,105,0.4)'}` }}>
                <span className="absolute top-0.5 w-5 h-5 rounded-full transition-all"
                  style={{ left: publicProfile?.is_public ? '22px' : '2px', background: publicProfile?.is_public ? '#34D399' : '#475569' }} />
              </button>
            </div>

            <div className="rounded-xl p-3 space-y-2"
              style={{ background: 'rgba(15,32,39,0.6)', border: '1px solid rgba(56,189,248,0.12)' }}>
              <p className="text-xs font-black tracking-widest" style={{ color: '#38BDF8' }}>SHARE LINK</p>
              <p className="text-xs break-all" style={{ color: '#94A3B8' }}>
                {shareUrl || 'Enable public profile to generate a share link.'}
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button onClick={sharePublicLink} disabled={shareBusy} className="w-full sm:flex-1">
                  <Share2 className="w-4 h-4 mr-2" />
                  Share Profile
                </Button>
                <Button variant="outline" className="w-full sm:w-auto" onClick={() => profile?.id && syncPublicShare(profile.id, true)} disabled={shareBusy}>
                  <RefreshCcw className="w-4 h-4" />
                </Button>
              </div>
              {shareMessage && (
                <p className="text-xs" style={{ color: '#64748B' }}>{shareMessage}</p>
              )}
            </div>
          </div>
        ))}

        {section('EDIT DETAILS', (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs tracking-widest font-bold" style={{ color: '#64748B' }}>NAME</Label>
              <Input className="w-full" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                style={{ background: 'rgba(15,32,39,0.8)', border: '1px solid #1e3a4a', color: '#F1F5F9' }} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs tracking-widest font-bold" style={{ color: '#64748B' }}>AGE</Label>
                <Input className="w-full" type="number" value={form.age} onChange={e => setForm({ ...form, age: e.target.value })}
                  style={{ background: 'rgba(15,32,39,0.8)', border: '1px solid #1e3a4a', color: '#F1F5F9' }} />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs tracking-widest font-bold" style={{ color: '#64748B' }}>HEIGHT</Label>
                  <button onClick={() => setHeightUnit(u => u === 'cm' ? 'ft' : 'cm')}
                    className="text-xs shrink-0" style={{ color: '#38BDF8' }}>
                    {heightUnit === 'cm' ? '→ ft' : '→ cm'}
                  </button>
                </div>
                {heightUnit === 'cm' ? (
                  <Input className="w-full" type="number" placeholder="cm" value={form.height_cm}
                    onChange={e => setForm({ ...form, height_cm: e.target.value })}
                    style={{ background: 'rgba(15,32,39,0.8)', border: '1px solid #1e3a4a', color: '#F1F5F9' }} />
                ) : (
                  <Input className="w-full" type="number" placeholder="ft"
                    value={form.height_cm ? (Number(form.height_cm) / 30.48).toFixed(1) : ''}
                    onChange={e => setForm({ ...form, height_cm: e.target.value ? String(Math.round(Number(e.target.value) * 30.48)) : '' })}
                    style={{ background: 'rgba(15,32,39,0.8)', border: '1px solid #1e3a4a', color: '#F1F5F9' }} />
                )}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs tracking-widest font-bold" style={{ color: '#64748B' }}>WEIGHT (kg)</Label>
              <Input className="w-full" type="number" value={form.weight_kg} onChange={e => setForm({ ...form, weight_kg: e.target.value })}
                style={{ background: 'rgba(15,32,39,0.8)', border: '1px solid #1e3a4a', color: '#F1F5F9' }} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs tracking-widest font-bold" style={{ color: '#64748B' }}>REMINDER TIME</Label>
              <HabitReminderSetup reminderTime={form.reminder_time} habits={habits}
                onTimeChange={t => setForm(f => ({ ...f, reminder_time: t }))} />
            </div>

            <div className="flex items-start sm:items-center justify-between gap-3 p-3 rounded-xl"
              style={{ background: 'rgba(15,32,39,0.6)', border: '1px solid rgba(56,189,248,0.12)' }}>
              <div className="flex items-start gap-2 min-w-0">
                {voiceEnabled ? <Volume2 className="w-4 h-4" style={{ color: '#38BDF8' }} /> : <VolumeX className="w-4 h-4" style={{ color: '#475569' }} />}
                <div className="min-w-0">
                  <p className="text-xs font-black tracking-widest" style={{ color: voiceEnabled ? '#38BDF8' : '#475569' }}>SYSTEM VOICE</p>
                  <p className="text-xs break-words" style={{ color: '#334155' }}>Personalized greeting on login</p>
                </div>
              </div>
              <button onClick={toggleVoice}
                className="w-11 h-6 rounded-full transition-all relative flex-shrink-0"
                style={{ background: voiceEnabled ? 'rgba(56,189,248,0.3)' : 'rgba(71,85,105,0.3)', border: `1px solid ${voiceEnabled ? 'rgba(56,189,248,0.5)' : 'rgba(71,85,105,0.4)'}` }}>
                <span className="absolute top-0.5 w-5 h-5 rounded-full transition-all"
                  style={{ left: voiceEnabled ? '22px' : '2px', background: voiceEnabled ? '#38BDF8' : '#475569' }} />
              </button>
            </div>

            <div className="flex items-start sm:items-center justify-between gap-3 p-3 rounded-xl"
              style={{ background: hardcoreMode ? 'rgba(56,189,248,0.06)' : 'rgba(15,32,39,0.6)', border: `1px solid ${hardcoreMode ? 'rgba(56,189,248,0.3)' : 'rgba(56,189,248,0.12)'}` }}>
              <div className="flex items-start gap-2 min-w-0">
                <div className="min-w-0">
                  <p className="text-xs font-black tracking-widest" style={{ color: hardcoreMode ? '#38BDF8' : '#475569' }}>HARDCORE MODE</p>
                  <p className="text-xs break-words" style={{ color: '#334155' }}>10s hold-to-confirm · stronger penalties · stat decay</p>
                </div>
              </div>
              <button onClick={() => setHardcoreMode(h => !h)}
                className="w-11 h-6 rounded-full transition-all relative flex-shrink-0"
                style={{ background: hardcoreMode ? 'rgba(56,189,248,0.3)' : 'rgba(71,85,105,0.3)', border: `1px solid ${hardcoreMode ? 'rgba(56,189,248,0.5)' : 'rgba(71,85,105,0.4)'}` }}>
                <span className="absolute top-0.5 w-5 h-5 rounded-full transition-all"
                  style={{ left: hardcoreMode ? '22px' : '2px', background: hardcoreMode ? '#38BDF8' : '#475569' }} />
              </button>
            </div>

            <Button onClick={handleSave} disabled={saving} className="w-full font-bold tracking-widest"
              style={{ background: 'linear-gradient(90deg, rgba(56,189,248,0.2), rgba(56,189,248,0.2))', border: '1px solid rgba(56,189,248,0.4)', color: '#38BDF8' }}>
              <Save className="w-4 h-4 mr-2" />{saving ? 'SAVING...' : 'SAVE CHANGES'}
            </Button>

            <Button 
              onClick={async () => {
                await supabase.auth.signOut();
                navigate(createPageUrl('Landing'));
              }} 
              variant="outline" 
              className="w-full font-bold tracking-widest"
              style={{ border: '1px solid rgba(248,113,113,0.4)', color: '#F87171' }}
            >
              <LogOut className="w-4 h-4 mr-2" />SIGN OUT
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}


