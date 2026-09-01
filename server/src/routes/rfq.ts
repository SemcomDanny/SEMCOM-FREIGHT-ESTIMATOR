import { Router } from 'express';
import multer from 'multer';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ConsignmentMetrics } from '@semcom/engine';
import { requireAdmin, requireAuth } from '../auth.js';
import { audit, db, newId } from '../db.js';
import { createRateCard } from '../rates.js';
import { mailtoUrl, sendMail, smtpStatus } from '../mailer.js';
import { rateLimit } from '../security.js';

export const rfqRouter = Router();
export const publicRfqRouter = Router();

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? path.join(path.dirname(process.env.DB_PATH ?? 'data/semcom.db'), 'uploads'));
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_PDF_BYTES = 10 * 1024 * 1024;

/**
 * Uploads land in a directory outside anything that is statically served,
 * under a random filename. The forwarder's own filename is kept in the
 * database for display only and never used as a path.
 */
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, _file, cb) => cb(null, `${randomBytes(16).toString('hex')}.pdf`),
  }),
  limits: { fileSize: MAX_PDF_BYTES, files: 1, fields: 40 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      cb(new Error('Only a PDF can be attached'));
      return;
    }
    cb(null, true);
  },
});

/**
 * The public endpoints are unauthenticated, so every request from an address is
 * counted rather than only failures — a forwarder filling in one form makes a
 * handful of requests, so this is generous but bounded.
 */
const publicThrottle = rateLimit({ max: 60, windowMs: 10 * 60_000 });

function publicBaseUrl(req: { protocol: string; get: (h: string) => string | undefined }): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host') ?? 'localhost:4000'}`;
}

interface RfqRow {
  id: string;
  token: string;
  lane_id: string;
  forwarder_id: string;
  currency: string;
  status: string;
  expires_at: string;
  consignment_json: string | null;
  incoterm: string | null;
  commodity: string | null;
  cargo_ready_date: string | null;
  notes: string | null;
  created_at: string;
  responded_at: string | null;
}

function laneLabel(laneId: string): string {
  const lane = db.prepare('SELECT origin_port, destination_port FROM lanes WHERE id = ?').get(laneId) as
    | { origin_port: string; destination_port: string }
    | undefined;
  return lane ? `${lane.origin_port} → ${lane.destination_port}` : laneId;
}

function isExpired(row: { expires_at: string; status: string }): boolean {
  return row.status === 'sent' && new Date(row.expires_at).getTime() < Date.now();
}

/* ------------------------------------------------------------------ */
/* Admin side                                                          */
/* ------------------------------------------------------------------ */

rfqRouter.use(requireAuth);

rfqRouter.get('/smtp-status', (_req, res) => res.json(smtpStatus()));

rfqRouter.get('/', (req, res) => {
  const laneId = req.query.laneId ? String(req.query.laneId) : null;
  const rows = (
    laneId
      ? db.prepare(
          `SELECT r.*, f.email AS forwarder_email, f.name AS forwarder_name,
                  (SELECT COUNT(*) FROM rfq_responses x WHERE x.rfq_id = r.id) AS response_count
           FROM rfq_requests r JOIN forwarders f ON f.id = r.forwarder_id
           WHERE r.lane_id = ? ORDER BY r.created_at DESC LIMIT 200`,
        ).all(laneId)
      : db.prepare(
          `SELECT r.*, f.email AS forwarder_email, f.name AS forwarder_name,
                  (SELECT COUNT(*) FROM rfq_responses x WHERE x.rfq_id = r.id) AS response_count
           FROM rfq_requests r JOIN forwarders f ON f.id = r.forwarder_id
           ORDER BY r.created_at DESC LIMIT 200`,
        ).all()
  ) as (RfqRow & { forwarder_email: string })[];

  res.json(
    rows.map((r) => ({
      ...r,
      lane: laneLabel(r.lane_id),
      expired: isExpired(r),
      // The token is a credential; the full link is only handed back at send
      // time and on explicit request, never in a list view.
      token: undefined,
    })),
  );
});

rfqRouter.get('/forwarders', (_req, res) => {
  res.json(db.prepare('SELECT * FROM forwarders WHERE active = 1 ORDER BY email').all());
});

function buildEmail(
  laneName: string,
  url: string,
  opts: { currency: string; expiresAt: string; notes?: string | null; metrics?: ConsignmentMetrics | null; senderName: string },
): { subject: string; text: string } {
  const lines: string[] = [];
  lines.push('Hi,');
  lines.push('');
  lines.push(`Could you please quote us for ${laneName}?`);
  lines.push('');
  lines.push('Rather than replying with a rate sheet, you can enter the figures directly here:');
  lines.push('');
  lines.push(`  ${url}`);
  lines.push('');
  lines.push('The form takes LCL rates at three volumes, FCL rates per container,');
  lines.push('and your ancillary charges. You can attach your official PDF quote as well.');
  lines.push('');
  if (opts.metrics) {
    lines.push('For reference, a typical consignment on this lane:');
    lines.push(`  Cartons:          ${opts.metrics.totalCartons}`);
    lines.push(`  Volume:           ${opts.metrics.totalVolumeCbm.toFixed(3)} CBM`);
    lines.push(`  Chargeable (W/M): ${opts.metrics.chargeableCbm.toFixed(3)} CBM`);
    lines.push(`  Gross weight:     ${opts.metrics.totalWeightKg.toFixed(0)} kg`);
    lines.push('');
  }
  lines.push(`Please quote in ${opts.currency}. The link works until ${opts.expiresAt.slice(0, 10)}.`);
  if (opts.notes) {
    lines.push('');
    lines.push(opts.notes);
  }
  lines.push('');
  lines.push('Thanks,');
  lines.push(opts.senderName);
  return { subject: `Rate request — ${laneName}`, text: lines.join('\n') };
}

/** Create a request and send it, falling back to a mailto: link. */
rfqRouter.post('/', requireAdmin, async (req, res) => {
  const b = req.body ?? {};
  const email = String(b.forwarderEmail ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'A valid forwarder email address is required' });
    return;
  }
  if (!b.laneId) {
    res.status(400).json({ error: 'laneId is required' });
    return;
  }
  const lane = db.prepare('SELECT id FROM lanes WHERE id = ?').get(b.laneId);
  if (!lane) {
    res.status(400).json({ error: 'That lane does not exist' });
    return;
  }

  let forwarder = db.prepare('SELECT * FROM forwarders WHERE email = ?').get(email) as
    | { id: string }
    | undefined;
  if (!forwarder) {
    const id = newId('fwd');
    db.prepare(
      'INSERT INTO forwarders (id, name, email, contact_name, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
    ).run(id, b.forwarderName ?? null, email, b.contactName ?? null, new Date().toISOString());
    forwarder = { id };
  }

  const id = newId('rfq');
  const token = randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + Number(b.expiresInDays ?? 21) * 86_400_000).toISOString();

  db.prepare(
    `INSERT INTO rfq_requests (id, token, lane_id, forwarder_id, job_id, currency, incoterm, commodity,
                               cargo_ready_date, notes, consignment_json, status, created_by, created_at,
                               sent_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?, ?, ?)`,
  ).run(
    id,
    token,
    b.laneId,
    forwarder.id,
    b.jobId ?? null,
    b.currency ?? 'AUD',
    b.incoterm ?? null,
    b.commodity ?? null,
    b.cargoReadyDate ?? null,
    b.notes ?? null,
    b.metrics ? JSON.stringify({ metrics: b.metrics, lines: b.lines ?? [] }) : null,
    req.user!.id,
    now.toISOString(),
    now.toISOString(),
    expiresAt,
  );

  const url = `${publicBaseUrl(req)}/rfq/${token}`;
  const message = buildEmail(laneLabel(b.laneId), url, {
    currency: b.currency ?? 'AUD',
    expiresAt,
    notes: b.notes,
    metrics: b.metrics ?? null,
    senderName: req.user!.name,
  });

  const result = await sendMail({ to: email, ...message });
  audit('rfq_requests', id, 'sent', req.user!.id, { email, laneId: b.laneId, emailed: result.sent });

  res.status(201).json({
    id,
    url,
    emailSent: result.sent,
    emailError: result.error,
    mailto: mailtoUrl({ to: email, ...message }),
    subject: message.subject,
    body: message.text,
    expiresAt,
  });
});

/** Full detail, including the link and whatever the forwarder submitted. */
rfqRouter.get('/:id', (req, res) => {
  const row = db
    .prepare(
      `SELECT r.*, f.email AS forwarder_email, f.name AS forwarder_name
       FROM rfq_requests r JOIN forwarders f ON f.id = r.forwarder_id WHERE r.id = ?`,
    )
    .get(req.params.id) as (RfqRow & { forwarder_email: string }) | undefined;
  if (!row) {
    res.status(404).json({ error: 'Rate request not found' });
    return;
  }
  const responses = db
    .prepare('SELECT * FROM rfq_responses WHERE rfq_id = ? ORDER BY submitted_at DESC')
    .all(req.params.id) as Record<string, unknown>[];

  res.json({
    ...row,
    lane: laneLabel(row.lane_id),
    expired: isExpired(row),
    url: `${publicBaseUrl(req)}/rfq/${row.token}`,
    responses: responses.map((r) => ({
      ...r,
      // Never hand back a filesystem path.
      pdf_path: undefined,
      hasPdf: Boolean(r.pdf_path),
    })),
  });
});

rfqRouter.post('/:id/cancel', requireAdmin, (req, res) => {
  db.prepare("UPDATE rfq_requests SET status = 'cancelled' WHERE id = ? AND status = 'sent'").run(
    req.params.id,
  );
  audit('rfq_requests', req.params.id, 'cancelled', req.user!.id);
  res.json({ ok: true });
});

/** Download the forwarder's PDF. Authenticated, and always as an attachment. */
rfqRouter.get('/:id/responses/:responseId/pdf', (req, res) => {
  const row = db
    .prepare('SELECT pdf_path, pdf_original_name FROM rfq_responses WHERE id = ? AND rfq_id = ?')
    .get(req.params.responseId, req.params.id) as
    | { pdf_path: string | null; pdf_original_name: string | null }
    | undefined;
  if (!row?.pdf_path) {
    res.status(404).json({ error: 'No PDF on this response' });
    return;
  }
  // The stored path is server-generated, but resolve and re-check anyway so a
  // tampered row can never reach outside the upload directory.
  const resolved = path.resolve(row.pdf_path);
  if (!resolved.startsWith(UPLOAD_DIR + path.sep) || !fs.existsSync(resolved)) {
    res.status(404).json({ error: 'File is missing' });
    return;
  }
  const safeName = (row.pdf_original_name ?? 'quote.pdf').replace(/[^\w.\- ]+/g, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  fs.createReadStream(resolved).pipe(res);
});

/**
 * Turn a submitted response into a rate version.
 *
 * This is the same append-only path an admin typing rates by hand uses, so an
 * imported rate is a normal version with the forwarder named in its note and
 * nothing about it is special afterwards.
 */
rfqRouter.post('/:id/import', requireAdmin, (req, res) => {
  const rfq = db.prepare('SELECT * FROM rfq_requests WHERE id = ?').get(req.params.id) as RfqRow | undefined;
  if (!rfq) {
    res.status(404).json({ error: 'Rate request not found' });
    return;
  }
  const response = db
    .prepare('SELECT * FROM rfq_responses WHERE rfq_id = ? ORDER BY submitted_at DESC LIMIT 1')
    .get(req.params.id) as Record<string, string | number | null> | undefined;
  if (!response) {
    res.status(400).json({ error: 'This forwarder has not submitted anything yet' });
    return;
  }

  const forwarder = db.prepare('SELECT email, name FROM forwarders WHERE id = ?').get(rfq.forwarder_id) as
    | { email: string; name: string | null }
    | undefined;
  // Falls back through: an explicit choice, then the forwarder's own validity
  // date, then today. Empty strings must not win, so this tests truthiness
  // rather than nullishness.
  const effectiveFrom =
    String(req.body?.effectiveFrom || response.valid_from || '').trim() ||
    new Date().toISOString().slice(0, 10);
  const note = `Quoted by ${forwarder?.name || forwarder?.email || 'forwarder'} via rate request${
    response.notes ? ` — ${response.notes}` : ''
  }`;
  const currency = String(response.currency ?? 'AUD');
  const fxToAud = Number(response.fx_to_aud ?? 1);
  const ancillaries = response.ancillaries_json ? JSON.parse(String(response.ancillaries_json)) : [];

  const created: string[] = [];
  const modes = (req.body?.modes as string[]) ?? ['LCL', 'FCL'];

  const lclPoints = response.lcl_points_json ? JSON.parse(String(response.lcl_points_json)) : [];
  if (modes.includes('LCL') && lclPoints.length >= 3) {
    const card = createRateCard(
      {
        laneId: rfq.lane_id,
        mode: 'LCL',
        currency,
        fxToAud,
        effectiveFrom,
        note,
        lclPoints,
        lclConfig: {
          fitModel: 'piecewise_linear',
          minCharge: Number(response.lcl_min_charge ?? 0),
          minCbm: Number(response.lcl_min_cbm ?? 0),
        },
        ancillaries,
      },
      req.user!.id,
    );
    created.push(card.id);
  }

  const fcl = response.fcl_json ? JSON.parse(String(response.fcl_json)) : [];
  if (modes.includes('FCL') && fcl.length > 0) {
    const card = createRateCard(
      { laneId: rfq.lane_id, mode: 'FCL', currency, fxToAud, effectiveFrom, note, fcl, ancillaries },
      req.user!.id,
    );
    created.push(card.id);
  }

  if (created.length === 0) {
    res.status(400).json({ error: 'Nothing to import — the response has no usable LCL or FCL figures' });
    return;
  }

  db.prepare("UPDATE rfq_requests SET status = 'imported' WHERE id = ?").run(req.params.id);
  audit('rfq_requests', req.params.id, 'imported', req.user!.id, { rateCardIds: created, effectiveFrom });
  res.json({
    ok: true,
    rateCardIds: created,
    effectiveFrom,
    // A forwarder often quotes rates that start later. The version is correct
    // but is not in force yet, and saying so beats the estimator wondering why
    // the lane has no price.
    future: effectiveFrom > new Date().toISOString().slice(0, 10),
  });
});

/* ------------------------------------------------------------------ */
/* Public side — the forwarder, with no account                        */
/* ------------------------------------------------------------------ */

publicRfqRouter.use(publicThrottle);

function loadByToken(token: string): (RfqRow & { forwarder_email: string }) | null {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const row = db
    .prepare(
      `SELECT r.*, f.email AS forwarder_email, f.name AS forwarder_name
       FROM rfq_requests r JOIN forwarders f ON f.id = r.forwarder_id WHERE r.token = ?`,
    )
    .get(token) as (RfqRow & { forwarder_email: string }) | undefined;
  return row ?? null;
}

/** What the forwarder sees. Deliberately narrow: nothing about other lanes,
 *  other forwarders, our own rates, or what anyone else has quoted. */
publicRfqRouter.get('/:token', (req, res) => {
  const row = loadByToken(req.params.token);
  if (!row) {
    res.status(404).json({ error: 'This link is not valid.' });
    return;
  }
  if (row.status === 'cancelled') {
    res.status(410).json({ error: 'This rate request has been withdrawn.' });
    return;
  }
  if (isExpired(row)) {
    res.status(410).json({ error: 'This rate request has expired. Ask your contact to send a new link.' });
    return;
  }

  const consignment = row.consignment_json ? JSON.parse(row.consignment_json) : null;
  const containerTypes = db
    .prepare('SELECT id, name FROM container_types WHERE active = 1 ORDER BY int_l_mm, int_h_mm')
    .all();
  const alreadySubmitted = (
    db.prepare('SELECT COUNT(*) AS n FROM rfq_responses WHERE rfq_id = ?').get(row.id) as { n: number }
  ).n;

  res.json({
    lane: laneLabel(row.lane_id),
    currency: row.currency,
    incoterm: row.incoterm,
    commodity: row.commodity,
    cargoReadyDate: row.cargo_ready_date,
    notes: row.notes,
    expiresAt: row.expires_at,
    forwarderEmail: row.forwarder_email,
    metrics: consignment?.metrics ?? null,
    lines: consignment?.lines ?? [],
    containerTypes,
    alreadySubmitted,
    maxPdfBytes: MAX_PDF_BYTES,
  });
});

publicRfqRouter.post('/:token', (req, res) => {
  upload.single('pdf')(req, res, (err) => {
    if (err) {
      const message =
        (err as { code?: string }).code === 'LIMIT_FILE_SIZE'
          ? `The PDF is too large. The limit is ${MAX_PDF_BYTES / 1024 / 1024} MB.`
          : (err as Error).message;
      res.status(400).json({ error: message });
      return;
    }

    const row = loadByToken(req.params.token);
    const file = (req as unknown as { file?: { path: string; originalname: string; size: number } }).file;

    const reject = (status: number, error: string) => {
      if (file) fs.unlink(file.path, () => undefined);
      res.status(status).json({ error });
    };

    if (!row) return reject(404, 'This link is not valid.');
    if (row.status === 'cancelled') return reject(410, 'This rate request has been withdrawn.');
    if (isExpired(row)) return reject(410, 'This rate request has expired.');

    // The Content-Type multer filtered on is supplied by the uploader and is
    // trivially faked, so confirm the file really starts with a PDF header
    // before keeping it.
    if (file) {
      const header = Buffer.alloc(5);
      try {
        const fd = fs.openSync(file.path, 'r');
        fs.readSync(fd, header, 0, 5, 0);
        fs.closeSync(fd);
      } catch {
        return reject(400, 'Could not read the uploaded file.');
      }
      if (header.toString('latin1') !== '%PDF-') {
        return reject(400, 'That file is not a PDF.');
      }
    }

    const b = req.body ?? {};
    // A multipart form posts untouched fields as empty strings. Storing those
    // as '' rather than NULL breaks every later `?? fallback`, so they are
    // normalised on the way in.
    const text = (value: unknown): string | null => {
      const v = typeof value === 'string' ? value.trim() : '';
      return v === '' ? null : v;
    };
    const parse = (value: unknown, fallback: unknown = []) => {
      if (typeof value !== 'string' || value.trim() === '') return fallback;
      try {
        return JSON.parse(value);
      } catch {
        return fallback;
      }
    };

    const lclPoints = (parse(b.lclPoints) as { volumeCbm: number; totalPrice: number }[]).filter(
      (p) => Number(p.volumeCbm) > 0 && Number(p.totalPrice) > 0,
    );
    const fcl = (parse(b.fcl) as { containerTypeId: string; oceanCost: number }[]).filter(
      (f) => f.containerTypeId && Number(f.oceanCost) > 0,
    );

    if (lclPoints.length === 0 && fcl.length === 0 && !file) {
      return reject(400, 'Enter at least one LCL or FCL rate, or attach your quote as a PDF.');
    }

    const id = newId('rfqr');
    db.prepare(
      `INSERT INTO rfq_responses (id, rfq_id, submitted_at, submitter_name, submitter_email, currency,
                                  fx_to_aud, valid_from, valid_until, transit_days, free_time_days, notes,
                                  lcl_points_json, lcl_min_charge, lcl_min_cbm, fcl_json, ancillaries_json,
                                  pdf_path, pdf_original_name, pdf_size, submitted_ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      row.id,
      new Date().toISOString(),
      text(b.submitterName),
      text(b.submitterEmail),
      text(b.currency) ?? row.currency,
      Number(b.fxToAud) || 1,
      text(b.validFrom),
      text(b.validUntil),
      Number(b.transitDays) || null,
      Number(b.freeTimeDays) || null,
      text(b.notes),
      JSON.stringify(lclPoints),
      Number(b.lclMinCharge ?? 0),
      Number(b.lclMinCbm ?? 0),
      JSON.stringify(fcl),
      JSON.stringify(parse(b.ancillaries)),
      file ? path.join(UPLOAD_DIR, path.basename(file.path)) : null,
      file ? file.originalname.slice(0, 200) : null,
      file ? file.size : null,
      req.ip ?? null,
    );

    db.prepare("UPDATE rfq_requests SET status = 'responded', responded_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      row.id,
    );
    audit('rfq_responses', id, 'submitted', null, { rfqId: row.id, hasPdf: Boolean(file) });

    res.status(201).json({ ok: true, message: 'Thanks — your rates have been sent through.' });
  });
});
