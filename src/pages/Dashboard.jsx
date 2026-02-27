import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { createPageUrl } from '../utils';
import { supabase } from '@/lib/supabase';
import SystemBackground from '../components/SystemBackground';
import HoloPanel from '../components/HoloPanel';
import QuestCard from '../components/QuestCard';
import StatGrid from '../components/StatGrid';
import { Button } from '@/components/ui/button';
import { computeLevel, buildXPUpdatePayload, getRankTitle, punishmentRefusalPenalty } from '../components/gameEngine';
import { Circle, CheckCircle2, Shield, Zap } from 'lucide-react';
import RPGHumanoidAvatar from '../components/RPGHumanoidAvatar';
import RPGXPBar from '../components/RPGXPBar';
import VoiceGreeting from '../components/VoiceGreeting';
import PunishmentBanner from '../components/PunishmentBanner';
import PunishmentModal from '../components/PunishmentModal';
import SystemNotification, { useSystemNotifications } from '../components/SystemNotification';
import { getDailySystemInterrupt, getInterruptStorageKey } from '../components/systemInterrupts';
import { ensureDailyQuests } from '@/lib/questSystem';
import { pickDailyChallenge } from '@/components/systemFeatures';

const DAILY_PRINCIPLES = [
  'It does not matter how slowly you go as long as you do not stop.',
  'Discipline is choosing what you want most over what you want now.',
  'Small daily improvements are the key to staggering long-term results.',
  'Consistency beats intensity when intensity is not sustainable.',
  'Action creates clarity.',
  'You do not rise to goals. You fall to systems.',
];

const PUNISHMENT_TIME_LIMIT_HOURS = 8;
const SHADOW_DEBT_RECOVERY_RATE = 0.35;
const STRIKE_MISSED_THRESHOLD = 2;
const MAX_STRIKES_BEFORE_SANCTION = 3;
const SANCTION_XP_PENALTY = 180;
const SANCTION_CONSISTENCY_DROP = 2;
const RANK_EVAL_LEVELS = [10, 25, 50, 100];
const OVERDUE_EVAL_BASE_PENALTY = 90;

const buildPendingPunishments = (punishments, habitsData, logsData) => {
  const habitMap = new Map((habitsData || []).map((h) => [h.id, h]));
  const logMap = new Map((logsData || []).map((l) => [l.id, l]));
  return (punishments || [])
    .filter((p) => p.status === 'pending')
    .map((p) => {
      const habit = habitMap.get(p.habit_id);
      if (!habit) return null;
      const log = logMap.get(p.habit_log_id) || {
        id: p.habit_log_id || `missing-${p.id}`,
        habit_id: p.habit_id,
        status: 'missed',
        date: rowDateSafe(p),
      };
      return { punishment: p, habit, log };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.punishment.created_at).getTime() - new Date(b.punishment.created_at).getTime());
};

const rowDateSafe = (row) => (row?.date || row?.logged_at || row?.completed_at || row?.created_at || '').toString().slice(0, 10);
const resolveDailyQuestStatus = (userQuest, today) => {
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

const getGateRank = (level) => {
  if (level >= 120) return 'S-RANK GATE';
  if (level >= 80) return 'A-RANK GATE';
  if (level >= 45) return 'B-RANK GATE';
  if (level >= 20) return 'C-RANK GATE';
  if (level >= 8) return 'D-RANK GATE';
  return 'E-RANK GATE';
};

const computeAdaptiveReminderTime = (historyLogs, fallback = '21:00') => {
  const completed = (historyLogs || []).filter((l) => l.status === 'completed');
  if (!completed.length) return fallback;
  const totalMinutes = completed
    .map((l) => {
      const raw = l.completed_at || l.logged_at || l.created_at;
      const d = raw ? new Date(raw) : null;
      if (!d || Number.isNaN(d.getTime())) return null;
      return d.getHours() * 60 + d.getMinutes();
    })
    .filter((v) => v !== null);
  if (!totalMinutes.length) return fallback;
  const avg = Math.round(totalMinutes.reduce((s, v) => s + v, 0) / totalMinutes.length);
  const reminderMins = Math.max(18 * 60, Math.min(22 * 60 + 45, avg + 45));
  const h = Math.floor(reminderMins / 60);
  const m = reminderMins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [systemState, setSystemState] = useState(null);
  const [habits, setHabits] = useState([]);
  const [logs, setLogs] = useState([]);
  const [historyLogs, setHistoryLogs] = useState([]);
  const [quests, setQuests] = useState([]);
  const [dailyChallenge, setDailyChallenge] = useState(null);
  const [pendingPunishments, setPendingPunishments] = useState([]);
  const [rankEvaluation, setRankEvaluation] = useState(null);
  const [interruptStatus, setInterruptStatus] = useState(null);
  const [showWarningPopup, setShowWarningPopup] = useState(false);
  const [levelUpPulse, setLevelUpPulse] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [now, setNow] = useState(new Date());
  const { notifications, notify } = useSystemNotifications();
  const prevLevelRef = useRef(0);
  const levelPulseTimeoutRef = useRef(null);
  const overdueEvalLockRef = useRef(false);

  const today = format(new Date(), 'yyyy-MM-dd');
  const rowDate = (row) => (row?.date || row?.logged_at || row?.completed_at || row?.created_at || '').toString().slice(0, 10);
  const dayNumber = Math.floor(new Date(today).getTime() / 86400000);
  const dailyPrinciple = DAILY_PRINCIPLES[dayNumber % DAILY_PRINCIPLES.length];
  const level = useMemo(() => computeLevel(profile?.total_xp || 0), [profile?.total_xp]);
  const interruptEvent = useMemo(
    () => getDailySystemInterrupt({
      userId: user?.id,
      level,
      dateKey: today,
      hardcoreMode: !!systemState?.hardcore_mode,
    }),
    [user?.id, level, today, systemState?.hardcore_mode]
  );

  const ensureRankEvaluation = useCallback(async (userId, currentLevel) => {
    const requiredLevel = [...RANK_EVAL_LEVELS].reverse().find((lv) => currentLevel >= lv);
    if (!requiredLevel) {
      setRankEvaluation(null);
      return;
    }

    const { data: existing, error: evalError } = await supabase
      .from('rank_evaluations')
      .select('*')
      .eq('user_id', userId)
      .eq('required_level', requiredLevel)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (evalError) {
      setRankEvaluation(null);
      return;
    }

    if (existing) {
      setRankEvaluation(existing);
      return;
    }

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 1);
    const due = format(dueDate, 'yyyy-MM-dd');
    const { data: created, error: createError } = await supabase
      .from('rank_evaluations')
      .insert({
        user_id: userId,
        required_level: requiredLevel,
        title: `Rank Evaluation Lv.${requiredLevel}`,
        description: 'Prove consistency before claiming full rewards.',
        status: 'pending',
        due_date: due,
      })
      .select('*')
      .single();
    if (!createError && created) setRankEvaluation(created);
  }, []);

  const loadData = useCallback(async (userId) => {
    setLoadError('');
    setLoading(true);
    try {
      let [profileRes, statsRes, habitsRes, logsRes, questsRes, userQuestsRes, dailyRes, punishmentsRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', userId).limit(1),
        supabase.from('stats').select('*').eq('user_id', userId).limit(1),
        supabase.from('habits').select('*').eq('user_id', userId),
        supabase.from('habit_logs').select('*').eq('user_id', userId),
        supabase.from('quests').select('*'),
        supabase.from('user_quests').select('*').eq('user_id', userId),
        supabase.from('daily_challenges').select('*').eq('user_id', userId),
        supabase.from('punishments').select('*').eq('user_id', userId),
      ]);

      if (profileRes.error) throw profileRes.error;
      if (statsRes.error) throw statsRes.error;
      if (habitsRes.error) throw habitsRes.error;
      if (logsRes.error) throw logsRes.error;
      if (questsRes.error) throw questsRes.error;
      if (userQuestsRes.error) throw userQuestsRes.error;
      if (dailyRes.error) throw dailyRes.error;
      if (punishmentsRes.error) throw punishmentsRes.error;

      const p = profileRes.data?.[0];
      if (!p) {
        navigate(createPageUrl('Landing'), { replace: true });
        return;
      }

      const seededDailyQuests = await ensureDailyQuests(userId, today, questsRes.data || [], userQuestsRes.data || []);
      if (seededDailyQuests) {
        [questsRes, userQuestsRes] = await Promise.all([
          supabase.from('quests').select('*'),
          supabase.from('user_quests').select('*').eq('user_id', userId),
        ]);
      }

      setProfile(p);
      const baseSystemState = statsRes.data?.[0] || { voice_enabled: true };
      setSystemState({
        strict_strikes: 0,
        last_strike_date: null,
        shadow_debt_xp: 0,
        ...baseSystemState,
      });
      const habitsData = habitsRes.data || [];
      const logsData = logsRes.data || [];
      setHabits(habitsData);
      setHistoryLogs(logsData);
      const todayLogs = logsData.filter((l) => rowDate(l) === today);
      setLogs(todayLogs);

      const missedTodayCount = todayLogs.filter((l) => l.status === 'missed').length;
      if (
        baseSystemState?.id &&
        baseSystemState?.hardcore_mode &&
        missedTodayCount >= STRIKE_MISSED_THRESHOLD &&
        baseSystemState?.last_strike_date !== today
      ) {
        const nextStrikes = (baseSystemState?.strict_strikes || 0) + 1;
        const strikePayload = { strict_strikes: nextStrikes, last_strike_date: today };
        await supabase.from('stats').update(strikePayload).eq('id', baseSystemState.id).eq('user_id', userId);
        setSystemState((prev) => ({ ...prev, ...strikePayload }));
        notify('penalty', 'Strike recorded', `Missed ${missedTodayCount} habits today`);

        if (nextStrikes >= MAX_STRIKES_BEFORE_SANCTION) {
          const sanctionPayload = buildXPUpdatePayload(p, -SANCTION_XP_PENALTY);
          const nextConsistency = Math.max(0, (p.stat_consistency || 0) - SANCTION_CONSISTENCY_DROP);
          sanctionPayload.stat_consistency = nextConsistency;
          await supabase.from('profiles').update(sanctionPayload).eq('id', userId);
          await supabase.from('xp_logs').insert({ user_id: userId, xp_change: -SANCTION_XP_PENALTY, source: 'strike_sanction' });
          setProfile((prev) => ({ ...prev, ...sanctionPayload }));
          await supabase
            .from('stats')
            .update({
              strict_strikes: 0,
              shadow_debt_xp: (baseSystemState?.shadow_debt_xp || 0) + SANCTION_XP_PENALTY,
            })
            .eq('id', baseSystemState.id)
            .eq('user_id', userId);
          setSystemState((prev) => ({
            ...prev,
            strict_strikes: 0,
            shadow_debt_xp: (prev?.shadow_debt_xp || 0) + SANCTION_XP_PENALTY,
          }));
          notify('penalty', 'Sanction enforced', `-${SANCTION_XP_PENALTY} XP and Shadow Debt increased`);
        }
      }

      let punishmentsData = punishmentsRes.data || [];

      // Reconcile missed logs: each missed habit should accumulate a pending punishment entry.
      const punishmentLogIds = new Set(punishmentsData.map((p) => p.habit_log_id).filter(Boolean));
      const missingPunishments = logsData
        .filter((l) => l.status === 'missed')
        .filter((l) => !punishmentLogIds.has(l.id))
        .map((l) => {
          const habit = habitsData.find((h) => h.id === l.habit_id);
          if (!habit?.punishment_text) return null;
          return {
            user_id: userId,
            habit_id: habit.id,
            habit_log_id: l.id,
            status: 'pending',
            text: habit.punishment_text,
          };
        })
        .filter(Boolean);

      if (missingPunishments.length > 0) {
        const { data: insertedPunishments, error: missingPunishmentError } = await supabase
          .from('punishments')
          .insert(missingPunishments)
          .select('*');
        if (!missingPunishmentError && insertedPunishments?.length) {
          punishmentsData = [...punishmentsData, ...insertedPunishments];
        }
      }

      setPendingPunishments(buildPendingPunishments(punishmentsData, habitsData, logsData));

      const userQuestMap = new Map((userQuestsRes.data || []).map((q) => [q.quest_id, q]));
      const merged = (questsRes.data || []).map((q) => ({
        ...q,
        ...resolveDailyQuestStatus(userQuestMap.get(q.id), today),
      }));
      setQuests(merged);
      let challengeToday = (dailyRes.data || []).find((d) => rowDate(d) === today) || null;
      if (!challengeToday) {
        const ss = statsRes.data?.[0] || null;
        let history = [];
        try { history = JSON.parse(ss?.daily_challenge_history || '[]'); } catch (_) { history = []; }
        const chosen = pickDailyChallenge(computeLevel(p.total_xp || 0), history);
        if (chosen) {
          const { data: insertedChallenge } = await supabase
            .from('daily_challenges')
            .insert({
              user_id: userId,
              title: chosen.title,
              description: chosen.description,
              stat_reward: chosen.stat_reward,
              xp_reward: chosen.xp_reward,
              completed: false,
              date: today,
            })
            .select()
            .single();
          if (insertedChallenge) {
            challengeToday = insertedChallenge;
            const nextHistory = [...history, chosen._i].slice(-7);
            if (ss?.id) {
              await supabase.from('stats').update({
                daily_challenge_date: today,
                daily_challenge_index: chosen._i,
                daily_challenge_completed: false,
                daily_challenge_history: JSON.stringify(nextHistory),
              }).eq('id', ss.id).eq('user_id', userId);
            }
          }
        }
      }
      setDailyChallenge(challengeToday || null);
      await ensureRankEvaluation(userId, computeLevel(p.total_xp || 0));
    } catch (err) {
      setLoadError(err?.message || 'Failed to load dashboard data.');
    } finally {
      setLoading(false);
    }
  }, [ensureRankEvaluation, navigate, notify, today]);

  useEffect(() => {
    const init = async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        navigate(createPageUrl('Landing'));
        return;
      }
      setUser(authUser);
      await loadData(authUser.id);
    };
    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session?.user) {
        navigate(createPageUrl('Landing'));
        return;
      }
      setUser(session.user);
      await loadData(session.user.id);
    });
    return () => subscription.unsubscribe();
  }, [loadData, navigate]);

  useEffect(() => {
    const intervalId = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!profile) return;
    const prev = prevLevelRef.current;
    if (prev > 0 && level > prev) {
      clearTimeout(levelPulseTimeoutRef.current);
      setLevelUpPulse(true);
      levelPulseTimeoutRef.current = setTimeout(() => setLevelUpPulse(false), 1800);
      notify('levelup', `Level ${level} reached`, `+${(level - prev) * 5} stat points unlocked`);
      const prevRank = getRankTitle(prev);
      const nextRank = getRankTitle(level);
      if (nextRank !== prevRank) {
        notify('quest', `Rank advanced to ${nextRank}`, 'System classification updated');
      }
    }
    prevLevelRef.current = level;
  }, [level, notify, profile]);

  useEffect(() => () => clearTimeout(levelPulseTimeoutRef.current), []);

  useEffect(() => {
    if (!interruptEvent || !user?.id) return;
    const key = getInterruptStorageKey(user.id, interruptEvent.id);
    const saved = localStorage.getItem(key);
    setInterruptStatus(saved || 'pending');
    if (!saved) {
      notify('xp', 'System Warning triggered', interruptEvent.title);
      setShowWarningPopup(true);
    }
  }, [interruptEvent, notify, user?.id]);

  useEffect(() => {
    if (!user?.id || !profile || !rankEvaluation || rankEvaluation.status !== 'pending') return;
    if (!rankEvaluation?.due_date || rankEvaluation.due_date >= today) return;
    if (rankEvaluation?.last_penalty_date === today) return;
    if (overdueEvalLockRef.current) return;

    const applyOverdueEvaluationPenalty = async () => {
      overdueEvalLockRef.current = true;
      try {
        const overduePenalty = OVERDUE_EVAL_BASE_PENALTY + Math.floor((rankEvaluation.required_level || 0) * 1.5);
        await awardXp(-overduePenalty, 'rank_evaluation_overdue');
        await addShadowDebt(Math.ceil(overduePenalty * 0.5));

        const nextConsistency = Math.max(0, (profile?.stat_consistency || 0) - 1);
        await supabase.from('profiles').update({ stat_consistency: nextConsistency }).eq('id', user.id);
        setProfile((prev) => ({ ...prev, stat_consistency: nextConsistency }));

        if (systemState?.id) {
          const nextStrike = Math.min(MAX_STRIKES_BEFORE_SANCTION, (systemState?.strict_strikes || 0) + 1);
          const demotionPayload = { strict_strikes: nextStrike, equipped_title: null };
          await supabase.from('stats').update(demotionPayload).eq('id', systemState.id).eq('user_id', user.id);
          setSystemState((prev) => ({ ...prev, ...demotionPayload }));
        }

        await supabase
          .from('rank_evaluations')
          .update({ last_penalty_date: today })
          .eq('id', rankEvaluation.id)
          .eq('user_id', user.id);

        setRankEvaluation((prev) => (prev ? { ...prev, last_penalty_date: today } : prev));
        notify('penalty', 'Overdue Evaluation penalty', `-${overduePenalty} XP today. Clear evaluation to stop daily penalties.`);
      } finally {
        overdueEvalLockRef.current = false;
      }
    };

    void applyOverdueEvaluationPenalty();
  }, [profile, rankEvaluation, systemState, today, user?.id]);

  useEffect(() => {
    if (!user?.id || !profile || pendingPunishments.length === 0) return;

    const processExpiredPunishments = async () => {
      const nowMs = Date.now();
      const expiredItems = pendingPunishments.filter((item) => {
        const createdMs = new Date(item?.punishment?.created_at || 0).getTime();
        if (!createdMs) return false;
        return createdMs + (PUNISHMENT_TIME_LIMIT_HOURS * 60 * 60 * 1000) <= nowMs;
      });
      if (expiredItems.length === 0) return;

      const ids = expiredItems.map((item) => item.punishment.id).filter(Boolean);
      const totalPenalty = expiredItems.reduce(
        (sum, item) => sum + punishmentRefusalPenalty(profile, item?.habit?.punishment_xp_penalty_pct || 10),
        0
      );

      if (ids.length > 0) {
        await supabase
          .from('punishments')
          .update({ status: 'timed_out' })
          .in('id', ids)
          .eq('user_id', user.id);
      }

      if (totalPenalty > 0) {
        await awardXp(-totalPenalty, 'punishment_timeout');
        await addShadowDebt(Math.ceil(totalPenalty * 0.5));
      }

      if (systemState?.hardcore_mode) {
        const nextConsistency = Math.max(0, (profile?.stat_consistency || 0) - expiredItems.length);
        await supabase.from('profiles').update({ stat_consistency: nextConsistency }).eq('id', user.id);
        setProfile((prev) => ({ ...prev, stat_consistency: nextConsistency }));

        if (systemState?.id) {
          const nextIgnored = (systemState?.punishment_ignored_count || 0) + expiredItems.length;
          await supabase
            .from('stats')
            .update({ punishment_ignored_count: nextIgnored })
            .eq('id', systemState.id)
            .eq('user_id', user.id);
          setSystemState((prev) => ({ ...prev, punishment_ignored_count: nextIgnored }));
        }
      }

      setPendingPunishments((prev) => prev.filter((item) => !ids.includes(item.punishment.id)));
      notify('penalty', 'Punishment timer expired', `-${totalPenalty} XP deducted automatically`);
    };

    void processExpiredPunishments();
    const intervalId = setInterval(() => void processExpiredPunishments(), 30000);
    return () => clearInterval(intervalId);
  }, [pendingPunishments, profile, systemState, user?.id]);

  useEffect(() => {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    if (!habits.length) return;

    const completedHabitIds = new Set(logs.filter((l) => l.status === 'completed').map((l) => l.habit_id));
    const incompleteHabits = habits.filter((h) => !completedHabitIds.has(h.id));
    if (!incompleteHabits.length) return;

    const timers = [];
    const sendReminder = (tag) => {
      const storageKey = `Niത്യ_habit_reminder_${today}_${tag}`;
      if (localStorage.getItem(storageKey)) return;
      const habitPreview = incompleteHabits.slice(0, 3).map((h) => h.title).join(', ');
      new Notification('Niത്യ Habit Reminder', {
        body: `${incompleteHabits.length} habits pending before day ends: ${habitPreview}${incompleteHabits.length > 3 ? ', ...' : ''}`,
        tag: `habit-reminder-${tag}`,
        renotify: false,
      });
      localStorage.setItem(storageKey, '1');
    };

    const scheduleAt = (hours, minutes, tag) => {
      const target = new Date();
      target.setHours(hours, minutes, 0, 0);
      const ms = target.getTime() - Date.now();
      if (ms <= 0) return;
      timers.push(setTimeout(() => sendReminder(tag), ms));
    };

    const adaptiveTime = computeAdaptiveReminderTime(historyLogs, profile?.reminder_time || '21:00');
    const [h, m] = adaptiveTime.split(':').map(Number);
    scheduleAt(h, m, 'adaptive');
    scheduleAt(21, 30, 'day_end');

    return () => timers.forEach((t) => clearTimeout(t));
  }, [profile?.reminder_time, habits, historyLogs, logs, today]);

  const addShadowDebt = async (amount) => {
    if (!user?.id || !systemState?.id || amount <= 0) return;
    const nextDebt = (systemState?.shadow_debt_xp || 0) + amount;
    await supabase
      .from('stats')
      .update({ shadow_debt_xp: nextDebt })
      .eq('id', systemState.id)
      .eq('user_id', user.id);
    setSystemState((prev) => ({ ...prev, shadow_debt_xp: nextDebt }));
  };

  const awardXp = async (xp, source) => {
    if (!profile || !user) return;

    let nextXp = xp;
    const pendingRankEval = rankEvaluation?.status === 'pending';
    if (nextXp > 0 && pendingRankEval) {
      nextXp = Math.floor(nextXp * 0.5);
      notify('penalty', 'Rank Evaluation lock', 'Rewards reduced until evaluation is cleared');
    }

    let debtRepaid = 0;
    if (nextXp > 0 && (systemState?.shadow_debt_xp || 0) > 0 && systemState?.id) {
      debtRepaid = Math.min(systemState.shadow_debt_xp, Math.ceil(nextXp * SHADOW_DEBT_RECOVERY_RATE));
      nextXp = Math.max(0, nextXp - debtRepaid);
      const nextDebt = systemState.shadow_debt_xp - debtRepaid;
      await supabase
        .from('stats')
        .update({ shadow_debt_xp: nextDebt })
        .eq('id', systemState.id)
        .eq('user_id', user.id);
      setSystemState((prev) => ({ ...prev, shadow_debt_xp: nextDebt }));
      notify('xp', 'Shadow Debt repayment', `${debtRepaid} XP redirected to debt`);
    }

    const payload = buildXPUpdatePayload(profile, nextXp);
    await supabase.from('profiles').update(payload).eq('id', user.id);
    await supabase.from('xp_logs').insert({ user_id: user.id, xp_change: nextXp, source });
    setProfile((prev) => ({ ...prev, ...payload }));
  };

  const toggleHabit = async (habit) => {
    if (!user) return;
    const existing = logs.find((l) => l.habit_id === habit.id);
    if (existing?.status === 'completed') {
      notify('xp', 'Already completed for today', `${habit.title} can be completed only once per day.`);
      return;
    }
    if (existing) {
      await supabase.from('habit_logs').update({ status: 'completed' }).eq('id', existing.id).eq('user_id', user.id);
      setLogs((prev) => prev.map((l) => (l.id === existing.id ? { ...l, status: 'completed' } : l)));
      setHistoryLogs((prev) => prev.map((l) => (l.id === existing.id ? { ...l, status: 'completed' } : l)));
      await supabase
        .from('punishments')
        .update({ status: 'completed' })
        .eq('user_id', user.id)
        .eq('habit_log_id', existing.id)
        .eq('status', 'pending');
      setPendingPunishments((prev) => prev.filter((p) => p.punishment?.habit_log_id !== existing.id));
    } else {
      const { data } = await supabase.from('habit_logs').insert({ user_id: user.id, habit_id: habit.id, status: 'completed' }).select().single();
      if (data) {
        setLogs((prev) => [...prev, data]);
        setHistoryLogs((prev) => [...prev, data]);
      }
    }
    await awardXp(habit.xp_value || 0, 'habit_complete');
  };

  const handlePunishmentDone = async (_log, _habit, punishment) => {
    if (!user || !punishment?.id) return;
    await supabase.from('punishments').update({ status: 'completed' }).eq('id', punishment.id).eq('user_id', user.id);
    setPendingPunishments((prev) => prev.filter((p) => p.punishment?.id !== punishment.id));
  };

  const handlePunishmentSkip = async (_log, habit, punishment) => {
    if (!user || !punishment?.id) return;
    const penalty = punishmentRefusalPenalty(profile, habit?.punishment_xp_penalty_pct || 10);
    await awardXp(-penalty, 'punishment_refused');
    await addShadowDebt(Math.ceil(penalty * 0.5));

    if (systemState?.hardcore_mode) {
      const nextConsistency = Math.max(0, (profile?.stat_consistency || 0) - 1);
      await supabase.from('profiles').update({ stat_consistency: nextConsistency }).eq('id', user.id);
      setProfile((prev) => ({ ...prev, stat_consistency: nextConsistency }));

      if (systemState?.id) {
        const nextIgnored = (systemState?.punishment_ignored_count || 0) + 1;
        await supabase
          .from('stats')
          .update({ punishment_ignored_count: nextIgnored })
          .eq('id', systemState.id)
          .eq('user_id', user.id);
        setSystemState((prev) => ({ ...prev, punishment_ignored_count: nextIgnored }));
      }
    }

    await supabase.from('punishments').update({ status: 'refused' }).eq('id', punishment.id).eq('user_id', user.id);
    setPendingPunishments((prev) => prev.filter((p) => p.punishment?.id !== punishment.id));
  };

  const resolveInterrupt = async (result) => {
    if (!interruptEvent || !user?.id || interruptStatus !== 'pending') return;
    const key = getInterruptStorageKey(user.id, interruptEvent.id);
    if (result === 'accepted') {
      await awardXp(interruptEvent.rewardXp, 'system_interrupt_clear');
      const statField = `stat_${interruptEvent.statReward}`;
      const nextStatValue = (profile?.[statField] || 0) + 1;
      await supabase.from('profiles').update({ [statField]: nextStatValue }).eq('id', user.id);
      setProfile((prev) => ({ ...prev, [statField]: nextStatValue }));
      notify('quest', `${interruptEvent.title} cleared`, `+${interruptEvent.rewardXp} XP · ${interruptEvent.statReward.toUpperCase()} +1`);
    } else {
      await awardXp(-interruptEvent.penaltyXp, 'system_interrupt_ignored');
      await addShadowDebt(Math.ceil(interruptEvent.penaltyXp * 0.25));
      notify('penalty', `${interruptEvent.title} ignored`, `-${interruptEvent.penaltyXp} XP applied`);
    }
    localStorage.setItem(key, result);
    setInterruptStatus(result);
    setShowWarningPopup(false);
  };

  const handleQuestComplete = async (quest) => {
    if (!user) return;
    if (rankEvaluation?.status === 'pending') {
      notify('penalty', 'Rank Evaluation pending', 'Clear your evaluation before completing quests.');
      return;
    }
    if (quest?.status === 'completed' && quest?.completed_date === today) {
      notify('xp', 'Quest already claimed today', quest.title);
      return;
    }
    await supabase.from('user_quests').upsert({ user_id: user.id, quest_id: quest.id, status: 'completed', completed_date: today });
    setQuests((prev) => prev.map((q) => (q.id === quest.id ? { ...q, status: 'completed', completed_date: today } : q)));
    await awardXp(quest.xp_reward || 0, 'quest_complete');
  };

  const handleQuestFail = async (quest) => {
    if (!user) return;
    await supabase.from('user_quests').upsert({ user_id: user.id, quest_id: quest.id, status: 'failed', completed_date: today });
    setQuests((prev) => prev.map((q) => (q.id === quest.id ? { ...q, status: 'failed', completed_date: today } : q)));
  };

  const completeDailyChallenge = async () => {
    if (!dailyChallenge || !user) return;
    if (rankEvaluation?.status === 'pending') {
      notify('penalty', 'Rank Evaluation pending', 'Daily challenge rewards are locked.');
      return;
    }
    await supabase.from('daily_challenges').update({ completed: true }).eq('id', dailyChallenge.id).eq('user_id', user.id);
    await awardXp(dailyChallenge.xp_reward || 0, 'daily_challenge');
    setDailyChallenge(null);
  };

  const resolveRankEvaluation = async (status) => {
    if (!user?.id || !rankEvaluation?.id || rankEvaluation.status !== 'pending') return;
    const todayDate = format(new Date(), 'yyyy-MM-dd');
    await supabase
      .from('rank_evaluations')
      .update({ status, resolved_date: todayDate })
      .eq('id', rankEvaluation.id)
      .eq('user_id', user.id);

    if (status === 'cleared') {
      const bonusXp = 300 + (rankEvaluation.required_level || 0) * 4;
      await awardXp(bonusXp, 'rank_evaluation_clear');
      const nextStatPoints = (profile?.stat_points || 0) + 2;
      await supabase.from('profiles').update({ stat_points: nextStatPoints }).eq('id', user.id);
      setProfile((prev) => ({ ...prev, stat_points: nextStatPoints }));
      notify('quest', 'Rank Evaluation cleared', `+${bonusXp} XP and +2 stat points`);
    } else {
      const failPenalty = 120;
      await awardXp(-failPenalty, 'rank_evaluation_fail');
      await addShadowDebt(failPenalty);
      notify('penalty', 'Rank Evaluation failed', `-${failPenalty} XP and debt increased`);
    }

    setRankEvaluation((prev) => (prev ? { ...prev, status, resolved_date: todayDate } : prev));
  };

  if (loading) {
    return <SystemBackground><div className="min-h-screen flex items-center justify-center text-cyan-400">SYSTEM LOADING...</div></SystemBackground>;
  }

  if (loadError) {
    return (
      <SystemBackground>
        <div className="min-h-screen flex items-center justify-center p-6">
          <HoloPanel>
            <div className="space-y-3">
              <p className="text-red-400 font-bold">DASHBOARD LOAD FAILED</p>
              <p className="text-slate-300 text-sm">{loadError}</p>
              <div className="flex gap-2">
                <Button onClick={() => user?.id && loadData(user.id)}>Retry</Button>
                <Button variant="outline" onClick={() => navigate(createPageUrl('Landing'))}>Go to Landing</Button>
              </div>
            </div>
          </HoloPanel>
        </div>
      </SystemBackground>
    );
  }

  const activeQuests = quests.filter((q) => q.status === 'active');
  const streakDays = profile?.global_streak || 0;
  const shadowArmyCount = Math.max(0, Math.floor(streakDays / 7));
  const gateRank = getGateRank(level);
  const shadowDebt = systemState?.shadow_debt_xp || 0;
  const strikeCount = systemState?.strict_strikes || 0;
  const difficultyColor = (d) => ({ easy: '#34D399', medium: '#FBBF24', hard: '#F87171' }[d] || '#64748B');

  return (
    <SystemBackground>
      <SystemNotification notifications={notifications} />
      {showWarningPopup && interruptEvent && interruptStatus === 'pending' && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center p-4" style={{ background: 'rgba(10,0,0,0.8)', backdropFilter: 'blur(6px)' }}>
          <div className="w-full max-w-md rounded-2xl p-5 space-y-4 border border-red-500/40 bg-[#12080A] shadow-2xl">
            <p className="text-red-400 text-xs tracking-widest font-black">SYSTEM WARNING</p>
            <p className="text-white text-xl font-black">{interruptEvent.title}</p>
            <p className="text-slate-300 text-sm">{interruptEvent.description}</p>
            <div className="flex gap-2 text-xs font-bold">
              <span className="px-2 py-1 rounded border border-yellow-700 text-yellow-300">+{interruptEvent.rewardXp} XP</span>
              <span className="px-2 py-1 rounded border border-red-700 text-red-300">-{interruptEvent.penaltyXp} XP</span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowWarningPopup(false)}>LATER</Button>
              <Button onClick={() => resolveInterrupt('accepted')}>COMPLETE</Button>
              <Button variant="outline" onClick={() => resolveInterrupt('ignored')}>IGNORE</Button>
            </div>
          </div>
        </div>
      )}
      <PunishmentBanner count={pendingPunishments.length} onResolve={() => {}} />
      <PunishmentModal
        pendingPunishments={pendingPunishments}
        hardcoreMode={!!systemState?.hardcore_mode}
        onDone={handlePunishmentDone}
        onSkip={handlePunishmentSkip}
        timeLimitHours={PUNISHMENT_TIME_LIMIT_HOURS}
      />
      {profile && (
        <VoiceGreeting
          name={profile.name || ''}
          isFirstTime={(profile.total_xp || 0) === 0}
          voiceEnabled={systemState?.voice_enabled !== false}
        />
      )}
      <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-4">
        <HoloPanel>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-cyan-300 text-[10px] tracking-[0.2em] font-black">HUNTER PROFILE</p>
              <p className="text-white text-lg font-bold">{profile?.name || 'PLAYER'}</p>
              <p className="text-cyan-400 text-xs">
                {format(now, 'EEE, MMM d').toUpperCase()} · {format(now, 'hh:mm:ss a')}
              </p>
            </div>
            <Button onClick={() => navigate(createPageUrl('Profile'))}>PROFILE</Button>
          </div>
        </HoloPanel>

        <HoloPanel>
          <div className="flex gap-4 items-center">
            <RPGHumanoidAvatar level={level} levelUp={levelUpPulse} />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <p className="text-5xl font-black text-white leading-none">{level}</p>
                <p className="text-cyan-300 text-sm font-black">LV.</p>
              </div>
              <p className="text-cyan-400/80 text-xs tracking-widest mt-1">UNRANKED · TIER 0</p>
              <div className="mt-3">
                <RPGXPBar totalXp={profile?.total_xp || 0} levelUp={levelUpPulse} />
              </div>
              <div className="grid grid-cols-3 mt-3 gap-2 text-center">
                <div>
                  <p className="text-cyan-400 text-2xl font-black">{activeQuests.length}</p>
                  <p className="text-slate-500 text-[10px] tracking-widest">QUESTS</p>
                </div>
                <div>
                  <p className="text-orange-400 text-2xl font-black">{streakDays}D</p>
                  <p className="text-slate-500 text-[10px] tracking-widest">STREAK</p>
                </div>
                <div>
                  <p className="text-yellow-400 text-2xl font-black">{profile?.stat_points || 0}</p>
                  <p className="text-slate-500 text-[10px] tracking-widest">STAT PTS</p>
                </div>
              </div>
            </div>
          </div>
        </HoloPanel>

        <HoloPanel>
          <div className="flex items-center justify-between mb-2">
            <p className="text-cyan-400 text-xs uppercase tracking-widest font-bold flex items-center gap-2">
              <Shield className="w-3.5 h-3.5" /> CORE STAT PANEL
            </p>
            <span className="px-2 py-1 rounded border border-yellow-700 text-yellow-300 text-xs font-bold">{profile?.stat_points || 0} PTS</span>
          </div>
          <StatGrid
            profile={profile}
            level={level}
            statPoints={profile?.stat_points || 0}
            onAllocate={() => {}}
            expandable
          />
        </HoloPanel>

        <HoloPanel>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl p-3 border border-[#0284c755] bg-[#1a0f2b99]">
              <p className="text-[10px] tracking-widest font-black text-[#67e8f9]">SHADOW ARMY</p>
              <p className="text-2xl font-black text-white mt-1">{shadowArmyCount}</p>
              <p className="text-xs text-slate-400">Unlocked from streak milestones</p>
            </div>
            <div className="rounded-xl p-3 border border-[#0ea5e955] bg-[#08202e99]">
              <p className="text-[10px] tracking-widest font-black text-cyan-300">GATE RANK</p>
              <p className="text-lg font-black text-white mt-1">{gateRank}</p>
              <p className="text-xs text-slate-400">Current hunt classification</p>
            </div>
          </div>
        </HoloPanel>

        <HoloPanel glowColor="#F87171" active={shadowDebt > 0 || rankEvaluation?.status === 'pending'}>
          <p className="text-red-400 text-xs tracking-widest font-bold mb-2">STRICT SYSTEM</p>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl p-2 border border-red-500/30 bg-red-950/30">
              <p className="text-[10px] tracking-widest text-red-300 font-black">SHADOW DEBT</p>
              <p className="text-lg font-black text-white">{shadowDebt}</p>
            </div>
            <div className="rounded-xl p-2 border border-amber-500/30 bg-amber-950/25">
              <p className="text-[10px] tracking-widest text-amber-300 font-black">STRIKES</p>
              <p className="text-lg font-black text-white">{strikeCount}/{MAX_STRIKES_BEFORE_SANCTION}</p>
            </div>
            <div className="rounded-xl p-2 border border-cyan-500/30 bg-cyan-950/25">
              <p className="text-[10px] tracking-widest text-cyan-300 font-black">EVALUATION</p>
              <p className="text-sm font-black text-white">{rankEvaluation?.status ? rankEvaluation.status.toUpperCase() : 'NONE'}</p>
            </div>
          </div>
          {rankEvaluation?.status === 'pending' && (
            <div className="mt-3 rounded-xl p-3 border border-red-500/30 bg-red-950/20">
              <p className="text-white font-bold">{rankEvaluation.title || `Rank Evaluation Lv.${rankEvaluation.required_level}`}</p>
              <p className="text-xs text-slate-300">{rankEvaluation.description || 'Clear evaluation to unlock full rewards.'}</p>
              <p className="text-xs text-red-300 mt-1">Due: {rankEvaluation.due_date || 'N/A'} · Quests are locked until cleared.</p>
              {rankEvaluation?.due_date && rankEvaluation.due_date < today && (
                <p className="text-xs text-red-200 mt-1">
                  OVERDUE: Daily penalty active{rankEvaluation?.last_penalty_date ? ` · Last applied ${rankEvaluation.last_penalty_date}` : ''}.
                </p>
              )}
              <div className="flex gap-2 mt-3">
                <Button onClick={() => resolveRankEvaluation('cleared')}>CLEAR</Button>
                <Button variant="outline" onClick={() => resolveRankEvaluation('failed')}>FAIL</Button>
              </div>
            </div>
          )}
        </HoloPanel>

        {dailyChallenge && !dailyChallenge.completed && (
          <HoloPanel>
            <p className="text-cyan-400 text-xs tracking-widest font-bold mb-2 flex items-center gap-2">
              <Zap className="w-3.5 h-3.5" /> DAILY SYSTEM CHALLENGE
            </p>
            <p className="text-white font-semibold text-xl">{dailyChallenge.title}</p>
            <p className="text-slate-400 text-sm">{dailyChallenge.description}</p>
            <div className="flex gap-2 mt-3 items-center">
              <span className="px-2 py-1 rounded text-yellow-300 border border-yellow-700 text-xs font-bold">+{dailyChallenge.xp_reward || 168} XP</span>
              <span className="px-2 py-1 rounded text-cyan-300 border border-cyan-700 text-xs font-bold">{(dailyChallenge.stat_reward || 'social').toUpperCase()} +1</span>
              <Button className="ml-auto" onClick={completeDailyChallenge}>COMPLETE</Button>
            </div>
          </HoloPanel>
        )}

        <HoloPanel>
          <p className="text-blue-400 text-xs tracking-widest font-bold mb-2">DAILY PRINCIPLE</p>
          <p className="text-white italic text-center text-2xl font-semibold">"{dailyPrinciple}"</p>
        </HoloPanel>

        {interruptEvent && (
          <HoloPanel>
            <div className="flex items-center justify-between mb-2">
              <p className="text-red-400 text-xs tracking-widest font-bold">SYSTEM WARNING</p>
              <span className="text-[10px] font-black tracking-widest px-2 py-1 rounded border border-red-500/40 text-red-300">
                {interruptStatus === 'pending' ? 'ACTIVE' : interruptStatus.toUpperCase()}
              </span>
            </div>
            <p className="text-white font-semibold text-lg">{interruptEvent.title}</p>
            <p className="text-slate-400 text-sm">{interruptEvent.description}</p>
            <div className="flex gap-2 mt-3 items-center">
              <span className="px-2 py-1 rounded text-yellow-300 border border-yellow-700 text-xs font-bold">+{interruptEvent.rewardXp} XP</span>
              <span className="px-2 py-1 rounded text-cyan-300 border border-cyan-700 text-xs font-bold">
                {interruptEvent.statReward.toUpperCase()} +1
              </span>
              {interruptStatus === 'pending' ? (
                <>
                  <Button className="ml-auto" onClick={() => resolveInterrupt('accepted')}>COMPLETE</Button>
                  <Button variant="outline" onClick={() => resolveInterrupt('ignored')}>IGNORE</Button>
                </>
              ) : (
                <p className="ml-auto text-xs font-bold text-slate-400 tracking-widest">RESOLVED TODAY</p>
              )}
            </div>
          </HoloPanel>
        )}

        <HoloPanel>
          <p className="text-cyan-400 text-xs mb-2 tracking-widest font-bold">TODAY'S HABITS</p>
          <div className="space-y-2">
            {habits.map((habit) => {
              const done = logs.find((l) => l.habit_id === habit.id && l.status === 'completed');
              const color = difficultyColor(habit.difficulty);
              return (
                <div key={habit.id} className="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-700 bg-slate-900/40">
                  <button onClick={() => toggleHabit(habit)} className="text-slate-400">
                    {done ? <CheckCircle2 className="w-5 h-5 text-cyan-400" /> : <Circle className="w-5 h-5" />}
                  </button>
                  <div className="flex-1">
                    <p className="text-white font-semibold">{habit.title}</p>
                    <p className="text-yellow-300 text-sm font-bold">+{habit.xp_value || 0} XP</p>
                  </div>
                  <span className="px-2 py-1 rounded text-xs font-black" style={{ color, border: `1px solid ${color}66`, background: `${color}22` }}>
                    {(habit.difficulty || 'medium').toUpperCase()}
                  </span>
                </div>
              );
            })}
          </div>
        </HoloPanel>

        <div className="flex items-center justify-between">
          <p className="text-yellow-300 text-xs tracking-widest font-bold">ACTIVE QUESTS</p>
          <button onClick={() => navigate(createPageUrl('Quests'))} className="text-cyan-400 text-xs font-bold">VIEW ALL</button>
        </div>
        <div className="space-y-3">
          {activeQuests.slice(0, 2).map((quest, i) => (
            <QuestCard key={quest.id} quest={quest} index={i} onComplete={handleQuestComplete} onFail={handleQuestFail} />
          ))}
        </div>
      </div>
    </SystemBackground>
  );
}



