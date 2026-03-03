import { Suspense } from 'react'
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { pagesConfig } from './pages.config'
import { createPageUrl } from '@/utils'
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import AppErrorBoundary from '@/components/AppErrorBoundary';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { lazyWithRetry } from '@/lib/lazyWithRetry';

const ResetPassword = lazyWithRetry(() => import('./pages/ResetPassword'));
const PublicProfile = lazyWithRetry(() => import('./pages/PublicProfile'));
const AdminDashboard = lazyWithRetry(() => import('./pages/AdminDashboard'));
const Suspended = lazyWithRetry(() => import('./pages/Suspended'));
const Maintenance = lazyWithRetry(() => import('./pages/Maintenance'));

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const RouteLoadingFallback = () => (
  <div className="min-h-screen safe-top safe-bottom bg-[#0F172A]">
    <div className="h-16 border-b border-[#334155] bg-[#0F2027]" />
    <div className="px-4 py-5 space-y-4 animate-pulse">
      <div className="h-6 w-44 rounded bg-slate-700/60" />
      <div className="h-24 rounded-xl bg-slate-800/70 border border-slate-700/70" />
      <div className="h-24 rounded-xl bg-slate-800/70 border border-slate-700/70" />
      <div className="h-24 rounded-xl bg-slate-800/70 border border-slate-700/70" />
    </div>
  </div>
);

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const AuthenticatedApp = () => {
  const { isLoadingAuth, authError, isAuthenticated, navigateToLogin, isSuspended, profileRole, maintenanceMode } = useAuth();
  const location = useLocation();
  const loginPath = createPageUrl('Login');
  const landingPath = createPageUrl('Landing');
  const dashboardPath = createPageUrl('Dashboard');
  const adminDashboardPath = '/admin-dashboard';
  const defaultAuthenticatedPath = profileRole === 'admin' ? adminDashboardPath : dashboardPath;
  const isSuspendedRoute = location.pathname === '/suspended';
  const isAdminRoute = location.pathname === adminDashboardPath;
  const isMaintenanceRoute = location.pathname === '/maintenance';

  // Show loading spinner while checking auth
  if (isLoadingAuth) {
    return <RouteLoadingFallback />;
  }

  // Render login route when not authenticated to avoid blank screen
  if (!isAuthenticated) {
    const maintenanceExempt =
      location.pathname === loginPath
      || location.pathname === '/admin-dashboard'
      || location.pathname === '/maintenance';

    if (maintenanceMode && !maintenanceExempt) {
      return <Navigate to="/maintenance" replace />;
    }

    return (
      <Suspense fallback={<RouteLoadingFallback />}>
        <Routes>
          {Pages.Landing && (
            <Route
              path={landingPath}
              element={
                <LayoutWrapper currentPageName="Landing">
                  <Pages.Landing />
                </LayoutWrapper>
              }
            />
          )}
          <Route path="/" element={<Navigate to={landingPath} replace />} />
          {Pages.Login && (
            <Route
              path={loginPath}
              element={
                <LayoutWrapper currentPageName="Login">
                  <Pages.Login />
                </LayoutWrapper>
              }
            />
          )}
          <Route
            path="/reset-password"
            element={
              <LayoutWrapper currentPageName="ResetPassword">
                <ResetPassword />
              </LayoutWrapper>
            }
          />
          <Route
            path="/profile/:username"
            element={
              <LayoutWrapper currentPageName="PublicProfile">
                <PublicProfile />
              </LayoutWrapper>
            }
          />
          <Route
            path="/admin-dashboard"
            element={
              <LayoutWrapper currentPageName="AdminDashboard">
                <AdminDashboard />
              </LayoutWrapper>
            }
          />
          <Route
            path="/maintenance"
            element={
              <LayoutWrapper currentPageName="Maintenance">
                <Maintenance />
              </LayoutWrapper>
            }
          />
          <Route path="/suspended" element={<Navigate to={loginPath} replace />} />
          <Route path="*" element={<Navigate to={landingPath} replace />} />
        </Routes>
      </Suspense>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  if (isSuspended && !isSuspendedRoute) {
    return <Navigate to="/suspended" replace />;
  }

  if (!isSuspended && isSuspendedRoute) {
    return <Navigate to={defaultAuthenticatedPath} replace />;
  }

  if (maintenanceMode && profileRole !== 'admin' && !isMaintenanceRoute) {
    return <Navigate to="/maintenance" replace />;
  }

  if ((!maintenanceMode || profileRole === 'admin') && isMaintenanceRoute) {
    return <Navigate to={defaultAuthenticatedPath} replace />;
  }

  if (isAdminRoute && profileRole !== 'admin') {
    return <Navigate to={dashboardPath} replace />;
  }

  if (profileRole === 'admin' && !isAdminRoute && !isSuspendedRoute && !isMaintenanceRoute) {
    return <Navigate to={adminDashboardPath} replace />;
  }

  // Render the main app
  return (
      <Suspense fallback={<RouteLoadingFallback />}>
        <Routes>
          <Route path="/" element={
            <LayoutWrapper currentPageName={mainPageKey}>
              <MainPage />
            </LayoutWrapper>
          } />
          {Pages.Landing && (
            <Route
              path={landingPath}
              element={
                <LayoutWrapper currentPageName="Landing">
                  <Pages.Landing />
                </LayoutWrapper>
              }
            />
          )}
          {Object.entries(Pages)
            .filter(([path]) => path !== 'Login' && path !== 'Landing')
            .map(([path, Page]) => (
              <Route
                key={path}
                path={createPageUrl(path)}
                element={
                  <LayoutWrapper currentPageName={path}>
                    <Page />
                  </LayoutWrapper>
                }
              />
            ))}
          {Pages.Login && (
            <Route
              path={loginPath}
              element={
                <LayoutWrapper currentPageName="Login">
                  <Pages.Login />
                </LayoutWrapper>
              }
            />
          )}
          <Route
            path="/reset-password"
            element={
              <LayoutWrapper currentPageName="ResetPassword">
                <ResetPassword />
              </LayoutWrapper>
            }
          />
          <Route
            path="/profile/:username"
            element={
              <LayoutWrapper currentPageName="PublicProfile">
                <PublicProfile />
              </LayoutWrapper>
            }
          />
          <Route
            path="/admin-dashboard"
            element={
              <LayoutWrapper currentPageName="AdminDashboard">
                <AdminDashboard />
              </LayoutWrapper>
            }
          />
          <Route
            path="/suspended"
            element={
              <LayoutWrapper currentPageName="Suspended">
                <Suspended />
              </LayoutWrapper>
            }
          />
          <Route
            path="/maintenance"
            element={
              <LayoutWrapper currentPageName="Maintenance">
                <Maintenance />
              </LayoutWrapper>
            }
          />
          <Route path="*" element={<PageNotFound />} />
        </Routes>
      </Suspense>
  );
};


function App() {

  return (
    <AppErrorBoundary>
      <AuthProvider>
        <QueryClientProvider client={queryClientInstance}>
          <Router>
            <AuthenticatedApp />
          </Router>
          <Toaster />
          <Analytics />
          <SpeedInsights />
        </QueryClientProvider>
      </AuthProvider>
    </AppErrorBoundary>
  )
}

export default App
