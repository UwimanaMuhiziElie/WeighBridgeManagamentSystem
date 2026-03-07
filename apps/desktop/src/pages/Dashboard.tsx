import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Scale, Users, Car, DollarSign, Settings, LogOut, FileText, Monitor, Receipt, BarChart3 } from 'lucide-react';

import ClientsPage from './ClientsPage';
import VehiclesPage from './VehiclesPage';
import PricingPage from './PricingPage';
import SettingsPage from './SettingsPage';
import WeighingPage from './WeighingPage';
import TransactionsPage from './TransactionsPage';
import MonitoringPage from './MonitoringPage';
import InvoicesPage from './InvoicesPage';
import ReportsPage from './ReportsPage';

type Page =
  | 'weighing'
  | 'monitoring'
  | 'transactions'
  | 'invoices'
  | 'reports'
  | 'clients'
  | 'vehicles'
  | 'pricing'
  | 'settings';

export default function Dashboard() {
  const [currentPage, setCurrentPage] = useState<Page>('weighing');
  const { user, signOut } = useAuth();

  // ✅ Allow any page to request navigation without react-router:
  // window.dispatchEvent(new CustomEvent('wb:navigate', { detail: { page: 'weighing' } }))
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent;
      const page = ce?.detail?.page as Page | undefined;

      if (!page) return;

      const allowed: Page[] = [
        'weighing',
        'monitoring',
        'transactions',
        'invoices',
        'reports',
        'clients',
        'vehicles',
        'pricing',
        'settings',
      ];

      if (allowed.includes(page)) setCurrentPage(page);
    };

    window.addEventListener('wb:navigate', handler as EventListener);
    return () => window.removeEventListener('wb:navigate', handler as EventListener);
  }, []);

  const menuItems = [
  { id: 'weighing' as Page, label: 'Weighing', icon: Scale },
  { id: 'transactions' as Page, label: 'Transactions', icon: FileText },
  { id: 'invoices' as Page, label: 'Receipt', icon: Receipt }, // renamed from Invoices -> Receipt
  { id: 'clients' as Page, label: 'Clients', icon: Users },
  { id: 'pricing' as Page, label: 'Prices', icon: DollarSign }, // Pricing -> Prices
  { id: 'reports' as Page, label: 'Reports', icon: BarChart3 },
  { id: 'vehicles' as Page, label: 'Vehicles', icon: Car },
  { id: 'monitoring' as Page, label: 'Monitoring', icon: Monitor },
  { id: 'settings' as Page, label: 'Settings', icon: Settings },
];

  function renderPage() {
    switch (currentPage) {
      case 'weighing':
        return <WeighingPage />;
      case 'monitoring':
        return <MonitoringPage />;
      case 'transactions':
        return <TransactionsPage />;
      case 'invoices':
        return <InvoicesPage />;
      case 'reports':
        return <ReportsPage />;
      case 'clients':
        return <ClientsPage />;
      case 'vehicles':
        return <VehiclesPage />;
      case 'pricing':
        return <PricingPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <WeighingPage />;
    }
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <aside className="w-64 bg-slate-800 text-white flex flex-col">
        <div className="p-4 border-b border-slate-700">
          <div className="flex items-center gap-2 mb-1">
            <Scale className="w-6 h-6" />
            <h1 className="text-xl font-bold">Weighbridge</h1>
          </div>

          {user && <p className="text-sm text-slate-400 mt-2">{user.full_name || user.email}</p>}
        </div>

        <nav className="flex-1 p-4">
          <ul className="space-y-2">
            {menuItems.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setCurrentPage(item.id)}
                  className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${
                    currentPage === item.id ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  <item.icon className="w-5 h-5" />
                  <span>{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="p-4 border-t border-slate-700">
          <button
            type="button"
            onClick={() => void signOut()}
            className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-slate-300 hover:bg-slate-700 transition-colors"
          >
            <LogOut className="w-5 h-5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">{renderPage()}</main>
    </div>
  );
}
