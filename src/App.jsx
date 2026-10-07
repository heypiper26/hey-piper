import { Routes, Route, NavLink, Navigate, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, ArrowLeftRight, Tag, Target, Sparkles, Menu, Wallet, Upload, Settings as SettingsIcon, BarChart3, Search, PiggyBank, CreditCard } from 'lucide-react';
import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { api } from './api.js';
import { useHideValues } from './hooks/useHideValues.js';
import { useIdleLogout } from './hooks/useIdleLogout.js';
import { useSettings } from './hooks/useSettings.js';
import Login from './pages/Login.jsx';
import HideValuesToggle from './components/HideValuesToggle.jsx';
import MonthPicker from './components/MonthPicker.jsx';
import { PERIOD_PARAM, PERIOD_ROUTES } from './hooks/usePeriod.js';

// Lazy pages: keeps heavy dependencies (recharts, xlsx, papaparse) out of the
// initial bundle — each page's chunk is fetched on first navigation to it.
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Transactions = lazy(() => import('./pages/Transactions.jsx'));
const CartaoCredito = lazy(() => import('./pages/CartaoCredito.jsx'));
const Categories = lazy(() => import('./pages/Categories.jsx'));
const Goals = lazy(() => import('./pages/Goals.jsx'));
const SmartImport = lazy(() => import('./pages/SmartImport.jsx'));
const PluggySync = lazy(() => import('./pages/PluggySync.jsx'));
const Budget = lazy(() => import('./pages/Budget.jsx'));
const Analysis = lazy(() => import('./pages/Analysis.jsx'));
const Patrimonio = lazy(() => import('./pages/Patrimonio.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));

const NAV = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/transactions', icon: ArrowLeftRight, label: 'Transações' },
  { to: '/budget', icon: Wallet, label: 'Orçamento' },
  { to: '/cartao-credito', icon: CreditCard, label: 'Cartão de Crédito' },
  { to: '/analysis', icon: BarChart3, label: 'Análise' },
  { to: '/patrimonio', icon: PiggyBank, label: 'Patrimônio' },
  { to: '/categories', icon: Tag, label: 'Categorias' },
  { to: '/goals', icon: Target, label: 'Metas' },
  { to: '/pluggy-sync', icon: Sparkles, label: 'Smart Import', badge: 'API' },
  { to: '/smart-import', icon: Upload, label: 'File Import' },
];

function fmtTs(raw) {
  if (!raw) return null;
  // created_at is stored as TEXT "YYYY-MM-DD HH:MM:SS" in server local time
  const d = new Date(raw.replace(' ', 'T'));
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function App() {
  const [open, setOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const { setHidden } = useHideValues();
  const { settings } = useSettings();
  const mainRef = useRef(null);
  const location = useLocation();

  // Ao trocar de rota, volta o conteúdo pro topo — sem isso a área rolável (<main>)
  // mantém a rolagem da página anterior, mais perceptível no mobile.
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    api.checkAuth()
      .then(({ authenticated }) => {
        setAuthenticated(authenticated);
        if (authenticated && settings.hideValuesOnOpen) setHidden(true);
      })
      .catch(() => setAuthenticated(false))
      .finally(() => setAuthChecked(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    api.getLastUpdated()
      .then(({ ts }) => { if (ts) setLastUpdated(fmtTs(ts)); })
      .catch((e) => console.warn('last-updated:', e));
  }, [authenticated]);

  useIdleLogout(authenticated && settings.idleLogout, () => {
    api.logout().catch(() => {});
    setAuthenticated(false);
  });

  // Month-based pages share the selected month: their nav links carry ?m= along
  const periodParam = new URLSearchParams(location.search).get(PERIOD_PARAM);
  const withPeriod = (to) => (periodParam && PERIOD_ROUTES.includes(to)
    ? { pathname: to, search: `?${PERIOD_PARAM}=${periodParam}` }
    : to);
  const showPeriod = PERIOD_ROUTES.includes(location.pathname);

  if (!authChecked) return null;
  if (!authenticated) return (
    <Login onSuccess={() => {
      if (settings.hideValuesOnOpen) setHidden(true);
      setAuthenticated(true);
    }} />
  );

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-40 w-56 bg-gray-900 border-r border-gray-800 flex flex-col
        transform transition-transform duration-200
        ${open ? 'translate-x-0' : '-translate-x-full'}
        lg:relative lg:translate-x-0
      `}>
        <div className="flex items-center h-16 px-5 border-b border-gray-800">
          <span className="flex-1 text-xl tracking-tight" style={{ fontWeight: 650 }}>
            <span className="text-gray-500">hey</span><span className="text-white">piper</span>
          </span>
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          {NAV.map(({ to, icon: Icon, label, end, badge }) => (
            <NavLink
              key={to}
              to={withPeriod(to)}
              end={end}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-600/20 text-indigo-400'
                    : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800'
                }`
              }
            >
              <Icon size={18} />
              <span className="flex-1">{label}</span>
              {badge && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-indigo-500/20 text-indigo-400">
                  {badge}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-4 border-t border-gray-800 space-y-1">
          {lastUpdated && (
            <p className="text-xs text-gray-500">
              Última atualização:<br />
              <span className="text-gray-400">{lastUpdated}</span>
            </p>
          )}
          <div className="flex items-center justify-between">
            <button
              onClick={async () => { await api.logout(); setAuthenticated(false); }}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              Sair
            </button>
            <NavLink
              to="/settings"
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `p-1.5 rounded-lg transition-colors ${
                  isActive ? 'text-indigo-400' : 'text-gray-500 hover:text-gray-300'
                }`
              }
              title="Configurações"
            >
              <SettingsIcon size={16} />
            </NavLink>
          </div>
        </div>
      </aside>

      {/* Overlay */}
      {open && (
        <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setOpen(false)} />
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Equal flex-1 sides keep the month picker truly centered */}
        <header className="flex items-center gap-2 sm:gap-3 h-16 px-4 bg-gray-900 border-b border-gray-800">
          <div className="flex-1 flex items-center gap-3 min-w-0">
            <button onClick={() => setOpen(true)} className="btn-ghost p-2 lg:hidden">
              <Menu size={20} />
            </button>
            {/* on phones the logo yields its space to the month picker */}
            <span className={`text-xl tracking-tight lg:hidden ${showPeriod ? 'hidden sm:inline' : ''}`} style={{ fontWeight: 650 }}>
              <span className="text-gray-500">hey</span><span className="text-white">piper</span>
            </span>
          </div>
          {showPeriod && <MonthPicker />}
          <div className="flex-1 flex items-center justify-end gap-1 sm:gap-3">
          <Link
            to={withPeriod('/transactions')}
            state={{ focusSearch: Date.now() }}
            className="btn-ghost p-2 text-gray-500 hover:text-gray-300"
            title="Buscar transações"
          >
            <Search size={18} />
          </Link>
          <HideValuesToggle />
          </div>
        </header>
        {/* overflow-x-hidden: safety net so a single too-wide element can never
            make the whole page scroll sideways on mobile */}
        <main ref={mainRef} className="flex-1 overflow-y-auto overflow-x-hidden">
          <Suspense fallback={<div className="p-6 text-gray-500 text-sm">Carregando...</div>}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/cartao-credito" element={<CartaoCredito />} />
            <Route path="/budget" element={<Budget />} />
            <Route path="/analysis" element={<Analysis />} />
            <Route path="/patrimonio" element={<Patrimonio />} />
            <Route path="/categories" element={<Categories />} />
            <Route path="/goals" element={<Goals />} />
            <Route path="/smart-import" element={<SmartImport />} />
            <Route path="/pluggy-sync" element={<PluggySync />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
