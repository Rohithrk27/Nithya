import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Plus, Zap, Star, Shield, Skull, History, Trophy } from 'lucide-react';
import { format } from 'date-fns';
import QuestCard from '../components/QuestCard';
import { computeLevel } from '../components/gameEngine';
import { ensureDailyQuests } from '@/lib/questSystem';
import HoloPanel from '../components/HoloPanel';
import XPDeltaPulse from '@/components/XPDeltaPulse';
import { applyProgressionSnapshot, awardXpRpc } from '@/lib/progression';
import { fetchActiveWeeklyQuest } from '@/lib/gameState';

const today = format(new Date(), 'yyyy-MM-dd');

const resolveQuestStatus = (userQuest) => {
  // No user_quest row means the quest is not accepted by this user yet.
  if (!userQuest) return { status: 'inactive', completed_date: null };
  if (userQuest.status === 'completed') {
    return { status: 'completed', completed_date: userQuest.completed_date };
  }
  if (userQuest.status === 'failed') {
    return { status: 'failed', completed_date: userQuest.completed_date };
  }
  return { status: userQuest.status || 'active', completed_date: userQuest.completed_date || null };
};

const WEEKLY_QUESTS = [
  { title: 'Iron Will', description: 'Complete all habits for 7 consecutive days', xp_reward: 500, stat_reward: 'discipline', type: 'weekly', progress_target: 7 },
  { title: 'Strength Week', description: 'Complete workout habits 5 times this week', xp_reward: 400, stat_reward: 'strength', type: 'weekly', progress_target: 5 },
  { title: 'Scholar Path', description: 'Log 5 study sessions this week', xp_reward: 350, stat_reward: 'intelligence', type: 'weekly', progress_target: 5 },
];

const SPECIAL_QUESTS = [
  { title: 'Social Expansion', description: 'Connect with 3 new people this month', xp_reward: 600, stat_reward: 'social', type: 'special', min_level_required: 5 },
  { title: 'Career Leap', description: 'Apply to a job or complete a certification', xp_reward: 800, stat_reward: 'career', type: 'special', min_level_required: 10 },
  { title: 'Mind & Body', description: 'Hit BMI within healthy range (18.5–24.9)', xp_reward: 1000, stat_reward: 'health', type: 'special', min_level_required: 20 },
];

const EPIC_QUESTS = [
  { title: 'Hundred Day Trial', description: 'Maintain a 100-day streak on any habit', xp_reward: 5000, stat_reward: 'consistency', type: 'epic', min_level_required: 50 },
  { title: 'Ascension Protocol', description: 'Reach Tier 5 avatar evolution', xp_reward: 10000, stat_reward: 'discipline', type: 'epic', min_level_required: 100 },
  { title: 'System Override', description: 'Allocate 100 total stat points', xp_reward: 20000, stat_reward: 'strength', type: 'epic', min_level_required: 200 },
];

export default function Quests() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [quests, setQuests] = useState([]);
  const [xpHistory, setXpHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState('progress');
  const [actionLoading, setActionLoading] = useState(false);
  const [xpDelta, setXpDelta] = useState(0);
  const [xpHistoryFilter, setXpHistoryFilter] = useState('all');

  useEffect(() => {
    const init = async () => {
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (!authUser) {
          setLoading(false);
          navigate(createPageUrl('Landing'));
          return;
        }
        setUser({ id: authUser.id, email: authUser.email });
        await loadData(authUser.id);
      } catch (err) {
        setLoadError(err?.message || 'Failed to initialize quests.');
        setLoading(false);
      }
    };
    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session?.user) {
        setLoading(false);
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

  const loadData = async (userId) => {
    if (!userId) {
      setLoadError('Missing user id.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError('');
    
    try {
      let [profileRes, questsRes, userQuestsRes, xpLogsRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', userId).limit(1),
        supabase.from('quests').select('*'),
        supabase.from('user_quests').select('*').eq('user_id', userId),
        supabase
          .from('xp_logs')
          .select('id, created_at, date, xp_change, change_amount, source, reason, event_id, related_id')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(20),
      ]);

      if (profileRes.error) throw profileRes.error;
      if (questsRes.error) throw questsRes.error;
      if (userQuestsRes.error) throw userQuestsRes.error;
      if (xpLogsRes.error) throw xpLogsRes.error;

      const questSeeded = await ensureDailyQuests(userId, today, questsRes.data || [], userQuestsRes.data || []);
      if (questSeeded) {
        [questsRes, userQuestsRes] = await Promise.all([
          supabase.from('quests').select('*'),
          supabase.from('user_quests').select('*').eq('user_id', userId),
        ]);
        if (questsRes.error) throw questsRes.error;
        if (userQuestsRes.error) throw userQuestsRes.error;
      }

      const profiles = profileRes.data || [];
      const allQuests = questsRes.data || [];
      const userQuests = userQuestsRes.data || [];
      const xpLogs = xpLogsRes.data || [];
      
      if (!profiles || profiles.length === 0) {
        navigate(createPageUrl('Landing'));
        return;
      }

      setProfile(profiles[0]);
      setXpHistory(xpLogs || []);
      
      const merged = allQuests.map((q) => {
        const uq = userQuests.find((x) => x.quest_id === q.id);
        return {
          ...q,
          user_quest_id: uq?.id,
          ...resolveQuestStatus(uq),
        };
      });
      setQuests(merged);
    } catch (err) {
      setLoadError(err?.message || 'Failed to load quests.');
    } finally {
      setLoading(false);
    }
  };

  const level = useMemo(() => computeLevel(profile?.total_xp || 0), [profile?.total_xp]);

  const awardXP = async (currentProfile, xpGain, quest, eventId) => {
    const snapshot = await awardXpRpc({
      userId: currentProfile.id,
      xpAmount: xpGain,
      source: 'quest_complete',
      eventId,
      metadata: {
        quest_id: quest?.id || null,
        quest_type: quest?.type || null,
      },
    });
    const { nextProfile } = applyProgressionSnapshot(currentProfile, null, snapshot);
    const profileUpdates = /** @type {Record<string, any>} */ ({
      quests_completed: (currentProfile.quests_completed || 0) + 1,
    });
    if (quest?.stat_reward) {
      const sk = `stat_${quest.stat_reward}`;
      profileUpdates[sk] = (currentProfile[sk] || 0) + (quest.stat_reward_amount || 1);
    }
    const { error: profileUpdateError } = await supabase
      .from('profiles')
      .update(profileUpdates)
      .eq('id', currentProfile.id);
    if (profileUpdateError) throw profileUpdateError;

    const mergedProfile = { ...nextProfile, ...profileUpdates };
    setProfile(mergedProfile);
    setXpDelta((mergedProfile.total_xp || 0) - (currentProfile.total_xp || 0));
    return mergedProfile;
  };

  const handleComplete = async (quest) => {
    if (!user?.id || !profile || actionLoading) return;
    setActionLoading(true);
    try {
      const { data: pendingEvaluation, error: pendingEvalError } = await supabase
        .from('rank_evaluations')
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .limit(1)
        .maybeSingle();
      if (pendingEvalError) throw pendingEvalError;
      if (pendingEvaluation?.id) {
        alert('Rank Evaluation pending. Clear your evaluation before completing quests.');
        return;
      }

      if (quest?.status === 'completed' && quest?.completed_date === today) return;
      const { error: questError } = await supabase.from('user_quests').upsert({
        user_id: user.id,
        quest_id: quest.id,
        status: 'completed',
        completed_date: today,
      });
      if (questError) throw questError;

      setQuests((q) => q.map((x) => (
        x.id === quest.id
          ? {
            ...x,
            status: 'completed',
            completed_date: today,
            progress_current: x.progress_target || 100,
          }
          : x
      )));

      await awardXP(profile, quest.xp_reward, quest, `quest:${quest.id}:${today}`);
      await loadData(user.id);
    } catch (err) {
      alert(err?.message || 'Failed to complete quest.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleFail = async (quest) => {
    if (!user?.id || actionLoading) return;
    setActionLoading(true);
    try {
      const { error } = await supabase.from('user_quests').upsert({
        user_id: user.id,
        quest_id: quest.id,
        status: 'failed',
        completed_date: today,
      });
      if (error) throw error;
      setQuests((q) => q.map((x) => (x.id === quest.id ? { ...x, status: 'failed', completed_date: today } : x)));
    } catch (err) {
      alert(err?.message || 'Failed to fail quest.');
    } finally {
      setActionLoading(false);
    }
  };

  const addQuestFromPool = async (template) => {
    if (!user?.id || actionLoading) return;
    const already = quests.find((q) => q.title === template.title && q.status === 'active');
    if (already) return;

    setActionLoading(true);
    
    const getExpiresDate = (type) => {
      if (type === 'weekly') {
        const nextWeek = new Date();
        nextWeek.setDate(nextWeek.getDate() + 7);
        return nextWeek.toISOString().split('T')[0];
      }
      if (type === 'epic') {
        const nextMonth = new Date();
        nextMonth.setDate(nextMonth.getDate() + 30);
        return nextMonth.toISOString().split('T')[0];
      }
      return today;
    };

    try {
      if (template.type === 'weekly') {
        const existingWeekly = await fetchActiveWeeklyQuest(user.id);
        if (existingWeekly?.id) {
          alert('You already have an active weekly quest. Complete or fail it first.');
          return;
        }
      }

      const { data: insertedQuest, error: insertQuestError } = await supabase.from('quests').insert({
        ...template,
        progress_current: 0,
        progress_target: template.progress_target || 100,
        stat_reward_amount: template.stat_reward_amount || 1,
        min_level_required: template.min_level_required || 0,
        date: today,
        expires_date: getExpiresDate(template.type),
      }).select().single();
      if (insertQuestError) throw insertQuestError;
      if (!insertedQuest) return;

      const { error: linkError } = await supabase.from('user_quests').upsert({
        user_id: user.id,
        quest_id: insertedQuest.id,
        status: 'active',
        date: today,
      });
      if (linkError) throw linkError;

      const created = { ...insertedQuest, status: 'active', date: today };
      setQuests((q) => [created, ...q]);
    } catch (err) {
      alert(err?.message || 'Failed to add quest.');
    } finally {
      setActionLoading(false);
    }
  };

  const active = useMemo(() => quests.filter((q) => q.status === 'active'), [quests]);
  const completed = useMemo(() => quests.filter((q) => q.status === 'completed'), [quests]);
  const failed = useMemo(() => quests.filter((q) => q.status === 'failed'), [quests]);

  // Group active quests by type
  const dailyActive = useMemo(() => active.filter((q) => q.type === 'daily'), [active]);
  const weeklyActive = useMemo(() => active.filter((q) => q.type === 'weekly'), [active]);
  const specialActive = useMemo(() => active.filter((q) => q.type === 'special'), [active]);
  const epicActive = useMemo(() => active.filter((q) => q.type === 'epic'), [active]);

  const TABS = [
    { id: 'progress', label: 'PROGRESS', icon: Trophy },
    { id: 'available', label: 'AVAILABLE', icon: Plus },
    { id: 'history', label: 'HISTORY', icon: History },
  ];

  const normalizedXpHistory = useMemo(() => (
    (xpHistory || [])
      .map((log) => {
        const delta = Number(log?.change_amount ?? log?.xp_change ?? 0);
        const safeDelta = Number.isFinite(delta) ? Math.trunc(delta) : 0;
        const reasonKey = (log?.reason || log?.source || 'manual').toString();
        return {
          ...log,
          delta: safeDelta,
          reasonKey,
          timestamp: log?.created_at || log?.date || null,
        };
      })
      .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
  ), [xpHistory]);

  const filteredXpHistory = useMemo(() => {
    if (xpHistoryFilter === 'rewards') return normalizedXpHistory.filter((log) => log.delta > 0);
    if (xpHistoryFilter === 'penalties') return normalizedXpHistory.filter((log) => log.delta < 0);
    return normalizedXpHistory;
  }, [normalizedXpHistory, xpHistoryFilter]);

  const getReasonLabel = (source) => {
    const labels = {
      'habit_complete': 'Habit',
      'quest_complete': 'Quest',
      'daily_challenge': 'Daily',
      'dungeon_clear': 'Dungeon',
      'system_interrupt_clear': 'Interrupt Cleared',
      'system_interrupt_mild': 'Interrupt Mild Penalty',
      'system_interrupt_full': 'Interrupt Full Penalty',
      'rank_evaluation_clear': 'Rank Eval',
      'punishment_timeout': 'Penalty',
      'punishment_refused': 'Penalty',
      'dungeon_fail': 'Dungeon Fail',
      'rank_evaluation_fail': 'Rank Fail',
      'strike_sanction': 'Strike',
      'rank_evaluation_overdue': 'Overdue',
    };
    return labels[source] || source || 'Unknown';
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0f2027, #203a43, #2c5364)' }}>
      <div className="w-8 h-8 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
    </div>
  );

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'linear-gradient(135deg, #0f2027, #203a43, #2c5364)' }}>
        <div className="w-full max-w-md rounded-2xl p-5 space-y-3" style={{ background: 'rgba(15,32,39,0.7)', border: '1px solid #1e3a4a' }}>
          <p className="text-sm font-bold text-red-400 tracking-wide">QUESTS LOAD FAILED</p>
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
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #0f2027, #203a43, #2c5364)' }}>
      <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-5">

        {/* Header */}
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(createPageUrl('Dashboard'))}
            className="w-9 h-9 rounded-lg flex items-center justify-center transition-all hover:scale-110"
            style={{ background: 'rgba(15,32,39,0.8)', border: '1px solid #1e3a4a' }}>
            <ArrowLeft className="w-4 h-4 text-white" />
          </button>
          <div>
            <h1 className="text-lg font-black tracking-widest text-white">QUEST BOARD</h1>
            <p className="text-xs" style={{ color: '#64748B' }}>Lv. {level} · {profile?.name}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'rgba(15,32,39,0.7)', border: '1px solid #1e3a4a' }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex-1 py-2 rounded-lg text-xs font-bold tracking-widest transition-all flex items-center justify-center gap-1"
              style={{
                background: tab === t.id ? 'rgba(56,189,248,0.15)' : 'transparent',
                color: tab === t.id ? '#38BDF8' : '#64748B',
                border: tab === t.id ? '1px solid rgba(56,189,248,0.3)' : '1px solid transparent',
              }}
            >
              <t.icon className="w-3 h-3" />
              {t.label}
            </button>
          ))}
        </div>

        <div className="min-h-5 flex justify-center">
          <XPDeltaPulse value={xpDelta} visible={xpDelta !== 0} />
        </div>

        {/* Current Progress Tab */}
        {tab === 'progress' && (
          <div className="space-y-4">
            {active.length === 0 ? (
              <div className="text-center py-12 rounded-2xl" style={{ background: 'rgba(15,32,39,0.5)', border: '1px solid #1e3a4a' }}>
                <Zap className="w-8 h-8 mx-auto mb-3" style={{ color: '#1e3a4a' }} />
                <p style={{ color: '#64748B' }}>No active quests. Pick from the Available tab!</p>
              </div>
            ) : (
              <>
                {/* Daily Quests */}
                {dailyActive.length > 0 && (
                  <div>
                    <p className="text-xs font-bold tracking-widest mb-2" style={{ color: '#34D399' }}>DAILY QUESTS</p>
                    <div className="space-y-2">
                      {dailyActive.map((q, i) => (
                        <QuestCard key={q.id} quest={q} index={i} onComplete={handleComplete} onFail={handleFail} disabled={actionLoading} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Weekly Quests */}
                {weeklyActive.length > 0 && (
                  <div>
                    <p className="text-xs font-bold tracking-widest mb-2" style={{ color: '#38BDF8' }}>WEEKLY QUESTS</p>
                    <div className="space-y-2">
                      {weeklyActive.map((q, i) => (
                        <QuestCard key={q.id} quest={q} index={i} onComplete={handleComplete} onFail={handleFail} disabled={actionLoading} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Special Quests */}
                {specialActive.length > 0 && (
                  <div>
                    <p className="text-xs font-bold tracking-widest mb-2" style={{ color: '#FBBF24' }}>SPECIAL QUESTS</p>
                    <div className="space-y-2">
                      {specialActive.map((q, i) => (
                        <QuestCard key={q.id} quest={q} index={i} onComplete={handleComplete} onFail={handleFail} disabled={actionLoading} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Epic Quests */}
                {epicActive.length > 0 && (
                  <div>
                    <p className="text-xs font-bold tracking-widest mb-2" style={{ color: '#22D3EE' }}>EPIC QUESTS</p>
                    <div className="space-y-2">
                      {epicActive.map((q, i) => (
                        <QuestCard key={q.id} quest={q} index={i} onComplete={handleComplete} onFail={handleFail} disabled={actionLoading} />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Available Tab */}
        {tab === 'available' && (
          <div className="space-y-5">
            {[
              { label: 'WEEKLY QUESTS', icon: Star, color: '#38BDF8', pool: WEEKLY_QUESTS },
              { label: 'SPECIAL QUESTS', icon: Shield, color: '#FBBF24', pool: SPECIAL_QUESTS },
              { label: `EPIC QUESTS`, icon: Skull, color: '#22D3EE', pool: EPIC_QUESTS },
            ].map(({ label, icon: Icon, color, pool }) => (
              <div key={label}>
                <div className="flex items-center gap-2 mb-3">
                  <Icon className="w-4 h-4" style={{ color }} />
                  <span className="text-xs font-bold tracking-widest" style={{ color }}>{label}</span>
                </div>
                <div className="space-y-3">
                  {pool.map((template, i) => {
                    const locked = level < (template.min_level_required || 0);
                    const alreadyActive = quests.some(q => q.title === template.title && q.status === 'active');
                    const alreadyDone = quests.some(q => q.title === template.title && q.status === 'completed' && q.completed_date === today);
                    return (
                      <div
                        key={i}
                        className="rounded-xl p-4 flex items-center gap-4"
                        style={{
                          background: 'rgba(15,32,39,0.7)',
                          border: `1px solid ${color}22`,
                          opacity: locked ? 0.5 : 1,
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-white">{template.title}</p>
                          <p className="text-xs mt-0.5" style={{ color: '#64748B' }}>{template.description}</p>
                          <div className="flex items-center gap-3 mt-1.5">
                            <span className="text-xs font-bold" style={{ color: '#FBBF24' }}>+{template.xp_reward} XP</span>
                            {template.stat_reward && <span className="text-xs" style={{ color }}>{template.stat_reward.toUpperCase()} +1</span>}
                            {locked && <span className="text-xs" style={{ color: '#F87171' }}>Lv. {template.min_level_required} required</span>}
                          </div>
                        </div>
                        {!locked && !alreadyActive && !alreadyDone && (
                          <Button
                            size="sm"
                            onClick={() => addQuestFromPool(template)}
                            disabled={actionLoading}
                            className="text-xs h-8 px-3 font-bold tracking-wide"
                            style={{ background: `${color}22`, border: `1px solid ${color}44`, color }}
                          >
                            <Plus className="w-3 h-3 mr-1" /> {actionLoading ? '...' : 'Accept'}
                          </Button>
                        )}
                        {alreadyActive && <span className="text-xs font-bold" style={{ color: '#38BDF8' }}>ACTIVE</span>}
                        {alreadyDone && <span className="text-xs font-bold" style={{ color: '#34D399' }}>✓ DONE</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* History Tab */}
        {tab === 'history' && (
          <div className="space-y-4">
            {/* XP History Section */}
            <HoloPanel>
              <div className="flex items-center justify-between gap-2 mb-3">
                <p className="text-xs font-bold tracking-widest" style={{ color: '#38BDF8' }}>XP HISTORY</p>
                <div className="flex gap-1">
                  {[
                    { id: 'all', label: 'All' },
                    { id: 'rewards', label: 'Rewards' },
                    { id: 'penalties', label: 'Penalties' },
                  ].map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setXpHistoryFilter(f.id)}
                      className="px-2 py-1 rounded text-[10px] font-bold tracking-widest"
                      style={{
                        border: '1px solid rgba(56,189,248,0.25)',
                        background: xpHistoryFilter === f.id ? 'rgba(56,189,248,0.2)' : 'rgba(15,32,39,0.35)',
                        color: xpHistoryFilter === f.id ? '#7DD3FC' : '#64748B',
                      }}
                    >
                      {f.label.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              {filteredXpHistory.length === 0 ? (
                <p className="text-sm" style={{ color: '#64748B' }}>No XP history yet.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {filteredXpHistory.map((log, i) => (
                    <div key={log.id || i} className="flex items-center justify-between p-2 rounded-lg" 
                      style={{ background: 'rgba(15,32,39,0.5)', border: '1px solid rgba(56,189,248,0.1)' }}>
                      <div>
                        <p className="text-xs font-bold text-white">{getReasonLabel(log.reasonKey)}</p>
                        <p className="text-[10px]" style={{ color: '#64748B' }}>
                          {log.created_at ? new Date(log.created_at).toLocaleString() : (log.date || '')}
                        </p>
                      </div>
                      <span className={`text-sm font-bold ${log.delta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {log.delta >= 0 ? '+' : ''}{log.delta} XP
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </HoloPanel>

            {/* Quest History */}
            <div>
              <p className="text-xs font-bold tracking-widest mb-3" style={{ color: '#FBBF24' }}>QUEST HISTORY</p>
              {([...completed, ...failed]).length === 0 ? (
                <div className="text-center py-6 rounded-2xl" style={{ background: 'rgba(15,32,39,0.5)', border: '1px solid #1e3a4a' }}>
                  <p style={{ color: '#64748B' }}>No quest history yet.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {([...completed, ...failed]).map((q, i) => (
                    <QuestCard key={q.id} quest={q} index={i} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
