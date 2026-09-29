import { Router } from 'express';
import type { CartonLine } from '@semcom/engine';
import { defaultColumns, estimateVariance } from '@semcom/engine';
import { requireAuth } from '../auth.js';
import { audit, db, newId } from '../db.js';

export const jobsRouter = Router();
jobsRouter.use(requireAuth);

interface JobLineRow {
  id: string;
  description: string | null;
  l_mm: number;
  w_mm: number;
  h_mm: number;
  weight_kg: number;
  qty: number;
  units_per_carton: number | null;
  stackable: number;
  max_layers: number | null;
  this_way_up: number;
}

function toCartonLine(r: JobLineRow): CartonLine {
  return {
    id: r.id,
    description: r.description ?? '',
    lengthMm: r.l_mm,
    widthMm: r.w_mm,
    heightMm: r.h_mm,
    weightKg: r.weight_kg,
    qty: r.qty,
    unitsPerCarton: r.units_per_carton ?? undefined,
    stackable: r.stackable === 1,
    maxStackLayers: r.max_layers ?? undefined,
    thisWayUp: r.this_way_up === 1,
  };
}

function loadJob(id: string) {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!job) return null;
  const lines = db
    .prepare('SELECT * FROM job_lines WHERE job_id = ? ORDER BY position, rowid')
    .all(id) as JobLineRow[];
  const results = db
    .prepare('SELECT * FROM job_results WHERE job_id = ? ORDER BY calculated_at DESC')
    .all(id);
  const actuals = db.prepare('SELECT * FROM job_actuals WHERE job_id = ? ORDER BY entered_at DESC').all(id);
  return { job, lines: lines.map(toCartonLine), results, actuals };
}

jobsRouter.get('/', (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const search = req.query.q ? `%${String(req.query.q)}%` : null;
  let sql = `SELECT j.*, l.origin_port, l.destination_port,
                    (SELECT total_cost FROM job_results r WHERE r.job_id = j.id ORDER BY calculated_at DESC LIMIT 1) AS latest_total,
                    (SELECT mode_selected FROM job_results r WHERE r.job_id = j.id ORDER BY calculated_at DESC LIMIT 1) AS latest_mode,
                    (SELECT invoiced_cost FROM job_actuals a WHERE a.job_id = j.id ORDER BY entered_at DESC LIMIT 1) AS latest_actual
             FROM jobs j LEFT JOIN lanes l ON l.id = j.lane_id WHERE 1=1`;
  const params: unknown[] = [];
  if (status) {
    sql += ' AND j.status = ?';
    params.push(status);
  }
  if (search) {
    sql += ' AND (j.ref LIKE ? OR j.client LIKE ?)';
    params.push(search, search);
  }
  sql += ' ORDER BY j.updated_at DESC LIMIT 500';
  res.json(db.prepare(sql).all(...params));
});

jobsRouter.get('/:id', (req, res) => {
  const job = loadJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json(job);
});

function writeLines(jobId: string, lines: CartonLine[]): void {
  db.prepare('DELETE FROM job_lines WHERE job_id = ?').run(jobId);
  const insert = db.prepare(
    `INSERT INTO job_lines (id, job_id, position, description, l_mm, w_mm, h_mm, weight_kg, qty,
                            units_per_carton, stackable, max_layers, this_way_up)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  lines.forEach((l, i) => {
    insert.run(
      l.id || newId('jl'),
      jobId,
      i,
      l.description ?? '',
      l.lengthMm,
      l.widthMm,
      l.heightMm,
      l.weightKg,
      l.qty,
      l.unitsPerCarton ?? null,
      l.stackable === false ? 0 : 1,
      l.maxStackLayers ?? null,
      l.thisWayUp ? 1 : 0,
    );
  });
}

const JOB_FIELDS = [
  'ref', 'client', 'lane_id', 'status', 'incoterm', 'commodity', 'hs_code',
  'cargo_ready_date', 'dangerous_goods', 'loading_mode', 'pallet_type_id',
  'stow_efficiency', 'fx_override', 'notes', 'breaks_json',
] as const;

const BODY_KEYS: Record<(typeof JOB_FIELDS)[number], string> = {
  ref: 'ref',
  client: 'client',
  lane_id: 'laneId',
  status: 'status',
  incoterm: 'incoterm',
  commodity: 'commodity',
  hs_code: 'hsCode',
  cargo_ready_date: 'cargoReadyDate',
  dangerous_goods: 'dangerousGoods',
  loading_mode: 'loadingMode',
  pallet_type_id: 'palletTypeId',
  stow_efficiency: 'stowEfficiency',
  fx_override: 'fxOverride',
  notes: 'notes',
  breaks_json: 'breaksJson',
};

jobsRouter.post('/', (req, res) => {
  const body = req.body ?? {};
  if (!body.ref) {
    res.status(400).json({ error: 'A job or quote reference is required' });
    return;
  }
  const id = newId('job');
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO jobs (id, ref, client, lane_id, status, incoterm, commodity, hs_code, cargo_ready_date,
                       dangerous_goods, loading_mode, pallet_type_id, stow_efficiency, fx_override, notes,
                       breaks_json, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    body.ref,
    body.client ?? null,
    body.laneId ?? null,
    body.status ?? 'Draft',
    body.incoterm ?? null,
    body.commodity ?? null,
    body.hsCode ?? null,
    body.cargoReadyDate ?? null,
    body.dangerousGoods ? 1 : 0,
    body.loadingMode ?? 'floor',
    body.palletTypeId ?? null,
    body.stowEfficiency ?? 0.85,
    body.fxOverride ?? null,
    body.notes ?? null,
    body.breaks ? JSON.stringify(body.breaks) : null,
    req.user!.id,
    now,
    now,
  );
  writeLines(id, body.lines ?? []);
  audit('jobs', id, 'created', req.user!.id, { ref: body.ref, client: body.client });
  res.status(201).json(loadJob(id));
});

jobsRouter.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id) as
    | Record<string, unknown>
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  const body = req.body ?? {};
  const sets: string[] = [];
  const params: unknown[] = [];
  const changes: Record<string, unknown> = {};
  for (const column of JOB_FIELDS) {
    // The client sends `breaks` as an array; everything else is a scalar.
    const key = column === 'breaks_json' ? 'breaks' : BODY_KEYS[column];
    if (body[key] === undefined) continue;
    let value = body[key];
    if (column === 'dangerous_goods') value = value ? 1 : 0;
    if (column === 'breaks_json' && value !== null && typeof value !== 'string') {
      value = JSON.stringify(value);
    }
    if (value !== existing[column]) changes[column] = value;
    sets.push(`${column} = ?`);
    params.push(value);
  }
  sets.push('updated_at = ?');
  params.push(new Date().toISOString(), req.params.id);
  db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  if (body.lines) writeLines(req.params.id, body.lines);
  audit('jobs', req.params.id, 'updated', req.user!.id, changes);
  res.json(loadJob(req.params.id));
});

/** Duplicate a job as the starting point for a new one. */
jobsRouter.post('/:id/duplicate', (req, res) => {
  const source = loadJob(req.params.id);
  if (!source) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  const id = newId('job');
  const now = new Date().toISOString();
  const j = source.job as Record<string, unknown>;
  db.prepare(
    `INSERT INTO jobs (id, ref, client, lane_id, status, incoterm, commodity, hs_code, cargo_ready_date,
                       dangerous_goods, loading_mode, pallet_type_id, stow_efficiency, fx_override, notes,
                       breaks_json, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    req.body?.ref ?? `${j.ref} (copy)`,
    j.client ?? null,
    j.lane_id ?? null,
    j.incoterm ?? null,
    j.commodity ?? null,
    j.hs_code ?? null,
    j.cargo_ready_date ?? null,
    j.dangerous_goods ?? 0,
    j.loading_mode ?? 'floor',
    j.pallet_type_id ?? null,
    j.stow_efficiency ?? 0.85,
    j.fx_override ?? null,
    j.notes ?? null,
    j.breaks_json ?? null,
    req.user!.id,
    now,
    now,
  );
  writeLines(id, source.lines.map((l) => ({ ...l, id: newId('jl') })));
  audit('jobs', id, 'duplicated', req.user!.id, { from: req.params.id });
  res.status(201).json(loadJob(id));
});

/** Save a calculated estimate against the job. Results are append-only. */
jobsRouter.post('/:id/results', (req, res) => {
  const body = req.body ?? {};
  const id = newId('jr');
  db.prepare(
    `INSERT INTO job_results (id, job_id, mode_selected, rate_card_id, total_cost, breakdown_json, calculated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    req.params.id,
    body.modeSelected,
    body.rateCardId ?? null,
    body.totalCost ?? 0,
    JSON.stringify(body.breakdown ?? {}),
    new Date().toISOString(),
  );
  db.prepare('UPDATE jobs SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), req.params.id);
  audit('job_results', id, 'created', req.user!.id, {
    jobId: req.params.id,
    mode: body.modeSelected,
    total: body.totalCost,
  });
  res.status(201).json(db.prepare('SELECT * FROM job_results WHERE id = ?').get(id));
});

/** Record the invoiced freight and report estimate-vs-actual variance. */
jobsRouter.post('/:id/actuals', (req, res) => {
  const body = req.body ?? {};
  if (!(Number(body.invoicedCost) > 0)) {
    res.status(400).json({ error: 'An invoiced cost greater than zero is required' });
    return;
  }
  const id = newId('ja');
  db.prepare(
    `INSERT INTO job_actuals (id, job_id, invoiced_cost, invoice_ref, note, entered_by, entered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    req.params.id,
    Number(body.invoicedCost),
    body.invoiceRef ?? null,
    body.note ?? null,
    req.user!.id,
    new Date().toISOString(),
  );
  audit('job_actuals', id, 'created', req.user!.id, { jobId: req.params.id, invoicedCost: body.invoicedCost });
  const latest = db
    .prepare('SELECT total_cost FROM job_results WHERE job_id = ? ORDER BY calculated_at DESC LIMIT 1')
    .get(req.params.id) as { total_cost: number } | undefined;
  res.status(201).json({
    actual: db.prepare('SELECT * FROM job_actuals WHERE id = ?').get(id),
    variance: latest ? estimateVariance(latest.total_cost, Number(body.invoicedCost)) : null,
  });
});

/** Estimate accuracy across closed jobs — how good the rate cards really are. */
jobsRouter.get('/reports/accuracy', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT j.id, j.ref, j.client, j.status,
              r.total_cost AS estimate, r.mode_selected AS mode, r.calculated_at,
              a.invoiced_cost AS actual, a.invoice_ref
       FROM jobs j
       JOIN job_actuals a ON a.id = (SELECT id FROM job_actuals x WHERE x.job_id = j.id ORDER BY entered_at DESC LIMIT 1)
       LEFT JOIN job_results r ON r.id = (SELECT id FROM job_results y WHERE y.job_id = j.id ORDER BY calculated_at DESC LIMIT 1)
       ORDER BY a.entered_at DESC`,
    )
    .all() as { estimate: number | null; actual: number }[];

  const withVariance = rows.map((r) => ({
    ...r,
    variance: r.estimate == null ? null : estimateVariance(r.estimate, r.actual),
  }));
  const scored = withVariance.filter((r) => r.variance?.pct != null);
  const meanAbsPct =
    scored.length > 0
      ? scored.reduce((s, r) => s + Math.abs(r.variance!.pct!), 0) / scored.length
      : null;
  res.json({ jobs: withVariance, meanAbsPct, count: scored.length });
});

/* Carton library ---------------------------------------------------- */

jobsRouter.get('/library/cartons', (req, res) => {
  const q = req.query.q ? `%${String(req.query.q)}%` : null;
  const rows = q
    ? db
        .prepare('SELECT * FROM carton_library WHERE sku LIKE ? OR description LIKE ? ORDER BY sku LIMIT 100')
        .all(q, q)
    : db.prepare('SELECT * FROM carton_library ORDER BY updated_at DESC LIMIT 100').all();
  res.json(rows);
});

jobsRouter.post('/library/cartons', (req, res) => {
  const b = req.body ?? {};
  if (!b.sku) {
    res.status(400).json({ error: 'A SKU is required to save a carton to the library' });
    return;
  }
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO carton_library (id, sku, description, l_mm, w_mm, h_mm, weight_kg, units_per_carton,
                                 stackable, max_layers, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(sku) DO UPDATE SET
       description = excluded.description, l_mm = excluded.l_mm, w_mm = excluded.w_mm,
       h_mm = excluded.h_mm, weight_kg = excluded.weight_kg,
       units_per_carton = excluded.units_per_carton, stackable = excluded.stackable,
       max_layers = excluded.max_layers, updated_at = excluded.updated_at`,
  ).run(
    newId('lib'),
    b.sku,
    b.description ?? null,
    b.lengthMm,
    b.widthMm,
    b.heightMm,
    b.weightKg ?? 0,
    b.unitsPerCarton ?? null,
    b.stackable === false ? 0 : 1,
    b.maxStackLayers ?? null,
    now,
    now,
  );
  res.status(201).json(db.prepare('SELECT * FROM carton_library WHERE sku = ?').get(b.sku));
});

jobsRouter.delete('/library/cartons/:sku', (req, res) => {
  db.prepare('DELETE FROM carton_library WHERE sku = ?').run(req.params.sku);
  res.json({ ok: true });
});

/* Export profiles --------------------------------------------------- */

jobsRouter.get('/export/profiles', (_req, res) => {
  const rows = db.prepare('SELECT * FROM export_profiles ORDER BY name').all() as {
    id: string;
    name: string;
    columns_json: string;
  }[];
  res.json({
    profiles: rows.map((r) => ({ id: r.id, name: r.name, columns: JSON.parse(r.columns_json) })),
    available: defaultColumns(),
  });
});

jobsRouter.post('/export/profiles', (req, res) => {
  const b = req.body ?? {};
  if (!b.name || !Array.isArray(b.columns)) {
    res.status(400).json({ error: 'name and columns are required' });
    return;
  }
  const id = newId('xp');
  db.prepare(
    `INSERT INTO export_profiles (id, name, columns_json, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET columns_json = excluded.columns_json`,
  ).run(id, b.name, JSON.stringify(b.columns), new Date().toISOString());
  res.status(201).json({ ok: true });
});
