import { useMemo, useState } from 'react';
import { parsePastedCartons } from '@semcom/engine';
import type { CartonLine, LengthUnit, WeightUnit } from '@semcom/engine';
import { Banner, Modal } from './ui';

/**
 * Paste a block straight out of Excel. This is the single biggest time saver
 * for the team, so it accepts tab, comma and aligned-space separated text, an
 * optional header row, and rows with or without a description column.
 */
export function PasteDialog({
  lengthUnit,
  weightUnit,
  onClose,
  onApply,
}: {
  lengthUnit: LengthUnit;
  weightUnit: WeightUnit;
  onClose: () => void;
  onApply: (lines: CartonLine[], mode: 'append' | 'replace') => void;
}) {
  const [text, setText] = useState('');
  const parsed = useMemo(
    () => (text.trim() ? parsePastedCartons(text, { lengthUnit, weightUnit }) : []),
    [text, lengthUnit, weightUnit],
  );
  const good = parsed.filter((r) => r.line).map((r) => r.line!);
  const bad = parsed.filter((r) => r.error);

  return (
    <Modal title="Paste carton rows from Excel" onClose={onClose} wide>
      <p className="mb-2 text-sm text-slate-600">
        Copy the rows in Excel and paste below. Expected column order:{' '}
        <span className="font-mono text-xs">description, length, width, height, weight, qty</span>{' '}
        with an optional <span className="font-mono text-xs">units per carton</span> column. A header
        row is skipped automatically, and dimensions are read as{' '}
        <strong>{lengthUnit}</strong> / <strong>{weightUnit}</strong> to match the toggle above the table.
      </p>
      <textarea
        className="field h-40 font-mono text-xs"
        autoFocus
        placeholder={'Widget box\t600\t400\t300\t12.5\t50\nGadget carton\t400\t300\t250\t5\t120'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      {parsed.length > 0 && (
        <div className="mt-3">
          <div className="mb-2 flex items-center gap-3 text-sm">
            <span className="font-medium text-emerald-700">{good.length} row(s) ready</span>
            {bad.length > 0 && <span className="font-medium text-red-700">{bad.length} unreadable</span>}
          </div>

          {bad.length > 0 && (
            <Banner tone="warning" className="mb-2">
              <ul className="space-y-0.5">
                {bad.slice(0, 5).map((r) => (
                  <li key={r.row} className="font-mono text-xs">
                    Row {r.row}: {r.error} — {r.raw.slice(0, 60)}
                  </li>
                ))}
              </ul>
            </Banner>
          )}

          <div className="max-h-48 overflow-auto rounded border border-slate-200">
            <table className="w-full">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className="th">Description</th>
                  <th className="th text-right">L</th>
                  <th className="th text-right">W</th>
                  <th className="th text-right">H</th>
                  <th className="th text-right">kg</th>
                  <th className="th text-right">Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {good.map((l) => (
                  <tr key={l.id}>
                    <td className="td">{l.description}</td>
                    <td className="td tabular text-right">{Math.round(l.lengthMm)}</td>
                    <td className="td tabular text-right">{Math.round(l.widthMm)}</td>
                    <td className="td tabular text-right">{Math.round(l.heightMm)}</td>
                    <td className="td tabular text-right">{l.weightKg}</td>
                    <td className="td tabular text-right">{l.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-ghost" disabled={good.length === 0} onClick={() => onApply(good, 'append')}>
          Add {good.length} row(s)
        </button>
        <button className="btn-primary" disabled={good.length === 0} onClick={() => onApply(good, 'replace')}>
          Replace all rows
        </button>
      </div>
    </Modal>
  );
}
