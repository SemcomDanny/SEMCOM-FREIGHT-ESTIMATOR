import { Suspense, lazy, useMemo } from 'react';
import { colorFor, containerCbm } from '@semcom/engine';
import { useEstimate } from '../state/EstimateContext';
import { NumInput } from './NumInput';
// three.js is only needed once the estimator looks at the container, so it is
// split out of the main bundle and fetched on demand.
const Viewer3D = lazy(() => import('./Viewer3D').then((m) => ({ default: m.Viewer3D })));
import { Banner, Card, fmt } from './ui';

export function LoadingPanel({ onImageCaptured }: { onImageCaptured?: (dataUrl: string) => void }) {
  const est = useEstimate();
  const { comparison, palletBuilds, loadingMode, palletTypes, palletTypeId } = est;
  const mixResult = comparison?.mixResult ?? null;
  const palletType = palletTypes.find((p) => p.id === palletTypeId);

  const legend = useMemo(() => {
    const counts = new Map<number, { label: string; count: number }>();
    for (const c of mixResult?.containers ?? []) {
      for (const p of c.placements) {
        const entry = counts.get(p.colorIndex);
        if (entry) entry.count += 1;
        else counts.set(p.colorIndex, { label: p.label, count: 1 });
      }
    }
    return [...counts.entries()]
      .map(([colorIndex, v]) => ({ colorIndex, ...v }))
      .sort((a, b) => a.colorIndex - b.colorIndex);
  }, [mixResult]);

  const totalPallets = palletBuilds.reduce((s, b) => s + b.palletCount, 0);
  const cubedCbm = palletBuilds.reduce((s, b) => s + b.cubedVolumeCbmTotal, 0);

  return (
    <div className="space-y-3">
      <Card title="Loading configuration">
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="label">Loading mode</span>
            <div className="mt-1 flex overflow-hidden rounded border border-slate-300">
              {(['floor', 'palletised'] as const).map((m) => (
                <button
                  key={m}
                  className={`flex-1 px-2 py-1.5 text-sm ${
                    loadingMode === m ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                  onClick={() => est.setLoadingMode(m)}
                >
                  {m === 'floor' ? 'Floor-loaded' : 'Palletised'}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="label">Stow efficiency</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="range"
                min={50}
                max={100}
                step={1}
                className="flex-1"
                value={Math.round(est.stowEfficiency * 100)}
                onChange={(e) => est.setStowEfficiency(Number(e.target.value) / 100)}
              />
              <span className="tabular w-12 text-right text-sm">{fmt.pct(est.stowEfficiency, 0)}</span>
            </div>
            <span className="mt-0.5 block text-xs text-slate-500">
              Applied to the theoretical fit — real containers never load to the geometric optimum.
            </span>
          </label>

          {loadingMode === 'palletised' && (
            <>
              <label className="block">
                <span className="label">Pallet type</span>
                <select
                  className="field mt-1"
                  value={palletTypeId}
                  onChange={(e) => est.setPalletTypeId(e.target.value)}
                >
                  {palletTypes.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.lMm} × {p.wMm} mm)
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="label">Max load h</span>
                  <NumInput
                    dp={0}
                    value={est.palletOverrides.maxLoadHMm ?? palletType?.maxLoadHMm ?? 0}
                    onChange={(v) => est.setPalletOverrides({ ...est.palletOverrides, maxLoadHMm: v })}
                  />
                </label>
                <label className="block">
                  <span className="label">Max kg</span>
                  <NumInput
                    dp={0}
                    value={est.palletOverrides.maxLoadKg ?? palletType?.maxLoadKg ?? 0}
                    onChange={(v) => est.setPalletOverrides({ ...est.palletOverrides, maxLoadKg: v })}
                  />
                </label>
                <label className="block">
                  <span className="label">Overhang</span>
                  <NumInput
                    dp={0}
                    value={est.palletOverrides.overhangMm ?? palletType?.overhangMm ?? 0}
                    onChange={(v) => est.setPalletOverrides({ ...est.palletOverrides, overhangMm: v })}
                  />
                </label>
              </div>
            </>
          )}
        </div>

        {loadingMode === 'palletised' && palletBuilds.length > 0 && (
          <div className="border-t border-slate-200">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="th">Carton</th>
                    <th className="th text-right">Per layer</th>
                    <th className="th text-right">Layers</th>
                    <th className="th text-right">Per pallet</th>
                    <th className="th text-right">Pallets</th>
                    <th className="th text-right">Loaded height</th>
                    <th className="th text-right">Pallet gross</th>
                    <th className="th text-right">Cubed CBM</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {palletBuilds.map((b) => (
                    <tr key={b.lineId}>
                      <td className="td">
                        <span className="flex items-center gap-1.5">
                          <span
                            className="inline-block h-3 w-3 rounded-sm"
                            style={{ backgroundColor: colorFor(b.colorIndex) }}
                          />
                          {b.description || 'Carton'}
                        </span>
                      </td>
                      <td className="td tabular text-right">{b.cartonsPerLayer}</td>
                      <td className="td tabular text-right">{b.layers}</td>
                      <td className="td tabular text-right">{b.cartonsPerPallet}</td>
                      <td className="td tabular text-right font-medium">
                        {b.palletCount}
                        {b.remainderCartons > 0 && (
                          <span className="ml-1 text-xs font-normal text-slate-500">
                            (incl. 1 part pallet of {b.remainderCartons})
                          </span>
                        )}
                      </td>
                      <td className="td tabular text-right">{Math.round(b.loadedHeightMm)} mm</td>
                      <td className="td tabular text-right">{fmt.kg(b.palletGrossKg, 0)} kg</td>
                      <td className="td tabular text-right">{fmt.cbm(b.cubedVolumeCbmTotal)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                  <tr>
                    <td className="td font-semibold" colSpan={4}>
                      Total
                    </td>
                    <td className="td tabular text-right font-semibold">{totalPallets}</td>
                    <td className="td" colSpan={2} />
                    <td className="td tabular text-right font-semibold">{fmt.cbm(cubedCbm)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="px-4 py-2 text-xs text-slate-500">
              Cubed volume is the pallet footprint × loaded height — that, not the carton volume, is what
              governs container fit. {fmt.cbm(cubedCbm)} CBM cubed against{' '}
              {fmt.cbm(est.metrics.totalVolumeCbm)} CBM of cartons.
            </p>
          </div>
        )}
      </Card>

      {mixResult && mixResult.mix.length === 0 && (
        <Banner tone="info">
          Nothing to load yet — enter cartons with dimensions and quantities above.
        </Banner>
      )}

      {mixResult && mixResult.mix.length > 0 && (
        <Card
          title="Container fit"
          subtitle={mixResult.mix.map((m) => `${m.count} × ${m.containerTypeName}`).join(' + ')}
          actions={
            <span className="text-xs text-slate-500">
              Estimate only — actual stow subject to forwarder/packer
            </span>
          }
        >
          <div className="grid gap-3 px-4 py-3 sm:grid-cols-3">
            <div>
              <div className="label">Volumetric utilisation</div>
              <div className="tabular text-lg font-semibold">{fmt.pct(mixResult.meanVolumeUtilisation)}</div>
            </div>
            <div>
              <div className="label">Payload utilisation</div>
              <div className="tabular text-lg font-semibold">{fmt.pct(mixResult.meanPayloadUtilisation)}</div>
            </div>
            <div>
              <div className="label">Loaded</div>
              <div className="tabular text-lg font-semibold">
                {fmt.cbm(mixResult.totalPlacedVolumeCbm)} CBM / {fmt.kg(mixResult.totalPlacedWeightKg, 0)} kg
              </div>
            </div>
          </div>

          {mixResult.unplaced.length > 0 && (
            <div className="px-4 pb-3">
              <Banner tone="error">
                <strong>Did not fit:</strong>{' '}
                {mixResult.unplaced.map((u) => `${u.qty} × ${u.label} (${u.reason})`).join('; ')}
              </Banner>
            </div>
          )}

          <div className="border-t border-slate-200">
            <Suspense
              fallback={
                <div className="flex h-[420px] items-center justify-center bg-slate-900/95 text-sm text-slate-300">
                  Loading 3D view…
                </div>
              }
            >
              <Viewer3D
                containers={mixResult.containers}
                containerTypes={est.containerTypes}
                legend={legend}
                title={est.job.ref || 'container-load'}
                onImageCaptured={onImageCaptured}
              />
            </Suspense>
          </div>

          <div className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
            Nominal capacities:{' '}
            {est.containerTypes
              .map((c) => `${c.name} ${fmt.cbm(containerCbm(c), 1)} CBM / ${fmt.kg(c.maxPayloadKg, 0)} kg`)
              .join(' · ')}
          </div>
        </Card>
      )}
    </div>
  );
}
