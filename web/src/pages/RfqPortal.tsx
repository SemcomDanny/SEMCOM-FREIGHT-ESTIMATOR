import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Banner, Card, fmt } from '../components/ui';
import { NumInput } from '../components/NumInput';

/**
 * The page a forwarder sees. No account, no login — the tokenised link in
 * their email is the whole credential, so this deliberately shows nothing
 * beyond the one lane they were asked about.
 */

interface RfqView {
  lane: string;
  destinationPort: string;
  deliveryRequirement: string;
  currency: string;
  incoterm: string | null;
  commodity: string | null;
  cargoReadyDate: string | null;
  notes: string | null;
  expiresAt: string;
  forwarderEmail: string;
  metrics: {
    totalCartons: number;
    totalVolumeCbm: number;
    chargeableCbm: number;
    totalWeightKg: number;
  } | null;
  containerTypes: { id: string; name: string }[];
  alreadySubmitted: number;
  maxPdfBytes: number;
}

interface LclPointDraft {
  volumeCbm: number;
  totalPrice: number;
}

const ANCILLARY_SUGGESTIONS = [
  'Customs clearance',
  'CTO / unpack fee',
  'Quarantine (DAFF) inspection',
  'Fumigation',
  'Delivery cartage',
  'Documentation',
];

export function RfqPortal() {
  const { token = '' } = useParams();
  const [view, setView] = useState<RfqView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [submitterName, setSubmitterName] = useState('');
  const [submitterEmail, setSubmitterEmail] = useState('');
  const currency = 'AUD';
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [transitDays, setTransitDays] = useState(0);
  const [freeTimeDays, setFreeTimeDays] = useState(0);
  const [notes, setNotes] = useState('');
  const [points, setPoints] = useState<LclPointDraft[]>([
    { volumeCbm: 1, totalPrice: 0 },
    { volumeCbm: 5, totalPrice: 0 },
    { volumeCbm: 15, totalPrice: 0 },
  ]);
  const [lclMinCharge, setLclMinCharge] = useState(0);
  const [lclMinCbm, setLclMinCbm] = useState(1);
  const [fcl, setFcl] = useState<Record<string, { ocean: number; origin: number; dest: number }>>({});
  const [ancillaries, setAncillaries] = useState<{ name: string; basis: string; amount: number }[]>([]);
  const [pdf, setPdf] = useState<File | null>(null);

  useEffect(() => {
    fetch(`/api/public/rfq/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? 'This link is not valid.');
        return body as RfqView;
      })
      .then((v) => {
        setView(v);
        setSubmitterEmail(v.forwarderEmail);
      })
      .catch((e: Error) => setLoadError(e.message));
  }, [token]);

  const usablePoints = useMemo(
    () => points.filter((p) => p.volumeCbm > 0 && p.totalPrice > 0),
    [points],
  );
  const usableFcl = useMemo(
    () => Object.entries(fcl).filter(([, v]) => v.ocean > 0),
    [fcl],
  );
  const canSubmit = usablePoints.length > 0 || usableFcl.length > 0 || pdf !== null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);

    const form = new FormData();
    form.set('submitterName', submitterName);
    form.set('submitterEmail', submitterEmail);
    form.set('validFrom', validFrom);
    form.set('validUntil', validUntil);
    form.set('transitDays', String(transitDays || ''));
    form.set('freeTimeDays', String(freeTimeDays || ''));
    form.set('notes', notes);
    form.set('lclPoints', JSON.stringify(usablePoints));
    form.set('lclMinCharge', String(lclMinCharge));
    form.set('lclMinCbm', String(lclMinCbm));
    form.set(
      'fcl',
      JSON.stringify(
        usableFcl.map(([containerTypeId, v]) => ({
          containerTypeId,
          oceanCost: v.ocean,
          originCharges: v.origin,
          destCharges: v.dest,
        })),
      ),
    );
    form.set('ancillaries', JSON.stringify(ancillaries.filter((a) => a.name && a.amount > 0)));
    if (pdf) form.set('pdf', pdf);

    try {
      const r = await fetch(`/api/public/rfq/${encodeURIComponent(token)}`, {
        method: 'POST',
        body: form,
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? 'Could not submit');
      setSubmitted(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <Shell>
        <Banner tone="error">{loadError}</Banner>
      </Shell>
    );
  }
  if (!view) {
    return (
      <Shell>
        <p className="text-sm text-slate-500">Loading…</p>
      </Shell>
    );
  }
  if (submitted) {
    return (
      <Shell>
        <Card title="Thank you">
          <div className="space-y-2 p-6 text-sm text-slate-700">
            <p className="text-base font-medium text-emerald-700">Your rates have been sent through.</p>
            <p>
              Nothing further is needed. If you spot a mistake, you can reopen this link and submit
              again — the latest version is the one we use.
            </p>
          </div>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <form onSubmit={submit} className="space-y-3">
        <Card title={`Rate request — ${view.lane}`} subtitle={`Please quote in ${view.currency}`}>
          <div className="grid gap-3 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Detail label="Lane" value={view.lane} />
            <Detail label="Incoterm" value={view.incoterm ?? '—'} />
            <Detail label="Commodity" value={view.commodity ?? '—'} />
            <Detail label="Cargo ready" value={view.cargoReadyDate ?? '—'} />
          </div>
          {view.metrics && (
            <div className="grid gap-3 border-t border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-4">
              <Detail label="Cartons" value={fmt.int(view.metrics.totalCartons)} />
              <Detail label="Volume" value={`${fmt.cbm(view.metrics.totalVolumeCbm)} CBM`} />
              <Detail label="Chargeable (W/M)" value={`${fmt.cbm(view.metrics.chargeableCbm)} CBM`} />
              <Detail label="Gross weight" value={`${fmt.kg(view.metrics.totalWeightKg, 0)} kg`} />
            </div>
          )}
          <div className="border-t border-slate-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="label mb-1 text-amber-800">Terms — please quote on this basis</div>
            <ul className="list-disc space-y-0.5 pl-5">
              <li>
                <strong>Incoterm FOB</strong>, quoted in <strong>AUD</strong>.
              </li>
              <li>{view.deliveryRequirement}</li>
            </ul>
          </div>
          {view.notes && <p className="border-t border-slate-200 px-4 py-3 text-sm">{view.notes}</p>}
          {view.alreadySubmitted > 0 && (
            <div className="px-4 pb-3">
              <Banner tone="info">
                You have already submitted rates for this request. Submitting again replaces them.
              </Banner>
            </div>
          )}
        </Card>

        <Card title="Your details">
          <div className="grid gap-3 p-4 sm:grid-cols-4">
            <Field label="Your name">
              <input className="field" value={submitterName} onChange={(e) => setSubmitterName(e.target.value)} />
            </Field>
            <Field label="Your email">
              <input
                className="field"
                type="email"
                value={submitterEmail}
                onChange={(e) => setSubmitterEmail(e.target.value)}
              />
            </Field>
            <Field label="Valid from">
              <input type="date" className="field" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </Field>
            <Field label="Valid until">
              <input type="date" className="field" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </Field>
            <Field label="Transit days">
              <NumInput value={transitDays} dp={0} onChange={setTransitDays} />
            </Field>
            <Field label="Free time (days)">
              <NumInput value={freeTimeDays} dp={0} onChange={setFreeTimeDays} />
            </Field>
          </div>
        </Card>

        <Card
          title="LCL rates"
          subtitle="Total price at each volume — we fit a curve between them, so three points is plenty"
        >
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="th text-right">Volume (CBM)</th>
                <th className="th text-right">Total price ({currency})</th>
                <th className="th text-right">Implied per CBM</th>
                <th className="th w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {points.map((p, i) => (
                <tr key={i}>
                  <td className="td">
                    <NumInput
                      value={p.volumeCbm}
                      onChange={(v) => setPoints((prev) => prev.map((x, xi) => (xi === i ? { ...x, volumeCbm: v } : x)))}
                    />
                  </td>
                  <td className="td">
                    <NumInput
                      value={p.totalPrice}
                      onChange={(v) => setPoints((prev) => prev.map((x, xi) => (xi === i ? { ...x, totalPrice: v } : x)))}
                    />
                  </td>
                  <td className="td tabular text-right text-slate-600">
                    {p.volumeCbm > 0 && p.totalPrice > 0 ? fmt.money(p.totalPrice / p.volumeCbm, currency) : '—'}
                  </td>
                  <td className="td">
                    <button
                      type="button"
                      className="rounded px-1.5 text-red-600 hover:bg-red-50"
                      onClick={() => setPoints((prev) => prev.filter((_, xi) => xi !== i))}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-end gap-3 border-t border-slate-200 p-4">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setPoints((prev) => [...prev, { volumeCbm: 0, totalPrice: 0 }])}
            >
              + Add a volume
            </button>
            <Field label="Minimum CBM">
              <NumInput className="num w-24" value={lclMinCbm} onChange={setLclMinCbm} />
            </Field>
            <Field label={`Minimum charge (${currency})`}>
              <NumInput className="num w-28" value={lclMinCharge} onChange={setLclMinCharge} />
            </Field>
          </div>
        </Card>

        <Card
          title="FCL rates"
          subtitle={`Destination charges must include delivery to one metro address in ${view.destinationPort}`}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Container</th>
                  <th className="th text-right">Ocean freight</th>
                  <th className="th text-right">Origin charges</th>
                  <th className="th text-right">Destination charges (incl. delivery)</th>
                  <th className="th text-right">All-in</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {view.containerTypes.map((c) => {
                  const row = fcl[c.id] ?? { ocean: 0, origin: 0, dest: 0 };
                  const set = (patch: Partial<typeof row>) =>
                    setFcl((prev) => ({ ...prev, [c.id]: { ...row, ...patch } }));
                  return (
                    <tr key={c.id}>
                      <td className="td font-medium">{c.name}</td>
                      <td className="td">
                        <NumInput value={row.ocean} onChange={(v) => set({ ocean: v })} />
                      </td>
                      <td className="td">
                        <NumInput value={row.origin} onChange={(v) => set({ origin: v })} />
                      </td>
                      <td className="td">
                        <NumInput value={row.dest} onChange={(v) => set({ dest: v })} />
                      </td>
                      <td className="td tabular text-right font-medium">
                        {row.ocean > 0 ? fmt.money(row.ocean + row.origin + row.dest, currency) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Ancillary charges" subtitle="Anything not in the rates above">
          <table className="w-full">
            <tbody className="divide-y divide-slate-100">
              {ancillaries.map((a, i) => (
                <tr key={i}>
                  <td className="td">
                    <input
                      className="field"
                      list="rfq-ancillaries"
                      placeholder="Charge"
                      value={a.name}
                      onChange={(e) =>
                        setAncillaries((prev) => prev.map((x, xi) => (xi === i ? { ...x, name: e.target.value } : x)))
                      }
                    />
                  </td>
                  <td className="td w-44">
                    <select
                      className="field"
                      value={a.basis}
                      onChange={(e) =>
                        setAncillaries((prev) => prev.map((x, xi) => (xi === i ? { ...x, basis: e.target.value } : x)))
                      }
                    >
                      <option value="per_shipment">per shipment</option>
                      <option value="per_cbm">per CBM</option>
                      <option value="per_container">per container</option>
                      <option value="per_kg">per kg</option>
                    </select>
                  </td>
                  <td className="td w-32">
                    <NumInput
                      value={a.amount}
                      onChange={(v) =>
                        setAncillaries((prev) => prev.map((x, xi) => (xi === i ? { ...x, amount: v } : x)))
                      }
                    />
                  </td>
                  <td className="td w-10">
                    <button
                      type="button"
                      className="rounded px-1.5 text-red-600 hover:bg-red-50"
                      onClick={() => setAncillaries((prev) => prev.filter((_, xi) => xi !== i))}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <datalist id="rfq-ancillaries">
            {ANCILLARY_SUGGESTIONS.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <div className="border-t border-slate-200 p-4">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setAncillaries((prev) => [...prev, { name: '', basis: 'per_shipment', amount: 0 }])}
            >
              + Add a charge
            </button>
          </div>
        </Card>

        <Card title="Your official quote (optional)" subtitle="Attach the PDF if you have one">
          <div className="p-4">
            <input
              type="file"
              accept="application/pdf"
              className="text-sm"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                if (f && f.size > view.maxPdfBytes) {
                  setError(`That PDF is ${(f.size / 1024 / 1024).toFixed(1)} MB — the limit is ${view.maxPdfBytes / 1024 / 1024} MB.`);
                  e.target.value = '';
                  return;
                }
                setError(null);
                setPdf(f);
              }}
            />
            {pdf && (
              <p className="mt-2 text-sm text-slate-600">
                {pdf.name} ({(pdf.size / 1024).toFixed(0)} KB)
              </p>
            )}
          </div>
        </Card>

        <Card title="Anything else">
          <div className="p-4">
            <textarea
              className="field h-24"
              placeholder="Sailing frequency, transhipment, surcharges we should know about…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </Card>

        {error && <Banner tone="error">{error}</Banner>}

        <div className="flex flex-wrap items-center gap-3 pb-10">
          <button className="btn-primary" disabled={!canSubmit || submitting}>
            {submitting ? 'Sending…' : 'Send rates'}
          </button>
          {!canSubmit && (
            <span className="text-sm text-slate-500">
              Enter at least one LCL or FCL rate, or attach your PDF quote.
            </span>
          )}
        </div>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-300 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-3">
          <div className="font-semibold text-slate-900">
            Semcom <span className="font-normal text-slate-500">rate request</span>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-4">{children}</main>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="mt-0.5 font-medium text-slate-800">{value}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
