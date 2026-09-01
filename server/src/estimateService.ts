import type {
  CartonLine,
  Comparison,
  ConsignmentMetrics,
  ContainerType,
  ForecastMethod,
  Issue,
  PackItem,
  PalletBuild,
  PalletType,
  RateCard,
  ShipMode,
} from '@semcom/engine';
import {
  cartonPackItems,
  compareModes,
  consignmentMetrics,
  forecast as runForecast,
  isStale,
  palletPackItems,
  palletiseAll,
  validateAll,
  validatePalletBuild,
  validatePalletInContainer,
} from '@semcom/engine';
import { db, getSetting } from './db.js';
import { activeRateCard } from './rates.js';
import { rateSeries, rateValue } from './history.js';

export interface EstimateRequest {
  laneId: string;
  lines: CartonLine[];
  loadingMode?: 'floor' | 'palletised';
  palletTypeId?: string;
  maxLoadHMm?: number;
  maxLoadKg?: number;
  overhangMm?: number;
  stowEfficiency?: number;
  fxOverride?: number;
  asOf?: string;
  /** Use a forecast rate instead of the latest quoted rate. */
  forecastMethod?: ForecastMethod;
  forecastWindowMonths?: number;
  referenceCbm?: number;
}

export interface EstimateResponse {
  metrics: ConsignmentMetrics;
  comparison: Comparison;
  palletBuilds: PalletBuild[];
  packItems: PackItem[];
  issues: Issue[];
  containerTypes: ContainerType[];
  rateCards: { mode: ShipMode; card: RateCard | null; stale: boolean; ageDays: number | null }[];
  rateBasisLabel: string;
}

export function loadContainerTypes(): ContainerType[] {
  return db
    .prepare('SELECT * FROM container_types WHERE active = 1 ORDER BY int_l_mm, int_h_mm')
    .all()
    .map((r) => {
      const c = r as Record<string, number | string>;
      return {
        id: String(c.id),
        name: String(c.name),
        intLMm: Number(c.int_l_mm),
        intWMm: Number(c.int_w_mm),
        intHMm: Number(c.int_h_mm),
        maxPayloadKg: Number(c.max_payload_kg),
        active: true,
      };
    });
}

export function loadPalletType(id: string): PalletType | null {
  const r = db.prepare('SELECT * FROM pallet_types WHERE id = ?').get(id) as
    | Record<string, number | string>
    | undefined;
  if (!r) return null;
  return {
    id: String(r.id),
    name: String(r.name),
    lMm: Number(r.l_mm),
    wMm: Number(r.w_mm),
    deckHMm: Number(r.deck_h_mm),
    maxLoadHMm: Number(r.max_load_h_mm),
    maxLoadKg: Number(r.max_load_kg),
    overhangMm: Number(r.overhang_mm),
    active: Number(r.active) === 1,
  };
}

/**
 * Rescale a rate card's freight costs by a forecast ratio.
 *
 * The forecast is a view on where the rate has been heading, so it is applied
 * as a multiplier on the freight component of the current version. Ancillaries
 * are left alone — they do not move with the ocean market.
 */
function applyForecastRatio(card: RateCard, ratio: number): RateCard {
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
  if (card.air) {
    scaled.air = {
      ...card.air,
      minCharge: card.air.minCharge * ratio,
      breaks: card.air.breaks.map((b) => ({ ...b, ratePerKg: b.ratePerKg * ratio })),
    };
  }
  return scaled;
}

/** Run the full estimate: metrics, packing, costing and comparison. */
export function runEstimate(req: EstimateRequest): EstimateResponse {
  const staleDays = Number(getSetting('stale_rate_days', '60'));
  const stowEfficiency = req.stowEfficiency ?? Number(getSetting('stow_efficiency', '0.85'));
  const containerTypes = loadContainerTypes();
  const metrics = consignmentMetrics(req.lines);
  const issues: Issue[] = validateAll(req.lines, containerTypes);

  let palletBuilds: PalletBuild[] = [];
  let packItems: PackItem[];

  if (req.loadingMode === 'palletised' && req.palletTypeId) {
    const palletType = loadPalletType(req.palletTypeId);
    if (palletType) {
      const opts = {
        palletType,
        maxLoadHMm: req.maxLoadHMm,
        maxLoadKg: req.maxLoadKg,
        overhangMm: req.overhangMm,
      };
      palletBuilds = palletiseAll(req.lines, opts).builds;
      packItems = palletPackItems(palletBuilds, req.lines, palletType);
      for (const b of palletBuilds) issues.push(...validatePalletBuild(b, palletType));
      for (const c of containerTypes) issues.push(...validatePalletInContainer(palletType, c));
    } else {
      packItems = cartonPackItems(req.lines);
    }
  } else {
    packItems = cartonPackItems(req.lines);
  }

  const modes: ShipMode[] = ['LCL', 'FCL', 'AIR'];
  const cards: Record<string, RateCard | null> = {};
  const rateCards: EstimateResponse['rateCards'] = [];
  let rateBasisLabel = 'Quoted';

  for (const mode of modes) {
    let card = activeRateCard(req.laneId, mode, req.asOf);
    const series = rateSeries(req.laneId, mode, {
      referenceCbm: req.referenceCbm ?? 5,
      inAud: false,
    });

    if (card && req.forecastMethod && req.forecastMethod !== 'latest') {
      const f = runForecast(series, req.forecastMethod, req.forecastWindowMonths ?? 6);
      const current = rateValue(card, { referenceCbm: req.referenceCbm ?? 5 });
      if (f && current && current > 0) {
        card = applyForecastRatio(card, f.value / current);
        rateBasisLabel =
          req.forecastMethod === 'trailing_average'
            ? `Forecast — ${req.forecastWindowMonths ?? 6}-month trailing average`
            : 'Forecast — linear trend';
      }
    }

    cards[mode] = card;
    const ageDays = series.length
      ? Math.floor(
          (Date.now() - new Date(`${series[series.length - 1]!.date}T00:00:00Z`).getTime()) / 86_400_000,
        )
      : null;
    rateCards.push({ mode, card, stale: isStale(series, staleDays), ageDays });
  }

  const comparison = compareModes({
    metrics,
    packItems,
    containerTypes,
    lclCard: cards.LCL ?? undefined,
    fclCard: cards.FCL ?? undefined,
    airCard: cards.AIR ?? undefined,
    stowEfficiency,
    fxOverride: req.fxOverride,
  });

  return {
    metrics,
    comparison,
    palletBuilds,
    packItems,
    issues,
    containerTypes,
    rateCards,
    rateBasisLabel,
  };
}
