import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  SEED_ANCILLARY_NAMES,
  SEED_AIR_RATE,
  fitLclCurve,
  isMonotonic,
  sampleCurve,
} from '@semcom/engine';
import type { AncillaryBasis, FitModel, LclPoint, RateCard, ShipMode } from '@semcom/engine';
import { api } from '../api';
import type { ContainerTypeRow, Lane, RateCardRow } from '../api';
import { useAuth } from '../state/AuthContext';
import { NumInput } from '../components/NumInput';
import { Banner, Card, fmt } from '../components/ui';
import { RfqRequests } from '../components/RfqRequests';

interface AncillaryDraft {
  name: string;
  basis: AncillaryBasis;
  amount: number;
}

const BASES: AncillaryBasis[] = ['per_shipment', 'per_cbm', 'per_container', 'per_kg'];
const FIT_MODELS: { value: FitModel; label: string; hint: string }[] = [
  {
    value: 'piecewise_linear',
    label: 'Monotone piecewise linear',
    hint: 'Passes through every quoted point exactly. Extrapolates off each end at the adjacent slope.',
  },
  {
    value: 'log_linear',
    label: 'Log-linear (a + b·ln V)',
    hint: 'Smooth taper that usually matches how LCL rates actually behave at volume.',
  },
  {
    value: 'power',
    label: 'Power (a·V^b)',
    hint: 'Constant elasticity — a good fit when the per-CBM rate falls at a steady percentage.',
  },
];

export function Rates() {
  const { isAdmin } = useAuth();
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [containerTypes, setContainerTypes] = useState<ContainerTypeRow[]>([]);
  const [laneId, setLaneId] = useState('');
  const [mode, setMode] = useState<ShipMode>('LCL');
  const [versions, setVersions] = useState<RateCardRow[]>([]);
  const [viewing, setViewing] = useState<RateCard | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  /* Draft state for a new version -------------------------------- */
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [currency, setCurrency] = useState('AUD');
  const [fxToAud, setFxToAud] = useState(1);
  const [note, setNote] = useState('');
  const [points, setPoints] = useState<LclPoint[]>([
    { volumeCbm: 1, totalPrice: 0 },
    { volumeCbm: 5, totalPrice: 0 },
    { volumeCbm: 15, totalPrice: 0 },
  ]);
  const [fitModel, setFitModel] = useState<FitModel>('piecewise_linear');
  const [minCharge, setMinCharge] = useState(0);
  const [minCbm, setMinCbm] = useState(1);
  const [fclRows, setFclRows] = useState<Record<string, { ocean: number; origin: number; dest: number }>>({});
  const [air, setAir] = useState(SEED_AIR_RATE);
  const [ancillaries, setAncillaries] = useState<AncillaryDraft[]>([]);

  useEffect(() => {
    void Promise.all([
      api.get<Lane[]>('/master/lanes'),
      api.get<ContainerTypeRow[]>('/master/container-types'),
    ]).then(([laneRows, containers]) => {
      setLanes(laneRows);
      setContainerTypes(containers.filter((c) => c.active === 1));
      if (laneRows.length > 0) setLaneId((prev) => prev || laneRows[0]!.id);
    });
  }, []);

  const loadVersions = useCallback(() => {
    if (!laneId) return;
    void api
      .get<RateCardRow[]>(`/rates/cards?laneId=${encodeURIComponent(laneId)}&mode=${mode}`)
      .then((rows) => {
        setVersions(rows);
        if (rows.length > 0) {
          void api.get<RateCard>(`/rates/cards/${rows[0]!.id}`).then(setViewing);
        } else {
          setViewing(null);
        }
      });
  }, [laneId, mode]);

  useEffect(() => loadVersions(), [loadVersions]);

  /* Curve preview, recalculated as the admin types ---------------- */
  const usablePoints = points.filter((p) => p.volumeCbm > 0 && p.totalPrice > 0);
  const curve = useMemo(() => fitLclCurve(usablePoints, fitModel), [usablePoints, fitModel]);
  const config = useMemo(() => ({ fitModel, minCharge, minCbm }), [fitModel, minCharge, minCbm]);
  const chartData = useMemo(() => {
    if (usablePoints.length < 2) return [];
    const maxV = Math.max(25, ...usablePoints.map((p) => p.volumeCbm * 1.7));
    return sampleCurve(curve, config, 0.5, maxV, 90).map((s) => ({
      volume: Number(s.volumeCbm.toFixed(2)),
      price: Number(s.price.toFixed(2)),
    }));
  }, [curve, config, usablePoints]);
  const monotonic = useMemo(
    () => (usablePoints.length >= 2 ? isMonotonic(curve, 0.1, 200) : true),
    [curve, usablePoints],
  );

  const flash = (tone: 'success' | 'error', text: string) => {
    setMessage({ tone, text });
    setTimeout(() => setMessage(null), 6000);
  };

  const save = async () => {
    try {
      const body: Record<string, unknown> = {
        laneId,
        mode,
        currency,
        fxToAud,
        effectiveFrom,
        note: note || undefined,
        ancillaries: ancillaries.filter((a) => a.name && a.amount !== 0),
      };
      if (mode === 'LCL') {
        body.lclPoints = usablePoints;
        body.lclConfig = { fitModel, minCharge, minCbm };
      }
      if (mode === 'FCL') {
        body.fcl = Object.entries(fclRows)
          .filter(([, v]) => v.ocean > 0 || v.origin > 0 || v.dest > 0)
          .map(([containerTypeId, v]) => ({
            containerTypeId,
            oceanCost: v.ocean,
            originCharges: v.origin,
            destCharges: v.dest,
          }));
      }
      if (mode === 'AIR') body.air = air;

      await api.post('/rates/cards', body);
      flash('success', 'New rate version saved. The previous version is retained and still queryable.');
      setNote('');
      loadVersions();
    } catch (err) {
      flash('error', (err as Error).message);
    }
  };

  const prefillFromCurrent = () => {
    if (!viewing) return;
    setCurrency(viewing.currency);
    setFxToAud(viewing.fxToAud);
    if (viewing.lclPoints?.length) setPoints(viewing.lclPoints.map((p) => ({ ...p })));
    if (viewing.lclConfig) {
      setFitModel(viewing.lclConfig.fitModel);
      setMinCharge(viewing.lclConfig.minCharge ?? 0);
      setMinCbm(viewing.lclConfig.minCbm ?? 0);
    }
    if (viewing.fcl?.length) {
      const rows: Record<string, { ocean: number; origin: number; dest: number }> = {};
      for (const f of viewing.fcl) {
        rows[f.containerTypeId] = { ocean: f.oceanCost, origin: f.originCharges, dest: f.destCharges };
      }
      setFclRows(rows);
    }
    if (viewing.air) setAir(viewing.air);
    setAncillaries(
      (viewing.ancillaries ?? []).map((a) => ({ name: a.name, basis: a.basis, amount: a.amount })),
    );
    flash('success', 'Copied the current version into the form — edit and save as a new version.');
  };

  const scatterData = usablePoints.map((p) => ({ volume: p.volumeCbm, price: p.totalPrice }));

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
        {!isAdmin && (
          <span className="ml-auto text-sm text-slate-500">
            Read-only — rate changes need the admin role.
          </span>
        )}
      </div>

      {message && <Banner tone={message.tone === 'success' ? 'success' : 'error'}>{message.text}</Banner>}

      {laneId && (
        <RfqRequests
          laneId={laneId}
          laneLabel={
            lanes.find((l) => l.id === laneId)
              ? `${lanes.find((l) => l.id === laneId)!.origin_port} → ${lanes.find((l) => l.id === laneId)!.destination_port}`
              : ''
          }
          onImported={loadVersions}
        />
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <Card
          title="Versions"
          subtitle="Every change is a new version — nothing is overwritten"
          actions={
            isAdmin && viewing ? (
              <button className="btn-ghost" onClick={prefillFromCurrent}>
                Copy into form
              </button>
            ) : null
          }
        >
          {versions.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">No {mode} rates entered for this lane yet.</p>
          ) : (
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Effective from</th>
                  <th className="th">Currency</th>
                  <th className="th">Entered by</th>
                  <th className="th">Note</th>
                  <th className="th">State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {versions.map((v) => (
                  <tr
                    key={v.id}
                    className={`cursor-pointer ${viewing?.id === v.id ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                    onClick={() => void api.get<RateCard>(`/rates/cards/${v.id}`).then(setViewing)}
                  >
                    <td className="td tabular">{v.effective_from}</td>
                    <td className="td">
                      {v.currency}
                      {v.currency !== 'AUD' && (
                        <span className="tabular ml-1 text-xs text-slate-500">@{v.fx_to_aud}</span>
                      )}
                    </td>
                    <td className="td text-slate-600">{v.entered_by_name ?? '—'}</td>
                    <td className="td text-xs text-slate-600">{v.note ?? '—'}</td>
                    <td className="td">
                      {v.superseded_by ? (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-600">
                          superseded
                        </span>
                      ) : (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] uppercase text-emerald-800">
                          current
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Selected version" subtitle={viewing ? viewing.id : 'nothing selected'}>
          {!viewing ? (
            <p className="p-4 text-sm text-slate-500">Select a version to inspect its rates.</p>
          ) : (
            <div className="space-y-3 p-4 text-sm">
              {viewing.mode === 'LCL' && (
                <>
                  <div>
                    <div className="label">Quoted points</div>
                    <ul className="tabular mt-1">
                      {viewing.lclPoints?.map((p, i) => (
                        <li key={i}>
                          {p.volumeCbm} CBM → {fmt.money(p.totalPrice, viewing.currency)}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="text-slate-600">
                    Fit: {viewing.lclConfig?.fitModel} · min {viewing.lclConfig?.minCbm} CBM · floor{' '}
                    {fmt.money(viewing.lclConfig?.minCharge ?? 0, viewing.currency)}
                  </div>
                </>
              )}
              {viewing.mode === 'FCL' && (
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="th">Container</th>
                      <th className="th text-right">Ocean</th>
                      <th className="th text-right">Origin</th>
                      <th className="th text-right">Destination</th>
                      <th className="th text-right">All-in</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {viewing.fcl?.map((f) => (
                      <tr key={f.containerTypeId}>
                        <td className="td">
                          {containerTypes.find((c) => c.id === f.containerTypeId)?.name ?? f.containerTypeId}
                        </td>
                        <td className="td tabular text-right">{fmt.money(f.oceanCost, viewing.currency)}</td>
                        <td className="td tabular text-right">{fmt.money(f.originCharges, viewing.currency)}</td>
                        <td className="td tabular text-right">{fmt.money(f.destCharges, viewing.currency)}</td>
                        <td className="td tabular text-right font-medium">
                          {fmt.money(f.oceanCost + f.originCharges + f.destCharges, viewing.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {viewing.mode === 'AIR' && viewing.air && (
                <div>
                  <div className="label">Weight breaks</div>
                  <ul className="tabular mt-1">
                    {viewing.air.breaks.map((b, i) => (
                      <li key={i}>
                        {b.thresholdKg === 0 ? 'under 45' : `+${b.thresholdKg}`} kg →{' '}
                        {fmt.money(b.ratePerKg, viewing.currency)}/kg
                      </li>
                    ))}
                  </ul>
                  <div className="mt-1 text-slate-600">
                    Min {fmt.money(viewing.air.minCharge, viewing.currency)} · fuel{' '}
                    {fmt.money(viewing.air.fuelSurchargePerKg, viewing.currency)}/kg · security{' '}
                    {fmt.money(viewing.air.securitySurchargePerKg, viewing.currency)}/kg · divisor{' '}
                    {viewing.air.volumetricDivisor}
                  </div>
                </div>
              )}
              {(viewing.ancillaries?.length ?? 0) > 0 && (
                <div>
                  <div className="label">Ancillary charges</div>
                  <ul className="mt-1">
                    {viewing.ancillaries!.map((a, i) => (
                      <li key={i} className="tabular">
                        {a.name}: {fmt.money(a.amount, viewing.currency)} {a.basis.replace('_', ' ')}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {isAdmin && (
        <Card
          title={`New ${mode} version`}
          subtitle="Saving creates a new version; the current one is kept and stays on the history chart"
          actions={
            <button className="btn-primary" onClick={() => void save()}>
              Save new version
            </button>
          }
        >
          <div className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-4">
            <label className="block">
              <span className="label">Effective from</span>
              <input
                type="date"
                className="field mt-1"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="label">Currency</span>
              <input className="field mt-1" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
            </label>
            <label className="block">
              <span className="label">FX to AUD</span>
              <NumInput value={fxToAud} dp={4} onChange={setFxToAud} />
            </label>
            <label className="block">
              <span className="label">Note</span>
              <input
                className="field mt-1"
                placeholder="quoted by ForwarderCo, ref 12345"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          </div>

          {mode === 'LCL' && (
            <div className="grid gap-4 p-4 lg:grid-cols-2">
              <div>
                <div className="label mb-1">Volume / price points (three minimum, more is better)</div>
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="th text-right">CBM</th>
                      <th className="th text-right">Total price</th>
                      <th className="th text-right">Implied /CBM</th>
                      <th className="th w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {points.map((p, i) => (
                      <tr key={i}>
                        <td className="td">
                          <NumInput
                            value={p.volumeCbm}
                            onChange={(v) =>
                              setPoints((prev) => prev.map((x, xi) => (xi === i ? { ...x, volumeCbm: v } : x)))
                            }
                          />
                        </td>
                        <td className="td">
                          <NumInput
                            value={p.totalPrice}
                            onChange={(v) =>
                              setPoints((prev) => prev.map((x, xi) => (xi === i ? { ...x, totalPrice: v } : x)))
                            }
                          />
                        </td>
                        <td className="td tabular text-right text-slate-600">
                          {p.volumeCbm > 0 ? fmt.money(p.totalPrice / p.volumeCbm, currency) : '—'}
                        </td>
                        <td className="td">
                          <button
                            className="rounded px-1.5 text-red-600 hover:bg-red-50"
                            onClick={() => setPoints((prev) => prev.filter((_, xi) => xi !== i))}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button
                  className="btn-ghost mt-2"
                  onClick={() => setPoints((prev) => [...prev, { volumeCbm: 0, totalPrice: 0 }])}
                >
                  + Add point
                </button>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <label className="block sm:col-span-3">
                    <span className="label">Fit model</span>
                    <select
                      className="field mt-1"
                      value={fitModel}
                      onChange={(e) => setFitModel(e.target.value as FitModel)}
                    >
                      {FIT_MODELS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {FIT_MODELS.find((m) => m.value === fitModel)?.hint}
                    </span>
                  </label>
                  <label className="block">
                    <span className="label">Minimum CBM</span>
                    <NumInput value={minCbm} onChange={setMinCbm} />
                  </label>
                  <label className="block">
                    <span className="label">Minimum charge</span>
                    <NumInput value={minCharge} onChange={setMinCharge} />
                  </label>
                </div>
              </div>

              <div>
                <div className="label mb-1">Fitted curve</div>
                {chartData.length === 0 ? (
                  <div className="flex h-64 items-center justify-center rounded border border-dashed border-slate-300 text-sm text-slate-500">
                    Enter at least two points to see the curve.
                  </div>
                ) : (
                  <>
                    <div className="h-64 w-full">
                      <ResponsiveContainer>
                        <ScatterChart margin={{ top: 8, right: 12, bottom: 24, left: 8 }}>
                          <CartesianGrid stroke="#e2e8f0" />
                          <XAxis
                            type="number"
                            dataKey="volume"
                            name="CBM"
                            tick={{ fontSize: 11 }}
                            label={{ value: 'CBM', position: 'insideBottom', offset: -10, fontSize: 11 }}
                          />
                          <YAxis type="number" dataKey="price" tick={{ fontSize: 11 }} width={64} />
                          <Tooltip
                            formatter={(v: number) => fmt.money(v, currency)}
                            labelFormatter={(v) => `${v} CBM`}
                          />
                          <Legend wrapperStyle={{ fontSize: 11 }} verticalAlign="top" height={22} />
                          <Scatter name="Fitted curve" data={chartData} line fill="#2563eb" shape={() => <g />} />
                          <Scatter name="Quoted points" data={scatterData} fill="#dc2626" />
                        </ScatterChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-2 space-y-1 text-xs">
                      <div className="text-slate-600">
                        {curve.describe()} · R² <span className="tabular">{curve.r2.toFixed(4)}</span>
                      </div>
                      <div className="tabular text-slate-600">
                        Residuals:{' '}
                        {curve.residuals.map((r, i) => `${usablePoints[i]?.volumeCbm} CBM ${r >= 0 ? '+' : ''}${r.toFixed(2)}`).join(' · ')}
                      </div>
                      <div className="tabular text-slate-600">
                        At 0.5 CBM {fmt.money(curve.priceAt(0.5), currency)} · at 25 CBM{' '}
                        {fmt.money(curve.priceAt(25), currency)}
                      </div>
                      {!monotonic && (
                        <Banner tone="error">
                          This fit falls somewhere in range — more cargo would price cheaper. Do not save it.
                        </Banner>
                      )}
                      {curve.warnings.map((w, i) => (
                        <Banner key={i} tone="warning">
                          {w}
                        </Banner>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {mode === 'FCL' && (
            <div className="p-4">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="th">Container</th>
                    <th className="th text-right">Ocean freight</th>
                    <th className="th text-right">Origin charges</th>
                    <th className="th text-right">Destination (THC, wharfage, docs, ISPS)</th>
                    <th className="th text-right">All-in</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {containerTypes.map((c) => {
                    const row = fclRows[c.id] ?? { ocean: 0, origin: 0, dest: 0 };
                    const set = (patch: Partial<typeof row>) =>
                      setFclRows((prev) => ({ ...prev, [c.id]: { ...row, ...patch } }));
                    return (
                      <tr key={c.id}>
                        <td className="td font-medium">{c.name}</td>
                        <td className="td">
                          <NumInput value={row.ocean} onChange={(v) => set({ ocean: v })} />
                        </td>
                        <td className="td">
                          <NumInput value={row.origin} onChange={(v) => set({ origin: v })} />
                        </td>
                        <td className="td">
                          <NumInput value={row.dest} onChange={(v) => set({ dest: v })} />
                        </td>
                        <td className="td tabular text-right font-medium">
                          {fmt.money(row.ocean + row.origin + row.dest, currency)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {mode === 'AIR' && (
            <div className="grid gap-4 p-4 lg:grid-cols-2">
              <div>
                <div className="label mb-1">Weight breaks</div>
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="th text-right">Break (kg)</th>
                      <th className="th text-right">Rate per kg</th>
                      <th className="th w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {air.breaks.map((b, i) => (
                      <tr key={i}>
                        <td className="td">
                          <NumInput
                            dp={0}
                            value={b.thresholdKg}
                            onChange={(v) =>
                              setAir((prev) => ({
                                ...prev,
                                breaks: prev.breaks.map((x, xi) => (xi === i ? { ...x, thresholdKg: v } : x)),
                              }))
                            }
                          />
                        </td>
                        <td className="td">
                          <NumInput
                            dp={3}
                            value={b.ratePerKg}
                            onChange={(v) =>
                              setAir((prev) => ({
                                ...prev,
                                breaks: prev.breaks.map((x, xi) => (xi === i ? { ...x, ratePerKg: v } : x)),
                              }))
                            }
                          />
                        </td>
                        <td className="td">
                          <button
                            className="rounded px-1.5 text-red-600 hover:bg-red-50"
                            onClick={() =>
                              setAir((prev) => ({ ...prev, breaks: prev.breaks.filter((_, xi) => xi !== i) }))
                            }
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button
                  className="btn-ghost mt-2"
                  onClick={() => setAir((prev) => ({ ...prev, breaks: [...prev.breaks, { thresholdKg: 0, ratePerKg: 0 }] }))}
                >
                  + Add break
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="label">Minimum charge</span>
                  <NumInput value={air.minCharge} onChange={(v) => setAir((p) => ({ ...p, minCharge: v }))} />
                </label>
                <label className="block">
                  <span className="label">Volumetric divisor</span>
                  <NumInput
                    dp={0}
                    value={air.volumetricDivisor}
                    onChange={(v) => setAir((p) => ({ ...p, volumetricDivisor: v || 6000 }))}
                  />
                </label>
                <label className="block">
                  <span className="label">Fuel surcharge / kg</span>
                  <NumInput
                    dp={3}
                    value={air.fuelSurchargePerKg}
                    onChange={(v) => setAir((p) => ({ ...p, fuelSurchargePerKg: v }))}
                  />
                </label>
                <label className="block">
                  <span className="label">Security surcharge / kg</span>
                  <NumInput
                    dp={3}
                    value={air.securitySurchargePerKg}
                    onChange={(v) => setAir((p) => ({ ...p, securitySurchargePerKg: v }))}
                  />
                </label>
              </div>
            </div>
          )}

          <div className="border-t border-slate-200 p-4">
            <div className="label mb-1">Ancillary charges</div>
            <p className="mb-2 text-xs text-slate-500">
              These decide the answer as often as the ocean rate does — a cheap per-CBM LCL rate loses to FCL
              once destination charges are in.
            </p>
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">Charge</th>
                  <th className="th">Basis</th>
                  <th className="th text-right">Amount</th>
                  <th className="th w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ancillaries.map((a, i) => (
                  <tr key={i}>
                    <td className="td">
                      <input
                        className="field"
                        list="ancillary-names"
                        value={a.name}
                        onChange={(e) =>
                          setAncillaries((prev) => prev.map((x, xi) => (xi === i ? { ...x, name: e.target.value } : x)))
                        }
                      />
                    </td>
                    <td className="td">
                      <select
                        className="field"
                        value={a.basis}
                        onChange={(e) =>
                          setAncillaries((prev) =>
                            prev.map((x, xi) => (xi === i ? { ...x, basis: e.target.value as AncillaryBasis } : x)),
                          )
                        }
                      >
                        {BASES.map((b) => (
                          <option key={b} value={b}>
                            {b.replace('_', ' ')}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="td">
                      <NumInput
                        value={a.amount}
                        onChange={(v) =>
                          setAncillaries((prev) => prev.map((x, xi) => (xi === i ? { ...x, amount: v } : x)))
                        }
                      />
                    </td>
                    <td className="td">
                      <button
                        className="rounded px-1.5 text-red-600 hover:bg-red-50"
                        onClick={() => setAncillaries((prev) => prev.filter((_, xi) => xi !== i))}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="ancillary-names">
              {SEED_ANCILLARY_NAMES.map((n) => (
                <option key={n} value={n} />
              ))}
              <option value="Other" />
            </datalist>
            <button
              className="btn-ghost mt-2"
              onClick={() => setAncillaries((prev) => [...prev, { name: '', basis: 'per_shipment', amount: 0 }])}
            >
              + Add charge
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}

/** Small helper reused by the history page. */
export function MiniLineChart({ data }: { data: { date: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: 8 }}>
        <CartesianGrid stroke="#e2e8f0" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} width={64} />
        <Tooltip formatter={(v: number) => fmt.money(v)} />
        <Line type="stepAfter" dataKey="value" stroke="#2563eb" strokeWidth={2} dot />
      </LineChart>
    </ResponsiveContainer>
  );
}
