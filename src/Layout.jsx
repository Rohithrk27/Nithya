import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { createPageUrl } from './utils';
import { LayoutDashboard, Dumbbell, Sword, User, BarChart2, Archive, Flame, LogIn, LogOut, Trophy } from 'lucide-react';

const LOGO_URL = '/logo/logo.png';
const HEADER_WORDMARK_URL = '/logo/header.svg';

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
  { label: 'Archive', page: 'Archive', icon: Archive },
  { label: 'Dungeon', page: 'Dungeon', icon: Flame },
  { label: 'Profile', page: 'Profile', icon: User },
];

const NO_NAV_PAGES = ['Landing'];

export default function Layout({ children, currentPageName }) {
  const showNav = !NO_NAV_PAGES.includes(currentPageName);
  const { isAuthenticated, logout } = useAuth();
  const [isScrolled, setIsScrolled] = useState(false);
  const confirmAndLogout = async () => {
    const ok = window.confirm('Are you sure you want to sign out?');
    if (!ok) return;
    await logout();
  };

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'transparent' }}>
      <div className={`flex-1 ${showNav ? 'pb-16 md:pb-0 md:pl-16' : ''}`}>
        {/* Header with app title */}
        <header className={`w-full sticky top-0 z-40 app-topbar ${isScrolled ? 'app-topbar--scrolled' : ''}`}>
          <div className="px-4 md:px-6 md:pl-20 py-3 flex items-center">
            <img
              src={HEADER_WORDMARK_URL}
              alt="Niത്യ"
              className={`h-7 sm:h-8 md:h-9 w-auto object-contain max-w-[68vw] sm:max-w-[360px] app-topbar__brand ${isScrolled ? 'app-topbar__brand--active' : ''}`}
            />
          </div>
        </header>

        {children}
      </div>

      {showNav && (
        <>
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
            {LOGO_URL && <img src={LOGO_URL} alt="Niത്യ" className="w-8 h-8 object-contain mb-2" />}
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
