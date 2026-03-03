import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { createPageUrl } from './utils';
import { LayoutDashboard, Dumbbell, Sword, User, BarChart2, Archive, Flame, Gem, LogIn, LogOut, Trophy, Menu, X, ShieldAlert, Ticket, MessageSquare, Timer, Brain, Users, ShieldCheck } from 'lucide-react';
import ConfirmActionModal from '@/components/ConfirmActionModal';

const LOGO_URL = '/logo/logo.svg';
const LOGO_FALLBACK_URL = '/logo/logo.png';
const HEADER_WORDMARK_URL = '/logo/header.svg';
const HEADER_WORDMARK_FALLBACK_URL = '/logo/header-wordmark.svg';

// Mobile bottom nav - 5 core items to avoid crowding
const MOBILE_NAV = [
  { label: 'Home', page: 'Dashboard', icon: LayoutDashboard },
  { label: 'Ranks', page: 'Leaderboard', icon: Trophy },
  { label: 'Habits', page: 'Habits', icon: Dumbbell },
  { label: 'Quests', page: 'Quests', icon: Sword },
  { label: 'Profile', page: 'Profile', icon: User },
];

// Desktop side nav - all pages
const NAV_ITEMS = [
  { label: 'Dashboard', page: 'Dashboard', icon: LayoutDashboard },
  { label: 'Leaderboard', page: 'Leaderboard', icon: Trophy },
  { label: 'Habits', page: 'Habits', icon: Dumbbell },
  { label: 'Analytics', page: 'Analytics', icon: BarChart2 },
  { label: 'Insights', page: 'Insights', icon: Brain },
  { label: 'Focus', page: 'Focus', icon: Timer },
  { label: 'Quests', page: 'Quests', icon: Sword },
  { label: 'Party Challenges', page: 'PartyChallenges', icon: Users },
  { label: 'Recovery', page: 'Recovery', icon: ShieldCheck },
  { label: 'Relics', page: 'Relics', icon: Gem },
  { label: 'Redeem Codes', page: 'RedeemCodes', icon: Ticket },
  { label: 'Archive', page: 'Archive', icon: Archive },
  { label: 'Dungeon', page: 'Dungeon', icon: Flame },
  { label: 'Punishments', page: 'Punishments', icon: ShieldAlert },
  { label: 'Community', page: 'Community', icon: MessageSquare },
  { label: 'Profile', page: 'Profile', icon: User },
];

const MOBILE_EXTRA_NAV = [
  { label: 'Analytics', page: 'Analytics', icon: BarChart2 },
  { label: 'Insights', page: 'Insights', icon: Brain },
  { label: 'Focus', page: 'Focus', icon: Timer },
  { label: 'Party Challenges', page: 'PartyChallenges', icon: Users },
  { label: 'Recovery', page: 'Recovery', icon: ShieldCheck },
  { label: 'Relics', page: 'Relics', icon: Gem },
  { label: 'Redeem Codes', page: 'RedeemCodes', icon: Ticket },
  { label: 'Archive', page: 'Archive', icon: Archive },
  { label: 'Dungeon', page: 'Dungeon', icon: Flame },
  { label: 'Punishments', page: 'Punishments', icon: ShieldAlert },
  { label: 'Community', page: 'Community', icon: MessageSquare },
];

const NO_NAV_PAGES = ['Landing', 'PublicProfile', 'AdminDashboard', 'Suspended'];

export default function Layout({ children, currentPageName }) {
  const showNav = !NO_NAV_PAGES.includes(currentPageName);
  const location = useLocation();
  const {
    isAuthenticated,
    logout,
    user,
    accounts,
    switchAccount,
    removeSavedAccount,
    isSwitchingAccount,
  } = useAuth();
  const showAdminAccountSwitcher = currentPageName === 'AdminDashboard';
  const showAccountSwitcher = isAuthenticated && (showNav || showAdminAccountSwitcher);
  const [isScrolled, setIsScrolled] = useState(false);
  const [logoSrc, setLogoSrc] = useState(LOGO_URL);
  const [headerSrc, setHeaderSrc] = useState(HEADER_WORDMARK_URL);
  const [logoBroken, setLogoBroken] = useState(false);
  const [headerBroken, setHeaderBroken] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [accountActionError, setAccountActionError] = useState('');
  const [accountActionLoadingId, setAccountActionLoadingId] = useState('');
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const savedAccounts = useMemo(() => (Array.isArray(accounts) ? accounts : []), [accounts]);
  const mobileQuickItems = useMemo(
    () => MOBILE_NAV.filter((item) => item.page !== 'Profile'),
    []
  );
  const addAccountHref = useMemo(() => {
    const fallback = createPageUrl('Dashboard');
    const currentPath = `${location.pathname || ''}${location.search || ''}${location.hash || ''}` || fallback;
    return `${createPageUrl('Login')}?mode=login&add_account=1&redirect=${encodeURIComponent(currentPath)}`;
  }, [location.hash, location.pathname, location.search]);

  useEffect(() => {
    setMobileMenuOpen(false);
    setAccountMenuOpen(false);
    setAccountActionError('');
  }, [currentPageName]);

  useEffect(() => {
    if (!mobileMenuOpen && !accountMenuOpen) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [accountMenuOpen, mobileMenuOpen]);

  const confirmAndLogout = async () => {
    setMobileMenuOpen(false);
    setAccountMenuOpen(false);
    await logout();
    setShowLogoutConfirm(false);
  };

  const handleSwitchAccount = async (accountId) => {
    const safeId = String(accountId || '').trim();
    if (!safeId) return;
    setAccountActionError('');
    setAccountActionLoadingId(safeId);
    const { error } = await switchAccount(safeId);
    if (error) {
      setAccountActionError(error.message || 'Unable to switch account.');
    } else {
      setAccountMenuOpen(false);
      setMobileMenuOpen(false);
    }
    setAccountActionLoadingId('');
  };

  const handleRemoveAccount = (accountId) => {
    const safeId = String(accountId || '').trim();
    if (!safeId) return;
    setAccountActionError('');
    const { error } = removeSavedAccount(safeId);
    if (error) {
      setAccountActionError(error.message || 'Unable to remove saved account.');
    }
  };

  const resolveAccountLabel = (account) => {
    const label = String(account?.label || '').trim();
    if (label) return label;
    const email = String(account?.email || '').trim();
    if (email) return email;
    const userId = String(account?.user_id || account?.account_id || '').trim();
    if (!userId) return 'Unknown account';
    return `${userId.slice(0, 8)}...`;
  };

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden" style={{ background: 'transparent' }}>
      <ConfirmActionModal
        open={showLogoutConfirm}
        title="Sign out?"
        message="You will need to sign in again to continue."
        confirmText="Sign Out"
        cancelText="Stay"
        danger
        onCancel={() => setShowLogoutConfirm(false)}
        onConfirm={() => void confirmAndLogout()}
      />
      <div className={`w-full flex-1 ${showNav ? 'pb-16 md:pb-0 md:pl-16' : ''}`}>
        {/* Header with app title */}
        <header className={`w-full sticky top-0 z-40 app-topbar ${isScrolled ? 'app-topbar--scrolled' : ''}`}>
          <div className="pl-4 pr-4 md:pl-16 md:pr-6 py-3 flex items-center justify-between gap-3 min-w-0">
            <img
              src={headerSrc}
              alt="Niത്യ"
              onError={() => {
                if (headerSrc !== HEADER_WORDMARK_FALLBACK_URL) {
                  setHeaderSrc(HEADER_WORDMARK_FALLBACK_URL);
                } else {
                  setHeaderBroken(true);
                }
              }}
              style={{ display: headerBroken ? 'none' : 'block' }}
              className={`h-8 sm:h-10 md:h-11 w-auto min-w-0 object-contain max-w-[72vw] sm:max-w-[420px] app-topbar__brand ${isScrolled ? 'app-topbar__brand--active' : ''}`}
            />
            {headerBroken && (
              <div className={`app-topbar__brand ${isScrolled ? 'app-topbar__brand--active' : ''}`}>
                <span
                  style={{
                    fontFamily: 'Orbitron, sans-serif',
                    fontWeight: 800,
                    fontSize: '1.45rem',
                    letterSpacing: '0.02em',
                    color: '#4FD1C5',
                  }}
                >
                  Ni
                </span>
                <span
                  style={{
                    fontFamily: "'Noto Sans Malayalam', 'Nirmala UI', sans-serif",
                    fontWeight: 800,
                    fontSize: '1.35rem',
                    marginLeft: '-3px',
                    color: '#22D3EE',
                  }}
                >
                  ത്യ
                </span>
              </div>
            )}
            <div className="flex items-center gap-2 shrink-0">
              {showAccountSwitcher && (
                <button
                  type="button"
                  onClick={() => {
                    setAccountActionError('');
                    setMobileMenuOpen(false);
                    setAccountMenuOpen((v) => !v);
                  }}
                  className="h-9 rounded-xl px-2.5 flex items-center justify-center text-xs font-bold tracking-wide transition-colors"
                  style={{
                    border: '1px solid rgba(56,189,248,0.3)',
                    background: accountMenuOpen ? 'rgba(56,189,248,0.2)' : 'rgba(15,23,42,0.55)',
                    color: accountMenuOpen ? '#38BDF8' : '#94A3B8',
                  }}
                  aria-label={accountMenuOpen ? 'Close account switcher' : 'Open account switcher'}
                  aria-expanded={accountMenuOpen}
                  aria-controls="account-switcher-menu"
                >
                  Accounts
                </button>
              )}
              {showNav && (
                <button
                  type="button"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    setMobileMenuOpen((v) => !v);
                  }}
                  className="md:hidden w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors"
                  style={{
                    border: '1px solid rgba(56,189,248,0.3)',
                    background: mobileMenuOpen ? 'rgba(56,189,248,0.2)' : 'rgba(15,23,42,0.55)',
                    color: mobileMenuOpen ? '#38BDF8' : '#94A3B8',
                  }}
                  aria-label={mobileMenuOpen ? 'Close menu' : 'Open more pages menu'}
                  aria-expanded={mobileMenuOpen}
                  aria-controls="mobile-more-menu"
                >
                  {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
                </button>
              )}
            </div>
          </div>
        </header>

        {children}
      </div>

      {/* Account switcher drawer */}
      {showAccountSwitcher && accountMenuOpen && (
            <div className="fixed inset-0 z-[70]">
              <button
                type="button"
                className="absolute inset-0"
                onClick={() => setAccountMenuOpen(false)}
                style={{ background: 'rgba(2,6,23,0.72)' }}
                aria-label="Close account switcher overlay"
              />
              <aside
                id="account-switcher-menu"
                className="absolute top-0 right-0 h-full w-[88vw] max-w-[420px] p-4 flex flex-col"
                style={{
                  background: 'linear-gradient(180deg, rgba(15,32,39,0.98), rgba(2,6,23,0.98))',
                  borderLeft: '1px solid rgba(56,189,248,0.18)',
                  boxShadow: '-16px 0 32px rgba(2,6,23,0.6)',
                  backdropFilter: 'blur(16px)',
                }}
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-xs tracking-widest font-bold" style={{ color: '#64748B' }}>ACCOUNTS</p>
                    <p className="text-[11px]" style={{ color: '#94A3B8' }}>Switch between saved sessions</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAccountMenuOpen(false)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ background: 'rgba(15,23,42,0.7)', color: '#94A3B8' }}
                    aria-label="Close account switcher"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-2 overflow-y-auto pb-4">
                  {savedAccounts.length === 0 && (
                    <div
                      className="rounded-xl px-3 py-3 text-xs"
                      style={{ border: '1px solid rgba(56,189,248,0.16)', background: 'rgba(15,23,42,0.55)', color: '#94A3B8' }}
                    >
                      No saved accounts yet.
                    </div>
                  )}

                  {savedAccounts.map((account) => {
                    const accountId = String(account?.account_id || account?.user_id || '');
                    const isCurrent = !!user?.id && accountId === String(user.id);
                    const isBusy = accountActionLoadingId === accountId;
                    const canSwitch = !isCurrent && !isBusy && !isSwitchingAccount;
                    const canRemove = !isCurrent && !isBusy && !isSwitchingAccount;
                    const lastSeenText = account?.last_used_at
                      ? new Date(account.last_used_at).toLocaleString()
                      : 'Unknown';
                    return (
                      <div
                        key={accountId}
                        className="rounded-xl px-3 py-3 space-y-2"
                        style={{
                          border: '1px solid rgba(56,189,248,0.16)',
                          background: isCurrent ? 'rgba(56,189,248,0.18)' : 'rgba(15,23,42,0.55)',
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate" style={{ color: '#E2E8F0' }}>
                              {resolveAccountLabel(account)}
                            </p>
                            <p className="text-[11px] truncate" style={{ color: '#94A3B8' }}>
                              {String(account?.email || account?.user_id || '')}
                            </p>
                            <p className="text-[10px]" style={{ color: '#64748B' }}>
                              Last used: {lastSeenText}
                            </p>
                          </div>
                          {isCurrent && (
                            <span className="text-[10px] font-bold tracking-wide px-2 py-1 rounded-lg"
                              style={{ color: '#38BDF8', border: '1px solid rgba(56,189,248,0.4)' }}>
                              ACTIVE
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={!canSwitch}
                            onClick={() => void handleSwitchAccount(accountId)}
                            className="rounded-lg px-2.5 py-1.5 text-xs font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                            style={{
                              border: '1px solid rgba(56,189,248,0.35)',
                              color: '#7DD3FC',
                              background: 'rgba(2,132,199,0.18)',
                            }}
                          >
                            {isCurrent ? 'Current' : (isBusy ? 'Switching...' : 'Switch')}
                          </button>
                          <button
                            type="button"
                            disabled={!canRemove}
                            onClick={() => handleRemoveAccount(accountId)}
                            className="rounded-lg px-2.5 py-1.5 text-xs font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                            style={{
                              border: '1px solid rgba(239,68,68,0.35)',
                              color: '#FCA5A5',
                              background: 'rgba(127,29,29,0.22)',
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {accountActionError && (
                  <p className="text-xs mb-2" style={{ color: '#FCA5A5' }}>
                    {accountActionError}
                  </p>
                )}

                <div className="mt-auto pt-3 border-t" style={{ borderColor: 'rgba(56,189,248,0.12)' }}>
                  <Link
                    to={addAccountHref}
                    onClick={() => {
                      setAccountMenuOpen(false);
                      setMobileMenuOpen(false);
                    }}
                    className="w-full rounded-xl px-3 py-2.5 flex items-center justify-between"
                    style={{
                      border: '1px solid rgba(56,189,248,0.35)',
                      background: 'rgba(2,132,199,0.18)',
                      color: '#7DD3FC',
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <LogIn className="w-4 h-4" />
                      <span className="text-sm font-semibold">Add Another Account</span>
                    </span>
                  </Link>
                </div>
              </aside>
            </div>
      )}

      {showNav && (
        <>
          {/* Mobile quick access drawer */}
          {mobileMenuOpen && (
            <div className="md:hidden fixed inset-0 z-[60]">
              <button
                type="button"
                className="absolute inset-0"
                onClick={() => setMobileMenuOpen(false)}
                style={{ background: 'rgba(2,6,23,0.72)' }}
                aria-label="Close mobile menu overlay"
              />
              <aside
                id="mobile-more-menu"
                className="absolute top-0 right-0 h-full w-[82vw] max-w-[360px] p-4 flex flex-col"
                style={{
                  background: 'linear-gradient(180deg, rgba(15,32,39,0.98), rgba(2,6,23,0.98))',
                  borderLeft: '1px solid rgba(56,189,248,0.18)',
                  boxShadow: '-16px 0 32px rgba(2,6,23,0.6)',
                  backdropFilter: 'blur(16px)',
                }}
              >
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs tracking-widest font-bold" style={{ color: '#64748B' }}>MORE PAGES</p>
                  <button
                    type="button"
                    onClick={() => setMobileMenuOpen(false)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ background: 'rgba(15,23,42,0.7)', color: '#94A3B8' }}
                    aria-label="Close menu"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-4">
                  {mobileQuickItems.map(({ label, page, icon: Icon }) => {
                    const active = currentPageName === page;
                    return (
                      <Link
                        key={`quick-${page}`}
                        to={createPageUrl(page)}
                        onClick={() => setMobileMenuOpen(false)}
                        className="rounded-xl px-3 py-2 flex items-center gap-2"
                        style={{
                          border: '1px solid rgba(56,189,248,0.16)',
                          background: active ? 'rgba(56,189,248,0.2)' : 'rgba(15,23,42,0.45)',
                          color: active ? '#38BDF8' : '#E2E8F0',
                        }}
                      >
                        <Icon className="w-4 h-4" />
                        <span className="text-xs font-bold truncate">{label}</span>
                      </Link>
                    );
                  })}
                </div>

                <div className="space-y-2 overflow-y-auto pb-4">
                  {MOBILE_EXTRA_NAV.map(({ label, page, icon: Icon }) => {
                    const active = currentPageName === page;
                    return (
                      <Link
                        key={`extra-${page}`}
                        to={createPageUrl(page)}
                        onClick={() => setMobileMenuOpen(false)}
                        className="w-full rounded-xl px-3 py-2.5 flex items-center justify-between"
                        style={{
                          border: '1px solid rgba(56,189,248,0.16)',
                          background: active ? 'rgba(56,189,248,0.2)' : 'rgba(15,23,42,0.55)',
                          color: active ? '#38BDF8' : '#E2E8F0',
                        }}
                      >
                        <span className="flex items-center gap-2">
                          <Icon className="w-4 h-4" />
                          <span className="text-sm font-semibold">{label}</span>
                        </span>
                        {active && <span className="text-[10px] font-bold" style={{ color: '#7DD3FC' }}>OPEN</span>}
                      </Link>
                    );
                  })}
                </div>

                <div className="mt-auto pt-3 border-t" style={{ borderColor: 'rgba(56,189,248,0.12)' }}>
                  <Link
                    to={createPageUrl('Profile')}
                    onClick={() => setMobileMenuOpen(false)}
                    className="w-full rounded-xl px-3 py-2.5 flex items-center justify-between mb-2"
                    style={{
                      border: '1px solid rgba(56,189,248,0.16)',
                      background: currentPageName === 'Profile' ? 'rgba(56,189,248,0.2)' : 'rgba(15,23,42,0.55)',
                      color: currentPageName === 'Profile' ? '#38BDF8' : '#E2E8F0',
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <User className="w-4 h-4" />
                      <span className="text-sm font-semibold">Profile</span>
                    </span>
                  </Link>
                  {isAuthenticated ? (
                    <button
                      type="button"
                      onClick={() => setShowLogoutConfirm(true)}
                      className="w-full rounded-xl px-3 py-2.5 flex items-center justify-between"
                      style={{
                        border: '1px solid rgba(239,68,68,0.35)',
                        background: 'rgba(127,29,29,0.22)',
                        color: '#FCA5A5',
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <LogOut className="w-4 h-4" />
                        <span className="text-sm font-semibold">Sign Out</span>
                      </span>
                    </button>
                  ) : (
                    <Link
                      to={createPageUrl('Login')}
                      onClick={() => setMobileMenuOpen(false)}
                      className="w-full rounded-xl px-3 py-2.5 flex items-center justify-between"
                      style={{
                        border: '1px solid rgba(56,189,248,0.35)',
                        background: 'rgba(2,132,199,0.18)',
                        color: '#7DD3FC',
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <LogIn className="w-4 h-4" />
                        <span className="text-sm font-semibold">Login</span>
                      </span>
                    </Link>
                  )}
                </div>
              </aside>
            </div>
          )}

          {/* Mobile bottom nav - 5 items only */}
          <nav className="md:hidden fixed bottom-0 left-0 right-0 flex z-50"
            style={{ background: 'rgba(15,32,39,0.95)', backdropFilter: 'blur(16px)', borderTop: '1px solid rgba(56,189,248,0.15)' }}>
            {MOBILE_NAV.map(({ label, page, icon: Icon }) => {
              const active = currentPageName === page;
              return (
                <Link
                  key={page}
                  to={createPageUrl(page)}
                  className="flex-1 flex flex-col items-center py-2.5 gap-0.5 transition-colors"
                  style={{ color: active ? '#38BDF8' : '#475569' }}
                >
                  <Icon className="w-5 h-5" />
                  <span className="font-bold tracking-wide" style={{ fontSize: 9 }}>{label.toUpperCase()}</span>
                </Link>
              );
            })}
          </nav>

          {/* Desktop side nav */}
          <nav className="hidden md:flex fixed left-0 top-0 bottom-0 w-16 flex-col items-center py-4 z-50"
            style={{ background: 'rgba(15,32,39,0.95)', backdropFilter: 'blur(16px)', borderRight: '1px solid rgba(56,189,248,0.15)' }}>
            {LOGO_URL && (
              <img
                src={logoSrc}
                alt="Niത്യ"
                onError={() => {
                  if (logoSrc !== LOGO_FALLBACK_URL) {
                    setLogoSrc(LOGO_FALLBACK_URL);
                  } else {
                    setLogoBroken(true);
                  }
                }}
                style={{ display: logoBroken ? 'none' : 'block' }}
                className="w-8 h-8 object-contain mb-2"
              />
            )}
            {logoBroken && (
              <div
                className="w-8 h-8 mb-2 flex items-center justify-center"
                aria-label="Niത്യ"
                style={{
                  fontFamily: 'Orbitron, sans-serif',
                  fontWeight: 900,
                  fontSize: 18,
                  lineHeight: 1,
                }}
              >
                <span style={{ color: '#4FD1C5' }}>N</span>
              </div>
            )}
            <div className="w-full flex-1 flex flex-col items-center gap-3 overflow-y-auto overflow-x-hidden py-1">
              {NAV_ITEMS.map(({ label, page, icon: Icon }) => {
                const active = currentPageName === page;
                return (
                  <Link
                    key={page}
                    to={createPageUrl(page)}
                    title={label}
                    className="w-10 h-10 rounded-xl flex items-center justify-center transition-all hover:scale-110 shrink-0"
                    style={{
                      background: active ? 'rgba(56,189,248,0.2)' : 'transparent',
                      border: active ? '1px solid rgba(56,189,248,0.4)' : '1px solid transparent',
                      color: active ? '#38BDF8' : '#475569',
                      boxShadow: active ? '0 0 12px rgba(56,189,248,0.3)' : 'none',
                    }}
                  >
                    <Icon className="w-5 h-5" />
                  </Link>
                );
              })}
            </div>
            {isAuthenticated ? (
              <button
                title="Sign Out"
                onClick={() => setShowLogoutConfirm(true)}
                className="w-10 h-10 rounded-xl flex items-center justify-center transition-all hover:scale-110"
                style={{ color: '#ef4444', border: '1px solid rgba(239,68,68,0.35)' }}
              >
                <LogOut className="w-5 h-5" />
              </button>
            ) : (
              <Link
                to={createPageUrl('Login')}
                title="Login"
                className="w-10 h-10 rounded-xl flex items-center justify-center transition-all hover:scale-110"
                style={{ color: '#38BDF8', border: '1px solid rgba(56,189,248,0.35)' }}
              >
                <LogIn className="w-5 h-5" />
              </Link>
            )}
          </nav>
        </>
      )}
    </div>
  );
}
