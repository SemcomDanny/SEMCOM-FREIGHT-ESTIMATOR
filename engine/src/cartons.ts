import type { CartonLine, CartonLineMetrics, ConsignmentMetrics } from './types.js';
import { boxVolumeCbm } from './units.js';

/** Density above which forwarders bill on weight rather than volume. */
export const WEIGHT_CHARGE_DENSITY = 1000;

export function lineMetrics(line: CartonLine): CartonLineMetrics {
  const qty = Math.max(0, line.qty || 0);
  const volumeCbmEach = boxVolumeCbm(line.lengthMm || 0, line.widthMm || 0, line.heightMm || 0);
  const volumeCbmTotal = volumeCbmEach * qty;
  const weightKgTotal = (line.weightKg || 0) * qty;
  return {
    id: line.id,
    description: line.description,
    volumeCbmEach,
    volumeCbmTotal,
    weightKgTotal,
    qty,
    unitsTotal: (line.unitsPerCarton || 0) * qty,
    densityKgPerCbm: volumeCbmEach > 0 ? (line.weightKg || 0) / volumeCbmEach : 0,
  };
}

/**
 * Roll a set of carton lines up into consignment totals.
 *
 * `chargeableCbm` implements the W/M (weight or measure) revenue tonne rule that
 * LCL freight is billed on: whichever of volume or weight/1000 is greater.
 * Actual and chargeable volume are kept separate and must never be conflated.
 */
export function consignmentMetrics(lines: CartonLine[]): ConsignmentMetrics {
  const metrics = lines.map(lineMetrics);
  const totalVolumeCbm = metrics.reduce((s, m) => s + m.volumeCbmTotal, 0);
  const totalWeightKg = metrics.reduce((s, m) => s + m.weightKgTotal, 0);
  const totalCartons = metrics.reduce((s, m) => s + m.qty, 0);
  const totalUnits = metrics.reduce((s, m) => s + m.unitsTotal, 0);
  const densityKgPerCbm = totalVolumeCbm > 0 ? totalWeightKg / totalVolumeCbm : 0;
  const weightTonnes = totalWeightKg / 1000;
  const chargeableCbm = Math.max(totalVolumeCbm, weightTonnes);

  return {
    lines: metrics,
    totalCartons,
    totalUnits,
    totalVolumeCbm,
    totalWeightKg,
    densityKgPerCbm,
    weightCharged: densityKgPerCbm > WEIGHT_CHARGE_DENSITY,
    chargeableCbm,
    chargeableBasis: weightTonnes > totalVolumeCbm ? 'weight' : 'volume',
  };
}
