import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH ?? path.resolve(process.cwd(), 'data/semcom.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Schema.
 *
 * Rate data is append-only: a "change" inserts a new rate_cards row and stamps
 * the old one's superseded_by. Nothing is ever updated in place, so every
 * estimate stays traceable to the exact version it was priced on.
 */
export function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('estimator','admin')),
      password_hash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lanes (
      id TEXT PRIMARY KEY,
      origin_port TEXT NOT NULL,
      destination_port TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      UNIQUE (origin_port, destination_port)
    );

    CREATE TABLE IF NOT EXISTS container_types (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      int_l_mm REAL NOT NULL,
      int_w_mm REAL NOT NULL,
      int_h_mm REAL NOT NULL,
      max_payload_kg REAL NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS pallet_types (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      l_mm REAL NOT NULL,
      w_mm REAL NOT NULL,
      deck_h_mm REAL NOT NULL DEFAULT 150,
      max_load_h_mm REAL NOT NULL DEFAULT 1150,
      max_load_kg REAL NOT NULL DEFAULT 1000,
      overhang_mm REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS rate_cards (
      id TEXT PRIMARY KEY,
      lane_id TEXT NOT NULL REFERENCES lanes(id),
      mode TEXT NOT NULL CHECK (mode IN ('LCL','FCL','AIR')),
      currency TEXT NOT NULL DEFAULT 'AUD',
      fx_to_aud REAL NOT NULL DEFAULT 1,
      effective_from TEXT NOT NULL,
      entered_by TEXT REFERENCES users(id),
      entered_at TEXT NOT NULL,
      note TEXT,
      superseded_by TEXT REFERENCES rate_cards(id)
    );
    CREATE INDEX IF NOT EXISTS idx_rate_cards_lane ON rate_cards(lane_id, mode, effective_from DESC);

    CREATE TABLE IF NOT EXISTS fcl_rates (
      id TEXT PRIMARY KEY,
      rate_card_id TEXT NOT NULL REFERENCES rate_cards(id) ON DELETE CASCADE,
      container_type_id TEXT NOT NULL REFERENCES container_types(id),
      ocean_cost REAL NOT NULL DEFAULT 0,
      origin_charges REAL NOT NULL DEFAULT 0,
      dest_charges REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_fcl_card ON fcl_rates(rate_card_id);

    CREATE TABLE IF NOT EXISTS lcl_points (
      id TEXT PRIMARY KEY,
      rate_card_id TEXT NOT NULL REFERENCES rate_cards(id) ON DELETE CASCADE,
      volume_cbm REAL NOT NULL,
      total_price REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lcl_points_card ON lcl_points(rate_card_id);

    CREATE TABLE IF NOT EXISTS lcl_config (
      rate_card_id TEXT PRIMARY KEY REFERENCES rate_cards(id) ON DELETE CASCADE,
      fit_model TEXT NOT NULL DEFAULT 'piecewise_linear',
      min_charge REAL NOT NULL DEFAULT 0,
      min_cbm REAL NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS air_rates (
      rate_card_id TEXT PRIMARY KEY REFERENCES rate_cards(id) ON DELETE CASCADE,
      min_charge REAL NOT NULL DEFAULT 0,
      breaks_json TEXT NOT NULL DEFAULT '[]',
      fuel_surcharge_per_kg REAL NOT NULL DEFAULT 0,
      security_surcharge_per_kg REAL NOT NULL DEFAULT 0,
      volumetric_divisor REAL NOT NULL DEFAULT 6000
    );

    CREATE TABLE IF NOT EXISTS ancillary_charges (
      id TEXT PRIMARY KEY,
      rate_card_id TEXT NOT NULL REFERENCES rate_cards(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      basis TEXT NOT NULL CHECK (basis IN ('per_shipment','per_cbm','per_container','per_kg')),
      amount REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_anc_card ON ancillary_charges(rate_card_id);

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      ref TEXT NOT NULL,
      client TEXT,
      lane_id TEXT REFERENCES lanes(id),
      status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Quoted','Won','Lost')),
      incoterm TEXT,
      commodity TEXT,
      hs_code TEXT,
      cargo_ready_date TEXT,
      dangerous_goods INTEGER NOT NULL DEFAULT 0,
      loading_mode TEXT NOT NULL DEFAULT 'floor',
      pallet_type_id TEXT REFERENCES pallet_types(id),
      stow_efficiency REAL NOT NULL DEFAULT 0.85,
      fx_override REAL,
      notes TEXT,
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_ref ON jobs(ref);

    CREATE TABLE IF NOT EXISTS job_lines (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      l_mm REAL NOT NULL,
      w_mm REAL NOT NULL,
      h_mm REAL NOT NULL,
      weight_kg REAL NOT NULL DEFAULT 0,
      qty INTEGER NOT NULL DEFAULT 0,
      units_per_carton INTEGER,
      stackable INTEGER NOT NULL DEFAULT 1,
      max_layers INTEGER,
      this_way_up INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_job_lines_job ON job_lines(job_id);

    CREATE TABLE IF NOT EXISTS job_results (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      mode_selected TEXT NOT NULL,
      rate_card_id TEXT REFERENCES rate_cards(id),
      total_cost REAL NOT NULL,
      breakdown_json TEXT NOT NULL,
      calculated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_job_results_job ON job_results(job_id, calculated_at DESC);

    CREATE TABLE IF NOT EXISTS job_actuals (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      invoiced_cost REAL NOT NULL,
      invoice_ref TEXT,
      note TEXT,
      entered_by TEXT REFERENCES users(id),
      entered_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS carton_library (
      id TEXT PRIMARY KEY,
      sku TEXT NOT NULL UNIQUE,
      description TEXT,
      l_mm REAL NOT NULL,
      w_mm REAL NOT NULL,
      h_mm REAL NOT NULL,
      weight_kg REAL NOT NULL DEFAULT 0,
      units_per_carton INTEGER,
      stackable INTEGER NOT NULL DEFAULT 1,
      max_layers INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS export_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      columns_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS forwarders (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT NOT NULL UNIQUE,
      contact_name TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    -- A rate request sent to a forwarder. The token is the only credential the
    -- forwarder has, so it is long, random, and expires.
    CREATE TABLE IF NOT EXISTS rfq_requests (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      lane_id TEXT NOT NULL REFERENCES lanes(id),
      forwarder_id TEXT NOT NULL REFERENCES forwarders(id),
      job_id TEXT REFERENCES jobs(id),
      currency TEXT NOT NULL DEFAULT 'AUD',
      incoterm TEXT,
      commodity TEXT,
      cargo_ready_date TEXT,
      notes TEXT,
      /* Snapshot of the consignment at send time, so the forwarder sees what
         was actually asked about even if the job is edited afterwards. */
      consignment_json TEXT,
      status TEXT NOT NULL DEFAULT 'sent'
        CHECK (status IN ('sent','responded','imported','cancelled','expired')),
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL,
      sent_at TEXT,
      expires_at TEXT NOT NULL,
      responded_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_rfq_lane ON rfq_requests(lane_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_rfq_status ON rfq_requests(status);

    -- What the forwarder submitted. Append-only: a corrected quote is a new
    -- row, and the latest one wins, so nothing they sent is ever lost.
    CREATE TABLE IF NOT EXISTS rfq_responses (
      id TEXT PRIMARY KEY,
      rfq_id TEXT NOT NULL REFERENCES rfq_requests(id) ON DELETE CASCADE,
      submitted_at TEXT NOT NULL,
      submitter_name TEXT,
      submitter_email TEXT,
      currency TEXT NOT NULL DEFAULT 'AUD',
      fx_to_aud REAL NOT NULL DEFAULT 1,
      valid_from TEXT,
      valid_until TEXT,
      transit_days INTEGER,
      free_time_days INTEGER,
      notes TEXT,
      lcl_points_json TEXT,
      lcl_min_charge REAL,
      lcl_min_cbm REAL,
      fcl_json TEXT,
      ancillaries_json TEXT,
      pdf_path TEXT,
      pdf_original_name TEXT,
      pdf_size INTEGER,
      submitted_ip TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_rfq_resp ON rfq_responses(rfq_id, submitted_at DESC);

    -- Append-only audit trail. Never updated, never deleted.
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      changed_by TEXT,
      changed_at TEXT NOT NULL,
      detail_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id, changed_at DESC);
  `);
}

/**
 * One-off data migrations for databases created by an earlier version.
 *
 * Each is guarded by a settings flag so it runs once and never fights an
 * admin who deliberately puts something back.
 */
export function runDataMigrations(): void {
  if (getSetting('retired_45hc', '') !== 'done') {
    // 45' HC was seeded originally and is no longer wanted. Rate history must
    // stay intact, so it is only deleted when nothing references it; otherwise
    // it is deactivated and disappears from the estimator either way.
    const used = (
      db.prepare('SELECT COUNT(*) AS n FROM fcl_rates WHERE container_type_id = ?').get('45HC') as
        | { n: number }
        | undefined
    )?.n ?? 0;
    if (used > 0) {
      db.prepare('UPDATE container_types SET active = 0 WHERE id = ?').run('45HC');
    } else {
      db.prepare('DELETE FROM container_types WHERE id = ?').run('45HC');
    }
    setSetting('retired_45hc', 'done');
  }
}

export function audit(
  entity: string,
  entityId: string,
  action: string,
  changedBy: string | null,
  detail?: unknown,
): void {
  db.prepare(
    `INSERT INTO audit_log (entity, entity_id, action, changed_by, changed_at, detail_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(entity, entityId, action, changedBy, new Date().toISOString(), detail ? JSON.stringify(detail) : null);
}

export function getSetting(key: string, fallback: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
