import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, startOfWeek } from 'date-fns';
import { ArrowLeft, CalendarDays, Clock3, Crown, History, Plus, Sparkles, Trophy } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { createPageUrl } from '../utils';
import { Button } from '@/components/ui/button';
import QuestCard from '../components/QuestCard';
import HoloPanel from '../components/HoloPanel';
import XPDeltaPulse from '@/components/XPDeltaPulse';
import { computeLevel } from '../components/gameEngine';
import { activateUserQuest, resolveExpiredQuests } from '@/lib/gameState';
import { insertQuestCompat } from '@/lib/questSystem';
import { applyProgressionSnapshot, awardXpRpc } from '@/lib/progression';
import { useAuthedPageUser } from '@/lib/useAuthedPageUser';
import { toastError } from '@/lib/toast';
import { applyShadowArmyXpBonus, getStreakDays } from '@/lib/shadowArmy';
import { grantRelicBatchRpc } from '@/lib/relics';

const ACTIVE_QUEST_STATUSES = new Set([
  'active',
  'in_progress',
  'accepted',
  'inprogress',
  'in progress',
  'in-progress',
  'ongoing',
  'started',
  'start',
]);

const KNOWN_QUEST_TYPES = new Set(['daily', 'weekly', 'special', 'epic', 'penalty']);
const QUEST_SECTION_ORDER = ['daily', 'weekly', 'special', 'epic'];
const MIN_QUESTS_PER_SECTION = 3;

const FALLBACK_QUEST_TEMPLATES = [
  { type: 'daily', title: 'Hydration Protocol', description: 'Drink 8 glasses of water today.', xp_reward: 70, stat_reward: 'health', min_level_required: 0, progress_target: 1 },
  { type: 'daily', title: 'Deep Study Session', description: 'Focus on study or reading for 30 minutes.', xp_reward: 85, stat_reward: 'intelligence', min_level_required: 0, progress_target: 1 },
  { type: 'daily', title: 'Movement Discipline', description: 'Complete at least one workout today.', xp_reward: 90, stat_reward: 'strength', min_level_required: 0, progress_target: 1 },
  { type: 'daily', title: 'Career Sprint', description: 'Do one career-focused action today.', xp_reward: 80, stat_reward: 'career', min_level_required: 0, progress_target: 1 },
  { type: 'daily', title: 'Social Pulse', description: 'Initiate one meaningful conversation.', xp_reward: 75, stat_reward: 'social', min_level_required: 0, progress_target: 1 },
  { type: 'daily', title: 'Focus Sprint', description: 'Complete one uninterrupted 45-minute focus block.', xp_reward: 88, stat_reward: 'consistency', min_level_required: 0, progress_target: 1 },
  { type: 'daily', title: 'Reflection Journal', description: 'Write a 10-minute reflection before sleep.', xp_reward: 72, stat_reward: 'discipline', min_level_required: 0, progress_target: 1 },
  { type: 'daily', title: 'Inbox Zero Burst', description: 'Clear pending tasks/messages for 20 minutes.', xp_reward: 78, stat_reward: 'career', min_level_required: 0, progress_target: 1 },
  { type: 'daily', title: 'Mindful Walk', description: 'Take a 20-minute mindful walk without distractions.', xp_reward: 74, stat_reward: 'health', min_level_required: 0, progress_target: 1 },
  { type: 'daily', title: 'Skill Repetition', description: 'Practice one core skill for 30 focused minutes.', xp_reward: 86, stat_reward: 'intelligence', min_level_required: 0, progress_target: 1 },
  { type: 'daily', title: 'Early Start Protocol', description: 'Start your first key task within 30 minutes of wake-up.', xp_reward: 82, stat_reward: 'discipline', min_level_required: 0, progress_target: 1 },
  { type: 'daily', title: 'Zero Sugar Day', description: 'Avoid sugar-heavy foods for the full day.', xp_reward: 84, stat_reward: 'health', min_level_required: 0, progress_target: 1 },
  { type: 'weekly', title: 'Iron Will Week', description: 'Complete all habits for 5 days this week.', xp_reward: 420, stat_reward: 'discipline', min_level_required: 0, progress_target: 5 },
  { type: 'weekly', title: 'Scholar Momentum', description: 'Log 5 study blocks this week.', xp_reward: 390, stat_reward: 'intelligence', min_level_required: 0, progress_target: 5 },
  { type: 'weekly', title: 'Strength Rhythm', description: 'Finish 4 workouts this week.', xp_reward: 410, stat_reward: 'strength', min_level_required: 0, progress_target: 4 },
  { type: 'weekly', title: 'Social Circuit', description: 'Reach out to 5 people this week.', xp_reward: 360, stat_reward: 'social', min_level_required: 0, progress_target: 5 },
  { type: 'weekly', title: 'Career Pipeline', description: 'Complete 5 career-growth actions this week.', xp_reward: 430, stat_reward: 'career', min_level_required: 0, progress_target: 5 },
  { type: 'weekly', title: 'Consistency Grid', description: 'Close 6 days with zero missed priority habits.', xp_reward: 450, stat_reward: 'consistency', min_level_required: 0, progress_target: 6 },
  { type: 'weekly', title: 'Recovery Standard', description: 'Track sleep/recovery for 7 days this week.', xp_reward: 380, stat_reward: 'health', min_level_required: 0, progress_target: 7 },
  { type: 'weekly', title: 'Focus Marathon', description: 'Complete 6 deep work sessions this week.', xp_reward: 440, stat_reward: 'intelligence', min_level_required: 0, progress_target: 6 },
  { type: 'special', title: 'Special Quest Lv20', description: 'Maintain a 7-day consistency streak.', xp_reward: 650, stat_reward: 'consistency', min_level_required: 20, progress_target: 7 },
  { type: 'special', title: 'Special Quest Lv40', description: 'Complete 14 focused sessions in one cycle.', xp_reward: 820, stat_reward: 'discipline', min_level_required: 40, progress_target: 14 },
  { type: 'special', title: 'Special Quest Lv60', description: 'Complete 20 deep work blocks.', xp_reward: 980, stat_reward: 'career', min_level_required: 60, progress_target: 20 },
  { type: 'special', title: 'Special Quest Lv80', description: 'Track health goals for 21 days.', xp_reward: 1140, stat_reward: 'health', min_level_required: 80, progress_target: 21 },
  { type: 'special', title: 'Special Quest Lv100', description: 'Finish 30 study sessions at high focus.', xp_reward: 1300, stat_reward: 'intelligence', min_level_required: 100, progress_target: 30 },
  { type: 'special', title: 'Special Quest Lv120', description: 'Sustain 30 days of on-time task starts.', xp_reward: 1450, stat_reward: 'discipline', min_level_required: 120, progress_target: 30 },
  { type: 'special', title: 'Special Quest Lv140', description: 'Complete 35 strength/health checkpoints.', xp_reward: 1600, stat_reward: 'strength', min_level_required: 140, progress_target: 35 },
  { type: 'special', title: 'Special Quest Lv160', description: 'Close 40 days with full consistency score.', xp_reward: 1780, stat_reward: 'consistency', min_level_required: 160, progress_target: 40 },
  { type: 'special', title: 'Special Quest Lv180', description: 'Deliver 45 career-intelligence milestones.', xp_reward: 1960, stat_reward: 'career', min_level_required: 180, progress_target: 45 },
  { type: 'epic', title: 'Epic Quest Lv100', description: 'Sustain elite discipline for 30 days.', xp_reward: 5200, stat_reward: 'discipline', min_level_required: 100, progress_target: 30 },
  { type: 'epic', title: 'Epic Quest Lv200', description: 'Hit advanced multi-stat growth checkpoints.', xp_reward: 7900, stat_reward: 'consistency', min_level_required: 200, progress_target: 40 },
  { type: 'epic', title: 'Epic Quest Lv300', description: 'Complete a full-system mastery cycle.', xp_reward: 10800, stat_reward: 'career', min_level_required: 300, progress_target: 50 },
  { type: 'epic', title: 'Epic Quest Lv400', description: 'Maintain mastery discipline across 60 days.', xp_reward: 13200, stat_reward: 'discipline', min_level_required: 400, progress_target: 60 },
  { type: 'epic', title: 'Epic Quest Lv500', description: 'Clear a top-tier progression gauntlet.', xp_reward: 15800, stat_reward: 'consistency', min_level_required: 500, progress_target: 70 },
];

const TYPE_STYLE = {
  daily: { label: 'DAILY', color: '#34D399', icon: Clock3 },
  weekly: { label: 'WEEKLY', color: '#38BDF8', icon: CalendarDays },
  special: { label: 'SPECIAL', color: '#FBBF24', icon: Sparkles },
  epic: { label: 'EPIC', color: '#22D3EE', icon: Crown },
  penalty: { label: 'PENALTY', color: '#F87171', icon: Trophy },
};

const TABS = [
  { id: 'progress', label: 'PROGRESS', icon: Trophy },
  { id: 'available', label: 'AVAILABLE', icon: Plus },
  { id: 'history', label: 'HISTORY', icon: History },
];

const normalizeQuestType = (value) => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const normalizeQuestStatus = (value) => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const normalizeTemplateKey = (value) => String(value || '').trim().toLowerCase();

const isQuestInProgressStatus = (status) => ACTIVE_QUEST_STATUSES.has(normalizeQuestStatus(status));

const canonicalQuestStatus = (status) => {
  const normalized = normalizeQuestStatus(status);
  if (isQuestInProgressStatus(normalized)) return 'active';
  if (normalized === 'complete' || normalized === 'completed') return 'completed';
  if (normalized === 'fail' || normalized === 'failed') return 'failed';
  return normalized || 'inactive';
};

const toEpoch = (value) => {
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.getTime() : 0;
};

const questStatusPriority = (status) => {
  const key = canonicalQuestStatus(status);
  if (key === 'active') return 4;
  if (key === 'completed') return 3;
  if (key === 'failed') return 2;
  if (key) return 1;
  return 0;
};

const pickBestUserQuestRow = (current, next) => {
  if (!current) return next;
  const currentPriority = questStatusPriority(current.status);
  const nextPriority = questStatusPriority(next.status);
  if (nextPriority !== currentPriority) {
    return nextPriority > currentPriority ? next : current;
  }

  const currentTs = Math.max(toEpoch(current.updated_at), toEpoch(current.started_at), toEpoch(current.created_at), toEpoch(current.completed_at));
  const nextTs = Math.max(toEpoch(next.updated_at), toEpoch(next.started_at), toEpoch(next.created_at), toEpoch(next.completed_at));
  return nextTs >= currentTs ? next : current;
};

const buildUserQuestMap = (rows) => {
  const result = new Map();
  for (const row of rows || []) {
    if (!row?.quest_id) continue;
    const existing = result.get(row.quest_id) || null;
    result.set(row.quest_id, pickBestUserQuestRow(existing, row));
  }
  return result;
};

const mapToUserQuestRows = (rows) => Array.from(buildUserQuestMap(rows).values());

const resolveQuestType = (questRow, userQuestRow) => {
  const explicitType = normalizeQuestType(questRow?.type || userQuestRow?.quest_type || '');
  if (KNOWN_QUEST_TYPES.has(explicitType)) return explicitType;
  return 'daily';
};

const resolveQuestStatus = (userQuestRow) => {
  if (!userQuestRow) return { status: 'inactive', completed_date: null };
  const status = canonicalQuestStatus(userQuestRow.status);
  return { status, completed_date: userQuestRow.completed_date || null };
};

const stableHash = (seed) => {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0);
};

const pickDeterministicQuestBatch = (rows, seed, count = MIN_QUESTS_PER_SECTION) => {
  const pool = [...(rows || [])].filter(Boolean);
  if (!pool.length) return [];
  const picked = [];
  let salt = 0;
  while (pool.length > 0 && picked.length < count) {
    const index = stableHash(`${seed}:${salt}`) % pool.length;
    picked.push(pool[index]);
    pool.splice(index, 1);
    salt += 1;
  }
  return picked;
};

const normalizeRequiredLevel = (type, rawLevel) => {
  const normalizedType = normalizeQuestType(type);
  const safe = Math.max(0, Number(rawLevel || 0));
  if (normalizedType === 'special') {
    if (safe <= 0) return 20;
    return Math.ceil(safe / 20) * 20;
  }
  if (normalizedType === 'epic') {
    if (safe <= 0) return 100;
    return Math.ceil(safe / 100) * 100;
  }
  return safe;
};

const pickVisibleQuestSet = (templates, currentLevel, count = MIN_QUESTS_PER_SECTION) => {
  const list = [...(templates || [])];
  if (!list.length) return [];
  const unlocked = [];
  const locked = [];
  for (const template of list) {
    const type = normalizeQuestType(template?.type || 'daily');
    const requiredLevel = normalizeRequiredLevel(type, template?.min_level_required);
    const enriched = {
      ...template,
      type,
      min_level_required: requiredLevel,
    };
    if (currentLevel >= requiredLevel) {
      unlocked.push(enriched);
    } else {
      locked.push(enriched);
    }
  }
  return [...unlocked.slice(0, count), ...locked.slice(0, Math.max(0, count - unlocked.length))];
};

const getWeekKey = (date) => format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd');

const toDateOnly = (value) => {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return format(parsed, 'yyyy-MM-dd');
};

const isDateInCurrentWeek = (dateText, nowDate) => {
  const normalized = toDateOnly(dateText);
  if (!normalized) return false;
  const parsed = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return false;
  const weekStart = startOfWeek(nowDate, { weekStartsOn: 1 });
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  return parsed >= weekStart && parsed < weekEnd;
};

const toCountdown = (ms) => {
  const safeMs = Math.max(0, Number(ms || 0));
  const totalSeconds = Math.floor(safeMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${String(hours).padStart(2, '0')}h`;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const sortTemplates = (rows) => [...(rows || [])].sort((a, b) => String(a?.title || '').localeCompare(String(b?.title || '')));
const getQuestDisplayType = (type) => TYPE_STYLE[normalizeQuestType(type)] || TYPE_STYLE.daily;

const fetchXpLogsCompat = async (userId) => {
  const withDate = await supabase
    .from('xp_logs')
    .select('id, created_at, date, xp_change, change_amount, source, reason, event_id, related_id, metadata')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(80);
  if (!withDate.error) return withDate;

  const msg = String(withDate.error?.message || '').toLowerCase();
  if (!msg.includes('xp_logs.date') && !msg.includes('column "date"')) {
    return withDate;
  }

  const fallback = await supabase
    .from('xp_logs')
    .select('id, created_at, xp_change, change_amount, source, reason, event_id, related_id, metadata')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(80);

  if (fallback.error) return fallback;
  return {
    ...fallback,
    data: (fallback.data || []).map((row) => ({
      ...row,
      date: row?.created_at ? String(row.created_at).slice(0, 10) : null,
    })),
  };
};

const getReasonLabel = (source) => {
  const labels = {
    habit_complete: 'Habit',
    quest_complete: 'Quest',
    daily_challenge: 'Daily',
    dungeon_clear: 'Dungeon',
    dungeon_party_complete: 'Dungeon Party',
    quest_timeout: 'Quest Timeout',
    punishment_timeout: 'Punishment',
    strike_sanction: 'Strike',
    rank_evaluation_clear: 'Rank Eval',
    rank_evaluation_fail: 'Rank Eval',
    rank_evaluation_overdue: 'Rank Eval',
  };
  return labels[source] || source || 'Unknown';
};

const getTemplateKey = (template) => `${normalizeQuestType(template?.type || 'daily')}:${String(template?.id || normalizeTemplateKey(template?.title || ''))}`;

const toQuestTemplatePayload = (template) => ({
  title: template.title,
  description: template.description,
  type: normalizeQuestType(template.type || 'daily'),
  xp_reward: Number(template.xp_reward || 0),
  relic_reward: Math.max(0, Number(template.relic_reward || 0)),
  deadline_at: template.deadline_at || null,
  punishment_type: template.punishment_type || 'xp_deduction',
  punishment_value: Math.max(0, Number(template.punishment_value || 0)),
  stat_reward: template.stat_reward || null,
  stat_reward_amount: Number(template.stat_reward_amount || 1),
  min_level_required: Number(template.min_level_required || 0),
  progress_target: Number(template.progress_target || 100),
  progress_current: 0,
  status: 'active',
});

export default function Quests() {
  const navigate = useNavigate();
  const { user, authReady } = useAuthedPageUser();
  const [profile, setProfile] = useState(null);
  const [questTemplates, setQuestTemplates] = useState([]);
  const [userQuestRows, setUserQuestRows] = useState([]);
  const [xpHistory, setXpHistory] = useState([]);
  const [tab, setTab] = useState('available');
  const [xpHistoryFilter, setXpHistoryFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [acceptingQuestKey, setAcceptingQuestKey] = useState('');
  const [xpDelta, setXpDelta] = useState(0);
  const [nowMs, setNowMs] = useState(Date.now());
  const seenXpLogRef = useRef(new Set());
  const profileRef = useRef(null);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    const timerId = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timerId);
  }, []);

  useEffect(() => {
    if (!xpDelta) return undefined;
    const timeoutId = setTimeout(() => setXpDelta(0), 1200);
    return () => clearTimeout(timeoutId);
  }, [xpDelta]);

  const todayKey = useMemo(() => format(new Date(nowMs), 'yyyy-MM-dd'), [nowMs]);
  const weekKey = useMemo(() => getWeekKey(new Date(nowMs)), [nowMs]);
  const level = useMemo(() => computeLevel(profile?.total_xp || 0), [profile?.total_xp]);

  const ensureQuestPoolRows = useCallback(async (existingQuestRows) => {
    const existingKeys = new Set(
      (existingQuestRows || []).map((row) => `${normalizeQuestType(row?.type)}::${normalizeTemplateKey(row?.title)}`)
    );

    const missingTemplates = FALLBACK_QUEST_TEMPLATES.filter((template) => {
      const key = `${normalizeQuestType(template.type)}::${normalizeTemplateKey(template.title)}`;
      return !existingKeys.has(key);
    });

    if (!missingTemplates.length) return false;

    const inserts = await Promise.all(
      missingTemplates.map((template) => insertQuestCompat(toQuestTemplatePayload(template)))
    );
    return inserts.some((result) => !result?.error && result?.data);
  }, []);

  const loadData = useCallback(async (userId) => {
    if (!userId) return;
    setLoading(true);
    setLoadError('');

    try {
      await Promise.allSettled([
        resolveExpiredQuests({ userId, source: 'quest_timeout', decayFactor: 0.5 }),
        supabase.rpc('apply_overdue_punishments', { p_user_id: userId }),
        supabase.rpc('run_daily_reset', { p_user_id: userId }),
      ]);

      let [profileRes, questsRes, userQuestsRes, xpLogsRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', userId).limit(1),
        supabase.from('quests').select('*'),
        supabase.from('user_quests').select('*').eq('user_id', userId),
        fetchXpLogsCompat(userId),
      ]);

      if (profileRes.error) throw profileRes.error;
      if (questsRes.error) throw questsRes.error;
      if (userQuestsRes.error) throw userQuestsRes.error;
      if (xpLogsRes.error) throw xpLogsRes.error;

      const seeded = await ensureQuestPoolRows(questsRes.data || []);
      if (seeded) {
        questsRes = await supabase.from('quests').select('*');
        if (questsRes.error) throw questsRes.error;
      }

      const profileRow = profileRes.data?.[0] || null;
      if (!profileRow) {
        navigate(createPageUrl('Landing'), { replace: true });
        return;
      }

      setProfile(profileRow);
      setQuestTemplates((questsRes.data || []).filter((row) => canonicalQuestStatus(row?.status || 'active') !== 'archived'));
      setUserQuestRows(mapToUserQuestRows(userQuestsRes.data || []));
      setXpHistory(xpLogsRes.data || []);
    } catch (err) {
      setLoadError(err?.message || 'Failed to load quest board.');
    } finally {
      setLoading(false);
    }
  }, [ensureQuestPoolRows, navigate]);

  useEffect(() => {
    if (!authReady || !user?.id) return;
    void loadData(user.id);
  }, [authReady, loadData, user?.id]);

  useEffect(() => {
    if (!user?.id) return undefined;
    const channel = supabase
      .channel(`quests-xp-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'xp_logs', filter: `user_id=eq.${user.id}` },
        (payload) => {
          const row = payload?.new || {};
          if (!row?.id || seenXpLogRef.current.has(row.id)) return;
          seenXpLogRef.current.add(row.id);
          if (seenXpLogRef.current.size > 200) {
            seenXpLogRef.current = new Set(Array.from(seenXpLogRef.current).slice(-120));
          }
          setXpHistory((prev) => [row, ...prev].slice(0, 80));
          const delta = Number(row.change_amount ?? row.xp_change ?? 0);
          if (Number.isFinite(delta) && delta !== 0) setXpDelta(delta);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const userQuestMap = useMemo(() => buildUserQuestMap(userQuestRows), [userQuestRows]);

  const mergedQuests = useMemo(() => (
    (questTemplates || []).map((questRow) => {
      const uq = userQuestMap.get(questRow.id) || null;
      const resolved = resolveQuestStatus(uq);
      const type = resolveQuestType(questRow, uq);
      const effectiveDeadline = uq?.deadline_at || uq?.expires_at || questRow?.deadline_at || questRow?.expires_at || null;
      const deadlineMs = effectiveDeadline ? new Date(effectiveDeadline).getTime() : Number.NaN;
      const remainingMs = Number.isFinite(deadlineMs) ? Math.max(0, deadlineMs - nowMs) : 0;
      const timerUrgency = remainingMs <= (2 * 60 * 60 * 1000) ? 'high' : (remainingMs <= (8 * 60 * 60 * 1000) ? 'medium' : 'low');
      return {
        ...questRow,
        type,
        status: resolved.status,
        completed_date: resolved.completed_date,
        user_quest_id: uq?.id || null,
        quest_type: uq?.quest_type || type,
        started_at: uq?.started_at || null,
        deadline_at: effectiveDeadline,
        expires_at: effectiveDeadline,
        expires_date: effectiveDeadline ? String(effectiveDeadline).slice(0, 10) : (questRow?.expires_date || null),
        failed: Boolean(uq?.failed),
        penalty_applied: Boolean(uq?.penalty_applied),
        xp_reward: Number(uq?.xp_reward ?? questRow?.xp_reward ?? 0),
        relic_reward: Math.max(0, Number(uq?.relic_reward ?? questRow?.relic_reward ?? 0)),
        punishment_type: uq?.punishment_type || questRow?.punishment_type || 'xp_deduction',
        punishment_value: Math.max(0, Number(uq?.punishment_value ?? questRow?.punishment_value ?? 0)),
        progress_current: Number(uq?.progress_current ?? questRow?.progress_current ?? 0),
        progress_target: Number(uq?.progress_target ?? questRow?.progress_target ?? 100),
        remaining_ms: remainingMs,
        remaining_label: toCountdown(remainingMs),
        timer_urgency: timerUrgency,
      };
    })
  ), [nowMs, questTemplates, userQuestMap]);

  const activeQuests = useMemo(() => (
    mergedQuests
      .filter((quest) => isQuestInProgressStatus(quest.status))
      .sort((a, b) => toEpoch(b.started_at || b.created_at) - toEpoch(a.started_at || a.created_at))
  ), [mergedQuests]);

  const completedQuests = useMemo(() => mergedQuests.filter((quest) => quest.status === 'completed'), [mergedQuests]);
  const failedQuests = useMemo(() => mergedQuests.filter((quest) => quest.status === 'failed'), [mergedQuests]);

  const questHistory = useMemo(() => (
    [...completedQuests, ...failedQuests].sort((a, b) => {
      const aTs = Math.max(toEpoch(a.completed_date), toEpoch(a.updated_at), toEpoch(a.created_at));
      const bTs = Math.max(toEpoch(b.completed_date), toEpoch(b.updated_at), toEpoch(b.created_at));
      return bTs - aTs;
    })
  ), [completedQuests, failedQuests]);

  const questTemplatesByType = useMemo(() => {
    const grouped = {
      daily: [],
      weekly: [],
      special: [],
      epic: [],
    };
    for (const row of questTemplates || []) {
      const type = resolveQuestType(row, null);
      if (!grouped[type]) continue;
      grouped[type].push({
        ...row,
        type,
        min_level_required: normalizeRequiredLevel(type, row?.min_level_required),
      });
    }
    return {
      daily: sortTemplates(grouped.daily),
      weekly: sortTemplates(grouped.weekly),
      special: sortTemplates(grouped.special),
      epic: sortTemplates(grouped.epic),
    };
  }, [questTemplates]);

  const selectedDailyQuests = useMemo(
    () => pickDeterministicQuestBatch(questTemplatesByType.daily, `${user?.id || 'anon'}:${todayKey}:daily`, MIN_QUESTS_PER_SECTION),
    [questTemplatesByType.daily, user?.id, todayKey]
  );
  const selectedWeeklyQuests = useMemo(
    () => pickDeterministicQuestBatch(questTemplatesByType.weekly, `${user?.id || 'anon'}:${weekKey}:weekly`, MIN_QUESTS_PER_SECTION),
    [questTemplatesByType.weekly, user?.id, weekKey]
  );

  const visibleSpecialQuests = useMemo(
    () => pickVisibleQuestSet(questTemplatesByType.special, level, MIN_QUESTS_PER_SECTION),
    [level, questTemplatesByType.special]
  );
  const visibleEpicQuests = useMemo(
    () => pickVisibleQuestSet(questTemplatesByType.epic, level, MIN_QUESTS_PER_SECTION),
    [level, questTemplatesByType.epic]
  );

  const availableSections = useMemo(() => ([
    {
      id: 'daily',
      label: 'DAILY QUEST',
      quests: selectedDailyQuests,
      lockedQuest: null,
      emptyText: 'No daily quest template available.',
    },
    {
      id: 'weekly',
      label: 'WEEKLY QUEST',
      quests: selectedWeeklyQuests,
      lockedQuest: null,
      emptyText: 'No weekly quest template available.',
    },
    {
      id: 'special',
      label: 'SPECIAL QUESTS',
      quests: visibleSpecialQuests,
      lockedQuest: null,
      emptyText: 'Reach the next level gate to unlock a special quest.',
    },
    {
      id: 'epic',
      label: 'EPIC QUESTS',
      quests: visibleEpicQuests,
      lockedQuest: null,
      emptyText: 'Reach the next epic gate to unlock an epic quest.',
    },
  ]), [selectedDailyQuests, selectedWeeklyQuests, visibleEpicQuests, visibleSpecialQuests]);

  const notifyQuestChange = useCallback((userId) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('nithya:quests-updated', {
      detail: { userId, at: new Date().toISOString() },
    }));
  }, []);

  const mergeOptimisticUserQuestRow = useCallback((newRow) => {
    setUserQuestRows((prev) => mapToUserQuestRows([...(prev || []), newRow]));
  }, []);

  const applyQuestRewards = useCallback(async (quest) => {
    const currentProfile = profileRef.current;
    if (!currentProfile?.id) return;
    const xpGain = Number(quest?.xp_reward || 0);
    if (!Number.isFinite(xpGain) || xpGain <= 0) return;
    const boosted = applyShadowArmyXpBonus(xpGain, getStreakDays(currentProfile));
    const metadata = {
      quest_id: quest.id,
      quest_type: normalizeQuestType(quest.type || 'daily'),
    };
    if (boosted.bonusXp > 0) {
      metadata.shadow_army_bonus_xp = boosted.bonusXp;
      metadata.shadow_army_bonus_pct = boosted.bonusPct;
      metadata.shadow_army_count = boosted.shadowArmyCount;
    }

    const snapshot = await awardXpRpc({
      userId: currentProfile.id,
      xpAmount: boosted.totalXp,
      source: 'quest_complete',
      eventId: `quest:${quest.id}:${todayKey}`,
      metadata,
    });

    const { nextProfile } = applyProgressionSnapshot(currentProfile, null, snapshot);
    const profileUpdates = { quests_completed: (currentProfile.quests_completed || 0) + 1 };
    if (quest?.stat_reward) {
      const statKey = `stat_${quest.stat_reward}`;
      profileUpdates[statKey] = (currentProfile[statKey] || 0) + Number(quest?.stat_reward_amount || 1);
    }

    const { error: profileUpdateError } = await supabase
      .from('profiles')
      .update(profileUpdates)
      .eq('id', currentProfile.id);
    if (profileUpdateError) throw profileUpdateError;

    const mergedProfile = { ...nextProfile, ...profileUpdates };
    profileRef.current = mergedProfile;
    setProfile(mergedProfile);
    setXpDelta((mergedProfile.total_xp || 0) - (currentProfile.total_xp || 0));

    const relicReward = Math.max(0, Number(quest?.relic_reward || 0));
    if (relicReward > 0) {
      try {
        await grantRelicBatchRpc({
          userId: currentProfile.id,
          count: relicReward,
          source: 'quest_complete',
          eventId: `quest_relic:${quest.id}:${todayKey}`,
          rarity: 'rare',
          metadata: { quest_id: quest.id, quest_type: normalizeQuestType(quest.type || 'daily') },
        });
      } catch (_) {
        // Relic reward is best-effort; XP reward remains authoritative.
      }
    }
  }, [todayKey]);
  const updateUserQuestOutcome = useCallback(async ({ questId, status, completedDate }) => {
    if (!user?.id || !questId) return null;
    const updatePayload = {
      status,
      completed_date: completedDate,
      failed: status === 'failed',
      penalty_applied: false,
      failure_reason: status === 'failed' ? 'manual' : null,
    };

    const { data: updatedRows, error: updateError } = await supabase
      .from('user_quests')
      .update(updatePayload)
      .eq('user_id', user.id)
      .eq('quest_id', questId)
      .select('*');
    if (updateError) throw updateError;
    if (updatedRows?.length) return updatedRows[0];

    const { data: insertedRow, error: insertError } = await supabase
      .from('user_quests')
      .insert({
        user_id: user.id,
        quest_id: questId,
        ...updatePayload,
      })
      .select('*')
      .single();
    if (insertError) throw insertError;
    return insertedRow || null;
  }, [user?.id]);

  const handleAcceptQuest = useCallback(async (template) => {
    if (!user?.id || !template || acceptingQuestKey) return;
    const templateKey = getTemplateKey(template);
    const questType = normalizeQuestType(template?.type || 'daily');
    const startedAt = new Date().toISOString();

    setAcceptingQuestKey(templateKey);

    try {
      let questId = template.id;
      if (!questId) {
        const { data: ensuredQuest, error: ensureError } = await insertQuestCompat(toQuestTemplatePayload(template));
        if (ensureError) throw ensureError;
        questId = ensuredQuest?.id || null;
      }
      if (!questId) throw new Error('Quest template missing id');

      mergeOptimisticUserQuestRow({
        id: `optimistic-${questId}-${Date.now()}`,
        user_id: user.id,
        quest_id: questId,
        status: 'active',
        quest_type: questType,
        started_at: startedAt,
        deadline_at: template?.deadline_at || null,
        expires_at: template?.deadline_at || null,
        xp_reward: Number(template?.xp_reward || 0),
        relic_reward: Math.max(0, Number(template?.relic_reward || 0)),
        punishment_type: template?.punishment_type || 'xp_deduction',
        punishment_value: Math.max(0, Number(template?.punishment_value || 0)),
        failed: false,
        penalty_applied: false,
        created_at: startedAt,
        updated_at: startedAt,
      });

      const activatedRow = await activateUserQuest({
        userId: user.id,
        questId,
        startedAt,
      });
      if (activatedRow?.quest_id) {
        mergeOptimisticUserQuestRow(activatedRow);
      }
      setTab('progress');

      await loadData(user.id);
      notifyQuestChange(user.id);
    } catch (err) {
      await loadData(user.id);
      toastError(err?.message || 'Failed to accept quest.');
    } finally {
      setAcceptingQuestKey('');
    }
  }, [acceptingQuestKey, loadData, mergeOptimisticUserQuestRow, notifyQuestChange, user?.id]);

  const handleCompleteQuest = useCallback(async (quest) => {
    if (!user?.id || !quest?.id || actionLoading) return;
    if (quest.status === 'completed' && quest.completed_date === todayKey) return;
    setActionLoading(true);

    try {
      mergeOptimisticUserQuestRow({
        id: `optimistic-complete-${quest.id}-${Date.now()}`,
        user_id: user.id,
        quest_id: quest.id,
        status: 'completed',
        completed_date: todayKey,
        failed: false,
        penalty_applied: false,
        quest_type: normalizeQuestType(quest.type || 'daily'),
        xp_reward: Number(quest.xp_reward || 0),
        relic_reward: Math.max(0, Number(quest.relic_reward || 0)),
        punishment_type: quest.punishment_type || 'xp_deduction',
        punishment_value: Math.max(0, Number(quest.punishment_value || 0)),
      });

      const persisted = await updateUserQuestOutcome({
        questId: quest.id,
        status: 'completed',
        completedDate: todayKey,
      });
      if (persisted?.quest_id) {
        mergeOptimisticUserQuestRow(persisted);
      }

      await applyQuestRewards(quest);
      await loadData(user.id);
      notifyQuestChange(user.id);
    } catch (err) {
      await loadData(user.id);
      toastError(err?.message || 'Failed to complete quest.');
    } finally {
      setActionLoading(false);
    }
  }, [actionLoading, applyQuestRewards, loadData, mergeOptimisticUserQuestRow, notifyQuestChange, todayKey, updateUserQuestOutcome, user?.id]);

  const handleFailQuest = useCallback(async (quest) => {
    if (!user?.id || !quest?.id || actionLoading) return;
    setActionLoading(true);

    try {
      mergeOptimisticUserQuestRow({
        id: `optimistic-fail-${quest.id}-${Date.now()}`,
        user_id: user.id,
        quest_id: quest.id,
        status: 'failed',
        completed_date: todayKey,
        failed: true,
        penalty_applied: false,
        quest_type: normalizeQuestType(quest.type || 'daily'),
        xp_reward: Number(quest.xp_reward || 0),
        relic_reward: Math.max(0, Number(quest.relic_reward || 0)),
        punishment_type: quest.punishment_type || 'xp_deduction',
        punishment_value: Math.max(0, Number(quest.punishment_value || 0)),
      });

      const persisted = await updateUserQuestOutcome({
        questId: quest.id,
        status: 'failed',
        completedDate: todayKey,
      });
      if (persisted?.quest_id) {
        mergeOptimisticUserQuestRow(persisted);
      }

      await loadData(user.id);
      notifyQuestChange(user.id);
    } catch (err) {
      await loadData(user.id);
      toastError(err?.message || 'Failed to fail quest.');
    } finally {
      setActionLoading(false);
    }
  }, [actionLoading, loadData, mergeOptimisticUserQuestRow, notifyQuestChange, todayKey, updateUserQuestOutcome, user?.id]);

  const getAvailabilityState = useCallback((template) => {
    const type = normalizeQuestType(template?.type || 'daily');
    const userQuest = userQuestMap.get(template?.id) || null;
    const status = canonicalQuestStatus(userQuest?.status || 'inactive');
    const completedDate = toDateOnly(userQuest?.completed_date);
    const inProgress = isQuestInProgressStatus(status);

    let completedForCycle = false;
    if (status === 'completed') {
      if (type === 'daily') {
        completedForCycle = completedDate === todayKey;
      } else if (type === 'weekly') {
        completedForCycle = isDateInCurrentWeek(completedDate, new Date(nowMs));
      } else {
        completedForCycle = true;
      }
    }

    const requiredLevel = normalizeRequiredLevel(type, template?.min_level_required);
    const locked = level < requiredLevel;

    return {
      status,
      inProgress,
      completedForCycle,
      locked,
      requiredLevel,
    };
  }, [level, nowMs, todayKey, userQuestMap]);

  const normalizedXpHistory = useMemo(() => (
    (xpHistory || [])
      .map((log) => {
        const delta = Number(log?.change_amount ?? log?.xp_change ?? 0);
        const parsed = log?.created_at ? new Date(log.created_at) : (log?.date ? new Date(`${log.date}T00:00:00`) : null);
        const timestamp = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
        const reasonKey = String(log?.reason || log?.source || 'manual');
        return {
          ...log,
          delta: Number.isFinite(delta) ? Math.trunc(delta) : 0,
          timestamp,
          dayKey: timestamp ? format(timestamp, 'yyyy-MM-dd') : (log?.date || 'unknown'),
          reasonKey,
          metadata: (log?.metadata && typeof log.metadata === 'object') ? log.metadata : {},
        };
      })
      .sort((a, b) => (b.timestamp?.getTime() || 0) - (a.timestamp?.getTime() || 0))
  ), [xpHistory]);

  const filteredXpHistory = useMemo(() => {
    if (xpHistoryFilter === 'rewards') return normalizedXpHistory.filter((log) => log.delta > 0);
    if (xpHistoryFilter === 'penalties') return normalizedXpHistory.filter((log) => log.delta < 0);
    return normalizedXpHistory;
  }, [normalizedXpHistory, xpHistoryFilter]);

  const groupedXpHistory = useMemo(() => {
    const bucket = new Map();
    for (const row of filteredXpHistory) {
      const key = row.dayKey || 'unknown';
      if (!bucket.has(key)) {
        bucket.set(key, { dayKey: key, logs: [], netXp: 0 });
      }
      const target = bucket.get(key);
      target.logs.push(row);
      target.netXp += row.delta;
    }
    return Array.from(bucket.values()).sort((a, b) => new Date(b.dayKey).getTime() - new Date(a.dayKey).getTime());
  }, [filteredXpHistory]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0f2027, #203a43, #2c5364)' }}>
        <div className="w-8 h-8 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'linear-gradient(135deg, #0f2027, #203a43, #2c5364)' }}>
        <div className="w-full max-w-md rounded-2xl p-5 space-y-3" style={{ background: 'rgba(15,32,39,0.7)', border: '1px solid #1e3a4a' }}>
          <p className="text-sm font-bold text-red-400 tracking-wide">QUEST BOARD LOAD FAILED</p>
          <p className="text-sm" style={{ color: '#94A3B8' }}>{loadError}</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button onClick={() => user?.id && loadData(user.id)} className="flex-1">Retry</Button>
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => navigate(createPageUrl('Dashboard'))}>Back</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: 'linear-gradient(135deg, #0f2027, #203a43, #2c5364)' }}>
      <div className="w-full max-w-2xl mx-auto p-4 md:p-6 space-y-5 overflow-x-hidden">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(createPageUrl('Dashboard'))}
            className="w-9 h-9 rounded-lg flex items-center justify-center transition-all hover:scale-110"
            style={{ background: 'rgba(15,32,39,0.8)', border: '1px solid #1e3a4a' }}
          >
            <ArrowLeft className="w-4 h-4 text-white" />
          </button>
          <div>
            <h1 className="text-lg font-black tracking-widest text-white">QUEST BOARD</h1>
            <p className="text-xs" style={{ color: '#64748B' }}>
              Lv. {level} · {profile?.name || 'Player'}
            </p>
          </div>
        </div>

        <div className="flex gap-1 p-1 rounded-xl overflow-x-auto" style={{ background: 'rgba(15,32,39,0.7)', border: '1px solid #1e3a4a' }}>
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              data-guide-id={entry.id === 'available' ? 'quests-tab-available' : (entry.id === 'progress' ? 'quests-tab-progress' : undefined)}
              className="flex-1 min-w-[100px] py-2 rounded-lg text-xs font-bold tracking-widest transition-all flex items-center justify-center gap-1 whitespace-nowrap"
              style={{
                background: tab === entry.id ? 'rgba(56,189,248,0.15)' : 'transparent',
                color: tab === entry.id ? '#38BDF8' : '#64748B',
                border: tab === entry.id ? '1px solid rgba(56,189,248,0.3)' : '1px solid transparent',
              }}
            >
              <entry.icon className="w-3 h-3" />
              {entry.label}
            </button>
          ))}
        </div>

        <div className="min-h-5 flex justify-center">
          <XPDeltaPulse value={xpDelta} visible={xpDelta !== 0} />
        </div>

        {tab === 'progress' && (
          <div className="space-y-4">
            {activeQuests.length === 0 ? (
              <div className="text-center py-12 rounded-2xl" style={{ background: 'rgba(15,32,39,0.5)', border: '1px solid #1e3a4a' }}>
                <Trophy className="w-8 h-8 mx-auto mb-3" style={{ color: '#1e3a4a' }} />
                <p style={{ color: '#64748B' }}>No active quests. Accept from the Available tab.</p>
              </div>
            ) : (
              QUEST_SECTION_ORDER.map((type) => {
                const display = getQuestDisplayType(type);
                const quests = activeQuests.filter((quest) => normalizeQuestType(quest.type) === type);
                if (!quests.length) return null;
                return (
                  <div key={type}>
                    <p className="text-xs font-bold tracking-widest mb-2" style={{ color: display.color }}>
                      {display.label} QUESTS
                    </p>
                    <div className="space-y-2">
                      {quests.map((quest, index) => (
                        <QuestCard
                          key={quest.id}
                          quest={quest}
                          index={index}
                          onComplete={handleCompleteQuest}
                          onFail={handleFailQuest}
                          disabled={actionLoading}
                          nowMs={nowMs}
                        />
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {tab === 'available' && (
          <div className="space-y-5">
            {availableSections.map((section) => {
              const display = getQuestDisplayType(section.id);
              const Icon = display.icon;
              return (
                <div key={section.id}>
                  <div className="flex items-center gap-2 mb-3 min-w-0">
                    <Icon className="w-4 h-4" style={{ color: display.color }} />
                    <span className="text-xs font-bold tracking-widest break-words" style={{ color: display.color }}>
                      {section.label}
                    </span>
                  </div>

                  {section.quests.length === 0 ? (
                    section.lockedQuest ? (
                      <div
                        className="rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                        style={{ background: 'rgba(15,32,39,0.7)', border: `1px solid ${display.color}22`, opacity: 0.75 }}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-white">{section.lockedQuest.title}</p>
                          <p className="text-xs mt-0.5" style={{ color: '#64748B' }}>{section.lockedQuest.description}</p>
                          <p className="text-xs mt-2" style={{ color: '#F87171' }}>
                            Unlocks at Lv. {Number(section.lockedQuest.min_level_required || 0)}
                          </p>
                        </div>
                        <span className="text-xs font-bold px-2 py-1 rounded" style={{ border: '1px solid #F8717144', color: '#F87171', background: '#7F1D1D33' }}>
                          LOCKED
                        </span>
                      </div>
                    ) : (
                      <div className="rounded-xl p-4 text-sm" style={{ background: 'rgba(15,32,39,0.45)', border: '1px solid #1e3a4a', color: '#64748B' }}>
                        {section.emptyText}
                      </div>
                    )
                  ) : (
                    <div className="space-y-3">
                      {section.quests.map((template) => {
                        const availability = getAvailabilityState(template);
                        const templateKey = getTemplateKey(template);
                        const isAccepting = acceptingQuestKey === templateKey;
                        const acceptBlockedByOtherMutation = Boolean(acceptingQuestKey) && !isAccepting;

                        return (
                          <div
                            key={template.id || templateKey}
                            className="rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4"
                            style={{
                              background: 'rgba(15,32,39,0.7)',
                              border: `1px solid ${display.color}22`,
                              opacity: availability.locked ? 0.5 : 1,
                            }}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-white">{template.title}</p>
                              <p className="text-xs mt-0.5" style={{ color: '#64748B' }}>{template.description}</p>
                              <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-1.5">
                                <span className="text-xs font-bold" style={{ color: '#FBBF24' }}>+{Number(template.xp_reward || 0)} XP</span>
                                {Number(template.relic_reward || 0) > 0 && (
                                  <span className="text-xs font-bold" style={{ color: '#A78BFA' }}>
                                    +{Number(template.relic_reward || 0)} relic
                                  </span>
                                )}
                                {template.stat_reward && (
                                  <span className="text-xs" style={{ color: display.color }}>
                                    {String(template.stat_reward).toUpperCase()} +{Number(template.stat_reward_amount || 1)}
                                  </span>
                                )}
                                {template.deadline_at && (
                                  <span className="text-xs" style={{ color: '#FCA5A5' }}>
                                    Deadline {new Date(template.deadline_at).toLocaleString()}
                                  </span>
                                )}
                                {(template.punishment_type || template.punishment_value) && (
                                  <span className="text-xs" style={{ color: '#F87171' }}>
                                    Punish: {template.punishment_type || 'xp_deduction'} {Math.max(0, Number(template.punishment_value || 0))}
                                  </span>
                                )}
                                {availability.locked && (
                                  <span className="text-xs" style={{ color: '#F87171' }}>
                                    Lv. {availability.requiredLevel} required
                                  </span>
                                )}
                              </div>
                            </div>

                            {!availability.locked && !availability.inProgress && !availability.completedForCycle && (
                              <Button
                                type="button"
                                size="sm"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  void handleAcceptQuest(template);
                                }}
                                disabled={acceptBlockedByOtherMutation}
                                className="text-xs h-8 px-3 font-bold tracking-wide w-full sm:w-auto"
                                style={{ background: `${display.color}22`, border: `1px solid ${display.color}44`, color: display.color }}
                              >
                                <Plus className="w-3 h-3 mr-1" />
                                {isAccepting ? '...' : 'Accept'}
                              </Button>
                            )}

                            {!availability.locked && availability.inProgress && (
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => setTab('progress')}
                                className="text-xs h-8 px-3 font-bold tracking-wide w-full sm:w-auto"
                                style={{ background: 'rgba(56,189,248,0.15)', border: '1px solid rgba(56,189,248,0.35)', color: '#38BDF8' }}
                              >
                                In Progress
                              </Button>
                            )}

                            {!availability.locked && !availability.inProgress && availability.completedForCycle && (
                              <span className="text-xs font-bold px-2 py-1 rounded" style={{ color: '#34D399', border: '1px solid #34D39944', background: '#14532D33' }}>
                                DONE
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {tab === 'history' && (
          <div className="space-y-4">
            <HoloPanel>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                <p className="text-xs font-bold tracking-widest" style={{ color: '#38BDF8' }}>XP HISTORY</p>
                <div className="flex flex-wrap gap-1">
                  {[
                    { id: 'all', label: 'All' },
                    { id: 'rewards', label: 'Rewards' },
                    { id: 'penalties', label: 'Penalties' },
                  ].map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => setXpHistoryFilter(entry.id)}
                      className="px-2 py-1 rounded text-[10px] font-bold tracking-widest"
                      style={{
                        border: '1px solid rgba(56,189,248,0.25)',
                        background: xpHistoryFilter === entry.id ? 'rgba(56,189,248,0.2)' : 'rgba(15,32,39,0.35)',
                        color: xpHistoryFilter === entry.id ? '#7DD3FC' : '#64748B',
                      }}
                    >
                      {entry.label.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {groupedXpHistory.length === 0 ? (
                <p className="text-sm" style={{ color: '#64748B' }}>No XP history yet.</p>
              ) : (
                <div className="space-y-3 max-h-80 overflow-y-auto">
                  {groupedXpHistory.map((group) => (
                    <div key={group.dayKey} className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-bold tracking-widest" style={{ color: '#94A3B8' }}>
                          {group.dayKey}
                        </p>
                        <p className={`text-[11px] font-black ${group.netXp >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          NET {group.netXp >= 0 ? '+' : ''}{group.netXp} XP
                        </p>
                      </div>

                      {group.logs.map((log, index) => (
                        <div
                          key={log.id || `${group.dayKey}-${index}`}
                          className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-3 p-2 rounded-lg"
                          style={{ background: 'rgba(15,32,39,0.5)', border: '1px solid rgba(56,189,248,0.1)' }}
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-white">
                              {getReasonLabel(log.reasonKey)} · {(log.source || log.reasonKey || 'manual').toUpperCase()}
                            </p>
                            <p className="text-[10px]" style={{ color: '#64748B' }}>
                              {log.timestamp ? log.timestamp.toLocaleString() : (log.date || '')}
                            </p>
                          </div>
                          <span className={`text-sm font-bold whitespace-nowrap sm:self-auto self-start ${log.delta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {log.delta >= 0 ? '+' : ''}{log.delta} XP
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </HoloPanel>

            <div>
              <p className="text-xs font-bold tracking-widest mb-3" style={{ color: '#FBBF24' }}>QUEST HISTORY</p>
              {questHistory.length === 0 ? (
                <div className="text-center py-6 rounded-2xl" style={{ background: 'rgba(15,32,39,0.5)', border: '1px solid #1e3a4a' }}>
                  <p style={{ color: '#64748B' }}>No completed or failed quests yet.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {questHistory.map((quest, index) => (
                    <QuestCard key={`${quest.id}-${index}`} quest={quest} index={index} nowMs={nowMs} />
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
