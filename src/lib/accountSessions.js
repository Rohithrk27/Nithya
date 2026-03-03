import { supabase } from '@/lib/supabase';

const SAVED_ACCOUNTS_KEY = 'nithya_saved_auth_accounts_v1';
const MAX_SAVED_ACCOUNTS = 8;

const getLocalStorage = () => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch (_) {
    return null;
  }
};

const toIsoNow = () => new Date().toISOString();

const toIsoOrNull = (value) => {
  if (!value) return null;
  const dt = new Date(value);
  return Number.isFinite(dt.getTime()) ? dt.toISOString() : null;
};

const normalizeAccount = (row) => {
  if (!row || typeof row !== 'object') return null;

  const accountId = String(row.account_id || row.user_id || '').trim();
  const userId = String(row.user_id || row.account_id || '').trim();
  const accessToken = String(row.access_token || '').trim();
  const refreshToken = String(row.refresh_token || '').trim();
  if (!accountId || !userId || !accessToken || !refreshToken) return null;

  const emailRaw = String(row.email || '').trim();
  const email = emailRaw ? emailRaw.toLowerCase() : null;
  const labelRaw = String(row.label || '').trim();

  return {
    account_id: accountId,
    user_id: userId,
    email,
    label: labelRaw || null,
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: String(row.token_type || 'bearer').trim() || 'bearer',
    expires_at: Number.isFinite(Number(row.expires_at)) ? Number(row.expires_at) : null,
    created_at: toIsoOrNull(row.created_at) || toIsoNow(),
    updated_at: toIsoOrNull(row.updated_at) || toIsoNow(),
    last_used_at: toIsoOrNull(row.last_used_at) || toIsoNow(),
  };
};

const sortAccounts = (rows) => {
  return [...rows].sort((a, b) => {
    const aTs = new Date(a.last_used_at || a.updated_at || a.created_at || 0).getTime();
    const bTs = new Date(b.last_used_at || b.updated_at || b.created_at || 0).getTime();
    return bTs - aTs;
  });
};

const readAccounts = () => {
  const storage = getLocalStorage();
  if (!storage) return [];

  try {
    const raw = storage.getItem(SAVED_ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const deduped = new Map();
    for (const item of parsed) {
      const normalized = normalizeAccount(item);
      if (!normalized) continue;
      const prev = deduped.get(normalized.account_id);
      if (!prev) {
        deduped.set(normalized.account_id, normalized);
        continue;
      }
      const prevTs = new Date(prev.updated_at || prev.last_used_at || prev.created_at || 0).getTime();
      const nextTs = new Date(normalized.updated_at || normalized.last_used_at || normalized.created_at || 0).getTime();
      deduped.set(normalized.account_id, nextTs >= prevTs ? normalized : prev);
    }

    return sortAccounts(Array.from(deduped.values())).slice(0, MAX_SAVED_ACCOUNTS);
  } catch (_) {
    return [];
  }
};

const writeAccounts = (rows) => {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(sortAccounts(rows).slice(0, MAX_SAVED_ACCOUNTS)));
  } catch (_) {
    // Ignore storage write failures.
  }
};

const sessionToAccount = (session) => {
  const user = session?.user || null;
  const accessToken = String(session?.access_token || '').trim();
  const refreshToken = String(session?.refresh_token || '').trim();
  if (!user?.id || !accessToken || !refreshToken) return null;

  const emailRaw = String(user.email || '').trim();
  const metadataName = String(user.user_metadata?.name || user.user_metadata?.full_name || '').trim();

  return {
    account_id: String(user.id),
    user_id: String(user.id),
    email: emailRaw ? emailRaw.toLowerCase() : null,
    label: metadataName || null,
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: String(session?.token_type || 'bearer').trim() || 'bearer',
    expires_at: Number.isFinite(Number(session?.expires_at)) ? Number(session.expires_at) : null,
  };
};

export const listStoredAccountSessions = () => readAccounts();

export const getStoredAccountSession = (accountId) => {
  const safeId = String(accountId || '').trim();
  if (!safeId) return null;
  const rows = readAccounts();
  return rows.find((row) => row.account_id === safeId) || null;
};

export const upsertStoredAccountSession = (session, { markUsed = true } = {}) => {
  const base = sessionToAccount(session);
  if (!base) return null;

  const now = toIsoNow();
  const rows = readAccounts();
  const existing = rows.find((row) => row.account_id === base.account_id) || null;

  const next = normalizeAccount({
    ...existing,
    ...base,
    created_at: existing?.created_at || now,
    updated_at: now,
    last_used_at: markUsed ? now : (existing?.last_used_at || now),
  });

  if (!next) return null;

  const filtered = rows.filter((row) => row.account_id !== next.account_id);
  writeAccounts([next, ...filtered]);
  return next;
};

export const markStoredAccountUsed = (accountId) => {
  const safeId = String(accountId || '').trim();
  if (!safeId) return null;

  const rows = readAccounts();
  const existing = rows.find((row) => row.account_id === safeId) || null;
  if (!existing) return null;

  const now = toIsoNow();
  const next = {
    ...existing,
    updated_at: now,
    last_used_at: now,
  };

  const filtered = rows.filter((row) => row.account_id !== safeId);
  writeAccounts([next, ...filtered]);
  return next;
};

export const removeStoredAccountSession = (accountId) => {
  const safeId = String(accountId || '').trim();
  if (!safeId) return listStoredAccountSessions();

  const rows = readAccounts();
  const filtered = rows.filter((row) => row.account_id !== safeId);
  writeAccounts(filtered);
  return sortAccounts(filtered);
};

export const resolveAccountDisplayName = (account) => {
  const label = String(account?.label || '').trim();
  if (label) return label;
  const email = String(account?.email || '').trim();
  if (email) return email;
  const userId = String(account?.user_id || account?.account_id || '').trim();
  if (!userId) return 'Unknown Account';
  return `${userId.slice(0, 8)}...`;
};

export async function activateStoredAccountSession(accountId) {
  const row = getStoredAccountSession(accountId);
  if (!row) {
    return { data: null, error: new Error('Saved account session not found.') };
  }

  const { data, error } = await supabase.auth.setSession({
    access_token: row.access_token,
    refresh_token: row.refresh_token,
  });

  if (error) return { data: null, error };

  markStoredAccountUsed(row.account_id);
  return { data: data?.session || null, error: null };
}
