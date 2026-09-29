import type { CostEstimate } from '@semcom/engine';
import { useEstimate } from '../state/EstimateContext';
import { fmt } from './ui';

/**
 * A save control that is always in reach.
 *
 * Saving used to be a button on a tab most people never opened, so work was
 * lost. This sits at the bottom of the estimator at all times and says plainly
 * whether there is anything unsaved.
 */
export function SaveBar({ estimate }: { estimate: CostEstimate | null }) {
  const est = useEstimate();
  const canSave = est.job.ref.trim().length > 0;

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-300 bg-white/95 shadow-[0_-2px_8px_rgba(15,23,42,0.06)] backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm">
          {est.dirty ? (
            <span className="flex items-center gap-1.5 font-medium text-amber-700">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              Unsaved changes
            </span>
          ) : est.job.id ? (
            <span className="flex items-center gap-1.5 text-emerald-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Saved
              {est.lastSavedAt && (
                <span className="text-slate-500">at {est.lastSavedAt.slice(11, 16)}</span>
              )}
            </span>
          ) : (
            <span className="text-slate-500">Nothing saved yet</span>
          )}
        </div>

        <div className="hidden text-xs text-slate-500 sm:block">
          {est.job.ref || 'no job number'} · {est.activeBreak?.label ?? 'as entered'} ·{' '}
          {fmt.cbm(est.metrics.totalVolumeCbm)} CBM
          {estimate && <> · {fmt.money(estimate.totalAud)} {estimate.mode}</>}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {!canSave && (
            <span className="text-xs text-amber-700">Give the job a number to save it</span>
          )}
          {est.saveError && <span className="text-xs text-red-700">{est.saveError}</span>}
          <button
            className="btn-primary"
            disabled={!canSave || est.saving}
            onClick={() => void est.saveJob(estimate)}
          >
            {est.saving ? 'Saving…' : est.job.id ? 'Save job' : 'Save job'}
          </button>
        </div>
      </div>
    </div>
  );
}
