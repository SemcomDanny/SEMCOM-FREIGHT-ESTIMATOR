import { useEstimate } from '../state/EstimateContext';
import { Banner, Explain, Stat, fmt } from './ui';

/** The always-visible numbers: this is what the estimator is here for. */
export function Totals() {
  const { metrics, issues } = useEstimate();
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  return (
    <div className="space-y-2">
      <div className="card grid grid-cols-2 divide-x divide-y divide-slate-100 sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
        <Stat label="Cartons" value={fmt.int(metrics.totalCartons)} />
        <Stat label="Total volume" value={fmt.cbm(metrics.totalVolumeCbm)} unit="CBM" />
        <Stat label="Gross weight" value={fmt.kg(metrics.totalWeightKg)} unit="kg" />
        <Stat
          label="Density"
          value={fmt.kg(metrics.densityKgPerCbm, 0)}
          unit="kg/CBM"
          tone={metrics.weightCharged ? 'warning' : 'default'}
          hint={metrics.weightCharged ? 'over 1,000 — weight charged' : undefined}
        />
        <div className="px-3 py-2">
          <div className="label">
            <Explain
              formula={`chargeable = max(total volume ${fmt.cbm(metrics.totalVolumeCbm)} CBM, gross weight ${fmt.kg(
                metrics.totalWeightKg,
                0,
              )} kg / 1000) = ${fmt.cbm(metrics.chargeableCbm)} revenue tonnes`}
            >
              Chargeable (W/M)
            </Explain>
          </div>
          <div className="tabular text-xl font-semibold text-blue-700">
            {fmt.cbm(metrics.chargeableCbm)}
            <span className="ml-1 text-sm font-normal text-slate-500">CBM</span>
          </div>
          <div className="text-xs text-slate-500">
            {metrics.chargeableBasis === 'weight' ? 'weight-based' : 'volume-based'}
          </div>
        </div>
        <Stat
          label="Units"
          value={metrics.totalUnits > 0 ? fmt.int(metrics.totalUnits) : '—'}
          hint={metrics.totalUnits > 0 ? 'for per-unit allocation' : 'enter units/ctn'}
        />
      </div>

      {metrics.weightCharged && (
        <Banner tone="warning">
          <strong>Weight-charged consignment.</strong> At {fmt.kg(metrics.densityKgPerCbm, 0)} kg/CBM this
          cargo bills on {fmt.cbm(metrics.chargeableCbm)} revenue tonnes, not its{' '}
          {fmt.cbm(metrics.totalVolumeCbm)} CBM. Quote the chargeable figure, not the actual volume.
        </Banner>
      )}

      {errors.length > 0 && (
        <Banner tone="error">
          <strong>{errors.length} problem(s) to fix:</strong>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {errors.slice(0, 6).map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
        </Banner>
      )}

      {warnings.length > 0 && (
        <details className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <summary className="cursor-pointer font-medium">
            {warnings.length} warning(s) — worth a look before you quote
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {warnings.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
