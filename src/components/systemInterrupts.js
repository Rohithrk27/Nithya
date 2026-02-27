import { getRankTitle } from './gameEngine';

const INTERRUPTS = [
  {
    code: 'gate-scan',
    title: 'GATE ANOMALY DETECTED',
    description: 'Run a 15-minute focus sprint now. Compliance increases growth velocity.',
    rewardMult: 1.2,
    penaltyMult: 0.8,
    statReward: 'discipline',
  },
  {
    code: 'shadow-drill',
    title: 'SHADOW DRILL PROTOCOL',
    description: 'Complete one pending habit in the next hour for a system bonus.',
    rewardMult: 1.1,
    penaltyMult: 0.7,
    statReward: 'consistency',
  },
  {
    code: 'hunter-brief',
    title: 'HUNTER BRIEFING',
    description: 'Review your plan and queue tomorrow\'s top 3 priorities.',
    rewardMult: 1.0,
    penaltyMult: 0.6,
    statReward: 'intelligence',
  },
];

function seededIndex(seed, max) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return Math.abs(h >>> 0) % max;
}

export function getDailySystemInterrupt({ userId, level = 0, dateKey, hardcoreMode = false }) {
  if (!userId || !dateKey) return null;
  const idx = seededIndex(`${userId}-${dateKey}-${level}`, INTERRUPTS.length);
  const base = INTERRUPTS[idx];
  const rewardXp = Math.max(40, Math.floor((80 + level * 4) * base.rewardMult));
  const penaltyXp = Math.max(30, Math.floor((50 + level * 3) * (hardcoreMode ? 1.25 : 1) * base.penaltyMult));
  const rank = getRankTitle(level);
  return {
    id: `${dateKey}-${base.code}`,
    ...base,
    rewardXp,
    penaltyXp,
    rankHint: rank,
  };
}

export function getInterruptStorageKey(userId, eventId) {
  return `nithya_interrupt_${userId}_${eventId}`;
}

