import { useCallback, useEffect, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ForecastResult, ShipMode, VarianceSummary } from '@semcom/engine';
import { api } from '../api';
import type { ContainerTypeRow, Lane } from '../api';
import { Banner, Card, fmt } from '../components/ui';

interface HistoryResponse {
  series: { date: string; value: number; rateCardId?: string; label?: string }[];
  summary: VarianceSummary;
  windows: { months: number; summary: VarianceSummary }[];
  forecasts: ForecastResult[];
  stale: boolean;
  staleDays: number;
}

export function History() {
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [containerTypes, setContainerTypes] = useState<ContainerTypeRow[]>([]);
  const [laneId, setLaneId] = useState('');
  const [mode, setMode] = useState<ShipMode>('FCL');
  const [containerTypeId, setContainerTypeId] = useState('20GP');
  const [referenceCbm, setReferenceCbm] = useState(5);
  const [data, setData] = useState<HistoryResponse | null>(null);

  useEffect(() => {
    void Promise.all([
      api.get<Lane[]>('/master/lanes'),
      api.get<ContainerTypeRow[]>('/master/container-types'),
    ]).then(([laneRows, containers]) => {
      setLanes(laneRows);
      setContainerTypes(containers);
      if (laneRows.length > 0) setLaneId((prev) => prev || laneRows[0]!.id);
      if (containers.length > 0) setContainerTypeId((prev) => prev || containers[0]!.id);
    });
  }, []);

  const load = useCallback(() => {
    if (!laneId) return;
    const params = new URLSearchParams({
      laneId,
      mode,
      containerTypeId,
      referenceCbm: String(referenceCbm),
    });
    void api.get<HistoryResponse>(`/rates/history?${params}`).then(setData);
  }, [laneId, mode, containerTypeId, referenceCbm]);

  useEffect(() => load(), [load]);

  const basisLabel =
    mode === 'FCL'
      ? `all-in cost of a ${containerTypes.find((c) => c.id === containerTypeId)?.name ?? containerTypeId}`
      : mode === 'LCL'
        ? `price at ${referenceCbm} CBM`
        : 'cost at 100 chargeable kg';

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-end gap-3 px-4 py-3">
        <label className="block">
          <span className="label">Lane</span>
          <select className="field mt-1 w-64" value={laneId} onChange={(e) => setLaneId(e.target.value)}>
            {lanes.map((l) => (
              <option key={l.id} value={l.id}>
                {l.origin_port} → {l.destination_port}
              </option>
            ))}
          </select>
        </label>
        <div>
          <span className="label">Mode</span>
          <div className="mt-1 flex overflow-hidden rounded border border-slate-300">
            {(['LCL', 'FCL', 'AIR'] as ShipMode[]).map((m) => (
              <button
                key={m}
                className={`px-3 py-1.5 text-sm ${
                  mode === m ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'
                }`}
                onClick={() => setMode(m)}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        {mode === 'FCL' && (
          <label className="block">
            <span className="label">Container</span>
            <select
              className="field mt-1 w-40"
              value={containerTypeId}
              onChange={(e) => setContainerTypeId(e.target.value)}
            >
              {containerTypes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {mode === 'LCL' && (
          <label className="block">
            <span className="label">Reference volume (CBM)</span>
            <input
              className="num mt-1 w-28"
              value={referenceCbm}
              onChange={(e) => setReferenceCbm(Number(e.target.value) || 5)}
            />
            <span className="mt-0.5 block text-xs text-slate-500">
              A whole curve moving is not one number — versions are compared at this volume.
            </span>
          </label>
        )}
      </div>

      {data?.stale && (
        <Banner tone="warning">
          The most recent {mode} rate on this lane is older than {data.staleDays} days. Re-quote before using
          it in a client quote.
        </Banner>
      )}

      <Card title="Rate history" subtitle={`Compared on the ${basisLabel}`}>
        {!data || data.series.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No versions recorded for this lane and mode yet.</p>
        ) : (
          <div className="p-4">
            <div className="h-72 w-full">
              <ResponsiveContainer>
                <LineChart data={data.series} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                  <CartesianGrid stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={70} />
                  <Tooltip
                    formatter={(v: number) => fmt.money(v)}
                    labelFormatter={(label, payload) => {
                      const note = payload?.[0]?.payload?.label;
                      return note ? `${label} — ${note}` : String(label);
                    }}
                  />
                  {data.forecasts
                    .filter((f) => f.method === 'trailing_average' && f.windowMonths === 6)
                    .map((f) => (
                      <ReferenceLine
                        key="trail6"
                        y={f.value}
                        stroke="#f97316"
                        strokeDasharray="4 4"
                        label={{ value: '6-mo avg', fontSize: 10, fill: '#c2410c', position: 'right' }}
                      />
                    ))}
                  <Line type="stepAfter" dataKey="value" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </Card>

      {data && data.series.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card title="Variance">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Window</th>
                  <th className="th text-right">Versions</th>
                  <th className="th text-right">Min</th>
                  <th className="th text-right">Max</th>
                  <th className="th text-right">Mean</th>
                  <th className="th text-right">Std dev</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[{ months: 0, summary: data.summary }, ...data.windows].map((w) => (
                  <tr key={w.months}>
                    <td className="td">{w.months === 0 ? 'All time' : `${w.months} months`}</td>
                    <td className="td tabular text-right">{w.summary.count}</td>
                    <td className="td tabular text-right">{fmt.money(w.summary.min)}</td>
                    <td className="td tabular text-right">{fmt.money(w.summary.max)}</td>
                    <td className="td tabular text-right">{fmt.money(w.summary.mean)}</td>
                    <td className="td tabular text-right">{fmt.money(w.summary.stdDev)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-slate-200 px-4 py-3 text-sm">
              <div className="label">Change vs previous version</div>
              {data.summary.changeAbs == null ? (
                <span className="text-slate-500">Only one version so far.</span>
              ) : (
                <span
                  className={`tabular text-lg font-semibold ${
                    data.summary.changeAbs > 0 ? 'text-red-700' : 'text-emerald-700'
                  }`}
                >
                  {data.summary.changeAbs > 0 ? '+' : ''}
                  {fmt.money(data.summary.changeAbs)}{' '}
                  <span className="text-sm font-normal">({data.summary.changePct?.toFixed(1)}%)</span>
                </span>
              )}
            </div>
          </Card>

          <Card
            title="Estimating rate options"
            subtitle="A forecast is never a quoted rate — it is labelled everywhere it appears"
          >
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Basis</th>
                  <th className="th text-right">Rate</th>
                  <th className="th">Derivation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.forecasts.map((f, i) => (
                  <tr key={i}>
                    <td className="td">
                      {f.isForecast ? (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
                          forecast
                        </span>
                      ) : (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-800">
                          quoted
                        </span>
                      )}{' '}
                      {f.method.replace('_', ' ')}
                      {f.windowMonths ? ` (${f.windowMonths} mo)` : ''}
                    </td>
                    <td className="td tabular text-right font-medium">{fmt.money(f.value)}</td>
                    <td className="td text-xs text-slate-600">{f.formula}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
              Pick a forecast basis on the estimator screen to price against it instead of the latest quote.
            </p>
          </Card>
        </div>
      )}
    </div>
  );
}
