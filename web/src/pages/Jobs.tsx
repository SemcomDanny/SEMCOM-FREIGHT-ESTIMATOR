import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Banner, Card, fmt } from '../components/ui';

interface JobRow {
  id: string;
  ref: string;
  client: string | null;
  status: string;
  origin_port: string | null;
  destination_port: string | null;
  updated_at: string;
  latest_total: number | null;
  latest_mode: string | null;
  latest_actual: number | null;
}

interface AccuracyRow {
  id: string;
  ref: string;
  client: string | null;
  mode: string | null;
  estimate: number | null;
  actual: number;
  invoice_ref: string | null;
  variance: { abs: number; pct: number | null; direction: string } | null;
}

export function Jobs({ onOpen }: { onOpen: (jobId: string) => void }) {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [accuracy, setAccuracy] = useState<{ jobs: AccuracyRow[]; meanAbsPct: number | null; count: number } | null>(
    null,
  );

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (query) params.set('q', query);
    void api.get<JobRow[]>(`/jobs?${params}`).then(setJobs);
  }, [status, query]);

  useEffect(() => load(), [load]);
  useEffect(() => {
    void api.get<typeof accuracy>('/jobs/reports/accuracy').then(setAccuracy);
  }, []);

  const duplicate = async (id: string, ref: string) => {
    const newRef = window.prompt('Reference for the copy:', `${ref}-B`);
    if (!newRef) return;
    await api.post(`/jobs/${id}/duplicate`, { ref: newRef });
    load();
  };

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-end gap-3 px-4 py-3">
        <label className="block">
          <span className="label">Search</span>
          <input
            className="field mt-1 w-64"
            placeholder="Reference or client"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="label">Status</span>
          <select className="field mt-1 w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {['Draft', 'Quoted', 'Won', 'Lost'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>

      <Card title="Saved jobs" subtitle={`${jobs.length} job(s)`}>
        {jobs.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No jobs saved yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Reference</th>
                  <th className="th">Client</th>
                  <th className="th">Lane</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Estimate</th>
                  <th className="th text-right">Actual</th>
                  <th className="th">Updated</th>
                  <th className="th w-40" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {jobs.map((j) => (
                  <tr key={j.id} className="hover:bg-slate-50">
                    <td className="td font-medium">{j.ref}</td>
                    <td className="td">{j.client ?? '—'}</td>
                    <td className="td text-slate-600">
                      {j.origin_port ? `${j.origin_port} → ${j.destination_port}` : '—'}
                    </td>
                    <td className="td">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{j.status}</span>
                    </td>
                    <td className="td tabular text-right">
                      {j.latest_total == null ? '—' : `${fmt.money(j.latest_total)} (${j.latest_mode})`}
                    </td>
                    <td className="td tabular text-right">
                      {j.latest_actual == null ? '—' : fmt.money(j.latest_actual)}
                    </td>
                    <td className="td text-xs text-slate-500">{j.updated_at.slice(0, 10)}</td>
                    <td className="td">
                      <div className="flex justify-end gap-1">
                        <button className="btn-ghost text-xs" onClick={() => onOpen(j.id)}>
                          Open
                        </button>
                        <button className="btn-ghost text-xs" onClick={() => void duplicate(j.id, j.ref)}>
                          Duplicate
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Estimate accuracy"
        subtitle="How close the rate cards actually are, measured against invoiced freight"
      >
        {!accuracy || accuracy.count === 0 ? (
          <p className="p-4 text-sm text-slate-500">
            No invoiced actuals recorded yet. Enter them against closed jobs and this fills in.
          </p>
        ) : (
          <>
            <div className="px-4 py-3">
              <Banner tone={accuracy.meanAbsPct! > 15 ? 'warning' : 'success'}>
                Mean absolute variance across {accuracy.count} job(s):{' '}
                <strong>{accuracy.meanAbsPct!.toFixed(1)}%</strong>
                {accuracy.meanAbsPct! > 15 && ' — the rate cards are drifting from what is being invoiced.'}
              </Banner>
            </div>
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Job</th>
                  <th className="th">Mode</th>
                  <th className="th text-right">Estimate</th>
                  <th className="th text-right">Invoiced</th>
                  <th className="th text-right">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {accuracy.jobs.map((r) => (
                  <tr key={r.id}>
                    <td className="td">
                      {r.ref}
                      {r.client && <span className="ml-1 text-xs text-slate-500">{r.client}</span>}
                    </td>
                    <td className="td">{r.mode ?? '—'}</td>
                    <td className="td tabular text-right">
                      {r.estimate == null ? '—' : fmt.money(r.estimate)}
                    </td>
                    <td className="td tabular text-right">{fmt.money(r.actual)}</td>
                    <td
                      className={`td tabular text-right font-medium ${
                        r.variance && Math.abs(r.variance.pct ?? 0) > 10 ? 'text-amber-700' : ''
                      }`}
                    >
                      {r.variance
                        ? `${r.variance.abs >= 0 ? '+' : ''}${fmt.money(r.variance.abs)} (${r.variance.pct?.toFixed(1)}%)`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Card>
    </div>
  );
}
