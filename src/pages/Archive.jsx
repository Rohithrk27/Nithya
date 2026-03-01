import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { ArrowLeft, Trophy, Lock } from 'lucide-react';
import { motion } from 'framer-motion';
import { computeLevel } from '../components/gameEngine';
import { ACHIEVEMENT_DEFS, computeHiddenRank } from '../components/systemFeatures';
import SystemBackground from '../components/SystemBackground';
import HoloPanel from '../components/HoloPanel';
import { useAuthedPageUser } from '@/lib/useAuthedPageUser';
import { syncUserAchievements } from '@/lib/achievements';

const CATEGORY_COLORS = {
  streak: '#FB923C',
  quests: '#38BDF8',
  level:  '#38BDF8',
  stats:  '#34D399',
  dungeon:'#F87171',
};

export default function Archive() {
  const navigate = useNavigate();
  const { user, authReady } = useAuthedPageUser();
  const [profile, setProfile] = useState(null);
  const [systemState, setSystemState] = useState(null);
  const [achievements, setAchievements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [equipping, setEquipping] = useState(null);

  useEffect(() => {
    if (!authReady || !user?.id) return;
    void loadData(user.id);
  }, [authReady, user?.id]);

  const loadData = async (userId) => {
    if (!userId) return;
    
    const [profileRes, stateRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).limit(1),
      supabase.from('stats').select('*').eq('user_id', userId).limit(1),
    ]);

    const profiles = profileRes.data || [];
    const stateData = stateRes.data || [];
    if (!profiles || profiles.length === 0) { navigate(createPageUrl('Landing')); return; }

    const currentProfile = profiles[0];
    const synced = await syncUserAchievements({ userId, profile: currentProfile });
    setProfile(synced.achievementProfile || currentProfile);
    setAchievements(synced.achievements || []);
    setSystemState(stateData && stateData[0] ? stateData[0] : null);
    setLoading(false);
  };

  const level = computeLevel(profile?.total_xp || 0);
  const unlockedKeys = new Set(achievements.map(a => a.key));
  const equippedTitle = systemState?.equipped_title || null;
  const rankRevealed = level >= 100;
  const rank = profile ? computeHiddenRank(profile, level) : '???';

  const equipTitle = async (title) => {
    if (!profile) return;
    setEquipping(title);
    if (systemState?.id) {
      await supabase.from('stats').update({ equipped_title: title }).eq('id', systemState.id).eq('user_id', profile.id);
      setSystemState(s => ({ ...s, equipped_title: title }));
    } else {
      const { data: createdState } = await supabase
        .from('stats')
        .insert({ user_id: profile.id, equipped_title: title, voice_enabled: true })
        .select('*')
        .single();
      if (createdState) setSystemState(createdState);
    }
    setEquipping(null);
  };

  if (loading) return (
    <SystemBackground>
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
      </div>
    </SystemBackground>
  );

  return (
    <SystemBackground>
      <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-5">

        <div className="flex items-center gap-3 py-2">
          <button onClick={() => navigate(createPageUrl('Dashboard'))}
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ background: 'rgba(10,25,33,0.8)', border: '1px solid rgba(56,189,248,0.2)' }}>
            <ArrowLeft className="w-4 h-4 text-white" />
          </button>
          <div>
            <h1 className="text-lg font-black tracking-widest text-white" style={{ textShadow: '0 0 10px rgba(56,189,248,0.4)' }}>
              SHADOW ARCHIVE
            </h1>
            <p className="text-xs font-mono" style={{ color: '#38BDF866' }}>PERMANENT RECORD · LV. {level}</p>
          </div>
        </div>

        <HoloPanel glowColor="#38BDF8" active={rankRevealed}>
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="w-4 h-4" style={{ color: '#38BDF8' }} />
            <h2 className="text-xs font-black tracking-widest" style={{ color: '#38BDF8' }}>HIDDEN RANK</h2>
          </div>
          {rankRevealed ? (
            <div className="text-center py-4">
              <p className="text-4xl font-black text-white mb-1" style={{ textShadow: '0 0 30px rgba(56,189,248,0.6)' }}>{rank}</p>
              <p className="text-xs font-mono" style={{ color: '#38BDF888' }}>RANK EVALUATION COMPLETE</p>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-3xl font-black mb-1" style={{ color: '#1e3a4a' }}>█████████</p>
              <p className="text-xs" style={{ color: '#475569' }}>Rank revealed at Level 100, 300, 500, 800, 1000</p>
              <p className="text-xs mt-1" style={{ color: '#38BDF855' }}>Currently Lv. {level} · Next reveal: Lv. {[100,300,500,800,1000].find(l => l > level) || '?'}</p>
            </div>
          )}
        </HoloPanel>

        <HoloPanel glowColor="#FBBF24">
          <div className="flex items-center gap-2 mb-3">
            <span style={{ color: '#FBBF24', fontSize: 14 }}>⚜</span>
            <h2 className="text-xs font-black tracking-widest" style={{ color: '#FBBF24' }}>EQUIPPED TITLE</h2>
          </div>
          {equippedTitle ? (
            <div className="text-center py-2">
              <p className="text-xl font-black text-white" style={{ textShadow: '0 0 15px rgba(251,191,36,0.5)' }}>
                「{equippedTitle}」
              </p>
            </div>
          ) : (
            <p className="text-sm text-center py-2" style={{ color: '#475569' }}>No title equipped. Unlock achievements to equip titles.</p>
          )}
        </HoloPanel>

        <HoloPanel glowColor="#38BDF8">
          <div className="flex items-center gap-2 mb-4">
            <Trophy className="w-4 h-4" style={{ color: '#38BDF8' }} />
            <h2 className="text-xs font-black tracking-widest" style={{ color: '#38BDF8' }}>ACHIEVEMENT VAULT</h2>
            <span className="ml-auto text-xs font-mono" style={{ color: '#38BDF866' }}>
              {achievements.length}/{ACHIEVEMENT_DEFS.length}
            </span>
          </div>

          <div className="space-y-2">
            {ACHIEVEMENT_DEFS.map((def) => {
              const unlocked = unlockedKeys.has(def.key);
              const color = CATEGORY_COLORS[def.category] || '#64748B';
              const ach = achievements.find(a => a.key === def.key);
              const isEquipped = equippedTitle === def.title;

              return (
                <motion.div
                  key={def.key}
                  layout
                  className="flex items-center gap-3 p-3 rounded-xl transition-all"
                  style={{
                    background: unlocked ? `${color}0D` : 'rgba(10,25,33,0.4)',
                    border: `1px solid ${unlocked ? color + '33' : 'rgba(56,189,248,0.06)'}`,
                    opacity: unlocked ? 1 : 0.45,
                  }}
                >
                  <div className="text-2xl w-9 text-center flex-shrink-0">
                    {unlocked ? def.icon : <Lock className="w-4 h-4 mx-auto" style={{ color: '#334155' }} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black text-white">{unlocked ? def.title : '???'}</p>
                    <p className="text-xs" style={{ color: unlocked ? color + 'BB' : '#334155' }}>
                      {unlocked ? def.description : 'Locked'}
                    </p>
                    {unlocked && ach?.unlocked_date && (
                      <p className="text-xs mt-0.5" style={{ color: '#38BDF844' }}>Unlocked {ach.unlocked_date}</p>
                    )}
                  </div>
                  {unlocked && (
                    <button
                      onClick={() => equipTitle(def.title)}
                      disabled={equipping === def.title}
                      className="text-xs font-black px-3 py-1.5 rounded-lg transition-all hover:scale-105 flex-shrink-0"
                      style={{
                        background: isEquipped ? `${color}33` : 'rgba(10,25,33,0.6)',
                        border: `1px solid ${isEquipped ? color + '66' : 'rgba(56,189,248,0.15)'}`,
                        color: isEquipped ? color : '#475569',
                      }}
                    >
                      {isEquipped ? 'EQUIPPED' : 'EQUIP'}
                    </button>
                  )}
                </motion.div>
              );
            })}
          </div>
        </HoloPanel>
      </div>
    </SystemBackground>
  );
}


