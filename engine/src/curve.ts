import type { FitModel, LclConfig, LclPoint } from './types.js';

export interface FittedCurve {
  model: FitModel;
  /** Evaluate the fitted curve at a volume, before min-charge logic. */
  priceAt(volumeCbm: number): number;
  /** Model parameters, for display and for storage. */
  params: Record<string, number>;
  /** Coefficient of determination against the input points. */
  r2: number;
  /** price(point) - actual, per input point. */
  residuals: number[];
  /** Points actually used (after any monotonic correction). */
  points: LclPoint[];
  warnings: string[];
  /** Human-readable description of the fit, for the formula tooltip. */
  describe(): string;
}

/**
 * Pool-adjacent-violators: the smallest change to `y` that makes it
 * non-decreasing. Used to guard against a rate sheet where a bigger volume is
 * quoted cheaper in total, which the curve must never reproduce.
 */
export function isotonic(y: number[]): number[] {
  const values: number[] = [];
  const weights: number[] = [];
  for (const v of y) {
    values.push(v);
    weights.push(1);
    while (values.length > 1 && values[values.length - 2]! > values[values.length - 1]!) {
      const v2 = values.pop()!;
      const w2 = weights.pop()!;
      const v1 = values.pop()!;
      const w1 = weights.pop()!;
      values.push((v1 * w1 + v2 * w2) / (w1 + w2));
      weights.push(w1 + w2);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    for (let k = 0; k < weights[i]!; k++) out.push(values[i]!);
  }
  return out;
}

function rSquared(actual: number[], predicted: number[]): number {
  const n = actual.length;
  if (n === 0) return 1;
  const mean = actual.reduce((s, v) => s + v, 0) / n;
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (actual[i]! - mean) ** 2;
    ssRes += (actual[i]! - predicted[i]!) ** 2;
  }
  if (ssTot === 0) return ssRes === 0 ? 1 : 0;
  return 1 - ssRes / ssTot;
}

/** Ordinary least squares for y = a + b*x. */
function ols(xs: number[], ys: number[]): { a: number; b: number } {
  const n = xs.length;
  if (n === 0) return { a: 0, b: 0 };
  if (n === 1) return { a: ys[0]!, b: 0 };
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  const b = den === 0 ? 0 : num / den;
  return { a: my - b * mx, b };
}

function preparePoints(points: LclPoint[]): { points: LclPoint[]; warnings: string[] } {
  const warnings: string[] = [];
  const clean = points
    .filter((p) => Number.isFinite(p.volumeCbm) && Number.isFinite(p.totalPrice) && p.volumeCbm > 0)
    .sort((a, b) => a.volumeCbm - b.volumeCbm);

  // Collapse duplicate volumes by averaging, so the interpolation stays a function.
  const merged: LclPoint[] = [];
  for (const p of clean) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.volumeCbm - p.volumeCbm) < 1e-9) {
      last.totalPrice = (last.totalPrice + p.totalPrice) / 2;
      warnings.push(`Duplicate volume ${p.volumeCbm} CBM — prices averaged.`);
    } else {
      merged.push({ ...p });
    }
  }

  const prices = merged.map((p) => p.totalPrice);
  const fixed = isotonic(prices);
  for (let i = 0; i < merged.length; i++) {
    if (Math.abs(fixed[i]! - prices[i]!) > 1e-9) {
      warnings.push(
        `Point at ${merged[i]!.volumeCbm} CBM was quoted cheaper than a smaller volume; ` +
          `adjusted ${prices[i]!.toFixed(2)} to ${fixed[i]!.toFixed(2)} to keep the curve monotonic.`,
      );
    }
    merged[i]!.totalPrice = fixed[i]!;
  }

  return { points: merged, warnings };
}

/**
 * Monotone piecewise-linear interpolation with linear extrapolation off both
 * ends using the adjacent segment's slope, floored at zero slope so the curve
 * can never fall as volume rises.
 */
function fitPiecewise(points: LclPoint[]): (v: number) => number {
  return (v: number) => {
    if (points.length === 0) return 0;
    if (points.length === 1) return points[0]!.totalPrice;
    const first = points[0]!;
    const last = points[points.length - 1]!;

    if (v <= first.volumeCbm) {
      const second = points[1]!;
      const slope = Math.max(
        0,
        (second.totalPrice - first.totalPrice) / (second.volumeCbm - first.volumeCbm),
      );
      return Math.max(0, first.totalPrice + slope * (v - first.volumeCbm));
    }
    if (v >= last.volumeCbm) {
      const prev = points[points.length - 2]!;
      const slope = Math.max(
        0,
        (last.totalPrice - prev.totalPrice) / (last.volumeCbm - prev.volumeCbm),
      );
      return last.totalPrice + slope * (v - last.volumeCbm);
    }
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      if (v >= a.volumeCbm && v <= b.volumeCbm) {
        const t = (v - a.volumeCbm) / (b.volumeCbm - a.volumeCbm);
        return a.totalPrice + t * (b.totalPrice - a.totalPrice);
      }
    }
    return last.totalPrice;
  };
}

/**
 * Fit a continuous, monotonically non-decreasing cost function to the quoted
 * LCL points. A naive quadratic through three points can dip, pricing more
 * cargo cheaper than less; every model here is constrained so it cannot.
 */
export function fitLclCurve(rawPoints: LclPoint[], model: FitModel = 'piecewise_linear'): FittedCurve {
  const { points, warnings } = preparePoints(rawPoints);

  if (points.length === 0) {
    return {
      model,
      priceAt: () => 0,
      params: {},
      r2: 0,
      residuals: [],
      points: [],
      warnings: [...warnings, 'No usable rate points.'],
      describe: () => 'no rate points',
    };
  }

  let priceAt: (v: number) => number;
  let params: Record<string, number> = {};
  let describe: () => string;

  if (model === 'log_linear') {
    // price = a + b * ln(volume)
    const xs = points.map((p) => Math.log(p.volumeCbm));
    const ys = points.map((p) => p.totalPrice);
    let { a, b } = ols(xs, ys);
    if (b < 0) {
      b = 0;
      a = ys.reduce((s, v) => s + v, 0) / ys.length;
      warnings.push('Log-linear fit sloped downward; flattened to keep the curve monotonic.');
    }
    params = { a, b };
    priceAt = (v: number) => (v <= 0 ? Math.max(0, a) : Math.max(0, a + b * Math.log(v)));
    describe = () => `price = ${a.toFixed(2)} + ${b.toFixed(2)} x ln(CBM)`;
  } else if (model === 'power') {
    // price = a * volume^b, fitted in log-log space
    const xs = points.map((p) => Math.log(p.volumeCbm));
    const ys = points.map((p) => Math.log(Math.max(p.totalPrice, 1e-9)));
    let { a: lnA, b } = ols(xs, ys);
    if (b < 0) {
      b = 0;
      lnA = ys.reduce((s, v) => s + v, 0) / ys.length;
      warnings.push('Power fit had a negative exponent; flattened to keep the curve monotonic.');
    }
    const a = Math.exp(lnA);
    params = { a, b };
    priceAt = (v: number) => (v <= 0 ? 0 : a * Math.pow(v, b));
    describe = () => `price = ${a.toFixed(2)} x CBM^${b.toFixed(3)}`;
  } else {
    priceAt = fitPiecewise(points);
    params = Object.fromEntries(points.map((p, i) => [`v${i}`, p.volumeCbm]));
    describe = () =>
      `piecewise linear through ${points.map((p) => `${p.volumeCbm} CBM`).join(', ')}`;
  }

  const actual = points.map((p) => p.totalPrice);
  const predicted = points.map((p) => priceAt(p.volumeCbm));
  const residuals = predicted.map((p, i) => p - actual[i]!);

  return {
    model,
    priceAt,
    params,
    r2: rSquared(actual, predicted),
    residuals,
    points,
    warnings,
    describe,
  };
}

/** Apply the rate card's minimum-volume and minimum-charge rules to a curve. */
export function chargeableLclPrice(
  curve: FittedCurve,
  volumeCbm: number,
  config: LclConfig | undefined,
): { price: number; effectiveVolume: number; minimumApplied: 'none' | 'volume' | 'charge' } {
  const minCbm = config?.minCbm ?? 0;
  const minCharge = config?.minCharge ?? 0;
  const effectiveVolume = Math.max(volumeCbm, minCbm);
  const raw = curve.priceAt(effectiveVolume);
  if (minCharge > raw) return { price: minCharge, effectiveVolume, minimumApplied: 'charge' };
  return {
    price: raw,
    effectiveVolume,
    minimumApplied: effectiveVolume > volumeCbm ? 'volume' : 'none',
  };
}

/** Sample the fitted curve for plotting. */
export function sampleCurve(
  curve: FittedCurve,
  config: LclConfig | undefined,
  fromCbm = 0.5,
  toCbm = 25,
  steps = 60,
): { volumeCbm: number; price: number }[] {
  const out: { volumeCbm: number; price: number }[] = [];
  const span = toCbm - fromCbm;
  for (let i = 0; i <= steps; i++) {
    const v = fromCbm + (span * i) / steps;
    out.push({ volumeCbm: v, price: chargeableLclPrice(curve, v, config).price });
  }
  return out;
}

/** Verify a curve never falls as volume rises. Used by tests and the admin UI. */
export function isMonotonic(curve: FittedCurve, fromCbm = 0.1, toCbm = 100, steps = 500): boolean {
  let prev = -Infinity;
  for (let i = 0; i <= steps; i++) {
    const v = fromCbm + ((toCbm - fromCbm) * i) / steps;
    const p = curve.priceAt(v);
    if (p < prev - 1e-6) return false;
    prev = p;
  }
  return true;
}
