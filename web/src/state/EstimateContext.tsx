import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  applyForecastRatio,
  cartonPackItems,
  defaultBreaks,
  scaleLines,
  compareModes,
  consignmentMetrics,
  palletPackItems,
  palletiseAll,
  validateAll,
  validatePalletBuild,
  validatePalletInContainer,
} from '@semcom/engine';
import type {
  CartonLine,
  Comparison,
  QtyBreak,
  ForecastMethod,
  ForecastResult,
  ConsignmentMetrics,
  ContainerType,
  Issue,
  LengthUnit,
  PackItem,
  PalletBuild,
  PalletType,
  RateCard,
  ShipMode,
  WeightUnit,
} from '@semcom/engine';
import { api } from '../api';
import type { AppSettings, ContainerTypeRow, Lane, PalletTypeRow } from '../api';
import type { CostEstimate } from '@semcom/engine';

export type LoadingMode = 'floor' | 'palletised';

export interface JobMeta {
  id: string | null;
  ref: string;
  client: string;
  status: 'Draft' | 'Quoted' | 'Won' | 'Lost';
  incoterm: 'EXW' | 'FCA' | 'FOB' | 'CFR' | 'CIF' | 'DAP' | 'DDP';
  commodity: string;
  hsCode: string;
  cargoReadyDate: string;
  dangerousGoods: boolean;
  notes: string;
}

export interface ActiveRate {
  mode: ShipMode;
  card: RateCard | null;
  stale: boolean;
  versions: number;
  /** A version exists but does not take effect until this date. */
  nextEffectiveFrom: string | null;
}

interface EstimateState {
  /** Base quantities as entered. Quantity breaks scale these. */
  lines: CartonLine[];
  setLines: (next: CartonLine[] | ((prev: CartonLine[]) => CartonLine[])) => void;
  /** `lines` scaled by the selected quantity break — what everything is costed on. */
  activeLines: CartonLine[];

  breaks: QtyBreak[];
  setBreaks: (next: QtyBreak[] | ((prev: QtyBreak[]) => QtyBreak[])) => void;
  activeBreakId: string;
  setActiveBreakId: (id: string) => void;
  activeBreak: QtyBreak | null;
  addLine: () => void;
  updateLine: (id: string, patch: Partial<CartonLine>) => void;
  removeLine: (id: string) => void;
  duplicateLine: (id: string) => void;
  clearLines: () => void;

  lengthUnit: LengthUnit;
  setLengthUnit: (u: LengthUnit) => void;
  weightUnit: WeightUnit;
  setWeightUnit: (u: WeightUnit) => void;

  laneId: string;
  setLaneId: (id: string) => void;
  lanes: Lane[];

  loadingMode: LoadingMode;
  setLoadingMode: (m: LoadingMode) => void;
  palletTypeId: string;
  setPalletTypeId: (id: string) => void;
  palletTypes: PalletType[];
  palletOverrides: { maxLoadHMm?: number; maxLoadKg?: number; overhangMm?: number };
  setPalletOverrides: (o: { maxLoadHMm?: number; maxLoadKg?: number; overhangMm?: number }) => void;

  stowEfficiency: number;
  setStowEfficiency: (v: number) => void;
  fxOverride: number | null;
  setFxOverride: (v: number | null) => void;

  containerTypes: ContainerType[];
  settings: AppSettings | null;

  job: JobMeta;
  setJob: (patch: Partial<JobMeta>) => void;

  /* Estimating basis: the latest quoted rate, or a forecast from history. */
  forecastMethod: ForecastMethod;
  setForecastMethod: (m: ForecastMethod) => void;
  forecastWindowMonths: number;
  setForecastWindowMonths: (m: number) => void;
  /** Human-readable basis, e.g. "Forecast — 6-month trailing average". */
  rateBasisLabel: string;
  /** Per-mode multiplier applied to freight when a forecast basis is chosen. */
  forecastRatios: Partial<Record<ShipMode, number>>;

  /* Saving. */
  dirty: boolean;
  saving: boolean;
  saveError: string | null;
  lastSavedAt: string | null;
  saveJob: (estimate: CostEstimate | null) => Promise<void>;
  loadJob: (jobId: string) => Promise<void>;
  resetJob: () => void;

  activeRates: ActiveRate[];
  ratesLoading: boolean;
  reloadRates: () => void;
  /** Re-read lanes and the rates in force — an admin may have just added one. */
  refreshRateData: () => void;

  /* Derived, recalculated on every change. */
  metrics: ConsignmentMetrics;
  packItems: PackItem[];
  palletBuilds: PalletBuild[];
  comparison: Comparison | null;
  issues: Issue[];
  selectedMode: ShipMode | null;
  setSelectedMode: (m: ShipMode | null) => void;
}

const Ctx = createContext<EstimateState | null>(null);

let seq = 0;
function blankLine(): CartonLine {
  seq += 1;
  return {
    id: `line-${Date.now().toString(36)}-${seq}`,
    description: '',
    lengthMm: 0,
    widthMm: 0,
    heightMm: 0,
    weightKg: 0,
    qty: 0,
    stackable: true,
  };
}

function toContainerType(r: ContainerTypeRow): ContainerType {
  return {
    id: r.id,
    name: r.name,
    intLMm: r.int_l_mm,
    intWMm: r.int_w_mm,
    intHMm: r.int_h_mm,
    maxPayloadKg: r.max_payload_kg,
    active: r.active === 1,
  };
}

function toPalletType(r: PalletTypeRow): PalletType {
  return {
    id: r.id,
    name: r.name,
    lMm: r.l_mm,
    wMm: r.w_mm,
    deckHMm: r.deck_h_mm,
    maxLoadHMm: r.max_load_h_mm,
    maxLoadKg: r.max_load_kg,
    overhangMm: r.overhang_mm,
    active: r.active === 1,
  };
}

export function EstimateProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartonLine[]>([blankLine()]);
  const [breaks, setBreaks] = useState<QtyBreak[]>(defaultBreaks());
  const [activeBreakId, setActiveBreakId] = useState('b1');
  const [lengthUnit, setLengthUnit] = useState<LengthUnit>('mm');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('kg');
  const [laneId, setLaneId] = useState('');
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [loadingMode, setLoadingMode] = useState<LoadingMode>('floor');
  const [palletTypeId, setPalletTypeId] = useState('');
  const [palletTypes, setPalletTypes] = useState<PalletType[]>([]);
  const [palletOverrides, setPalletOverrides] = useState<{
    maxLoadHMm?: number;
    maxLoadKg?: number;
    overhangMm?: number;
  }>({});
  const [containerTypes, setContainerTypes] = useState<ContainerType[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [stowEfficiency, setStowEfficiency] = useState(0.85);
  const [fxOverride, setFxOverride] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [activeRates, setActiveRates] = useState<ActiveRate[]>([]);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [selectedMode, setSelectedMode] = useState<ShipMode | null>(null);
  const [forecastMethod, setForecastMethod] = useState<ForecastMethod>('latest');
  const [forecastWindowMonths, setForecastWindowMonths] = useState(6);
  const [forecastRatios, setForecastRatios] = useState<Partial<Record<ShipMode, number>>>({});
  const [job, setJobState] = useState<JobMeta>({
    id: null,
    ref: '',
    client: '',
    status: 'Draft',
    incoterm: 'FOB',
    commodity: '',
    hsCode: '',
    cargoReadyDate: '',
    dangerousGoods: false,
    notes: '',
  });

  const setJob = useCallback((patch: Partial<JobMeta>) => {
    setJobState((prev) => ({ ...prev, ...patch }));
    // `id` alone changes when a save completes, which is not an edit.
    if (Object.keys(patch).some((k) => k !== 'id')) setDirty(true);
  }, []);

  useEffect(() => {
    void Promise.all([
      api.get<Lane[]>('/estimate/lanes-with-rates'),
      api.get<ContainerTypeRow[]>('/master/container-types'),
      api.get<PalletTypeRow[]>('/master/pallet-types'),
      api.get<AppSettings>('/master/settings'),
    ]).then(([laneRows, containerRows, palletRows, appSettings]) => {
      setLanes(laneRows);
      setContainerTypes(containerRows.filter((c) => c.active === 1).map(toContainerType));
      setPalletTypes(palletRows.filter((p) => p.active === 1).map(toPalletType));
      setSettings(appSettings);
      setStowEfficiency(appSettings.stowEfficiency);
      if (!laneId && laneRows.length > 0) setLaneId(laneRows[0]!.id);
      if (palletRows.length > 0) setPalletTypeId((prev) => prev || palletRows[0]!.id);
    });
    // Master data is loaded once per session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reloadRates = useCallback(() => {
    if (!laneId) {
      setActiveRates([]);
      return;
    }
    setRatesLoading(true);
    api
      .get<ActiveRate[]>(`/rates/active?laneId=${encodeURIComponent(laneId)}`)
      .then(setActiveRates)
      .catch(() => setActiveRates([]))
      .finally(() => setRatesLoading(false));
  }, [laneId]);

  useEffect(() => reloadRates(), [reloadRates]);

  // An admin can add a lane or a rate version mid-session, so the estimator
  // re-reads both whenever it is opened rather than trusting what it cached
  // at sign-in.
  const refreshRateData = useCallback(() => {
    void api.get<Lane[]>('/estimate/lanes-with-rates').then((rows) => {
      setLanes(rows);
      setLaneId((prev) => (prev || rows[0]?.id) ?? '');
    });
    reloadRates();
  }, [reloadRates]);

  /**
   * When a forecast basis is chosen, work out how far the forecast sits from
   * the current quoted rate and carry that ratio into the costing. Comparing
   * both at the same reference point is what makes the ratio meaningful.
   */
  useEffect(() => {
    if (forecastMethod === 'latest' || !laneId) {
      setForecastRatios({});
      return;
    }
    let cancelled = false;
    const modes: ShipMode[] = ['LCL', 'FCL', 'AIR'];
    void Promise.all(
      modes.map(async (mode) => {
        const params = new URLSearchParams({
          laneId,
          mode,
          referenceCbm: '5',
        });
        try {
          const r = await api.get<{ series: { value: number }[]; forecasts: ForecastResult[] }>(
            `/rates/history?${params}`,
          );
          const latest = r.series[r.series.length - 1]?.value;
          const f = r.forecasts.find(
            (x) => x.method === forecastMethod && x.windowMonths === forecastWindowMonths,
          );
          if (!latest || !f || latest <= 0) return [mode, undefined] as const;
          return [mode, f.value / latest] as const;
        } catch {
          return [mode, undefined] as const;
        }
      }),
    ).then((pairs) => {
      if (cancelled) return;
      const next: Partial<Record<ShipMode, number>> = {};
      for (const [mode, ratio] of pairs) if (ratio !== undefined) next[mode] = ratio;
      setForecastRatios(next);
    });
    return () => {
      cancelled = true;
    };
  }, [forecastMethod, forecastWindowMonths, laneId]);

  const rateBasisLabel =
    forecastMethod === 'latest'
      ? 'Quoted'
      : forecastMethod === 'trailing_average'
        ? `Forecast — ${forecastWindowMonths}-month trailing average`
        : `Forecast — linear trend (${forecastWindowMonths}-month window)`;

  /* Line editing ---------------------------------------------------- */

  const addLine = useCallback(() => {
    setLines((prev) => [...prev, blankLine()]);
    setDirty(true);
  }, []);
  const updateLine = useCallback((id: string, patch: Partial<CartonLine>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    setDirty(true);
  }, []);
  const removeLine = useCallback((id: string) => {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : [blankLine()]));
    setDirty(true);
  }, []);
  const duplicateLine = useCallback((id: string) => {
    setLines((prev) => {
      const i = prev.findIndex((l) => l.id === id);
      if (i < 0) return prev;
      const copy = { ...prev[i]!, id: blankLine().id };
      return [...prev.slice(0, i + 1), copy, ...prev.slice(i + 1)];
    });
    setDirty(true);
  }, []);
  const clearLines = useCallback(() => {
    setLines([blankLine()]);
    setDirty(true);
  }, []);

  /* Saving and loading ---------------------------------------------- */

  /**
   * Save reads through refs rather than closing over state.
   *
   * The save handler is handed to a button that lives for the life of the
   * screen; capturing state in its closure would save whatever the values were
   * when it was created, which is a silent and very confusing data-loss bug.
   */
  const jobRef = useRef(job);
  const laneRef = useRef(laneId);
  const modeRef = useRef(loadingMode);
  const palletRef = useRef(palletTypeId);
  const stowRef = useRef(stowEfficiency);
  const fxRef = useRef(fxOverride);
  const linesRef = useRef(lines);
  const breaksRef = useRef(breaks);
  const metricsRef = useRef<ConsignmentMetrics | null>(null);
  const activeBreakRef = useRef<QtyBreak | null>(null);
  jobRef.current = job;
  laneRef.current = laneId;
  modeRef.current = loadingMode;
  palletRef.current = palletTypeId;
  stowRef.current = stowEfficiency;
  fxRef.current = fxOverride;
  linesRef.current = lines;
  breaksRef.current = breaks;


  const resetJob = useCallback(() => {
    setLines([blankLine()]);
    setBreaks(defaultBreaks());
    setActiveBreakId('b1');
    setLoadingMode('floor');
    setFxOverride(null);
    setJobState({
      id: null,
      ref: '',
      client: '',
      status: 'Draft',
      incoterm: 'FOB',
      commodity: '',
      hsCode: '',
      cargoReadyDate: '',
      dangerousGoods: false,
      notes: '',
    });
    setDirty(false);
    setSaveError(null);
    setLastSavedAt(null);
  }, []);

  const saveJob = useCallback(
    async (estimate: CostEstimate | null) => {
      setSaving(true);
      setSaveError(null);
      try {
        const payload = {
          ref: jobRef.current.ref,
          client: jobRef.current.client,
          laneId: laneRef.current,
          status: jobRef.current.status,
          incoterm: jobRef.current.incoterm,
          commodity: jobRef.current.commodity,
          hsCode: jobRef.current.hsCode,
          cargoReadyDate: jobRef.current.cargoReadyDate || null,
          dangerousGoods: jobRef.current.dangerousGoods,
          loadingMode: modeRef.current,
          palletTypeId: modeRef.current === 'palletised' ? palletRef.current : null,
          stowEfficiency: stowRef.current,
          fxOverride: fxRef.current,
          notes: jobRef.current.notes,
          // Base quantities are saved; breaks are scenarios layered on top.
          lines: linesRef.current.filter((l) => l.qty > 0 && l.lengthMm > 0),
          breaks: breaksRef.current,
        };
        const saved = jobRef.current.id
          ? await api.put<{ job: { id: string } }>(`/jobs/${jobRef.current.id}`, payload)
          : await api.post<{ job: { id: string } }>('/jobs', payload);

        const jobId = saved.job.id;
        setJobState((prev) => ({ ...prev, id: jobId }));

        if (estimate) {
          await api.post(`/jobs/${jobId}/results`, {
            modeSelected: estimate.mode,
            rateCardId: estimate.components[0]?.sourceRateCardId ?? null,
            totalCost: estimate.totalAud,
            breakdown: {
              basis: estimate.basis,
              currency: estimate.currency,
              fxToAud: estimate.fxToAud,
              components: estimate.components,
              metrics: metricsRef.current,
              containerMix: estimate.containerMix,
              stowEfficiency: stowRef.current,
              quantityBreak: activeBreakRef.current?.label ?? null,
            },
          });
        }
        setDirty(false);
        setLastSavedAt(new Date().toISOString());
      } catch (err) {
        setSaveError((err as Error).message);
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const loadJob = useCallback(async (jobId: string) => {
    const detail = await api.get<{ job: Record<string, unknown>; lines: CartonLine[] }>(`/jobs/${jobId}`);
    const j = detail.job as Record<string, string | number | null>;
    setLines(detail.lines.length > 0 ? detail.lines : [blankLine()]);
    let loadedBreaks = defaultBreaks();
    if (typeof j.breaks_json === 'string' && j.breaks_json) {
      try {
        const parsed = JSON.parse(j.breaks_json) as QtyBreak[];
        if (Array.isArray(parsed) && parsed.length > 0) loadedBreaks = parsed;
      } catch {
        /* keep the defaults */
      }
    }
    setBreaks(loadedBreaks);
    setActiveBreakId(loadedBreaks[0]!.id);
    setLaneId(String(j.lane_id ?? ''));
    setLoadingMode((j.loading_mode as LoadingMode) ?? 'floor');
    if (j.pallet_type_id) setPalletTypeId(String(j.pallet_type_id));
    if (typeof j.stow_efficiency === 'number') setStowEfficiency(j.stow_efficiency);
    setFxOverride(typeof j.fx_override === 'number' ? j.fx_override : null);
    setJobState({
      id: String(j.id),
      ref: String(j.ref ?? ''),
      client: String(j.client ?? ''),
      status: (j.status as JobMeta['status']) ?? 'Draft',
      incoterm: (j.incoterm as JobMeta['incoterm']) ?? 'FOB',
      commodity: String(j.commodity ?? ''),
      hsCode: String(j.hs_code ?? ''),
      cargoReadyDate: String(j.cargo_ready_date ?? ''),
      dangerousGoods: Number(j.dangerous_goods) === 1,
      notes: String(j.notes ?? ''),
    });
    setDirty(false);
    setSaveError(null);
    setLastSavedAt(null);
  }, []);

  /* Derived --------------------------------------------------------- */

  const activeBreak = useMemo(
    () => breaks.find((b) => b.id === activeBreakId) ?? breaks[0] ?? null,
    [breaks, activeBreakId],
  );

  // Everything downstream — totals, packing, costing, the 3D view — runs on the
  // scaled quantities, so switching break switches the whole estimate.
  const activeLines = useMemo(
    () => (activeBreak && activeBreak.multiplier !== 1 ? scaleLines(lines, activeBreak.multiplier) : lines),
    [lines, activeBreak],
  );

  const metrics = useMemo(() => consignmentMetrics(activeLines), [activeLines]);

  const palletType = useMemo(
    () => palletTypes.find((p) => p.id === palletTypeId) ?? null,
    [palletTypes, palletTypeId],
  );

  const palletBuilds = useMemo(() => {
    if (loadingMode !== 'palletised' || !palletType) return [];
    return palletiseAll(activeLines.filter((l) => l.qty > 0 && l.lengthMm > 0), {
      palletType,
      ...palletOverrides,
      palletTareKg: settings?.palletTareKg,
    }).builds;
  }, [loadingMode, palletType, activeLines, palletOverrides, settings]);

  const packItems = useMemo(() => {
    if (loadingMode === 'palletised' && palletType) {
      return palletPackItems(palletBuilds, activeLines, palletType, settings?.palletTareKg);
    }
    return cartonPackItems(activeLines);
  }, [loadingMode, palletType, palletBuilds, activeLines, settings]);

  const issues = useMemo(() => {
    const list: Issue[] = validateAll(activeLines.filter((l) => l.qty > 0), containerTypes);
    if (loadingMode === 'palletised' && palletType) {
      for (const b of palletBuilds) list.push(...validatePalletBuild(b, palletType));
      for (const c of containerTypes) list.push(...validatePalletInContainer(palletType, c));
    }
    return list;
  }, [activeLines, containerTypes, loadingMode, palletType, palletBuilds]);

  metricsRef.current = metrics;
  activeBreakRef.current = activeBreak;

  const comparison = useMemo(() => {
    if (metrics.totalVolumeCbm <= 0 || containerTypes.length === 0) return null;
    const card = (mode: ShipMode) => {
      const found = activeRates.find((r) => r.mode === mode)?.card ?? undefined;
      const ratio = forecastRatios[mode];
      return found && ratio ? applyForecastRatio(found, ratio) : found;
    };
    return compareModes({
      metrics,
      packItems,
      containerTypes,
      lclCard: card('LCL'),
      fclCard: card('FCL'),
      airCard: card('AIR'),
      stowEfficiency,
      fxOverride: fxOverride ?? undefined,
    });
  }, [metrics, packItems, containerTypes, activeRates, stowEfficiency, fxOverride, forecastRatios]);

  // Default to the cheapest mode, but never fight a deliberate user choice:
  // the selection is only reset when the lane or mode set changes.
  const availableModes = comparison?.estimates.map((e) => e.mode).join(',') ?? '';
  useEffect(() => {
    setSelectedMode(null);
  }, [laneId, availableModes]);

  const effectiveMode = selectedMode ?? comparison?.recommended ?? null;

  const value: EstimateState = {
    lines,
    setLines,
    activeLines,
    breaks,
    setBreaks,
    activeBreakId,
    setActiveBreakId,
    activeBreak,
    addLine,
    updateLine,
    removeLine,
    duplicateLine,
    clearLines,
    lengthUnit,
    setLengthUnit,
    weightUnit,
    setWeightUnit,
    laneId,
    setLaneId,
    lanes,
    loadingMode,
    setLoadingMode,
    palletTypeId,
    setPalletTypeId,
    palletTypes,
    palletOverrides,
    setPalletOverrides,
    stowEfficiency,
    setStowEfficiency,
    fxOverride,
    setFxOverride,
    containerTypes,
    settings,
    job,
    setJob,
    forecastMethod,
    setForecastMethod,
    forecastWindowMonths,
    setForecastWindowMonths,
    rateBasisLabel,
    forecastRatios,
    dirty,
    saving,
    saveError,
    lastSavedAt,
    saveJob,
    loadJob,
    resetJob,
    activeRates,
    ratesLoading,
    reloadRates,
    refreshRateData,
    metrics,
    packItems,
    palletBuilds,
    comparison,
    issues,
    selectedMode: effectiveMode,
    setSelectedMode,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEstimate(): EstimateState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useEstimate must be used inside EstimateProvider');
  return ctx;
}

export { blankLine };
