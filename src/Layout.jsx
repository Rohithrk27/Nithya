import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { createPageUrl } from './utils';
import { LayoutDashboard, Dumbbell, Sword, User, BarChart2, Archive, Flame, Gem, LogIn, LogOut, Trophy, Menu, X, ShieldAlert, Ticket } from 'lucide-react';

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
  { label: 'Quests', page: 'Quests', icon: Sword },
  { label: 'Relics', page: 'Relics', icon: Gem },
  { label: 'Archive', page: 'Archive', icon: Archive },
  { label: 'Dungeon', page: 'Dungeon', icon: Flame },
  { label: 'Profile', page: 'Profile', icon: User },
];

const MOBILE_EXTRA_NAV = [
  { label: 'Analytics', page: 'Analytics', icon: BarChart2 },
  { label: 'Relics', page: 'Relics', icon: Gem },
  { label: 'Redeem Codes', page: 'RedeemCodes', icon: Ticket },
  { label: 'Archive', page: 'Archive', icon: Archive },
  { label: 'Dungeon', page: 'Dungeon', icon: Flame },
  { label: 'Punishments', page: 'Punishments', icon: ShieldAlert },
];

const NO_NAV_PAGES = ['Landing', 'PublicProfile'];

export default function Layout({ children, currentPageName }) {
  const showNav = !NO_NAV_PAGES.includes(currentPageName);
  const { isAuthenticated, logout } = useAuth();
  const [isScrolled, setIsScrolled] = useState(false);
  const [logoSrc, setLogoSrc] = useState(LOGO_URL);
  const [headerSrc, setHeaderSrc] = useState(HEADER_WORDMARK_URL);
  const [logoBroken, setLogoBroken] = useState(false);
  const [headerBroken, setHeaderBroken] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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
    const ok = window.confirm('Are you sure you want to sign out?');
    if (!ok) return;
    setMobileMenuOpen(false);
    await logout();
  };

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden" style={{ background: 'transparent' }}>
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
            {showNav && (
              <button
                type="button"
                onClick={() => setMobileMenuOpen((v) => !v)}
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
                      onClick={() => void confirmAndLogout()}
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
          <nav className="hidden md:flex fixed left-0 top-0 bottom-0 w-16 flex-col items-center py-4 gap-4 z-50"
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
            {NAV_ITEMS.map(({ label, page, icon: Icon }) => {
              const active = currentPageName === page;
              return (
                <Link
                  key={page}
                  to={createPageUrl(page)}
                  title={label}
                  className="w-10 h-10 rounded-xl flex items-center justify-center transition-all hover:scale-110"
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
            {isAuthenticated ? (
              <button
                title="Sign Out"
                onClick={() => void confirmAndLogout()}
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
