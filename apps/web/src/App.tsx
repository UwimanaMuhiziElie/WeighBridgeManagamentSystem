import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginPage from './pages/LoginPage';
import DashboardLayout from './components/DashboardLayout';
import DashboardPage from './pages/DashboardPage';
import BranchesPage from './pages/BranchesPage';
import UsersPage from './pages/UsersPage';
import AdminPricingPage from './pages/AdminPricingPage';
import ClientsAnalyticsPage from './pages/ClientsAnalyticsPage';
import ReportsPage from './pages/ReportsPage';
import APIManagementPage from './pages/APIManagementPage';

type Role = 'operator' | 'admin' | 'manager';

function FullscreenLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-gray-600">Loading...</div>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullscreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AccessDenied() {
  return (
    <div className="p-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h1 className="text-xl font-bold text-gray-900">Access denied</h1>
        <p className="text-gray-600 mt-2">
          Your account doesn’t have permission to view this page.
        </p>
      </div>
    </div>
  );
}

function RequireRole({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullscreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  const role = user.role as Role;
  if (!roles.includes(role)) return <AccessDenied />;
  return <>{children}</>;
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) return <FullscreenLoader />;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route
        path="/"
        element={
          <RequireAuth>
            <DashboardLayout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />

        <Route path="clients" element={<ClientsAnalyticsPage />} />

        <Route
          path="branches"
          element={
            <RequireRole roles={['admin', 'manager']}>
              <BranchesPage />
            </RequireRole>
          }
        />
        <Route
          path="users"
          element={
            <RequireRole roles={['admin', 'manager']}>
              <UsersPage />
            </RequireRole>
          }
        />
        <Route
          path="pricing"
          element={
            <RequireRole roles={['admin', 'manager']}>
              <AdminPricingPage />
            </RequireRole>
          }
        />
        <Route
          path="reports"
          element={
            <RequireRole roles={['admin', 'manager']}>
              <ReportsPage />
            </RequireRole>
          }
        />
        <Route
          path="api"
          element={
            <RequireRole roles={['admin', 'manager']}>
              <APIManagementPage />
            </RequireRole>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
