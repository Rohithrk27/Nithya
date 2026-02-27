import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { ArrowLeft, Trophy, Users, UserPlus, RefreshCcw, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import HoloPanel from '@/components/HoloPanel';
import SystemBackground from '@/components/SystemBackground';
import { computeLevel, STAT_KEYS } from '@/components/gameEngine';

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
  if (!profile?.user_code) return 'No User ID';
  return `@${profile.user_code}`;
};

function LeaderboardTable({ rows, currentUserId }) {
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
        const level = computeLevel(row.total_xp || 0);
        const mine = row.id === currentUserId;
        const placeColor = idx === 0 ? '#FBBF24' : idx === 1 ? '#94A3B8' : idx === 2 ? '#FB923C' : '#64748B';
        return (
          <div
            key={row.id}
            className="rounded-xl p-3 flex items-center gap-3"
            style={{
              background: mine ? 'rgba(56,189,248,0.12)' : 'rgba(15,32,39,0.6)',
              border: `1px solid ${mine ? 'rgba(56,189,248,0.5)' : 'rgba(56,189,248,0.15)'}`,
            }}
          >
            <div className="w-8 text-center font-black" style={{ color: placeColor }}>
              #{idx + 1}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-white truncate">{formatHunterName(row)}</p>
              <p className="text-xs" style={{ color: '#64748B' }}>
                {formatHunterCode(row)} · Lv. {level} · {(row.total_xp || 0).toLocaleString()} XP
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
  const [user, setUser] = useState(null);
  const [currentProfile, setCurrentProfile] = useState(null);
  const [profileDirectory, setProfileDirectory] = useState({});
  const [globalRows, setGlobalRows] = useState([]);
  const [friendRows, setFriendRows] = useState([]);
  const [incomingRequests, setIncomingRequests] = useState([]);
  const [sentRequests, setSentRequests] = useState([]);
  const [searchUserCode, setSearchUserCode] = useState('');
  const [statusText, setStatusText] = useState('');
  const [activeTab, setActiveTab] = useState('global');
  const [loading, setLoading] = useState(true);
  const [friendsFeatureEnabled, setFriendsFeatureEnabled] = useState(true);

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
      const me = allProfiles.find((p) => p.id === userId) || null;
      setCurrentProfile(me);

      const directorySeed = {};
      for (const profile of allProfiles) {
        directorySeed[profile.id] = profile;
      }

      const { data: requests, error: reqError } = await supabase
        .from('friend_requests')
        .select('*')
        .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`);

      if (reqError) {
        setFriendsFeatureEnabled(false);
        setIncomingRequests([]);
        setSentRequests([]);
        setFriendRows([]);
        setProfileDirectory(directorySeed);
      } else {
        setFriendsFeatureEnabled(true);
        const incoming = (requests || []).filter((r) => r.receiver_id === userId && r.status === 'pending');
        const sent = (requests || []).filter((r) => r.requester_id === userId && r.status === 'pending');
        setIncomingRequests(incoming);
        setSentRequests(sent);

        const relatedIds = Array.from(new Set((requests || []).flatMap((r) => [r.requester_id, r.receiver_id])));
        const idsToFetch = relatedIds.filter((id) => !directorySeed[id]);
        if (idsToFetch.length > 0) {
          const { data: relatedProfiles } = await supabase
            .from('profiles')
            .select('*')
            .in('id', idsToFetch);
          for (const rp of relatedProfiles || []) {
            directorySeed[rp.id] = rp;
          }
        }
        setProfileDirectory(directorySeed);

        const accepted = (requests || []).filter((r) => r.status === 'accepted');
        const friendIds = Array.from(
          new Set(
            accepted.map((r) => (r.requester_id === userId ? r.receiver_id : r.requester_id))
          )
        );
        const ids = Array.from(new Set([userId, ...friendIds]));
        const { data: friendsProfiles, error: friendsError } = await supabase
          .from('profiles')
          .select('*')
          .in('id', ids);
        if (!friendsError) {
          for (const fp of friendsProfiles || []) {
            directorySeed[fp.id] = fp;
          }
          setProfileDirectory({ ...directorySeed });
          setFriendRows(hydrateRows(friendsProfiles));
        }
      }
    } finally {
      setLoading(false);
    }
  }, [hydrateRows]);

  useEffect(() => {
    const init = async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        navigate(createPageUrl('Landing'));
        return;
      }
      setUser(authUser);
      await loadData(authUser.id);
    };
    void init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session?.user) {
        navigate(createPageUrl('Landing'));
        return;
      }
      setUser(session.user);
      await loadData(session.user.id);
    });
    return () => subscription.unsubscribe();
  }, [loadData, navigate]);

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

    const targetCode = searchUserCode.trim().toUpperCase();
    const myCode = currentProfile?.user_code?.toUpperCase();
    if (myCode && targetCode === myCode) {
      setStatusText('You cannot add yourself.');
      return;
    }

    const { data: targetProfile } = await supabase
      .from('profiles')
      .select('id,name,email,user_code')
      .eq('user_code', targetCode)
      .maybeSingle();

    if (!targetProfile?.id) {
      setStatusText('User not found for that User ID.');
      return;
    }

    if (targetProfile.id === user.id) {
      setStatusText('You cannot add yourself.');
      return;
    }

    const { data: existing } = await supabase
      .from('friend_requests')
      .select('id,status,requester_id,receiver_id')
      .or(`and(requester_id.eq.${user.id},receiver_id.eq.${targetProfile.id}),and(requester_id.eq.${targetProfile.id},receiver_id.eq.${user.id})`)
      .limit(1);

    if (existing?.length) {
      setStatusText(`Request already exists (${existing[0].status}).`);
      return;
    }

    const { error } = await supabase.from('friend_requests').insert({
      requester_id: user.id,
      receiver_id: targetProfile.id,
      status: 'pending',
    });
    if (error) {
      setStatusText('Failed to send request.');
      return;
    }
    setStatusText(`Friend request sent to ${formatHunterName(targetProfile)}.`);
    setSearchUserCode('');
    await loadData(user.id);
  };

  const respondRequest = async (requestId, action) => {
    if (!user?.id) return;
    await supabase
      .from('friend_requests')
      .update({ status: action })
      .eq('id', requestId)
      .eq('receiver_id', user.id);
    await loadData(user.id);
  };

  const tabs = useMemo(() => ([
    { id: 'global', label: 'GLOBAL' },
    { id: 'friends', label: 'FRIENDS' },
    { id: 'requests', label: `REQUESTS (${incomingRequests.length})` },
  ]), [incomingRequests.length]);

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
                onClick={() => navigate(createPageUrl('Dashboard'))}
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
            <LeaderboardTable rows={globalRows} currentUserId={user?.id} />
          </HoloPanel>
        )}

        {activeTab === 'friends' && (
          <HoloPanel>
            <p className="text-xs font-bold tracking-widest mb-3 flex items-center gap-2" style={{ color: '#38BDF8' }}>
              <Users className="w-3.5 h-3.5" /> FRIEND LEADERBOARD
            </p>
            {!friendsFeatureEnabled ? (
              <p className="text-sm" style={{ color: '#64748B' }}>Friends feature requires `friend_requests` table setup in Supabase.</p>
            ) : (
              <LeaderboardTable rows={friendRows} currentUserId={user?.id} />
            )}
          </HoloPanel>
        )}

        {activeTab === 'requests' && (
          <HoloPanel>
            <p className="text-xs font-bold tracking-widest mb-3 flex items-center gap-2" style={{ color: '#A78BFA' }}>
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
                      <button onClick={() => respondRequest(r.id, 'accepted')} className="px-2 py-1 rounded text-xs font-bold" style={{ color: '#34D399', border: '1px solid rgba(52,211,153,0.4)' }}>
                        <Check className="w-3 h-3 inline mr-1" /> Accept
                      </button>
                      <button onClick={() => respondRequest(r.id, 'rejected')} className="px-2 py-1 rounded text-xs font-bold" style={{ color: '#F87171', border: '1px solid rgba(248,113,113,0.4)' }}>
                        <X className="w-3 h-3 inline mr-1" /> Reject
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
                  <div key={r.id} className="rounded-lg p-2 flex items-center justify-between" style={{ background: 'rgba(15,32,39,0.6)', border: '1px solid rgba(167,139,250,0.2)' }}>
                    <p className="text-sm text-white truncate">
                      {formatHunterName(receiver, r.receiver_id)} <span className="text-xs text-slate-400">{formatHunterCode(receiver)}</span>
                    </p>
                    <span className="text-xs font-bold" style={{ color: '#A78BFA' }}>PENDING</span>
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
