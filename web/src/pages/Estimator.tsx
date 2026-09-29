import { useEffect, useMemo, useState } from 'react';
import { useEstimate } from '../state/EstimateContext';
import { BreakComparison } from '../components/BreakComparison';
import { BreakTabs } from '../components/BreakTabs';
import { CalculationReport } from '../components/CalculationReport';
import { CartonTable } from '../components/CartonTable';
import { CostPanel } from '../components/CostPanel';
import { JobBar } from '../components/JobBar';
import { JobPanel } from '../components/JobPanel';
import { LoadingPanel } from '../components/LoadingPanel';
import { SaveBar } from '../components/SaveBar';
import { Totals } from '../components/Totals';
import { Banner } from '../components/ui';

type Tab = 'loading' | 'cost' | 'breaks' | 'report' | 'job';

const TABS: { key: Tab; label: string }[] = [
  { key: 'cost', label: 'Cost estimate' },
  { key: 'breaks', label: 'Quantity breaks' },
  { key: 'loading', label: 'Loading & 3D view' },
  { key: 'report', label: 'Calculation report' },
  { key: 'job', label: 'Job & actuals' },
];

export function Estimator() {
  const est = useEstimate();
  const [tab, setTab] = useState<Tab>('cost');
  const { refreshRateData } = est;

  // Pick up any lane or rate version added since this session started.
  useEffect(() => refreshRateData(), [refreshRateData]);

  const selectedEstimate = useMemo(() => {
    if (!est.comparison) return null;
    return (
      est.comparison.estimates.find((e) => e.mode === est.selectedMode) ??
      est.comparison.estimates[0] ??
      null
    );
  }, [est.comparison, est.selectedMode]);

  return (
    <div className="space-y-3 pb-20">
      <JobBar />
      <CartonTable />
      <BreakTabs />
      <Totals />

      <div className="flex flex-wrap gap-1 border-b border-slate-300">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t.key
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {est.metrics.totalVolumeCbm <= 0 && (
        <Banner tone="info">
          Enter at least one carton with dimensions and a quantity — everything below fills in as you type.
        </Banner>
      )}

      {tab === 'cost' && <CostPanel />}
      {tab === 'breaks' && <BreakComparison />}
      {tab === 'loading' && <LoadingPanel />}
      {tab === 'report' && <CalculationReport estimate={selectedEstimate} />}
      {tab === 'job' && <JobPanel estimate={selectedEstimate} />}

      <SaveBar estimate={selectedEstimate} />
    </div>
  );
}
