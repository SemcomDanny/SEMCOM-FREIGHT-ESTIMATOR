import { Router } from 'express';
import { requireAdmin, requireAuth } from '../auth.js';
import { audit, db, getSetting, newId, setSetting } from '../db.js';

export const masterRouter = Router();
masterRouter.use(requireAuth);

/* Lanes ------------------------------------------------------------- */

masterRouter.get('/lanes', (_req, res) => {
  res.json(db.prepare('SELECT * FROM lanes ORDER BY origin_port, destination_port').all());
});

masterRouter.post('/lanes', requireAdmin, (req, res) => {
  const { originPort, destinationPort } = req.body ?? {};
  if (!originPort || !destinationPort) {
    res.status(400).json({ error: 'originPort and destinationPort are required' });
    return;
  }
  const id = newId('lane');
  try {
    db.prepare('INSERT INTO lanes (id, origin_port, destination_port, active) VALUES (?, ?, ?, 1)').run(
      id,
      originPort,
      destinationPort,
    );
  } catch {
    res.status(409).json({ error: 'That lane already exists' });
    return;
  }
  audit('lanes', id, 'created', req.user!.id, { originPort, destinationPort });
  res.status(201).json(db.prepare('SELECT * FROM lanes WHERE id = ?').get(id));
});

/**
 * Delete a lane.
 *
 * Refused while anything still points at it: rate versions are the audit trail
 * behind past estimates and jobs are the quote record, so neither may be
 * orphaned. Deactivating hides a lane from the estimator without destroying
 * that history, which is what you want almost every time.
 */
masterRouter.delete('/lanes/:id', requireAdmin, (req, res) => {
  const lane = db.prepare('SELECT * FROM lanes WHERE id = ?').get(req.params.id) as
    | { origin_port: string; destination_port: string }
    | undefined;
  if (!lane) {
    res.status(404).json({ error: 'Lane not found' });
    return;
  }

  const rateVersions = (
    db.prepare('SELECT COUNT(*) AS n FROM rate_cards WHERE lane_id = ?').get(req.params.id) as { n: number }
  ).n;
  const jobs = (
    db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE lane_id = ?').get(req.params.id) as { n: number }
  ).n;

  if (rateVersions > 0 || jobs > 0) {
    const parts: string[] = [];
    if (rateVersions > 0) parts.push(`${rateVersions} rate version(s)`);
    if (jobs > 0) parts.push(`${jobs} job(s)`);
    res.status(409).json({
      error:
        `${lane.origin_port} → ${lane.destination_port} still has ${parts.join(' and ')} against it. ` +
        `Deleting it would orphan that history. Deactivate the lane instead — it disappears from the ` +
        `estimator and keeps the record.`,
    });
    return;
  }

  db.prepare('DELETE FROM lanes WHERE id = ?').run(req.params.id);
  audit('lanes', req.params.id, 'deleted', req.user!.id, {
    originPort: lane.origin_port,
    destinationPort: lane.destination_port,
  });
  res.json({ ok: true });
});

masterRouter.patch('/lanes/:id', requireAdmin, (req, res) => {
  const { active } = req.body ?? {};
  db.prepare('UPDATE lanes SET active = ? WHERE id = ?').run(active ? 1 : 0, req.params.id);
  audit('lanes', req.params.id, 'updated', req.user!.id, { active });
  res.json(db.prepare('SELECT * FROM lanes WHERE id = ?').get(req.params.id));
});

/* Container types --------------------------------------------------- */

masterRouter.get('/container-types', (_req, res) => {
  res.json(db.prepare('SELECT * FROM container_types ORDER BY int_l_mm, int_h_mm').all());
});

masterRouter.post('/container-types', requireAdmin, (req, res) => {
  const { id, name, intLMm, intWMm, intHMm, maxPayloadKg } = req.body ?? {};
  if (!id || !name) {
    res.status(400).json({ error: 'id and name are required' });
    return;
  }
  db.prepare(
    `INSERT INTO container_types (id, name, int_l_mm, int_w_mm, int_h_mm, max_payload_kg, active)
     VALUES (?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, int_l_mm = excluded.int_l_mm, int_w_mm = excluded.int_w_mm,
       int_h_mm = excluded.int_h_mm, max_payload_kg = excluded.max_payload_kg`,
  ).run(id, name, intLMm, intWMm, intHMm, maxPayloadKg);
  audit('container_types', id, 'upserted', req.user!.id, req.body);
  res.json(db.prepare('SELECT * FROM container_types WHERE id = ?').get(id));
});

masterRouter.patch('/container-types/:id', requireAdmin, (req, res) => {
  const { active } = req.body ?? {};
  db.prepare('UPDATE container_types SET active = ? WHERE id = ?').run(active ? 1 : 0, req.params.id);
  audit('container_types', req.params.id, 'updated', req.user!.id, { active });
  res.json(db.prepare('SELECT * FROM container_types WHERE id = ?').get(req.params.id));
});

/* Pallet types ------------------------------------------------------ */

masterRouter.get('/pallet-types', (_req, res) => {
  res.json(db.prepare('SELECT * FROM pallet_types ORDER BY name').all());
});

masterRouter.post('/pallet-types', requireAdmin, (req, res) => {
  const { id, name, lMm, wMm, deckHMm, maxLoadHMm, maxLoadKg, overhangMm } = req.body ?? {};
  const rowId = id || newId('pal');
  db.prepare(
    `INSERT INTO pallet_types (id, name, l_mm, w_mm, deck_h_mm, max_load_h_mm, max_load_kg, overhang_mm, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, l_mm = excluded.l_mm, w_mm = excluded.w_mm,
       deck_h_mm = excluded.deck_h_mm, max_load_h_mm = excluded.max_load_h_mm,
       max_load_kg = excluded.max_load_kg, overhang_mm = excluded.overhang_mm`,
  ).run(rowId, name, lMm, wMm, deckHMm ?? 150, maxLoadHMm ?? 1150, maxLoadKg ?? 1000, overhangMm ?? 0);
  audit('pallet_types', rowId, 'upserted', req.user!.id, req.body);
  res.json(db.prepare('SELECT * FROM pallet_types WHERE id = ?').get(rowId));
});

/* Settings ---------------------------------------------------------- */

masterRouter.get('/settings', (_req, res) => {
  res.json({
    stowEfficiency: Number(getSetting('stow_efficiency', '0.85')),
    staleRateDays: Number(getSetting('stale_rate_days', '60')),
    defaultDutyPct: Number(getSetting('default_duty_pct', '5')),
    defaultGstPct: Number(getSetting('default_gst_pct', '10')),
    palletTareKg: Number(getSetting('pallet_tare_kg', '25')),
  });
});

masterRouter.put('/settings', requireAdmin, (req, res) => {
  const map: Record<string, string> = {
    stowEfficiency: 'stow_efficiency',
    staleRateDays: 'stale_rate_days',
    defaultDutyPct: 'default_duty_pct',
    defaultGstPct: 'default_gst_pct',
    palletTareKg: 'pallet_tare_kg',
  };
  for (const [key, column] of Object.entries(map)) {
    if (req.body?.[key] !== undefined) setSetting(column, String(req.body[key]));
  }
  audit('settings', 'global', 'updated', req.user!.id, req.body);
  res.json({ ok: true });
});

/* Audit trail ------------------------------------------------------- */

masterRouter.get('/audit', requireAdmin, (req, res) => {
  const { entity, entityId, limit } = req.query;
  const max = Math.min(Number(limit) || 200, 1000);
  const rows =
    entity && entityId
      ? db
          .prepare(
            `SELECT a.*, u.name AS changed_by_name FROM audit_log a
             LEFT JOIN users u ON u.id = a.changed_by
             WHERE entity = ? AND entity_id = ? ORDER BY changed_at DESC LIMIT ?`,
          )
          .all(entity, entityId, max)
      : db
          .prepare(
            `SELECT a.*, u.name AS changed_by_name FROM audit_log a
             LEFT JOIN users u ON u.id = a.changed_by
             ORDER BY a.id DESC LIMIT ?`,
          )
          .all(max);
  res.json(rows);
});
