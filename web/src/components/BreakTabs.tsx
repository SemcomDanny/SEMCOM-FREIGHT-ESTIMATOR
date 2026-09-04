import { useState } from 'react';
import { multiplierForUnits } from '@semcom/engine';
import { useEstimate } from '../state/EstimateContext';
import { Modal, fmt } from './ui';

/**
 * Quantity breaks as tabs.
 *
 * Selecting one switches the whole estimator — totals, packing, the 3D view and
 * the costing — to that order size, so a client asking "and if we take double?"
 * is one click rather than a re-entry.
 */
export function BreakTabs() {
  const est = useEstimate();
  const [adding, setAdding] = useState(false);

  const baseUnits = est.lines.reduce((s, l) => s + (l.unitsPerCarton ?? 0) * l.qty, 0);
  const baseCartons = est.lines.reduce((s, l) => s + l.qty, 0);

  const remove = (id: string) => {
    est.setBreaks((prev) => {
      const next = prev.filter((b) => b.id !== id);
      return next.length > 0 ? next : prev;
    });
    if (est.activeBreakId === id) {
      const fallback = est.breaks.find((b) => b.id !== id);
      if (fallback) est.setActiveBreakId(fallback.id);
    }
  };

  const sorted = [...est.breaks].sort((a, b) => a.multiplier - b.multiplier);

  return (
    <div className="card px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="label whitespace-nowrap">Order quantity</span>
        <div className="flex flex-wrap items-center gap-1">
          {sorted.map((b) => {
            const active = b.id === est.activeBreakId;
            const cartons = Math.round(baseCartons * b.multiplier);
            const units = Math.round(baseUnits * b.multiplier);
            return (
              <span key={b.id} className="group relative">
                <button
                  onClick={() => est.setActiveBreakId(b.id)}
                  className={`rounded border px-3 py-1.5 text-sm ${
                    active
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                  title={
                    units > 0
                      ? `${fmt.int(cartons)} cartons, ${fmt.int(units)} units`
                      : `${fmt.int(cartons)} cartons`
                  }
                >
                  {b.label}
                  <span className={`ml-1.5 text-xs ${active ? 'text-blue-100' : 'text-slate-500'}`}>
                    {units > 0 ? `${fmt.int(units)} u` : `${fmt.int(cartons)} ctn`}
                  </span>
                </button>
                {est.breaks.length > 1 && (
                  <button
                    className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full border border-slate-300 bg-white text-[10px] text-red-600 group-hover:flex"
                    title="Remove this quantity"
                    onClick={() => remove(b.id)}
                  >
                    ✕
                  </button>
                )}
              </span>
            );
          })}
          <button className="btn-ghost text-sm" onClick={() => setAdding(true)}>
            + Add quantity
          </button>
        </div>
        <span className="ml-auto text-xs text-slate-500">
          Cartons entered above are the base. Each tab scales them and is costed on its own.
        </span>
      </div>

      {adding && (
        <AddBreak
          baseUnits={baseUnits}
          onClose={() => setAdding(false)}
          onAdd={(label, multiplier) => {
            const id = `b${Date.now().toString(36)}`;
            est.setBreaks((prev) => [...prev, { id, label, multiplier }]);
            est.setActiveBreakId(id);
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

function AddBreak({
  baseUnits,
  onClose,
  onAdd,
}: {
  baseUnits: number;
  onClose: () => void;
  onAdd: (label: string, multiplier: number) => void;
}) {
  const [mode, setMode] = useState<'units' | 'multiplier'>(baseUnits > 0 ? 'units' : 'multiplier');
  const [units, setUnits] = useState('');
  const [multiplier, setMultiplier] = useState('');

  const resolved =
    mode === 'units'
      ? baseUnits > 0 && Number(units) > 0
        ? Number(units) / baseUnits
        : null
      : Number(multiplier) > 0
        ? Number(multiplier)
        : null;

  const label =
    mode === 'units' && Number(units) > 0
      ? `${Number(units).toLocaleString('en-AU')} units`
      : resolved
        ? `${Number(resolved.toFixed(2))}×`
        : '';

  return (
    <Modal title="Add an order quantity" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">
          Price the same cargo at a different order size. Everything scales from the cartons you
          entered, and each quantity is packed and costed from scratch — a bigger order can change
          the mode and cut the per-unit cost sharply.
        </p>

        <div className="flex overflow-hidden rounded border border-slate-300">
          <button
            className={`flex-1 px-3 py-1.5 ${mode === 'units' ? 'bg-blue-600 text-white' : 'bg-white'}`}
            disabled={baseUnits === 0}
            onClick={() => setMode('units')}
          >
            By unit quantity
          </button>
          <button
            className={`flex-1 px-3 py-1.5 ${mode === 'multiplier' ? 'bg-blue-600 text-white' : 'bg-white'}`}
            onClick={() => setMode('multiplier')}
          >
            By multiple
          </button>
        </div>

        {mode === 'units' ? (
          <label className="block">
            <span className="label">Target units</span>
            <input
              className="num mt-1"
              autoFocus
              placeholder="2000"
              value={units}
              onChange={(e) => setUnits(e.target.value)}
            />
            <span className="mt-0.5 block text-xs text-slate-500">
              {baseUnits > 0
                ? `You entered ${baseUnits.toLocaleString('en-AU')} units.`
                : 'Enter units per carton on the carton rows to use this.'}
            </span>
          </label>
        ) : (
          <label className="block">
            <span className="label">Multiple of what is entered</span>
            <input
              className="num mt-1"
              autoFocus
              placeholder="2.5"
              value={multiplier}
              onChange={(e) => setMultiplier(e.target.value)}
            />
          </label>
        )}

        {resolved && (
          <p className="text-xs text-slate-600">
            Adds <strong>{label}</strong> — {resolved.toFixed(2)}× the entered cartons.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!resolved} onClick={() => resolved && onAdd(label, resolved)}>
            Add
          </button>
        </div>
      </div>
    </Modal>
  );
}

export { multiplierForUnits };
