import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { eachDayOfInterval, format, subDays } from 'date-fns';
import { ArrowLeft, BrainCircuit, RotateCw, TrendingDown, TrendingUp } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import HoloPanel from '@/components/HoloPanel';
import SystemBackground from '@/components/SystemBackground';
import { supabase } from '@/lib/supabase';
import { useAuthedPageUser } from '@/lib/useAuthedPageUser';
import {
  fetchLatestWeeklyPersonalInsight,
  fetchWeeklyPersonalInsightHistory,
  generateWeeklyPersonalInsight,
} from '@/lib/insights';
import { toastError, toastSuccess } from '@/lib/toast';

const toRate = (value) => {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0.0';
  return n.toFixed(1);
};

const rowDate = (row) => (
  row?.date
  || row?.logged_at
  || row?.completed_date
  || row?.completed_at
  || row?.created_at
  || ''
).toString().slice(0, 10);

const isMissedLikeStatus = (statusValue) => {
  const status = String(statusValue || '').trim().toLowerCase();
  return status === 'missed' || status === 'failed';
};

const buildWeeklySnapshot = ({ habits, logs, quests, weekStartKey, weekEndKey }) => {
  const weekDays = eachDayOfInterval({
    start: new Date(`${weekStartKey}T00:00:00`),
    end: new Date(`${weekEndKey}T00:00:00`),
  });
  const weekDateKeys = weekDays.map((day) => format(day, 'yyyy-MM-dd'));
  const weekDateSet = new Set(weekDateKeys);
  const weekLogs = (logs || []).filter((log) => weekDateSet.has(rowDate(log)));
  const weekQuests = (quests || []).filter((quest) => weekDateSet.has(rowDate(quest)));

  const dailyData = weekDateKeys.map((dateKey) => {
    const dayLogs = weekLogs.filter((log) => rowDate(log) === dateKey);
    const activeHabits = (habits || []).filter((habit) => {
      const createdDate = rowDate(habit);
      return !createdDate || createdDate <= dateKey;
    }).length;

    const completedHabitIds = new Set(
      dayLogs
        .filter((log) => String(log?.status || '').toLowerCase() === 'completed')
        .map((log) => log?.habit_id)
        .filter(Boolean),
    );
    const completed = completedHabitIds.size;
    const loggedMissed = dayLogs.filter((log) => isMissedLikeStatus(log?.status) || Boolean(log?.failed)).length;
    const inferredMissed = Math.max(activeHabits - completed, 0);
    const missed = Math.max(loggedMissed, inferredMissed);
    return { completed, missed };
  });

  const habitStats = (habits || []).map((habit) => {
    const createdDate = rowDate(habit);
    const activeDays = weekDateKeys.filter((dateKey) => !createdDate || createdDate <= dateKey).length;
    const habitLogs = weekLogs.filter((log) => log?.habit_id === habit?.id);
    const completedDays = new Set(
      habitLogs
        .filter((log) => String(log?.status || '').toLowerCase() === 'completed')
        .map((log) => rowDate(log))
        .filter(Boolean),
    );
    const loggedMissedDays = new Set(
      habitLogs
        .filter((log) => isMissedLikeStatus(log?.status) || Boolean(log?.failed))
        .map((log) => rowDate(log))
        .filter(Boolean),
    );
    const completed = completedDays.size;
    const inferredMissed = Math.max(activeDays - completed, 0);
    const missed = Math.max(loggedMissedDays.size, inferredMissed);
    const attempts = completed + missed;
    const rate = attempts > 0 ? Number(((completed / attempts) * 100).toFixed(1)) : 0;
    return {
      title: habit?.title || '',
      completed,
      missed,
      attempts,
      rate,
    };
  }).sort((a, b) => b.rate - a.rate || b.attempts - a.attempts || String(a.title).localeCompare(String(b.title)));

  const totalCompleted = dailyData.reduce((sum, row) => sum + Number(row.completed || 0), 0);
  const totalMissed = dailyData.reduce((sum, row) => sum + Number(row.missed || 0), 0);
  const habitAttempts = totalCompleted + totalMissed;
  const habitRate = habitAttempts > 0 ? Number(((totalCompleted / habitAttempts) * 100).toFixed(1)) : 0;

  const questCompleted = weekQuests.filter((quest) => String(quest?.status || '').toLowerCase() === 'completed').length;
  const questFailed = weekQuests.filter((quest) => String(quest?.status || '').toLowerCase() === 'failed').length;
  const questAttempts = questCompleted + questFailed;
  const questRate = questAttempts > 0 ? Number(((questCompleted / questAttempts) * 100).toFixed(1)) : 0;

  const bestHabit = habitStats[0] || null;
  const worstHabit = habitStats.length > 1 ? habitStats[habitStats.length - 1] : null;

  return {
    metrics: {
      habit_completed: totalCompleted,
      habit_missed: totalMissed,
      habit_attempts: habitAttempts,
      habit_rate: habitRate,
      quest_completed: questCompleted,
      quest_failed: questFailed,
      quest_attempts: questAttempts,
      quest_rate: questRate,
      best_habit: bestHabit?.title || null,
      best_habit_rate: bestHabit?.rate ?? 0,
      worst_habit: worstHabit?.title || null,
      worst_habit_rate: worstHabit?.rate ?? 0,
    },
    workedSummary: `Habit consistency ${toRate(habitRate)}% (${totalCompleted} completed / ${habitAttempts} attempts). Best habit: ${bestHabit?.title || 'n/a'} (${toRate(bestHabit?.rate || 0)}%). Quests cleared: ${questCompleted}.`,
    failedSummary: `Missed habits: ${totalMissed}. Failed quests: ${questFailed}. Weakest habit: ${worstHabit?.title || 'n/a'} (${toRate(worstHabit?.rate || 0)}%).`,
  };
};

export default function Insights() {
  const navigate = useNavigate();
  const { user, authReady } = useAuthedPageUser();
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState([]);
  const [liveSnapshot, setLiveSnapshot] = useState(null);

  const refreshLiveSnapshot = useCallback(async (userId, insightRow = null) => {
    if (!userId) return;

    const [habitsRes, logsRes, questsRes] = await Promise.all([
      supabase.from('habits').select('id, title, created_at').eq('user_id', userId),
      supabase.from('habit_logs').select('habit_id, status, failed, date, logged_at, created_at').eq('user_id', userId),
      supabase.from('user_quests').select('status, date, completed_date, created_at').eq('user_id', userId),
    ]);

    if (habitsRes.error) throw habitsRes.error;
    if (logsRes.error) throw logsRes.error;
    if (questsRes.error) throw questsRes.error;
    const habits = habitsRes.data || [];
    const logs = logsRes.data || [];
    const quests = questsRes.data || [];

    let weekStartKey = '';
    let weekEndKey = '';
    if (insightRow?.week_start && insightRow?.week_end) {
      weekStartKey = format(new Date(insightRow.week_start), 'yyyy-MM-dd');
      weekEndKey = format(new Date(insightRow.week_end), 'yyyy-MM-dd');
    } else {
      const today = new Date();
      const todayKey = format(today, 'yyyy-MM-dd');
      const rollingStartKey = format(subDays(today, 6), 'yyyy-MM-dd');
      const allDateKeys = [
        ...habits.map((row) => rowDate(row)),
        ...logs.map((row) => rowDate(row)),
        ...quests.map((row) => rowDate(row)),
      ].filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(key)).sort();
      const firstAvailableKey = allDateKeys[0] || todayKey;
      weekEndKey = todayKey;
      weekStartKey = firstAvailableKey > rollingStartKey ? firstAvailableKey : rollingStartKey;
    }

    const snapshot = buildWeeklySnapshot({
      habits,
      logs,
      quests,
      weekStartKey,
      weekEndKey,
    });
    setLiveSnapshot(snapshot);
  }, []);

  const loadData = useCallback(async (userId) => {
    if (!userId) return;
    setLoading(true);
    try {
      let latestInsight = null;
      try {
        latestInsight = await generateWeeklyPersonalInsight({ userId });
      } catch (_) {
        latestInsight = await fetchLatestWeeklyPersonalInsight(userId);
      }
      if (!latestInsight) latestInsight = await fetchLatestWeeklyPersonalInsight(userId);
      const rows = await fetchWeeklyPersonalInsightHistory(userId, 12);
      setLatest(latestInsight || null);
      setHistory(rows || []);
      await refreshLiveSnapshot(userId, latestInsight || null);
    } catch (err) {
      toastError(err?.message || 'Failed to load personal insights.');
      setLiveSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, [refreshLiveSnapshot]);

  useEffect(() => {
    if (!authReady || !user?.id) return;
    void loadData(user.id);
  }, [authReady, user?.id, loadData]);

  const metrics = useMemo(() => latest?.metrics || {}, [latest?.metrics]);
  const displayMetrics = useMemo(() => ({
    ...metrics,
    ...(liveSnapshot?.metrics || {}),
  }), [metrics, liveSnapshot?.metrics]);
  const displayWorkedSummary = liveSnapshot?.workedSummary || latest?.worked_summary || '';
  const displayFailedSummary = liveSnapshot?.failedSummary || latest?.failed_summary || '';
  const bestHabitLabel = useMemo(() => {
    const raw = String(displayMetrics.best_habit || '').trim();
    return raw || 'N/A';
  }, [displayMetrics.best_habit]);
  const worstHabitLabel = useMemo(() => {
    const worst = String(displayMetrics.worst_habit || '').trim();
    const best = String(displayMetrics.best_habit || '').trim();
    if (!worst) return 'N/A';
    if (best && worst.toLowerCase() === best.toLowerCase()) return 'N/A';
    return worst;
  }, [displayMetrics.best_habit, displayMetrics.worst_habit]);

  const generateCurrentWeek = async () => {
    if (!user?.id || generating) return;
    setGenerating(true);
    try {
      const row = await generateWeeklyPersonalInsight({ userId: user.id });
      setLatest(row || null);
      const rows = await fetchWeeklyPersonalInsightHistory(user.id, 12);
      setHistory(rows || []);
      await refreshLiveSnapshot(user.id, row || null);
      toastSuccess('Weekly insight generated.');
    } catch (err) {
      toastError(err?.message || 'Failed to generate weekly insight.');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <SystemBackground>
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
        </div>
      </SystemBackground>
    );
  }

  return (
    <SystemBackground>
      <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-4">
        <HoloPanel data-guide-id="insights-regenerate-section">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate(createPageUrl('Dashboard'))}
              className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(10,25,33,0.8)', border: '1px solid rgba(56,189,248,0.2)' }}
            >
              <ArrowLeft className="w-4 h-4 text-white" />
            </button>
            <div className="min-w-0">
              <p className="text-white font-black tracking-widest">PERSONAL INSIGHTS</p>
              <p className="text-xs text-slate-400">Weekly what worked / what failed + one adjustment</p>
            </div>
            <Button onClick={generateCurrentWeek} disabled={generating} className="ml-auto shrink-0">
              <RotateCw className={`w-4 h-4 mr-2 ${generating ? 'animate-spin' : ''}`} />
              {generating ? 'Generating...' : 'Regenerate'}
            </Button>
          </div>
        </HoloPanel>

        {latest ? (
          <>
            <HoloPanel glowColor="#38BDF8" active data-guide-id="insights-current-report">
              <p className="text-xs tracking-widest text-cyan-300 font-black mb-2 flex items-center gap-2">
                <BrainCircuit className="w-3.5 h-3.5" /> CURRENT 7-DAY REPORT
              </p>
              <p className="text-xs text-slate-400 mb-3">
                Window: {latest.week_start ? format(new Date(latest.week_start), 'MMM d, yyyy') : 'N/A'} - {latest.week_end ? format(new Date(latest.week_end), 'MMM d, yyyy') : 'N/A'}
              </p>
              <p className="text-[11px] text-slate-500 mb-3">
                Uses available days until 7 exist, then rolls as the last 7 days ending today.
              </p>
              <p className="text-[11px] text-slate-500 mb-3">
                Weekly metrics below are recalculated live from your logs using the same counting logic as Analytics.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-2">
                  <p className="text-[10px] text-emerald-300 tracking-widest">HABIT RATE</p>
                  <p className="text-lg font-black text-emerald-100">{toRate(displayMetrics.habit_rate)}%</p>
                </div>
                <div className="rounded-lg border border-cyan-500/30 bg-cyan-950/20 p-2">
                  <p className="text-[10px] text-cyan-300 tracking-widest">QUEST RATE</p>
                  <p className="text-lg font-black text-cyan-100">{toRate(displayMetrics.quest_rate)}%</p>
                </div>
                <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-2">
                  <p className="text-[10px] text-amber-300 tracking-widest">BEST HABIT</p>
                  <p className="text-sm font-bold text-amber-100 truncate">{bestHabitLabel}</p>
                </div>
                <div className="rounded-lg border border-rose-500/30 bg-rose-950/20 p-2">
                  <p className="text-[10px] text-rose-300 tracking-widest">WORST HABIT</p>
                  <p className="text-sm font-bold text-rose-100 truncate">{worstHabitLabel}</p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-3">
                  <p className="text-xs text-emerald-300 tracking-widest font-black mb-1 flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5" /> WHAT WORKED
                  </p>
                  <p className="text-sm text-emerald-100 whitespace-pre-wrap break-words">{displayWorkedSummary}</p>
                </div>

                <div className="rounded-lg border border-rose-500/30 bg-rose-950/20 p-3">
                  <p className="text-xs text-rose-300 tracking-widest font-black mb-1 flex items-center gap-1.5">
                    <TrendingDown className="w-3.5 h-3.5" /> WHAT FAILED
                  </p>
                  <p className="text-sm text-rose-100 whitespace-pre-wrap break-words">{displayFailedSummary}</p>
                </div>

                <div className="rounded-lg border border-cyan-500/35 bg-cyan-950/20 p-3">
                  <p className="text-xs text-cyan-300 tracking-widest font-black mb-1">RECOMMENDED ADJUSTMENT</p>
                  <p className="text-sm text-cyan-100 whitespace-pre-wrap break-words">{latest.recommendation}</p>
                </div>
              </div>
            </HoloPanel>

            <HoloPanel>
              <p className="text-xs text-cyan-300 font-black tracking-widest mb-3">INSIGHT HISTORY</p>
              {history.length === 0 ? (
                <p className="text-sm text-slate-500">No history yet.</p>
              ) : (
                <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                  {history.map((row) => {
                    const isCurrentWeekRow = (
                      Boolean(latest?.week_start)
                      && Boolean(latest?.week_end)
                      && String(row?.week_start || '') === String(latest?.week_start || '')
                      && String(row?.week_end || '') === String(latest?.week_end || '')
                    );
                    const habitRate = toRate(isCurrentWeekRow ? displayMetrics.habit_rate : row?.metrics?.habit_rate);
                    const questRate = toRate(isCurrentWeekRow ? displayMetrics.quest_rate : row?.metrics?.quest_rate);
                    return (
                      <div
                        key={row.id}
                        className="rounded-lg p-3 border"
                        style={{ borderColor: 'rgba(56,189,248,0.18)', background: 'rgba(15,23,42,0.45)' }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs text-slate-200 font-bold">
                            {row.week_start ? format(new Date(row.week_start), 'MMM d') : 'N/A'} - {row.week_end ? format(new Date(row.week_end), 'MMM d') : 'N/A'}
                          </p>
                          <p className="text-[11px] text-slate-400">H {habitRate}% · Q {questRate}%</p>
                        </div>
                        <p className="text-xs text-slate-300 mt-1 line-clamp-2">{row.recommendation}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </HoloPanel>
          </>
        ) : (
          <HoloPanel>
            <p className="text-sm text-slate-400">No insight generated yet.</p>
          </HoloPanel>
        )}
      </div>
    </SystemBackground>
  );
}
