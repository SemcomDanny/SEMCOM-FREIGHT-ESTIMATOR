import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  applyForecastRatio,
  cartonPackItems,
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
  lines: CartonLine[];
  setLines: (next: CartonLine[] | ((prev: CartonLine[]) => CartonLine[])) => void;
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

  const addLine = useCallback(() => setLines((prev) => [...prev, blankLine()]), []);
  const updateLine = useCallback((id: string, patch: Partial<CartonLine>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);
  const removeLine = useCallback((id: string) => {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : [blankLine()]));
  }, []);
  const duplicateLine = useCallback((id: string) => {
    setLines((prev) => {
      const i = prev.findIndex((l) => l.id === id);
      if (i < 0) return prev;
      const copy = { ...prev[i]!, id: blankLine().id };
      return [...prev.slice(0, i + 1), copy, ...prev.slice(i + 1)];
    });
  }, []);
  const clearLines = useCallback(() => setLines([blankLine()]), []);

  /* Derived --------------------------------------------------------- */

  const metrics = useMemo(() => consignmentMetrics(lines), [lines]);

  const palletType = useMemo(
    () => palletTypes.find((p) => p.id === palletTypeId) ?? null,
    [palletTypes, palletTypeId],
  );

  const palletBuilds = useMemo(() => {
    if (loadingMode !== 'palletised' || !palletType) return [];
    return palletiseAll(lines.filter((l) => l.qty > 0 && l.lengthMm > 0), {
      palletType,
      ...palletOverrides,
      palletTareKg: settings?.palletTareKg,
    }).builds;
  }, [loadingMode, palletType, lines, palletOverrides, settings]);

  const packItems = useMemo(() => {
    if (loadingMode === 'palletised' && palletType) {
      return palletPackItems(palletBuilds, lines, palletType, settings?.palletTareKg);
    }
    return cartonPackItems(lines);
  }, [loadingMode, palletType, palletBuilds, lines, settings]);

  const issues = useMemo(() => {
    const list: Issue[] = validateAll(lines.filter((l) => l.qty > 0), containerTypes);
    if (loadingMode === 'palletised' && palletType) {
      for (const b of palletBuilds) list.push(...validatePalletBuild(b, palletType));
      for (const c of containerTypes) list.push(...validatePalletInContainer(palletType, c));
    }
    return list;
  }, [lines, containerTypes, loadingMode, palletType, palletBuilds]);

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
