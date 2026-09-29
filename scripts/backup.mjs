#!/usr/bin/env node
/**
 * Take a consistent copy of the database while the server is running.
 *
 * Copying the file with the OS while SQLite has it open can capture a torn
 * write, so this uses SQLite's own online backup, which is safe against a live
 * server. Old backups beyond the keep count are removed.
 */
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const dbPath = resolve(process.env.DB_PATH ?? './data/semcom.db');
const backupDir = resolve(process.env.BACKUP_DIR ?? join(dirname(dbPath), 'backups'));
const keep = Number(process.env.BACKUP_KEEP ?? 30);

if (!existsSync(dbPath)) {
  console.error(`No database at ${dbPath}. Nothing to back up.`);
  process.exit(1);
}

mkdirSync(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const target = join(backupDir, `semcom-${stamp}.db`);

const db = new Database(dbPath, { readonly: true });
await db.backup(target);
db.close();

const size = (statSync(target).size / 1024 / 1024).toFixed(2);
console.log(`Backed up to ${target} (${size} MB)`);

const existing = readdirSync(backupDir)
  .filter((f) => f.startsWith('semcom-') && f.endsWith('.db'))
  .sort()
  .reverse();

for (const stale of existing.slice(keep)) {
  unlinkSync(join(backupDir, stale));
  console.log(`Removed old backup ${stale}`);
}
