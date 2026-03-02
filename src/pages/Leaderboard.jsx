import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { ArrowLeft, Trophy, Users, UserPlus, RefreshCcw, Check, X, CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import HoloPanel from '@/components/HoloPanel';
import SystemBackground from '@/components/SystemBackground';
import { computeLevel, STAT_KEYS } from '@/components/gameEngine';
import {
  fetchFriendsState,
  normalizeUserCode,
  respondFriendRequestRpc,
  searchProfileByUserCode,
  sendFriendRequestRpc,
} from '@/lib/social';
import { useAuthedPageUser } from '@/lib/useAuthedPageUser';

const SCORE_WEIGHTS = {
  level: 12,
  xp: 0.02,
  stat: 2.5,
};

function computeLeaderboardScore(profile) {
  const level = computeLevel(profile?.total_xp || 0);
  const statSum = STAT_KEYS.reduce((sum, k) => sum + (profile?.[`stat_${k}`] || 0), 0);
  return Math.floor(
    level * SCORE_WEIGHTS.level +
    (profile?.total_xp || 0) * SCORE_WEIGHTS.xp +
    statSum * SCORE_WEIGHTS.stat
  );
}

const formatHunterName = (profile, fallback = 'Unknown Hunter') => {
  if (!profile) return fallback;
  return profile.name || (profile.user_code ? `@${profile.user_code}` : profile.email) || fallback;
};

const formatHunterCode = (profile) => {
  if (profile?.user_code) return `@${profile.user_code}`;
  if (profile?.id) {
    return `ID ${String(profile.id)}`;
  }
  return 'ID unavailable';
};

const derivePublicUsernameFromProfile = (profile) => {
  const base = (profile?.user_code || '').toString().trim().toLowerCase();
  if (!base) return '';
  return base.replace(/[^a-z0-9_]+/g, '-').replace(/^-+|-+$/g, '');
};

function LeaderboardTable({ rows, currentUserId, usernameByUserId, profileById, onOpenProfile }) {
  if (!rows.length) {
    return (
      <div className="text-center py-8 text-sm" style={{ color: '#64748B' }}>
        No entries found.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row, idx) => {
        const level = Number(row?.level_override ?? computeLevel(row.total_xp || 0));
        const mine = row.id === currentUserId;
        const placeColor = idx === 0 ? '#FBBF24' : idx === 1 ? '#94A3B8' : idx === 2 ? '#FB923C' : '#64748B';
        const canonical = profileById?.[row.id] || row;
        const username = usernameByUserId[row.id] || derivePublicUsernameFromProfile(canonical);
        const canOpen = Boolean(username);
        return (
          <div
            key={row.id}
            className="rounded-xl p-3 flex items-center gap-3"
            role={canOpen ? 'button' : undefined}
            tabIndex={canOpen ? 0 : undefined}
            onClick={canOpen ? () => onOpenProfile(username) : undefined}
            onKeyDown={canOpen ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpenProfile(username);
              }
            } : undefined}
            style={{
              background: mine ? 'rgba(56,189,248,0.12)' : 'rgba(15,32,39,0.6)',
              border: `1px solid ${mine ? 'rgba(56,189,248,0.5)' : 'rgba(56,189,248,0.15)'}`,
              cursor: canOpen ? 'pointer' : 'default',
            }}
          >
            <div className="w-8 text-center font-black" style={{ color: placeColor }}>
              #{idx + 1}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-white truncate">{formatHunterName(canonical)}</p>
              <p className="text-xs break-all" style={{ color: '#64748B' }}>
                {formatHunterCode(canonical)} · Lv. {level} · {(row.total_xp || 0).toLocaleString()} XP
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-black" style={{ color: '#38BDF8' }}>{row.score.toLocaleString()}</p>
              <p className="text-[10px] tracking-widest" style={{ color: '#475569' }}>POWER</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Leaderboard() {
  const navigate = useNavigate();
  const { user, authReady } = useAuthedPageUser();
  const [currentProfile, setCurrentProfile] = useState(null);
  const [profileDirectory, setProfileDirectory] = useState({});
  const [usernameByUserId, setUsernameByUserId] = useState({});
  const [globalRows, setGlobalRows] = useState([]);
  const [weeklyRows, setWeeklyRows] = useState([]);
  const [friendRows, setFriendRows] = useState([]);
  const [incomingRequests, setIncomingRequests] = useState([]);
  const [sentRequests, setSentRequests] = useState([]);
  const [searchUserCode, setSearchUserCode] = useState('');
  const [statusText, setStatusText] = useState('');
  const [activeTab, setActiveTab] = useState('global');
  const [loading, setLoading] = useState(true);
  const [friendsFeatureEnabled, setFriendsFeatureEnabled] = useState(true);
  const [respondingRequestId, setRespondingRequestId] = useState('');

  const hydrateRows = useCallback((profiles) => {
    return (profiles || [])
      .map((p) => ({ ...p, score: computeLeaderboardScore(p) }))
      .sort((a, b) => b.score - a.score);
  }, []);

  const loadData = useCallback(async (userId) => {
    setLoading(true);
    setStatusText('');
    try {
      const { data: globalProfiles, error: globalError } = await supabase
        .from('profiles')
        .select('*')
        .order('total_xp', { ascending: false })
        .limit(100);
      if (globalError) throw globalError;

      const allProfiles = globalProfiles || [];
      setGlobalRows(hydrateRows(allProfiles));
      const { data: weeklyData, error: weeklyError } = await supabase.rpc('get_weekly_leaderboard', { p_limit: 100 });
      if (weeklyError) {
        setWeeklyRows([]);
      } else {
        const normalizedWeekly = (weeklyData || []).map((row) => ({
          id: row.user_id,
          name: row.name,
          total_xp: Number(row.total_weekly_xp || 0),
          score: Number(row.total_weekly_xp || 0),
          level_override: Number(row.level || 0),
          week_rank: Number(row.rank_position || 0),
        }));
        setWeeklyRows(normalizedWeekly);
      }
      const me = allProfiles.find((p) => p.id === userId) || null;
      setCurrentProfile(me);

      const directorySeed = {};
      for (const profile of allProfiles) {
        directorySeed[profile.id] = profile;
      }
      const seedIds = new Set(allProfiles.map((p) => p.id).filter(Boolean));
      for (const weeklyRow of weeklyData || []) {
        if (!weeklyRow?.user_id) continue;
        seedIds.add(weeklyRow.user_id);
        if (!directorySeed[weeklyRow.user_id]) {
          directorySeed[weeklyRow.user_id] = {
            id: weeklyRow.user_id,
            name: weeklyRow.name,
            total_xp: 0,
          };
        }
      }

      try {
        const friendState = await fetchFriendsState(userId);
        setFriendsFeatureEnabled(true);
        const incoming = (friendState.incoming || []).map((row) => ({
          id: `${row.user_id}:${row.friend_user_id}`,
          requester_id: row.user_id,
          receiver_id: row.friend_user_id,
          status: row.status,
        }));
        const sent = (friendState.outgoing || []).map((row) => ({
          id: `${row.user_id}:${row.friend_user_id}`,
          requester_id: row.user_id,
          receiver_id: row.friend_user_id,
          status: row.status,
        }));
        setIncomingRequests(incoming);
        setSentRequests(sent);

        for (const [id, p] of Object.entries(friendState.profilesById || {})) {
          if (!directorySeed[id]) directorySeed[id] = p;
          seedIds.add(id);
        }
        setProfileDirectory({ ...directorySeed });

        const friendIds = Array.from(new Set((friendState.accepted || []).map((r) => r.friend_user_id)));
        const ids = Array.from(new Set([userId, ...friendIds]));
        const { data: friendsProfiles, error: friendsError } = await supabase
          .from('profiles')
          .select('*')
          .in('id', ids);
        if (!friendsError) {
          for (const fp of friendsProfiles || []) {
            directorySeed[fp.id] = fp;
            seedIds.add(fp.id);
          }
          setProfileDirectory({ ...directorySeed });
          setFriendRows(hydrateRows(friendsProfiles));
        }
      } catch (_friendErr) {
        setFriendsFeatureEnabled(false);
        setIncomingRequests([]);
        setSentRequests([]);
        setFriendRows([]);
        setProfileDirectory(directorySeed);
      }

      try {
        const idsForIdentity = Array.from(seedIds).filter(Boolean);
        if (idsForIdentity.length > 0) {
          const { data: identityProfiles, error: identityError } = await supabase
            .from('profiles')
            .select('id,name,user_code,email,total_xp')
            .in('id', idsForIdentity);
          if (!identityError) {
            for (const entry of identityProfiles || []) {
              directorySeed[entry.id] = {
                ...(directorySeed[entry.id] || {}),
                ...entry,
              };
            }
            setProfileDirectory({ ...directorySeed });
          }
        }
      } catch (_) {
        // Best-effort identity enrichment for weekly/global ID display.
      }

      try {
        const ids = Array.from(seedIds).filter(Boolean);
        if (!ids.length) {
          setUsernameByUserId({});
        } else {
          const { data: publicProfiles, error: publicProfilesError } = await supabase
            .from('public_profiles')
            .select('user_id,username')
            .in('user_id', ids);
          if (publicProfilesError) throw publicProfilesError;

          const usernames = {};
          for (const row of publicProfiles || []) {
            if (row?.user_id && row?.username) usernames[row.user_id] = row.username;
          }
          setUsernameByUserId(usernames);
        }
      } catch (_) {
        setUsernameByUserId({});
      }
    } finally {
      setLoading(false);
    }
  }, [hydrateRows]);

  useEffect(() => {
    if (!authReady || !user?.id) return;
    void loadData(user.id);
  }, [authReady, loadData, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    const iv = setInterval(() => {
      void loadData(user.id);
    }, 30000);
    return () => clearInterval(iv);
  }, [loadData, user?.id]);

  const sendFriendRequest = async () => {
    if (!friendsFeatureEnabled) {
      setStatusText('Friends feature is not enabled in database yet.');
      return;
    }
    if (!user?.id || !searchUserCode.trim()) return;
    setStatusText('');

    const targetCode = normalizeUserCode(searchUserCode);
    const myCode = normalizeUserCode(currentProfile?.user_code);
    if (!targetCode) {
      setStatusText('Enter a valid User ID.');
      return;
    }
    if (myCode && targetCode === myCode) {
      setStatusText('You cannot add yourself.');
      return;
    }

    let targetProfile = null;
    try {
      targetProfile = await searchProfileByUserCode(targetCode);
    } catch (_) {
      setStatusText('User lookup failed.');
      return;
    }

    if (!targetProfile?.id) {
      setStatusText('User not found for that User ID.');
      return;
    }

    if (targetProfile.id === user.id) {
      setStatusText('You cannot add yourself.');
      return;
    }

    try {
      const row = await sendFriendRequestRpc({ userId: user.id, friendUserId: targetProfile.id });
      if (row?.status === 'accepted') {
        setStatusText(`Friend connected with ${formatHunterName(targetProfile)}.`);
      } else {
        setStatusText(`Friend request sent to ${formatHunterName(targetProfile)}.`);
      }
      setSearchUserCode('');
      await loadData(user.id);
    } catch (err) {
      setStatusText(err?.message || 'Failed to send request.');
      return;
    }
  };

  const respondRequest = async (requesterId, action) => {
    if (!user?.id) return;
    const reqKey = `${requesterId}:${action}`;
    if (respondingRequestId) return;
    setRespondingRequestId(reqKey);
    try {
      const mapped = action === 'accepted' ? 'accepted' : 'declined';
      await respondFriendRequestRpc({
        userId: user.id,
        friendUserId: requesterId,
        action: mapped,
      });
      setStatusText(mapped === 'accepted' ? 'Friend request accepted.' : 'Friend request rejected.');
      await loadData(user.id);
    } catch (err) {
      setStatusText(err?.message || 'Failed to update request.');
    } finally {
      setRespondingRequestId('');
    }
  };

  const tabs = useMemo(() => ([
    { id: 'global', label: 'GLOBAL' },
    { id: 'weekly', label: 'WEEKLY' },
    { id: 'friends', label: 'FRIENDS' },
    { id: 'requests', label: `REQUESTS (${incomingRequests.length})` },
  ]), [incomingRequests.length]);

  const handleBack = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate(createPageUrl('Dashboard'));
  }, [navigate]);

  const openPublicProfile = useCallback((username) => {
    if (!username) return;
    navigate(`/profile/${encodeURIComponent(username)}`);
  }, [navigate]);

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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={handleBack}
                className="w-9 h-9 rounded-lg flex items-center justify-center"
                style={{ background: 'rgba(10,25,33,0.8)', border: '1px solid rgba(56,189,248,0.2)' }}
              >
                <ArrowLeft className="w-4 h-4 text-white" />
              </button>
              <div>
                <p className="text-white font-black tracking-widest">LEADERBOARD</p>
                <p className="text-xs" style={{ color: '#64748B' }}>Global and Friends ranking</p>
              </div>
            </div>
            <Button onClick={() => user?.id && loadData(user.id)} variant="outline" className="gap-2">
              <RefreshCcw className="w-4 h-4" /> Refresh
            </Button>
          </div>
        </HoloPanel>

        <HoloPanel>
          <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'rgba(15,32,39,0.7)', border: '1px solid #1e3a4a' }}>
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className="flex-1 py-2 rounded-lg text-xs font-bold tracking-widest transition-all"
                style={{
                  background: activeTab === t.id ? 'rgba(56,189,248,0.15)' : 'transparent',
                  color: activeTab === t.id ? '#38BDF8' : '#64748B',
                  border: activeTab === t.id ? '1px solid rgba(56,189,248,0.3)' : '1px solid transparent',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </HoloPanel>

        {activeTab === 'global' && (
          <HoloPanel>
            <p className="text-xs font-bold tracking-widest mb-3 flex items-center gap-2" style={{ color: '#FBBF24' }}>
              <Trophy className="w-3.5 h-3.5" /> GLOBAL HUNTERS
            </p>
            <LeaderboardTable
              rows={globalRows}
              currentUserId={user?.id}
              usernameByUserId={usernameByUserId}
              profileById={profileDirectory}
              onOpenProfile={openPublicProfile}
            />
          </HoloPanel>
        )}

        {activeTab === 'weekly' && (
          <HoloPanel>
            <p className="text-xs font-bold tracking-widest mb-3 flex items-center gap-2" style={{ color: '#F97316' }}>
              <CalendarDays className="w-3.5 h-3.5" /> WEEKLY XP LEADERBOARD
            </p>
            <LeaderboardTable
              rows={weeklyRows}
              currentUserId={user?.id}
              usernameByUserId={usernameByUserId}
              profileById={profileDirectory}
              onOpenProfile={openPublicProfile}
            />
          </HoloPanel>
        )}

        {activeTab === 'friends' && (
          <HoloPanel>
            <p className="text-xs font-bold tracking-widest mb-3 flex items-center gap-2" style={{ color: '#38BDF8' }}>
              <Users className="w-3.5 h-3.5" /> FRIEND LEADERBOARD
            </p>
            {!friendsFeatureEnabled ? (
              <p className="text-sm" style={{ color: '#64748B' }}>Friends feature requires `friends` RPC migration setup in Supabase.</p>
            ) : (
              <LeaderboardTable
                rows={friendRows}
                currentUserId={user?.id}
                usernameByUserId={usernameByUserId}
                profileById={profileDirectory}
                onOpenProfile={openPublicProfile}
              />
            )}
          </HoloPanel>
        )}

        {activeTab === 'requests' && (
          <HoloPanel>
            <p className="text-xs font-bold tracking-widest mb-3 flex items-center gap-2" style={{ color: '#38BDF8' }}>
              <UserPlus className="w-3.5 h-3.5" /> FRIEND REQUESTS
            </p>

            <div className="flex gap-2 mb-4">
              <Input
                value={searchUserCode}
                onChange={(e) => setSearchUserCode(e.target.value.toUpperCase())}
                placeholder="Friend User ID"
                className="bg-slate-900/70 border-slate-700 text-white"
              />
              <Button onClick={sendFriendRequest}>Send</Button>
            </div>
            {statusText && <p className="text-xs mb-3" style={{ color: '#94A3B8' }}>{statusText}</p>}

            <div className="space-y-2 mb-4">
              <p className="text-[10px] tracking-widest font-bold" style={{ color: '#64748B' }}>INCOMING</p>
              {incomingRequests.length === 0 ? (
                <p className="text-sm" style={{ color: '#64748B' }}>No incoming requests.</p>
              ) : incomingRequests.map((r) => {
                const requester = profileDirectory[r.requester_id];
                return (
                  <div key={r.id} className="rounded-lg p-2 flex items-center justify-between" style={{ background: 'rgba(15,32,39,0.6)', border: '1px solid rgba(56,189,248,0.2)' }}>
                    <p className="text-sm text-white truncate">
                      {formatHunterName(requester, r.requester_id)} <span className="text-xs text-slate-400">{formatHunterCode(requester)}</span>
                    </p>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => respondRequest(r.requester_id, 'accepted')}
                        disabled={Boolean(respondingRequestId)}
                        className="px-2 py-1 rounded text-xs font-bold disabled:opacity-60 disabled:cursor-not-allowed"
                        style={{ color: '#34D399', border: '1px solid rgba(52,211,153,0.4)' }}
                      >
                        <Check className="w-3 h-3 inline mr-1" /> {respondingRequestId === `${r.requester_id}:accepted` ? '...' : 'Accept'}
                      </button>
                      <button
                        type="button"
                        onClick={() => respondRequest(r.requester_id, 'declined')}
                        disabled={Boolean(respondingRequestId)}
                        className="px-2 py-1 rounded text-xs font-bold disabled:opacity-60 disabled:cursor-not-allowed"
                        style={{ color: '#F87171', border: '1px solid rgba(248,113,113,0.4)' }}
                      >
                        <X className="w-3 h-3 inline mr-1" /> {respondingRequestId === `${r.requester_id}:declined` ? '...' : 'Reject'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="space-y-2">
              <p className="text-[10px] tracking-widest font-bold" style={{ color: '#64748B' }}>SENT</p>
              {sentRequests.length === 0 ? (
                <p className="text-sm" style={{ color: '#64748B' }}>No pending sent requests.</p>
              ) : sentRequests.map((r) => {
                const receiver = profileDirectory[r.receiver_id];
                return (
                  <div key={r.id} className="rounded-lg p-2 flex items-center justify-between" style={{ background: 'rgba(15,32,39,0.6)', border: '1px solid rgba(56,189,248,0.2)' }}>
                    <p className="text-sm text-white truncate">
                      {formatHunterName(receiver, r.receiver_id)} <span className="text-xs text-slate-400">{formatHunterCode(receiver)}</span>
                    </p>
                    <span className="text-xs font-bold" style={{ color: '#38BDF8' }}>PENDING</span>
                  </div>
                );
              })}
            </div>
          </HoloPanel>
        )}
      </div>
    </SystemBackground>
  );
}


