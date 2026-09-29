import { useEffect, useState } from 'react';
import { useEstimate } from '../state/EstimateContext';
import { api } from '../api';
import { Modal } from './ui';

interface JobSummary {
  id: string;
  ref: string;
  client: string | null;
  status: string;
  origin_port: string | null;
  destination_port: string | null;
  updated_at: string;
}

/**
 * An estimate belongs to a job, so the job is where you start.
 *
 * The job number is the thing the team refers to when they talk about a quote,
 * and it is what ties a saved calculation to whatever went to the client.
 */
export function JobBar() {
  const est = useEstimate();
  const [opening, setOpening] = useState(false);

  const lane = est.lanes.find((l) => l.id === est.laneId);
  const isNew = est.job.id === null;

  return (
    <div className="card">
      <div className="flex flex-wrap items-end gap-3 px-4 py-3">
        <label className="block">
          <span className="label">Job number</span>
          <input
            className={`field mt-1 w-44 font-medium ${
              !est.job.ref.trim() ? 'border-amber-400 bg-amber-50' : ''
            }`}
            placeholder="Q-2026-118"
            value={est.job.ref}
            onChange={(e) => est.setJob({ ref: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="label">Client</span>
          <input
            className="field mt-1 w-52"
            value={est.job.client}
            onChange={(e) => est.setJob({ client: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="label">Lane</span>
          <select
            className="field mt-1 w-56"
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
          <span className="label">Status</span>
          <select
            className="field mt-1 w-28"
            value={est.job.status}
            onChange={(e) => est.setJob({ status: e.target.value as typeof est.job.status })}
          >
            {(['Draft', 'Quoted', 'Won', 'Lost'] as const).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>

        <div className="ml-auto flex items-center gap-2">
          <button className="btn-ghost" onClick={() => setOpening(true)}>
            Open a job
          </button>
          <button
            className="btn-ghost"
            onClick={() => {
              if (est.dirty && !window.confirm('Start a new job? Unsaved changes will be lost.')) return;
              est.resetJob();
            }}
          >
            New job
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200 px-4 py-1.5 text-xs text-slate-500">
        <span>
          {isNew ? (
            <span className="text-amber-700">Not saved yet</span>
          ) : (
            <>Saved job {est.job.ref}</>
          )}
        </span>
        <span>
          {lane ? `${lane.origin_port} → ${lane.destination_port}` : 'no lane selected'}
        </span>
        <span>
          {est.activeRates.filter((r) => r.card).length === 0
            ? est.activeRates.some((r) => r.nextEffectiveFrom)
              ? `rates start ${est.activeRates.find((r) => r.nextEffectiveFrom)!.nextEffectiveFrom}`
              : 'no rates on this lane'
            : est.activeRates
                .filter((r) => r.card)
                .map((r) => `${r.mode} from ${r.card!.effectiveFrom}${r.stale ? ' (stale)' : ''}`)
                .join(' · ')}
        </span>
      </div>

      {opening && <OpenJob onClose={() => setOpening(false)} />}
    </div>
  );
}

function OpenJob({ onClose }: { onClose: () => void }) {
  const est = useEstimate();
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    void api.get<JobSummary[]>(`/jobs?${params}`).then(setJobs).catch(() => setJobs([]));
  }, [query]);

  const open = async (id: string) => {
    if (est.dirty && !window.confirm('Open this job? Unsaved changes will be lost.')) return;
    await est.loadJob(id);
    onClose();
  };

  return (
    <Modal title="Open a job" onClose={onClose} wide>
      <input
        className="field mb-3"
        autoFocus
        placeholder="Search by job number or client"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {jobs.length === 0 ? (
        <p className="text-sm text-slate-500">No jobs found.</p>
      ) : (
        <div className="max-h-96 overflow-y-auto rounded border border-slate-200">
          <table className="w-full">
            <thead className="sticky top-0 bg-slate-50">
              <tr>
                <th className="th">Job</th>
                <th className="th">Client</th>
                <th className="th">Lane</th>
                <th className="th">Status</th>
                <th className="th">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jobs.map((j) => (
                <tr
                  key={j.id}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => void open(j.id)}
                >
                  <td className="td font-medium">{j.ref}</td>
                  <td className="td">{j.client ?? '—'}</td>
                  <td className="td text-slate-600">
                    {j.origin_port ? `${j.origin_port} → ${j.destination_port}` : '—'}
                  </td>
                  <td className="td">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{j.status}</span>
                  </td>
                  <td className="td text-xs text-slate-500">{j.updated_at.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
