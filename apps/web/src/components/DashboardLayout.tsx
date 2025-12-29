import { useEffect, useMemo, useState, useCallback } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { LucideIcon } from 'lucide-react';
import {
  Scale,
  LayoutDashboard,
  Building2,
  Users,
  DollarSign,
  BarChart3,
  FileText,
  Key,
  LogOut,
  Menu,
  X,
} from 'lucide-react';

type Role = 'operator' | 'admin' | 'manager';

type MenuItem = {
  id: string;
  path: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
};

export default function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const role = (user?.role || (profile as any)?.role || 'operator') as Role;

  const displayName =
    (profile as any)?.full_name ||
    user?.full_name ||
    user?.email ||
    'User';

  const menuItems = useMemo<MenuItem[]>(
    () => [
      { id: 'dashboard', path: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ['operator', 'admin', 'manager'] },
      { id: 'clients', path: '/clients', label: 'Client Analytics', icon: BarChart3, roles: ['operator', 'admin', 'manager'] },

      // Admin/Manager only
      { id: 'branches', path: '/branches', label: 'Branches', icon: Building2, roles: ['admin', 'manager'] },
      { id: 'users', path: '/users', label: 'Users', icon: Users, roles: ['admin', 'manager'] },
      { id: 'pricing', path: '/pricing', label: 'Pricing', icon: DollarSign, roles: ['admin', 'manager'] },
      { id: 'reports', path: '/reports', label: 'Reports', icon: FileText, roles: ['admin', 'manager'] },
      { id: 'api', path: '/api', label: 'API Management', icon: Key, roles: ['admin', 'manager'] },
    ],
    []
  );

  const visibleMenuItems = useMemo(
    () => menuItems.filter((m) => m.roles.includes(role)),
    [menuItems, role]
  );

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sidebarOpen]);

  useEffect(() => {
    try {
      document.body.style.overflow = sidebarOpen ? 'hidden' : '';
      return () => {
        document.body.style.overflow = '';
      };
    } catch {
      // ignore
    }
  }, [sidebarOpen]);

  const handleSignOut = useCallback(async () => {
    try {
      await signOut();
    } finally {
      setSidebarOpen(false);
      navigate('/login', { replace: true });
    }
  }, [signOut, navigate]);

  return (
    <div className="flex h-screen bg-gray-50">
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 text-white transform transition-transform duration-200 ease-in-out lg:translate-x-0 lg:static ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Sidebar"
      >
        <div className="flex items-center justify-between h-16 px-6 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
              <Scale className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="font-bold text-lg">Weighbridge</div>
              <div className="text-xs text-slate-400">
                {role === 'operator' ? 'Operator Portal' : 'Admin Portal'}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-slate-400 hover:text-white"
            aria-label="Close sidebar"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex flex-col h-[calc(100vh-4rem)]">
          <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto" aria-label="Main navigation">
            {visibleMenuItems.map((item) => {
              const Icon = item.icon;

              return (
                <NavLink
                  key={item.id}
                  to={item.path}
                  end={item.path === '/'}
                  className={({ isActive }) =>
                    `w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`
                  }
                  onClick={() => setSidebarOpen(false)}
                >
                  <Icon className="w-5 h-5" />
                  <span className="font-medium">{item.label}</span>
                </NavLink>
              );
            })}
          </nav>

          <div className="p-4 border-t border-slate-800">
            <div className="mb-4 px-4 py-3 bg-slate-800 rounded-lg">
              <div className="text-sm font-medium text-white">{displayName}</div>
              <div className="text-xs text-slate-400 capitalize">{role}</div>
            </div>

            <button
              type="button"
              onClick={handleSignOut}
              className="w-full flex items-center gap-3 px-4 py-3 text-slate-300 hover:bg-slate-800 hover:text-white rounded-lg transition-colors"
            >
              <LogOut className="w-5 h-5" />
              <span className="font-medium">Sign Out</span>
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 lg:px-8">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-gray-600 hover:text-gray-900"
            aria-label="Open sidebar"
          >
            <Menu className="w-6 h-6" />
          </button>

          <div className="flex items-center gap-4">
            <div className="text-sm text-gray-600">
              {new Date().toLocaleDateString(undefined, {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          aria-hidden="true"
        />
      )}
    </div>
  );
}
