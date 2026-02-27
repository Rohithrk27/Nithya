import { supabase } from '@/lib/supabase';
import { DAILY_QUEST_POOL } from '@/components/systemFeatures';

function seededIndex(seed, mod) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return Math.abs(h >>> 0) % mod;
}

export function pickDailyQuestTemplates(userId, dateKey, count = 3) {
  const pool = [...DAILY_QUEST_POOL];
  const picked = [];
  let salt = 0;
  while (pool.length > 0 && picked.length < count) {
    const idx = seededIndex(`${userId}-${dateKey}-${salt}`, pool.length);
    picked.push(pool[idx]);
    pool.splice(idx, 1);
    salt += 1;
  }
  return picked;
}

export async function ensureDailyQuests(userId, dateKey, quests = [], userQuests = []) {
  if (!userId || !dateKey) return false;
  const templates = pickDailyQuestTemplates(userId, dateKey, 3);
  if (!templates.length) return false;

  let questRows = [...quests];
  let changed = false;

  // Ensure canonical daily quest rows exist in quests table.
  const byTitle = new Map(questRows.map((q) => [`${q.type}:${q.title}`, q]));
  for (const t of templates) {
    const key = `daily:${t.title}`;
    if (!byTitle.has(key)) {
      const { data: inserted, error } = await supabase
        .from('quests')
        .insert({
          title: t.title,
          description: t.description,
          type: 'daily',
          xp_reward: t.xp_reward,
          stat_reward: t.stat_reward,
          stat_reward_amount: 1,
          min_level_required: 0,
          status: 'active',
          date: dateKey,
          expires_date: dateKey,
        })
        .select()
        .single();
      if (!error && inserted) {
        questRows.push(inserted);
        byTitle.set(key, inserted);
        changed = true;
      }
    }
  }

  // Ensure user has rows in user_quests so daily quests show in Active list.
  const userQuestByQuestId = new Map((userQuests || []).map((uq) => [uq.quest_id, uq]));
  for (const t of templates) {
    const questRow = byTitle.get(`daily:${t.title}`);
    if (!questRow) continue;
    if (!userQuestByQuestId.has(questRow.id)) {
      const { error } = await supabase.from('user_quests').upsert({
        user_id: userId,
        quest_id: questRow.id,
        status: 'active',
        date: dateKey,
      });
      if (!error) changed = true;
    }
  }

  return changed;
}

