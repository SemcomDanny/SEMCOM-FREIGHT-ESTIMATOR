import { describe, expect, it } from 'vitest';
import {
  SEED_CONTAINER_TYPES,
  SEED_PALLET_TYPES,
  ageInDays,
  buildRfqEmail,
  consignmentMetrics,
  defaultColumns,
  estimateVariance,
  forecast,
  isStale,
  landedCost,
  summariseVariance,
  toCsv,
  validateAgainstContainer,
  validateAll,
  validateCartonLine,
  validatePalletInContainer,
  validatePayload,
} from '../src/index.js';
import type { CartonLine, CostEstimate, SeriesPoint } from '../src/index.js';

const series: SeriesPoint[] = [
  { date: '2026-01-15', value: 2400 },
  { date: '2026-03-01', value: 2650 },
  { date: '2026-05-20', value: 2500 },
  { date: '2026-08-01', value: 2900 },
];

describe('rate history and variance', () => {
  it('summarises min, max, mean, std dev and the change vs previous version', () => {
    const s = summariseVariance(series);
    expect(s.count).toBe(4);
    expect(s.min).toBe(2400);
    expect(s.max).toBe(2900);
    expect(s.mean).toBeCloseTo(2612.5, 4);
    expect(s.stdDev).toBeCloseTo(188.33, 1); // population sigma
    expect(s.latest).toBe(2900);
    expect(s.previous).toBe(2500);
    expect(s.changeAbs).toBe(400);
    expect(s.changePct).toBeCloseTo(16, 4);
  });

  it('flags a stale rate past the threshold', () => {
    const asOf = new Date('2026-11-01T00:00:00Z');
    expect(ageInDays(series, asOf)).toBe(92);
    expect(isStale(series, 60, asOf)).toBe(true);
    expect(isStale(series, 120, asOf)).toBe(false);
  });

  it('labels a trailing average as a forecast and the latest rate as quoted', () => {
    const asOf = new Date('2026-09-01T00:00:00Z');
    const latest = forecast(series, 'latest', null, asOf)!;
    expect(latest.isForecast).toBe(false);
    expect(latest.value).toBe(2900);

    const trailing = forecast(series, 'trailing_average', 12, asOf)!;
    expect(trailing.isForecast).toBe(true);
    expect(trailing.value).toBeCloseTo(2612.5, 4);
    expect(trailing.sampleSize).toBe(4);

    const short = forecast(series, 'trailing_average', 6, asOf)!;
    expect(short.sampleSize).toBe(3); // Mar, May, Aug
  });

  it('projects a linear trend forward', () => {
    const asOf = new Date('2026-09-01T00:00:00Z');
    const trend = forecast(series, 'linear_trend', 12, asOf)!;
    expect(trend.isForecast).toBe(true);
    expect(trend.value).toBeGreaterThan(2500);
  });

  it('reports estimate vs actual variance', () => {
    const v = estimateVariance(4200, 4620);
    expect(v.abs).toBeCloseTo(420, 6);
    expect(v.pct).toBeCloseTo(10, 6);
    expect(v.direction).toBe('under');
  });
});

describe('guardrails', () => {
  const base: CartonLine = {
    id: 'A',
    description: 'Test carton',
    lengthMm: 600,
    widthMm: 400,
    heightMm: 300,
    weightKg: 12,
    qty: 10,
  };

  it('rejects zero and negative dimensions', () => {
    const issues = validateCartonLine({ ...base, lengthMm: 0, widthMm: -5 });
    expect(issues.filter((i) => i.code === 'DIM_NOT_POSITIVE')).toHaveLength(2);
    expect(issues.every((i) => i.severity === 'error')).toBe(true);
  });

  it('flags a carton over the manual handling limit', () => {
    const issues = validateCartonLine({ ...base, weightKg: 34 });
    expect(issues.some((i) => i.code === 'MANUAL_HANDLING')).toBe(true);
  });

  it('rejects a carton larger than the container opening', () => {
    const c20 = SEED_CONTAINER_TYPES[0]!;
    expect(validateAgainstContainer({ ...base, lengthMm: 6200 }, c20)[0]!.code).toBe('CARTON_OVERSIZE');
    expect(validateAgainstContainer(base, c20)).toHaveLength(0);
    // Only oversize when it fits nothing available.
    expect(validateAll([{ ...base, lengthMm: 12000 }], SEED_CONTAINER_TYPES)).toHaveLength(0);
    expect(validateAll([{ ...base, lengthMm: 14000 }], SEED_CONTAINER_TYPES)).toHaveLength(1);
  });

  it('warns about Australian Standard pallets in ISO containers', () => {
    const issues = validatePalletInContainer(SEED_PALLET_TYPES[0]!, SEED_CONTAINER_TYPES[0]!);
    expect(issues[0]!.code).toBe('AUS_PALLET_ISO');
    expect(issues[0]!.message).toMatch(/2330 mm in a 2350 mm/);
  });

  it('warns when payload rather than volume forces an extra container', () => {
    const issues = validatePayload({
      totalWeightKg: 40000,
      totalVolumeCbm: 20,
      container: SEED_CONTAINER_TYPES[0]!,
      containersByVolume: 1,
    });
    expect(issues[0]!.code).toBe('PAYLOAD_LIMITED');
  });
});

describe('landed cost', () => {
  it('puts duty on the customs value and GST on CIF plus duty', () => {
    const r = landedCost({
      goodsValueAud: 50000,
      freightAud: 4000,
      insuranceAud: 500,
      dutyRatePct: 5,
      gstRatePct: 10,
    });
    expect(r.cifAud).toBe(54500);
    expect(r.dutyAud).toBe(2500);
    expect(r.votiAud).toBe(57000);
    expect(r.gstAud).toBe(5700);
    expect(r.totalLandedAud).toBe(62700);
    expect(r.disclaimer).toMatch(/Not customs advice/);
  });
});

describe('workflow output', () => {
  const lines: CartonLine[] = [
    { id: 'A', description: 'Widget box', lengthMm: 600, widthMm: 400, heightMm: 300, weightKg: 12, qty: 50, unitsPerCarton: 24 },
  ];
  const metrics = consignmentMetrics(lines);

  it('builds an RFQ email with everything the forwarder needs', () => {
    const rfq = buildRfqEmail({
      jobRef: 'Q-2026-118',
      originPort: 'Shanghai',
      destinationPort: 'Melbourne',
      incoterm: 'FOB',
      cargoReadyDate: '2026-09-20',
      commodity: 'Powder coated steel brackets',
      hsCode: '7326.90',
      dangerousGoods: false,
      metrics,
      loadingMode: 'floor',
      containerSummary: '1 x 20GP at 62% volumetric utilisation',
      senderName: 'Danny',
    });
    expect(rfq.subject).toMatch(/Shanghai - Melbourne/);
    expect(rfq.subject).toMatch(/Q-2026-118/);
    for (const needle of [
      'Incoterm:          FOB',
      'HS code:           7326.90',
      'Dangerous goods:   No',
      'Cargo ready:       2026-09-20',
      'Chargeable (W/M)',
      'Widget box',
      '1 x 20GP',
    ]) {
      expect(rfq.body).toContain(needle);
    }
  });

  it('exports a CSV with renamed columns in the user\'s own order', () => {
    const estimate: CostEstimate = {
      mode: 'LCL',
      basis: '3.600 CBM chargeable (volume)',
      currency: 'AUD',
      fxToAud: 1,
      oceanCost: 800,
      ancillariesCost: 400,
      total: 1200,
      totalAud: 1200,
      components: [],
      costPerCbm: 333.33,
      costPerCarton: 24,
      costPerUnit: 1,
      warnings: [],
    };
    const ctx = {
      jobRef: 'Q-2026-118',
      client: 'Acme, Inc.',
      lane: 'Shanghai -> Melbourne',
      metrics,
      estimate,
      rateCardId: 'rc-lcl-1',
      calculatedAt: '2026-09-01',
    };
    const csv = toCsv([ctx], [
      { key: 'jobRef', header: 'QUOTE NO' },
      { key: 'costPerUnit', header: 'FREIGHT/UNIT' },
      { key: 'client', header: 'CUSTOMER' },
    ]);
    const [header, row] = csv.split('\n');
    expect(header).toBe('QUOTE NO,FREIGHT/UNIT,CUSTOMER');
    // The comma in the client name must not break the columns.
    expect(row).toBe('Q-2026-118,1,"Acme, Inc."');
  });

  it('offers every estimate field as a mappable column', () => {
    const cols = defaultColumns();
    expect(cols.some((c) => c.key === 'costPerUnit')).toBe(true);
    expect(cols.some((c) => c.key === 'costPerCarton')).toBe(true);
    expect(cols.some((c) => c.key === 'chargeableCbm')).toBe(true);
  });
});
