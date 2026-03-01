import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { createPageUrl } from '@/utils'
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ResetPassword from './pages/ResetPassword';
import AppErrorBoundary from '@/components/AppErrorBoundary';
import PublicProfile from './pages/PublicProfile';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const AuthenticatedApp = () => {
  const { isLoadingAuth, authError, isAuthenticated, navigateToLogin } = useAuth();
  const loginPath = createPageUrl('Login');
  const landingPath = createPageUrl('Landing');
  const dashboardPath = createPageUrl('Dashboard');

  // Show loading spinner while checking auth
  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Render login route when not authenticated to avoid blank screen
  if (!isAuthenticated) {
    return (
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
        <Route path="*" element={<Navigate to={landingPath} replace />} />
      </Routes>
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

  // Render the main app
  return (
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
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <AppErrorBoundary>
      <AuthProvider>
        <QueryClientProvider client={queryClientInstance}>
          <Router>
            <NavigationTracker />
            <AuthenticatedApp />
          </Router>
          <Toaster />
        </QueryClientProvider>
      </AuthProvider>
    </AppErrorBoundary>
  )
}

export default App
