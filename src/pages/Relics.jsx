import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Gem, ShieldCheck, Ticket } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { createPageUrl } from '../utils';
import { Button } from '@/components/ui/button';
import SystemBackground from '@/components/SystemBackground';
import HoloPanel from '@/components/HoloPanel';
import { useAuthedPageUser } from '@/lib/useAuthedPageUser';
import {
  fetchActiveRelicEffects,
  fetchRelicBalance,
  fetchRelicInventory,
  formatRelicCountdown,
  RELIC_MAX_BALANCE,
  redeemRelicAction,
  relicExpiryMs,
} from '@/lib/relics';

const RELIC_ACTIONS = [
  { id: 'cheat_day', label: 'Cheat Day', description: 'No task penalties or streak reset for 24h.' },
  { id: 'punishment_waiver', label: 'Punishment Waiver', description: 'Cancel one pending punishment.' },
  { id: 'shadow_debt_reduction', label: 'Shadow Debt -25%', description: 'Reduce shadow debt by 25%.' },
  { id: 'dungeon_revive', label: 'Dungeon Revive', description: 'Restore active dungeon stability to at least 50%.' },
  { id: 'xp_insurance', label: 'XP Insurance', description: 'Protect 50% of stake in an active group bet.' },
];

const sourceLabel = (source) => ({
  perfect_weekly_streak: 'Perfect Weekly Streak',
  group_bet_win: 'Group Bet Win',
  dungeon_zero_interruptions: 'Dungeon Zero Interruptions',
  shadow_debt_cleared: 'Shadow Debt Cleared',
  weekly_target_120: '120% Weekly Target',
  redeem_code: 'Redeem Code',
}[source] || source || 'Unknown');

const RARITY_STYLE = {
  common: { color: '#94A3B8', bg: 'rgba(100,116,139,0.2)' },
  rare: { color: '#60A5FA', bg: 'rgba(59,130,246,0.18)' },
  epic: { color: '#A78BFA', bg: 'rgba(139,92,246,0.2)' },
  legendary: { color: '#F59E0B', bg: 'rgba(245,158,11,0.2)' },
};

const getRelicRarity = (relic) => String(relic?.rarity || relic?.metadata?.rarity || 'rare').toLowerCase();

const isRelicAvailable = (relic, nowMs) => {
  if (!relic || relic.used) return false;
  const remaining = relicExpiryMs(relic, nowMs);
  return Number.isFinite(remaining) ? remaining > 0 : true;
};

export default function Relics() {
  const navigate = useNavigate();
  const { user, authReady } = useAuthedPageUser();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [inventory, setInventory] = useState([]);
  const [effects, setEffects] = useState([]);
  const [balance, setBalance] = useState(0);
  const [pendingPunishments, setPendingPunishments] = useState([]);
  const [activeDungeon, setActiveDungeon] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [redeemModal, setRedeemModal] = useState({
    open: false,
    relic: null,
    action: 'cheat_day',
    referenceId: '',
  });
  const [saving, setSaving] = useState(false);

  const loadData = async (userId) => {
    if (!userId) return;
    setLoading(true);
    setError('');
    try {
      const [relics, activeEffects, nextBalance, punishmentsRes, dungeonRes] = await Promise.all([
        fetchRelicInventory(userId),
        fetchActiveRelicEffects(userId),
        fetchRelicBalance(userId),
        supabase
          .from('punishments')
          .select('id,reason,status,resolved,penalty_applied,expires_at,total_xp_penalty,accumulated_penalty')
          .eq('user_id', userId)
          .eq('resolved', false)
          .eq('penalty_applied', false)
          .order('created_at', { ascending: false }),
        supabase
          .from('dungeon_runs')
          .select('id,challenge_title,status,stability')
          .eq('user_id', userId)
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(1),
      ]);

      if (punishmentsRes.error) throw punishmentsRes.error;
      if (dungeonRes.error) throw dungeonRes.error;

      setInventory(relics || []);
      setEffects(activeEffects || []);
      setBalance(nextBalance || 0);
      setPendingPunishments((punishmentsRes.data || []).filter((row) => !row.resolved && !row.penalty_applied));
      setActiveDungeon(dungeonRes.data?.[0] || null);
    } catch (err) {
      setError(err?.message || 'Failed to load relic data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authReady || !user?.id) return;
    void loadData(user.id);
  }, [authReady, user?.id]);

  useEffect(() => {
    const timerId = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timerId);
  }, []);

  const availableRelics = useMemo(
    () => inventory.filter((relic) => isRelicAvailable(relic, nowMs)),
    [inventory, nowMs]
  );

  const usedRelics = useMemo(
    () => inventory.filter((relic) => !isRelicAvailable(relic, nowMs)).slice(0, 15),
    [inventory, nowMs]
  );

  const selectedAction = redeemModal.action;
  const needsPunishmentRef = selectedAction === 'punishment_waiver';
  const needsDungeonRef = selectedAction === 'dungeon_revive';
  const needsBetRef = selectedAction === 'xp_insurance';
  const actionBlocked = (
    (needsPunishmentRef && pendingPunishments.length === 0)
    || (needsDungeonRef && !activeDungeon)
  );

  const confirmRedeem = async () => {
    if (!user?.id || !redeemModal.relic?.id || saving || actionBlocked) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      let ref = null;
      if (needsPunishmentRef) ref = redeemModal.referenceId || pendingPunishments[0]?.id || null;
      if (needsDungeonRef) ref = activeDungeon?.id || null;
      if (needsBetRef) ref = redeemModal.referenceId || null;

      const result = await redeemRelicAction({
        userId: user.id,
        relicId: redeemModal.relic.id,
        action: selectedAction,
        referenceId: ref,
      });

      if (!result?.success) throw new Error('Relic redemption failed.');
      setMessage(`Relic redeemed: ${RELIC_ACTIONS.find((a) => a.id === selectedAction)?.label || selectedAction}`);
      setRedeemModal({ open: false, relic: null, action: 'cheat_day', referenceId: '' });
      await loadData(user.id);
    } catch (err) {
      setError(err?.message || 'Failed to redeem relic.');
    } finally {
      setSaving(false);
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
      <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-4">
        <HoloPanel>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate(createPageUrl('Dashboard'))}
              className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(15,32,39,0.8)', border: '1px solid #1e3a4a' }}
            >
              <ArrowLeft className="w-4 h-4 text-white" />
            </button>
            <div className="flex-1">
              <p className="text-cyan-300 text-xs tracking-widest font-black">DISCIPLINE RELICS</p>
              <p className="text-white text-base font-bold">{balance}/{RELIC_MAX_BALANCE} available</p>
            </div>
            <Button variant="outline" onClick={() => navigate(createPageUrl('RedeemCodes'))}>
              <Ticket className="w-4 h-4 mr-2" />
              Redeem Code
            </Button>
          </div>
        </HoloPanel>

        {error && (
          <HoloPanel>
            <p className="text-sm text-red-300">{error}</p>
          </HoloPanel>
        )}

        {message && (
          <HoloPanel>
            <p className="text-sm text-emerald-300">{message}</p>
          </HoloPanel>
        )}

        {effects.length > 0 && (
          <HoloPanel>
            <p className="text-xs text-yellow-300 tracking-widest font-black mb-2">ACTIVE EFFECTS</p>
            <div className="space-y-2">
              {effects.map((effect) => (
                <div
                  key={effect.id}
                  className="rounded-lg p-2 border"
                  style={{ borderColor: 'rgba(250,204,21,0.35)', background: 'rgba(146,64,14,0.2)' }}
                >
                  <p className="text-white font-semibold text-sm">{String(effect.effect_type || '').replace(/_/g, ' ').toUpperCase()}</p>
                  <p className="text-xs text-slate-300">
                    Expires: {effect.expires_at ? new Date(effect.expires_at).toLocaleString() : 'No expiry'}
                  </p>
                </div>
              ))}
            </div>
          </HoloPanel>
        )}

        <HoloPanel>
          <p className="text-cyan-300 text-xs tracking-widest font-black mb-3">AVAILABLE RELICS</p>
          {availableRelics.length === 0 ? (
            <p className="text-sm text-slate-400">No available relics. Earn relics through strict milestones or redeem codes.</p>
          ) : (
            <div className="space-y-3">
              {availableRelics.map((relic) => {
                const remainingMs = relicExpiryMs(relic, nowMs);
                const urgent = Number.isFinite(remainingMs) && remainingMs <= 24 * 3600 * 1000;
                const rarity = getRelicRarity(relic);
                const rarityStyle = RARITY_STYLE[rarity] || RARITY_STYLE.rare;
                return (
                  <div
                    key={relic.id}
                    className="rounded-xl p-3 border"
                    style={{
                      borderColor: urgent ? 'rgba(248,113,113,0.5)' : 'rgba(56,189,248,0.35)',
                      background: urgent ? 'rgba(127,29,29,0.18)' : 'rgba(15,23,42,0.45)',
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-white font-bold text-sm flex items-center gap-2 flex-wrap">
                          <Gem className="w-4 h-4 text-cyan-300" />
                          {sourceLabel(relic.source)}
                          <span
                            className="text-[10px] font-black tracking-widest px-1.5 py-0.5 rounded border uppercase"
                            style={{ color: rarityStyle.color, borderColor: `${rarityStyle.color}66`, background: rarityStyle.bg }}
                          >
                            {rarity}
                          </span>
                        </p>
                        <p className="text-xs text-slate-400">Earned: {new Date(relic.earned_at).toLocaleString()}</p>
                        <p className="text-xs" style={{ color: urgent ? '#FCA5A5' : '#67E8F9' }}>
                          Expires in: {formatRelicCountdown(remainingMs)}
                        </p>
                      </div>
                      <Button
                        onClick={() => setRedeemModal({ open: true, relic, action: 'cheat_day', referenceId: '' })}
                      >
                        Redeem
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </HoloPanel>

        {usedRelics.length > 0 && (
          <HoloPanel>
            <p className="text-slate-300 text-xs tracking-widest font-black mb-3">RECENT RELIC HISTORY</p>
            <div className="space-y-2">
              {usedRelics.map((relic) => (
                <div
                  key={relic.id}
                  className="rounded-lg p-2 border"
                  style={{ borderColor: 'rgba(71,85,105,0.45)', background: 'rgba(15,23,42,0.35)' }}
                >
                  <p className="text-sm text-white font-semibold flex items-center gap-2 flex-wrap">
                    {sourceLabel(relic.source)}
                    <span
                      className="text-[10px] font-black tracking-widest px-1.5 py-0.5 rounded border uppercase"
                      style={{
                        color: (RARITY_STYLE[getRelicRarity(relic)] || RARITY_STYLE.rare).color,
                        borderColor: `${(RARITY_STYLE[getRelicRarity(relic)] || RARITY_STYLE.rare).color}66`,
                        background: (RARITY_STYLE[getRelicRarity(relic)] || RARITY_STYLE.rare).bg,
                      }}
                    >
                      {getRelicRarity(relic)}
                    </span>
                  </p>
                  <p className="text-xs text-slate-400">
                    {relic.used ? `Used for ${String(relic.used_for || 'unknown').replace(/_/g, ' ')} at ${new Date(relic.used_at || relic.earned_at).toLocaleString()}` : 'Expired'}
                  </p>
                </div>
              ))}
            </div>
          </HoloPanel>
        )}

        {redeemModal.open && (
          <div className="fixed inset-0 z-[220] flex items-center justify-center p-4" style={{ background: 'rgba(2,6,23,0.86)' }}>
            <div className="w-full max-w-lg rounded-2xl p-5 space-y-4 border border-cyan-500/40 bg-[#081321]">
              <div className="flex items-center justify-between gap-3">
                <p className="text-white font-black tracking-widest text-sm">REDEEM RELIC</p>
                <button
                  type="button"
                  className="text-slate-300 text-sm"
                  onClick={() => setRedeemModal({ open: false, relic: null, action: 'cheat_day', referenceId: '' })}
                >
                  Close
                </button>
              </div>

              <div className="space-y-2">
                {RELIC_ACTIONS.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => setRedeemModal((prev) => ({ ...prev, action: action.id, referenceId: '' }))}
                    className="w-full text-left rounded-lg p-2 border"
                    style={{
                      borderColor: redeemModal.action === action.id ? 'rgba(34,211,238,0.7)' : 'rgba(51,65,85,0.65)',
                      background: redeemModal.action === action.id ? 'rgba(14,116,144,0.25)' : 'rgba(15,23,42,0.5)',
                    }}
                  >
                    <p className="text-sm text-white font-semibold">{action.label}</p>
                    <p className="text-xs text-slate-300">{action.description}</p>
                  </button>
                ))}
              </div>

              {needsPunishmentRef && (
                <div>
                  <p className="text-xs text-slate-300 mb-1">Select pending punishment</p>
                  <select
                    value={redeemModal.referenceId}
                    onChange={(e) => setRedeemModal((prev) => ({ ...prev, referenceId: e.target.value }))}
                    className="w-full rounded-md px-2 py-2 bg-slate-900 border border-slate-700 text-white text-sm"
                  >
                    <option value="">Auto-select first pending</option>
                    {pendingPunishments.map((punish) => (
                      <option key={punish.id} value={punish.id}>
                        {punish.reason || `Punishment ${punish.id.slice(0, 8)}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {needsDungeonRef && (
                <div className="rounded-lg p-2 border border-emerald-500/35 bg-emerald-900/20">
                  <p className="text-xs text-emerald-300">
                    {activeDungeon
                      ? `Active dungeon: ${activeDungeon.challenge_title || activeDungeon.id}`
                      : 'No active dungeon found.'}
                  </p>
                </div>
              )}

              {needsBetRef && (
                <div>
                  <p className="text-xs text-slate-300 mb-1">Optional bet reference ID</p>
                  <input
                    value={redeemModal.referenceId}
                    onChange={(e) => setRedeemModal((prev) => ({ ...prev, referenceId: e.target.value }))}
                    placeholder="UUID (optional if active bet is auto-detected)"
                    className="w-full rounded-md px-2 py-2 bg-slate-900 border border-slate-700 text-white text-sm"
                  />
                </div>
              )}

              {actionBlocked && (
                <div className="rounded-lg p-2 border border-red-500/35 bg-red-900/20">
                  <p className="text-xs text-red-300">
                    {needsPunishmentRef
                      ? 'No pending punishments are available for waiver.'
                      : 'No active dungeon available for revive.'}
                  </p>
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => setRedeemModal({ open: false, relic: null, action: 'cheat_day', referenceId: '' })}
                >
                  Cancel
                </Button>
                <Button
                  disabled={saving || actionBlocked}
                  onClick={confirmRedeem}
                  className="ml-auto"
                >
                  <ShieldCheck className="w-4 h-4 mr-2" />
                  {saving ? 'Redeeming...' : 'Confirm Redeem'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </SystemBackground>
  );
}
