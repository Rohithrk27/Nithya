import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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

const NO_NAV_PAGES = ['Landing', 'Login', 'ResetPassword', 'PublicProfile', 'AdminDashboard', 'Suspended'];

export default function Layout({ children, currentPageName }) {
  const showNav = !NO_NAV_PAGES.includes(currentPageName);
  const {
    isAuthenticated,
    logout,
  } = useAuth();
  const [isScrolled, setIsScrolled] = useState(false);
  const [logoSrc, setLogoSrc] = useState(LOGO_URL);
  const [headerSrc, setHeaderSrc] = useState(HEADER_WORDMARK_URL);
  const [logoBroken, setLogoBroken] = useState(false);
  const [headerBroken, setHeaderBroken] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const mobileQuickItems = useMemo(
    () => MOBILE_NAV.filter((item) => item.page !== 'Profile'),
    []
  );

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [currentPageName]);

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [mobileMenuOpen]);

  const confirmAndLogout = async () => {
    setMobileMenuOpen(false);
    await logout();
    setShowLogoutConfirm(false);
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
      <div
        className={`w-full flex-1 ${showNav ? 'md:pb-0 md:pl-16' : ''}`}
        style={showNav ? { paddingBottom: 'calc(74px + env(safe-area-inset-bottom))' } : undefined}
      >
        {/* Header with app title */}
        <header className={`w-full sticky top-0 z-40 app-topbar safe-top ${isScrolled ? 'app-topbar--scrolled' : ''}`}>
          <div className="pl-4 pr-4 md:pl-16 md:pr-6 py-3 flex items-center justify-between gap-3 min-w-0">
            <img
              src={headerSrc}
              alt="Niത്യ"
              width="420"
              height="44"
              decoding="async"
              fetchPriority="high"
              loading="eager"
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
              {showNav && (
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen((v) => !v);
                  }}
                  className="md:hidden w-12 h-12 rounded-xl tap-target tap-ripple flex items-center justify-center shrink-0 transition-colors active:scale-95"
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
                    className="w-12 h-12 rounded-lg tap-target tap-ripple flex items-center justify-center active:scale-95"
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
                        className="rounded-xl px-3 py-2 tap-target tap-ripple flex items-center gap-2 active:scale-[0.99]"
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
                        className="w-full rounded-xl px-3 py-2.5 tap-target tap-ripple flex items-center justify-between active:scale-[0.99]"
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
                    className="w-full rounded-xl px-3 py-2.5 tap-target tap-ripple flex items-center justify-between mb-2 active:scale-[0.99]"
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
                      className="w-full rounded-xl px-3 py-2.5 tap-target tap-ripple flex items-center justify-between active:scale-[0.99]"
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
                      className="w-full rounded-xl px-3 py-2.5 tap-target tap-ripple flex items-center justify-between active:scale-[0.99]"
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
          <nav className="md:hidden fixed bottom-0 left-0 right-0 flex z-50 safe-bottom-nav"
            style={{
              background: 'rgba(15,32,39,0.95)',
              backdropFilter: 'blur(16px)',
              borderTop: '1px solid rgba(56,189,248,0.15)',
              paddingLeft: 'max(8px, env(safe-area-inset-left))',
              paddingRight: 'max(8px, env(safe-area-inset-right))',
            }}>
            {MOBILE_NAV.map(({ label, page, icon: Icon }) => {
              const active = currentPageName === page;
              return (
                <Link
                  key={page}
                  to={createPageUrl(page)}
                  className="flex-1 tap-target tap-ripple flex flex-col items-center justify-center py-2 gap-1 transition-colors active:opacity-90"
                  style={{ color: active ? '#38BDF8' : '#475569' }}
                >
                  <Icon className="w-5 h-5" />
                  <span className="font-bold tracking-wide" style={{ fontSize: 10 }}>{label.toUpperCase()}</span>
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
                width="32"
                height="32"
                decoding="async"
                loading="lazy"
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
                    className="w-12 h-12 tap-target tap-ripple rounded-xl flex items-center justify-center transition-transform hover-capable-lift active:scale-95 shrink-0"
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
                className="w-12 h-12 tap-target tap-ripple rounded-xl flex items-center justify-center transition-transform hover-capable-lift active:scale-95"
                style={{ color: '#ef4444', border: '1px solid rgba(239,68,68,0.35)' }}
              >
                <LogOut className="w-5 h-5" />
              </button>
            ) : (
              <Link
                to={createPageUrl('Login')}
                title="Login"
                className="w-12 h-12 tap-target tap-ripple rounded-xl flex items-center justify-center transition-transform hover-capable-lift active:scale-95"
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
