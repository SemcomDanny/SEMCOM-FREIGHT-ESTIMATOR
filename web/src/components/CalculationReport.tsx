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
 * Internal calculation report.
 *
 * Two jobs: a readable record of how a number was arrived at, for the file or
 * for anyone who queries it later, and the same figures as columns you can
 * paste into whatever spreadsheet the quote lives in.
 */
export function CalculationReport({ estimate }: { estimate: CostEstimate | null }) {
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
      forecastLabel: est.rateBasisLabel,
    };
  }, [estimate, est.job, est.metrics, est.rateBasisLabel, lane]);

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
      <Card title="Calculation report">
        <p className="p-4 text-sm text-slate-600">
          Price the consignment first — this then records how the figure was arrived at.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Workings estimate={estimate} />

    <Card
      title="Figures for the quote sheet"
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
    </div>
  );
}

/**
 * The workings behind the number, in the order they were applied. This is the
 * bit worth keeping on file — six months later nobody remembers which rate
 * version a quote was priced on or what stow factor was assumed.
 */
function Workings({ estimate }: { estimate: CostEstimate }) {
  const est = useEstimate();
  const lane = est.lanes.find((l) => l.id === est.laneId);
  const m = est.metrics;
  const mix = est.comparison?.mixResult;
  const [copied, setCopied] = useState(false);

  const asText = () => {
    const out: string[] = [];
    out.push(`CALCULATION REPORT — ${est.job.ref || 'unsaved job'}`);
    if (est.job.client) out.push(`Client: ${est.job.client}`);
    out.push(`Lane: ${lane ? `${lane.origin_port} → ${lane.destination_port}` : '—'}`);
    out.push(`Order quantity: ${est.activeBreak?.label ?? 'as entered'}`);
    out.push(`Prepared: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
    out.push(`Rate basis: ${est.rateBasisLabel}`);
    out.push('');
    out.push('CONSIGNMENT');
    for (const l of m.lines) {
      out.push(
        `  ${l.description}: ${l.qty} ctn @ ${l.volumeCbmEach.toFixed(4)} CBM = ` +
          `${l.volumeCbmTotal.toFixed(3)} CBM, ${l.weightKgTotal.toFixed(1)} kg`,
      );
    }
    out.push(`  Total: ${m.totalCartons} cartons, ${m.totalVolumeCbm.toFixed(3)} CBM, ${m.totalWeightKg.toFixed(1)} kg`);
    out.push(`  Density: ${m.densityKgPerCbm.toFixed(0)} kg/CBM`);
    out.push(
      `  Chargeable (W/M): ${m.chargeableCbm.toFixed(3)} CBM — max(volume, weight/1000), ${m.chargeableBasis}-based`,
    );
    out.push('');
    out.push('LOADING');
    out.push(`  Mode: ${est.loadingMode === 'palletised' ? 'palletised' : 'floor-loaded'}`);
    out.push(`  Stow efficiency assumed: ${(est.stowEfficiency * 100).toFixed(0)}%`);
    if (mix) {
      out.push(`  Container fit: ${mix.mix.map((x) => `${x.count} x ${x.containerTypeName}`).join(' + ')}`);
      out.push(
        `  Utilisation: ${(mix.meanVolumeUtilisation * 100).toFixed(1)}% by volume, ` +
          `${(mix.meanPayloadUtilisation * 100).toFixed(1)}% by payload`,
      );
    }
    out.push('');
    out.push(`COSTING — ${estimate.mode}, ${estimate.basis}`);
    for (const c of estimate.components) {
      out.push(`  ${c.label}: ${c.amount.toFixed(2)} ${estimate.currency}`);
      out.push(`      ${c.formula}`);
      if (c.sourceRateCardId) out.push(`      rate version ${c.sourceRateCardId}`);
    }
    out.push(`  TOTAL: ${estimate.total.toFixed(2)} ${estimate.currency} (${estimate.totalAud.toFixed(2)} AUD @ ${estimate.fxToAud})`);
    out.push(`  Per CBM: ${estimate.costPerCbm.toFixed(2)} · per carton: ${estimate.costPerCarton.toFixed(2)}`);
    if (estimate.costPerUnit != null) out.push(`  Per unit: ${estimate.costPerUnit.toFixed(4)}`);
    if (estimate.warnings.length > 0) {
      out.push('');
      out.push('NOTES');
      for (const w of estimate.warnings) out.push(`  - ${w}`);
    }
    out.push('');
    out.push('Container fit is a deterministic estimate, not a stow plan. Actual stow is the packer\'s.');
    return out.join('\n');
  };

  return (
    <Card
      title="How this figure was worked out"
      subtitle="Keep this with the quote — it records the rate version, the assumptions and the arithmetic"
      actions={
        <>
          <button
            className="btn-ghost"
            onClick={() => {
              void navigator.clipboard.writeText(asText());
              setCopied(true);
              setTimeout(() => setCopied(false), 3000);
            }}
          >
            {copied ? 'Copied' : 'Copy report'}
          </button>
          <button
            className="btn-ghost"
            onClick={() => {
              const blob = new Blob([asText()], { type: 'text/plain' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${est.job.ref || 'calculation'}-report.txt`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Download
          </button>
        </>
      }
    >
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap px-4 py-3 font-mono text-[11px] leading-relaxed text-slate-800">
        {asText()}
      </pre>
    </Card>
  );
}
