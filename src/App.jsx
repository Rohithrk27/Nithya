import { Suspense, lazy } from 'react'
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

const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const PublicProfile = lazy(() => import('./pages/PublicProfile'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const Suspended = lazy(() => import('./pages/Suspended'));
const Maintenance = lazy(() => import('./pages/Maintenance'));

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const RouteLoadingFallback = () => (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
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
  const isSuspendedRoute = location.pathname === '/suspended';
  const isAdminRoute = location.pathname === '/admin-dashboard';
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
    return <Navigate to={dashboardPath} replace />;
  }

  if (maintenanceMode && profileRole !== 'admin' && !isMaintenanceRoute) {
    return <Navigate to="/maintenance" replace />;
  }

  if ((!maintenanceMode || profileRole === 'admin') && isMaintenanceRoute) {
    return <Navigate to={dashboardPath} replace />;
  }

  if (isAdminRoute && profileRole !== 'admin') {
    return <Navigate to={dashboardPath} replace />;
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
        </QueryClientProvider>
      </AuthProvider>
    </AppErrorBoundary>
  )
}

export default App
