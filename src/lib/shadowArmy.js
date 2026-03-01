const SHADOW_ARMY_UNIT_DAYS = 7;
const SHADOW_ARMY_MAX_BONUS_PCT = 15;

export function getStreakDays(profile) {
  if (!profile) return 0;
  return Math.max(0, Number(profile?.daily_streak ?? profile?.global_streak ?? 0) || 0);
}

export function computeShadowArmyCount(streakDays = 0) {
  return Math.max(0, Math.floor((Number(streakDays) || 0) / SHADOW_ARMY_UNIT_DAYS));
}

export function getShadowArmyBonusPct(shadowArmyCount = 0) {
  const units = Math.max(0, Number(shadowArmyCount) || 0);
  return Math.min(SHADOW_ARMY_MAX_BONUS_PCT, units);
}

export function applyShadowArmyXpBonus(baseXp, streakDays = 0) {
  const safeBase = Math.max(0, Math.floor(Number(baseXp) || 0));
  if (safeBase <= 0) {
    return { totalXp: 0, bonusXp: 0, bonusPct: 0, shadowArmyCount: 0 };
  }
  const shadowArmyCount = computeShadowArmyCount(streakDays);
  const bonusPct = getShadowArmyBonusPct(shadowArmyCount);
  if (bonusPct <= 0) {
    return { totalXp: safeBase, bonusXp: 0, bonusPct: 0, shadowArmyCount };
  }
  const bonusXp = Math.max(1, Math.floor(safeBase * (bonusPct / 100)));
  return {
    totalXp: safeBase + bonusXp,
    bonusXp,
    bonusPct,
    shadowArmyCount,
  };
}
