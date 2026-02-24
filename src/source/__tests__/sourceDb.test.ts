import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../db/migrate.js';
import {
  addSource,
  listSources,
  getSource,
  getSourceByUrl,
  updateSource,
  deleteSource,
  insertItem,
  dedupKeyExists,
  findByContentHash,
  getItem,
  getItemsBySource,
  getSourceItemCounts,
} from '../sourceDb.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
});

afterEach(() => {
  db.close();
});

describe('addSource', () => {
  it('adds a source and returns id', () => {
    const id = addSource(db, { url: 'https://example.com/feed' });
    expect(id).toBeTruthy();

    const source = getSource(db, id!);
    expect(source).toBeDefined();
    expect(source!.url).toBe('https://example.com/feed');
    expect(source!.type).toBe('rss');
    expect(source!.site_domain).toBe('example.com');
  });

  it('returns null for duplicate URL', () => {
    addSource(db, { url: 'https://example.com/feed' });
    const id2 = addSource(db, { url: 'https://example.com/feed' });
    expect(id2).toBeNull();
  });

  it('stores title and pack_name', () => {
    const id = addSource(db, {
      url: 'https://example.com/feed',
      title: 'Example Feed',
      pack_name: 'tech_overseas',
    });
    const source = getSource(db, id!);
    expect(source!.title).toBe('Example Feed');
    expect(source!.pack_name).toBe('tech_overseas');
  });
});

describe('listSources', () => {
  it('lists all sources', () => {
    addSource(db, { url: 'https://a.com/feed' });
    addSource(db, { url: 'https://b.com/feed' });
    const sources = listSources(db);
    expect(sources).toHaveLength(2);
  });

  it('filters by active only', () => {
    const id = addSource(db, { url: 'https://a.com/feed' });
    addSource(db, { url: 'https://b.com/feed' });
    updateSource(db, id!, { is_active: 0 });

    const active = listSources(db, { activeOnly: true });
    expect(active).toHaveLength(1);
    expect(active[0].url).toBe('https://b.com/feed');
  });
});

describe('getSourceByUrl', () => {
  it('finds source by URL', () => {
    addSource(db, { url: 'https://example.com/feed', title: 'Found' });
    const source = getSourceByUrl(db, 'https://example.com/feed');
    expect(source).toBeDefined();
    expect(source!.title).toBe('Found');
  });

  it('returns undefined for unknown URL', () => {
    expect(getSourceByUrl(db, 'https://nope.com')).toBeUndefined();
  });
});

describe('updateSource', () => {
  it('updates source fields', () => {
    const id = addSource(db, { url: 'https://example.com/feed', title: 'Old' })!;
    const updated = updateSource(db, id, {
      title: 'New',
      etag: '"abc"',
      last_fetched_at: '2024-01-01 00:00:00',
    });
    expect(updated).toBe(true);

    const source = getSource(db, id)!;
    expect(source.title).toBe('New');
    expect(source.etag).toBe('"abc"');
  });

  it('returns false for empty updates', () => {
    const id = addSource(db, { url: 'https://example.com/feed' })!;
    expect(updateSource(db, id, {})).toBe(false);
  });
});

describe('deleteSource', () => {
  it('deletes source and its items', () => {
    const srcId = addSource(db, { url: 'https://example.com/feed' })!;
    insertItem(db, {
      source_id: srcId,
      title: 'Test',
      url: 'https://example.com/1',
      dedup_key: 'guid:test-1',
    });

    const deleted = deleteSource(db, srcId);
    expect(deleted).toBe(true);
    expect(getSource(db, srcId)).toBeUndefined();
    expect(getItemsBySource(db, srcId)).toHaveLength(0);
  });
});

describe('insertItem', () => {
  let srcId: string;

  beforeEach(() => {
    srcId = addSource(db, { url: 'https://example.com/feed' })!;
  });

  it('inserts an item and returns id', () => {
    const id = insertItem(db, {
      source_id: srcId,
      title: 'Test Article',
      url: 'https://example.com/article-1',
      dedup_key: 'guid:article-1',
    });
    expect(id).toBeTruthy();
    const item = getItem(db, id!);
    expect(item!.title).toBe('Test Article');
  });

  it('returns null for duplicate dedup_key', () => {
    insertItem(db, {
      source_id: srcId,
      title: 'First',
      url: 'https://example.com/1',
      dedup_key: 'guid:same',
    });
    const id2 = insertItem(db, {
      source_id: srcId,
      title: 'Second',
      url: 'https://example.com/2',
      dedup_key: 'guid:same',
    });
    expect(id2).toBeNull();
  });

  it('stores all fields', () => {
    const id = insertItem(db, {
      source_id: srcId,
      guid: 'guid-123',
      title: 'Full Article',
      url: 'https://example.com/full',
      canonical_url: 'https://example.com/full',
      dedup_key: 'guid:guid-123',
      author: 'Author Name',
      published_at: '2024-01-15 10:00:00',
      raw_excerpt: 'Short excerpt',
      lang: 'en',
      word_count: 500,
      read_time_min: 2,
      content_text: 'Full article text...',
      content_hash: 'abc123',
      is_duplicate: 0,
    })!;

    const item = getItem(db, id);
    expect(item!.author).toBe('Author Name');
    expect(item!.lang).toBe('en');
    expect(item!.word_count).toBe(500);
    expect(item!.content_hash).toBe('abc123');
  });
});

describe('dedupKeyExists', () => {
  it('returns true for existing key', () => {
    const srcId = addSource(db, { url: 'https://example.com/feed' })!;
    insertItem(db, {
      source_id: srcId,
      title: 'Test',
      url: 'https://example.com/1',
      dedup_key: 'guid:exists',
    });
    expect(dedupKeyExists(db, 'guid:exists')).toBe(true);
  });

  it('returns false for missing key', () => {
    expect(dedupKeyExists(db, 'guid:nope')).toBe(false);
  });
});

describe('findByContentHash', () => {
  it('finds item by content hash', () => {
    const srcId = addSource(db, { url: 'https://example.com/feed' })!;
    insertItem(db, {
      source_id: srcId,
      title: 'Test',
      url: 'https://example.com/1',
      dedup_key: 'guid:hash-test',
      content_hash: 'deadbeef',
    });
    const found = findByContentHash(db, 'deadbeef');
    expect(found).toBeTruthy();
  });

  it('returns null for unknown hash', () => {
    expect(findByContentHash(db, 'unknown')).toBeNull();
  });

  it('returns null for empty hash', () => {
    expect(findByContentHash(db, '')).toBeNull();
  });
});

describe('getSourceItemCounts', () => {
  it('returns counts per source', () => {
    const src1 = addSource(db, { url: 'https://a.com/feed' })!;
    const src2 = addSource(db, { url: 'https://b.com/feed' })!;

    insertItem(db, { source_id: src1, title: 'A1', url: 'https://a.com/1', dedup_key: 'guid:a1' });
    insertItem(db, { source_id: src1, title: 'A2', url: 'https://a.com/2', dedup_key: 'guid:a2' });
    insertItem(db, { source_id: src2, title: 'B1', url: 'https://b.com/1', dedup_key: 'guid:b1' });

    const counts = getSourceItemCounts(db);
    expect(counts).toHaveLength(2);

    const countMap = new Map(counts.map((c) => [c.source_id, c.count]));
    expect(countMap.get(src1)).toBe(2);
    expect(countMap.get(src2)).toBe(1);
  });
});
