import { useEffect, useState } from 'react';
import { estimateVariance, landedCost } from '@semcom/engine';
import type { CostEstimate } from '@semcom/engine';
import { useEstimate } from '../state/EstimateContext';
import { api } from '../api';
import { NumInput } from './NumInput';
import { Banner, Card, fmt } from './ui';

interface JobResultRow {
  id: string;
  mode_selected: string;
  total_cost: number;
  calculated_at: string;
  rate_card_id: string | null;
}

interface JobActualRow {
  id: string;
  invoiced_cost: number;
  invoice_ref: string | null;
  entered_at: string;
}

/** Saving a job, recording the invoiced freight, and the landed-cost check. */
export function JobPanel({ estimate }: { estimate: CostEstimate | null }) {
  const est = useEstimate();
  const [message, setMessage] = useState<string | null>(null);
  const [results, setResults] = useState<JobResultRow[]>([]);
  const [actuals, setActuals] = useState<JobActualRow[]>([]);
  const [actualCost, setActualCost] = useState(0);
  const [invoiceRef, setInvoiceRef] = useState('');
  const [showLanded, setShowLanded] = useState(false);
  const [goodsValue, setGoodsValue] = useState(0);
  const [insurance, setInsurance] = useState(0);
  const [dutyPct, setDutyPct] = useState(5);
  const [gstPct, setGstPct] = useState(10);

  useEffect(() => {
    if (est.settings) {
      setDutyPct(est.settings.defaultDutyPct);
      setGstPct(est.settings.defaultGstPct);
    }
  }, [est.settings]);

  const refresh = async (jobId: string) => {
    const job = await api.get<{ results: JobResultRow[]; actuals: JobActualRow[] }>(`/jobs/${jobId}`);
    setResults(job.results);
    setActuals(job.actuals);
  };

  const flash = (text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(null), 5000);
  };

  const saveActual = async () => {
    if (!est.job.id || actualCost <= 0) return;
    const r = await api.post<{ variance: { abs: number; pct: number | null } | null }>(
      `/jobs/${est.job.id}/actuals`,
      { invoicedCost: actualCost, invoiceRef },
    );
    await refresh(est.job.id);
    setActualCost(0);
    setInvoiceRef('');
    flash(
      r.variance
        ? `Actual recorded — ${r.variance.abs >= 0 ? 'over' : 'under'} the estimate by ${fmt.money(
            Math.abs(r.variance.abs),
          )} (${r.variance.pct?.toFixed(1)}%).`
        : 'Actual recorded.',
    );
  };

  const latestEstimate = results[0]?.total_cost ?? estimate?.totalAud ?? 0;
  const latestActual = actuals[0]?.invoiced_cost ?? null;
  const variance = latestActual != null ? estimateVariance(latestEstimate, latestActual) : null;

  const landed = showLanded
    ? landedCost({
        goodsValueAud: goodsValue,
        freightAud: estimate?.totalAud ?? 0,
        insuranceAud: insurance,
        dutyRatePct: dutyPct,
        gstRatePct: gstPct,
      })
    : null;

  return (
    <div className="space-y-3">
      <Card title="Saved estimates" subtitle={est.job.id ? `Job ${est.job.ref}` : 'Not saved yet'}>
        {message && (
          <div className="px-4 pt-3">
            <Banner tone="info">{message}</Banner>
          </div>
        )}
        {results.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">
            Nothing saved against this job yet. Use Save job at the bottom of the screen — each save
            records the estimate as it stood, so you can see what was quoted and when.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {results.map((r) => (
              <li key={r.id} className="px-4 py-2 text-sm">
                <span className="tabular">{r.calculated_at.slice(0, 16).replace('T', ' ')}</span>
                {' — '}
                <span className="font-medium">{r.mode_selected}</span>{' '}
                <span className="tabular">{fmt.money(r.total_cost)}</span>
                {r.rate_card_id && (
                  <span className="ml-2 text-xs text-slate-400">rate {r.rate_card_id}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Actual vs estimate" subtitle="Enter the invoiced freight once the job closes">
        {!est.job.id ? (
          <p className="p-4 text-sm text-slate-500">Save the job first, then record the invoice against it.</p>
        ) : (
          <>
            <div className="grid gap-3 p-4 sm:grid-cols-4">
              <label className="block">
                <span className="label">Invoiced freight (AUD)</span>
                <NumInput value={actualCost} onChange={setActualCost} />
              </label>
              <label className="block">
                <span className="label">Invoice reference</span>
                <input className="field mt-1" value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} />
              </label>
              <div className="flex items-end">
                <button className="btn-primary" disabled={actualCost <= 0} onClick={() => void saveActual()}>
                  Record actual
                </button>
              </div>
              {variance && (
                <div>
                  <span className="label">Variance</span>
                  <div
                    className={`tabular text-lg font-semibold ${
                      Math.abs(variance.pct ?? 0) > 10 ? 'text-amber-700' : 'text-slate-800'
                    }`}
                  >
                    {variance.abs >= 0 ? '+' : ''}
                    {fmt.money(variance.abs)}{' '}
                    <span className="text-sm font-normal">({variance.pct?.toFixed(1)}%)</span>
                  </div>
                  <div className="text-xs text-slate-500">
                    estimate {fmt.money(latestEstimate)} vs actual {fmt.money(latestActual!)}
                  </div>
                </div>
              )}
            </div>
            {actuals.length > 0 && (
              <div className="border-t border-slate-200 px-4 py-2 text-xs text-slate-600">
                {actuals.map((a) => (
                  <div key={a.id} className="tabular">
                    {a.entered_at.slice(0, 10)} — {fmt.money(a.invoiced_cost)}
                    {a.invoice_ref && ` · ${a.invoice_ref}`}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Card>

      <Card
        title="Landed cost check"
        subtitle="Indicative only — not customs advice"
        actions={
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showLanded} onChange={(e) => setShowLanded(e.target.checked)} />
            Show
          </label>
        }
      >
        {showLanded && (
          <>
            <div className="grid gap-3 p-4 sm:grid-cols-4">
              <label className="block">
                <span className="label">Goods value (AUD)</span>
                <NumInput value={goodsValue} onChange={setGoodsValue} />
              </label>
              <label className="block">
                <span className="label">Insurance (AUD)</span>
                <NumInput value={insurance} onChange={setInsurance} />
              </label>
              <label className="block">
                <span className="label">Duty %</span>
                <NumInput value={dutyPct} onChange={setDutyPct} />
              </label>
              <label className="block">
                <span className="label">GST %</span>
                <NumInput value={gstPct} onChange={setGstPct} />
              </label>
            </div>
            {landed && (
              <>
                <table className="w-full border-t border-slate-200">
                  <tbody className="divide-y divide-slate-100">
                    {landed.lines.map((l) => (
                      <tr key={l.label}>
                        <td className="td">
                          <span title={l.formula} className="cursor-help border-b border-dotted border-slate-400">
                            {l.label}
                          </span>
                        </td>
                        <td className="td tabular w-40 text-right">{fmt.money(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                    <tr>
                      <td className="td font-semibold">Total landed cost</td>
                      <td className="td tabular text-right font-semibold">
                        {fmt.money(landed.totalLandedAud)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
                <p className="px-4 py-2 text-xs text-amber-800">{landed.disclaimer}</p>
              </>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
