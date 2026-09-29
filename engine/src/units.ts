import type { LengthUnit, WeightUnit } from './types.js';

const TO_MM: Record<LengthUnit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4 };
const TO_KG: Record<WeightUnit, number> = { kg: 1, lb: 0.45359237 };

/** Convert a length in `unit` to canonical millimetres. */
export function toMm(value: number, unit: LengthUnit): number {
  return value * TO_MM[unit];
}

/** Convert canonical millimetres back to `unit` for display. */
export function fromMm(valueMm: number, unit: LengthUnit): number {
  return valueMm / TO_MM[unit];
}

export function toKg(value: number, unit: WeightUnit): number {
  return value * TO_KG[unit];
}

export function fromKg(valueKg: number, unit: WeightUnit): number {
  return valueKg / TO_KG[unit];
}

/** mm^3 -> CBM */
export function mm3ToCbm(mm3: number): number {
  return mm3 / 1_000_000_000;
}

export function boxVolumeCbm(lMm: number, wMm: number, hMm: number): number {
  return mm3ToCbm(lMm * wMm * hMm);
}

/** Round to `dp` decimal places, avoiding the usual float surprises. */
export function round(value: number, dp = 2): number {
  if (!Number.isFinite(value)) return 0;
  const f = Math.pow(10, dp);
  return Math.round((value + Number.EPSILON * Math.sign(value) * Math.abs(value)) * f) / f;
}
