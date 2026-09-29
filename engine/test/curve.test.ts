import { describe, expect, it } from 'vitest';
import {
  chargeableLclPrice,
  fitLclCurve,
  isMonotonic,
  isotonic,
  sampleCurve,
} from '../src/index.js';
import type { LclPoint } from '../src/index.js';

const points: LclPoint[] = [
  { volumeCbm: 1, totalPrice: 380 },
  { volumeCbm: 5, totalPrice: 900 },
  { volumeCbm: 15, totalPrice: 1950 },
];

describe('LCL three-point curve', () => {
  it('passes through every input point in piecewise-linear mode', () => {
    const c = fitLclCurve(points, 'piecewise_linear');
    for (const p of points) {
      expect(c.priceAt(p.volumeCbm)).toBeCloseTo(p.totalPrice, 6);
    }
    expect(c.r2).toBeCloseTo(1, 9);
    expect(c.residuals.every((r) => Math.abs(r) < 1e-9)).toBe(true);
  });

  it('is monotonically non-decreasing across the whole range', () => {
    for (const model of ['piecewise_linear', 'log_linear', 'power'] as const) {
      expect(isMonotonic(fitLclCurve(points, model), 0.1, 200)).toBe(true);
    }
  });

  it('extrapolates sensibly below and above the outer points', () => {
    const c = fitLclCurve(points, 'piecewise_linear');
    // Below 1 CBM: first segment slope is (900-380)/4 = 130/CBM.
    expect(c.priceAt(0.5)).toBeCloseTo(380 - 0.5 * 130, 6);
    expect(c.priceAt(0.5)).toBeGreaterThan(0);
    // Above 15 CBM: last segment slope is (1950-900)/10 = 105/CBM.
    expect(c.priceAt(25)).toBeCloseTo(1950 + 10 * 105, 6);
    expect(c.priceAt(25)).toBeGreaterThan(c.priceAt(15));
  });

  it('never dips when the quoted points themselves dip', () => {
    // A quadratic through these would fall between 5 and 15 CBM.
    const dodgy: LclPoint[] = [
      { volumeCbm: 1, totalPrice: 400 },
      { volumeCbm: 5, totalPrice: 1200 },
      { volumeCbm: 15, totalPrice: 1100 },
    ];
    const c = fitLclCurve(dodgy, 'piecewise_linear');
    expect(isMonotonic(c, 0.1, 100)).toBe(true);
    expect(c.warnings.some((w) => /monotonic/i.test(w))).toBe(true);
    expect(c.priceAt(15)).toBeGreaterThanOrEqual(c.priceAt(5) - 1e-9);
  });

  it('accepts more than three points', () => {
    const many: LclPoint[] = [
      { volumeCbm: 1, totalPrice: 380 },
      { volumeCbm: 3, totalPrice: 690 },
      { volumeCbm: 5, totalPrice: 900 },
      { volumeCbm: 10, totalPrice: 1450 },
      { volumeCbm: 15, totalPrice: 1950 },
    ];
    const c = fitLclCurve(many, 'piecewise_linear');
    expect(c.points).toHaveLength(5);
    for (const p of many) expect(c.priceAt(p.volumeCbm)).toBeCloseTo(p.totalPrice, 6);
  });

  it('reports R2 and residuals for the alternative fits', () => {
    const log = fitLclCurve(points, 'log_linear');
    expect(log.r2).toBeGreaterThan(0.8);
    expect(log.r2).toBeLessThanOrEqual(1);
    expect(log.residuals).toHaveLength(3);
    const pow = fitLclCurve(points, 'power');
    expect(pow.params.b).toBeGreaterThan(0);
    expect(pow.describe()).toMatch(/CBM\^/);
  });

  it('applies minimum volume then minimum charge', () => {
    const c = fitLclCurve(points, 'piecewise_linear');
    const minVol = chargeableLclPrice(c, 0.4, { fitModel: 'piecewise_linear', minCbm: 1 });
    expect(minVol.effectiveVolume).toBe(1);
    expect(minVol.price).toBeCloseTo(380, 6);
    expect(minVol.minimumApplied).toBe('volume');

    const minCharge = chargeableLclPrice(c, 1, { fitModel: 'piecewise_linear', minCharge: 500 });
    expect(minCharge.price).toBe(500);
    expect(minCharge.minimumApplied).toBe('charge');
  });

  it('samples for plotting without falling anywhere', () => {
    const c = fitLclCurve(points, 'piecewise_linear');
    const s = sampleCurve(c, { fitModel: 'piecewise_linear', minCbm: 1 }, 0.5, 25, 100);
    for (let i = 1; i < s.length; i++) {
      expect(s[i]!.price).toBeGreaterThanOrEqual(s[i - 1]!.price - 1e-9);
    }
  });
});

describe('isotonic regression', () => {
  it('leaves a non-decreasing series alone', () => {
    expect(isotonic([1, 2, 3])).toEqual([1, 2, 3]);
  });
  it('pools violators', () => {
    expect(isotonic([1, 5, 3])).toEqual([1, 4, 4]);
  });
});
