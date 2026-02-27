import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Plus, Zap, Star, Shield, Skull } from 'lucide-react';
import { format } from 'date-fns';
import QuestCard from '../components/QuestCard';
import { computeLevel, buildXPUpdatePayload } from '../components/gameEngine';
import { ensureDailyQuests } from '@/lib/questSystem';

const today = format(new Date(), 'yyyy-MM-dd');

const resolveDailyQuestStatus = (userQuest) => {
  if (!userQuest) return { status: 'active', completed_date: null };
  if (userQuest.status === 'completed') {
    return userQuest.completed_date === today
      ? { status: 'completed', completed_date: userQuest.completed_date }
      : { status: 'active', completed_date: null };
  }
  if (userQuest.status === 'failed') {
    return userQuest.completed_date === today
      ? { status: 'failed', completed_date: userQuest.completed_date }
      : { status: 'active', completed_date: null };
  }
  return { status: userQuest.status || 'active', completed_date: userQuest.completed_date || null };
};

const WEEKLY_QUESTS = [
  { title: 'Iron Will', description: 'Complete all habits for 7 consecutive days', xp_reward: 500, stat_reward: 'discipline', type: 'weekly' },
  { title: 'Strength Week', description: 'Complete workout habits 5 times this week', xp_reward: 400, stat_reward: 'strength', type: 'weekly' },
  { title: 'Scholar Path', description: 'Log 5 study sessions this week', xp_reward: 350, stat_reward: 'intelligence', type: 'weekly' },
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
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('active');

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
    
    let [profileRes, questsRes, userQuestsRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).limit(1),
      supabase.from('quests').select('*'),
      supabase.from('user_quests').select('*').eq('user_id', userId),
    ]);

    const questSeeded = await ensureDailyQuests(userId, today, questsRes.data || [], userQuestsRes.data || []);
    if (questSeeded) {
      [questsRes, userQuestsRes] = await Promise.all([
        supabase.from('quests').select('*'),
        supabase.from('user_quests').select('*').eq('user_id', userId),
      ]);
    }

    const profiles = profileRes.data || [];
    const allQuests = questsRes.data || [];
    const userQuests = userQuestsRes.data || [];
    if (!profiles || profiles.length === 0) { navigate(createPageUrl('Landing')); return; }
    setProfile(profiles[0]);
    const merged = allQuests.map((q) => {
      const uq = userQuests.find((x) => x.quest_id === q.id);
      return {
        ...q,
        user_quest_id: uq?.id,
        ...resolveDailyQuestStatus(uq),
      };
    });
    setQuests(merged);
    setLoading(false);
  };

  const level = computeLevel(profile?.total_xp || 0);

  const awardXP = async (currentProfile, xpGain, quest) => {
    const payload = buildXPUpdatePayload(currentProfile, xpGain);
    payload.quests_completed = (currentProfile.quests_completed || 0) + 1;
    if (quest?.stat_reward) {
      const sk = `stat_${quest.stat_reward}`;
      payload[sk] = (currentProfile[sk] || 0) + (quest.stat_reward_amount || 1);
    }
    await supabase.from('profiles').update(payload).eq('id', currentProfile.id);
    setProfile({ ...currentProfile, ...payload });
    return { ...currentProfile, ...payload };
  };

  const handleComplete = async (quest) => {
    if (quest?.status === 'completed' && quest?.completed_date === today) return;
    await supabase.from('user_quests').upsert({
      user_id: user.id,
      quest_id: quest.id,
      status: 'completed',
      completed_date: today,
    });
    setQuests(q => q.map(x => x.id === quest.id ? { ...x, status: 'completed', completed_date: today } : x));
    await awardXP(profile, quest.xp_reward, quest);
  };

  const handleFail = async (quest) => {
    await supabase.from('user_quests').upsert({
      user_id: user.id,
      quest_id: quest.id,
      status: 'failed',
      completed_date: today,
    });
    setQuests(q => q.map(x => x.id === quest.id ? { ...x, status: 'failed', completed_date: today } : x));
  };

  const addQuestFromPool = async (template) => {
    const already = quests.find(q => q.title === template.title && q.status === 'active');
    if (already) return;
    const { data: insertedQuest } = await supabase.from('quests').insert({
      ...template,
      stat_reward_amount: template.stat_reward_amount || 1,
      min_level_required: template.min_level_required || 0,
    }).select().single();

    if (!insertedQuest) return;
    await supabase.from('user_quests').upsert({
      user_id: user.id,
      quest_id: insertedQuest.id,
      status: 'active',
      date: today,
    });
    const created = { ...insertedQuest, status: 'active', date: today };
    setQuests(q => [created, ...q]);
  };

  const active = quests.filter(q => q.status === 'active');
  const completed = quests.filter(q => q.status === 'completed');
  const failed = quests.filter(q => q.status === 'failed');

  const TABS = [
    { id: 'active', label: 'ACTIVE', count: active.length },
    { id: 'available', label: 'AVAILABLE', count: null },
    { id: 'history', label: 'HISTORY', count: completed.length },
  ];

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0f2027, #203a43, #2c5364)' }}>
      <div className="w-8 h-8 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
    </div>
  );

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
              className="flex-1 py-2 rounded-lg text-xs font-bold tracking-widest transition-all"
              style={{
                background: tab === t.id ? 'rgba(56,189,248,0.15)' : 'transparent',
                color: tab === t.id ? '#38BDF8' : '#64748B',
                border: tab === t.id ? '1px solid rgba(56,189,248,0.3)' : '1px solid transparent',
              }}
            >
              {t.label}{t.count !== null ? ` (${t.count})` : ''}
            </button>
          ))}
        </div>

        {/* Active Tab */}
        {tab === 'active' && (
          <div className="space-y-3">
            {active.length === 0 ? (
              <div className="text-center py-12 rounded-2xl" style={{ background: 'rgba(15,32,39,0.5)', border: '1px solid #1e3a4a' }}>
                <Zap className="w-8 h-8 mx-auto mb-3" style={{ color: '#1e3a4a' }} />
                <p style={{ color: '#64748B' }}>No active quests. Pick from the Available tab!</p>
              </div>
            ) : active.map((q, i) => (
              <QuestCard key={q.id} quest={q} index={i} onComplete={handleComplete} onFail={handleFail} />
            ))}
          </div>
        )}

        {/* Available Tab */}
        {tab === 'available' && (
          <div className="space-y-5">
            {[
              { label: 'WEEKLY QUESTS', icon: Star, color: '#A78BFA', pool: WEEKLY_QUESTS },
              { label: 'SPECIAL QUESTS', icon: Shield, color: '#FBBF24', pool: SPECIAL_QUESTS },
              { label: `EPIC QUESTS`, icon: Skull, color: '#F472B6', pool: EPIC_QUESTS },
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
                            className="text-xs h-8 px-3 font-bold tracking-wide"
                            style={{ background: `${color}22`, border: `1px solid ${color}44`, color }}
                          >
                            <Plus className="w-3 h-3 mr-1" /> Accept
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
          <div className="space-y-3">
            {[...completed, ...failed].length === 0 ? (
              <div className="text-center py-12 rounded-2xl" style={{ background: 'rgba(15,32,39,0.5)', border: '1px solid #1e3a4a' }}>
                <p style={{ color: '#64748B' }}>No quest history yet.</p>
              </div>
            ) : [...completed, ...failed].map((q, i) => (
              <QuestCard key={q.id} quest={q} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
