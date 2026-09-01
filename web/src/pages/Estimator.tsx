import { useEffect, useMemo, useState } from 'react';
import { useEstimate } from '../state/EstimateContext';
import { CartonTable } from '../components/CartonTable';
import { CostPanel } from '../components/CostPanel';
import { ExportPanel } from '../components/ExportPanel';
import { JobPanel } from '../components/JobPanel';
import { LoadingPanel } from '../components/LoadingPanel';
import { RfqPanel } from '../components/RfqPanel';
import { Totals } from '../components/Totals';
import { Banner, Spinner } from '../components/ui';

type Tab = 'loading' | 'cost' | 'rfq' | 'export' | 'job';

const TABS: { key: Tab; label: string }[] = [
  { key: 'cost', label: 'Cost estimate' },
  { key: 'loading', label: 'Loading & 3D view' },
  { key: 'rfq', label: 'Forwarder RFQ' },
  { key: 'export', label: 'Quote export' },
  { key: 'job', label: 'Job & actuals' },
];

export function Estimator() {
  const est = useEstimate();
  const [tab, setTab] = useState<Tab>('cost');
  const [loadingImage, setLoadingImage] = useState<string | null>(null);
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
    <div className="space-y-3">
      <div className="card flex flex-wrap items-end gap-3 px-4 py-3">
        <label className="block">
          <span className="label">Lane</span>
          <select
            className="field mt-1 w-64"
            value={est.laneId}
            onChange={(e) => est.setLaneId(e.target.value)}
          >
            {est.lanes.length === 0 && <option value="">No lanes configured</option>}
            {est.lanes.map((l) => (
              <option key={l.id} value={l.id}>
                {l.origin_port} → {l.destination_port}
                {l.rate_versions === 0 ? ' (no rates)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Job / quote ref</span>
          <input
            className="field mt-1 w-40"
            placeholder="Q-2026-118"
            value={est.job.ref}
            onChange={(e) => est.setJob({ ref: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="label">Client</span>
          <input
            className="field mt-1 w-48"
            value={est.job.client}
            onChange={(e) => est.setJob({ client: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="label">Estimating basis</span>
          <select
            className="field mt-1 w-56"
            value={`${est.forecastMethod}:${est.forecastWindowMonths}`}
            onChange={(e) => {
              const [method, months] = e.target.value.split(':');
              est.setForecastMethod(method as typeof est.forecastMethod);
              est.setForecastWindowMonths(Number(months));
            }}
          >
            <option value="latest:6">Latest quoted rate</option>
            <option value="trailing_average:3">Forecast — 3-month trailing avg</option>
            <option value="trailing_average:6">Forecast — 6-month trailing avg</option>
            <option value="trailing_average:12">Forecast — 12-month trailing avg</option>
            <option value="linear_trend:6">Forecast — linear trend (6 mo)</option>
            <option value="linear_trend:12">Forecast — linear trend (12 mo)</option>
          </select>
        </label>

        <div className="ml-auto text-xs text-slate-500">
          {est.ratesLoading ? (
            <Spinner label="Loading rates" />
          ) : (
            <>
              Rates in force:{' '}
              {est.activeRates.filter((r) => r.card).length === 0
                ? 'none for this lane'
                : est.activeRates
                    .filter((r) => r.card)
                    .map((r) => `${r.mode} from ${r.card!.effectiveFrom}${r.stale ? ' (stale)' : ''}`)
                    .join(' · ')}
            </>
          )}
        </div>
      </div>

      <CartonTable />
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
      {tab === 'loading' && <LoadingPanel onImageCaptured={setLoadingImage} />}
      {tab === 'rfq' && <RfqPanel loadingImage={loadingImage} />}
      {tab === 'export' && <ExportPanel estimate={selectedEstimate} />}
      {tab === 'job' && <JobPanel estimate={selectedEstimate} />}
    </div>
  );
}
