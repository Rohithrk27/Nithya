import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { format, addDays, differenceInDays, parseISO } from 'date-fns';
import { ArrowLeft, Flame, Trophy, Skull, X, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { motion, AnimatePresence } from 'framer-motion';
import { DUNGEON_CHALLENGES, HIGH_DIFFICULTY_PUNISHMENTS, getRandomHardPunishment } from '../components/systemFeatures';
import { buildXPUpdatePayload, computeLevel, bonusXP } from '../components/gameEngine';

const today = format(new Date(), 'yyyy-MM-dd');

const XP_MULTIPLIER_OPTIONS = [1.5, 2.0, 2.5, 3.0];
const DURATION_OPTIONS = [1, 3, 5, 7, 10, 14];

export default function Dungeon() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [activeDungeon, setActiveDungeon] = useState(null);
  const [dungeonHistory, setDungeonHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [mode, setMode] = useState('select');
  const [showHistory, setShowHistory] = useState(false);
  const [customForm, setCustomForm] = useState({
    title: '', description: '', duration: 7,
    xp_multiplier: 1.5, punishment_mode: 'random', custom_punishment: '',
  });

  useEffect(() => {
    const init = async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        navigate(createPageUrl('Landing'));
        return;
      }
      setUser({ id: authUser.id, email: authUser.email });
      await loadData(authUser.id);
    };
    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session?.user) {
        navigate(createPageUrl('Landing'));
        return;
      }
      setUser({ id: session.user.id, email: session.user.email });
      await loadData(session.user.id);
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadData = async (userId) => {
    if (!userId) return;
    
    const [profileRes, statsRes, historyRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).limit(1),
      supabase.from('stats').select('*').eq('user_id', userId).limit(1),
      supabase.from('dungeon_runs').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
    ]);
    const profiles = profileRes.data || [];
    const statsRows = statsRes.data || [];
    const historyData = historyRes.data || [];
    if (!profiles || profiles.length === 0) { navigate(createPageUrl('Landing')); return; }
    setProfile(profiles[0]);
    setActiveDungeon(statsRows[0]?.active_dungeon || null);
    setDungeonHistory(historyData || []);
    setLoading(false);
  };

  const startDungeon = async (challenge, options = {}) => {
    setStarting(true);
    const duration = options.duration || 7;
    const endDate = format(addDays(new Date(), duration), 'yyyy-MM-dd');
    
    const payload = {
      id: crypto.randomUUID(),
      user_id: user.id,
      challenge_title: options.title || challenge.title,
      challenge_description: options.description || challenge.description,
      start_date: today,
      end_date: endDate,
      status: 'active',
      xp_bonus_multiplier: options.xp_multiplier || 1.5,
      punishment_mode: options.punishment_mode || 'random',
      custom_punishment_text: options.custom_punishment || '',
      duration_days: duration,
    };

    await supabase.from('stats').upsert({ user_id: user.id, active_dungeon: payload });
    setActiveDungeon(payload);
    setStarting(false);
    setShowHistory(false);
  };

  const startCustomDungeon = async () => {
    if (!customForm.title.trim()) return;
    await startDungeon({}, {
      title: customForm.title,
      description: customForm.description,
      duration: customForm.duration,
      xp_multiplier: customForm.xp_multiplier,
      punishment_mode: customForm.punishment_mode,
      custom_punishment: customForm.custom_punishment,
    });
    setMode('select');
  };

  const completeDungeon = async () => {
    if (!activeDungeon || !profile) return;
    
    const lvl = computeLevel(profile.total_xp || 0);
    const xp = bonusXP('dungeon_clear', lvl);
    const payload = buildXPUpdatePayload(profile, xp);

    await supabase.from('profiles').update(payload).eq('id', profile.id);
    await supabase.from('xp_logs').insert({ user_id: user.id, xp_change: xp, source: 'dungeon_clear', date: today });
    
    // Save to dungeon history
    await supabase.from('dungeon_runs').insert({
      user_id: user.id,
      challenge_title: activeDungeon.challenge_title,
      challenge_description: activeDungeon.challenge_description,
      start_date: activeDungeon.start_date,
      end_date: today,
      status: 'completed',
      xp_bonus_multiplier: activeDungeon.xp_bonus_multiplier,
      xp_reward: xp,
      xp_penalty: 0,
      duration_days: activeDungeon.duration_days,
      completed_days: activeDungeon.duration_days,
      punishment_mode: activeDungeon.punishment_mode,
      custom_punishment_text: activeDungeon.custom_punishment_text,
    });

    await supabase.from('stats').update({ active_dungeon: null }).eq('user_id', user.id);
    setProfile({ ...profile, ...payload });
    setActiveDungeon(null);
    setCleared(true);
    loadData(user.id);
  };

  const failDungeon = async () => {
    if (!activeDungeon || !profile) return;

    const lvl = computeLevel(profile.total_xp || 0);
    const xpPenalty = Math.floor((profile.total_xp || 0) * 0.12);
    const newXP = Math.max(0, (profile.total_xp || 0) - xpPenalty);
    const newLvl = computeLevel(newXP);

    const statPenalty = {};
    ['stat_discipline', 'stat_consistency'].forEach(k => {
      statPenalty[k] = Math.max(0, (profile[k] || 0) - 2);
    });

    const payload = {
      total_xp: newXP, current_xp: newXP, level: newLvl,
      ...statPenalty,
    };
    
    await supabase.from('profiles').update(payload).eq('id', profile.id);
    await supabase.from('xp_logs').insert({ user_id: user.id, xp_change: -xpPenalty, source: 'dungeon_fail', date: today });
    
    // Save to dungeon history
    await supabase.from('dungeon_runs').insert({
      user_id: user.id,
      challenge_title: activeDungeon.challenge_title,
      challenge_description: activeDungeon.challenge_description,
      start_date: activeDungeon.start_date,
      end_date: today,
      status: 'failed',
      xp_bonus_multiplier: activeDungeon.xp_bonus_multiplier,
      xp_reward: 0,
      xp_penalty: xpPenalty,
      duration_days: activeDungeon.duration_days,
      completed_days: totalDays - daysLeft,
      punishment_mode: activeDungeon.punishment_mode,
      custom_punishment_text: activeDungeon.custom_punishment_text,
    });

    await supabase.from('stats').update({ active_dungeon: null }).eq('user_id', user.id);
    setProfile({ ...profile, ...payload });
    setActiveDungeon(null);

    if (activeDungeon.punishment_mode === 'random') {
      const punishment = getRandomHardPunishment(lvl, profile.stat_discipline || 0);
      alert(`DUNGEON FAILED\n\n−${xpPenalty} XP\n\nFailure Punishment:\n${punishment.text}`);
    }
    loadData(user.id);
  };

  const quitDungeon = async () => {
    if (!activeDungeon || !profile) return;
    if (!confirm('Are you sure you want to quit this dungeon? No XP will be awarded.')) return;

    // Save to dungeon history as quit
    await supabase.from('dungeon_runs').insert({
      user_id: user.id,
      challenge_title: activeDungeon.challenge_title,
      challenge_description: activeDungeon.challenge_description,
      start_date: activeDungeon.start_date,
      end_date: today,
      status: 'quit',
      xp_bonus_multiplier: activeDungeon.xp_bonus_multiplier,
      xp_reward: 0,
      xp_penalty: 0,
      duration_days: activeDungeon.duration_days,
      completed_days: totalDays - daysLeft,
      punishment_mode: activeDungeon.punishment_mode,
      custom_punishment_text: activeDungeon.custom_punishment_text,
    });

    await supabase.from('stats').update({ active_dungeon: null }).eq('user_id', user.id);
    setActiveDungeon(null);
    alert('Dungeon quit. You can start a new dungeon anytime.');
    loadData(user.id);
  };

  const daysLeft = activeDungeon
    ? Math.max(0, differenceInDays(parseISO(activeDungeon.end_date), new Date()) + 1)
    : 0;
  const totalDays = activeDungeon?.duration_days || 7;
  const progressPct = activeDungeon ? Math.min(100, ((totalDays - daysLeft) / totalDays) * 100) : 0;
  const isDungeonMode = !!activeDungeon;
  const xpMult = activeDungeon?.xp_bonus_multiplier || 1.5;

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#0f2027' }}>
      <div className="w-8 h-8 rounded-full border-2 border-red-400 border-t-transparent animate-spin" />
    </div>
  );

  return (
    <div className="relative min-h-screen" style={{
      background: isDungeonMode
        ? 'linear-gradient(135deg, #1a0505 0%, #2d0f0f 40%, #1a1a2e 100%)'
        : 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
    }}>
      {isDungeonMode && (
        <div style={{
          position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
          backgroundImage: `linear-gradient(rgba(248,113,113,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(248,113,113,0.04) 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
          animation: 'redPulse 3s ease-in-out infinite',
        }} />
      )}

      <div className="relative z-10 max-w-2xl mx-auto p-4 md:p-6 space-y-5">

        <div className="flex items-center gap-3 py-2">
          <button onClick={() => navigate(createPageUrl('Dashboard'))}
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ background: 'rgba(10,5,5,0.8)', border: `1px solid ${isDungeonMode ? 'rgba(248,113,113,0.3)' : 'rgba(56,189,248,0.2)'}` }}>
            <ArrowLeft className="w-4 h-4 text-white" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-black tracking-widest text-white"
              style={{ textShadow: `0 0 10px ${isDungeonMode ? 'rgba(248,113,113,0.6)' : 'rgba(56,189,248,0.4)'}` }}>
              {isDungeonMode ? '⚔ DUNGEON IN PROGRESS' : 'DUNGEON SELECT'}
            </h1>
            <p className="text-xs font-mono" style={{ color: isDungeonMode ? '#F8717166' : '#38BDF866' }}>
              {isDungeonMode ? `${daysLeft}d REMAINING · ${xpMult}× XP` : 'HIGH-DIFFICULTY CHALLENGE'}
            </p>
          </div>
          {!isDungeonMode && (
            <button onClick={() => setShowHistory(!showHistory)}
              className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(10,5,5,0.8)', border: '1px solid rgba(248,113,113,0.3)' }}>
              <History className="w-4 h-4 text-white" />
            </button>
          )}
        </div>

        {/* Dungeon History Panel */}
        <AnimatePresence>
          {showHistory && !isDungeonMode && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <div className="rounded-2xl p-4 space-y-3" style={{ background: 'rgba(10,5,5,0.8)', border: '1px solid rgba(248,113,113,0.3)' }}>
                <p className="text-xs font-black tracking-widest" style={{ color: '#F87171' }}>DUNGEON HISTORY</p>
                {dungeonHistory.length === 0 ? (
                  <p className="text-sm" style={{ color: '#64748B' }}>No dungeon runs yet.</p>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {dungeonHistory.map((run) => (
                      <div key={run.id} className="rounded-lg p-3 flex items-center justify-between" 
                        style={{ background: 'rgba(15,25,33,0.6)', border: '1px solid rgba(248,113,113,0.15)' }}>
                        <div>
                          <p className="text-sm font-bold text-white">{run.challenge_title}</p>
                          <p className="text-xs" style={{ color: '#64748B' }}>
                            {run.start_date} → {run.end_date} · {run.completed_days}/{run.duration_days} days
                          </p>
                        </div>
                        <span className={`text-xs font-bold px-2 py-1 rounded ${
                          run.status === 'completed' ? 'bg-green-900/50 text-green-300 border border-green-700' :
                          run.status === 'failed' ? 'bg-red-900/50 text-red-300 border border-red-700' :
                          'bg-yellow-900/50 text-yellow-300 border border-yellow-700'
                        }`}>
                          {run.status.toUpperCase()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {cleared && (
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              className="rounded-2xl p-6 text-center"
              style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.4)', boxShadow: '0 0 40px rgba(52,211,153,0.15)' }}>
              <p className="text-3xl mb-2">🏆</p>
              <p className="text-xl font-black text-white mb-1">DUNGEON CLEARED</p>
              <p className="text-sm" style={{ color: '#34D399' }}>+{bonusXP('dungeon_clear', computeLevel(profile?.total_xp || 0))} XP · Achievement Unlocked</p>
            </motion.div>
          )}
        </AnimatePresence>

        {activeDungeon && (
          <div className="rounded-2xl p-5 space-y-4"
            style={{ background: 'rgba(30,5,5,0.85)', border: '2px solid rgba(248,113,113,0.5)', boxShadow: '0 0 40px rgba(248,113,113,0.15), inset 0 0 40px rgba(248,113,113,0.03)', backdropFilter: 'blur(16px)' }}>
            <div className="flex items-center gap-2 mb-2">
              <Flame className="w-4 h-4 animate-pulse" style={{ color: '#F87171' }} />
              <span className="text-xs font-black tracking-widest" style={{ color: '#F87171' }}>DUNGEON IN PROGRESS</span>
              <span className="ml-auto text-xs font-black px-2 py-0.5 rounded"
                style={{ background: 'rgba(251,191,36,0.12)', color: '#FBBF24', border: '1px solid rgba(251,191,36,0.3)' }}>
                {xpMult}× XP
              </span>
            </div>

            <div>
              <p className="text-xl font-black text-white mb-1">{activeDungeon.challenge_title}</p>
              <p className="text-sm" style={{ color: '#94A3B8' }}>{activeDungeon.challenge_description}</p>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-bold" style={{ color: '#64748B' }}>
                <span>DUNGEON PROGRESS</span>
                <span style={{ color: '#F87171' }}>{daysLeft} DAYS LEFT</span>
              </div>
              <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'rgba(248,113,113,0.1)' }}>
                <div className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${progressPct}%`, background: 'linear-gradient(90deg, #F87171, #38BDF8)' }} />
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-1 text-center p-3 rounded-xl" style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}>
                <p className="text-2xl font-black" style={{ color: '#F87171' }}>{daysLeft}</p>
                <p className="text-xs" style={{ color: '#64748B' }}>DAYS LEFT</p>
              </div>
              <div className="flex-1 text-center p-3 rounded-xl" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)' }}>
                <p className="text-2xl font-black" style={{ color: '#FBBF24' }}>{xpMult}×</p>
                <p className="text-xs" style={{ color: '#64748B' }}>XP MULTIPLIER</p>
              </div>
              <div className="flex-1 text-center p-3 rounded-xl"
                style={{ background: `rgba(56,189,248,0.08)`, border: `1px solid rgba(56,189,248,0.2)` }}>
                <p className="text-sm font-black pt-1" style={{ color: '#38BDF8' }}>
                  {activeDungeon.punishment_mode === 'random' ? 'RANDOM' : 'CUSTOM'}
                </p>
                <p className="text-xs" style={{ color: '#64748B' }}>PUNISHMENT</p>
              </div>
            </div>

            <div className="flex gap-3">
              <Button onClick={completeDungeon} className="flex-1 font-black tracking-widest"
                style={{ background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.4)', color: '#34D399' }}>
                <Trophy className="w-4 h-4 mr-2" /> MARK CLEARED
              </Button>
              <Button onClick={quitDungeon} variant="ghost" className="font-black tracking-widest px-4"
                style={{ border: '1px solid rgba(248,113,113,0.3)', color: '#F87171' }}>
                <X className="w-4 h-4" />
              </Button>
              <Button onClick={failDungeon} variant="ghost" className="font-black tracking-widest px-4"
                style={{ border: '1px solid rgba(248,113,113,0.3)', color: '#F87171' }}>
                <Skull className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {!activeDungeon && !cleared && !showHistory && (
          <>
            <div className="flex gap-2">
              {['select', 'custom'].map(m => (
                <button key={m} onClick={() => setMode(m)}
                  className="flex-1 py-2 rounded-lg text-xs font-black tracking-widest transition-all"
                  style={{
                    background: mode === m ? 'rgba(248,113,113,0.15)' : 'rgba(10,5,5,0.6)',
                    border: `1px solid ${mode === m ? 'rgba(248,113,113,0.5)' : 'rgba(248,113,113,0.15)'}`,
                    color: mode === m ? '#F87171' : '#475569',
                  }}>
                  {m === 'select' ? 'PRESET TRIALS' : 'CUSTOM DUNGEON'}
                </button>
              ))}
            </div>

            {mode === 'select' && (
              <div className="space-y-3">
                <p className="text-xs font-black tracking-widest" style={{ color: '#64748B' }}>SELECT YOUR TRIAL</p>
                {DUNGEON_CHALLENGES.map((ch, i) => (
                  <motion.div key={ch.title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
                    className="rounded-xl p-4 flex items-center gap-4"
                    style={{ background: 'rgba(10,25,33,0.7)', border: '1px solid rgba(248,113,113,0.15)', backdropFilter: 'blur(12px)' }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-black text-white">{ch.title}</p>
                      <p className="text-xs mt-0.5" style={{ color: '#64748B' }}>{ch.description}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-xs font-bold px-2 py-0.5 rounded"
                          style={{ background: ch.difficulty === 'hard' ? 'rgba(248,113,113,0.15)' : 'rgba(251,191,36,0.15)', color: ch.difficulty === 'hard' ? '#F87171' : '#FBBF24' }}>
                          {ch.difficulty.toUpperCase()}
                        </span>
                        <span className="text-xs" style={{ color: '#FBBF24' }}>+{bonusXP('dungeon_clear', computeLevel(profile?.total_xp || 0))} XP on clear</span>
                      </div>
                    </div>
                    <Button size="sm" onClick={() => startDungeon(ch)} disabled={starting}
                      className="text-xs font-black tracking-widest px-4"
                      style={{ background: 'rgba(248,113,113,0.15)', border: '1px solid rgba(248,113,113,0.35)', color: '#F87171' }}>
                      {starting ? '...' : 'ENTER'}
                    </Button>
                  </motion.div>
                ))}
              </div>
            )}

            {mode === 'custom' && (
              <div className="rounded-2xl p-5 space-y-4"
                style={{ background: 'rgba(10,5,5,0.8)', border: '1px solid rgba(248,113,113,0.25)' }}>
                <p className="text-xs font-black tracking-widest" style={{ color: '#F87171' }}>CREATE CUSTOM DUNGEON</p>

                <div className="space-y-1.5">
                  <Label className="text-xs font-black tracking-widest" style={{ color: '#64748B' }}>DUNGEON NAME</Label>
                  <Input value={customForm.title} onChange={e => setCustomForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="e.g. The No-Excuse Protocol"
                    style={{ background: 'rgba(10,5,5,0.8)', border: '1px solid rgba(248,113,113,0.2)', color: '#F1F5F9' }} />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-black tracking-widest" style={{ color: '#64748B' }}>DESCRIPTION / REQUIRED TASKS</Label>
                  <Input value={customForm.description} onChange={e => setCustomForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="What must be done each day?"
                    style={{ background: 'rgba(10,5,5,0.8)', border: '1px solid rgba(248,113,113,0.2)', color: '#F1F5F9' }} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-black tracking-widest" style={{ color: '#64748B' }}>DURATION (DAYS)</Label>
                    <div className="flex flex-wrap gap-1">
                      {DURATION_OPTIONS.map(d => (
                        <button key={d} onClick={() => setCustomForm(f => ({ ...f, duration: d }))}
                          className="px-2 py-1 rounded text-xs font-black"
                          style={{
                            background: customForm.duration === d ? 'rgba(248,113,113,0.2)' : 'rgba(10,5,5,0.6)',
                            border: `1px solid ${customForm.duration === d ? 'rgba(248,113,113,0.5)' : 'rgba(248,113,113,0.1)'}`,
                            color: customForm.duration === d ? '#F87171' : '#475569',
                          }}>
                          {d}d
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-black tracking-widest" style={{ color: '#64748B' }}>XP MULTIPLIER</Label>
                    <div className="flex flex-wrap gap-1">
                      {XP_MULTIPLIER_OPTIONS.map(m => (
                        <button key={m} onClick={() => setCustomForm(f => ({ ...f, xp_multiplier: m }))}
                          className="px-2 py-1 rounded text-xs font-black"
                          style={{
                            background: customForm.xp_multiplier === m ? 'rgba(251,191,36,0.2)' : 'rgba(10,5,5,0.6)',
                            border: `1px solid ${customForm.xp_multiplier === m ? 'rgba(251,191,36,0.5)' : 'rgba(251,191,36,0.1)'}`,
                            color: customForm.xp_multiplier === m ? '#FBBF24' : '#475569',
                          }}>
                          {m}×
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-black tracking-widest" style={{ color: '#64748B' }}>FAILURE PUNISHMENT MODE</Label>
                  <div className="flex gap-2">
                    {['random', 'custom'].map(pm => (
                      <button key={pm} onClick={() => setCustomForm(f => ({ ...f, punishment_mode: pm }))}
                        className="flex-1 py-2 rounded-lg text-xs font-black tracking-widest"
                        style={{
                          background: customForm.punishment_mode === pm ? 'rgba(56,189,248,0.15)' : 'rgba(10,5,5,0.6)',
                          border: `1px solid ${customForm.punishment_mode === pm ? 'rgba(56,189,248,0.4)' : 'rgba(56,189,248,0.1)'}`,
                          color: customForm.punishment_mode === pm ? '#38BDF8' : '#475569',
                        }}>
                        {pm === 'random' ? 'RANDOM HARD' : 'CUSTOM'}
                      </button>
                    ))}
                  </div>
                </div>

                {customForm.punishment_mode === 'random' && (
                  <div className="rounded-xl p-3 space-y-1" style={{ background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.2)' }}>
                    <p className="text-xs font-black tracking-widest" style={{ color: '#38BDF8' }}>RANDOM PUNISHMENT POOL</p>
                    {HIGH_DIFFICULTY_PUNISHMENTS.slice(0, 4).map((p, i) => (
                      <p key={i} className="text-xs" style={{ color: '#64748B' }}>· {p.text}</p>
                    ))}
                    <p className="text-xs" style={{ color: '#475569' }}>+ {HIGH_DIFFICULTY_PUNISHMENTS.length - 4} more</p>
                  </div>
                )}

                {customForm.punishment_mode === 'custom' && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-black tracking-widest" style={{ color: '#64748B' }}>CUSTOM FAILURE PUNISHMENT</Label>
                    <Input value={customForm.custom_punishment} onChange={e => setCustomForm(f => ({ ...f, custom_punishment: e.target.value }))}
                      placeholder="e.g. 100 pushups immediately"
                      style={{ background: 'rgba(10,5,5,0.8)', border: '1px solid rgba(248,113,113,0.2)', color: '#F1F5F9' }} />
                  </div>
                )}

                <Button onClick={startCustomDungeon} disabled={starting || !customForm.title} className="w-full font-black tracking-widest"
                  style={{ background: 'rgba(248,113,113,0.15)', border: '1px solid rgba(248,113,113,0.4)', color: '#F87171' }}>
                  <Flame className="w-4 h-4 mr-2" />
                  {starting ? 'INITIATING...' : 'ENTER DUNGEON'}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <style>{`
        @keyframes redPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}
