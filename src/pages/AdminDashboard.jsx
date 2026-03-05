import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
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
  BarChart3,
  Settings2,
  History,
  UserCog,
  Clock3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import SystemBackground from '@/components/SystemBackground';
import HoloPanel from '@/components/HoloPanel';
import ConfirmActionModal from '@/components/ConfirmActionModal';
import { toastError, toastSuccess } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import {
  adminClearUserShadowDebt,
  adminCreateAnnouncement,
  adminCreateChallenge,
  adminCreateRelicCode,
  adminCreateRelicType,
  adminDeleteAnnouncement,
  adminDeleteUser,
  adminGetDashboardAnalytics,
  adminGetSystemControls,
  adminGrantRelic,
  adminIssueSessionFromProfile,
  adminListActivityLogs,
  adminListAnnouncements,
  adminListCommunitySubmissions,
  adminListUsers,
  adminListPaymentVerifications,
  adminLogout,
  adminRemoveRelic,
  adminResetUserStreak,
  adminResetUserXp,
  adminReplyCommunitySubmission,
  adminSetSystemControl,
  adminSetUserRole,
  adminUpdateAnnouncement,
  adminUpdatePaymentVerification,
  adminTriggerDailyQuestReset,
  adminSetUserSuspension,
  adminValidateSession,
  fetchRelicTypes,
  getAdminSessionToken,
} from '@/lib/admin';

const PUNISHMENT_TYPES = ['xp_deduction', 'streak_reset', 'relic_loss'];
const RARITIES = ['common', 'rare', 'epic', 'legendary'];
const PAYMENT_STATUSES = ['pending', 'reviewed', 'verified', 'rejected'];
const ADMIN_TABS = [
  { key: 'users', label: 'Users', icon: Users },
  { key: 'donations', label: 'Donations', icon: Receipt },
  { key: 'analytics', label: 'Analytics', icon: BarChart3 },
  { key: 'system', label: 'System', icon: Settings2 },
  { key: 'logs', label: 'Logs', icon: History },
];
const SUSPEND_DURATIONS = [
  { key: '24h', label: '24 Hours', hours: 24 },
  { key: '7d', label: '7 Days', hours: 24 * 7 },
  { key: '30d', label: '30 Days', hours: 24 * 30 },
];
const getErrorMessage = (value, fallback) => value?.message || fallback;
const asText = (value) => String(value || '').trim();
const toLower = (value) => asText(value).toLowerCase();
const formatDateTime = (value) => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
};
const toDateTimeLocalInput = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
};

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { isAuthenticated, profileRole, logout: logoutAuth } = useAuth();
  const [sessionReady, setSessionReady] = useState(false);
  const [adminName, setAdminName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [activeTab, setActiveTab] = useState('users');
  const [pendingAction, setPendingAction] = useState(null);

  const [users, setUsers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [paymentRequests, setPaymentRequests] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [analytics, setAnalytics] = useState({});
  const [systemControls, setSystemControls] = useState([]);
  const [submissionStatusFilter, setSubmissionStatusFilter] = useState('');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('pending');
  const [includeInactiveAnnouncements, setIncludeInactiveAnnouncements] = useState(true);
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
  const [announcementDrafts, setAnnouncementDrafts] = useState({});
  const [relicTypeForm, setRelicTypeForm] = useState({
    code: '',
    name: '',
    description: '',
    rarity: 'common',
    effectType: '',
  });
  const [relicCodeForm, setRelicCodeForm] = useState({
    code: '',
    relicAmount: 1,
    maxGlobalUses: '',
    maxUsesPerUser: 1,
    expiresAt: '',
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
  const [suspendReasonDraft, setSuspendReasonDraft] = useState({});

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
      const [u, l, s, r, pv, an, sc, aa] = await Promise.allSettled([
        adminListUsers({ sessionToken: token, limit: 300 }),
        adminListActivityLogs({ sessionToken: token, limit: 250 }),
        adminListCommunitySubmissions({ sessionToken: token, status: submissionStatusFilter }),
        fetchRelicTypes(),
        adminListPaymentVerifications({ sessionToken: token, status: paymentStatusFilter, limit: 250 }),
        adminGetDashboardAnalytics({ sessionToken: token, days: 21 }),
        adminGetSystemControls({ sessionToken: token }),
        adminListAnnouncements({
          sessionToken: token,
          limit: 250,
          includeInactive: includeInactiveAnnouncements,
        }),
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

      if (an.status === 'fulfilled') {
        setAnalytics(an.value || {});
      } else {
        setAnalytics({});
        messages.push(`Analytics: ${getErrorMessage(an.reason, 'failed to load')}`);
      }

      if (sc.status === 'fulfilled') {
        setSystemControls(sc.value || []);
      } else {
        setSystemControls([]);
        messages.push(`System: ${getErrorMessage(sc.reason, 'failed to load')}`);
      }

      if (aa.status === 'fulfilled') {
        setAnnouncements(aa.value || []);
      } else {
        setAnnouncements([]);
        messages.push(`Announcements: ${getErrorMessage(aa.reason, 'failed to load')}`);
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
      let token = getAdminSessionToken();
      if (!token && isAuthenticated && profileRole === 'admin') {
        try {
          const issued = await adminIssueSessionFromProfile({
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
          });
          token = issued?.session_token || '';
        } catch (issueErr) {
          setError(issueErr?.message || 'Unable to initialize admin session.');
        }
      }
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
  }, [isAuthenticated, navigate, profileRole, sessionToken]);

  useEffect(() => {
    if (!sessionReady) return;
    void loadAdminData();
  }, [sessionReady, submissionStatusFilter, paymentStatusFilter, includeInactiveAnnouncements]);

  const refresh = async () => {
    setInfo('');
    await loadAdminData();
  };

  const showError = (message) => {
    const text = message || 'Action failed.';
    setError(text);
    toastError(text);
  };

  const showSuccess = (message) => {
    const text = message || 'Saved.';
    setInfo(text);
    toastSuccess(text);
  };

  const openConfirm = ({ title, message, onConfirm, danger = false, confirmText = 'Confirm' }) => {
    setPendingAction({
      title,
      message,
      danger,
      confirmText,
      onConfirm,
    });
  };

  const logoutAdmin = async () => {
    try {
      await adminLogout(getAdminSessionToken());
    } catch (_) {
      // Continue logout flow even if admin session revoke fails.
    }
    await logoutAuth();
    navigate('/login', { replace: true });
  };

  const handleSuspend = async ({
    userId,
    suspended,
    reason = '',
    durationHours = null,
  }) => {
    setError('');
    setInfo('');
    try {
      const suspendedUntil = suspended && durationHours
        ? new Date(Date.now() + (Number(durationHours) * 60 * 60 * 1000)).toISOString()
        : null;
      await adminSetUserSuspension({
        userId,
        suspended,
        reason: reason || null,
        suspendedUntil,
        revokeAuthSessions: true,
      });
      showSuccess(suspended ? 'User suspended.' : 'User unsuspended.');
      await loadAdminData();
    } catch (err) {
      showError(err?.message || 'Failed to update suspension.');
    }
  };

  const handleDeleteUser = async (userId) => {
    setError('');
    setInfo('');
    try {
      const ok = await adminDeleteUser({ userId });
      showSuccess(ok ? 'User deleted.' : 'User not found.');
      await loadAdminData();
    } catch (err) {
      showError(err?.message || 'Failed to delete user.');
    }
  };

  const handleResetXp = async (userId) => {
    try {
      const ok = await adminResetUserXp({ userId });
      showSuccess(ok ? 'XP reset completed.' : 'User not found.');
      await loadAdminData();
    } catch (err) {
      showError(err?.message || 'Failed to reset XP.');
    }
  };

  const handleResetStreak = async (userId) => {
    try {
      const ok = await adminResetUserStreak({ userId });
      showSuccess(ok ? 'Streak reset completed.' : 'User not found.');
      await loadAdminData();
    } catch (err) {
      showError(err?.message || 'Failed to reset streak.');
    }
  };

  const handleClearShadowDebt = async (userId) => {
    try {
      const ok = await adminClearUserShadowDebt({
        userId,
        reason: 'manual_clear_from_admin_dashboard',
      });
      showSuccess(ok ? 'Shadow debt cleared.' : 'User not found.');
      await loadAdminData();
    } catch (err) {
      showError(err?.message || 'Failed to clear shadow debt.');
    }
  };

  const handlePromoteAdmin = async (userId) => {
    try {
      const ok = await adminSetUserRole({ userId, role: 'admin' });
      showSuccess(ok ? 'User promoted to admin.' : 'User not found.');
      await loadAdminData();
    } catch (err) {
      showError(err?.message || 'Failed to promote user.');
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
      showSuccess(`Challenge created (${row?.quest_id || 'unknown quest id'}).`);
      setChallengeForm((prev) => ({ ...prev, title: '', description: '' }));
      await loadAdminData();
    } catch (err) {
      showError(err?.message || 'Failed to create challenge.');
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
      showSuccess(`Relic type saved (${id}).`);
      setRelicTypeForm({ code: '', name: '', description: '', rarity: 'common', effectType: '' });
      await loadAdminData();
    } catch (err) {
      showError(err?.message || 'Failed to create relic type.');
    }
  };

  const handleCreateRelicCode = async () => {
    setError('');
    setInfo('');
    try {
      const row = await adminCreateRelicCode({
        code: relicCodeForm.code,
        relicAmount: Number(relicCodeForm.relicAmount || 1),
        maxGlobalUses: relicCodeForm.maxGlobalUses === '' ? null : Number(relicCodeForm.maxGlobalUses),
        maxUsesPerUser: Number(relicCodeForm.maxUsesPerUser || 1),
        expiresAt: relicCodeForm.expiresAt ? new Date(relicCodeForm.expiresAt).toISOString() : null,
      });
      showSuccess(`Relic code created: ${row?.code || relicCodeForm.code.toUpperCase()}.`);
      setRelicCodeForm({
        code: '',
        relicAmount: 1,
        maxGlobalUses: '',
        maxUsesPerUser: 1,
        expiresAt: '',
      });
    } catch (err) {
      showError(err?.message || 'Failed to create relic code.');
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
      showSuccess(`Granted ${count} relic(s).`);
      await loadAdminData();
    } catch (err) {
      showError(err?.message || 'Failed to grant relic.');
    }
  };

  const handleRemoveRelic = async () => {
    if (!removeRelicId.trim()) return;
    setError('');
    setInfo('');
    try {
      const ok = await adminRemoveRelic({ relicId: removeRelicId.trim() });
      showSuccess(ok ? 'Relic removed/consumed.' : 'Relic not found.');
      setRemoveRelicId('');
      await loadAdminData();
    } catch (err) {
      showError(err?.message || 'Failed to remove relic.');
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
      showSuccess(`Announcement created (${id}).`);
      setAnnouncementForm({ title: '', message: '', expiresAt: '' });
      await loadAdminData();
    } catch (err) {
      showError(err?.message || 'Failed to create announcement.');
    }
  };

  const patchAnnouncementDraft = (announcementId, patch) => {
    if (!announcementId) return;
    setAnnouncementDrafts((prev) => ({
      ...prev,
      [announcementId]: { ...(prev[announcementId] || {}), ...patch },
    }));
  };

  const handleSaveAnnouncement = async (row) => {
    const draft = announcementDrafts[row.id] || {};
    setError('');
    setInfo('');
    try {
      const nextExpiresAt = Object.prototype.hasOwnProperty.call(draft, 'expiresAt')
        ? (draft.expiresAt ? new Date(draft.expiresAt).toISOString() : null)
        : row.expires_at;
      await adminUpdateAnnouncement({
        announcementId: row.id,
        title: draft.title ?? row.title,
        message: draft.message ?? row.message,
        active: typeof draft.active === 'boolean' ? draft.active : row.active !== false,
        expiresAt: nextExpiresAt,
      });
      showSuccess('Announcement updated.');
      setAnnouncementDrafts((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      await loadAdminData();
    } catch (err) {
      showError(err?.message || 'Failed to update announcement.');
    }
  };

  const handleDeleteAnnouncementRow = (row) => {
    openConfirm({
      title: 'Delete announcement?',
      message: 'This will permanently remove this announcement and its message.',
      danger: true,
      confirmText: 'Delete',
      onConfirm: async () => {
        try {
          const ok = await adminDeleteAnnouncement({ announcementId: row.id });
          showSuccess(ok ? 'Announcement deleted.' : 'Announcement not found.');
          await loadAdminData();
        } catch (err) {
          showError(err?.message || 'Failed to delete announcement.');
        }
      },
    });
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
      showSuccess('Submission updated.');
      await loadAdminData();
    } catch (err) {
      showError(err?.message || 'Failed to reply/update submission.');
    }
  };

  const applyUserForActions = (userId) => {
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
      showSuccess('Payment verification updated.');
      await loadAdminData();
    } catch (err) {
      showError(err?.message || 'Failed to update payment verification.');
    }
  };

  const controlMap = useMemo(() => {
    const map = {};
    (systemControls || []).forEach((row) => {
      if (!row?.key) return;
      map[row.key] = !!row.enabled;
    });
    return map;
  }, [systemControls]);

  const toggleSystemControl = async (key, enabled) => {
    try {
      await adminSetSystemControl({ key, enabled });
      showSuccess(`Updated ${key.replace(/_/g, ' ')}.`);
      await loadAdminData();
    } catch (err) {
      showError(err?.message || 'Failed to update system control.');
    }
  };

  const runDailyQuestReset = async () => {
    try {
      const count = await adminTriggerDailyQuestReset();
      showSuccess(`Daily quest reset completed (${count} rows updated).`);
      await loadAdminData();
    } catch (err) {
      showError(err?.message || 'Failed to run daily quest reset.');
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
      <ConfirmActionModal
        open={!!pendingAction}
        title={pendingAction?.title || 'Confirm'}
        message={pendingAction?.message || ''}
        confirmText={pendingAction?.confirmText || 'Confirm'}
        cancelText="Cancel"
        danger={!!pendingAction?.danger}
        onCancel={() => setPendingAction(null)}
        onConfirm={async () => {
          const run = pendingAction?.onConfirm;
          setPendingAction(null);
          if (typeof run === 'function') {
            await run();
          }
        }}
      />
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-4">
        <HoloPanel>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center">
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
          <div className="mt-3">
            <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {ADMIN_TABS.map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className="min-w-[132px] sm:min-w-0 sm:flex-1 rounded-lg px-3 py-2 text-left border transition-colors"
                    style={{
                      borderColor: active ? 'rgba(56,189,248,0.5)' : 'rgba(51,65,85,0.8)',
                      background: active ? 'rgba(8,47,73,0.45)' : 'rgba(15,23,42,0.35)',
                      color: active ? '#67E8F9' : '#E2E8F0',
                    }}
                  >
                    <p className="text-[11px] font-black tracking-widest flex items-center gap-1.5 whitespace-nowrap">
                      <Icon className="w-3.5 h-3.5" /> {tab.label.toUpperCase()}
                    </p>
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[10px] text-slate-500 sm:hidden">Swipe to view all sections.</p>
          </div>
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

        {activeTab === 'users' && (
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
                    <p className="text-[11px] text-slate-400">
                      Role: {String(row.role || 'user').toUpperCase()}
                      {row.is_suspended ? ` · Suspended${row.suspended_until ? ` until ${formatDateTime(row.suspended_until)}` : ' permanently'}` : ''}
                    </p>
                    <div className="flex gap-2 mt-2 flex-wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => applyUserForActions(row.user_id)}
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
                        onClick={() => openConfirm({
                          title: row.is_suspended ? 'Unsuspend user?' : 'Suspend user permanently?',
                          message: row.is_suspended
                            ? 'The user will immediately regain access.'
                            : 'The user will be blocked until manually unsuspended.',
                          danger: !row.is_suspended,
                          confirmText: row.is_suspended ? 'Unsuspend' : 'Suspend',
                          onConfirm: async () => {
                            await handleSuspend({
                              userId: row.user_id,
                              suspended: !row.is_suspended,
                              reason: row.is_suspended ? '' : (suspendReasonDraft[row.user_id] || 'Admin suspension'),
                              durationHours: null,
                            });
                          },
                        })}
                      >
                        <Ban className="w-3.5 h-3.5 mr-1" />
                        {row.is_suspended ? 'Unsuspend' : 'Suspend'}
                      </Button>
                      {SUSPEND_DURATIONS.map((preset) => (
                        <Button
                          key={`${row.user_id}-${preset.key}`}
                          size="sm"
                          variant="outline"
                          onClick={() => openConfirm({
                            title: `Suspend for ${preset.label}?`,
                            message: 'This will immediately block user actions until the duration ends.',
                            danger: true,
                            confirmText: `Suspend ${preset.label}`,
                            onConfirm: async () => {
                              await handleSuspend({
                                userId: row.user_id,
                                suspended: true,
                                reason: suspendReasonDraft[row.user_id] || `Suspended for ${preset.label}`,
                                durationHours: preset.hours,
                              });
                            },
                          })}
                        >
                          <Clock3 className="w-3.5 h-3.5 mr-1" /> {preset.label}
                        </Button>
                      ))}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openConfirm({
                          title: 'Reset XP?',
                          message: 'This will set total XP, level, and stat points to zero.',
                          danger: true,
                          onConfirm: async () => handleResetXp(row.user_id),
                        })}
                      >
                        Reset XP
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openConfirm({
                          title: 'Reset streak?',
                          message: 'This will clear daily streak progress.',
                          danger: true,
                          onConfirm: async () => handleResetStreak(row.user_id),
                        })}
                      >
                        Reset Streak
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openConfirm({
                          title: 'Clear shadow debt?',
                          message: 'This will set this user\'s shadow debt XP to 0.',
                          onConfirm: async () => handleClearShadowDebt(row.user_id),
                        })}
                      >
                        Clear Shadow Debt
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openConfirm({
                          title: 'Promote to admin?',
                          message: 'This user will receive admin role privileges.',
                          onConfirm: async () => handlePromoteAdmin(row.user_id),
                        })}
                      >
                        <UserCog className="w-3.5 h-3.5 mr-1" /> Promote
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openConfirm({
                          title: 'Delete user?',
                          message: 'This action is destructive and cannot be undone.',
                          danger: true,
                          confirmText: 'Delete',
                          onConfirm: async () => handleDeleteUser(row.user_id),
                        })}
                        style={{ borderColor: 'rgba(248,113,113,0.45)', color: '#F87171' }}
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                      </Button>
                    </div>
                    <Input
                      value={suspendReasonDraft[row.user_id] || ''}
                      onChange={(e) => setSuspendReasonDraft((prev) => ({ ...prev, [row.user_id]: e.target.value }))}
                      placeholder="Suspension reason (optional)"
                      className="mt-2 bg-slate-900/70 border-slate-700 text-white"
                    />
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
        )}

        {(activeTab === 'users' || activeTab === 'system') && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {activeTab === 'users' && (
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

            <div className="space-y-2 mb-4 rounded-lg border border-slate-700/70 p-3 bg-slate-900/30">
              <p className="text-[11px] tracking-widest text-slate-400 font-bold">CREATE REDEEM CODE</p>
              <p className="text-[11px] text-slate-500">
                Configure how many relics this code grants and how many times each user can use it.
              </p>
              <Input
                placeholder="Code (e.g. WEEKEND10)"
                value={relicCodeForm.code}
                onChange={(e) => setRelicCodeForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
                className="bg-slate-900/70 border-slate-700 text-white"
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  min={1}
                  placeholder="Relics granted"
                  value={relicCodeForm.relicAmount}
                  onChange={(e) => setRelicCodeForm((p) => ({ ...p, relicAmount: e.target.value }))}
                  className="bg-slate-900/70 border-slate-700 text-white"
                />
                <Input
                  type="number"
                  min={0}
                  placeholder="Max uses per user"
                  value={relicCodeForm.maxUsesPerUser}
                  onChange={(e) => setRelicCodeForm((p) => ({ ...p, maxUsesPerUser: e.target.value }))}
                  className="bg-slate-900/70 border-slate-700 text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  min={1}
                  placeholder="Global use cap (optional)"
                  value={relicCodeForm.maxGlobalUses}
                  onChange={(e) => setRelicCodeForm((p) => ({ ...p, maxGlobalUses: e.target.value }))}
                  className="bg-slate-900/70 border-slate-700 text-white"
                />
                <Input
                  type="datetime-local"
                  value={relicCodeForm.expiresAt}
                  onChange={(e) => setRelicCodeForm((p) => ({ ...p, expiresAt: e.target.value }))}
                  className="bg-slate-900/70 border-slate-700 text-white"
                />
              </div>
              <Button onClick={handleCreateRelicCode} className="w-full">Create Redeem Code</Button>
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
          )}

          {activeTab === 'system' && (
          <HoloPanel>
            <p className="text-cyan-300 text-xs font-black tracking-widest mb-3 flex items-center gap-2">
              <Megaphone className="w-3.5 h-3.5" /> ANNOUNCEMENTS
            </p>
            <div className="space-y-2 mb-4 rounded-lg border border-slate-700/70 p-3 bg-slate-900/30">
              <p className="text-[11px] tracking-widest text-slate-400 font-bold">SYSTEM CONTROLS</p>
              {[
                ['announcements_enabled', 'Global announcements'],
                ['maintenance_mode', 'Maintenance mode'],
                ['double_xp_mode', 'Double XP mode'],
              ].map(([key, label]) => (
                <Button
                  key={key}
                  type="button"
                  variant="outline"
                  onClick={() => toggleSystemControl(key, !controlMap[key])}
                  className="w-full justify-between text-left"
                  style={{
                    background: controlMap[key] ? 'rgba(6,78,59,0.35)' : 'rgba(30,41,59,0.45)',
                    color: controlMap[key] ? '#6EE7B7' : '#94A3B8',
                    borderColor: controlMap[key] ? 'rgba(110,231,183,0.35)' : 'rgba(71,85,105,0.55)',
                  }}
                >
                  <span className="text-xs font-bold tracking-wider">{label.toUpperCase()}</span>
                  <span className="text-[10px] ml-2">{controlMap[key] ? 'ON' : 'OFF'}</span>
                </Button>
              ))}
              <Button variant="outline" onClick={runDailyQuestReset} className="w-full">
                <Clock3 className="w-4 h-4 mr-2" /> Daily Quest Reset
              </Button>
            </div>
            <div className="space-y-2">
              <p className="text-[11px] tracking-widest text-slate-400 font-bold">CREATE ANNOUNCEMENT</p>
              <Input
                placeholder="Announcement title"
                value={announcementForm.title}
                onChange={(e) => setAnnouncementForm((p) => ({ ...p, title: e.target.value }))}
                className="bg-slate-900/70 border-slate-700 text-white"
              />
              <textarea
                placeholder="Announcement message"
                value={announcementForm.message}
                onChange={(e) => setAnnouncementForm((p) => ({ ...p, message: e.target.value }))}
                className="w-full min-h-[92px] rounded-md px-3 py-2 bg-slate-900/70 border border-slate-700 text-white text-sm"
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

            <div className="mt-4 space-y-2 rounded-lg border border-slate-700/70 p-3 bg-slate-900/25">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] tracking-widest text-slate-400 font-bold">ANNOUNCEMENT HISTORY</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIncludeInactiveAnnouncements((v) => !v)}
                >
                  {includeInactiveAnnouncements ? 'Hide Inactive' : 'Show Inactive'}
                </Button>
              </div>
              <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                {announcements.map((row) => {
                  const draft = announcementDrafts[row.id] || {};
                  const draftTitle = draft.title ?? row.title ?? '';
                  const draftMessage = draft.message ?? row.message ?? '';
                  const draftActive = typeof draft.active === 'boolean' ? draft.active : row.active !== false;
                  const draftExpiresAt = draft.expiresAt ?? toDateTimeLocalInput(row.expires_at);
                  return (
                    <div key={row.id} className="rounded-lg p-3 border border-slate-700/60 bg-slate-900/40 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-cyan-300 tracking-widest font-black break-all">
                          {draftTitle || 'Untitled announcement'}
                        </p>
                        <span className={`text-[10px] px-2 py-0.5 rounded border ${draftActive ? 'text-emerald-300 border-emerald-500/40 bg-emerald-900/20' : 'text-slate-300 border-slate-500/40 bg-slate-700/30'}`}>
                          {draftActive ? 'ACTIVE' : 'INACTIVE'}
                        </span>
                      </div>
                      <Input
                        value={draftTitle}
                        onChange={(e) => patchAnnouncementDraft(row.id, { title: e.target.value })}
                        placeholder="Title"
                        className="bg-slate-900/70 border-slate-700 text-white"
                      />
                      <textarea
                        value={draftMessage}
                        onChange={(e) => patchAnnouncementDraft(row.id, { message: e.target.value })}
                        placeholder="Message"
                        className="w-full min-h-[78px] rounded-md px-3 py-2 bg-slate-900/70 border border-slate-700 text-white text-sm"
                      />
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <Input
                          type="datetime-local"
                          value={draftExpiresAt}
                          onChange={(e) => patchAnnouncementDraft(row.id, { expiresAt: e.target.value })}
                          className="bg-slate-900/70 border-slate-700 text-white"
                        />
                        <Button
                          variant="outline"
                          onClick={() => patchAnnouncementDraft(row.id, { active: !draftActive })}
                          style={{
                            borderColor: draftActive ? 'rgba(110,231,183,0.35)' : 'rgba(148,163,184,0.35)',
                            color: draftActive ? '#6EE7B7' : '#CBD5E1',
                          }}
                        >
                          {draftActive ? 'Set Inactive' : 'Set Active'}
                        </Button>
                      </div>
                      <p className="text-[10px] text-slate-500">
                        Created: {formatDateTime(row.created_at)} · Expires: {row.expires_at ? formatDateTime(row.expires_at) : 'No expiry'}
                      </p>
                      <div className="flex gap-2">
                        <Button size="sm" className="flex-1" onClick={() => handleSaveAnnouncement(row)}>
                          Save Changes
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDeleteAnnouncementRow(row)}
                          style={{ borderColor: 'rgba(248,113,113,0.45)', color: '#F87171' }}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {!loading && announcements.length === 0 && (
                  <p className="text-sm text-slate-500">No announcements found.</p>
                )}
              </div>
            </div>
          </HoloPanel>
          )}
        </div>
        )}

        {activeTab === 'analytics' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <HoloPanel>
            <p className="text-cyan-300 text-xs font-black tracking-widest mb-3 flex items-center gap-2">
              <BarChart3 className="w-3.5 h-3.5" /> PLATFORM ANALYTICS
            </p>
            <div className="grid grid-cols-2 gap-2">
              {[
                ['Total Users', analytics?.total_users || 0],
                ['Active Today', analytics?.active_today || 0],
                ['Total Donations', `INR ${Number(analytics?.total_donations || 0).toFixed(2)}`],
                ['Total XP Distributed', Number(analytics?.total_xp_distributed || 0).toLocaleString()],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg p-2 border border-slate-700/70 bg-slate-900/35">
                  <p className="text-[10px] tracking-widest text-slate-400 uppercase">{label}</p>
                  <p className="text-base font-black text-white">{value}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-lg p-3 border border-slate-700/70 bg-slate-900/30">
              <p className="text-[10px] tracking-widest text-slate-400 uppercase mb-1">Most Active User (7d)</p>
              <p className="text-sm font-bold text-white">
                {analytics?.most_active_user?.name || 'N/A'}
              </p>
              <p className="text-[11px] text-slate-400">
                {analytics?.most_active_user?.user_id || '-'} · {Number(analytics?.most_active_user?.event_count || 0)} events
              </p>
            </div>
          </HoloPanel>

          <HoloPanel>
            <p className="text-cyan-300 text-xs font-black tracking-widest mb-3">DAILY ACTIVITY</p>
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {(analytics?.daily_activity || []).map((row) => {
                const count = Number(row?.count || 0);
                const max = Math.max(1, ...((analytics?.daily_activity || []).map((r) => Number(r?.count || 0))));
                const width = Math.max(4, Math.round((count / max) * 100));
                return (
                  <div key={String(row?.date)} className="rounded-lg p-2 border border-slate-700/60 bg-slate-900/35">
                    <div className="flex items-center justify-between text-[11px] text-slate-300">
                      <span>{String(row?.date || '-')}</span>
                      <span>{count}</span>
                    </div>
                    <div className="h-2 mt-1 rounded bg-slate-800/80 overflow-hidden">
                      <div
                        className="h-full rounded"
                        style={{ width: `${width}%`, background: 'linear-gradient(90deg, #0EA5E9, #22D3EE)' }}
                      />
                    </div>
                  </div>
                );
              })}
              {(!analytics?.daily_activity || analytics.daily_activity.length === 0) && (
                <p className="text-sm text-slate-500">No activity data available.</p>
              )}
            </div>
          </HoloPanel>
        </div>
        )}

        {activeTab === 'logs' && (
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
        )}

        {activeTab === 'donations' && (
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
        )}

        {activeTab === 'logs' && (
        <HoloPanel>
          <p className="text-cyan-300 text-xs font-black tracking-widest mb-2 flex items-center gap-2">
            <Shield className="w-3.5 h-3.5" /> ADMIN AUDIT TRAIL
          </p>
          <p className="text-xs text-slate-400">
            All admin actions are written to `admin_audit_logs` and mirrored into `activity_logs` as `admin_action` when the activity mirror is available.
          </p>
        </HoloPanel>
        )}
      </div>
    </SystemBackground>
  );
}
