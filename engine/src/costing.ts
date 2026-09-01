import type {
  AncillaryCharge,
  ConsignmentMetrics,
  ContainerType,
  CostComponent,
  CostEstimate,
  PackItem,
  PackResult,
  PackedContainer,
  RateCard,
  ShipMode,
  UnplacedItem,
} from './types.js';
import { chargeableLclPrice, fitLclCurve } from './curve.js';
import { DEFAULT_STOW_EFFICIENCY, containerCbm, packContainer } from './packing.js';
import { boxVolumeCbm, round } from './units.js';

export interface ContainerMix {
  containerTypeId: string;
  containerTypeName: string;
  count: number;
}

export interface MixResult {
  mix: ContainerMix[];
  containers: PackedContainer[];
  unplaced: UnplacedItem[];
  cost: number;
  /** Utilisation across the whole mix. */
  meanVolumeUtilisation: number;
  meanPayloadUtilisation: number;
  totalPlacedVolumeCbm: number;
  totalPlacedWeightKg: number;
  stowEfficiency: number;
}

export type ContainerCostFn = (typeId: string) => number | null;

/** Pack items into a fixed sequence of containers. */
export function packSequence(
  items: PackItem[],
  sequence: ContainerType[],
  stowEfficiency = DEFAULT_STOW_EFFICIENCY,
): { containers: PackedContainer[]; remaining: PackItem[] } {
  let queue = items.filter((i) => i.qty > 0).map((i) => ({ ...i }));
  const containers: PackedContainer[] = [];

  for (const type of sequence) {
    if (queue.length === 0) break;
    const { placements, remaining, payloadLimited } = packContainer(
      queue,
      type,
      containers.length,
      { stowEfficiency },
    );
    const placedVolumeCbm = placements.reduce((s, p) => s + boxVolumeCbm(p.lMm, p.wMm, p.hMm), 0);
    const placedWeightKg = placements.reduce((s, p) => s + p.weightKg, 0);
    const interior = containerCbm(type);
    containers.push({
      index: containers.length,
      containerTypeId: type.id,
      containerTypeName: type.name,
      placements,
      placedVolumeCbm,
      placedWeightKg,
      volumeUtilisation: interior > 0 ? placedVolumeCbm / interior : 0,
      payloadUtilisation: type.maxPayloadKg > 0 ? placedWeightKg / type.maxPayloadKg : 0,
      payloadLimited,
    });
    queue = remaining;
  }
  return { containers, remaining: queue };
}

function summarise(
  containers: PackedContainer[],
  remaining: PackItem[],
  types: ContainerType[],
  costOf: ContainerCostFn,
  stowEfficiency: number,
): MixResult {
  const counts = new Map<string, number>();
  for (const c of containers) counts.set(c.containerTypeId, (counts.get(c.containerTypeId) ?? 0) + 1);
  const mix: ContainerMix[] = [...counts.entries()].map(([id, count]) => ({
    containerTypeId: id,
    containerTypeName: types.find((t) => t.id === id)?.name ?? id,
    count,
  }));
  const cost = containers.reduce((s, c) => s + (costOf(c.containerTypeId) ?? Infinity), 0);
  return {
    mix,
    containers,
    unplaced: remaining.map((i) => ({
      refId: i.refId,
      label: i.label,
      qty: i.qty,
      reason: 'Did not fit the container mix',
    })),
    cost,
    meanVolumeUtilisation:
      containers.length > 0
        ? containers.reduce((s, c) => s + c.volumeUtilisation, 0) / containers.length
        : 0,
    meanPayloadUtilisation:
      containers.length > 0
        ? containers.reduce((s, c) => s + c.payloadUtilisation, 0) / containers.length
        : 0,
    totalPlacedVolumeCbm: containers.reduce((s, c) => s + c.placedVolumeCbm, 0),
    totalPlacedWeightKg: containers.reduce((s, c) => s + c.placedWeightKg, 0),
    stowEfficiency,
  };
}

/**
 * Choose the cheapest container mix that holds the whole consignment.
 *
 * Three deterministic candidate families are evaluated and the cheapest that
 * places everything wins:
 *   1. n of a single type, for each priced type;
 *   2. that, with the last container downsized to the cheapest type that still
 *      takes the tail — this is where most of the saving is;
 *   3. a greedy mix that repeatedly takes the type with the best cost per CBM
 *      actually loaded for whatever is left.
 */
export function optimiseContainerMix(
  items: PackItem[],
  containerTypes: ContainerType[],
  costOf: ContainerCostFn,
  stowEfficiency = DEFAULT_STOW_EFFICIENCY,
  maxContainers = 20,
): MixResult | null {
  const priced = containerTypes.filter((t) => t.active !== false && costOf(t.id) != null);
  if (priced.length === 0 || items.every((i) => i.qty <= 0)) return null;

  const candidates: MixResult[] = [];

  const allOfType = new Map<string, PackedContainer[]>();
  for (const type of priced) {
    const seq = Array(maxContainers).fill(type) as ContainerType[];
    const { containers, remaining } = packSequence(items, seq, stowEfficiency);
    const used = containers.filter((c) => c.placements.length > 0);
    if (remaining.length > 0 || used.length === 0) continue;
    allOfType.set(type.id, used);
    candidates.push(summarise(used, [], priced, costOf, stowEfficiency));

    // 2. Downsize the tail.
    if (used.length > 1) {
      for (const tail of priced) {
        if (tail.id === type.id) continue;
        const seq2 = [...Array(used.length - 1).fill(type), tail] as ContainerType[];
        const r2 = packSequence(items, seq2, stowEfficiency);
        const used2 = r2.containers.filter((c) => c.placements.length > 0);
        if (r2.remaining.length === 0 && used2.length > 0) {
          candidates.push(summarise(used2, [], priced, costOf, stowEfficiency));
        }
      }
    }
  }

  // 3. Greedy: best cost per CBM actually loaded, one container at a time.
  {
    let queue = items.filter((i) => i.qty > 0).map((i) => ({ ...i }));
    const sequence: ContainerType[] = [];
    let guard = 0;
    while (queue.length > 0 && guard++ < maxContainers) {
      let bestType: ContainerType | null = null;
      let bestRatio = Infinity;
      let bestRemaining: PackItem[] = [];
      for (const type of priced) {
        const { placements, remaining } = packContainer(queue, type, 0, { stowEfficiency });
        if (placements.length === 0) continue;
        const vol = placements.reduce((s, p) => s + boxVolumeCbm(p.lMm, p.wMm, p.hMm), 0);
        if (vol <= 0) continue;
        const ratio = (costOf(type.id) ?? Infinity) / vol;
        if (ratio < bestRatio - 1e-9) {
          bestRatio = ratio;
          bestType = type;
          bestRemaining = remaining;
        }
      }
      if (!bestType) break;
      sequence.push(bestType);
      queue = bestRemaining;
    }
    if (queue.length === 0 && sequence.length > 0) {
      const r = packSequence(items, sequence, stowEfficiency);
      const used = r.containers.filter((c) => c.placements.length > 0);
      if (r.remaining.length === 0 && used.length > 0) {
        candidates.push(summarise(used, [], priced, costOf, stowEfficiency));
      }
    }
  }

  if (candidates.length === 0) {
    // Nothing holds everything — report the best partial fit so the estimator
    // sees what is left over rather than a blank screen.
    const fallbackType = priced[0]!;
    const seq = Array(maxContainers).fill(fallbackType) as ContainerType[];
    const { containers, remaining } = packSequence(items, seq, stowEfficiency);
    return summarise(
      containers.filter((c) => c.placements.length > 0),
      remaining,
      priced,
      costOf,
      stowEfficiency,
    );
  }

  candidates.sort(
    (a, b) => a.cost - b.cost || a.containers.length - b.containers.length,
  );
  return candidates[0]!;
}

/* ------------------------------------------------------------------ */
/* Ancillaries                                                        */
/* ------------------------------------------------------------------ */

export interface AncillaryContext {
  cbm: number;
  containers: number;
  weightKg: number;
}

export function ancillaryComponents(
  charges: AncillaryCharge[] | undefined,
  mode: ShipMode,
  ctx: AncillaryContext,
  rateCardId?: string,
): CostComponent[] {
  if (!charges) return [];
  const out: CostComponent[] = [];
  for (const c of charges) {
    if (c.mode && c.mode !== mode) continue;
    let amount = 0;
    let formula = '';
    switch (c.basis) {
      case 'per_shipment':
        amount = c.amount;
        formula = `${c.name}: flat ${c.amount.toFixed(2)} per shipment`;
        break;
      case 'per_cbm':
        amount = c.amount * ctx.cbm;
        formula = `${c.name}: ${c.amount.toFixed(2)} x ${ctx.cbm.toFixed(3)} CBM`;
        break;
      case 'per_container':
        if (mode !== 'FCL') continue;
        amount = c.amount * ctx.containers;
        formula = `${c.name}: ${c.amount.toFixed(2)} x ${ctx.containers} container(s)`;
        break;
      case 'per_kg':
        amount = c.amount * ctx.weightKg;
        formula = `${c.name}: ${c.amount.toFixed(2)} x ${ctx.weightKg.toFixed(1)} kg`;
        break;
    }
    out.push({ label: c.name, amount, amountAud: 0, formula, sourceRateCardId: rateCardId });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Estimates                                                          */
/* ------------------------------------------------------------------ */

export interface EstimateOptions {
  /** Overrides the rate card's stored FX rate for this estimate only. */
  fxOverride?: number;
  stowEfficiency?: number;
}

function finalise(
  estimate: Omit<CostEstimate, 'total' | 'totalAud' | 'costPerCbm' | 'costPerCarton' | 'costPerUnit' | 'ancillariesCost'>,
  ancillaries: CostComponent[],
  metrics: ConsignmentMetrics,
  fx: number,
): CostEstimate {
  const components = [...estimate.components, ...ancillaries].map((c) => ({
    ...c,
    amountAud: c.amount * fx,
  }));
  const ancillariesCost = ancillaries.reduce((s, c) => s + c.amount, 0);
  const total = components.reduce((s, c) => s + c.amount, 0);
  const cbm = metrics.totalVolumeCbm || metrics.chargeableCbm;
  return {
    ...estimate,
    components,
    fxToAud: fx,
    ancillariesCost,
    total,
    totalAud: total * fx,
    costPerCbm: cbm > 0 ? total / cbm : 0,
    costPerCarton: metrics.totalCartons > 0 ? total / metrics.totalCartons : 0,
    costPerUnit: metrics.totalUnits > 0 ? total / metrics.totalUnits : null,
  };
}

/** LCL estimate: fitted curve at the chargeable (W/M) volume, plus ancillaries. */
export function estimateLcl(
  metrics: ConsignmentMetrics,
  card: RateCard,
  opts: EstimateOptions = {},
): CostEstimate {
  const fx = opts.fxOverride ?? card.fxToAud ?? 1;
  const warnings: string[] = [];
  const curve = fitLclCurve(card.lclPoints ?? [], card.lclConfig?.fitModel ?? 'piecewise_linear');
  warnings.push(...curve.warnings);

  const { price, effectiveVolume, minimumApplied } = chargeableLclPrice(
    curve,
    metrics.chargeableCbm,
    card.lclConfig,
  );

  if (minimumApplied === 'volume') {
    warnings.push(
      `Minimum ${card.lclConfig?.minCbm} CBM applied — charged on ${effectiveVolume.toFixed(3)} CBM, ` +
        `not the actual ${metrics.chargeableCbm.toFixed(3)} CBM.`,
    );
  }
  if (minimumApplied === 'charge') {
    warnings.push(`Minimum charge of ${card.lclConfig?.minCharge?.toFixed(2)} applied.`);
  }
  if (metrics.chargeableBasis === 'weight') {
    warnings.push(
      `Weight-charged: ${metrics.totalWeightKg.toFixed(0)} kg / 1000 exceeds ` +
        `${metrics.totalVolumeCbm.toFixed(3)} CBM, so ${metrics.chargeableCbm.toFixed(3)} revenue ` +
        `tonnes are billed.`,
    );
  }

  const ocean: CostComponent = {
    label: 'LCL ocean freight',
    amount: price,
    amountAud: 0,
    formula:
      minimumApplied === 'charge'
        ? `max(minimum charge ${card.lclConfig?.minCharge?.toFixed(2)}, ${curve.describe()} at ${effectiveVolume.toFixed(3)} CBM)`
        : `${curve.describe()} evaluated at ${effectiveVolume.toFixed(3)} chargeable CBM`,
    sourceRateCardId: card.id,
  };

  const ancillaries = ancillaryComponents(
    card.ancillaries,
    'LCL',
    { cbm: metrics.chargeableCbm, containers: 0, weightKg: metrics.totalWeightKg },
    card.id,
  );

  return finalise(
    {
      mode: 'LCL',
      basis: `${metrics.chargeableCbm.toFixed(3)} CBM chargeable (${metrics.chargeableBasis})`,
      currency: card.currency,
      fxToAud: fx,
      oceanCost: price,
      components: [ocean],
      warnings,
    },
    ancillaries,
    metrics,
    fx,
  );
}

/** FCL estimate for an already-chosen container mix. */
export function estimateFcl(
  metrics: ConsignmentMetrics,
  card: RateCard,
  mixResult: MixResult,
  containerTypes: ContainerType[],
  opts: EstimateOptions = {},
): CostEstimate {
  const fx = opts.fxOverride ?? card.fxToAud ?? 1;
  const warnings: string[] = [];
  const components: CostComponent[] = [];
  let ocean = 0;
  let containerCount = 0;

  for (const m of mixResult.mix) {
    const rate = card.fcl?.find((f) => f.containerTypeId === m.containerTypeId);
    const typeName = containerTypes.find((t) => t.id === m.containerTypeId)?.name ?? m.containerTypeId;
    if (!rate) {
      warnings.push(`No FCL rate on this card for ${typeName}.`);
      continue;
    }
    containerCount += m.count;
    const oceanAmt = rate.oceanCost * m.count;
    ocean += oceanAmt;
    components.push({
      label: `Ocean freight — ${typeName}`,
      amount: oceanAmt,
      amountAud: 0,
      formula: `${rate.oceanCost.toFixed(2)} x ${m.count} x ${typeName}`,
      sourceRateCardId: card.id,
    });
    if (rate.originCharges) {
      components.push({
        label: `Origin charges — ${typeName}`,
        amount: rate.originCharges * m.count,
        amountAud: 0,
        formula: `${rate.originCharges.toFixed(2)} x ${m.count} x ${typeName}`,
        sourceRateCardId: card.id,
      });
    }
    if (rate.destCharges) {
      components.push({
        label: `Destination charges (THC, wharfage, docs) — ${typeName}`,
        amount: rate.destCharges * m.count,
        amountAud: 0,
        formula: `${rate.destCharges.toFixed(2)} x ${m.count} x ${typeName}`,
        sourceRateCardId: card.id,
      });
    }
  }

  if (mixResult.unplaced.length > 0) {
    warnings.push(
      `${mixResult.unplaced.reduce((s, u) => s + u.qty, 0)} item(s) did not fit the chosen mix.`,
    );
  }
  for (const c of mixResult.containers) {
    if (c.payloadLimited) {
      warnings.push(
        `Container ${c.index + 1} (${c.containerTypeName}) hit its payload limit before it filled ` +
          `by volume — ${Math.round(c.placedWeightKg)} kg loaded.`,
      );
    }
  }

  const ancillaries = ancillaryComponents(
    card.ancillaries,
    'FCL',
    { cbm: metrics.totalVolumeCbm, containers: containerCount, weightKg: metrics.totalWeightKg },
    card.id,
  );

  const basis = mixResult.mix.map((m) => `${m.count} x ${m.containerTypeName}`).join(' + ');

  return finalise(
    {
      mode: 'FCL',
      basis: basis || 'no container',
      currency: card.currency,
      fxToAud: fx,
      oceanCost: ocean,
      components,
      containerMix: mixResult.mix,
      warnings,
    },
    ancillaries,
    metrics,
    fx,
  );
}

/**
 * Airfreight. Chargeable weight is the greater of actual gross weight and the
 * volumetric weight (cm3 / 6000). Weight breaks are evaluated with the
 * standard "pay for the next break if it comes out cheaper" rule.
 */
export function estimateAir(
  metrics: ConsignmentMetrics,
  card: RateCard,
  opts: EstimateOptions = {},
): CostEstimate {
  const fx = opts.fxOverride ?? card.fxToAud ?? 1;
  const air = card.air;
  const warnings: string[] = [];
  if (!air) {
    return finalise(
      {
        mode: 'AIR',
        basis: 'no air rate',
        currency: card.currency,
        fxToAud: fx,
        oceanCost: 0,
        components: [],
        warnings: ['No airfreight rate on this card.'],
      },
      [],
      metrics,
      fx,
    );
  }

  const divisor = air.volumetricDivisor || 6000;
  const volumetricKg = (metrics.totalVolumeCbm * 1_000_000) / divisor;
  const chargeableKg = Math.max(metrics.totalWeightKg, volumetricKg);
  const basisLabel = volumetricKg > metrics.totalWeightKg ? 'volumetric' : 'gross';

  const breaks = [...air.breaks].sort((a, b) => a.thresholdKg - b.thresholdKg);
  let best: { cost: number; thresholdKg: number; ratePerKg: number; billedKg: number } | null = null;
  for (const b of breaks) {
    const billedKg = Math.max(chargeableKg, b.thresholdKg);
    const cost = billedKg * b.ratePerKg;
    if (best === null || cost < best.cost - 1e-9) {
      best = { cost, thresholdKg: b.thresholdKg, ratePerKg: b.ratePerKg, billedKg };
    }
  }

  const components: CostComponent[] = [];
  if (best) {
    if (best.billedKg > chargeableKg) {
      warnings.push(
        `Billed at the ${best.thresholdKg} kg break (${best.billedKg.toFixed(1)} kg) because it is ` +
          `cheaper than the rate for ${chargeableKg.toFixed(1)} kg.`,
      );
    }
    const lineCost = Math.max(best.cost, air.minCharge || 0);
    if (lineCost > best.cost) warnings.push(`Air minimum charge of ${air.minCharge.toFixed(2)} applied.`);
    components.push({
      label: 'Air freight',
      amount: lineCost,
      amountAud: 0,
      formula:
        `max(min charge ${(air.minCharge || 0).toFixed(2)}, ` +
        `${best.billedKg.toFixed(1)} kg x ${best.ratePerKg.toFixed(2)} at the ${best.thresholdKg} kg break)`,
      sourceRateCardId: card.id,
    });
  }
  if (air.fuelSurchargePerKg) {
    components.push({
      label: 'Fuel surcharge',
      amount: air.fuelSurchargePerKg * chargeableKg,
      amountAud: 0,
      formula: `${air.fuelSurchargePerKg.toFixed(2)} x ${chargeableKg.toFixed(1)} chargeable kg`,
      sourceRateCardId: card.id,
    });
  }
  if (air.securitySurchargePerKg) {
    components.push({
      label: 'Security surcharge',
      amount: air.securitySurchargePerKg * chargeableKg,
      amountAud: 0,
      formula: `${air.securitySurchargePerKg.toFixed(2)} x ${chargeableKg.toFixed(1)} chargeable kg`,
      sourceRateCardId: card.id,
    });
  }

  const ancillaries = ancillaryComponents(
    card.ancillaries,
    'AIR',
    { cbm: metrics.totalVolumeCbm, containers: 0, weightKg: chargeableKg },
    card.id,
  );

  return finalise(
    {
      mode: 'AIR',
      basis: `${chargeableKg.toFixed(1)} chargeable kg (${basisLabel}, /${divisor})`,
      currency: card.currency,
      fxToAud: fx,
      oceanCost: components.reduce((s, c) => s + c.amount, 0),
      components,
      warnings,
    },
    ancillaries,
    metrics,
    fx,
  );
}

export { round };
