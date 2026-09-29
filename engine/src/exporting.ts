import type { CostEstimate, ConsignmentMetrics } from './types.js';

/** One exportable field the estimator can map onto their own spreadsheet. */
export interface ExportField {
  key: string;
  /** Default column heading; the user may rename it to match their sheet. */
  defaultHeader: string;
  value: (ctx: ExportContext) => string | number;
}

export interface ExportContext {
  jobRef: string;
  client: string;
  lane: string;
  metrics: ConsignmentMetrics;
  estimate: CostEstimate;
  rateCardId?: string;
  calculatedAt: string;
  forecastLabel?: string;
}

export const EXPORT_FIELDS: ExportField[] = [
  { key: 'jobRef', defaultHeader: 'Job Ref', value: (c) => c.jobRef },
  { key: 'client', defaultHeader: 'Client', value: (c) => c.client },
  { key: 'lane', defaultHeader: 'Lane', value: (c) => c.lane },
  { key: 'mode', defaultHeader: 'Mode', value: (c) => c.estimate.mode },
  { key: 'basis', defaultHeader: 'Basis', value: (c) => c.estimate.basis },
  { key: 'cartons', defaultHeader: 'Cartons', value: (c) => c.metrics.totalCartons },
  { key: 'units', defaultHeader: 'Units', value: (c) => c.metrics.totalUnits },
  { key: 'volumeCbm', defaultHeader: 'Volume CBM', value: (c) => round(c.metrics.totalVolumeCbm, 4) },
  {
    key: 'chargeableCbm',
    defaultHeader: 'Chargeable CBM',
    value: (c) => round(c.metrics.chargeableCbm, 4),
  },
  { key: 'grossKg', defaultHeader: 'Gross kg', value: (c) => round(c.metrics.totalWeightKg, 2) },
  { key: 'density', defaultHeader: 'kg/CBM', value: (c) => round(c.metrics.densityKgPerCbm, 1) },
  { key: 'currency', defaultHeader: 'Currency', value: (c) => c.estimate.currency },
  { key: 'oceanCost', defaultHeader: 'Freight', value: (c) => round(c.estimate.oceanCost, 2) },
  {
    key: 'portCharges',
    defaultHeader: 'Origin + Destination',
    value: (c) => round(c.estimate.portChargesCost, 2),
  },
  { key: 'ancillaries', defaultHeader: 'Ancillaries', value: (c) => round(c.estimate.ancillariesCost, 2) },
  { key: 'total', defaultHeader: 'Total', value: (c) => round(c.estimate.total, 2) },
  { key: 'fx', defaultHeader: 'FX to AUD', value: (c) => c.estimate.fxToAud },
  { key: 'totalAud', defaultHeader: 'Total AUD', value: (c) => round(c.estimate.totalAud, 2) },
  { key: 'costPerCbm', defaultHeader: 'Freight per CBM', value: (c) => round(c.estimate.costPerCbm, 2) },
  {
    key: 'costPerCarton',
    defaultHeader: 'Freight per Carton',
    value: (c) => round(c.estimate.costPerCarton, 4),
  },
  {
    key: 'costPerUnit',
    defaultHeader: 'Freight per Unit',
    value: (c) => (c.estimate.costPerUnit == null ? '' : round(c.estimate.costPerUnit, 4)),
  },
  { key: 'rateCard', defaultHeader: 'Rate Version', value: (c) => c.rateCardId ?? '' },
  { key: 'rateBasis', defaultHeader: 'Rate Basis', value: (c) => c.forecastLabel ?? 'Quoted' },
  { key: 'calculatedAt', defaultHeader: 'Calculated', value: (c) => c.calculatedAt },
];

function round(v: number, dp: number): number {
  const f = Math.pow(10, dp);
  return Math.round(v * f) / f;
}

/** Escape a value for CSV. */
export function csvCell(value: string | number): string {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Build a CSV using the estimator's own column headings and order, so the
 * result pastes into the existing quote spreadsheet without rework.
 */
export function toCsv(
  rows: ExportContext[],
  columns: { key: string; header: string }[],
): string {
  const fields = new Map(EXPORT_FIELDS.map((f) => [f.key, f]));
  const header = columns.map((c) => csvCell(c.header)).join(',');
  const body = rows.map((row) =>
    columns
      .map((c) => {
        const f = fields.get(c.key);
        return csvCell(f ? f.value(row) : '');
      })
      .join(','),
  );
  return [header, ...body].join('\n');
}

/** The default column set, in the order the team's sheet expects. */
export function defaultColumns(): { key: string; header: string }[] {
  return EXPORT_FIELDS.map((f) => ({ key: f.key, header: f.defaultHeader }));
}
