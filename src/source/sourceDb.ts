import type Database from 'better-sqlite3';
import type { Source, Item } from './adapter.js';
import { generateId, nowISO } from '../shared/utils.js';
import { DbError } from '../shared/errors.js';

// ================================================================
// Sources CRUD
// ================================================================

export function addSource(
  db: Database.Database,
  opts: { url: string; title?: string; type?: string; pack_name?: string },
): string | null {
  let domain: string | null = null;
  try {
    domain = new URL(opts.url).hostname.replace(/^www\./, '');
  } catch {
    // invalid URL domain extraction
  }

  const id = generateId();
  try {
    db.prepare(
      `INSERT INTO sources (id, type, url, title, site_domain, pack_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, opts.type ?? 'rss', opts.url, opts.title ?? null, domain, opts.pack_name ?? null, nowISO());
    return id;
  } catch (err) {
    // UNIQUE constraint on url → already exists
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      return null;
    }
    throw new DbError(`Failed to add source: ${err instanceof Error ? err.message : String(err)}`, {
      url: opts.url,
    });
  }
}

export function listSources(
  db: Database.Database,
  opts: { activeOnly?: boolean } = {},
): Source[] {
  const where = opts.activeOnly ? 'WHERE is_active = 1' : '';
  return db.prepare(`SELECT * FROM sources ${where} ORDER BY created_at DESC`).all() as Source[];
}

export function getSource(db: Database.Database, id: string): Source | undefined {
  return db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as Source | undefined;
}

export function getSourceByUrl(db: Database.Database, url: string): Source | undefined {
  return db.prepare('SELECT * FROM sources WHERE url = ?').get(url) as Source | undefined;
}

export function updateSource(
  db: Database.Database,
  id: string,
  updates: {
    title?: string;
    is_active?: number;
    etag?: string | null;
    last_modified?: string | null;
    last_fetched_at?: string | null;
  },
): boolean {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) {
    sets.push('title = ?');
    values.push(updates.title);
  }
  if (updates.is_active !== undefined) {
    sets.push('is_active = ?');
    values.push(updates.is_active);
  }
  if (updates.etag !== undefined) {
    sets.push('etag = ?');
    values.push(updates.etag);
  }
  if (updates.last_modified !== undefined) {
    sets.push('last_modified = ?');
    values.push(updates.last_modified);
  }
  if (updates.last_fetched_at !== undefined) {
    sets.push('last_fetched_at = ?');
    values.push(updates.last_fetched_at);
  }

  if (sets.length === 0) return false;

  values.push(id);
  const result = db.prepare(`UPDATE sources SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

export function deleteSource(db: Database.Database, id: string): boolean {
  // Delete items first (cascade not automatic in SQLite without ON DELETE CASCADE)
  db.prepare('DELETE FROM items WHERE source_id = ?').run(id);
  const result = db.prepare('DELETE FROM sources WHERE id = ?').run(id);
  return result.changes > 0;
}

// ================================================================
// Items CRUD
// ================================================================

export interface InsertItemData {
  source_id: string;
  guid?: string | null;
  title: string;
  url: string;
  canonical_url?: string | null;
  dedup_key: string;
  author?: string | null;
  published_at?: string | null;
  raw_excerpt?: string | null;
  lang?: string | null;
  word_count?: number | null;
  read_time_min?: number | null;
  content_text?: string | null;
  content_hash?: string | null;
  is_duplicate?: number;
}

export function insertItem(db: Database.Database, item: InsertItemData): string | null {
  const id = generateId();
  try {
    db.prepare(
      `INSERT OR IGNORE INTO items
       (id, source_id, guid, title, url, canonical_url, dedup_key, author, published_at,
        fetched_at, raw_excerpt, lang, word_count, read_time_min, content_text, content_hash, is_duplicate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      item.source_id,
      item.guid ?? null,
      item.title,
      item.url,
      item.canonical_url ?? null,
      item.dedup_key,
      item.author ?? null,
      item.published_at ?? null,
      nowISO(),
      item.raw_excerpt ?? null,
      item.lang ?? null,
      item.word_count ?? null,
      item.read_time_min ?? null,
      item.content_text ?? null,
      item.content_hash ?? null,
      item.is_duplicate ?? 0,
    );

    // Check if actually inserted (INSERT OR IGNORE returns changes=0 on conflict)
    const exists = db.prepare('SELECT id FROM items WHERE id = ?').get(id) as { id: string } | undefined;
    return exists ? id : null;
  } catch (err) {
    throw new DbError(`Failed to insert item: ${err instanceof Error ? err.message : String(err)}`, {
      dedup_key: item.dedup_key,
    });
  }
}

export function dedupKeyExists(db: Database.Database, dedupKey: string): boolean {
  const row = db.prepare('SELECT 1 FROM items WHERE dedup_key = ?').get(dedupKey);
  return row !== undefined;
}

export function findByContentHash(db: Database.Database, contentHash: string): string | null {
  if (!contentHash) return null;
  const row = db.prepare('SELECT id FROM items WHERE content_hash = ? LIMIT 1').get(contentHash) as
    | { id: string }
    | undefined;
  return row?.id ?? null;
}

export function getItem(db: Database.Database, id: string): Item | undefined {
  return db.prepare('SELECT * FROM items WHERE id = ?').get(id) as Item | undefined;
}

export function getItemsBySource(
  db: Database.Database,
  sourceId: string,
  opts: { limit?: number } = {},
): Item[] {
  const limit = opts.limit ? `LIMIT ${opts.limit}` : '';
  return db
    .prepare(`SELECT * FROM items WHERE source_id = ? ORDER BY published_at DESC ${limit}`)
    .all(sourceId) as Item[];
}

export function getSourceItemCounts(
  db: Database.Database,
): Array<{ source_id: string; count: number }> {
  return db
    .prepare('SELECT source_id, COUNT(*) as count FROM items GROUP BY source_id')
    .all() as Array<{ source_id: string; count: number }>;
}

export function getRecentItems(
  db: Database.Database,
  opts: { days?: number; limit?: number } = {},
): Item[] {
  const days = opts.days ?? 3;
  const limit = opts.limit ?? 1000;
  return db
    .prepare(
      `SELECT * FROM items
       WHERE fetched_at >= datetime('now', ?)
       ORDER BY published_at DESC
       LIMIT ?`,
    )
    .all(`-${days} days`, limit) as Item[];
}
