import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Megaphone,
  Shield,
  Swords,
  Users,
  Gem,
  ClipboardList,
  MessageSquare,
  RefreshCcw,
  Ban,
  Trash2,
  Send,
  Copy,
  Search,
  Sparkles,
  Receipt,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import SystemBackground from '@/components/SystemBackground';
import HoloPanel from '@/components/HoloPanel';
import {
  adminCreateAnnouncement,
  adminCreateChallenge,
  adminCreateRelicType,
  adminDeleteUser,
  adminGrantRelic,
  adminListActivityLogs,
  adminListCommunitySubmissions,
  adminListUsers,
  adminListPaymentVerifications,
  adminLogout,
  adminRemoveRelic,
  adminReplyCommunitySubmission,
  adminUpdatePaymentVerification,
  adminSetUserSuspension,
  adminValidateSession,
  fetchRelicTypes,
  getAdminSessionToken,
} from '@/lib/admin';

const PUNISHMENT_TYPES = ['xp_deduction', 'streak_reset', 'relic_loss'];
const RARITIES = ['common', 'rare', 'epic', 'legendary'];
const PAYMENT_STATUSES = ['pending', 'reviewed', 'verified', 'rejected'];
const getErrorMessage = (value, fallback) => value?.message || fallback;
const asText = (value) => String(value || '').trim();
const toLower = (value) => asText(value).toLowerCase();
const formatDateTime = (value) => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
};

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [sessionReady, setSessionReady] = useState(false);
  const [adminName, setAdminName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const [users, setUsers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [paymentRequests, setPaymentRequests] = useState([]);
  const [submissionStatusFilter, setSubmissionStatusFilter] = useState('');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('pending');
  const [relicTypes, setRelicTypes] = useState([]);
  const [userSearch, setUserSearch] = useState('');
  const [showSuspendedOnly, setShowSuspendedOnly] = useState(false);
  const [logTypeFilter, setLogTypeFilter] = useState('');
  const [logSearch, setLogSearch] = useState('');
  const [lastRefreshAt, setLastRefreshAt] = useState(null);

  const [challengeForm, setChallengeForm] = useState({
    targetUserId: '',
    title: '',
    description: '',
    xpReward: 120,
    relicReward: 0,
    deadline: '',
    punishmentType: 'xp_deduction',
    punishmentValue: 40,
  });
  const [announcementForm, setAnnouncementForm] = useState({
    title: '',
    message: '',
    expiresAt: '',
  });
  const [relicTypeForm, setRelicTypeForm] = useState({
    code: '',
    name: '',
    description: '',
    rarity: 'common',
    effectType: '',
  });
  const [grantRelicForm, setGrantRelicForm] = useState({
    userId: '',
    relicTypeId: '',
    rarity: 'rare',
    count: 1,
    source: 'admin_grant',
    label: '',
  });
  const [removeRelicId, setRemoveRelicId] = useState('');
  const [replyDrafts, setReplyDrafts] = useState({});
  const [paymentDrafts, setPaymentDrafts] = useState({});

  const sessionToken = useMemo(() => getAdminSessionToken(), []);
  const filteredUsers = useMemo(() => {
    const q = toLower(userSearch);
    return users.filter((row) => {
      if (showSuspendedOnly && !row?.is_suspended) return false;
      if (!q) return true;
      const haystack = [
        row?.name,
        row?.email,
        row?.user_id,
      ].map(toLower).join(' ');
      return haystack.includes(q);
    });
  }, [showSuspendedOnly, userSearch, users]);
  const filteredLogs = useMemo(() => {
    const q = toLower(logSearch);
    return logs.filter((row) => {
      if (logTypeFilter && row?.type !== logTypeFilter) return false;
      if (!q) return true;
      const haystack = [
        row?.type,
        row?.user_name,
        row?.user_id,
        JSON.stringify(row?.metadata || {}),
      ].map(toLower).join(' ');
      return haystack.includes(q);
    });
  }, [logSearch, logTypeFilter, logs]);
  const summaryStats = useMemo(() => {
    const suspended = users.filter((row) => row?.is_suspended).length;
    const pendingSubmissions = submissions.filter((row) => row?.status === 'pending').length;
    const pendingPayments = paymentRequests.filter((row) => row?.status === 'pending').length;
    return {
      totalUsers: users.length,
      suspendedUsers: suspended,
      activeUsers: Math.max(0, users.length - suspended),
      pendingSubmissions,
      pendingPayments,
    };
  }, [users, submissions, paymentRequests]);

  const loadAdminData = async () => {
    const token = getAdminSessionToken();
    if (!token) {
      navigate('/login', { replace: true });
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [u, l, s, r, pv] = await Promise.allSettled([
        adminListUsers({ sessionToken: token, limit: 300 }),
        adminListActivityLogs({ sessionToken: token, limit: 250 }),
        adminListCommunitySubmissions({ sessionToken: token, status: submissionStatusFilter }),
        fetchRelicTypes(),
        adminListPaymentVerifications({ sessionToken: token, status: paymentStatusFilter, limit: 250 }),
      ]);

      const messages = [];

      if (u.status === 'fulfilled') {
        setUsers(u.value || []);
      } else {
        setUsers([]);
        messages.push(`Users: ${getErrorMessage(u.reason, 'failed to load')}`);
      }

      if (l.status === 'fulfilled') {
        setLogs(l.value || []);
      } else {
        setLogs([]);
        messages.push(`Logs: ${getErrorMessage(l.reason, 'failed to load')}`);
      }

      if (s.status === 'fulfilled') {
        setSubmissions(s.value || []);
      } else {
        setSubmissions([]);
        messages.push(`Community: ${getErrorMessage(s.reason, 'failed to load')}`);
      }

      if (r.status === 'fulfilled') {
        setRelicTypes(r.value || []);
      } else {
        setRelicTypes([]);
        messages.push(`Relics: ${getErrorMessage(r.reason, 'failed to load')}`);
      }

      if (pv.status === 'fulfilled') {
        setPaymentRequests(pv.value || []);
      } else {
        setPaymentRequests([]);
        messages.push(`Payments: ${getErrorMessage(pv.reason, 'failed to load')}`);
      }

      if (messages.length > 0) {
        setError(messages.join(' | '));
      }
      setLastRefreshAt(new Date());
    } catch (err) {
      setError(err?.message || 'Failed to load admin data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      const token = getAdminSessionToken();
      if (!token) {
        navigate('/login', { replace: true });
        return;
      }
      try {
        const check = await adminValidateSession(token);
        if (!check?.is_valid) {
          await adminLogout(token);
          navigate('/login', { replace: true });
          return;
        }
        setAdminName(check.username || 'admin');
        setSessionReady(true);
      } catch (_) {
        await adminLogout(token);
        navigate('/login', { replace: true });
      }
    };
    void init();
  }, [navigate, sessionToken]);

  useEffect(() => {
    if (!sessionReady) return;
    void loadAdminData();
  }, [sessionReady, submissionStatusFilter, paymentStatusFilter]);

  const refresh = async () => {
    setInfo('');
    await loadAdminData();
  };

  const logoutAdmin = async () => {
    await adminLogout(getAdminSessionToken());
    navigate('/login', { replace: true });
  };

  const handleSuspend = async (userId, suspended) => {
    setError('');
    setInfo('');
    try {
      await adminSetUserSuspension({ userId, suspended });
      setInfo(`User ${suspended ? 'suspended' : 'unsuspended'}.`);
      await loadAdminData();
    } catch (err) {
      setError(err?.message || 'Failed to update suspension.');
    }
  };

  const handleDeleteUser = async (userId) => {
    setError('');
    setInfo('');
    try {
      const ok = await adminDeleteUser({ userId });
      setInfo(ok ? 'User deleted.' : 'User not found.');
      await loadAdminData();
    } catch (err) {
      setError(err?.message || 'Failed to delete user.');
    }
  };

  const handleCreateChallenge = async () => {
    setError('');
    setInfo('');
    try {
      const row = await adminCreateChallenge({
        targetUserId: challengeForm.targetUserId.trim() || null,
        title: challengeForm.title,
        description: challengeForm.description,
        xpReward: Number(challengeForm.xpReward || 0),
        relicReward: Number(challengeForm.relicReward || 0),
        deadline: challengeForm.deadline ? new Date(challengeForm.deadline).toISOString() : null,
        punishmentType: challengeForm.punishmentType,
        punishmentValue: Number(challengeForm.punishmentValue || 0),
      });
      setInfo(`Challenge created (${row?.quest_id || 'unknown quest id'}).`);
      setChallengeForm((prev) => ({ ...prev, title: '', description: '' }));
      await loadAdminData();
    } catch (err) {
      setError(err?.message || 'Failed to create challenge.');
    }
  };

  const handleCreateRelicType = async () => {
    setError('');
    setInfo('');
    try {
      const id = await adminCreateRelicType({
        code: relicTypeForm.code,
        name: relicTypeForm.name,
        description: relicTypeForm.description,
        rarity: relicTypeForm.rarity,
        effectType: relicTypeForm.effectType,
      });
      setInfo(`Relic type saved (${id}).`);
      setRelicTypeForm({ code: '', name: '', description: '', rarity: 'common', effectType: '' });
      await loadAdminData();
    } catch (err) {
      setError(err?.message || 'Failed to create relic type.');
    }
  };

  const handleGrantRelic = async () => {
    setError('');
    setInfo('');
    try {
      const count = await adminGrantRelic({
        userId: grantRelicForm.userId.trim(),
        relicTypeId: grantRelicForm.relicTypeId || null,
        rarity: grantRelicForm.rarity,
        count: Number(grantRelicForm.count || 1),
        source: grantRelicForm.source || 'admin_grant',
        label: grantRelicForm.label || '',
      });
      setInfo(`Granted ${count} relic(s).`);
      await loadAdminData();
    } catch (err) {
      setError(err?.message || 'Failed to grant relic.');
    }
  };

  const handleRemoveRelic = async () => {
    if (!removeRelicId.trim()) return;
    setError('');
    setInfo('');
    try {
      const ok = await adminRemoveRelic({ relicId: removeRelicId.trim() });
      setInfo(ok ? 'Relic removed/consumed.' : 'Relic not found.');
      setRemoveRelicId('');
      await loadAdminData();
    } catch (err) {
      setError(err?.message || 'Failed to remove relic.');
    }
  };

  const handleCreateAnnouncement = async () => {
    setError('');
    setInfo('');
    try {
      const id = await adminCreateAnnouncement({
        title: announcementForm.title,
        message: announcementForm.message,
        expiresAt: announcementForm.expiresAt ? new Date(announcementForm.expiresAt).toISOString() : null,
      });
      setInfo(`Announcement created (${id}).`);
      setAnnouncementForm({ title: '', message: '', expiresAt: '' });
    } catch (err) {
      setError(err?.message || 'Failed to create announcement.');
    }
  };

  const handleReplySubmission = async (submission) => {
    const draft = replyDrafts[submission.id] || {};
    setError('');
    setInfo('');
    try {
      await adminReplyCommunitySubmission({
        submissionId: submission.id,
        adminReply: draft.reply || '',
        status: draft.status || submission.status || 'reviewed',
      });
      setInfo('Submission updated.');
      await loadAdminData();
    } catch (err) {
      setError(err?.message || 'Failed to reply/update submission.');
    }
  };

  const useUserForActions = (userId) => {
    const value = asText(userId);
    if (!value) return;
    setChallengeForm((prev) => ({ ...prev, targetUserId: value }));
    setGrantRelicForm((prev) => ({ ...prev, userId: value }));
    setInfo('Target user was copied into Challenge and Grant Relic sections.');
  };

  const copyTextValue = async (raw, successMessage = 'Copied.') => {
    const value = asText(raw);
    if (!value) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        setInfo(successMessage);
        return;
      }
      setInfo(value);
    } catch (_) {
      setInfo(value);
    }
  };

  const copyUserId = async (userId) => {
    await copyTextValue(userId, 'User ID copied.');
  };

  const handleUpdatePaymentRequest = async (row) => {
    const draft = paymentDrafts[row.id] || {};
    setError('');
    setInfo('');
    try {
      await adminUpdatePaymentVerification({
        requestId: row.id,
        status: draft.status || row.status || 'reviewed',
        adminReply: draft.reply ?? row.admin_reply ?? '',
      });
      setInfo('Payment verification updated.');
      await loadAdminData();
    } catch (err) {
      setError(err?.message || 'Failed to update payment verification.');
    }
  };

  if (!sessionReady) {
    return (
      <SystemBackground>
        <div className="min-h-screen flex items-center justify-center text-slate-300">Validating admin session...</div>
      </SystemBackground>
    );
  }

  return (
    <SystemBackground>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-4">
        <HoloPanel>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  if (window.history.length > 1) {
                    navigate(-1);
                    return;
                  }
                  navigate('/dashboard');
                }}
                className="w-9 h-9 rounded-lg flex items-center justify-center"
                style={{ background: 'rgba(10,25,33,0.8)', border: '1px solid rgba(56,189,248,0.2)' }}
              >
                <ArrowLeft className="w-4 h-4 text-white" />
              </button>
              <div>
                <p className="text-white font-black tracking-widest">ADMIN DASHBOARD</p>
                <p className="text-xs text-slate-400">Signed in as @{adminName}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={refresh}>
                <RefreshCcw className="w-4 h-4 mr-2" /> Refresh
              </Button>
              <Button variant="outline" onClick={logoutAdmin}>Logout Admin</Button>
            </div>
          </div>
          {error && <p className="text-xs text-red-300 mt-2">{error}</p>}
          {info && <p className="text-xs text-emerald-300 mt-2">{info}</p>}
          <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-2">
            {[
              ['Users', summaryStats.totalUsers],
              ['Active', summaryStats.activeUsers],
              ['Suspended', summaryStats.suspendedUsers],
              ['Pending Community', summaryStats.pendingSubmissions],
              ['Pending Payments', summaryStats.pendingPayments],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-lg p-2 border border-slate-700/70 bg-slate-900/35"
              >
                <p className="text-[10px] tracking-widest text-slate-400 uppercase">{label}</p>
                <p className="text-lg font-black text-white">{value}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Last refresh: {lastRefreshAt ? formatDateTime(lastRefreshAt) : 'Not yet'}
          </p>
        </HoloPanel>
        <datalist id="admin-user-id-options">
          {users.map((row) => (
            <option
              key={row.user_id}
              value={row.user_id}
              label={`${row.name || row.email || row.user_id} (${row.user_id})`}
            />
          ))}
        </datalist>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <HoloPanel>
            <p className="text-cyan-300 text-xs font-black tracking-widest mb-3 flex items-center gap-2">
              <Users className="w-3.5 h-3.5" /> USER MANAGEMENT
            </p>
            <div className="mb-3 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <Input
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search by name, email or user id"
                  className="pl-9 bg-slate-900/70 border-slate-700 text-white"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowSuspendedOnly((v) => !v)}
                className="w-full sm:w-auto"
              >
                {showSuspendedOnly ? 'Show All' : 'Only Suspended'}
              </Button>
            </div>
            {loading ? (
              <p className="text-sm text-slate-400">Loading users...</p>
            ) : filteredUsers.length === 0 ? (
              <p className="text-sm text-slate-400">No users match this filter.</p>
            ) : (
              <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                {filteredUsers.map((row) => (
                  <div key={row.user_id} className="rounded-lg p-3 border border-slate-700/60 bg-slate-900/40">
                    <p className="text-sm font-bold text-white break-all">{row.name || row.email || row.user_id}</p>
                    <p className="text-[11px] text-slate-400 break-all">{row.user_id} · {row.email || 'no-email'}</p>
                    <p className="text-[11px] text-slate-300 mt-1">
                      XP {Number(row.total_xp || 0).toLocaleString()} · Lv {row.level || 0} · Streak {row.daily_streak || 0} · Relics {row.relic_count || 0}
                    </p>
                    <p className="text-[11px] text-slate-300">
                      Habits: {row.completed_habits || 0} completed / {row.failed_habits || 0} failed
                    </p>
                    <div className="flex gap-2 mt-2 flex-wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => useUserForActions(row.user_id)}
                      >
                        <Sparkles className="w-3.5 h-3.5 mr-1" /> Use Target
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => copyUserId(row.user_id)}
                      >
                        <Copy className="w-3.5 h-3.5 mr-1" /> Copy ID
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSuspend(row.user_id, !row.is_suspended)}
                      >
                        <Ban className="w-3.5 h-3.5 mr-1" />
                        {row.is_suspended ? 'Unsuspend' : 'Suspend'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDeleteUser(row.user_id)}
                        style={{ borderColor: 'rgba(248,113,113,0.45)', color: '#F87171' }}
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </HoloPanel>

          <HoloPanel>
            <p className="text-cyan-300 text-xs font-black tracking-widest mb-3 flex items-center gap-2">
              <Swords className="w-3.5 h-3.5" /> CHALLENGE SYSTEM
            </p>
            <div className="space-y-2">
              <Input
                placeholder="Target User ID (leave empty for global challenge)"
                value={challengeForm.targetUserId}
                onChange={(e) => setChallengeForm((p) => ({ ...p, targetUserId: e.target.value }))}
                list="admin-user-id-options"
                autoComplete="off"
                className="bg-slate-900/70 border-slate-700 text-white"
              />
              <select
                value={challengeForm.targetUserId}
                onChange={(e) => setChallengeForm((p) => ({ ...p, targetUserId: e.target.value }))}
                className="w-full rounded-md bg-slate-900/70 border border-slate-700 text-slate-100 text-sm px-3 py-2"
              >
                <option value="">Global challenge (all users)</option>
                {users.map((row) => (
                  <option key={row.user_id} value={row.user_id}>
                    {(row.name || row.email || 'Unknown User')} - {row.user_id}
                  </option>
                ))}
              </select>
              <Input
                placeholder="Challenge title"
                value={challengeForm.title}
                onChange={(e) => setChallengeForm((p) => ({ ...p, title: e.target.value }))}
                className="bg-slate-900/70 border-slate-700 text-white"
              />
              <Input
                placeholder="Challenge description"
                value={challengeForm.description}
                onChange={(e) => setChallengeForm((p) => ({ ...p, description: e.target.value }))}
                className="bg-slate-900/70 border-slate-700 text-white"
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  placeholder="XP reward"
                  value={challengeForm.xpReward}
                  onChange={(e) => setChallengeForm((p) => ({ ...p, xpReward: e.target.value }))}
                  className="bg-slate-900/70 border-slate-700 text-white"
                />
                <Input
                  type="number"
                  placeholder="Relic reward"
                  value={challengeForm.relicReward}
                  onChange={(e) => setChallengeForm((p) => ({ ...p, relicReward: e.target.value }))}
                  className="bg-slate-900/70 border-slate-700 text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="datetime-local"
                  value={challengeForm.deadline}
                  onChange={(e) => setChallengeForm((p) => ({ ...p, deadline: e.target.value }))}
                  className="bg-slate-900/70 border-slate-700 text-white"
                />
                <Input
                  type="number"
                  placeholder="Punishment value"
                  value={challengeForm.punishmentValue}
                  onChange={(e) => setChallengeForm((p) => ({ ...p, punishmentValue: e.target.value }))}
                  className="bg-slate-900/70 border-slate-700 text-white"
                />
              </div>
              <select
                value={challengeForm.punishmentType}
                onChange={(e) => setChallengeForm((p) => ({ ...p, punishmentType: e.target.value }))}
                className="w-full rounded-md bg-slate-900/70 border border-slate-700 text-slate-100 text-sm px-3 py-2"
              >
                {PUNISHMENT_TYPES.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
              <Button onClick={handleCreateChallenge} className="w-full">
                Create Challenge
              </Button>
            </div>
          </HoloPanel>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <HoloPanel>
            <p className="text-cyan-300 text-xs font-black tracking-widest mb-3 flex items-center gap-2">
              <Gem className="w-3.5 h-3.5" /> RELIC SYSTEM
            </p>
            <div className="space-y-2 mb-4">
              <p className="text-[11px] tracking-widest text-slate-400 font-bold">CREATE RELIC TYPE</p>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Code"
                  value={relicTypeForm.code}
                  onChange={(e) => setRelicTypeForm((p) => ({ ...p, code: e.target.value }))}
                  className="bg-slate-900/70 border-slate-700 text-white"
                />
                <Input
                  placeholder="Name"
                  value={relicTypeForm.name}
                  onChange={(e) => setRelicTypeForm((p) => ({ ...p, name: e.target.value }))}
                  className="bg-slate-900/70 border-slate-700 text-white"
                />
              </div>
              <Input
                placeholder="Description"
                value={relicTypeForm.description}
                onChange={(e) => setRelicTypeForm((p) => ({ ...p, description: e.target.value }))}
                className="bg-slate-900/70 border-slate-700 text-white"
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={relicTypeForm.rarity}
                  onChange={(e) => setRelicTypeForm((p) => ({ ...p, rarity: e.target.value }))}
                  className="rounded-md bg-slate-900/70 border border-slate-700 text-slate-100 text-sm px-3 py-2"
                >
                  {RARITIES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <Input
                  placeholder="Effect type"
                  value={relicTypeForm.effectType}
                  onChange={(e) => setRelicTypeForm((p) => ({ ...p, effectType: e.target.value }))}
                  className="bg-slate-900/70 border-slate-700 text-white"
                />
              </div>
              <Button onClick={handleCreateRelicType} className="w-full">Save Relic Type</Button>
            </div>

            <div className="space-y-2 mb-4">
              <p className="text-[11px] tracking-widest text-slate-400 font-bold">GRANT RELIC</p>
              <Input
                placeholder="Target User ID"
                value={grantRelicForm.userId}
                onChange={(e) => setGrantRelicForm((p) => ({ ...p, userId: e.target.value }))}
                list="admin-user-id-options"
                autoComplete="off"
                className="bg-slate-900/70 border-slate-700 text-white"
              />
              <select
                value={grantRelicForm.userId}
                onChange={(e) => setGrantRelicForm((p) => ({ ...p, userId: e.target.value }))}
                className="w-full rounded-md bg-slate-900/70 border border-slate-700 text-slate-100 text-sm px-3 py-2"
              >
                <option value="">Select user</option>
                {users.map((row) => (
                  <option key={row.user_id} value={row.user_id}>
                    {(row.name || row.email || 'Unknown User')} - {row.user_id}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={grantRelicForm.relicTypeId}
                  onChange={(e) => setGrantRelicForm((p) => ({ ...p, relicTypeId: e.target.value }))}
                  className="rounded-md bg-slate-900/70 border border-slate-700 text-slate-100 text-sm px-3 py-2"
                >
                  <option value="">No Type</option>
                  {relicTypes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
                <select
                  value={grantRelicForm.rarity}
                  onChange={(e) => setGrantRelicForm((p) => ({ ...p, rarity: e.target.value }))}
                  className="rounded-md bg-slate-900/70 border border-slate-700 text-slate-100 text-sm px-3 py-2"
                >
                  {RARITIES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  placeholder="Count"
                  value={grantRelicForm.count}
                  onChange={(e) => setGrantRelicForm((p) => ({ ...p, count: e.target.value }))}
                  className="bg-slate-900/70 border-slate-700 text-white"
                />
                <Input
                  placeholder="Source"
                  value={grantRelicForm.source}
                  onChange={(e) => setGrantRelicForm((p) => ({ ...p, source: e.target.value }))}
                  className="bg-slate-900/70 border-slate-700 text-white"
                />
              </div>
              <Input
                placeholder="Label (optional)"
                value={grantRelicForm.label}
                onChange={(e) => setGrantRelicForm((p) => ({ ...p, label: e.target.value }))}
                className="bg-slate-900/70 border-slate-700 text-white"
              />
              <Button onClick={handleGrantRelic} className="w-full">Grant Relic</Button>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] tracking-widest text-slate-400 font-bold">REMOVE RELIC</p>
              <Input
                placeholder="Relic ID"
                value={removeRelicId}
                onChange={(e) => setRemoveRelicId(e.target.value)}
                className="bg-slate-900/70 border-slate-700 text-white"
              />
              <Button variant="outline" onClick={handleRemoveRelic} className="w-full">Remove Relic</Button>
            </div>
          </HoloPanel>

          <HoloPanel>
            <p className="text-cyan-300 text-xs font-black tracking-widest mb-3 flex items-center gap-2">
              <Megaphone className="w-3.5 h-3.5" /> ANNOUNCEMENTS
            </p>
            <div className="space-y-2">
              <Input
                placeholder="Announcement title"
                value={announcementForm.title}
                onChange={(e) => setAnnouncementForm((p) => ({ ...p, title: e.target.value }))}
                className="bg-slate-900/70 border-slate-700 text-white"
              />
              <Input
                placeholder="Announcement message"
                value={announcementForm.message}
                onChange={(e) => setAnnouncementForm((p) => ({ ...p, message: e.target.value }))}
                className="bg-slate-900/70 border-slate-700 text-white"
              />
              <Input
                type="datetime-local"
                value={announcementForm.expiresAt}
                onChange={(e) => setAnnouncementForm((p) => ({ ...p, expiresAt: e.target.value }))}
                className="bg-slate-900/70 border-slate-700 text-white"
              />
              <Button onClick={handleCreateAnnouncement} className="w-full">
                <Send className="w-4 h-4 mr-2" /> Publish Announcement
              </Button>
            </div>
          </HoloPanel>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <HoloPanel>
            <div className="flex items-center justify-between gap-2 mb-3">
              <p className="text-cyan-300 text-xs font-black tracking-widest flex items-center gap-2">
                <MessageSquare className="w-3.5 h-3.5" /> COMMUNITY SUBMISSIONS
              </p>
              <select
                value={submissionStatusFilter}
                onChange={(e) => setSubmissionStatusFilter(e.target.value)}
                className="rounded-md bg-slate-900/70 border border-slate-700 text-slate-100 text-xs px-2 py-1.5"
              >
                <option value="">All</option>
                <option value="pending">Pending</option>
                <option value="reviewed">Reviewed</option>
                <option value="resolved">Resolved</option>
              </select>
            </div>
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {submissions.map((row) => {
                const draft = replyDrafts[row.id] || {};
                return (
                  <div key={row.id} className="rounded-lg p-3 border border-slate-700/60 bg-slate-900/35 space-y-2">
                    <p className="text-xs text-cyan-300 uppercase tracking-widest">
                      {row.category?.replace(/_/g, ' ')} · {String(row.status || 'pending').toUpperCase()}
                    </p>
                    <p className="text-sm text-white whitespace-pre-wrap break-words">{row.message}</p>
                    <p className="text-[11px] text-slate-500">{row.user_name || row.user_id} · {formatDateTime(row.created_at)}</p>
                    <Input
                      placeholder="Admin reply"
                      value={draft.reply ?? row.admin_reply ?? ''}
                      onChange={(e) => setReplyDrafts((prev) => ({
                        ...prev,
                        [row.id]: { ...prev[row.id], reply: e.target.value, status: prev[row.id]?.status || row.status || 'reviewed' },
                      }))}
                      className="bg-slate-900/70 border-slate-700 text-white"
                    />
                    <div className="flex gap-2">
                      <select
                        value={draft.status || row.status || 'reviewed'}
                        onChange={(e) => setReplyDrafts((prev) => ({
                          ...prev,
                          [row.id]: { ...prev[row.id], status: e.target.value, reply: prev[row.id]?.reply ?? row.admin_reply ?? '' },
                        }))}
                        className="rounded-md bg-slate-900/70 border border-slate-700 text-slate-100 text-sm px-3 py-2"
                      >
                        <option value="pending">Pending</option>
                        <option value="reviewed">Reviewed</option>
                        <option value="resolved">Resolved</option>
                      </select>
                      <Button onClick={() => handleReplySubmission(row)} className="flex-1">Save Reply</Button>
                    </div>
                  </div>
                );
              })}
              {!loading && submissions.length === 0 && (
                <p className="text-sm text-slate-500">No community submissions found.</p>
              )}
            </div>
          </HoloPanel>

          <HoloPanel>
            <p className="text-cyan-300 text-xs font-black tracking-widest mb-3 flex items-center gap-2">
              <ClipboardList className="w-3.5 h-3.5" /> SYSTEM LOG
            </p>
            <div className="mb-3 space-y-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <Input
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                  placeholder="Search log type, user, metadata"
                  className="pl-9 bg-slate-900/70 border-slate-700 text-white"
                />
              </div>
              <select
                value={logTypeFilter}
                onChange={(e) => setLogTypeFilter(e.target.value)}
                className="w-full rounded-md bg-slate-900/70 border border-slate-700 text-slate-100 text-sm px-3 py-2"
              >
                <option value="">All log types</option>
                {[...new Set(logs.map((row) => row?.type).filter(Boolean))].map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {filteredLogs.map((row) => (
                <div key={row.id} className="rounded-lg p-2 border border-slate-700/60 bg-slate-900/35">
                  <p className="text-[11px] text-cyan-300 font-bold uppercase tracking-widest">{row.type}</p>
                  <p className="text-[11px] text-slate-400">{row.user_name || row.user_id || 'system'} · {formatDateTime(row.created_at)}</p>
                  <pre className="text-[10px] text-slate-300 whitespace-pre-wrap break-words mt-1">
                    {JSON.stringify(row.metadata || {}, null, 2)}
                  </pre>
                </div>
              ))}
              {!loading && filteredLogs.length === 0 && (
                <p className="text-sm text-slate-500">No logs match this filter.</p>
              )}
            </div>
          </HoloPanel>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <HoloPanel>
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <p className="text-cyan-300 text-xs font-black tracking-widest flex items-center gap-2">
                <Receipt className="w-3.5 h-3.5" /> PAYMENT VERIFICATIONS
              </p>
              <div className="flex items-center gap-2">
                <Label className="text-[10px] tracking-widest text-slate-400">STATUS</Label>
                <select
                  value={paymentStatusFilter}
                  onChange={(e) => setPaymentStatusFilter(e.target.value)}
                  className="rounded-md bg-slate-900/70 border border-slate-700 text-slate-100 text-xs px-2 py-1.5"
                >
                  <option value="">All</option>
                  {PAYMENT_STATUSES.map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {paymentRequests.map((row) => {
                const draft = paymentDrafts[row.id] || {};
                return (
                  <div key={row.id} className="rounded-lg p-3 border border-slate-700/60 bg-slate-900/35 space-y-2">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <p className="text-xs text-cyan-300 uppercase tracking-widest">
                          {String(row.status || 'pending').toUpperCase()} · INR {Number(row.amount_inr || 0).toFixed(2)}
                        </p>
                        <p className="text-sm text-white break-all">{row.user_name || row.user_email || row.user_id}</p>
                        <p className="text-[11px] text-slate-500 break-all">{row.user_id} · {row.user_email || 'no-email'}</p>
                        <p className="text-[11px] text-slate-400">UTR: {row.utr_reference || '-'}</p>
                        <p className="text-[11px] text-slate-500">Paid at: {formatDateTime(row.paid_at)}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => copyTextValue(row.user_id, 'User ID copied.')}>
                          <Copy className="w-3.5 h-3.5 mr-1" /> User ID
                        </Button>
                        {row.proof_path && (
                          <Button size="sm" variant="outline" onClick={() => copyTextValue(row.proof_path, 'Proof path copied.')}>
                            <Copy className="w-3.5 h-3.5 mr-1" /> Proof Path
                          </Button>
                        )}
                      </div>
                    </div>

                    {(row.payer_name || row.payment_app) && (
                      <p className="text-[11px] text-slate-300">
                        {row.payer_name || 'Unknown payer'}{row.payment_app ? ` · ${row.payment_app}` : ''}
                      </p>
                    )}

                    {row.notes && (
                      <p className="text-[11px] text-slate-300 whitespace-pre-wrap break-words">{row.notes}</p>
                    )}

                    <Input
                      placeholder="Admin reply"
                      value={draft.reply ?? row.admin_reply ?? ''}
                      onChange={(e) => setPaymentDrafts((prev) => ({
                        ...prev,
                        [row.id]: { ...prev[row.id], reply: e.target.value, status: prev[row.id]?.status || row.status || 'reviewed' },
                      }))}
                      className="bg-slate-900/70 border-slate-700 text-white"
                    />

                    <div className="flex gap-2">
                      <select
                        value={draft.status || row.status || 'reviewed'}
                        onChange={(e) => setPaymentDrafts((prev) => ({
                          ...prev,
                          [row.id]: { ...prev[row.id], status: e.target.value, reply: prev[row.id]?.reply ?? row.admin_reply ?? '' },
                        }))}
                        className="rounded-md bg-slate-900/70 border border-slate-700 text-slate-100 text-sm px-3 py-2"
                      >
                        {PAYMENT_STATUSES.map((status) => (
                          <option key={status} value={status}>{status}</option>
                        ))}
                      </select>
                      <Button onClick={() => handleUpdatePaymentRequest(row)} className="flex-1">Save Verification</Button>
                    </div>
                  </div>
                );
              })}
              {!loading && paymentRequests.length === 0 && (
                <p className="text-sm text-slate-500">No payment verification requests found.</p>
              )}
            </div>
          </HoloPanel>
        </div>

        <HoloPanel>
          <p className="text-cyan-300 text-xs font-black tracking-widest mb-2 flex items-center gap-2">
            <Shield className="w-3.5 h-3.5" /> ADMIN AUDIT TRAIL
          </p>
          <p className="text-xs text-slate-400">
            All admin actions are written to `admin_audit_logs` and mirrored into `activity_logs` as `admin_action` when the activity mirror is available.
          </p>
        </HoloPanel>
      </div>
    </SystemBackground>
  );
}
