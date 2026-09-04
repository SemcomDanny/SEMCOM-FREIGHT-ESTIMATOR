/** Rate history, variance and forecasting. */

export interface SeriesPoint {
  /** ISO date (effective_from of the rate version). */
  date: string;
  value: number;
  label?: string;
  rateCardId?: string;
}

export interface VarianceSummary {
  count: number;
  min: number;
  max: number;
  mean: number;
  /** Population standard deviation. */
  stdDev: number;
  latest: number | null;
  previous: number | null;
  changeAbs: number | null;
  changePct: number | null;
}

export type ForecastMethod = 'latest' | 'trailing_average' | 'linear_trend';

export interface ForecastResult {
  method: ForecastMethod;
  value: number;
  /** Number of versions the forecast was built from. */
  sampleSize: number;
  windowMonths: number | null;
  formula: string;
  /** Never present a forecast as a quoted rate. */
  isForecast: boolean;
}

function sortByDate(series: SeriesPoint[]): SeriesPoint[] {
  return [...series].sort((a, b) => a.date.localeCompare(b.date));
}

export function withinMonths(series: SeriesPoint[], months: number, asOf = new Date()): SeriesPoint[] {
  const cutoff = new Date(asOf);
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  return sortByDate(series).filter((p) => p.date >= cutoffIso);
}

export function summariseVariance(series: SeriesPoint[]): VarianceSummary {
  const s = sortByDate(series);
  const values = s.map((p) => p.value);
  const n = values.length;
  if (n === 0) {
    return {
      count: 0, min: 0, max: 0, mean: 0, stdDev: 0,
      latest: null, previous: null, changeAbs: null, changePct: null,
    };
  }
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const latest = values[n - 1]!;
  const previous = n > 1 ? values[n - 2]! : null;
  return {
    count: n,
    min: Math.min(...values),
    max: Math.max(...values),
    mean,
    stdDev: Math.sqrt(variance),
    latest,
    previous,
    changeAbs: previous === null ? null : latest - previous,
    changePct: previous === null || previous === 0 ? null : ((latest - previous) / previous) * 100,
  };
}

/** Days since the most recent version in the series. */
export function ageInDays(series: SeriesPoint[], asOf = new Date()): number | null {
  const s = sortByDate(series);
  const last = s[s.length - 1];
  if (!last) return null;
  const then = new Date(`${last.date}T00:00:00Z`).getTime();
  return Math.floor((asOf.getTime() - then) / 86_400_000);
}

export const DEFAULT_STALE_DAYS = 60;

export function isStale(series: SeriesPoint[], thresholdDays = DEFAULT_STALE_DAYS, asOf = new Date()): boolean {
  const age = ageInDays(series, asOf);
  return age !== null && age > thresholdDays;
}

/**
 * Produce an estimating rate from history.
 *
 * `latest` is the quoted rate as entered. `trailing_average` and
 * `linear_trend` are forecasts and must be labelled as such wherever they
 * reach a client quote.
 */
export function forecast(
  series: SeriesPoint[],
  method: ForecastMethod,
  windowMonths: number | null = 6,
  asOf = new Date(),
): ForecastResult | null {
  const all = sortByDate(series);
  if (all.length === 0) return null;

  if (method === 'latest') {
    const v = all[all.length - 1]!;
    return {
      method,
      value: v.value,
      sampleSize: 1,
      windowMonths: null,
      formula: `latest quoted rate, effective ${v.date}`,
      isForecast: false,
    };
  }

  const window = windowMonths ? withinMonths(all, windowMonths, asOf) : all;
  const sample = window.length > 0 ? window : all;

  if (method === 'trailing_average') {
    const mean = sample.reduce((s, p) => s + p.value, 0) / sample.length;
    return {
      method,
      value: mean,
      sampleSize: sample.length,
      windowMonths,
      formula: `mean of ${sample.length} version(s)${windowMonths ? ` in the last ${windowMonths} months` : ''}`,
      isForecast: true,
    };
  }

  // Linear trend: least squares on days-since-first, projected to `asOf`.
  if (sample.length < 2) {
    return {
      method,
      value: sample[0]!.value,
      sampleSize: sample.length,
      windowMonths,
      formula: 'only one version in the window — trend falls back to that value',
      isForecast: true,
    };
  }
  const t0 = new Date(`${sample[0]!.date}T00:00:00Z`).getTime();
  const xs = sample.map((p) => (new Date(`${p.date}T00:00:00Z`).getTime() - t0) / 86_400_000);
  const ys = sample.map((p) => p.value);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = my - slope * mx;
  const xNow = (asOf.getTime() - t0) / 86_400_000;
  const value = Math.max(0, intercept + slope * xNow);
  return {
    method,
    value,
    sampleSize: n,
    windowMonths,
    formula: `linear trend ${intercept.toFixed(2)} + ${slope.toFixed(4)}/day projected to today`,
    isForecast: true,
  };
}

/** Estimate vs actual invoiced freight. */
export function estimateVariance(estimate: number, actual: number): {
  abs: number;
  pct: number | null;
  direction: 'under' | 'over' | 'exact';
} {
  const abs = actual - estimate;
  return {
    abs,
    pct: estimate === 0 ? null : (abs / estimate) * 100,
    direction: abs > 0.005 ? 'under' : abs < -0.005 ? 'over' : 'exact',
  };
}
