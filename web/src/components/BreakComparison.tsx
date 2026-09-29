import { useMemo, useState } from 'react';
import { evaluateBreaks } from '@semcom/engine';
import type { QtyBreakResult } from '@semcom/engine';
import { useEstimate } from '../state/EstimateContext';
import { Banner, Card, fmt } from './ui';

/**
 * Every order quantity side by side.
 *
 * This is the answer a client is actually asking for: what does freight add per
 * unit at each order size, and where does it stop getting cheaper.
 */
export function BreakComparison() {
  const est = useEstimate();
  const [copied, setCopied] = useState(false);

  const results = useMemo<QtyBreakResult[]>(() => {
    if (est.lines.every((l) => l.qty <= 0 || l.lengthMm <= 0)) return [];
    const card = (mode: 'LCL' | 'FCL' | 'AIR') => est.activeRates.find((r) => r.mode === mode)?.card ?? undefined;
    return evaluateBreaks(est.lines, est.breaks, {
      containerTypes: est.containerTypes,
      lclCard: card('LCL'),
      fclCard: card('FCL'),
      airCard: card('AIR'),
      stowEfficiency: est.stowEfficiency,
      fxOverride: est.fxOverride ?? undefined,
      loadingMode: est.loadingMode,
      palletType: est.palletTypes.find((p) => p.id === est.palletTypeId) ?? null,
      palletOverrides: est.palletOverrides,
      palletTareKg: est.settings?.palletTareKg,
    });
  }, [
    est.lines,
    est.breaks,
    est.containerTypes,
    est.activeRates,
    est.stowEfficiency,
    est.fxOverride,
    est.loadingMode,
    est.palletTypes,
    est.palletTypeId,
    est.palletOverrides,
    est.settings,
  ]);

  const hasUnits = results.some((r) => r.metrics.totalUnits > 0);

  const copyTable = async () => {
    const header = [
      'Order quantity',
      'Cartons',
      hasUnits ? 'Units' : null,
      'CBM',
      'Chargeable CBM',
      'Gross kg',
      'Mode',
      'Basis',
      'Freight AUD',
      'Per carton',
      hasUnits ? 'Per unit' : null,
    ].filter(Boolean);
    const rows = results.map((r) =>
      [
        r.label,
        r.metrics.totalCartons,
        hasUnits ? r.metrics.totalUnits : null,
        r.metrics.totalVolumeCbm.toFixed(3),
        r.metrics.chargeableCbm.toFixed(3),
        r.metrics.totalWeightKg.toFixed(0),
        r.mode ?? '',
        r.containerSummary || (r.mode === 'LCL' ? `${r.metrics.chargeableCbm.toFixed(3)} CBM` : ''),
        r.totalAud?.toFixed(2) ?? '',
        r.freightPerCartonAud?.toFixed(2) ?? '',
        hasUnits ? (r.freightPerUnitAud?.toFixed(4) ?? '') : null,
      ].filter((_, i) => header[i] !== undefined),
    );
    await navigator.clipboard.writeText(
      [header.join('\t'), ...rows.map((r) => r.join('\t'))].join('\n'),
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 4000);
  };

  if (results.length === 0) {
    return (
      <Card title="Quantity breaks">
        <p className="p-4 text-sm text-slate-600">
          Enter cartons above, then add order quantities to compare. Freight per unit almost never
          scales proportionally — this shows where it stops getting cheaper.
        </p>
      </Card>
    );
  }

  const priced = results.filter((r) => r.totalAud != null);
  const best = priced.reduce<QtyBreakResult | null>(
    (b, r) => (b == null || (r.freightPerUnitAud ?? Infinity) < (b.freightPerUnitAud ?? Infinity) ? r : b),
    null,
  );

  return (
    <div className="space-y-3">
      <Card
        title="Freight at each order quantity"
        subtitle="Each quantity is packed and costed from scratch, cheapest mode per quantity"
        actions={
          <button className="btn-ghost" onClick={() => void copyTable()}>
            {copied ? 'Copied' : 'Copy for Excel'}
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Order quantity</th>
                <th className="th text-right">Cartons</th>
                {hasUnits && <th className="th text-right">Units</th>}
                <th className="th text-right">CBM</th>
                <th className="th text-right">Gross kg</th>
                <th className="th">Mode</th>
                <th className="th">Basis</th>
                <th className="th text-right">Freight AUD</th>
                <th className="th text-right">Per carton</th>
                {hasUnits && <th className="th text-right">Per unit</th>}
                {hasUnits && <th className="th text-right">vs base</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {results.map((r) => {
                const isActive = r.breakId === est.activeBreakId;
                return (
                  <tr
                    key={r.breakId}
                    className={`cursor-pointer ${isActive ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                    onClick={() => est.setActiveBreakId(r.breakId)}
                    title="Click to switch the estimator to this quantity"
                  >
                    <td className="td font-medium">
                      {r.label}
                      {best?.breakId === r.breakId && priced.length > 1 && (
                        <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-800">
                          best per unit
                        </span>
                      )}
                    </td>
                    <td className="td tabular text-right">{fmt.int(r.metrics.totalCartons)}</td>
                    {hasUnits && <td className="td tabular text-right">{fmt.int(r.metrics.totalUnits)}</td>}
                    <td className="td tabular text-right">{fmt.cbm(r.metrics.totalVolumeCbm)}</td>
                    <td className="td tabular text-right">{fmt.kg(r.metrics.totalWeightKg, 0)}</td>
                    <td className="td">{r.mode ?? <span className="text-slate-400">no rates</span>}</td>
                    <td className="td text-xs text-slate-600">
                      {r.mode === 'FCL'
                        ? r.containerSummary
                        : r.mode
                          ? `${fmt.cbm(r.metrics.chargeableCbm)} CBM chargeable`
                          : r.containerSummary}
                    </td>
                    <td className="td tabular text-right font-semibold">
                      {r.totalAud == null ? '—' : fmt.money(r.totalAud)}
                    </td>
                    <td className="td tabular text-right">
                      {r.freightPerCartonAud == null ? '—' : fmt.money(r.freightPerCartonAud)}
                    </td>
                    {hasUnits && (
                      <td className="td tabular text-right font-medium">
                        {r.freightPerUnitAud == null ? '—' : fmt.money(r.freightPerUnitAud, 'AUD', 4)}
                      </td>
                    )}
                    {hasUnits && (
                      <td
                        className={`td tabular text-right ${
                          (r.perUnitChangePct ?? 0) < -0.05
                            ? 'text-emerald-700'
                            : (r.perUnitChangePct ?? 0) > 0.05
                              ? 'text-red-700'
                              : 'text-slate-500'
                        }`}
                      >
                        {r.perUnitChangePct == null
                          ? '—'
                          : `${r.perUnitChangePct > 0 ? '+' : ''}${r.perUnitChangePct.toFixed(1)}%`}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {priced.length > 1 && hasUnits && best && (
        <Banner tone="info">
          <strong>{best.label}</strong> gives the lowest freight per unit at{' '}
          {fmt.money(best.freightPerUnitAud!, 'AUD', 4)}
          {best.perUnitChangePct != null && Math.abs(best.perUnitChangePct) > 0.05 && (
            <> — {Math.abs(best.perUnitChangePct).toFixed(1)}% below the quantity as entered</>
          )}
          . Freight per unit falls in steps, not smoothly: it drops hardest where the shipment
          switches mode or fills a container.
        </Banner>
      )}

      {results.some((r) => r.comparison.mixResult?.unplaced.length) && (
        <Banner tone="warning">
          Some quantities do not fit the containers available — check the Loading tab for those.
        </Banner>
      )}
    </div>
  );
}
