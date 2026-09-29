import { describe, expect, it } from 'vitest';
import { consignmentMetrics, parsePastedCartons, toMm } from '../src/index.js';
import type { CartonLine } from '../src/index.js';

const line = (over: Partial<CartonLine> & { id: string }): CartonLine => ({
  description: over.id,
  lengthMm: 400,
  widthMm: 300,
  heightMm: 250,
  weightKg: 8,
  qty: 10,
  ...over,
});

describe('consignment metrics', () => {
  it('matches a manual calculation for three carton types', () => {
    // 600x400x300 = 0.072 CBM each x 50 = 3.6 CBM, 12 kg x 50 = 600 kg
    // 400x300x250 = 0.03  CBM each x 120 = 3.6 CBM, 5 kg x 120 = 600 kg
    // 800x600x500 = 0.24  CBM each x 12 = 2.88 CBM, 25 kg x 12 = 300 kg
    const lines: CartonLine[] = [
      line({ id: 'A', lengthMm: 600, widthMm: 400, heightMm: 300, weightKg: 12, qty: 50 }),
      line({ id: 'B', lengthMm: 400, widthMm: 300, heightMm: 250, weightKg: 5, qty: 120 }),
      line({ id: 'C', lengthMm: 800, widthMm: 600, heightMm: 500, weightKg: 25, qty: 12 }),
    ];
    const m = consignmentMetrics(lines);
    expect(m.totalVolumeCbm).toBeCloseTo(10.08, 2);
    expect(m.totalWeightKg).toBeCloseTo(1500, 6);
    expect(m.totalCartons).toBe(182);
    // 1500 kg / 1000 = 1.5 revenue tonnes, well under 10.08 CBM
    expect(m.chargeableCbm).toBeCloseTo(10.08, 2);
    expect(m.chargeableBasis).toBe('volume');
    expect(Math.abs(m.totalVolumeCbm - 10.08)).toBeLessThan(0.01);
  });

  it('charges on weight when density exceeds 1000 kg/CBM', () => {
    const m = consignmentMetrics([
      line({ id: 'dense', lengthMm: 400, widthMm: 400, heightMm: 400, weightKg: 80, qty: 20 }),
    ]);
    // 0.064 CBM x 20 = 1.28 CBM; 1600 kg -> 1.6 revenue tonnes
    expect(m.totalVolumeCbm).toBeCloseTo(1.28, 6);
    expect(m.densityKgPerCbm).toBeCloseTo(1250, 6);
    expect(m.weightCharged).toBe(true);
    expect(m.chargeableCbm).toBeCloseTo(1.6, 6);
    expect(m.chargeableBasis).toBe('weight');
  });

  it('keeps actual and chargeable volume separate', () => {
    const m = consignmentMetrics([
      line({ id: 'light', lengthMm: 1000, widthMm: 1000, heightMm: 1000, weightKg: 50, qty: 3 }),
    ]);
    expect(m.totalVolumeCbm).toBeCloseTo(3, 6);
    expect(m.chargeableCbm).toBeCloseTo(3, 6);
    expect(m.weightCharged).toBe(false);
  });

  it('rolls per-unit counts up for cost allocation', () => {
    const m = consignmentMetrics([line({ id: 'A', qty: 10, unitsPerCarton: 24 })]);
    expect(m.totalUnits).toBe(240);
  });
});

describe('excel paste', () => {
  it('parses a tab-separated block with a header row', () => {
    const text = [
      'Description\tL\tW\tH\tKg\tQty',
      'Widget box\t600\t400\t300\t12.5\t50',
      'Gadget carton\t400\t300\t250\t5\t120',
    ].join('\n');
    const rows = parsePastedCartons(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.line!.description).toBe('Widget box');
    expect(rows[0]!.line!.lengthMm).toBe(600);
    expect(rows[0]!.line!.weightKg).toBe(12.5);
    expect(rows[1]!.line!.qty).toBe(120);
  });

  it('handles cm input, thousands separators and rows without a description', () => {
    const rows = parsePastedCartons('60\t40\t30\t12\t1,200', { lengthUnit: 'cm' });
    expect(rows[0]!.line!.lengthMm).toBeCloseTo(600, 6);
    expect(rows[0]!.line!.qty).toBe(1200);
  });

  it('reports rows it cannot read instead of silently dropping them', () => {
    const rows = parsePastedCartons('Broken row\tnot-a-number\t\t');
    expect(rows[0]!.error).toBeTruthy();
    expect(rows[0]!.line).toBeUndefined();
  });
});

describe('units', () => {
  it('converts inches to mm', () => {
    expect(toMm(10, 'in')).toBeCloseTo(254, 6);
  });
});
