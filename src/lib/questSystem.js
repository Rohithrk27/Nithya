import { supabase } from '@/lib/supabase';
import { DAILY_QUEST_POOL } from '@/components/systemFeatures';

const QUEST_OPTIONAL_COLUMNS = [
  'date',
  'expires_date',
  'progress_current',
  'progress_target',
  'stat_reward_amount',
  'min_level_required',
  'status',
];

const isMissingQuestsColumnError = (error) => {
  const msg = String(error?.message || '').toLowerCase();
  return (
    (msg.includes("column of 'quests'") && msg.includes('could not find'))
    || (msg.includes('relation "quests"') && msg.includes('does not exist'))
  );
};

const getMissingQuestsColumn = (error) => {
  const raw = String(error?.message || '');
  let match = raw.match(/Could not find the '([^']+)' column of 'quests'/i);
  if (match?.[1]) return match[1];
  match = raw.match(/column "([^"]+)" of relation "quests" does not exist/i);
  return match?.[1] || null;
};

export async function insertQuestCompat(payload) {
  if (!payload || typeof payload !== 'object') {
    return { data: null, error: new Error('Invalid quest payload') };
  }

  const rpcRes = await supabase.rpc('ensure_quest_template', {
    p_payload: payload,
  });
  if (!rpcRes.error) return rpcRes;
  if (!String(rpcRes.error?.message || '').toLowerCase().includes('ensure_quest_template')) {
    return rpcRes;
  }

  let workingPayload = { ...payload };
  let fallbackUsed = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await supabase.from('quests').insert(workingPayload).select().single();
    if (!result.error) return result;
    if (!isMissingQuestsColumnError(result.error)) return result;

    const missingColumn = getMissingQuestsColumn(result.error);
    if (missingColumn && Object.prototype.hasOwnProperty.call(workingPayload, missingColumn)) {
      delete workingPayload[missingColumn];
      fallbackUsed = true;
      continue;
    }

    if (!fallbackUsed) {
      fallbackUsed = true;
      for (const col of QUEST_OPTIONAL_COLUMNS) {
        delete workingPayload[col];
      }
      continue;
    }

    return result;
  }

  return { data: null, error: new Error('Failed to insert quest with compatibility fallback') };
}

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

export async function ensureDailyQuests(userId, dateKey, quests = [], _userQuestRows = []) {
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
      const { data: inserted, error } = await insertQuestCompat({
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
      });
      if (!error && inserted) {
        questRows.push(inserted);
        byTitle.set(key, inserted);
        changed = true;
      }
    }
  }

  return changed;
}

