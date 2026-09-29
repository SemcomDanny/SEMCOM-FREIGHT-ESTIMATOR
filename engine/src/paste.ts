import type { CartonLine, LengthUnit, WeightUnit } from './types.js';
import { toKg, toMm } from './units.js';

export interface ParsedPasteRow {
  /** 1-based row number within the pasted block, for error reporting. */
  row: number;
  line?: CartonLine;
  error?: string;
  raw: string;
}

export interface ParsePasteOptions {
  lengthUnit?: LengthUnit;
  weightUnit?: WeightUnit;
  /** Called to mint ids; defaults to a counter-based id. */
  makeId?: (index: number) => string;
}

const HEADER_WORDS = /^(desc|description|sku|item|product|ref)/i;

function toNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  // Excel copies can carry thousands separators, currency symbols, units and
  // non-breaking spaces. Strip everything that is not part of a number.
  const cleaned = raw
    .replace(/ /g, ' ')
    .replace(/[,\s]/g, '')
    .replace(/(mm|cm|kg|lbs?|in|")$/i, '')
    .trim();
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function splitRow(row: string): string[] {
  // Tab-separated is what Excel and Sheets put on the clipboard. Fall back to
  // comma or two-or-more spaces so a CSV or a text table still parses.
  if (row.includes('\t')) return row.split('\t');
  if (row.includes(',')) return row.split(',');
  return row.split(/ {2,}/);
}

/**
 * Parse a block pasted from Excel into carton lines.
 *
 * Expected column order: description, length, width, height, weight, qty
 * with optional 7th column units-per-carton. A leading header row is skipped.
 * A row that starts with a number is treated as having no description column.
 */
export function parsePastedCartons(text: string, opts: ParsePasteOptions = {}): ParsedPasteRow[] {
  const lengthUnit = opts.lengthUnit ?? 'mm';
  const weightUnit = opts.weightUnit ?? 'kg';
  const makeId = opts.makeId ?? ((i: number) => `paste-${Date.now()}-${i}`);

  const rows = text.replace(/\r\n?/g, '\n').split('\n').filter((r) => r.trim() !== '');
  const out: ParsedPasteRow[] = [];

  rows.forEach((raw, i) => {
    const cells = splitRow(raw).map((c) => c.trim());
    if (cells.length === 0) return;

    // Skip a header row.
    if (i === 0 && cells[0] && HEADER_WORDS.test(cells[0]) && toNumber(cells[1]) === null) return;

    let description = '';
    let rest = cells;
    if (toNumber(cells[0]) === null) {
      description = cells[0] ?? '';
      rest = cells.slice(1);
    }

    const [l, w, h, kg, qty, upc] = [
      toNumber(rest[0]),
      toNumber(rest[1]),
      toNumber(rest[2]),
      toNumber(rest[3]),
      toNumber(rest[4]),
      toNumber(rest[5]),
    ];

    if (l === null || w === null || h === null) {
      out.push({ row: i + 1, raw, error: 'Could not read length / width / height' });
      return;
    }

    out.push({
      row: i + 1,
      raw,
      line: {
        id: makeId(i),
        description: description || `Row ${i + 1}`,
        lengthMm: toMm(l, lengthUnit),
        widthMm: toMm(w, lengthUnit),
        heightMm: toMm(h, lengthUnit),
        weightKg: kg === null ? 0 : toKg(kg, weightUnit),
        qty: qty === null ? 1 : Math.max(0, Math.round(qty)),
        unitsPerCarton: upc === null ? undefined : Math.max(0, Math.round(upc)),
        stackable: true,
      },
    });
  });

  return out;
}
