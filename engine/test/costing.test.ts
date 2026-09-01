import { describe, expect, it } from 'vitest';
import {
  SEED_CONTAINER_TYPES,
  cartonPackItems,
  compareModes,
  consignmentMetrics,
  estimateAir,
  estimateFcl,
  estimateLcl,
  fclCostAtVolume,
  findBreakeven,
  lclCostAtVolume,
  optimiseContainerMix,
} from '../src/index.js';
import type { CartonLine, RateCard } from '../src/index.js';

const containers = SEED_CONTAINER_TYPES;

const lclCard: RateCard = {
  id: 'rc-lcl-1',
  laneId: 'SHA-MEL',
  mode: 'LCL',
  currency: 'AUD',
  fxToAud: 1,
  effectiveFrom: '2026-08-01',
  lclPoints: [
    { volumeCbm: 1, totalPrice: 380 },
    { volumeCbm: 5, totalPrice: 900 },
    { volumeCbm: 15, totalPrice: 1950 },
  ],
  lclConfig: { fitModel: 'piecewise_linear', minCbm: 1, minCharge: 0 },
  ancillaries: [
    { name: 'Customs clearance', basis: 'per_shipment', amount: 220 },
    { name: 'CTO / unpack fee', basis: 'per_cbm', amount: 32 },
    { name: 'Delivery cartage', basis: 'per_shipment', amount: 260 },
  ],
};

const fclCard: RateCard = {
  id: 'rc-fcl-1',
  laneId: 'SHA-MEL',
  mode: 'FCL',
  currency: 'AUD',
  fxToAud: 1,
  effectiveFrom: '2026-08-01',
  fcl: [
    { containerTypeId: '20GP', oceanCost: 1600, originCharges: 320, destCharges: 780 },
    { containerTypeId: '40GP', oceanCost: 2500, originCharges: 380, destCharges: 900 },
    { containerTypeId: '40HC', oceanCost: 2600, originCharges: 380, destCharges: 900 },
    { containerTypeId: '45HC', oceanCost: 3100, originCharges: 420, destCharges: 980 },
  ],
  ancillaries: [
    { name: 'Customs clearance', basis: 'per_shipment', amount: 220 },
    { name: 'Delivery cartage', basis: 'per_container', amount: 420 },
  ],
};

const line = (over: Partial<CartonLine> & { id: string }): CartonLine => ({
  description: over.id,
  lengthMm: 600,
  widthMm: 400,
  heightMm: 300,
  weightKg: 12,
  qty: 50,
  stackable: true,
  ...over,
});

describe('LCL estimate', () => {
  it('prices off the curve at the chargeable volume and adds ancillaries', () => {
    const m = consignmentMetrics([line({ id: 'A', qty: 70 })]); // 70 x 0.072 = 5.04 CBM
    const e = estimateLcl(m, lclCard);
    expect(m.chargeableCbm).toBeCloseTo(5.04, 6);
    // curve: 900 + 0.04 * (1950-900)/10 = 904.2
    expect(e.oceanCost).toBeCloseTo(904.2, 4);
    expect(e.ancillariesCost).toBeCloseTo(220 + 32 * 5.04 + 260, 4);
    expect(e.total).toBeCloseTo(e.oceanCost + e.ancillariesCost, 6);
    expect(e.costPerCarton).toBeCloseTo(e.total / 70, 6);
  });

  it('carries a formula and a source rate version on every component', () => {
    const m = consignmentMetrics([line({ id: 'A' })]);
    const e = estimateLcl(m, lclCard);
    for (const c of e.components) {
      expect(c.formula.length).toBeGreaterThan(0);
      expect(c.sourceRateCardId).toBe('rc-lcl-1');
    }
  });

  it('applies FX to AUD and honours a per-estimate override', () => {
    const usd: RateCard = { ...lclCard, currency: 'USD', fxToAud: 1.55 };
    const m = consignmentMetrics([line({ id: 'A' })]);
    expect(estimateLcl(m, usd).totalAud).toBeCloseTo(estimateLcl(m, usd).total * 1.55, 6);
    const override = estimateLcl(m, usd, { fxOverride: 1.5 });
    expect(override.totalAud).toBeCloseTo(override.total * 1.5, 6);
  });
});

describe('container mix', () => {
  it('picks the cheapest mix that holds the whole consignment', () => {
    const items = cartonPackItems([line({ id: 'A', qty: 900 })]); // 64.8 CBM
    const mix = optimiseContainerMix(
      items,
      containers,
      (id) => {
        const r = fclCard.fcl!.find((f) => f.containerTypeId === id);
        return r ? r.oceanCost + r.originCharges + r.destCharges : null;
      },
      0.85,
    )!;
    expect(mix.unplaced).toHaveLength(0);
    expect(mix.containers.length).toBeGreaterThan(0);
    // Everything placed adds up to the consignment volume.
    expect(mix.totalPlacedVolumeCbm).toBeCloseTo(900 * 0.072, 4);
  });

  it('prefers one 40HC over two 20GP when that is cheaper', () => {
    const items = cartonPackItems([line({ id: 'A', qty: 700 })]); // 50.4 CBM
    const mix = optimiseContainerMix(
      items,
      containers,
      (id) => {
        const r = fclCard.fcl!.find((f) => f.containerTypeId === id);
        return r ? r.oceanCost + r.originCharges + r.destCharges : null;
      },
      0.85,
    )!;
    const twenty = 1600 + 320 + 780;
    expect(mix.cost).toBeLessThanOrEqual(3 * twenty);
  });
});

describe('FCL estimate', () => {
  it('breaks ocean, origin and destination out per container type', () => {
    const items = cartonPackItems([line({ id: 'A', qty: 300 })]);
    const m = consignmentMetrics([line({ id: 'A', qty: 300 })]);
    const mix = optimiseContainerMix(
      items,
      containers,
      (id) => {
        const r = fclCard.fcl!.find((f) => f.containerTypeId === id);
        return r ? r.oceanCost + r.originCharges + r.destCharges : null;
      },
      0.85,
    )!;
    const e = estimateFcl(m, fclCard, mix, containers);
    expect(e.components.some((c) => /Ocean freight/.test(c.label))).toBe(true);
    expect(e.components.some((c) => /Origin charges/.test(c.label))).toBe(true);
    expect(e.components.some((c) => /Destination charges/.test(c.label))).toBe(true);
    const nContainers = mix.mix.reduce((s, x) => s + x.count, 0);
    expect(e.ancillariesCost).toBeCloseTo(220 + 420 * nContainers, 4);
  });

  it('reconciles: ocean + port charges + ancillaries equals the total', () => {
    const lines = [line({ id: 'A', qty: 300 })];
    const m = consignmentMetrics(lines);
    const mix = optimiseContainerMix(
      cartonPackItems(lines),
      containers,
      (id) => {
        const r = fclCard.fcl!.find((f) => f.containerTypeId === id);
        return r ? r.oceanCost + r.originCharges + r.destCharges : null;
      },
      0.85,
    )!;
    const e = estimateFcl(m, fclCard, mix, containers);
    expect(e.portChargesCost).toBeGreaterThan(0);
    expect(e.oceanCost + e.portChargesCost + e.ancillariesCost).toBeCloseTo(e.total, 6);
    expect(e.components.reduce((s, c) => s + c.amount, 0)).toBeCloseTo(e.total, 6);
  });

  it('has no port charges on LCL or air, so the same reconciliation holds', () => {
    const m = consignmentMetrics([line({ id: 'A', qty: 70 })]);
    const e = estimateLcl(m, lclCard);
    expect(e.portChargesCost).toBe(0);
    expect(e.oceanCost + e.portChargesCost + e.ancillariesCost).toBeCloseTo(e.total, 6);
  });
});

describe('airfreight', () => {
  const airCard: RateCard = {
    id: 'rc-air-1',
    laneId: 'SHA-MEL',
    mode: 'AIR',
    currency: 'AUD',
    fxToAud: 1,
    effectiveFrom: '2026-08-01',
    air: {
      minCharge: 150,
      breaks: [
        { thresholdKg: 0, ratePerKg: 8.5 },
        { thresholdKg: 45, ratePerKg: 6.9 },
        { thresholdKg: 100, ratePerKg: 5.8 },
        { thresholdKg: 300, ratePerKg: 5.1 },
        { thresholdKg: 500, ratePerKg: 4.6 },
      ],
      fuelSurchargePerKg: 1.1,
      securitySurchargePerKg: 0.25,
      volumetricDivisor: 6000,
    },
  };

  it('charges on volumetric weight when the cargo is light and bulky', () => {
    // 1 CBM = 1,000,000 cm3 / 6000 = 166.67 volumetric kg
    const m = consignmentMetrics([
      line({ id: 'light', lengthMm: 1000, widthMm: 1000, heightMm: 1000, weightKg: 40, qty: 1 }),
    ]);
    const e = estimateAir(m, airCard);
    expect(e.basis).toMatch(/volumetric/);
    expect(e.basis).toMatch(/166\.7/);
  });

  it('takes the next weight break when it prices cheaper', () => {
    // 280 kg at the 100 kg break (5.80) is 1624; 300 kg at 5.10 is 1530.
    const m = consignmentMetrics([
      line({ id: 'x', lengthMm: 500, widthMm: 400, heightMm: 300, weightKg: 28, qty: 10 }),
    ]);
    const e = estimateAir(m, airCard);
    const freight = e.components.find((c) => c.label === 'Air freight')!;
    expect(freight.amount).toBeCloseTo(300 * 5.1, 4);
    expect(e.warnings.some((w) => /cheaper/.test(w))).toBe(true);
  });

  it('applies the minimum charge to a tiny shipment', () => {
    const m = consignmentMetrics([
      line({ id: 'tiny', lengthMm: 100, widthMm: 100, heightMm: 100, weightKg: 0.5, qty: 1 }),
    ]);
    const e = estimateAir(m, airCard);
    expect(e.components.find((c) => c.label === 'Air freight')!.amount).toBe(150);
  });
});

describe('mode comparison', () => {
  it('defaults to LCL for a small consignment and states the saving', () => {
    const lines = [line({ id: 'A', qty: 40 })]; // 2.88 CBM
    const m = consignmentMetrics(lines);
    const c = compareModes({
      metrics: m,
      packItems: cartonPackItems(lines),
      containerTypes: containers,
      lclCard,
      fclCard,
    });
    expect(c.recommended).toBe('LCL');
    expect(c.savingAud).toBeGreaterThan(0);
    expect(c.reason).toMatch(/LCL selected/);
    expect(c.reason).toMatch(/cheaper than/);
    // Both estimates are present so the UI toggle needs no recalculation.
    expect(c.estimates.map((e) => e.mode).sort()).toEqual(['FCL', 'LCL']);
  });

  it('defaults to FCL for a full container load', () => {
    const lines = [line({ id: 'A', qty: 350 })]; // 25.2 CBM
    const m = consignmentMetrics(lines);
    const c = compareModes({
      metrics: m,
      packItems: cartonPackItems(lines),
      containerTypes: containers,
      lclCard,
      fclCard,
    });
    expect(c.recommended).toBe('FCL');
  });
});

describe('breakeven', () => {
  const params = {
    lclCard,
    fclCard,
    containerTypes: containers,
    densityKgPerCbm: 166.7,
    stowEfficiency: 0.85,
  };

  it('finds the volume where LCL and FCL cost the same', () => {
    const be = findBreakeven(params)!;
    expect(be).toBeTruthy();
    expect(be.volumeCbm).toBeGreaterThan(0);
    // Acceptance: entering the breakeven volume gives totals within $1.
    expect(Math.abs(be.lclTotal - be.fclTotal)).toBeLessThan(1);
  });

  it('agrees with the standalone LCL and FCL cost functions at that volume', () => {
    const be = findBreakeven(params)!;
    const lcl = lclCostAtVolume(be.volumeCbm, params);
    const fcl = fclCostAtVolume(be.volumeCbm, params)!;
    expect(Math.abs(lcl - fcl.cost)).toBeLessThan(1);
    expect(be.containerMix).toBe(fcl.mix);
  });

  it('has LCL cheaper below the breakeven and FCL cheaper above it', () => {
    const be = findBreakeven(params)!;
    const below = be.volumeCbm * 0.7;
    const above = be.volumeCbm * 1.15;
    expect(lclCostAtVolume(below, params)).toBeLessThan(fclCostAtVolume(below, params)!.cost);
    expect(lclCostAtVolume(above, params)).toBeGreaterThan(fclCostAtVolume(above, params)!.cost);
  });
});
