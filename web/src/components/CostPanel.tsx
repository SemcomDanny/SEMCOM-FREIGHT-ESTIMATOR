import { useMemo } from 'react';
import type { CostEstimate, ShipMode } from '@semcom/engine';
import { useEstimate } from '../state/EstimateContext';
import { Banner, Card, Explain, fmt } from './ui';

const MODE_LABEL: Record<ShipMode, string> = { LCL: 'LCL (sea)', FCL: 'FCL (sea)', AIR: 'Airfreight' };

export function CostPanel() {
  const est = useEstimate();
  const { comparison, metrics, selectedMode, activeRates, settings } = est;

  const selected = useMemo<CostEstimate | null>(() => {
    if (!comparison) return null;
    return comparison.estimates.find((e) => e.mode === selectedMode) ?? comparison.estimates[0] ?? null;
  }, [comparison, selectedMode]);

  if (!comparison || comparison.estimates.length === 0) {
    return (
      <Card title="Cost estimate">
        <div className="p-4 text-sm text-slate-600">
          {metrics.totalVolumeCbm <= 0
            ? 'Enter carton dimensions and quantities to price this consignment.'
            : 'No rate card is in force for this lane. An admin can add one under Rates.'}
        </div>
      </Card>
    );
  }

  const staleModes = activeRates.filter((r) => r.stale && r.card);

  return (
    <div className="space-y-3">
      {est.forecastMethod !== 'latest' && (
        <Banner tone="warning">
          <strong>Forecast basis — not a quoted rate.</strong> Freight is priced on the{' '}
          {est.rateBasisLabel.replace('Forecast — ', '')}
          {Object.keys(est.forecastRatios).length > 0 && (
            <>
              {' '}(
              {Object.entries(est.forecastRatios)
                .map(([mode, ratio]) => `${mode} ${(ratio! * 100 - 100 >= 0 ? '+' : '')}${(ratio! * 100 - 100).toFixed(1)}%`)
                .join(', ')}{' '}
              against the latest quote)
            </>
          )}
          . Label it clearly if it reaches a client.
        </Banner>
      )}

      {staleModes.length > 0 && (
        <Banner tone="warning">
          <strong>Stale rates.</strong>{' '}
          {staleModes.map((r) => r.mode).join(', ')} rate{staleModes.length > 1 ? 's are' : ' is'} older than{' '}
          {settings?.staleRateDays ?? 60} days. Re-quote the forwarder before this goes to a client.
        </Banner>
      )}

      <Card
        title="Recommended mode"
        subtitle={comparison.reason}
        actions={
          <div className="flex overflow-hidden rounded border border-slate-300">
            {comparison.estimates.map((e) => (
              <button
                key={e.mode}
                onClick={() => est.setSelectedMode(e.mode)}
                className={`px-3 py-1.5 text-sm ${
                  selected?.mode === e.mode
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {e.mode}
                {comparison.recommended === e.mode && (
                  <span className={selected?.mode === e.mode ? 'ml-1 text-blue-100' : 'ml-1 text-emerald-600'}>
                    ✓
                  </span>
                )}
              </button>
            ))}
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Mode</th>
                <th className="th">Basis</th>
                <th className="th text-right">Ocean / air</th>
                <th className="th text-right">Origin + dest</th>
                <th className="th text-right">Ancillaries</th>
                <th className="th text-right">Total</th>
                <th className="th text-right">Total AUD</th>
                <th className="th text-right">Per CBM</th>
                <th className="th text-right">Per carton</th>
                <th className="th text-right">Per unit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {comparison.estimates.map((e) => {
                const isSelected = selected?.mode === e.mode;
                return (
                  <tr
                    key={e.mode}
                    className={`cursor-pointer ${isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                    onClick={() => est.setSelectedMode(e.mode)}
                  >
                    <td className="td font-medium">
                      {MODE_LABEL[e.mode]}
                      {comparison.recommended === e.mode && (
                        <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-800">
                          cheapest
                        </span>
                      )}
                    </td>
                    <td className="td text-slate-600">{e.basis}</td>
                    <td className="td tabular text-right">{fmt.money(e.oceanCost, e.currency)}</td>
                    <td className="td tabular text-right">
                      {e.portChargesCost > 0 ? fmt.money(e.portChargesCost, e.currency) : '—'}
                    </td>
                    <td className="td tabular text-right">{fmt.money(e.ancillariesCost, e.currency)}</td>
                    <td className="td tabular text-right font-semibold">{fmt.money(e.total, e.currency)}</td>
                    <td className="td tabular text-right">{fmt.money(e.totalAud)}</td>
                    <td className="td tabular text-right">{fmt.money(e.costPerCbm, e.currency)}</td>
                    <td className="td tabular text-right">{fmt.money(e.costPerCarton, e.currency)}</td>
                    <td className="td tabular text-right">
                      {e.costPerUnit == null ? '—' : fmt.money(e.costPerUnit, e.currency, 4)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {selected && (
        <Card
          title={`${MODE_LABEL[selected.mode]} breakdown`}
          subtitle={`${selected.basis} · every line shows its formula and rate version on hover`}
          actions={
            <label className="flex items-center gap-1.5 text-xs">
              <span className="text-slate-500">FX to AUD</span>
              <input
                className="num w-20 py-1"
                value={est.fxOverride ?? selected.fxToAud}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  est.setFxOverride(Number.isFinite(v) && v > 0 ? v : null);
                }}
              />
              {est.fxOverride !== null && (
                <button className="text-blue-600 underline" onClick={() => est.setFxOverride(null)}>
                  reset
                </button>
              )}
            </label>
          }
        >
          <table className="w-full">
            <tbody className="divide-y divide-slate-100">
              {selected.components.map((c, i) => (
                <tr key={i}>
                  <td className="td">
                    <Explain formula={c.formula} source={c.sourceRateCardId}>
                      {c.label}
                    </Explain>
                  </td>
                  <td className="td tabular w-32 text-right">{fmt.money(c.amount, selected.currency)}</td>
                  <td className="td tabular w-32 text-right text-slate-500">{fmt.money(c.amountAud)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 bg-slate-50">
              <tr>
                <td className="td font-semibold">Total</td>
                <td className="td tabular text-right font-semibold">
                  {fmt.money(selected.total, selected.currency)}
                </td>
                <td className="td tabular text-right font-semibold">{fmt.money(selected.totalAud)}</td>
              </tr>
            </tfoot>
          </table>

          {selected.warnings.length > 0 && (
            <div className="border-t border-slate-200 px-4 py-2">
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-800">
                {selected.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {comparison.breakeven && (
        <Card title="Breakeven volume">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2 p-4">
            <div>
              <div className="label">FCL becomes cheaper at</div>
              <div className="tabular text-2xl font-semibold text-blue-700">
                {fmt.cbm(comparison.breakeven.volumeCbm)} <span className="text-base font-normal">CBM</span>
              </div>
            </div>
            <div className="text-sm text-slate-600">
              <div>
                At that volume: LCL{' '}
                <strong className="tabular">{fmt.money(comparison.breakeven.lclTotal)}</strong> vs FCL{' '}
                <strong className="tabular">{fmt.money(comparison.breakeven.fclTotal)}</strong> (
                {comparison.breakeven.containerMix})
              </div>
              <div className="mt-1 text-xs text-slate-500">{comparison.breakeven.note}</div>
              <div className="mt-1 text-xs">
                {metrics.chargeableCbm < comparison.breakeven.volumeCbm ? (
                  <>
                    This consignment is{' '}
                    <strong>{fmt.cbm(comparison.breakeven.volumeCbm - metrics.chargeableCbm)} CBM</strong>{' '}
                    short of the breakeven — worth asking whether the client can increase the order.
                  </>
                ) : (
                  <>This consignment is already past the breakeven, so FCL is the right basis.</>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
