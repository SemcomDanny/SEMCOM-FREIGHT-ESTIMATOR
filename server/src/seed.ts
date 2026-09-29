import { SEED_CONTAINER_TYPES, SEED_PALLET_TYPES } from '@semcom/engine';
import { db, newId, setSetting } from './db.js';
import { createUser } from './auth.js';

/**
 * Seed equipment master data, default settings and a first admin so the tool
 * is usable straight after deployment. Existing rows are never overwritten —
 * an admin's edits to a container's internal dimensions must survive restarts.
 */
export function seedIfEmpty(): void {
  const insertContainer = db.prepare(
    `INSERT OR IGNORE INTO container_types (id, name, int_l_mm, int_w_mm, int_h_mm, max_payload_kg, active)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
  );
  for (const c of SEED_CONTAINER_TYPES) {
    insertContainer.run(c.id, c.name, c.intLMm, c.intWMm, c.intHMm, c.maxPayloadKg);
  }

  const insertPallet = db.prepare(
    `INSERT OR IGNORE INTO pallet_types (id, name, l_mm, w_mm, deck_h_mm, max_load_h_mm, max_load_kg, overhang_mm, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  );
  for (const p of SEED_PALLET_TYPES) {
    insertPallet.run(p.id, p.name, p.lMm, p.wMm, p.deckHMm, p.maxLoadHMm, p.maxLoadKg, p.overhangMm ?? 0);
  }

  const defaults: [string, string][] = [
    ['stow_efficiency', '0.85'],
    ['stale_rate_days', '60'],
    ['default_duty_pct', '5'],
    ['default_gst_pct', '10'],
    ['pallet_tare_kg', '25'],
  ];
  for (const [key, value] of defaults) {
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  }

  const userCount = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  if (userCount === 0) {
    const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@sem.com.au';
    const password = process.env.SEED_ADMIN_PASSWORD ?? 'changeme123';
    createUser(email, 'Administrator', 'admin', password);
    // eslint-disable-next-line no-console
    console.log(
      process.env.SEED_ADMIN_PASSWORD
        ? `Seeded first admin ${email} with the password from SEED_ADMIN_PASSWORD.`
        : `Seeded first admin ${email} with the default password. Change it before anyone else uses the tool.`,
    );
  }

  const laneCount = (db.prepare('SELECT COUNT(*) AS n FROM lanes').get() as { n: number }).n;
  if (laneCount === 0) {
    for (const [origin, destination] of [
      ['Shanghai', 'Melbourne'],
      ['Ningbo', 'Melbourne'],
      ['Shenzhen', 'Sydney'],
      ['Qingdao', 'Melbourne'],
    ]) {
      db.prepare('INSERT INTO lanes (id, origin_port, destination_port, active) VALUES (?, ?, ?, 1)').run(
        newId('lane'),
        origin,
        destination,
      );
    }
  }

  setSetting('schema_version', '1');
}
