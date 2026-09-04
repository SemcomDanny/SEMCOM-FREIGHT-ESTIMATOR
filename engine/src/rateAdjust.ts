import type { RateCard } from './types.js';
import { chargeableLclPrice, fitLclCurve } from './curve.js';

export interface RateValueOptions {
  /** For LCL, the volume at which versions are compared. */
  referenceCbm?: number;
  /** For FCL, the container type whose all-in cost is compared. */
  containerTypeId?: string;
  /** For air, the chargeable weight at which versions are compared. */
  referenceKg?: number;
  /** Convert using the version's own stored FX rate. */
  inAud?: boolean;
}

/**
 * Reduce a rate version to one comparable number.
 *
 * A whole LCL curve moving is not a single number, so versions are compared at
 * a nominated reference volume; FCL at one container type; air at a reference
 * chargeable weight. This is what makes a history chart meaningful.
 */
export function comparableRateValue(card: RateCard, opts: RateValueOptions = {}): number | null {
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

/**
 * Rescale a rate card's freight by a forecast ratio.
 *
 * A forecast is a view on where the freight rate has been heading, so it is
 * applied as a multiplier on the freight component only. Ancillary charges are
 * left alone — customs clearance and cartage do not move with the ocean market.
 */
export function applyForecastRatio(card: RateCard, ratio: number): RateCard {
  if (!Number.isFinite(ratio) || ratio <= 0 || Math.abs(ratio - 1) < 1e-9) return card;

  const scaled: RateCard = { ...card };
  if (card.fcl) {
    scaled.fcl = card.fcl.map((f) => ({
      ...f,
      oceanCost: f.oceanCost * ratio,
      originCharges: f.originCharges * ratio,
      destCharges: f.destCharges * ratio,
    }));
  }
  if (card.lclPoints) {
    scaled.lclPoints = card.lclPoints.map((p) => ({ ...p, totalPrice: p.totalPrice * ratio }));
  }
  if (card.lclConfig) {
    scaled.lclConfig = {
      ...card.lclConfig,
      minCharge: (card.lclConfig.minCharge ?? 0) * ratio,
    };
  }
  if (card.air) {
    scaled.air = {
      ...card.air,
      minCharge: card.air.minCharge * ratio,
      breaks: card.air.breaks.map((b) => ({ ...b, ratePerKg: b.ratePerKg * ratio })),
    };
  }
  return scaled;
}
