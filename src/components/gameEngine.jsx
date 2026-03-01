/**
 * SOLO LEVELING GAME ENGINE — HARD MODE
 * XP = 120 × (level ^ 1.8) — Scarce, demanding progression
 */

// ─── XP / LEVEL ─────────────────────────────────────────────────────────────

/** Total XP required to REACH `level` from 0 */
export function xpForLevel(level) {
  if (level <= 0) return 0;
  return Math.floor(120 * Math.pow(level, 1.8));
}

/** XP gap between level N and N+1 */
export function xpBetweenLevels(level) {
  return xpForLevel(level + 1) - xpForLevel(level);
}

/** Derive current level from total XP */
export function computeLevel(totalXp) {
  if (!totalXp || totalXp <= 0) return 0;
  let level = 0;
  while (level < 1000 && totalXp >= xpForLevel(level + 1)) {
    level++;
  }
  return level;
}

/** XP accumulated within the current level */
export function xpIntoCurrentLevel(totalXp) {
  const level = computeLevel(totalXp);
  return Math.max(0, totalXp - xpForLevel(level));
}

/** Percentage (0–100) through the current level */
export function levelProgressPct(totalXp) {
  const level = computeLevel(totalXp);
  if (level >= 1000) return 100;
  const inLevel = xpIntoCurrentLevel(totalXp);
  const needed = xpBetweenLevels(level);
  return needed > 0 ? Math.min(100, (inLevel / needed) * 100) : 0;
}

// ─── STAT SYSTEM ────────────────────────────────────────────────────────────

export function passiveBonusPerStat(level) {
  return Math.floor(level * 0.3);
}

export function computeFinalStat(baseAllocated, level) {
  return (baseAllocated || 0) + passiveBonusPerStat(level);
}

export const STAT_KEYS = ['strength', 'intelligence', 'discipline', 'health', 'career', 'social', 'consistency'];

export function computeAllStats(profile, level) {
  const bonus = passiveBonusPerStat(level);
  const result = {};
  for (const k of STAT_KEYS) {
    result[k] = (profile?.[`stat_${k}`] || 0) + bonus;
  }
  return result;
}

// ─── XP GAIN ────────────────────────────────────────────────────────────────

export function applyXPGain(oldTotalXp, xpGain) {
  const safeOld = Math.max(0, oldTotalXp || 0);
  const newTotalXp = Math.max(0, safeOld + xpGain);
  const oldLevel = computeLevel(safeOld);
  const newLevel = computeLevel(newTotalXp);
  const levelsGained = Math.max(0, newLevel - oldLevel);
  return { newTotalXp, newLevel, oldLevel, levelsGained, statPointsGained: levelsGained * 5 };
}

export function buildXPUpdatePayload(profile, xpGain) {
  const { newTotalXp, newLevel, levelsGained, statPointsGained } = applyXPGain(profile.total_xp || 0, xpGain);
  return {
    total_xp: newTotalXp,
    current_xp: newTotalXp,
    level: newLevel,
    ...(levelsGained > 0 ? { stat_points: (profile.stat_points || 0) + statPointsGained } : {}),
  };
}

// ─── XP REWARD SCALING ──────────────────────────────────────────────────────

/** Apply 30% reduction to normal quest/habit XP. Use for standard rewards. */
export function scaledXP(baseXP) {
  return Math.max(5, Math.floor(baseXP * 0.65));
}

/** Special high-value events: dungeons, boss kills, long streaks */
export function bonusXP(type, level) {
  switch (type) {
    case 'dungeon_clear': return Math.floor(2000 + level * 50);
    case 'boss_milestone': return Math.floor(1500 + level * 30);
    case 'streak_30': return 800;
    case 'streak_60': return 1500;
    case 'streak_100': return 3000;
    case 'daily_challenge': return Math.floor(150 + level * 2);
    default: return 100;
  }
}

// ─── XP PENALTY ─────────────────────────────────────────────────────────────

/**
 * Compute XP deduction for refusing punishment.
 * pct: 5–15 percent of current level XP requirement
 */
export function punishmentRefusalPenalty(profile, pct = 10) {
  const lvl = computeLevel(profile.total_xp || 0);
  const levelReq = xpBetweenLevels(lvl);
  return Math.max(50, Math.floor(levelReq * (pct / 100)));
}

// ─── STAT DECAY ─────────────────────────────────────────────────────────────

/**
 * Apply 1–2% decay to a given stat if habit missed for 7+ days.
 * Cannot reduce below base (allocated, not passive bonus).
 */
export function applyStatDecay(profile, statKey) {
  const field = `stat_${statKey}`;
  const current = profile[field] || 0;
  if (current <= 0) return null;
  const decay = Math.max(1, Math.floor(current * 0.015));
  return { [field]: Math.max(0, current - decay) };
}

// ─── AVATAR TIER ────────────────────────────────────────────────────────────

export function getAvatarTier(level) {
  const safeLevel = Math.max(0, Number(level) || 0);
  // Keep avatar evolution responsive in early progression.
  // This restores gradual visible upgrades similar to the earlier 3/8/16 stage cadence.
  if (safeLevel >= 300) return 10;
  if (safeLevel >= 230) return 9;
  if (safeLevel >= 170) return 8;
  if (safeLevel >= 120) return 7;
  if (safeLevel >= 80)  return 6;
  if (safeLevel >= 50)  return 5;
  if (safeLevel >= 30)  return 4;
  if (safeLevel >= 16)  return 3;
  if (safeLevel >= 8)   return 2;
  if (safeLevel >= 3)   return 1;
  return 0;
}

// ─── RANK / COLORS ──────────────────────────────────────────────────────────

const RANK_MAP = [
  [0,'Unranked'],[10,'Novice'],[50,'Apprentice'],[100,'Warrior'],
  [200,'Knight'],[350,'Champion'],[500,'Legend'],[650,'Phantom'],
  [800,'Transcendent'],[900,'Awakened'],[1000,'System Master'],
];

export function getRankTitle(level) {
  let t = RANK_MAP[0][1];
  for (const [l, r] of RANK_MAP) { if (level >= l) t = r; }
  return t;
}

export function getTierColors(level) {
  if (level >= 1000) return ['#FFFFFF', '#67E8F9'];
  if (level >= 900)  return ['#67E8F9', '#22D3EE'];
  if (level >= 650)  return ['#FBBF24', '#F87171'];
  if (level >= 500)  return ['#34D399', '#60A5FA'];
  if (level >= 350)  return ['#22D3EE', '#38BDF8'];
  if (level >= 200)  return ['#60A5FA', '#38BDF8'];
  if (level >= 100)  return ['#38BDF8', '#38BDF8'];
  if (level >= 50)   return ['#38BDF8', '#60A5FA'];
  if (level >= 10)   return ['#38BDF8', '#60A5FA'];
  return ['#475569', '#64748B'];
}
