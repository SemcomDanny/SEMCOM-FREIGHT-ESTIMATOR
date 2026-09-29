import type { SeriesPoint, ShipMode } from '@semcom/engine';
import { comparableRateValue } from '@semcom/engine';
import type { RateValueOptions } from '@semcom/engine';
import { getRateCard, listRateCards } from './rates.js';

export type HistoryOptions = RateValueOptions;

/** Re-exported so the routes keep a single import for history concerns. */
export const rateValue = comparableRateValue;

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
