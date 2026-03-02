import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowLeft, Flag, Gem, Plus, Trophy, Users } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import HoloPanel from '@/components/HoloPanel';
import SystemBackground from '@/components/SystemBackground';
import { useAuthedPageUser } from '@/lib/useAuthedPageUser';
import { fetchOwnedParty, fetchPartyForMember, fetchPartyMembers } from '@/lib/dungeonParty';
import { fetchProfilesBasic } from '@/lib/social';
import {
  claimPartyChallengeReward,
  contributePartyChallengeProgress,
  createPartyChallenge,
  fetchPartyChallengeContributions,
  fetchPartyChallengeRewards,
  fetchPartyChallenges,
} from '@/lib/partyChallenges';
import { toastError, toastSuccess } from '@/lib/toast';

const CHALLENGE_STATUS_COLOR = {
  active: '#FBBF24',
  completed: '#34D399',
  expired: '#F87171',
  cancelled: '#94A3B8',
};

const shortId = (id) => {
  const value = String(id || '');
  if (value.length <= 10) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
};

const challengeStatusRank = (status) => {
  const key = String(status || '').toLowerCase();
  if (key === 'active') return 0;
  if (key === 'completed') return 1;
  if (key === 'expired') return 2;
  return 3;
};

export default function PartyChallenges() {
  const navigate = useNavigate();
  const { user, authReady } = useAuthedPageUser();
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');
  const [party, setParty] = useState(null);
  const [members, setMembers] = useState([]);
  const [profilesById, setProfilesById] = useState({});
  const [challenges, setChallenges] = useState([]);
  const [contribByChallenge, setContribByChallenge] = useState({});
  const [rewardByChallenge, setRewardByChallenge] = useState({});
  const [form, setForm] = useState({
    title: '',
    description: '',
    targetTotal: 20,
    xpReward: 120,
    relicReward: 1,
    dueDays: 7,
  });

  const loadData = useCallback(async (userId) => {
    if (!userId) return;
    setLoading(true);
    try {
      const owned = await fetchOwnedParty(userId);
      const joined = owned ? null : await fetchPartyForMember(userId);
      const currentParty = owned || joined || null;

      setParty(currentParty);

      if (!currentParty?.id) {
        setMembers([]);
        setProfilesById({});
        setChallenges([]);
        setContribByChallenge({});
        setRewardByChallenge({});
        return;
      }

      const [memberRows, challengeRows] = await Promise.all([
        fetchPartyMembers(currentParty.id),
        fetchPartyChallenges(currentParty.id),
      ]);

      const safeMembers = Array.isArray(memberRows) ? memberRows.filter(Boolean) : [];
      setMembers(safeMembers);

      const memberIds = safeMembers.map((row) => row.user_id).filter(Boolean);
      if (memberIds.length > 0) {
        const profileRows = await fetchProfilesBasic(memberIds);
        const mapped = {};
        (profileRows || []).forEach((row) => {
          mapped[row.id] = row;
        });
        setProfilesById(mapped);
      } else {
        setProfilesById({});
      }

      const sortedChallenges = [...(challengeRows || [])]
        .filter(Boolean)
        .sort((a, b) => {
          const byStatus = challengeStatusRank(a.status) - challengeStatusRank(b.status);
          if (byStatus !== 0) return byStatus;
          const aTs = new Date(a.created_at || 0).getTime();
          const bTs = new Date(b.created_at || 0).getTime();
          return bTs - aTs;
        });

      setChallenges(sortedChallenges);

      const challengeIds = sortedChallenges.map((row) => row.id).filter(Boolean);
      if (challengeIds.length > 0) {
        const [contribRows, rewardRows] = await Promise.all([
          fetchPartyChallengeContributions(challengeIds),
          fetchPartyChallengeRewards(challengeIds),
        ]);

        const contribMap = {};
        (contribRows || []).forEach((row) => {
          if (!row?.challenge_id) return;
          if (!contribMap[row.challenge_id]) contribMap[row.challenge_id] = [];
          contribMap[row.challenge_id].push(row);
        });
        Object.keys(contribMap).forEach((id) => {
          contribMap[id].sort((a, b) => Number(b.progress || 0) - Number(a.progress || 0));
        });
        setContribByChallenge(contribMap);

        const rewardMap = {};
        (rewardRows || []).forEach((row) => {
          if (!row?.challenge_id || !row?.user_id) return;
          if (!rewardMap[row.challenge_id]) rewardMap[row.challenge_id] = {};
          rewardMap[row.challenge_id][row.user_id] = row;
        });
        setRewardByChallenge(rewardMap);
      } else {
        setContribByChallenge({});
        setRewardByChallenge({});
      }
    } catch (err) {
      toastError(err?.message || 'Failed to load party challenges.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authReady || !user?.id) return;
    void loadData(user.id);
  }, [authReady, user?.id, loadData]);

  const isHost = useMemo(
    () => Boolean(user?.id && party?.host_user_id && party.host_user_id === user.id),
    [party?.host_user_id, user?.id]
  );

  const createChallengeAction = async () => {
    if (!user?.id || !party?.id || !isHost || busyKey) return;
    if (!String(form.title || '').trim()) {
      toastError('Challenge title is required.');
      return;
    }

    setBusyKey('create');
    try {
      const dueDays = Math.max(1, Number(form.dueDays || 7));
      const dueAt = new Date(Date.now() + (dueDays * 86400000)).toISOString();
      await createPartyChallenge({
        userId: user.id,
        partyId: party.id,
        title: form.title,
        description: form.description,
        targetTotal: Math.max(1, Number(form.targetTotal || 20)),
        xpReward: Math.max(0, Number(form.xpReward || 120)),
        relicReward: Math.max(0, Number(form.relicReward || 0)),
        dueAt,
        metadata: { source: 'party_challenges_page' },
      });
      setForm((prev) => ({ ...prev, title: '', description: '' }));
      toastSuccess('Party challenge created.');
      await loadData(user.id);
    } catch (err) {
      toastError(err?.message || 'Failed to create party challenge.');
    } finally {
      setBusyKey('');
    }
  };

  const contributeAction = async (challengeId, delta) => {
    if (!user?.id || !challengeId || busyKey) return;
    setBusyKey(`contrib-${challengeId}-${delta}`);
    try {
      const result = await contributePartyChallengeProgress({ userId: user.id, challengeId, delta });
      if (result?.completed_now) {
        toastSuccess('Challenge completed. Rewards unlocked for the party.');
      }
      await loadData(user.id);
    } catch (err) {
      toastError(err?.message || 'Failed to update challenge progress.');
    } finally {
      setBusyKey('');
    }
  };

  const claimAction = async (challengeId) => {
    if (!user?.id || !challengeId || busyKey) return;
    setBusyKey(`claim-${challengeId}`);
    try {
      const row = await claimPartyChallengeReward({ userId: user.id, challengeId });
      const xp = Math.max(0, Number(row?.xp_awarded || 0));
      const relics = Math.max(0, Number(row?.relics_awarded || 0));
      toastSuccess(`Reward claimed: +${xp} XP${relics > 0 ? ` and +${relics} relic(s)` : ''}.`);
      await loadData(user.id);
    } catch (err) {
      toastError(err?.message || 'Failed to claim challenge reward.');
    } finally {
      setBusyKey('');
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
      <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4">
        <HoloPanel>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate(createPageUrl('Dashboard'))}
              className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(10,25,33,0.8)', border: '1px solid rgba(56,189,248,0.2)' }}
            >
              <ArrowLeft className="w-4 h-4 text-white" />
            </button>
            <div>
              <p className="text-white font-black tracking-widest">PARTY CHALLENGES</p>
              <p className="text-xs text-slate-400">Synchronized team quests with XP + relic rewards</p>
            </div>
          </div>
        </HoloPanel>

        {!party?.id ? (
          <HoloPanel>
            <p className="text-sm text-slate-300">No active party found.</p>
            <p className="text-xs text-slate-500 mt-1">Create or join a party from the Dungeon page first.</p>
            <Button className="mt-3" onClick={() => navigate(createPageUrl('Dungeon'))}>Go to Dungeon</Button>
          </HoloPanel>
        ) : (
          <>
            <HoloPanel>
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <p className="text-white font-bold text-lg">{party.title || 'Collaborative Party'}</p>
                  <p className="text-xs text-slate-400">
                    Status {String(party.status || 'waiting').toUpperCase()} · Members {members.length}/{party.max_members || 4}
                  </p>
                </div>
                <div className="rounded-lg px-3 py-2 border border-cyan-500/30 bg-cyan-950/20 text-xs text-cyan-200 flex items-center gap-2">
                  <Users className="w-3.5 h-3.5" /> Invite code: {party.invite_code || 'N/A'}
                </div>
              </div>
            </HoloPanel>

            {isHost && (
              <HoloPanel>
                <p className="text-xs text-cyan-300 font-black tracking-widest mb-3 flex items-center gap-2">
                  <Plus className="w-3.5 h-3.5" /> CREATE SYNCHRONIZED CHALLENGE
                </p>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-400 tracking-widest">TITLE</Label>
                    <Input
                      value={form.title}
                      onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                      placeholder="e.g. 7 AM Wake-up Chain"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-400 tracking-widest">DESCRIPTION</Label>
                    <Input
                      value={form.description}
                      onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                      placeholder="What exactly each member should do"
                    />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div>
                      <Label className="text-xs text-slate-400 tracking-widest">TARGET</Label>
                      <Input
                        type="number"
                        min={1}
                        value={form.targetTotal}
                        onChange={(e) => setForm((prev) => ({ ...prev, targetTotal: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400 tracking-widest">XP REWARD</Label>
                      <Input
                        type="number"
                        min={0}
                        value={form.xpReward}
                        onChange={(e) => setForm((prev) => ({ ...prev, xpReward: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400 tracking-widest">RELICS</Label>
                      <Input
                        type="number"
                        min={0}
                        value={form.relicReward}
                        onChange={(e) => setForm((prev) => ({ ...prev, relicReward: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400 tracking-widest">DUE (DAYS)</Label>
                      <Input
                        type="number"
                        min={1}
                        value={form.dueDays}
                        onChange={(e) => setForm((prev) => ({ ...prev, dueDays: e.target.value }))}
                      />
                    </div>
                  </div>
                  <Button onClick={createChallengeAction} disabled={busyKey === 'create'}>
                    <Flag className="w-4 h-4 mr-2" /> {busyKey === 'create' ? 'Creating...' : 'Create Challenge'}
                  </Button>
                </div>
              </HoloPanel>
            )}

            <HoloPanel>
              <p className="text-xs text-cyan-300 font-black tracking-widest mb-3">ACTIVE + RECENT CHALLENGES</p>
              {challenges.length === 0 ? (
                <p className="text-sm text-slate-500">No party challenges yet.</p>
              ) : (
                <div className="space-y-3">
                  {challenges.map((challenge) => {
                    const target = Math.max(1, Number(challenge.target_total || 1));
                    const progress = Math.max(0, Number(challenge.progress_total || 0));
                    const pct = Math.min(100, Math.round((progress / target) * 100));
                    const status = String(challenge.status || 'active').toLowerCase();
                    const statusColor = CHALLENGE_STATUS_COLOR[status] || '#94A3B8';
                    const contributions = contribByChallenge[challenge.id] || [];
                    const myReward = rewardByChallenge[challenge.id]?.[user?.id] || null;
                    const dueAt = challenge.due_at ? format(new Date(challenge.due_at), 'MMM d, yyyy HH:mm') : 'No due date';

                    return (
                      <div
                        key={challenge.id}
                        className="rounded-xl p-3 border"
                        style={{ borderColor: 'rgba(56,189,248,0.2)', background: 'rgba(15,23,42,0.45)' }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-white font-bold">{challenge.title}</p>
                            <p className="text-xs text-slate-400">{challenge.description || 'No description'}</p>
                          </div>
                          <span
                            className="text-[10px] font-black tracking-widest px-2 py-1 rounded border"
                            style={{ color: statusColor, borderColor: `${statusColor}66`, background: `${statusColor}1a` }}
                          >
                            {status.toUpperCase()}
                          </span>
                        </div>

                        <div className="mt-3">
                          <div className="flex items-center justify-between text-xs text-slate-300">
                            <p>Progress {progress}/{target}</p>
                            <p>{pct}%</p>
                          </div>
                          <div className="mt-1 h-2 rounded-full bg-slate-800 overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #22D3EE, #34D399)' }}
                            />
                          </div>
                          <p className="text-[11px] text-slate-500 mt-1">Due: {dueAt}</p>
                          <p className="text-[11px] text-amber-300 mt-1">
                            Rewards: +{Math.max(0, Number(challenge.xp_reward || 0))} XP · +{Math.max(0, Number(challenge.relic_reward || 0))} relic(s)
                          </p>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {status === 'active' && (
                            <>
                              <Button
                                size="sm"
                                onClick={() => contributeAction(challenge.id, 1)}
                                disabled={Boolean(busyKey)}
                              >
                                +1 Progress
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => contributeAction(challenge.id, 5)}
                                disabled={Boolean(busyKey)}
                              >
                                +5 Progress
                              </Button>
                            </>
                          )}

                          {myReward && !myReward.claimed && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => claimAction(challenge.id)}
                              disabled={Boolean(busyKey)}
                            >
                              <Trophy className="w-3.5 h-3.5 mr-1" /> Claim Reward
                            </Button>
                          )}

                          {myReward?.claimed && (
                            <span className="px-2 py-1 rounded border border-emerald-500/40 text-emerald-300 text-xs font-bold">
                              Claimed
                            </span>
                          )}
                        </div>

                        {contributions.length > 0 && (
                          <div className="mt-3 space-y-1">
                            {contributions.slice(0, 5).map((row) => {
                              const profile = profilesById[row.user_id];
                              const name = profile?.name || profile?.user_code || shortId(row.user_id);
                              return (
                                <div key={`${challenge.id}-${row.user_id}`} className="flex items-center justify-between text-xs">
                                  <p className="text-slate-300 truncate pr-2">{name}</p>
                                  <p className="text-cyan-300 font-bold">{Math.max(0, Number(row.progress || 0))}</p>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {myReward && (
                          <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-3">
                            <span className="inline-flex items-center gap-1">
                              <Trophy className="w-3 h-3" /> {Math.max(0, Number(myReward.xp_amount || 0))} XP
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Gem className="w-3 h-3" /> {Math.max(0, Number(myReward.relic_amount || 0))} relic(s)
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </HoloPanel>
          </>
        )}
      </div>
    </SystemBackground>
  );
}
