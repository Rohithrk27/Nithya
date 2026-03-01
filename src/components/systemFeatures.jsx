/**
 * SYSTEM FEATURES ENGINE
 * Hidden Rank, Achievements, Dungeon, Whispers, Boss Events, Daily Challenges
 */

import { computeAllStats, STAT_KEYS } from './gameEngine';

// ─── HIDDEN RANK ────────────────────────────────────────────────────────────

const RANK_THRESHOLDS = [
  { rank: 'E Rank', min: 0 },
  { rank: 'D Rank', min: 50 },
  { rank: 'C Rank', min: 150 },
  { rank: 'B Rank', min: 350 },
  { rank: 'A Rank', min: 700 },
  { rank: 'S Rank', min: 1200 },
  { rank: 'Monarch Tier', min: 2000 },
];

const RANK_REVEAL_LEVELS = [100, 300, 500, 800, 1000];

export function computeHiddenRank(profile, level) {
  const stats = computeAllStats(profile, level);
  const totalStats = STAT_KEYS.reduce((s, k) => s + (stats[k] || 0), 0);
  const score = totalStats + level * 2;
  let rank = RANK_THRESHOLDS[0].rank;
  for (const { min, rank: r } of RANK_THRESHOLDS) {
    if (score >= min) rank = r;
  }
  return rank;
}

export function shouldRevealRank(level) {
  return RANK_REVEAL_LEVELS.includes(level);
}

export const RANK_REVEAL_LEVELS_SET = new Set(RANK_REVEAL_LEVELS);

// ─── ACHIEVEMENTS ────────────────────────────────────────────────────────────

const achievementStreak = (profile) => Math.max(
  0,
  Number(profile?.daily_streak ?? profile?.global_streak ?? 0) || 0
);

const dungeonCompletions = (profile) => Math.max(
  0,
  Number(
    profile?.dungeon_completed_count
    ?? profile?.dungeons_completed
    ?? profile?.dungeon_completed
    ?? profile?.dungeon_achievements?.completed
    ?? 0
  ) || 0
);

export const ACHIEVEMENT_DEFS = [
  { key: 'streak_7',    title: 'Relentless',      description: '7-day global streak',          icon: '🔥', category: 'streak',  check: (p) => achievementStreak(p) >= 7 },
  { key: 'streak_30',   title: 'Iron Will',        description: '30-day global streak',         icon: '⚡', category: 'streak',  check: (p) => achievementStreak(p) >= 30 },
  { key: 'streak_100',  title: 'The Relentless',   description: '100-day streak',               icon: '💎', category: 'streak',  check: (p) => achievementStreak(p) >= 100 },
  { key: 'quests_10',   title: 'Quest Taker',      description: '10 quests completed',          icon: '⚔️', category: 'quests',  check: (p) => (p.quests_completed || 0) >= 10 },
  { key: 'quests_50',   title: 'Unyielding',       description: '50 quests completed',          icon: '🗡️', category: 'quests',  check: (p) => (p.quests_completed || 0) >= 50 },
  { key: 'quests_200',  title: 'The Unyielding',   description: '200 quests completed',         icon: '👑', category: 'quests',  check: (p) => (p.quests_completed || 0) >= 200 },
  { key: 'level_10',    title: 'System Candidate', description: 'Reached Level 10',             icon: '🌀', category: 'level',   check: (p, l) => l >= 10 },
  { key: 'level_50',    title: 'The Strategist',   description: 'Reached Level 50',             icon: '🔷', category: 'level',   check: (p, l) => l >= 50 },
  { key: 'level_100',   title: 'Awakened',         description: 'Reached Level 100',            icon: '✨', category: 'level',   check: (p, l) => l >= 100 },
  { key: 'level_500',   title: 'System Architect', description: 'Reached Level 500',            icon: '🏛️', category: 'level',   check: (p, l) => l >= 500 },
  { key: 'stat_100',    title: 'Iron Body',        description: 'Total stats exceed 100',       icon: '💪', category: 'stats',   check: (p, l) => { const s = computeAllStats(p, l); return STAT_KEYS.reduce((a, k) => a + (s[k]||0), 0) >= 100; } },
  { key: 'dungeon_1',   title: 'Dungeon Walker',   description: 'Completed first Dungeon Mode', icon: '🏰', category: 'dungeon', check: (p) => dungeonCompletions(p) >= 1 },
];

export function checkNewAchievements(profile, level, existingKeys) {
  const existing = new Set(existingKeys);
  return ACHIEVEMENT_DEFS.filter(def => !existing.has(def.key) && def.check(profile, level));
}

// ─── SYSTEM WHISPERS ─────────────────────────────────────────────────────────

const WHISPERS = [
  "Growth detected.", "Potential rising.", "Threshold approaching.",
  "The system observes.", "Anomaly suppressed.", "Evolution in progress.",
  "Data confirmed.", "Rank recalibrating.", "Monitoring complete.",
  "Designation updated.", "Discipline stability critical.", "Compliance required.",
];

export function getRandomWhisper() {
  return WHISPERS[Math.floor(Math.random() * WHISPERS.length)];
}

// ─── DAILY ASSESSMENT ────────────────────────────────────────────────────────

export function computeAssessment(logs7, habits) {
  const habitMap = {};
  habits.forEach(h => { habitMap[h.id] = h; });
  const statActivity = { strength: 0, intelligence: 0, discipline: 0, health: 0, career: 0, social: 0, consistency: 0 };
  const completed = logs7.filter(l => l.status === 'completed');
  const total7 = habits.length * 7;
  const rate = total7 > 0 ? completed.length / total7 : 0;
  completed.forEach(l => {
    const h = habitMap[l.habit_id];
    if (!h) return;
    const weight = h.difficulty === 'hard' ? 3 : h.difficulty === 'medium' ? 2 : 1;
    statActivity.discipline += weight;
    statActivity.consistency += 1;
  });
  const trend = rate >= 0.8 ? 'Improving' : rate >= 0.5 ? 'Stable' : 'Declining';
  const consistencyStatus = rate >= 0.6 ? 'Stable' : 'At Risk';
  return {
    overall_rate: Math.round(rate * 100),
    trend,
    discipline: trend,
    consistency: consistencyStatus,
    strength: statActivity.discipline >= 10 ? 'Improving' : 'Stable',
    generated_at: new Date().toISOString(),
  };
}

// ─── DUNGEON CHALLENGES ──────────────────────────────────────────────────────

export const DUNGEON_CHALLENGES = [
  { title: 'No Sugar Protocol',  description: 'Avoid sugar for 7 consecutive days.',         difficulty: 'hard' },
  { title: 'Dawn Warrior',       description: 'Wake before 6 AM every day for 7 days.',      difficulty: 'hard' },
  { title: "Scholar's Vigil",    description: 'Study or read for 3+ hours each day.',        difficulty: 'medium' },
  { title: 'Iron Body Trial',    description: 'Complete a workout for 7 straight days.',     difficulty: 'hard' },
  { title: 'Digital Detox',      description: 'Limit social media to 30 min/day for 7d.',   difficulty: 'medium' },
  { title: 'Monk Protocol',      description: 'Sleep before 10 PM every night for 7 days.', difficulty: 'medium' },
];

// ─── RANDOM HIGH-DIFFICULTY PUNISHMENT POOL ──────────────────────────────────

export const HIGH_DIFFICULTY_PUNISHMENTS = [
  { text: '100 pushups — no breaks allowed', difficulty: 'extreme' },
  { text: '5 km run — timed, no walking',    difficulty: 'extreme' },
  { text: '24-hour no entertainment: no phone, no TV, no music', difficulty: 'extreme' },
  { text: 'Cold shower + 30-minute workout combo',               difficulty: 'high' },
  { text: 'Double tomorrow\'s entire quest list',                difficulty: 'high' },
  { text: '50 burpees within the next hour',                     difficulty: 'high' },
  { text: '2-hour focused work session — phone in another room', difficulty: 'high' },
  { text: '15 km walk — log distance',                          difficulty: 'extreme' },
  { text: 'No food after 6 PM for the next 2 days',             difficulty: 'high' },
  { text: 'Wake up at 5 AM tomorrow, no snooze',                difficulty: 'high' },
];

export function getRandomHardPunishment(level, disciplineStat) {
  // Higher level / lower discipline → more extreme
  const extremeWeight = Math.min(0.8, (level / 100) + ((10 - Math.min(10, disciplineStat)) / 20));
  const pool = Math.random() < extremeWeight
    ? HIGH_DIFFICULTY_PUNISHMENTS.filter(p => p.difficulty === 'extreme')
    : HIGH_DIFFICULTY_PUNISHMENTS.filter(p => p.difficulty === 'high');
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─── BOSS EVENT ──────────────────────────────────────────────────────────────

export function isBossLevel(level) {
  return level > 0 && level % 100 === 0;
}

// ─── DAILY RANDOM CHALLENGE POOL ─────────────────────────────────────────────
// Organised by difficulty tier (0=easy, 1=medium, 2=hard)

export const DAILY_CHALLENGE_POOL = [
  // Tier 0 — early levels
  { title: 'Hydration Protocol',    description: 'Drink 8 glasses of water today',                         stat_reward: 'health',       xp_reward: 110, tier: 0 },
  { title: 'Network Signal',        description: 'Reach out to a friend or colleague',                     stat_reward: 'social',       xp_reward: 100, tier: 0 },
  { title: 'Body Scan',             description: 'Track your weight and note how you feel',                stat_reward: 'health',       xp_reward: 90,  tier: 0 },
  { title: 'Mental Fortress',       description: 'Meditate or journal for 10 minutes',                     stat_reward: 'discipline',   xp_reward: 105, tier: 0 },
  { title: 'Presence Protocol',     description: 'Be fully present in every conversation today',           stat_reward: 'social',       xp_reward: 95,  tier: 0 },
  // Tier 1 — mid levels
  { title: 'Morning Warrior',       description: 'Complete a physical exercise before noon',               stat_reward: 'strength',     xp_reward: 140, tier: 1 },
  { title: 'Deep Study Session',    description: 'Study or read for at least 30 minutes',                  stat_reward: 'intelligence', xp_reward: 130, tier: 1 },
  { title: 'Full Discipline Day',   description: 'Check off every habit today',                            stat_reward: 'discipline',   xp_reward: 160, tier: 1 },
  { title: 'Skill Grind',           description: 'Spend time on a career-relevant skill for 45 minutes',  stat_reward: 'career',       xp_reward: 145, tier: 1 },
  { title: 'Zero Fault Run',        description: 'End the day with no missed habits',                      stat_reward: 'consistency',  xp_reward: 155, tier: 1 },
  { title: 'Knowledge Absorption',  description: 'Read 20 pages or watch an educational video',           stat_reward: 'intelligence', xp_reward: 135, tier: 1 },
  { title: 'Recovery Protocol',     description: 'Sleep 7+ hours and track it tonight',                    stat_reward: 'health',       xp_reward: 120, tier: 1 },
  // Tier 2 — high levels
  { title: 'Shadow Training',       description: 'Complete a workout with max intensity — no mercy',       stat_reward: 'strength',     xp_reward: 200, tier: 2 },
  { title: 'Endurance Test',        description: 'Push through all habits even when unmotivated',          stat_reward: 'discipline',   xp_reward: 210, tier: 2 },
  { title: 'Code Mastery',          description: 'Work on a technical skill for 90+ minutes straight',    stat_reward: 'intelligence', xp_reward: 195, tier: 2 },
  { title: 'Iron Routine',          description: 'Complete all habits in exact scheduled order, no delay', stat_reward: 'consistency',  xp_reward: 205, tier: 2 },
  { title: "Warrior's Diet",        description: 'Eat clean all day — no junk, no sugar, no excuses',     stat_reward: 'health',       xp_reward: 185, tier: 2 },
  { title: 'Career Advance',        description: 'Work on a project or skill for 2 hours minimum',        stat_reward: 'career',       xp_reward: 190, tier: 2 },
  { title: 'System Optimization',   description: 'Plan next 3 days fully, no vague plans',               stat_reward: 'consistency',  xp_reward: 175, tier: 2 },
  { title: 'Leadership Moment',     description: 'Help someone in a meaningful way today',                stat_reward: 'social',       xp_reward: 180, tier: 2 },
];

// Standard quest pool (used by Dashboard daily quest generation)
export const DAILY_QUEST_POOL = [
  { title: 'Morning Warrior',      description: 'Complete a physical exercise before noon',      stat_reward: 'strength',     xp_reward: 55 },
  { title: 'Deep Study Session',   description: 'Study or read for at least 30 minutes',         stat_reward: 'intelligence', xp_reward: 50 },
  { title: 'Full Discipline Day',  description: 'Check off every habit today',                   stat_reward: 'discipline',   xp_reward: 80 },
  { title: 'Hydration Protocol',   description: 'Drink 8 glasses of water today',                stat_reward: 'health',       xp_reward: 35 },
  { title: 'Skill Grind',          description: 'Spend time on a career-relevant skill',         stat_reward: 'career',       xp_reward: 60 },
  { title: 'Network Signal',       description: 'Reach out to a friend or colleague',            stat_reward: 'social',       xp_reward: 40 },
  { title: 'Zero Fault Run',       description: 'End the day with no missed habits',             stat_reward: 'consistency',  xp_reward: 65 },
  { title: 'Mental Fortress',      description: 'Meditate or journal for 10 minutes',            stat_reward: 'discipline',   xp_reward: 45 },
  { title: 'Body Scan',            description: 'Track your weight and note how you feel',       stat_reward: 'health',       xp_reward: 28 },
  { title: 'Shadow Training',      description: 'Complete a workout with max intensity',         stat_reward: 'strength',     xp_reward: 70 },
  { title: 'Knowledge Absorption', description: 'Read 20 pages or watch an educational video',  stat_reward: 'intelligence', xp_reward: 50 },
  { title: 'Leadership Moment',    description: 'Help someone with a task or mentor someone',   stat_reward: 'social',       xp_reward: 55 },
  { title: 'Iron Routine',         description: 'Complete all habits in their scheduled order', stat_reward: 'consistency',  xp_reward: 60 },
  { title: 'Career Advance',       description: 'Work on a project or skill for 1 hour',        stat_reward: 'career',       xp_reward: 55 },
  { title: 'Recovery Protocol',    description: 'Sleep 7+ hours and track it',                  stat_reward: 'health',       xp_reward: 38 },
  { title: 'Endurance Test',       description: 'Push through all habits even when unmotivated', stat_reward: 'discipline',   xp_reward: 85 },
  { title: 'Code Mastery',         description: 'Work on a technical skill for 45+ minutes',    stat_reward: 'intelligence', xp_reward: 62 },
  { title: 'Presence Protocol',    description: 'Be fully present in every conversation today', stat_reward: 'social',       xp_reward: 35 },
  { title: 'System Optimization',  description: "Plan tomorrow's schedule tonight",              stat_reward: 'consistency',  xp_reward: 42 },
  { title: "Warrior's Diet",       description: 'Eat clean — no junk food today',               stat_reward: 'health',       xp_reward: 48 },
];

/**
 * Pick today's Daily Challenge.
 * Avoids repeating challenges used in the last 7 days.
 * Scales tier based on player level.
 */
export function pickDailyChallenge(level, historyIndices = []) {
  const tier = level >= 50 ? 2 : level >= 15 ? 1 : 0;
  const candidates = DAILY_CHALLENGE_POOL
    .map((c, i) => ({ ...c, _i: i }))
    .filter(c => c.tier <= tier && !historyIndices.includes(c._i));

  if (candidates.length === 0) {
    // All exhausted — fall back to any in-tier
    const fallback = DAILY_CHALLENGE_POOL
      .map((c, i) => ({ ...c, _i: i }))
      .filter(c => c.tier <= tier);
    return fallback[Math.floor(Math.random() * fallback.length)];
  }

  return candidates[Math.floor(Math.random() * candidates.length)];
}

// ─── XP SCALING ──────────────────────────────────────────────────────────────

/**
 * Scale XP reward based on level and difficulty
 */
export function scaledXP(baseXP, level, difficulty = 'medium') {
  const difficultyMultiplier = difficulty === 'hard' ? 1.5 : difficulty === 'easy' ? 0.75 : 1;
  const levelMultiplier = 1 + (level * 0.05);
  return Math.round(baseXP * difficultyMultiplier * levelMultiplier);
}

/**
 * Calculate bonus XP for streaks and achievements
 */
export function bonusXP(streak, level) {
  const streakBonus = Math.min(streak * 2, 50); // Cap at 50
  const levelBonus = level * 1.5;
  return Math.round(streakBonus + levelBonus);
}
