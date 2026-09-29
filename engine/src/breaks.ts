import type {
  CartonLine,
  ConsignmentMetrics,
  ContainerType,
  PalletBuild,
  PalletType,
  RateCard,
  ShipMode,
} from './types.js';
import { consignmentMetrics } from './cartons.js';
import { cartonPackItems, palletPackItems } from './build.js';
import { palletiseAll } from './pallets.js';
import { compareModes } from './compare.js';
import type { Comparison } from './compare.js';

/**
 * A hypothetical order size to price.
 *
 * Clients ask "what does freight cost if we order 1,000 instead of 500?", and
 * the answer is rarely proportional — a break that fills a container changes
 * the mode and can cut the per-unit cost sharply. Each break scales the
 * consignment and is costed from scratch.
 */
export interface QtyBreak {
  id: string;
  label: string;
  /** Applied to every carton line's quantity. 1 is the entered consignment. */
  multiplier: number;
}

export interface QtyBreakResult {
  breakId: string;
  label: string;
  multiplier: number;
  lines: CartonLine[];
  metrics: ConsignmentMetrics;
  comparison: Comparison;
  palletBuilds: PalletBuild[];
  /** The cheapest priced mode, or null when the lane has no rates. */
  mode: ShipMode | null;
  totalAud: number | null;
  freightPerCartonAud: number | null;
  freightPerUnitAud: number | null;
  /** Change in per-unit freight against the base (1x) break, as a percentage. */
  perUnitChangePct: number | null;
  containerSummary: string;
}

/** Scale a consignment's carton quantities, keeping whole cartons. */
export function scaleLines(lines: CartonLine[], multiplier: number): CartonLine[] {
  return lines.map((l) => ({
    ...l,
    qty: l.qty > 0 ? Math.max(1, Math.round(l.qty * multiplier)) : 0,
  }));
}

/** Multiplier that turns the base consignment into a target number of units. */
export function multiplierForUnits(lines: CartonLine[], targetUnits: number): number | null {
  const baseUnits = consignmentMetrics(lines).totalUnits;
  if (baseUnits <= 0 || targetUnits <= 0) return null;
  return targetUnits / baseUnits;
}

export interface BreakContext {
  containerTypes: ContainerType[];
  lclCard?: RateCard;
  fclCard?: RateCard;
  airCard?: RateCard;
  stowEfficiency?: number;
  fxOverride?: number;
  loadingMode?: 'floor' | 'palletised';
  palletType?: PalletType | null;
  palletOverrides?: { maxLoadHMm?: number; maxLoadKg?: number; overhangMm?: number };
  palletTareKg?: number;
}

/** Cost one quantity break end to end: palletise, pack, price, compare. */
export function evaluateBreak(
  baseLines: CartonLine[],
  brk: QtyBreak,
  ctx: BreakContext,
): QtyBreakResult {
  const lines = scaleLines(baseLines, brk.multiplier);
  const metrics = consignmentMetrics(lines);

  let palletBuilds: PalletBuild[] = [];
  let packItems;
  if (ctx.loadingMode === 'palletised' && ctx.palletType) {
    const opts = {
      palletType: ctx.palletType,
      ...ctx.palletOverrides,
      palletTareKg: ctx.palletTareKg,
    };
    palletBuilds = palletiseAll(
      lines.filter((l) => l.qty > 0 && l.lengthMm > 0),
      opts,
    ).builds;
    packItems = palletPackItems(palletBuilds, lines, ctx.palletType, ctx.palletTareKg);
  } else {
    packItems = cartonPackItems(lines);
  }

  const comparison = compareModes({
    metrics,
    packItems,
    containerTypes: ctx.containerTypes,
    lclCard: ctx.lclCard,
    fclCard: ctx.fclCard,
    airCard: ctx.airCard,
    stowEfficiency: ctx.stowEfficiency,
    fxOverride: ctx.fxOverride,
  });

  const chosen =
    comparison.estimates.find((e) => e.mode === comparison.recommended) ?? null;

  return {
    breakId: brk.id,
    label: brk.label,
    multiplier: brk.multiplier,
    lines,
    metrics,
    comparison,
    palletBuilds,
    mode: chosen?.mode ?? null,
    totalAud: chosen ? chosen.totalAud : null,
    freightPerCartonAud:
      chosen && metrics.totalCartons > 0 ? chosen.totalAud / metrics.totalCartons : null,
    freightPerUnitAud: chosen && metrics.totalUnits > 0 ? chosen.totalAud / metrics.totalUnits : null,
    perUnitChangePct: null,
    containerSummary:
      comparison.mixResult?.mix.map((m) => `${m.count} x ${m.containerTypeName}`).join(' + ') ?? '',
  };
}

/**
 * Cost every break, cheapest-mode per break, with each break's per-unit cost
 * compared against the base so the saving from ordering more is explicit.
 */
export function evaluateBreaks(
  baseLines: CartonLine[],
  breaks: QtyBreak[],
  ctx: BreakContext,
): QtyBreakResult[] {
  const results = breaks
    .filter((b) => b.multiplier > 0)
    .sort((a, b) => a.multiplier - b.multiplier)
    .map((b) => evaluateBreak(baseLines, b, ctx));

  // The base is whichever break sits closest to the entered consignment.
  const base =
    results.find((r) => Math.abs(r.multiplier - 1) < 1e-9) ??
    results.find((r) => r.freightPerUnitAud != null) ??
    null;

  if (base?.freightPerUnitAud) {
    for (const r of results) {
      if (r.freightPerUnitAud == null) continue;
      r.perUnitChangePct =
        ((r.freightPerUnitAud - base.freightPerUnitAud) / base.freightPerUnitAud) * 100;
    }
  }

  return results;
}

/** Sensible starting breaks for a new job. */
export function defaultBreaks(): QtyBreak[] {
  return [
    { id: 'b1', label: 'As entered', multiplier: 1 },
    { id: 'b2', label: '2×', multiplier: 2 },
    { id: 'b3', label: '3×', multiplier: 3 },
  ];
}
