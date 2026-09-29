import { describe, expect, it } from 'vitest';
import {
  SEED_CONTAINER_TYPES,
  consignmentMetrics,
  defaultBreaks,
  evaluateBreaks,
  multiplierForUnits,
  scaleLines,
} from '../src/index.js';
import type { CartonLine, RateCard } from '../src/index.js';

const lclCard: RateCard = {
  id: 'rc-lcl',
  laneId: 'L',
  mode: 'LCL',
  currency: 'AUD',
  fxToAud: 1,
  effectiveFrom: '2026-01-01',
  lclPoints: [
    { volumeCbm: 1, totalPrice: 380 },
    { volumeCbm: 5, totalPrice: 900 },
    { volumeCbm: 15, totalPrice: 1950 },
  ],
  lclConfig: { fitModel: 'piecewise_linear', minCbm: 1, minCharge: 0 },
  ancillaries: [{ name: 'Customs clearance', basis: 'per_shipment', amount: 220 }],
};

const fclCard: RateCard = {
  id: 'rc-fcl',
  laneId: 'L',
  mode: 'FCL',
  currency: 'AUD',
  fxToAud: 1,
  effectiveFrom: '2026-01-01',
  fcl: [
    { containerTypeId: '20GP', oceanCost: 1600, originCharges: 320, destCharges: 780 },
    { containerTypeId: '40HC', oceanCost: 2600, originCharges: 380, destCharges: 900 },
  ],
  ancillaries: [{ name: 'Customs clearance', basis: 'per_shipment', amount: 220 }],
};

const lines: CartonLine[] = [
  {
    id: 'A',
    description: 'Widget box',
    lengthMm: 600,
    widthMm: 400,
    heightMm: 300,
    weightKg: 12,
    qty: 50,
    unitsPerCarton: 24,
    stackable: true,
  },
];

const ctx = { containerTypes: SEED_CONTAINER_TYPES, lclCard, fclCard, stowEfficiency: 0.85 };

describe('scaling a consignment', () => {
  it('scales carton quantities and keeps whole cartons', () => {
    expect(scaleLines(lines, 2)[0]!.qty).toBe(100);
    expect(scaleLines(lines, 2.5)[0]!.qty).toBe(125);
    // A fractional result is never allowed to round away to nothing.
    expect(scaleLines([{ ...lines[0]!, qty: 1 }], 0.1)[0]!.qty).toBe(1);
  });

  it('leaves empty lines empty', () => {
    expect(scaleLines([{ ...lines[0]!, qty: 0 }], 5)[0]!.qty).toBe(0);
  });

  it('works out the multiplier for a target unit count', () => {
    // 50 cartons x 24 units = 1,200 units
    expect(multiplierForUnits(lines, 2400)).toBeCloseTo(2, 9);
    expect(multiplierForUnits(lines, 600)).toBeCloseTo(0.5, 9);
    expect(multiplierForUnits([{ ...lines[0]!, unitsPerCarton: undefined }], 1000)).toBeNull();
  });
});

describe('quantity breaks', () => {
  it('prices each break independently and reports per-unit freight', () => {
    const results = evaluateBreaks(lines, defaultBreaks(), ctx);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.totalAud).toBeGreaterThan(0);
      expect(r.freightPerUnitAud).toBeGreaterThan(0);
      expect(r.metrics.totalUnits).toBe(r.metrics.totalCartons * 24);
    }
    // Bigger orders cost more in total...
    expect(results[2]!.totalAud!).toBeGreaterThan(results[0]!.totalAud!);
    // ...but less per unit, which is the whole point of asking.
    expect(results[2]!.freightPerUnitAud!).toBeLessThan(results[0]!.freightPerUnitAud!);
  });

  it('reports the per-unit change against the base break', () => {
    const results = evaluateBreaks(lines, defaultBreaks(), ctx);
    const base = results.find((r) => r.multiplier === 1)!;
    expect(base.perUnitChangePct).toBeCloseTo(0, 9);
    expect(results[2]!.perUnitChangePct!).toBeLessThan(0);
  });

  it('switches mode when a break gets big enough for a container', () => {
    const results = evaluateBreaks(
      lines,
      [
        { id: 's', label: 'small', multiplier: 1 },
        { id: 'l', label: 'large', multiplier: 10 },
      ],
      ctx,
    );
    expect(results[0]!.mode).toBe('LCL');
    expect(results[1]!.mode).toBe('FCL');
    expect(results[1]!.containerSummary).toMatch(/x /);
  });

  it('sorts breaks by size regardless of entry order', () => {
    const results = evaluateBreaks(
      lines,
      [
        { id: 'c', label: '3x', multiplier: 3 },
        { id: 'a', label: '1x', multiplier: 1 },
        { id: 'b', label: '2x', multiplier: 2 },
      ],
      ctx,
    );
    expect(results.map((r) => r.multiplier)).toEqual([1, 2, 3]);
  });

  it('still returns volumes when the lane has no rates at all', () => {
    const results = evaluateBreaks(lines, defaultBreaks(), {
      containerTypes: SEED_CONTAINER_TYPES,
    });
    expect(results).toHaveLength(3);
    expect(results[0]!.mode).toBeNull();
    expect(results[0]!.totalAud).toBeNull();
    expect(results[0]!.metrics.totalVolumeCbm).toBeGreaterThan(0);
    // The container fit is geometry, so it is still worked out.
    expect(results[0]!.containerSummary).not.toBe('');
  });

  it('ignores a break with a zero or negative multiplier', () => {
    const results = evaluateBreaks(lines, [
      { id: 'a', label: 'ok', multiplier: 1 },
      { id: 'b', label: 'bad', multiplier: 0 },
      { id: 'c', label: 'worse', multiplier: -2 },
    ], ctx);
    expect(results).toHaveLength(1);
  });

  it('agrees with a directly computed consignment at the same quantity', () => {
    const results = evaluateBreaks(lines, [{ id: 'x', label: '4x', multiplier: 4 }], ctx);
    const direct = consignmentMetrics(scaleLines(lines, 4));
    expect(results[0]!.metrics.totalVolumeCbm).toBeCloseTo(direct.totalVolumeCbm, 9);
    expect(results[0]!.metrics.totalWeightKg).toBeCloseTo(direct.totalWeightKg, 9);
  });
});
