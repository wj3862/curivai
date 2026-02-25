import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { resolvePath } from '../shared/utils.js';
import { DbError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';

let dbInstance: Database.Database | null = null;

/**
 * When running inside a pkg-bundled executable, better-sqlite3's native .node
 * file must be loaded from the real filesystem (not pkg's virtual snapshot).
 * We look next to the executable first, then fall back to require.resolve()
 * which pkg remaps to the extracted temp directory.
 */
function resolveNativeBinding(): string | undefined {
  if (!(process as unknown as { pkg?: unknown }).pkg) return undefined;

  // 1. Check next to the executable (user can place it there manually)
  const execDir = path.dirname(process.execPath);
  const nextToExe = path.join(execDir, 'better_sqlite3.node');
  if (fs.existsSync(nextToExe)) return nextToExe;

  // 2. Try require.resolve — pkg extracts .node assets to a temp dir and
  //    remaps require() to the extracted path.
  const candidates = [
    'better-sqlite3/build/Release/better_sqlite3.node',
    `better-sqlite3/prebuilds/${process.platform}-${process.arch}/node.napi.node`,
  ];
  for (const p of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return (require as NodeJS.Require).resolve(p);
    } catch { /* try next */ }
  }
  return undefined;
}

export function initDb(dbPath: string): Database.Database {
  if (dbInstance) return dbInstance;

  const resolved = dbPath === ':memory:' ? ':memory:' : resolvePath(dbPath);

  if (resolved !== ':memory:') {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
  }

  try {
    const bindingPath = resolveNativeBinding();
    const db = new Database(resolved, bindingPath ? { nativeBinding: bindingPath } : undefined);
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
