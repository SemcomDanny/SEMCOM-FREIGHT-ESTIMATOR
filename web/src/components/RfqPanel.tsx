import { useMemo, useState } from 'react';
import { buildRfqEmail } from '@semcom/engine';
import type { Incoterm } from '@semcom/engine';
import { useEstimate } from '../state/EstimateContext';
import { useAuth } from '../state/AuthContext';
import { Banner, Card } from './ui';

const INCOTERMS: Incoterm[] = ['EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'DAP', 'DDP'];

/**
 * One button that produces the email the team currently writes by hand. The
 * 3D loading image captured in the container view is offered alongside it,
 * because that is what stops the back-and-forth about how it stows.
 */
export function RfqPanel({ loadingImage }: { loadingImage: string | null }) {
  const est = useEstimate();
  const { user } = useAuth();
  const [copied, setCopied] = useState<string | null>(null);

  const lane = est.lanes.find((l) => l.id === est.laneId);
  const mix = est.comparison?.mixResult;

  const email = useMemo(
    () =>
      buildRfqEmail({
        jobRef: est.job.ref,
        client: est.job.client,
        originPort: lane?.origin_port ?? '(origin)',
        destinationPort: lane?.destination_port ?? '(destination)',
        incoterm: est.job.incoterm,
        cargoReadyDate: est.job.cargoReadyDate,
        commodity: est.job.commodity || '(commodity)',
        hsCode: est.job.hsCode,
        dangerousGoods: est.job.dangerousGoods,
        metrics: est.metrics,
        palletBuilds: est.palletBuilds,
        loadingMode: est.loadingMode,
        containerSummary: mix
          ? `${mix.mix.map((m) => `${m.count} x ${m.containerTypeName}`).join(' + ')} at ` +
            `${(mix.meanVolumeUtilisation * 100).toFixed(0)}% volumetric utilisation`
          : undefined,
        notes: est.job.notes,
        senderName: user?.name,
      }),
    [est.job, est.metrics, est.palletBuilds, est.loadingMode, lane, mix, user],
  );

  const flash = (msg: string) => {
    setCopied(msg);
    setTimeout(() => setCopied(null), 4000);
  };

  const openMailClient = () => {
    const href = `mailto:?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`;
    window.location.href = href;
  };

  return (
    <Card
      title="Forwarder rate request"
      subtitle="Ready to send — fill in the shipment details below and copy"
      actions={
        <>
          <button
            className="btn-ghost"
            onClick={() => {
              void navigator.clipboard.writeText(`${email.subject}\n\n${email.body}`);
              flash('Subject and body copied to the clipboard.');
            }}
          >
            Copy email
          </button>
          <button className="btn-primary" onClick={openMailClient}>
            Open in mail client
          </button>
        </>
      }
    >
      {copied && (
        <div className="px-4 pt-3">
          <Banner tone="success">{copied}</Banner>
        </div>
      )}

      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="label">Incoterm</span>
          <select
            className="field mt-1"
            value={est.job.incoterm}
            onChange={(e) => est.setJob({ incoterm: e.target.value as Incoterm })}
          >
            {INCOTERMS.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Cargo ready date</span>
          <input
            type="date"
            className="field mt-1"
            value={est.job.cargoReadyDate}
            onChange={(e) => est.setJob({ cargoReadyDate: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="label">Commodity description</span>
          <input
            className="field mt-1"
            placeholder="e.g. Powder coated steel brackets"
            value={est.job.commodity}
            onChange={(e) => est.setJob({ commodity: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="label">HS code</span>
          <input
            className="field mt-1"
            placeholder="7326.90"
            value={est.job.hsCode}
            onChange={(e) => est.setJob({ hsCode: e.target.value })}
          />
        </label>
        <label className="flex items-center gap-2 pt-5 text-sm">
          <input
            type="checkbox"
            checked={est.job.dangerousGoods}
            onChange={(e) => est.setJob({ dangerousGoods: e.target.checked })}
          />
          Dangerous goods
        </label>
        <label className="block sm:col-span-2 lg:col-span-3">
          <span className="label">Notes for the forwarder</span>
          <input
            className="field mt-1"
            placeholder="e.g. needs to arrive before 15 Nov, prefer direct service"
            value={est.job.notes}
            onChange={(e) => est.setJob({ notes: e.target.value })}
          />
        </label>
      </div>

      <div className="border-t border-slate-200 px-4 py-3">
        <div className="mb-1 text-xs font-medium text-slate-500">
          Subject: <span className="font-normal text-slate-700">{email.subject}</span>
        </div>
        <pre className="max-h-96 overflow-auto rounded border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-800">
          {email.body}
        </pre>
      </div>

      <div className="border-t border-slate-200 px-4 py-3">
        <div className="mb-2 text-xs font-medium text-slate-500">Loading image</div>
        {loadingImage ? (
          <div className="flex flex-wrap items-start gap-3">
            <img
              src={loadingImage}
              alt="3D container load"
              className="h-32 rounded border border-slate-200"
            />
            <div className="text-xs text-slate-600">
              <p>Captured from the 3D view. Attach it to the email — it saves a round of questions.</p>
              <a className="btn-ghost mt-2 text-xs" href={loadingImage} download="container-load.png">
                Download PNG
              </a>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            Use <strong>Export PNG</strong> in the container view to capture the loading image, and it will
            appear here for the email.
          </p>
        )}
      </div>
    </Card>
  );
}
