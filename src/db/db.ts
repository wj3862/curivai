import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { resolvePath } from '../shared/utils.js';
import { DbError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';

let dbInstance: Database.Database | null = null;

export function initDb(dbPath: string): Database.Database {
  if (dbInstance) return dbInstance;

  const resolved = dbPath === ':memory:' ? ':memory:' : resolvePath(dbPath);

  if (resolved !== ':memory:') {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
  }

  try {
    const db = new Database(resolved);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');

    dbInstance = db;
    logger.debug({ path: resolved }, 'Database initialized');
    return db;
  } catch (err) {
    throw new DbError(`Failed to initialize database at ${resolved}`, {
      path: resolved,
      cause: err instanceof Error ? err.message : String(err),
    });
  }
}

export function getDb(): Database.Database {
  if (!dbInstance) {
    throw new DbError('Database not initialized. Call initDb() first.');
  }
  return dbInstance;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export function resetDbInstance(): void {
  dbInstance = null;
}
