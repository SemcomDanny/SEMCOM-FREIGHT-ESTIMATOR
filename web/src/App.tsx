import { Suspense, lazy, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useAuth } from './state/AuthContext';
import { EstimateProvider, useEstimate } from './state/EstimateContext';
import { Estimator } from './pages/Estimator';
import { Login } from './pages/Login';
// The charting pages carry Recharts, which the estimator screen never needs.
const Rates = lazy(() => import('./pages/Rates').then((m) => ({ default: m.Rates })));
const History = lazy(() => import('./pages/History').then((m) => ({ default: m.History })));
import { Jobs } from './pages/Jobs';
import { Admin } from './pages/Admin';
import { api } from './api';
import { Spinner } from './components/ui';

const NAV = [
  { to: '/', label: 'Estimator', end: true },
  { to: '/jobs', label: 'Jobs' },
  { to: '/rates', label: 'Rates' },
  { to: '/history', label: 'Rate history' },
  { to: '/admin', label: 'Admin' },
];

interface JobDetail {
  job: Record<string, unknown>;
  lines: {
    id: string;
    description: string;
    lengthMm: number;
    widthMm: number;
    heightMm: number;
    weightKg: number;
    qty: number;
    unitsPerCarton?: number;
    stackable?: boolean;
    maxStackLayers?: number;
    thisWayUp?: boolean;
  }[];
}

/** Loads a saved job back into the live estimator state. */
function JobsRoute() {
  const est = useEstimate();
  const navigate = useNavigate();

  const open = async (jobId: string) => {
    const detail = await api.get<JobDetail>(`/jobs/${jobId}`);
    const j = detail.job as Record<string, string | number | null>;
    est.setLines(detail.lines);
    est.setLaneId(String(j.lane_id ?? ''));
    est.setLoadingMode((j.loading_mode as 'floor' | 'palletised') ?? 'floor');
    if (j.pallet_type_id) est.setPalletTypeId(String(j.pallet_type_id));
    if (typeof j.stow_efficiency === 'number') est.setStowEfficiency(j.stow_efficiency);
    est.setFxOverride(typeof j.fx_override === 'number' ? j.fx_override : null);
    est.setJob({
      id: String(j.id),
      ref: String(j.ref ?? ''),
      client: String(j.client ?? ''),
      status: (j.status as 'Draft' | 'Quoted' | 'Won' | 'Lost') ?? 'Draft',
      incoterm: (j.incoterm as 'FOB') ?? 'FOB',
      commodity: String(j.commodity ?? ''),
      hsCode: String(j.hs_code ?? ''),
      cargoReadyDate: String(j.cargo_ready_date ?? ''),
      dangerousGoods: Number(j.dangerous_goods) === 1,
      notes: String(j.notes ?? ''),
    });
    navigate('/');
  };

  return <Jobs onOpen={(id) => void open(id)} />;
}

function Shell() {
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-300 bg-white">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
          <div className="font-semibold text-slate-900">
            Semcom <span className="font-normal text-slate-500">Freight Estimator</span>
          </div>
          <nav className="flex flex-wrap gap-1">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `rounded px-2.5 py-1.5 text-sm font-medium ${
                    isActive ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-slate-600">
              {user?.name}
              <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-600">
                {user?.role}
              </span>
            </span>
            <button
              className="btn-ghost"
              disabled={signingOut}
              onClick={() => {
                setSigningOut(true);
                void signOut().finally(() => setSigningOut(false));
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-4">
        <Suspense fallback={<Spinner label="Loading" />}>
          <Routes>
            <Route path="/" element={<Estimator />} />
            <Route path="/jobs" element={<JobsRoute />} />
            <Route path="/rates" element={<Rates />} />
            <Route path="/history" element={<History />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Loading" />
      </div>
    );
  }
  if (!user) return <Login />;

  return (
    <EstimateProvider>
      <Shell />
    </EstimateProvider>
  );
}
