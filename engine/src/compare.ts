import type {
  ConsignmentMetrics,
  ContainerType,
  CostEstimate,
  PackItem,
  RateCard,
  ShipMode,
} from './types.js';
import {
  ContainerCostFn,
  MixResult,
  ancillaryComponents,
  estimateAir,
  estimateFcl,
  estimateLcl,
  optimiseContainerMix,
} from './costing.js';
import { chargeableLclPrice, fitLclCurve } from './curve.js';
import { DEFAULT_STOW_EFFICIENCY, containerCbm } from './packing.js';
import { consignmentMetrics } from './cartons.js';

/** All-in cost of one container of a type on a given FCL card. */
export function fclCostOf(card: RateCard | undefined): ContainerCostFn {
  return (typeId: string) => {
    const r = card?.fcl?.find((f) => f.containerTypeId === typeId);
    if (!r) return null;
    return r.oceanCost + r.originCharges + r.destCharges;
  };
}

export interface CompareInput {
  metrics: ConsignmentMetrics;
  packItems: PackItem[];
  containerTypes: ContainerType[];
  lclCard?: RateCard;
  fclCard?: RateCard;
  airCard?: RateCard;
  stowEfficiency?: number;
  fxOverride?: number;
}

export interface Comparison {
  estimates: CostEstimate[];
  mixResult: MixResult | null;
  /** Cheapest mode by AUD total; the UI defaults to this. */
  recommended: ShipMode | null;
  reason: string;
  /** AUD saved against the next cheapest mode. */
  savingAud: number;
  breakeven: BreakevenResult | null;
}

/** Run every mode the rate cards support and pick the cheapest. */
export function compareModes(input: CompareInput): Comparison {
  const eff = input.stowEfficiency ?? DEFAULT_STOW_EFFICIENCY;
  const estimates: CostEstimate[] = [];
  let mixResult: MixResult | null = null;

  if (input.lclCard) {
    estimates.push(estimateLcl(input.metrics, input.lclCard, { fxOverride: input.fxOverride }));
  }
  if (input.fclCard) {
    mixResult = optimiseContainerMix(
      input.packItems,
      input.containerTypes,
      fclCostOf(input.fclCard),
      eff,
    );
    if (mixResult) {
      estimates.push(
        estimateFcl(input.metrics, input.fclCard, mixResult, input.containerTypes, {
          fxOverride: input.fxOverride,
        }),
      );
    }
  }
  if (input.airCard) {
    estimates.push(estimateAir(input.metrics, input.airCard, { fxOverride: input.fxOverride }));
  }

  const usable = estimates.filter((e) => e.total > 0);
  const sorted = [...usable].sort((a, b) => a.totalAud - b.totalAud);
  const best = sorted[0] ?? null;
  const second = sorted[1] ?? null;
  const savingAud = best && second ? second.totalAud - best.totalAud : 0;

  let reason = '';
  if (best && second) {
    reason = `${best.mode} selected — $${savingAud.toFixed(0)} AUD cheaper than ${second.basis}`;
  } else if (best) {
    reason = `${best.mode} is the only priced option on this lane`;
  } else {
    reason = 'No priced option — check the rate cards for this lane';
  }

  const breakeven =
    input.lclCard && input.fclCard
      ? findBreakeven({
          lclCard: input.lclCard,
          fclCard: input.fclCard,
          containerTypes: input.containerTypes,
          densityKgPerCbm: input.metrics.densityKgPerCbm,
          unitsPerCbm: input.metrics.totalVolumeCbm > 0 ? input.metrics.totalUnits / input.metrics.totalVolumeCbm : 0,
          cartonsPerCbm:
            input.metrics.totalVolumeCbm > 0 ? input.metrics.totalCartons / input.metrics.totalVolumeCbm : 0,
          stowEfficiency: eff,
          fxOverride: input.fxOverride,
        })
      : null;

  return {
    estimates,
    mixResult,
    recommended: best?.mode ?? null,
    reason,
    savingAud,
    breakeven,
  };
}

/* ------------------------------------------------------------------ */
/* Breakeven                                                          */
/* ------------------------------------------------------------------ */

export interface BreakevenParams {
  lclCard: RateCard;
  fclCard: RateCard;
  containerTypes: ContainerType[];
  /** Consignment density is held constant as volume is scaled. */
  densityKgPerCbm: number;
  cartonsPerCbm?: number;
  unitsPerCbm?: number;
  stowEfficiency?: number;
  fxOverride?: number;
  maxCbm?: number;
}

export interface BreakevenResult {
  volumeCbm: number;
  lclTotal: number;
  fclTotal: number;
  currencyLcl: string;
  currencyFcl: string;
  containerMix: string;
  /** How close the two totals are at the reported volume. */
  gap: number;
  note: string;
}

/** Synthesise the metrics of a consignment of `volumeCbm` at a fixed density. */
export function metricsAtVolume(
  volumeCbm: number,
  densityKgPerCbm: number,
  cartonsPerCbm = 0,
  unitsPerCbm = 0,
): ConsignmentMetrics {
  const weight = volumeCbm * densityKgPerCbm;
  const cartons = Math.max(1, Math.round(volumeCbm * cartonsPerCbm));
  const base = consignmentMetrics([]);
  return {
    ...base,
    totalVolumeCbm: volumeCbm,
    totalWeightKg: weight,
    totalCartons: cartons,
    totalUnits: Math.round(volumeCbm * unitsPerCbm),
    densityKgPerCbm,
    weightCharged: densityKgPerCbm > 1000,
    chargeableCbm: Math.max(volumeCbm, weight / 1000),
    chargeableBasis: weight / 1000 > volumeCbm ? 'weight' : 'volume',
  };
}

/**
 * Volume-based FCL cost at a given consignment volume.
 *
 * The breakeven question is "how much cargo before FCL wins", so container
 * count comes from volume and payload rather than from a full 3D pack — the
 * cargo shape is hypothetical at this point. Stow efficiency is applied to the
 * container's nominal capacity in exactly the same way the packer applies it.
 */
export function fclCostAtVolume(
  volumeCbm: number,
  params: BreakevenParams,
): { cost: number; mix: string; containers: number } | null {
  const eff = params.stowEfficiency ?? DEFAULT_STOW_EFFICIENCY;
  const weight = volumeCbm * params.densityKgPerCbm;
  const fx = params.fxOverride ?? params.fclCard.fxToAud ?? 1;
  let best: { cost: number; mix: string; containers: number } | null = null;

  for (const type of params.containerTypes) {
    if (type.active === false) continue;
    const rate = params.fclCard.fcl?.find((f) => f.containerTypeId === type.id);
    if (!rate) continue;
    const capacity = containerCbm(type) * eff;
    if (capacity <= 0) continue;
    const byVolume = Math.ceil(volumeCbm / capacity - 1e-9);
    const byWeight = type.maxPayloadKg > 0 ? Math.ceil(weight / type.maxPayloadKg - 1e-9) : 0;
    const n = Math.max(1, byVolume, byWeight);
    const perContainer = rate.oceanCost + rate.originCharges + rate.destCharges;
    const anc = ancillaryComponents(
      params.fclCard.ancillaries,
      'FCL',
      { cbm: volumeCbm, containers: n, weightKg: weight },
      params.fclCard.id,
    ).reduce((s, c) => s + c.amount, 0);
    const cost = (n * perContainer + anc) * fx;
    if (best === null || cost < best.cost) {
      best = { cost, mix: `${n} x ${type.name}`, containers: n };
    }
  }
  return best;
}

/** LCL cost in AUD at a given consignment volume. */
export function lclCostAtVolume(volumeCbm: number, params: BreakevenParams): number {
  const fx = params.fxOverride ?? params.lclCard.fxToAud ?? 1;
  const weight = volumeCbm * params.densityKgPerCbm;
  const chargeable = Math.max(volumeCbm, weight / 1000);
  const curve = fitLclCurve(
    params.lclCard.lclPoints ?? [],
    params.lclCard.lclConfig?.fitModel ?? 'piecewise_linear',
  );
  const ocean = chargeableLclPrice(curve, chargeable, params.lclCard.lclConfig).price;
  const anc = ancillaryComponents(
    params.lclCard.ancillaries,
    'LCL',
    { cbm: chargeable, containers: 0, weightKg: weight },
    params.lclCard.id,
  ).reduce((s, c) => s + c.amount, 0);
  return (ocean + anc) * fx;
}

/**
 * The volume at which FCL becomes cheaper than LCL on this lane.
 *
 * FCL is a step function of volume and LCL is continuous and non-decreasing,
 * so the crossing is found by walking the container-count step boundaries and
 * bisecting inside the interval where the two swap over.
 */
export function findBreakeven(params: BreakevenParams): BreakevenResult | null {
  const maxCbm = params.maxCbm ?? 200;
  const eff = params.stowEfficiency ?? DEFAULT_STOW_EFFICIENCY;

  // Step boundaries: every volume at which some container count ticks over.
  const bounds = new Set<number>([0.01]);
  for (const type of params.containerTypes) {
    if (!params.fclCard.fcl?.some((f) => f.containerTypeId === type.id)) continue;
    const cap = containerCbm(type) * eff;
    for (let k = 1; k * cap <= maxCbm; k++) bounds.add(k * cap);
    if (params.densityKgPerCbm > 0 && type.maxPayloadKg > 0) {
      const capW = type.maxPayloadKg / params.densityKgPerCbm;
      for (let k = 1; k * capW <= maxCbm; k++) bounds.add(k * capW);
    }
  }
  bounds.add(maxCbm);
  const sorted = [...bounds].sort((a, b) => a - b);

  const diff = (v: number) => {
    const f = fclCostAtVolume(v, params);
    if (!f) return null;
    return lclCostAtVolume(v, params) - f.cost;
  };

  const first = diff(sorted[0]!);
  if (first === null) return null;
  if (first >= 0) {
    // FCL is already cheaper at the smallest volume — no crossing to report.
    const f = fclCostAtVolume(sorted[0]!, params)!;
    return {
      volumeCbm: sorted[0]!,
      lclTotal: lclCostAtVolume(sorted[0]!, params),
      fclTotal: f.cost,
      currencyLcl: params.lclCard.currency,
      currencyFcl: params.fclCard.currency,
      containerMix: f.mix,
      gap: Math.abs(first),
      note: 'FCL is cheaper at every volume on this lane.',
    };
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    let a = sorted[i]!;
    let b = sorted[i + 1]!;
    // Stay strictly inside the interval so the FCL step stays constant.
    const inner = Math.min((b - a) * 1e-6, 1e-6);
    b = Math.max(a, b - inner);
    const da = diff(a);
    const db = diff(b);
    if (da === null || db === null) continue;
    if (da < 0 && db >= 0) {
      for (let k = 0; k < 200; k++) {
        const mid = (a + b) / 2;
        const dm = diff(mid);
        if (dm === null) break;
        if (dm < 0) a = mid;
        else b = mid;
        if (b - a < 1e-7) break;
      }
      const v = (a + b) / 2;
      const f = fclCostAtVolume(v, params)!;
      const l = lclCostAtVolume(v, params);
      return {
        volumeCbm: v,
        lclTotal: l,
        fclTotal: f.cost,
        currencyLcl: params.lclCard.currency,
        currencyFcl: params.fclCard.currency,
        containerMix: f.mix,
        gap: Math.abs(l - f.cost),
        note:
          `Volume-based: assumes the consignment keeps its current density of ` +
          `${params.densityKgPerCbm.toFixed(0)} kg/CBM and a ${(eff * 100).toFixed(0)}% stow factor.`,
      };
    }
    // FCL stepped up past LCL again inside this interval; keep walking.
  }
  return null;
}
