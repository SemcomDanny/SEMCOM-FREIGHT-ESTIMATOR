import { useState } from 'react';
import { colorFor, fromMm, fromKg, toKg, toMm } from '@semcom/engine';
import type { CartonLine, LengthUnit, WeightUnit } from '@semcom/engine';
import { useEstimate } from '../state/EstimateContext';
import { api } from '../api';
import { NumInput } from './NumInput';
import { PasteDialog } from './PasteDialog';
import { Card, fmt } from './ui';

interface LibraryRow {
  sku: string;
  description: string | null;
  l_mm: number;
  w_mm: number;
  h_mm: number;
  weight_kg: number;
  units_per_carton: number | null;
}

const LENGTH_UNITS: LengthUnit[] = ['mm', 'cm', 'in'];
const WEIGHT_UNITS: WeightUnit[] = ['kg', 'lb'];

export function CartonTable() {
  const est = useEstimate();
  const [pasting, setPasting] = useState(false);
  const [showConstraints, setShowConstraints] = useState(false);
  const [library, setLibrary] = useState<LibraryRow[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [savingSku, setSavingSku] = useState<string | null>(null);

  const { lines, updateLine, removeLine, duplicateLine, addLine, lengthUnit, weightUnit } = est;

  const openLibrary = () => {
    setLibraryOpen((v) => !v);
    if (library.length === 0) {
      void api.get<LibraryRow[]>('/jobs/library/cartons').then(setLibrary).catch(() => setLibrary([]));
    }
  };

  const insertFromLibrary = (row: LibraryRow) => {
    est.setLines((prev) => {
      const next = prev.filter((l) => l.qty > 0 || l.lengthMm > 0 || l.description);
      return [
        ...next,
        {
          id: `lib-${row.sku}-${Date.now().toString(36)}`,
          description: row.description || row.sku,
          lengthMm: row.l_mm,
          widthMm: row.w_mm,
          heightMm: row.h_mm,
          weightKg: row.weight_kg,
          qty: 1,
          unitsPerCarton: row.units_per_carton ?? undefined,
          stackable: true,
        },
      ];
    });
  };

  const saveToLibrary = async (line: CartonLine) => {
    const sku = window.prompt('Save this carton to the library under which SKU?', line.description);
    if (!sku) return;
    setSavingSku(sku);
    try {
      await api.post('/jobs/library/cartons', {
        sku,
        description: line.description,
        lengthMm: line.lengthMm,
        widthMm: line.widthMm,
        heightMm: line.heightMm,
        weightKg: line.weightKg,
        unitsPerCarton: line.unitsPerCarton,
        stackable: line.stackable,
        maxStackLayers: line.maxStackLayers,
      });
      setLibrary(await api.get<LibraryRow[]>('/jobs/library/cartons'));
    } finally {
      setSavingSku(null);
    }
  };

  // Enter at the end of a row adds the next one, so entry never needs the mouse.
  const onCellKey = (e: React.KeyboardEvent<HTMLInputElement>, isLast: boolean) => {
    if (e.key === 'Enter' && isLast) {
      e.preventDefault();
      addLine();
    }
  };

  return (
    <Card
      title="Cartons"
      subtitle="Every figure below recalculates as you type"
      actions={
        <>
          <div className="flex items-center gap-1 text-xs">
            <span className="text-slate-500">Units</span>
            <select
              className="field w-16 py-1 text-xs"
              value={lengthUnit}
              onChange={(e) => est.setLengthUnit(e.target.value as LengthUnit)}
            >
              {LENGTH_UNITS.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
            <select
              className="field w-16 py-1 text-xs"
              value={weightUnit}
              onChange={(e) => est.setWeightUnit(e.target.value as WeightUnit)}
            >
              {WEIGHT_UNITS.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </div>
          <button className="btn-ghost" onClick={openLibrary}>
            Library
          </button>
          <button className="btn-primary" onClick={() => setPasting(true)}>
            Paste from Excel
          </button>
        </>
      }
    >
      {libraryOpen && (
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Saved carton specs
          </div>
          {library.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nothing saved yet — use "Save to library" on a row to reuse its dimensions later.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {library.map((row) => (
                <button
                  key={row.sku}
                  className="btn-ghost text-xs"
                  onClick={() => insertFromLibrary(row)}
                  title={`${row.l_mm} x ${row.w_mm} x ${row.h_mm} mm, ${row.weight_kg} kg`}
                >
                  {row.sku}
                  <span className="tabular text-slate-500">
                    {row.l_mm}×{row.w_mm}×{row.h_mm}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th w-8" />
              <th className="th min-w-[180px]">Description / SKU</th>
              <th className="th w-24 text-right">Length ({lengthUnit})</th>
              <th className="th w-24 text-right">Width ({lengthUnit})</th>
              <th className="th w-24 text-right">Height ({lengthUnit})</th>
              <th className="th w-24 text-right">Gross ({weightUnit})</th>
              <th className="th w-20 text-right">Cartons</th>
              <th className="th w-20 text-right">Units/ctn</th>
              <th className="th w-24 text-right">CBM each</th>
              <th className="th w-24 text-right">CBM total</th>
              <th className="th w-20" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((line, i) => {
              const m = est.metrics.lines[i];
              const isLast = i === lines.length - 1;
              return (
                <tr key={line.id} className="hover:bg-slate-50/60">
                  <td className="td">
                    <span
                      className="inline-block h-3 w-3 rounded-sm"
                      style={{ backgroundColor: colorFor(i) }}
                      title="Colour used in the 3D view and legend"
                    />
                  </td>
                  <td className="td">
                    <input
                      className="field"
                      placeholder="e.g. Widget box"
                      value={line.description}
                      onChange={(e) => updateLine(line.id, { description: e.target.value })}
                      onKeyDown={(e) => onCellKey(e, isLast)}
                    />
                  </td>
                  <td className="td">
                    <NumInput
                      value={fromMm(line.lengthMm, lengthUnit)}
                      min={0}
                      onChange={(v) => updateLine(line.id, { lengthMm: toMm(v, lengthUnit) })}
                      onKeyDown={(e) => onCellKey(e, isLast)}
                    />
                  </td>
                  <td className="td">
                    <NumInput
                      value={fromMm(line.widthMm, lengthUnit)}
                      min={0}
                      onChange={(v) => updateLine(line.id, { widthMm: toMm(v, lengthUnit) })}
                      onKeyDown={(e) => onCellKey(e, isLast)}
                    />
                  </td>
                  <td className="td">
                    <NumInput
                      value={fromMm(line.heightMm, lengthUnit)}
                      min={0}
                      onChange={(v) => updateLine(line.id, { heightMm: toMm(v, lengthUnit) })}
                      onKeyDown={(e) => onCellKey(e, isLast)}
                    />
                  </td>
                  <td className="td">
                    <NumInput
                      value={fromKg(line.weightKg, weightUnit)}
                      min={0}
                      dp={3}
                      onChange={(v) => updateLine(line.id, { weightKg: toKg(v, weightUnit) })}
                      onKeyDown={(e) => onCellKey(e, isLast)}
                    />
                  </td>
                  <td className="td">
                    <NumInput
                      value={line.qty}
                      dp={0}
                      min={0}
                      onChange={(v) => updateLine(line.id, { qty: Math.round(v) })}
                      onKeyDown={(e) => onCellKey(e, isLast)}
                    />
                  </td>
                  <td className="td">
                    <NumInput
                      value={line.unitsPerCarton ?? 0}
                      dp={0}
                      min={0}
                      onChange={(v) => updateLine(line.id, { unitsPerCarton: v > 0 ? Math.round(v) : undefined })}
                      onKeyDown={(e) => onCellKey(e, isLast)}
                    />
                  </td>
                  <td className="td tabular text-right text-slate-600">
                    {m ? fmt.cbm(m.volumeCbmEach, 4) : '—'}
                  </td>
                  <td className="td tabular text-right font-medium">
                    {m ? fmt.cbm(m.volumeCbmTotal, 3) : '—'}
                  </td>
                  <td className="td">
                    <div className="flex justify-end gap-1">
                      <button
                        className="rounded px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-200"
                        title="Duplicate row"
                        onClick={() => duplicateLine(line.id)}
                      >
                        Dup
                      </button>
                      <button
                        className="rounded px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-200"
                        title="Save this carton spec to the library"
                        disabled={savingSku !== null}
                        onClick={() => void saveToLibrary(line)}
                      >
                        Save
                      </button>
                      <button
                        className="rounded px-1.5 py-1 text-xs text-red-600 hover:bg-red-50"
                        title="Delete row"
                        onClick={() => removeLine(line.id)}
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showConstraints && (
        <div className="border-t border-slate-200 bg-slate-50 px-4 py-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Handling constraints
          </div>
          <div className="space-y-2">
            {lines.map((line, i) => (
              <div key={line.id} className="flex flex-wrap items-center gap-4 text-sm">
                <span className="flex items-center gap-1.5 font-medium">
                  <span
                    className="inline-block h-3 w-3 rounded-sm"
                    style={{ backgroundColor: colorFor(i) }}
                  />
                  {line.description || `Line ${i + 1}`}
                </span>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={line.stackable !== false}
                    onChange={(e) => updateLine(line.id, { stackable: e.target.checked })}
                  />
                  Stackable
                </label>
                <label className="flex items-center gap-1.5">
                  Max stack layers
                  <NumInput
                    className="num w-16"
                    dp={0}
                    min={0}
                    value={line.maxStackLayers ?? 0}
                    onChange={(v) => updateLine(line.id, { maxStackLayers: v > 0 ? Math.round(v) : undefined })}
                  />
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={line.thisWayUp === true}
                    onChange={(e) => updateLine(line.id, { thisWayUp: e.target.checked })}
                  />
                  This way up
                </label>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-2.5">
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={addLine}>
            + Add row
          </button>
          <button className="btn-ghost" onClick={() => setShowConstraints((v) => !v)}>
            {showConstraints ? 'Hide' : 'Show'} stacking constraints
          </button>
        </div>
        <button className="btn-danger" onClick={est.clearLines}>
          Clear all rows
        </button>
      </div>

      {pasting && (
        <PasteDialog
          lengthUnit={lengthUnit}
          weightUnit={weightUnit}
          onClose={() => setPasting(false)}
          onApply={(newLines, mode) => {
            est.setLines((prev) =>
              mode === 'replace'
                ? newLines
                : [...prev.filter((l) => l.qty > 0 || l.lengthMm > 0), ...newLines],
            );
            setPasting(false);
          }}
        />
      )}
    </Card>
  );
}
