import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../state/AuthContext';
import { Banner, Card, Modal, fmt } from './ui';

/**
 * Ask a forwarder for rates and take their reply straight into a rate version,
 * replacing the email-and-retype loop the team runs today.
 */

interface RfqRow {
  id: string;
  lane: string;
  forwarder_email: string;
  forwarder_name: string | null;
  currency: string;
  status: string;
  expired: boolean;
  created_at: string;
  responded_at: string | null;
  response_count: number;
}

interface RfqResponse {
  id: string;
  submitted_at: string;
  submitter_name: string | null;
  submitter_email: string | null;
  currency: string;
  fx_to_aud: number;
  valid_from: string | null;
  valid_until: string | null;
  transit_days: number | null;
  free_time_days: number | null;
  notes: string | null;
  lcl_points_json: string | null;
  lcl_min_charge: number | null;
  lcl_min_cbm: number | null;
  fcl_json: string | null;
  ancillaries_json: string | null;
  hasPdf: boolean;
}

interface RfqDetail extends RfqRow {
  url: string;
  responses: RfqResponse[];
}

interface SendResult {
  url: string;
  emailSent: boolean;
  emailError?: string;
  mailto: string;
  expiresAt: string;
}

const STATUS_STYLE: Record<string, string> = {
  sent: 'bg-blue-100 text-blue-800',
  responded: 'bg-emerald-100 text-emerald-800',
  imported: 'bg-slate-200 text-slate-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

export function RfqRequests({
  laneId,
  laneLabel,
  onImported,
}: {
  laneId: string;
  laneLabel: string;
  onImported: () => void;
}) {
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState<RfqRow[]>([]);
  const [email, setEmail] = useState('');
  const [expiresInDays, setExpiresInDays] = useState(21);
  const [notes, setNotes] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [smtp, setSmtp] = useState<{ configured: boolean } | null>(null);
  const [detail, setDetail] = useState<RfqDetail | null>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(() => {
    if (!laneId) return;
    void api.get<RfqRow[]>(`/rfq?laneId=${encodeURIComponent(laneId)}`).then(setRows).catch(() => setRows([]));
  }, [laneId]);

  useEffect(() => load(), [load]);
  useEffect(() => {
    void api.get<{ configured: boolean }>('/rfq/smtp-status').then(setSmtp).catch(() => undefined);
  }, []);

  const send = async () => {
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.post<SendResult>('/rfq', {
        laneId,
        forwarderEmail: email,
        expiresInDays,
        notes: notes || undefined,
      });
      setResult(r);
      setEmail('');
      setNotes('');
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const openDetail = (id: string) => {
    void api.get<RfqDetail>(`/rfq/${id}`).then(setDetail);
  };

  const importResponse = async (id: string) => {
    setImporting(true);
    try {
      const r = await api.post<{ rateCardIds: string[]; effectiveFrom: string; future: boolean }>(
        `/rfq/${id}/import`,
        {},
      );
      setDetail(null);
      load();
      onImported();
      setResult(null);
      setError(null);
      window.alert(
        `Created ${r.rateCardIds.length} rate version(s) from this quote, effective ${r.effectiveFrom}.` +
          (r.future
            ? `\n\nNote: the forwarder quoted these as valid from ${r.effectiveFrom}, which is in the ` +
              `future, so they are NOT in force yet and estimates will not use them until then. ` +
              `Change the effective date under Rates if they should apply now.`
            : ''),
      );
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  if (!isAdmin) return null;

  return (
    <>
      <Card
        title="Request rates from a forwarder"
        subtitle={`One click sends a link for ${laneLabel}. They fill it in — no account needed — and you import it as a rate version.`}
      >
        <div className="flex flex-wrap items-end gap-3 p-4">
          <label className="block">
            <span className="label">Forwarder email</span>
            <input
              className="field mt-1 w-72"
              type="email"
              placeholder="rates@forwarderco.com.au"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && email) void send();
              }}
            />
          </label>
          <label className="block">
            <span className="label">Link valid for</span>
            <select
              className="field mt-1 w-32"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(Number(e.target.value))}
            >
              {[7, 14, 21, 30, 60].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </label>
          <label className="block flex-1">
            <span className="label">Note to include (optional)</span>
            <input
              className="field mt-1"
              placeholder="Looking to move roughly 15 CBM a month on this lane."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <button className="btn-primary" disabled={!email || sending} onClick={() => void send()}>
            {sending ? 'Sending…' : 'Send request'}
          </button>
        </div>

        {smtp && !smtp.configured && (
          <div className="px-4 pb-3">
            <Banner tone="info">
              No mail server is configured, so this creates the link and hands it to you to send from your
              own email. Set SMTP details in <span className="font-mono text-xs">.env</span> to have it
              sent automatically.
            </Banner>
          </div>
        )}

        {error && (
          <div className="px-4 pb-3">
            <Banner tone="error">{error}</Banner>
          </div>
        )}

        {result && (
          <div className="px-4 pb-4">
            <Banner tone={result.emailSent ? 'success' : 'warning'}>
              <div className="space-y-2">
                <p className="font-medium">
                  {result.emailSent
                    ? 'Request emailed to the forwarder.'
                    : 'Link created — send it to the forwarder yourself.'}
                </p>
                {result.emailError && <p className="text-xs">Mail server said: {result.emailError}</p>}
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    readOnly
                    className="field flex-1 font-mono text-xs"
                    value={result.url}
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    className="btn-ghost"
                    onClick={() => void navigator.clipboard.writeText(result.url)}
                  >
                    Copy link
                  </button>
                  {!result.emailSent && (
                    <a className="btn-ghost" href={result.mailto}>
                      Open in mail client
                    </a>
                  )}
                </div>
                <p className="text-xs">
                  Anyone with this link can submit rates against this lane, so treat it like an email
                  address. It stops working on {result.expiresAt.slice(0, 10)}.
                </p>
              </div>
            </Banner>
          </div>
        )}

        {rows.length > 0 && (
          <table className="w-full border-t border-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Forwarder</th>
                <th className="th">Sent</th>
                <th className="th">Status</th>
                <th className="th">Replied</th>
                <th className="th w-40" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="td">
                    {r.forwarder_name ? `${r.forwarder_name} — ` : ''}
                    {r.forwarder_email}
                  </td>
                  <td className="td text-xs text-slate-500">{r.created_at.slice(0, 10)}</td>
                  <td className="td">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                        STATUS_STYLE[r.expired && r.status === 'sent' ? 'cancelled' : r.status] ?? ''
                      }`}
                    >
                      {r.expired && r.status === 'sent' ? 'expired' : r.status}
                    </span>
                  </td>
                  <td className="td text-xs text-slate-500">
                    {r.responded_at ? r.responded_at.slice(0, 10) : '—'}
                  </td>
                  <td className="td">
                    <div className="flex justify-end gap-1">
                      <button className="btn-ghost text-xs" onClick={() => openDetail(r.id)}>
                        {r.response_count > 0 ? 'Review & import' : 'View'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {detail && (
        <Modal title={`Rate request — ${detail.forwarder_email}`} onClose={() => setDetail(null)} wide>
          <ResponseReview detail={detail} importing={importing} onImport={() => void importResponse(detail.id)} />
        </Modal>
      )}
    </>
  );
}

function ResponseReview({
  detail,
  importing,
  onImport,
}: {
  detail: RfqDetail;
  importing: boolean;
  onImport: () => void;
}) {
  const latest = detail.responses[0];

  if (!latest) {
    return (
      <div className="space-y-3 text-sm">
        <Banner tone="info">
          Nothing submitted yet. The link below is still live until it expires.
        </Banner>
        <input readOnly className="field font-mono text-xs" value={detail.url} onFocus={(e) => e.target.select()} />
        <button className="btn-ghost" onClick={() => void navigator.clipboard.writeText(detail.url)}>
          Copy link
        </button>
      </div>
    );
  }

  const points = latest.lcl_points_json ? JSON.parse(latest.lcl_points_json) : [];
  const fcl = latest.fcl_json ? JSON.parse(latest.fcl_json) : [];
  const ancillaries = latest.ancillaries_json ? JSON.parse(latest.ancillaries_json) : [];

  return (
    <div className="space-y-4 text-sm">
      <div className="grid gap-2 sm:grid-cols-4">
        <Detail label="Submitted" value={latest.submitted_at.slice(0, 16).replace('T', ' ')} />
        <Detail label="By" value={latest.submitter_name || latest.submitter_email || '—'} />
        <Detail label="Currency" value={`${latest.currency} @ ${latest.fx_to_aud}`} />
        <Detail
          label="Valid"
          value={
            latest.valid_from || latest.valid_until
              ? `${latest.valid_from ?? '—'} → ${latest.valid_until ?? '—'}`
              : '—'
          }
        />
        <Detail label="Transit" value={latest.transit_days ? `${latest.transit_days} days` : '—'} />
        <Detail label="Free time" value={latest.free_time_days ? `${latest.free_time_days} days` : '—'} />
      </div>

      {points.length > 0 && (
        <div>
          <div className="label mb-1">LCL</div>
          <ul className="tabular space-y-0.5">
            {points.map((p: { volumeCbm: number; totalPrice: number }, i: number) => (
              <li key={i}>
                {p.volumeCbm} CBM → {fmt.money(p.totalPrice, latest.currency)}{' '}
                <span className="text-slate-500">({fmt.money(p.totalPrice / p.volumeCbm, latest.currency)}/CBM)</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-slate-600">
            Minimum {latest.lcl_min_cbm ?? 0} CBM · floor {fmt.money(latest.lcl_min_charge ?? 0, latest.currency)}
          </p>
        </div>
      )}

      {fcl.length > 0 && (
        <div>
          <div className="label mb-1">FCL</div>
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Container</th>
                <th className="th text-right">Ocean</th>
                <th className="th text-right">Origin</th>
                <th className="th text-right">Destination</th>
                <th className="th text-right">All-in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fcl.map(
                (
                  f: { containerTypeId: string; oceanCost: number; originCharges: number; destCharges: number },
                  i: number,
                ) => (
                  <tr key={i}>
                    <td className="td">{f.containerTypeId}</td>
                    <td className="td tabular text-right">{fmt.money(f.oceanCost, latest.currency)}</td>
                    <td className="td tabular text-right">{fmt.money(f.originCharges, latest.currency)}</td>
                    <td className="td tabular text-right">{fmt.money(f.destCharges, latest.currency)}</td>
                    <td className="td tabular text-right font-medium">
                      {fmt.money(f.oceanCost + f.originCharges + f.destCharges, latest.currency)}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}

      {ancillaries.length > 0 && (
        <div>
          <div className="label mb-1">Ancillary charges</div>
          <ul className="tabular space-y-0.5">
            {ancillaries.map((a: { name: string; basis: string; amount: number }, i: number) => (
              <li key={i}>
                {a.name}: {fmt.money(a.amount, latest.currency)} {a.basis.replace('_', ' ')}
              </li>
            ))}
          </ul>
        </div>
      )}

      {latest.notes && (
        <div>
          <div className="label mb-1">Their notes</div>
          <p className="whitespace-pre-wrap text-slate-700">{latest.notes}</p>
        </div>
      )}

      {latest.hasPdf && (
        <a
          className="btn-ghost"
          href={`/api/rfq/${detail.id}/responses/${latest.id}/pdf`}
          target="_blank"
          rel="noreferrer"
        >
          Download their PDF quote
        </a>
      )}

      {detail.responses.length > 1 && (
        <p className="text-xs text-slate-500">
          {detail.responses.length} submissions — the most recent is shown and is the one that will be
          imported.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3">
        <button className="btn-primary" disabled={importing} onClick={onImport}>
          {importing ? 'Importing…' : 'Import as a new rate version'}
        </button>
        <span className="text-xs text-slate-500">
          Creates a normal rate version dated {latest.valid_from ?? 'today'}, with the forwarder named in
          the note. Nothing existing is overwritten.
        </span>
      </div>
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
