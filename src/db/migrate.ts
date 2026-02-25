import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { DbError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';
import { getPackageRoot } from '../shared/utils.js';

function getMigrationsDir(): string {
  return path.join(getPackageRoot(), 'src', 'db', 'migrations');
}

function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name      TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function getAppliedMigrations(db: Database.Database): Set<string> {
  const rows = db.prepare('SELECT name FROM _migrations').all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function getPendingMigrations(applied: Set<string>): string[] {
  const migrationsDir = getMigrationsDir();
  if (!fs.existsSync(migrationsDir)) {
    throw new DbError(`Migrations directory not found: ${migrationsDir}`);
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  return files.filter((f) => !applied.has(f));
}

export function runMigrations(db: Database.Database): { applied: string[]; skipped: string[] } {
  ensureMigrationsTable(db);

  const alreadyApplied = getAppliedMigrations(db);
  const pending = getPendingMigrations(alreadyApplied);

  const applied: string[] = [];
  const skipped = [...alreadyApplied];

  for (const migration of pending) {
    const filePath = path.join(getMigrationsDir(), migration);
    const sql = fs.readFileSync(filePath, 'utf-8');

    const runInTransaction = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(migration);
    });

    try {
      runInTransaction();
      applied.push(migration);
      logger.info({ migration }, 'Migration applied');
    } catch (err) {
      throw new DbError(`Migration failed: ${migration}`, {
        migration,
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { applied, skipped };
}
