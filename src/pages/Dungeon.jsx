import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { format, addDays } from 'date-fns';
import { ArrowLeft, Flame, Trophy, Skull, X, History, Users, Link2, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { motion, AnimatePresence } from 'framer-motion';
import { DUNGEON_CHALLENGES, HIGH_DIFFICULTY_PUNISHMENTS, getRandomHardPunishment } from '../components/systemFeatures';
import { computeLevel, bonusXP } from '../components/gameEngine';
import { applyProgressionSnapshot, awardXpRpc, penaltyXpRpc } from '@/lib/progression';
import { fetchActiveDungeonRun, getDungeonProgress } from '@/lib/gameState';
import XPDeltaPulse from '@/components/XPDeltaPulse';
import {
  claimDungeonPartyXp,
  createDungeonParty,
  fetchFriendActiveDungeons,
  fetchOwnedParty,
  fetchPartyForMember,
  fetchPartyMembers,
  fetchPartyRewards,
  joinDungeonParty,
  joinDungeonPartyByCode,
  registerDungeonPartyFailure,
  setDungeonPartyVisibility,
  startDungeonParty,
  subscribeToPartyRealtime,
  updateDungeonPartyProgress,
} from '@/lib/dungeonParty';

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
  const [loadError, setLoadError] = useState('');
  const [starting, setStarting] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [mode, setMode] = useState('select');
  const [showHistory, setShowHistory] = useState(false);
  const [xpDelta, setXpDelta] = useState(0);
  const [customForm, setCustomForm] = useState({
    title: '', description: '', duration: 7,
    xp_multiplier: 1.5, punishment_mode: 'random', custom_punishment: '',
  });
  const [entryMode, setEntryMode] = useState('solo');
  const [party, setParty] = useState(null);
  const [partyMembers, setPartyMembers] = useState([]);
  const [partyRewards, setPartyRewards] = useState([]);
  const [friendRuns, setFriendRuns] = useState([]);
  const [partyBusy, setPartyBusy] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [partyForm, setPartyForm] = useState({
    title: '',
    visibility: 'friends',
    maxMembers: 4,
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

  useEffect(() => {
    if (!xpDelta) return undefined;
    const timeoutId = setTimeout(() => setXpDelta(0), 1200);
    return () => clearTimeout(timeoutId);
  }, [xpDelta]);

  const loadPartyState = async (userId) => {
    if (!userId) {
      setParty(null);
      setPartyMembers([]);
      setPartyRewards([]);
      setFriendRuns([]);
      return;
    }

    const owned = await fetchOwnedParty(userId);
    const joined = owned ? null : await fetchPartyForMember(userId);
    const currentParty = owned || joined || null;
    setParty(currentParty);

    if (currentParty?.id) {
      const [members, rewards] = await Promise.all([
        fetchPartyMembers(currentParty.id),
        fetchPartyRewards(currentParty.id),
      ]);
      setPartyMembers(members || []);
      setPartyRewards(rewards || []);
      if (!partyForm.title && currentParty.title) {
        setPartyForm((prev) => ({
          ...prev,
          title: currentParty.title,
          visibility: currentParty.visibility || prev.visibility,
          maxMembers: currentParty.max_members || prev.maxMembers,
        }));
      }
    } else {
      setPartyMembers([]);
      setPartyRewards([]);
    }

    try {
      const activeFriends = await fetchFriendActiveDungeons(userId);
      setFriendRuns(activeFriends || []);
    } catch (_) {
      setFriendRuns([]);
    }
  };

  useEffect(() => {
    if (!user?.id || !party?.id) return undefined;
    const unsubscribe = subscribeToPartyRealtime({
      partyId: party.id,
      userId: user.id,
      onPartyChange: () => {
        void loadPartyState(user.id);
      },
      onMemberChange: () => {
        void loadPartyState(user.id);
      },
      onRewardChange: () => {
        void loadPartyState(user.id);
      },
      onXpLog: (payload) => {
        const row = payload?.new || {};
        const delta = Number(row.change_amount ?? row.xp_change ?? 0);
        if (Number.isFinite(delta) && delta !== 0) setXpDelta(delta);
      },
    });
    return unsubscribe;
  }, [party?.id, user?.id]);

  const loadData = async (userId) => {
    if (!userId) return;
    setLoading(true);
    setLoadError('');
    try {
      const [profileRes, historyRes, activeRun] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', userId).limit(1),
        supabase.from('dungeon_runs').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
        fetchActiveDungeonRun(userId),
      ]);
      if (profileRes.error) throw profileRes.error;
      if (historyRes.error) throw historyRes.error;

      const profiles = profileRes.data || [];
      const historyData = historyRes.data || [];
      if (!profiles || profiles.length === 0) {
        navigate(createPageUrl('Landing'));
        return;
      }
      setProfile(profiles[0]);
      setActiveDungeon(activeRun || null);
      setDungeonHistory(historyData || []);
      await loadPartyState(userId);
    } catch (err) {
      setLoadError(err?.message || 'Failed to load dungeon data.');
    } finally {
      setLoading(false);
    }
  };

  const startDungeon = async (challenge, options = {}) => {
    if (!user?.id) return;
    setStarting(true);
    try {
      const existingRun = await fetchActiveDungeonRun(user.id);
      if (existingRun?.id) {
        setActiveDungeon(existingRun);
        alert('A dungeon is already active. Finish it before entering another one.');
        return;
      }

      const duration = options.duration || 7;
      const endDate = format(addDays(new Date(), duration), 'yyyy-MM-dd');
      const payload = {
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
        completed_days: 0,
        stability: 100,
        interruptions_count: 0,
        mode: 'solo',
      };

      const { data: createdRun, error: createError } = await supabase
        .from('dungeon_runs')
        .insert(payload)
        .select('*')
        .single();
      if (createError) throw createError;
      setActiveDungeon(createdRun || payload);
      setShowHistory(false);
      setCleared(false);
    } catch (err) {
      alert(err?.message || 'Failed to start dungeon.');
    } finally {
      setStarting(false);
    }
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

  const createParty = async () => {
    if (!user?.id || partyBusy) return;
    setPartyBusy(true);
    try {
      const partyId = await createDungeonParty({
        userId: user.id,
        title: partyForm.title || 'Collaborative Dungeon',
        visibility: partyForm.visibility,
        maxMembers: Number(partyForm.maxMembers || 4),
      });
      if (!partyId) throw new Error('Failed to create party');
      await setDungeonPartyVisibility({
        userId: user.id,
        partyId,
        visibility: partyForm.visibility,
        maxMembers: Number(partyForm.maxMembers || 4),
      });
      await loadPartyState(user.id);
      setEntryMode('collab');
    } catch (err) {
      alert(err?.message || 'Failed to create party.');
    } finally {
      setPartyBusy(false);
    }
  };

  const joinPartyByCode = async () => {
    if (!user?.id || !joinCode.trim() || partyBusy) return;
    setPartyBusy(true);
    try {
      await joinDungeonPartyByCode({
        userId: user.id,
        inviteCode: joinCode.trim(),
      });
      setJoinCode('');
      await loadPartyState(user.id);
      await loadData(user.id);
    } catch (err) {
      alert(err?.message || 'Failed to join party.');
    } finally {
      setPartyBusy(false);
    }
  };

  const joinFriendParty = async (partyId) => {
    if (!user?.id || !partyId || partyBusy) return;
    setPartyBusy(true);
    try {
      await joinDungeonParty({ userId: user.id, partyId, role: 'member' });
      await loadPartyState(user.id);
      await loadData(user.id);
    } catch (err) {
      alert(err?.message || 'Failed to join friend party.');
    } finally {
      setPartyBusy(false);
    }
  };

  const startPartyDungeon = async () => {
    if (!user?.id || !party?.id || partyBusy) return;
    setPartyBusy(true);
    try {
      await startDungeonParty({
        userId: user.id,
        partyId: party.id,
        durationDays: Number(customForm.duration || 7),
        xpMultiplier: Number(customForm.xp_multiplier || 1.5),
      });
      await loadData(user.id);
    } catch (err) {
      alert(err?.message || 'Failed to start party dungeon.');
    } finally {
      setPartyBusy(false);
    }
  };

  const contributePartyProgress = async (delta = 10) => {
    if (!user?.id || !party?.id || partyBusy) return;
    setPartyBusy(true);
    try {
      await updateDungeonPartyProgress({
        userId: user.id,
        partyId: party.id,
        progressDelta: delta,
        xpPool: 600,
      });
      await loadPartyState(user.id);
    } catch (err) {
      alert(err?.message || 'Failed to update party progress.');
    } finally {
      setPartyBusy(false);
    }
  };

  const failPartyRun = async () => {
    if (!user?.id || !party?.id || partyBusy) return;
    setPartyBusy(true);
    try {
      await registerDungeonPartyFailure({
        userId: user.id,
        partyId: party.id,
        failedUserId: user.id,
        stabilityPenalty: 15,
      });
      await loadPartyState(user.id);
      await loadData(user.id);
    } catch (err) {
      alert(err?.message || 'Failed to apply party failure penalty.');
    } finally {
      setPartyBusy(false);
    }
  };

  const claimPartyReward = async () => {
    if (!user?.id || !party?.id || partyBusy || !profile) return;
    setPartyBusy(true);
    try {
      const snapshot = await claimDungeonPartyXp({ userId: user.id, partyId: party.id });
      const merged = applyProgressionSnapshot(profile, null, snapshot);
      if (merged.nextProfile) {
        setXpDelta((merged.nextProfile.total_xp || 0) - (profile?.total_xp || 0));
        setProfile(merged.nextProfile);
      }
      await loadPartyState(user.id);
      await loadData(user.id);
    } catch (err) {
      alert(err?.message || 'Failed to claim party reward.');
    } finally {
      setPartyBusy(false);
    }
  };

  const completeDungeon = async () => {
    if (!activeDungeon || !profile || !user?.id) return;

    try {
      const lvl = computeLevel(profile.total_xp || 0);
      const baseXp = bonusXP('dungeon_clear', lvl);
      const xpMultiplier = Number(activeDungeon.xp_bonus_multiplier || 1.5);
      const xp = Math.max(0, Math.floor(baseXp * xpMultiplier));
      const snapshot = await awardXpRpc({
        userId: user.id,
        xpAmount: xp,
        source: 'dungeon_clear',
        eventId: `dungeon:${activeDungeon.id}:clear`,
        metadata: { dungeon_run_id: activeDungeon.id, xp_multiplier: xpMultiplier },
      });
      const { nextProfile } = applyProgressionSnapshot(profile, null, snapshot);
      const progress = getDungeonProgress(activeDungeon);

      const { error: runError } = await supabase
        .from('dungeon_runs')
        .update({
          status: 'completed',
          end_date: today,
          xp_reward: xp,
          xp_penalty: 0,
          completed_days: progress.elapsedDays,
          stability: Math.max(0, Number(activeDungeon.stability ?? 100)),
        })
        .eq('id', activeDungeon.id)
        .eq('user_id', user.id);
      if (runError) throw runError;

      setProfile(nextProfile);
      setXpDelta((nextProfile?.total_xp || 0) - (profile?.total_xp || 0));
      setActiveDungeon(null);
      setCleared(true);
      await loadData(user.id);
    } catch (err) {
      alert(err?.message || 'Failed to complete dungeon.');
    }
  };

  const failDungeon = async () => {
    if (!activeDungeon || !profile || !user?.id) return;

    try {
      const lvl = computeLevel(profile.total_xp || 0);
      const xpPenalty = Math.max(0, Math.floor((profile.total_xp || 0) * 0.12));
      const snapshot = await penaltyXpRpc({
        userId: user.id,
        xpAmount: xpPenalty,
        source: 'dungeon_fail',
        shadowDebtAmount: Math.ceil(xpPenalty * 0.5),
        eventId: `dungeon:${activeDungeon.id}:fail`,
        metadata: { dungeon_run_id: activeDungeon.id, manual: true },
      });
      const { nextProfile } = applyProgressionSnapshot(profile, null, snapshot);
      const statPenalty = {
        stat_discipline: Math.max(0, (nextProfile?.stat_discipline || profile.stat_discipline || 0) - 2),
        stat_consistency: Math.max(0, (nextProfile?.stat_consistency || profile.stat_consistency || 0) - 2),
      };
      const { error: statPenaltyError } = await supabase
        .from('profiles')
        .update(statPenalty)
        .eq('id', user.id);
      if (statPenaltyError) throw statPenaltyError;

      const progress = getDungeonProgress(activeDungeon);
      const { error: runError } = await supabase
        .from('dungeon_runs')
        .update({
          status: 'failed',
          end_date: today,
          xp_reward: 0,
          xp_penalty: xpPenalty,
          completed_days: progress.elapsedDays,
          stability: 0,
        })
        .eq('id', activeDungeon.id)
        .eq('user_id', user.id);
      if (runError) throw runError;

      setProfile({ ...nextProfile, ...statPenalty });
      setXpDelta((nextProfile?.total_xp || 0) - (profile?.total_xp || 0));
      setActiveDungeon(null);

      if (activeDungeon.punishment_mode === 'random') {
        const punishment = getRandomHardPunishment(lvl, profile.stat_discipline || 0);
        alert(`DUNGEON FAILED\n\n−${xpPenalty} XP\n\nFailure Punishment:\n${punishment.text}`);
      }
      await loadData(user.id);
    } catch (err) {
      alert(err?.message || 'Failed to fail dungeon.');
    }
  };

  const quitDungeon = async () => {
    if (!activeDungeon || !profile || !user?.id) return;
    if (!confirm('Are you sure you want to quit this dungeon? No XP will be awarded.')) return;

    try {
      const progress = getDungeonProgress(activeDungeon);
      const { error } = await supabase
        .from('dungeon_runs')
        .update({
          status: 'quit',
          end_date: today,
          completed_days: progress.elapsedDays,
        })
        .eq('id', activeDungeon.id)
        .eq('user_id', user.id);
      if (error) throw error;
      setActiveDungeon(null);
      alert('Dungeon quit. You can start a new dungeon anytime.');
      await loadData(user.id);
    } catch (err) {
      alert(err?.message || 'Failed to quit dungeon.');
    }
  };

  const dungeonProgress = getDungeonProgress(activeDungeon);
  const daysLeft = dungeonProgress.daysLeft;
  const totalDays = dungeonProgress.totalDays || 7;
  const progressPct = dungeonProgress.pct || 0;
  const stability = Math.max(0, Number(activeDungeon?.stability ?? 100));
  const stabilityPct = Math.min(100, stability);
  const isDungeonMode = !!activeDungeon;
  const xpMult = activeDungeon?.xp_bonus_multiplier || 1.5;
  const isCollabRun = activeDungeon?.mode === 'collab';
  const isPartyHost = !!(user?.id && party?.host_user_id === user.id);
  const memberCount = (partyMembers || []).filter((m) => ['joined', 'completed'].includes(m.status)).length;
  const myPartyReward = (partyRewards || []).find((r) => r.user_id === user?.id) || null;
  const myPartyMember = (partyMembers || []).find((m) => m.user_id === user?.id) || null;

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#0f2027' }}>
      <div className="w-8 h-8 rounded-full border-2 border-red-400 border-t-transparent animate-spin" />
    </div>
  );

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#0f2027' }}>
        <div className="w-full max-w-md rounded-2xl p-5 space-y-3" style={{ background: 'rgba(10,5,5,0.8)', border: '1px solid rgba(248,113,113,0.35)' }}>
          <p className="text-xs font-black tracking-widest" style={{ color: '#F87171' }}>DUNGEON LOAD FAILED</p>
          <p className="text-sm" style={{ color: '#94A3B8' }}>{loadError}</p>
          <div className="flex gap-2">
            <Button onClick={() => user?.id && loadData(user.id)} className="flex-1">Retry</Button>
            <Button variant="outline" onClick={() => navigate(createPageUrl('Dashboard'))}>Back</Button>
          </div>
        </div>
      </div>
    );
  }

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

        <div className="min-h-5 flex justify-center">
          <XPDeltaPulse value={xpDelta} visible={xpDelta !== 0} />
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
                <span style={{ color: '#F87171' }}>{Math.round(progressPct)}% · {daysLeft} DAYS LEFT</span>
              </div>
              <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'rgba(248,113,113,0.1)' }}>
                <div className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${progressPct}%`, background: 'linear-gradient(90deg, #F87171, #38BDF8)' }} />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-bold" style={{ color: '#64748B' }}>
                <span>STABILITY METER</span>
                <span style={{ color: stability > 40 ? '#34D399' : '#F87171' }}>{stabilityPct}%</span>
              </div>
              <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'rgba(15,23,42,0.6)' }}>
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${stabilityPct}%`,
                    background: stability > 40
                      ? 'linear-gradient(90deg, #34D399, #10B981)'
                      : 'linear-gradient(90deg, #F87171, #DC2626)',
                  }}
                />
              </div>
              <p className="text-[10px]" style={{ color: '#94A3B8' }}>
                Interruptions reduce stability. The dungeon fails at 0%.
              </p>
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
              <div className="flex-1 text-center p-3 rounded-xl"
                style={{ background: `rgba(52,211,153,0.08)`, border: `1px solid rgba(52,211,153,0.2)` }}>
                <p className="text-2xl font-black" style={{ color: stability > 40 ? '#34D399' : '#F87171' }}>{stabilityPct}%</p>
                <p className="text-xs" style={{ color: '#64748B' }}>STABILITY</p>
              </div>
            </div>

            {isCollabRun && party && (
              <div className="rounded-xl p-3 space-y-2" style={{ background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.3)' }}>
                <div className="flex items-center justify-between text-xs">
                  <p className="font-black tracking-widest text-cyan-300">COLLAB PARTY</p>
                  <p className="font-bold text-slate-200">
                    {party.status?.toUpperCase()} · {memberCount} MEMBERS
                  </p>
                </div>
                <div className="h-2 rounded-full overflow-hidden bg-slate-900/70">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(0, Math.min(100, Number(party.shared_progress || 0)))}%`, background: 'linear-gradient(90deg, #38BDF8, #34D399)' }}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => contributePartyProgress(10)}
                    disabled={partyBusy || party.status === 'completed'}
                    className="flex-1"
                    style={{ background: 'rgba(56,189,248,0.18)', border: '1px solid rgba(56,189,248,0.45)', color: '#38BDF8' }}
                  >
                    <Users className="w-4 h-4 mr-2" /> +10% Shared Progress
                  </Button>
                  {myPartyReward && !myPartyReward.claimed && (
                    <Button onClick={claimPartyReward} disabled={partyBusy} className="flex-1">
                      <Trophy className="w-4 h-4 mr-2" /> Claim Party XP
                    </Button>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <Button onClick={isCollabRun ? () => contributePartyProgress(10) : completeDungeon} className="flex-1 font-black tracking-widest"
                style={{ background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.4)', color: '#34D399' }}>
                <Trophy className="w-4 h-4 mr-2" /> {isCollabRun ? 'CONTRIBUTE' : 'MARK CLEARED'}
              </Button>
              <Button onClick={quitDungeon} variant="ghost" className="font-black tracking-widest px-4"
                style={{ border: '1px solid rgba(248,113,113,0.3)', color: '#F87171' }}>
                <X className="w-4 h-4" />
              </Button>
              <Button onClick={isCollabRun ? failPartyRun : failDungeon} variant="ghost" className="font-black tracking-widest px-4"
                style={{ border: '1px solid rgba(248,113,113,0.3)', color: '#F87171' }}>
                <Skull className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {!activeDungeon && !cleared && !showHistory && (
          <>
            <div className="flex gap-2">
              {[
                { id: 'solo', label: 'SOLO MODE' },
                { id: 'collab', label: 'COLLAB MODE' },
              ].map((entry) => (
                <button key={entry.id} onClick={() => setEntryMode(entry.id)}
                  className="flex-1 py-2 rounded-lg text-xs font-black tracking-widest transition-all"
                  style={{
                    background: entryMode === entry.id ? 'rgba(56,189,248,0.15)' : 'rgba(10,5,5,0.6)',
                    border: `1px solid ${entryMode === entry.id ? 'rgba(56,189,248,0.5)' : 'rgba(56,189,248,0.15)'}`,
                    color: entryMode === entry.id ? '#38BDF8' : '#475569',
                  }}>
                  {entry.label}
                </button>
              ))}
            </div>

            {entryMode === 'solo' && (
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

            {entryMode === 'collab' && (
              <div className="space-y-3">
                <div className="rounded-2xl p-4 space-y-3" style={{ background: 'rgba(10,25,33,0.72)', border: '1px solid rgba(56,189,248,0.25)' }}>
                  <p className="text-xs font-black tracking-widest text-cyan-300 flex items-center gap-2">
                    <Users className="w-3.5 h-3.5" /> COLLAB PARTY
                  </p>

                  {!party && (
                    <>
                      <div className="grid grid-cols-12 gap-2">
                        <Input
                          className="col-span-7"
                          value={partyForm.title}
                          onChange={(e) => setPartyForm((prev) => ({ ...prev, title: e.target.value }))}
                          placeholder="Party title"
                        />
                        <select
                          className="col-span-3 rounded-md bg-slate-900/70 border border-slate-700 text-slate-100 text-xs px-2"
                          value={partyForm.visibility}
                          onChange={(e) => setPartyForm((prev) => ({ ...prev, visibility: e.target.value }))}
                        >
                          <option value="friends">Friends</option>
                          <option value="public">Public</option>
                          <option value="private">Private</option>
                        </select>
                        <Input
                          className="col-span-2"
                          type="number"
                          min={2}
                          max={16}
                          value={partyForm.maxMembers}
                          onChange={(e) => setPartyForm((prev) => ({ ...prev, maxMembers: e.target.value }))}
                        />
                      </div>
                      <Button onClick={createParty} disabled={partyBusy} className="w-full">
                        <PlayCircle className="w-4 h-4 mr-2" /> {partyBusy ? 'Creating...' : 'Create Party'}
                      </Button>

                      <div className="grid grid-cols-12 gap-2">
                        <Input
                          className="col-span-9"
                          value={joinCode}
                          onChange={(e) => setJoinCode(e.target.value)}
                          placeholder="Join with invite code"
                        />
                        <Button className="col-span-3" onClick={joinPartyByCode} disabled={partyBusy || !joinCode.trim()}>
                          Join
                        </Button>
                      </div>
                    </>
                  )}

                  {party && (
                    <div className="space-y-2">
                      <div className="rounded-lg p-3 border border-cyan-500/30 bg-slate-900/40">
                        <p className="text-sm font-bold text-white">{party.title || 'Collaborative Dungeon'}</p>
                        <p className="text-xs text-slate-400">
                          Status {party.status?.toUpperCase()} · Visibility {(party.visibility || 'friends').toUpperCase()} · Members {memberCount}/{party.max_members || 4}
                        </p>
                        <p className="text-xs text-cyan-300 mt-1">Invite Code: {party.invite_code || '...'}</p>
                      </div>
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {partyMembers.map((member) => (
                          <div key={member.user_id} className="rounded-md px-2 py-1.5 flex items-center justify-between border border-slate-700/50 bg-slate-900/40">
                            <p className="text-xs text-slate-100 truncate">{member.user_id}</p>
                            <p className="text-[10px] text-cyan-300 font-bold">{member.role?.toUpperCase()} · {member.status?.toUpperCase()}</p>
                          </div>
                        ))}
                      </div>
                      {isPartyHost && party.status === 'waiting' && (
                        <Button onClick={startPartyDungeon} disabled={partyBusy} className="w-full">
                          {partyBusy ? 'Starting...' : 'Start Party Dungeon'}
                        </Button>
                      )}
                      {myPartyReward && !myPartyReward.claimed && (
                        <Button variant="outline" onClick={claimPartyReward} disabled={partyBusy} className="w-full">
                          <Trophy className="w-4 h-4 mr-2" /> Claim Reward +{myPartyReward.xp_amount || 0} XP
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {friendRuns.length > 0 && (
                  <div className="rounded-2xl p-4 space-y-2" style={{ background: 'rgba(10,25,33,0.72)', border: '1px solid rgba(56,189,248,0.18)' }}>
                    <p className="text-xs font-black tracking-widest text-cyan-300 flex items-center gap-2">
                      <Link2 className="w-3.5 h-3.5" /> FRIEND ACTIVE DUNGEONS
                    </p>
                    {friendRuns.map((run) => (
                      <div key={run.dungeon_run_id} className="rounded-lg p-2 flex items-center justify-between gap-2" style={{ background: 'rgba(15,23,42,0.55)', border: '1px solid rgba(56,189,248,0.15)' }}>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-white truncate">{run.friend_name} · {run.challenge_title}</p>
                          <p className="text-[10px] text-slate-400">
                            {run.mode?.toUpperCase()} · {run.party_status?.toUpperCase()} · Progress {run.shared_progress || 0}%
                          </p>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => joinFriendParty(run.party_id)}
                          disabled={!run.can_join || partyBusy || !!activeDungeon}
                        >
                          Join
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
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
