import type { RateCard, SeriesPoint, ShipMode } from '@semcom/engine';
import { chargeableLclPrice, fitLclCurve } from '@semcom/engine';
import { getRateCard, listRateCards } from './rates.js';

export interface HistoryOptions {
  /** For LCL, the volume at which versions are compared. */
  referenceCbm?: number;
  /** For FCL, the container type whose all-in cost is charted. */
  containerTypeId?: string;
  /** For air, the chargeable weight at which versions are compared. */
  referenceKg?: number;
  /** Convert each version to AUD using its own stored FX rate. */
  inAud?: boolean;
}

/**
 * Reduce each rate version to one comparable number so versions can be plotted
 * against each other. LCL versions are compared at a nominated reference
 * volume, because the whole curve moving is not a single number.
 */
export function rateValue(card: RateCard, opts: HistoryOptions): number | null {
  const fx = opts.inAud ? card.fxToAud || 1 : 1;
  if (card.mode === 'FCL') {
    const rates = card.fcl ?? [];
    const chosen = opts.containerTypeId
      ? rates.find((r) => r.containerTypeId === opts.containerTypeId)
      : rates[0];
    if (!chosen) return null;
    return (chosen.oceanCost + chosen.originCharges + chosen.destCharges) * fx;
  }
  if (card.mode === 'LCL') {
    if (!card.lclPoints?.length) return null;
    const curve = fitLclCurve(card.lclPoints, card.lclConfig?.fitModel ?? 'piecewise_linear');
    return chargeableLclPrice(curve, opts.referenceCbm ?? 5, card.lclConfig).price * fx;
  }
  if (card.mode === 'AIR') {
    if (!card.air) return null;
    const kg = opts.referenceKg ?? 100;
    const best = card.air.breaks
      .map((b) => Math.max(kg, b.thresholdKg) * b.ratePerKg)
      .reduce((a, b) => Math.min(a, b), Infinity);
    const total =
      Math.max(best, card.air.minCharge) +
      kg * (card.air.fuelSurchargePerKg + card.air.securitySurchargePerKg);
    return total * fx;
  }
  return null;
}

export function rateSeries(laneId: string, mode: ShipMode, opts: HistoryOptions): SeriesPoint[] {
  const rows = listRateCards(laneId, mode);
  const points: SeriesPoint[] = [];
  for (const row of rows) {
    const card = getRateCard(row.id);
    if (!card) continue;
    const value = rateValue(card, opts);
    if (value == null) continue;
    points.push({
      date: card.effectiveFrom,
      value,
      rateCardId: card.id,
      label: card.note ?? undefined,
    });
  }
  return points.sort((a, b) => a.date.localeCompare(b.date));
}
