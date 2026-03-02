import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';
import { ArrowLeft, Award, Flame, Trophy } from 'lucide-react';
import { fetchPublicProfileByUsername, fetchPublicProfileRank } from '@/lib/publicProfiles';
import { getRankTitle, levelProgressPct, xpBetweenLevels, xpIntoCurrentLevel } from '@/components/gameEngine';

const STAT_LABELS = [
  { key: 'strength', label: 'STR' },
  { key: 'discipline', label: 'DIS' },
  { key: 'knowledge', label: 'KNO' },
  { key: 'health', label: 'HP' },
  { key: 'social', label: 'SOC' },
  { key: 'career', label: 'CAR' },
  { key: 'consistency', label: 'CON' },
];

export default function PublicProfile() {
  const { username } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [rankPosition, setRankPosition] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const loadProfile = async () => {
      setLoading(true);
      setError('');
      setRankPosition(null);
      try {
        const row = await fetchPublicProfileByUsername(username || '');
        if (cancelled) return;
        setProfile(row || null);
        if (row?.username) {
          try {
            const rank = await fetchPublicProfileRank(row.username);
            if (!cancelled) setRankPosition(rank);
          } catch (_) {
            if (!cancelled) setRankPosition(null);
          }
        }
      } catch (err) {
        if (cancelled) return;
        setError(err?.message || 'Failed to load public profile.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, [username]);

  const totalXp = Number(profile?.total_xp || 0);
  const level = Number(profile?.level || 0);
  const rankTitle = useMemo(() => String(getRankTitle(level)), [level]);
  const xpInLevel = Math.max(0, Math.floor(xpIntoCurrentLevel(totalXp)));
  const xpNeeded = Math.max(1, Math.floor(xpBetweenLevels(level)));
  const xpPct = Math.max(0, Math.min(100, Math.round(levelProgressPct(totalXp))));
  const stats = (profile?.stat_distribution && typeof profile.stat_distribution === 'object')
    ? profile.stat_distribution
    : {};

  const radarData = useMemo(() => (
    STAT_LABELS.map(({ key, label }) => ({
      stat: label,
      value: Number(stats[key] ?? stats[key === 'knowledge' ? 'intelligence' : key] ?? 0),
    }))
  ), [stats]);

  const dungeonAchievements = (profile?.dungeon_achievements && typeof profile.dungeon_achievements === 'object')
    ? profile.dungeon_achievements
    : {};
  const completedRuns = Number(dungeonAchievements.completed || 0);
  const bestRunDays = Number(dungeonAchievements.best_completed_days || 0);
  const failedRuns = Number(dungeonAchievements.failed || 0);
  const streakDays = Number(profile?.streak_count || 0);
  const unlockedAchievements = useMemo(() => {
    const badges = [];
    if (completedRuns >= 1) badges.push('First Dungeon Clear');
    if (completedRuns >= 10) badges.push('Dungeon Veteran');
    if (bestRunDays >= 7) badges.push('Week Survivor');
    if (streakDays >= 7) badges.push('7-Day Streak');
    if (streakDays >= 30) badges.push('30-Day Discipline');
    if (level >= 100) badges.push('Rank Gate: Warrior');
    if (level >= 350) badges.push('Rank Gate: Champion');
    return badges;
  }, [bestRunDays, completedRuns, level, streakDays]);
  const displayName = (profile?.name || profile?.username || 'Unknown Hunter');

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0f2027, #203a43, #2c5364)' }}>
        <div className="w-8 h-8 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen p-6 flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0f2027, #203a43, #2c5364)' }}>
        <div className="w-full max-w-md rounded-2xl p-5 space-y-3" style={{ background: 'rgba(15,32,39,0.75)', border: '1px solid rgba(56,189,248,0.2)' }}>
          <p className="text-sm font-black tracking-widest text-red-400">PUBLIC PROFILE NOT FOUND</p>
          <p className="text-sm text-slate-300">{error || 'This profile is private or unavailable.'}</p>
          <Link to="/" className="inline-flex items-center gap-2 text-sm font-bold text-cyan-300">
            <ArrowLeft className="w-4 h-4" /> Back to app
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #0f2027, #203a43, #2c5364)' }}>
      <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined' && window.history.length > 1) {
                navigate(-1);
                return;
              }
              navigate('/');
            }}
            className="inline-flex items-center gap-2 text-cyan-300 text-sm font-bold"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <p className="text-xs tracking-widest font-black text-cyan-300">PUBLIC PROFILE</p>
        </div>

        <div className="rounded-2xl p-5 md:p-6 space-y-4" style={{ background: 'rgba(15,32,39,0.74)', border: '1px solid rgba(56,189,248,0.2)' }}>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full overflow-hidden border border-cyan-400/30 bg-slate-900/80">
              {profile.avatar_url ? (
                <img src={profile.avatar_url} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-cyan-300 font-black text-xl">
                  {(displayName || '?').slice(0, 1).toUpperCase()}
                </div>
              )}
            </div>
            <div>
              <p className="text-base md:text-lg font-bold text-cyan-100">{displayName}</p>
              <p className="text-lg md:text-xl font-black text-white">@{profile.username}</p>
              <p className="text-sm text-cyan-300">Level {level} · {totalXp.toLocaleString()} XP</p>
              <p className="text-xs font-black tracking-widest text-amber-300">RANK: {rankTitle.toUpperCase()}</p>
              <p className="text-xs font-black tracking-widest text-emerald-300">
                GLOBAL LEADERBOARD: {Number.isFinite(rankPosition) && rankPosition > 0 ? `#${rankPosition}` : 'N/A'}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <p className="text-slate-400 font-bold">XP PROGRESS</p>
              <p className="text-cyan-300 font-bold">{xpInLevel}/{xpNeeded}</p>
            </div>
            <div className="h-2 rounded-full overflow-hidden bg-slate-900/70">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${xpPct}%`, background: 'linear-gradient(90deg, #38BDF8, #22D3EE)' }}
              />
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-xl p-3" style={{ background: 'rgba(2,132,199,0.08)', border: '1px solid rgba(56,189,248,0.2)' }}>
              <p className="text-xs tracking-widest font-black text-cyan-300 mb-2">STAT RADAR</p>
              <div style={{ width: '100%', height: 240 }}>
                <ResponsiveContainer>
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="rgba(148,163,184,0.25)" />
                    <PolarAngleAxis dataKey="stat" tick={{ fill: '#94A3B8', fontSize: 11 }} />
                    <PolarRadiusAxis angle={30} domain={[0, 'auto']} tick={{ fill: '#475569', fontSize: 10 }} />
                    <Radar
                      name="Stats"
                      dataKey="value"
                      stroke="#38BDF8"
                      fill="#38BDF8"
                      fillOpacity={0.35}
                      strokeWidth={2}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-xl p-3" style={{ background: 'rgba(15,23,42,0.55)', border: '1px solid rgba(148,163,184,0.2)' }}>
                <p className="text-xs tracking-widest font-black text-cyan-300 flex items-center gap-2 mb-1">
                  <Award className="w-3.5 h-3.5" /> ACHIEVEMENTS
                </p>
                {unlockedAchievements.length === 0 ? (
                  <p className="text-sm text-slate-300">No unlocked achievements yet.</p>
                ) : (
                  <div className="space-y-1">
                    {unlockedAchievements.map((item) => (
                      <p key={item} className="text-sm text-cyan-100">• {item}</p>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl p-3" style={{ background: 'rgba(15,23,42,0.55)', border: '1px solid rgba(148,163,184,0.2)' }}>
                <p className="text-xs tracking-widest font-black text-amber-300 flex items-center gap-2 mb-1">
                  <Trophy className="w-3.5 h-3.5" /> DUNGEON ACHIEVEMENTS
                </p>
                <p className="text-sm text-white">Completed: {completedRuns}</p>
                <p className="text-sm text-white">Best Run: {bestRunDays} days</p>
                <p className="text-sm text-white">Failed: {failedRuns}</p>
              </div>

              <div className="rounded-xl p-3" style={{ background: 'rgba(15,23,42,0.55)', border: '1px solid rgba(148,163,184,0.2)' }}>
                <p className="text-xs tracking-widest font-black text-orange-300 flex items-center gap-2 mb-1">
                  <Flame className="w-3.5 h-3.5" /> STREAK
                </p>
                <p className="text-2xl font-black text-white">{Number(profile.streak_count || 0)} days</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

