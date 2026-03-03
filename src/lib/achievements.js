import { supabase } from '@/lib/supabase';
import { computeLevel } from '@/components/gameEngine';
import { ACHIEVEMENT_DEFS, checkNewAchievements } from '@/components/systemFeatures';

const mapDefToAchievement = (def, unlockedDate) => ({
  key: def.key,
  title: def.title,
  description: def.description,
  icon: def.icon,
  category: def.category,
  unlocked_date: unlockedDate,
});

export async function syncUserAchievements({ userId, profile }) {
  if (!userId || !profile) {
    return {
      achievementProfile: profile || null,
      achievements: [],
      canPersist: false,
      newlyUnlocked: [],
    };
  }

  const { count: dungeonCount, error: dungeonCountError } = await supabase
    .from('dungeon_runs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'completed');

  const completedDungeonCount = dungeonCountError
    ? Math.max(0, Number(profile?.dungeon_completed_count || 0))
    : Math.max(0, Number(dungeonCount || 0));

  const achievementProfile = {
    ...profile,
    dungeon_completed_count: completedDungeonCount,
  };
  const level = computeLevel(achievementProfile?.total_xp || 0);
  const unlockedByRule = ACHIEVEMENT_DEFS.filter((def) => def.check(achievementProfile, level));
  const unlockedDate = new Date().toISOString().slice(0, 10);

  const { data: storedRows, error: readError } = await supabase
    .from('achievements')
    .select('*')
    .eq('user_id', userId);

  if (readError) {
    return {
      achievementProfile,
      achievements: unlockedByRule.map((def) => mapDefToAchievement(def, unlockedDate)),
      canPersist: false,
      newlyUnlocked: [],
    };
  }

  const storedAchievements = storedRows || [];
  const storedKeys = storedAchievements.map((a) => a.key).filter(Boolean);
  const missingDefs = checkNewAchievements(achievementProfile, level, storedKeys);
  let inserted = [];

  if (missingDefs.length > 0) {
    const payload = missingDefs.map((def) => ({
      user_id: userId,
      key: def.key,
      title: def.title,
      description: def.description,
      icon: def.icon,
      category: def.category,
      unlocked_date: unlockedDate,
    }));
    const { data: insertedRows, error: insertError } = await supabase
      .from('achievements')
      .insert(payload)
      .select('*');
    if (!insertError && insertedRows?.length) inserted = insertedRows;
  }

  const byKey = new Map();
  for (const row of [...storedAchievements, ...inserted]) {
    const key = row?.key ? String(row.key).trim() : '';
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, row);
  }

  // Runtime-safe fallback: even if insert fails, keep vault aligned with
  // current profile progression so unlocked achievements still render.
  for (const def of unlockedByRule) {
    if (byKey.has(def.key)) continue;
    byKey.set(def.key, mapDefToAchievement(def, unlockedDate));
  }

  return {
    achievementProfile,
    achievements: Array.from(byKey.values()),
    canPersist: true,
    newlyUnlocked: inserted,
  };
}
