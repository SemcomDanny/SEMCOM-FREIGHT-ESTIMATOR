import { useEffect, useMemo, useState } from 'react';
import { EXPORT_FIELDS, csvCell, defaultColumns, toCsv } from '@semcom/engine';
import type { CostEstimate, ExportContext } from '@semcom/engine';
import { useEstimate } from '../state/EstimateContext';
import { api } from '../api';
import { Banner, Card } from './ui';

interface Column {
  key: string;
  header: string;
}

interface ProfilesResponse {
  profiles: { id: string; name: string; columns: Column[] }[];
  available: Column[];
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Export the estimate with the team's own column headings and order, so it
 * pastes straight into the existing quote spreadsheet with no rework.
 */
export function ExportPanel({ estimate }: { estimate: CostEstimate | null }) {
  const est = useEstimate();
  const [columns, setColumns] = useState<Column[]>(defaultColumns());
  const [profiles, setProfiles] = useState<ProfilesResponse['profiles']>([]);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<ProfilesResponse>('/jobs/export/profiles')
      .then((r) => {
        setProfiles(r.profiles);
        if (r.profiles.length > 0) setColumns(r.profiles[0]!.columns);
      })
      .catch(() => undefined);
  }, []);

  const lane = est.lanes.find((l) => l.id === est.laneId);
  const context = useMemo<ExportContext | null>(() => {
    if (!estimate) return null;
    return {
      jobRef: est.job.ref || 'DRAFT',
      client: est.job.client,
      lane: lane ? `${lane.origin_port} -> ${lane.destination_port}` : '',
      metrics: est.metrics,
      estimate,
      rateCardId: estimate.components[0]?.sourceRateCardId,
      calculatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
      forecastLabel: 'Quoted',
    };
  }, [estimate, est.job, est.metrics, lane]);

  const rows = useMemo(() => {
    if (!context) return { header: [] as string[], body: [] as (string | number)[] };
    const fields = new Map(EXPORT_FIELDS.map((f) => [f.key, f]));
    return {
      header: columns.map((c) => c.header),
      body: columns.map((c) => {
        const f = fields.get(c.key);
        return f ? f.value(context) : '';
      }),
    };
  }, [context, columns]);

  const move = (index: number, delta: number) => {
    setColumns((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };

  const copyTsv = async () => {
    const text = `${rows.header.join('\t')}\n${rows.body.join('\t')}`;
    await navigator.clipboard.writeText(text);
    setStatus('Copied — paste directly into the quote spreadsheet.');
    setTimeout(() => setStatus(null), 4000);
  };

  const downloadCsv = () => {
    if (!context) return;
    download(new Blob([toCsv([context], columns)], { type: 'text/csv' }), `${context.jobRef}-freight.csv`);
  };

  const downloadXlsx = async () => {
    if (!context) return;
    // SheetJS is a large dependency and most exports go out as CSV or a
    // clipboard paste, so it is only fetched when someone asks for XLSX.
    const XLSX = await import('xlsx');
    const sheet = XLSX.utils.aoa_to_sheet([rows.header, rows.body]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Freight estimate');
    const out = XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
    download(
      new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      `${context.jobRef}-freight.xlsx`,
    );
  };

  const saveProfile = async () => {
    const name = window.prompt('Save this column layout as:', profiles[0]?.name ?? 'Quote sheet');
    if (!name) return;
    await api.post('/jobs/export/profiles', { name, columns });
    const refreshed = await api.get<ProfilesResponse>('/jobs/export/profiles');
    setProfiles(refreshed.profiles);
    setStatus(`Saved column layout "${name}".`);
    setTimeout(() => setStatus(null), 4000);
  };

  if (!estimate) {
    return (
      <Card title="Quote export">
        <p className="p-4 text-sm text-slate-600">Price the consignment first, then export it here.</p>
      </Card>
    );
  }

  return (
    <Card
      title="Quote export"
      subtitle="Rename and reorder the columns to match your existing sheet — the layout is remembered"
      actions={
        <>
          {profiles.length > 0 && (
            <select
              className="field w-auto py-1 text-xs"
              onChange={(e) => {
                const p = profiles.find((x) => x.id === e.target.value);
                if (p) setColumns(p.columns);
              }}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <button className="btn-ghost" onClick={() => setColumns(defaultColumns())}>
            Reset
          </button>
          <button className="btn-ghost" onClick={() => void saveProfile()}>
            Save layout
          </button>
        </>
      }
    >
      {status && (
        <div className="px-4 pt-3">
          <Banner tone="success">{status}</Banner>
        </div>
      )}

      <div className="max-h-72 overflow-y-auto px-4 py-3">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Field</th>
              <th className="th">Column heading in your sheet</th>
              <th className="th text-right">Value</th>
              <th className="th w-24" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {columns.map((c, i) => (
              <tr key={c.key}>
                <td className="td text-xs text-slate-500">{c.key}</td>
                <td className="td">
                  <input
                    className="field py-1"
                    value={c.header}
                    onChange={(e) =>
                      setColumns((prev) =>
                        prev.map((x, xi) => (xi === i ? { ...x, header: e.target.value } : x)),
                      )
                    }
                  />
                </td>
                <td className="td tabular text-right text-slate-700">{String(rows.body[i] ?? '')}</td>
                <td className="td">
                  <div className="flex justify-end gap-1">
                    <button className="rounded px-1.5 text-slate-500 hover:bg-slate-200" onClick={() => move(i, -1)}>
                      ↑
                    </button>
                    <button className="rounded px-1.5 text-slate-500 hover:bg-slate-200" onClick={() => move(i, 1)}>
                      ↓
                    </button>
                    <button
                      className="rounded px-1.5 text-red-600 hover:bg-red-50"
                      onClick={() => setColumns((prev) => prev.filter((_, xi) => xi !== i))}
                    >
                      ✕
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-slate-200 px-4 py-2">
        <div className="mb-2 text-xs text-slate-500">Preview (CSV)</div>
        <pre className="overflow-x-auto rounded bg-slate-900 p-2 font-mono text-[11px] text-slate-100">
          {rows.header.map(csvCell).join(',')}
          {'\n'}
          {rows.body.map(csvCell).join(',')}
        </pre>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-slate-200 px-4 py-2.5">
        <button className="btn-primary" onClick={() => void copyTsv()}>
          Copy for paste into Excel
        </button>
        <button className="btn-ghost" onClick={downloadCsv}>
          Download CSV
        </button>
        <button className="btn-ghost" onClick={() => void downloadXlsx()}>
          Download XLSX
        </button>
      </div>
    </Card>
  );
}
