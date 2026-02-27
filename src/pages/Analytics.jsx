import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { createPageUrl } from '../utils';
import { useNavigate } from 'react-router-dom';

import { ArrowLeft, TrendingUp, Flame, Star, BarChart2, Calendar } from 'lucide-react';
import { format, subDays, eachDayOfInterval } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid } from 'recharts';

export default function Analytics() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [habits, setHabits] = useState([]);
  const [logs, setLogs] = useState([]);
  const [streaks, setStreaks] = useState([]);
  const [xpLogs, setXpLogs] = useState([]);
  const [profile, setProfile] = useState(null);
  const rowDate = (row) => (row?.date || row?.logged_at || row?.completed_at || row?.created_at || '').toString().slice(0, 10);

  useEffect(() => {
    const init = async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        navigate(createPageUrl('Landing'));
        return;
      }
      await loadData(authUser.id);
    };
    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session?.user) {
        navigate(createPageUrl('Landing'));
        return;
      }
      await loadData(session.user.id);
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadData = async (userId) => {
    if (!userId) return;
    
    const [profileRes, habitRes, logRes, xpRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).limit(1),
      supabase.from('habits').select('*').eq('user_id', userId),
      supabase.from('habit_logs').select('*').eq('user_id', userId),
      supabase.from('xp_logs').select('*').eq('user_id', userId),
    ]);

    const profileData = profileRes.data || [];
    const habitData = habitRes.data || [];
    const logData = logRes.data || [];
    const xpData = xpRes.data || [];
    if (!profileData || profileData.length === 0) { navigate(createPageUrl('Landing')); return; }
    setProfile(profileData[0]);
    setHabits(habitData || []);
    setLogs(logData || []);
    setStreaks([]);
    setXpLogs(xpData || []);
    setLoading(false);
  };

  const last14 = eachDayOfInterval({ start: subDays(new Date(), 13), end: new Date() });
  const dailyData = last14.map(day => {
    const dateStr = format(day, 'yyyy-MM-dd');
    const dayLogs = logs.filter(l => rowDate(l) === dateStr);
    const completed = dayLogs.filter(l => l.status === 'completed').length;
    const total = habits.length;
    return {
      date: format(day, 'MMd'),
      label: format(day, 'MMM d'),
      completed,
      total,
      rate: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  });

  const habitStats = habits.map(h => {
    const habitLogs = logs.filter(l => l.habit_id === h.id);
    const completed = habitLogs.filter(l => l.status === 'completed').length;
    const missed = habitLogs.filter(l => l.status === 'missed').length;
    const streak = streaks.find(s => s.habit_id === h.id);
    return {
      ...h,
      completed,
      missed,
      total: completed + missed,
      rate: (completed + missed) > 0 ? Math.round((completed / (completed + missed)) * 100) : 0,
      currentStreak: streak?.current_streak || 0,
      longestStreak: streak?.longest_streak || 0,
    };
  }).sort((a, b) => b.rate - a.rate);

  const totalCompleted = logs.filter(l => l.status === 'completed').length;
  const totalMissed = logs.filter(l => l.status === 'missed').length;
  const overallRate = (totalCompleted + totalMissed) > 0
    ? Math.round((totalCompleted / (totalCompleted + totalMissed)) * 100) : 0;

  const bestHabit = habitStats[0];
  const worstHabit = habitStats.length > 1 ? habitStats[habitStats.length - 1] : null;

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0f2027, #203a43, #2c5364)' }}>
      <div className="w-8 h-8 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: 'linear-gradient(135deg, #0f2027, #203a43, #2c5364)' }}>
      <div className="max-w-2xl mx-auto space-y-5">

        <div className="flex items-center gap-3">
          <button onClick={() => navigate(createPageUrl('Dashboard'))}
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ background: 'rgba(15,32,39,0.8)', border: '1px solid #1e3a4a' }}>
            <ArrowLeft className="w-4 h-4 text-white" />
          </button>
          <div>
            <h1 className="text-lg font-black tracking-widest text-white">ANALYTICS</h1>
            <p className="text-xs" style={{ color: '#64748B' }}>{profile?.name} · Personal data</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Overall', value: `${overallRate}%`, color: overallRate >= 70 ? '#34D399' : overallRate >= 40 ? '#FBBF24' : '#F87171' },
            { label: 'Completed', value: totalCompleted, color: '#34D399' },
            { label: 'Missed', value: totalMissed, color: '#F87171' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-xl p-3 text-center"
              style={{ background: 'rgba(15,32,39,0.7)', border: '1px solid rgba(56,189,248,0.15)' }}>
              <p className="text-xs tracking-widest mb-1" style={{ color: '#64748B' }}>{label.toUpperCase()}</p>
              <p className="text-2xl font-black" style={{ color }}>{value}</p>
            </div>
          ))}
        </div>

        <div className="rounded-2xl p-4" style={{ background: 'rgba(15,32,39,0.7)', border: '1px solid rgba(56,189,248,0.15)' }}>
          <p className="text-xs font-bold tracking-widest mb-3 flex items-center gap-2" style={{ color: '#38BDF8' }}>
            <BarChart2 className="w-4 h-4" /> 14-DAY COMPLETION RATE
          </p>
          <div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={dailyData} margin={{ top: 0, right: 0, left: -28, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e3a4a" />
                <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 10 }} />
                <YAxis tick={{ fill: '#475569', fontSize: 10 }} domain={[0, 100]} unit="%" />
                <Tooltip
                  contentStyle={{ background: '#0f2027', border: '1px solid #1e3a4a', borderRadius: 8 }}
                  labelStyle={{ color: '#94A3B8' }}
                  formatter={(val, name) => [`${val}%`, 'Completion']}
                  labelFormatter={(label, payload) => payload?.[0]?.payload?.label || label}
                />
                <Bar dataKey="rate" fill="url(#barGrad)" radius={[4, 4, 0, 0]} />
                <defs>
                  <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" />
                    <stop offset="100%" stopColor="#0ea5e9" />
                  </linearGradient>
                </defs>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl p-4" style={{ background: 'rgba(15,32,39,0.7)', border: '1px solid rgba(56,189,248,0.15)' }}>
          <p className="text-xs font-bold tracking-widest mb-3 flex items-center gap-2" style={{ color: '#38BDF8' }}>
            <TrendingUp className="w-4 h-4" /> XP EARNED (LAST 14 DAYS)
          </p>
          <div>
            <ResponsiveContainer width="100%" height={150}>
              <LineChart data={dailyData.map(d => {
                const dateStr = last14[dailyData.indexOf(d)] ? format(last14[dailyData.indexOf(d)], 'yyyy-MM-dd') : '';
                const xp = xpLogs
                  .filter((x) => rowDate(x) === dateStr)
                  .reduce((sum, x) => sum + (x.xp_change || x.amount || 0), 0);
                return { ...d, xp };
              })} margin={{ top: 0, right: 0, left: -28, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e3a4a" />
                <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 10 }} />
                <YAxis tick={{ fill: '#475569', fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ background: '#0f2027', border: '1px solid #1e3a4a', borderRadius: 8 }}
                  labelStyle={{ color: '#94A3B8' }}
                  formatter={(val) => [`${val} XP`, 'Earned']}
                  labelFormatter={(label, payload) => payload?.[0]?.payload?.label || label}
                />
                <Line type="monotone" dataKey="xp" stroke="#38BDF8" strokeWidth={2} dot={{ fill: '#38BDF8', r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {(bestHabit || worstHabit) && (
          <div className="grid grid-cols-2 gap-3">
            {bestHabit && (
              <div className="rounded-xl p-3" style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.25)' }}>
                <p className="text-xs mb-1 flex items-center gap-1" style={{ color: '#34D399' }}><Star className="w-3 h-3" /> BEST HABIT</p>
                <p className="text-sm font-bold text-white truncate">{bestHabit.title}</p>
                <p className="text-xs" style={{ color: '#34D399' }}>{bestHabit.rate}% success</p>
              </div>
            )}
            {worstHabit && (
              <div className="rounded-xl p-3" style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)' }}>
                <p className="text-xs mb-1 flex items-center gap-1" style={{ color: '#F87171' }}><Flame className="w-3 h-3" /> NEEDS WORK</p>
                <p className="text-sm font-bold text-white truncate">{worstHabit.title}</p>
                <p className="text-xs" style={{ color: '#F87171' }}>{worstHabit.rate}% success</p>
              </div>
            )}
          </div>
        )}

        <div className="rounded-2xl p-4" style={{ background: 'rgba(15,32,39,0.7)', border: '1px solid rgba(56,189,248,0.15)' }}>
          <p className="text-xs font-bold tracking-widest mb-4 flex items-center gap-2" style={{ color: '#FBBF24' }}>
            <Calendar className="w-4 h-4" /> PER-HABIT BREAKDOWN
          </p>
          <div className="space-y-4">
            {habitStats.length === 0 ? (
              <p className="text-sm text-center py-4" style={{ color: '#64748B' }}>No habit data yet.</p>
            ) : habitStats.map(h => {
              const rateColor = h.rate >= 70 ? '#34D399' : h.rate >= 40 ? '#FBBF24' : '#F87171';
              return (
                <div key={h.id}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm text-white truncate max-w-[60%]">{h.title}</p>
                    <div className="flex items-center gap-2">
                      {h.currentStreak > 0 && (
                        <span className="text-xs flex items-center gap-0.5" style={{ color: '#FB923C' }}>
                          <Flame className="w-3 h-3" />{h.currentStreak}d
                        </span>
                      )}
                      <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ background: `${rateColor}22`, color: rateColor }}>
                        {h.rate}%
                      </span>
                    </div>
                  </div>
                  <div className="w-full rounded-full h-1.5" style={{ background: 'rgba(15,32,39,0.9)' }}>
                    <div className="h-1.5 rounded-full transition-all duration-700"
                      style={{ width: `${h.rate}%`, background: rateColor, boxShadow: `0 0 6px ${rateColor}88` }} />
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: '#475569' }}>
                    {h.completed} done · {h.missed} missed · Best streak: {h.longestStreak}d
                  </p>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}

