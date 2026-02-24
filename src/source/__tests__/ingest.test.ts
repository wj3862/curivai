import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../db/migrate.js';
import { addSource, listSources, getItemsBySource, getSource } from '../sourceDb.js';
import { runIngest } from '../ingest.js';
import type { Config } from '../../shared/config.js';
import { ConfigSchema } from '../../shared/config.js';

const RSS_FEED = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Test</title>
  <item>
    <title>Article A</title>
    <link>https://example.com/a</link>
    <guid>guid-a</guid>
    <description>Content A for testing</description>
  </item>
  <item>
    <title>Article B</title>
    <link>https://example.com/b</link>
    <guid>guid-b</guid>
    <description>Content B for testing</description>
  </item>
  <item>
    <title>Article C</title>
    <link>https://example.com/c</link>
    <guid>guid-c</guid>
    <description>Content C for testing</description>
  </item>
</channel></rss>`;

let db: Database.Database;
let config: Config;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  config = ConfigSchema.parse({});

  // Mock global fetch for both RSS and article fetches
  globalThis.fetch = vi.fn().mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('/feed')) {
      return Promise.resolve(new Response(RSS_FEED, { status: 200 }));
    }
    // For article fetches, return 404 so it falls back to RSS content
    return Promise.resolve(new Response('Not Found', { status: 404 }));
  });
});

afterEach(() => {
  db.close();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('runIngest', () => {
  it('ingests items from sources', async () => {
    addSource(db, { url: 'https://example.com/feed', title: 'Test Feed' });

    const stats = await runIngest(db, config, { skipExtract: true });

    expect(stats.sourcesProcessed).toBe(1);
    expect(stats.itemsNew).toBe(3);
    expect(stats.sourcesFailed).toBe(0);
  });

  it('deduplicates items on re-run', async () => {
    addSource(db, { url: 'https://example.com/feed' });

    await runIngest(db, config, { skipExtract: true });
    const stats2 = await runIngest(db, config, { skipExtract: true });

    expect(stats2.itemsNew).toBe(0);
    expect(stats2.itemsDuplicate).toBe(3);
  });

  it('respects limit', async () => {
    addSource(db, { url: 'https://example.com/feed' });

    const stats = await runIngest(db, config, { limit: 2, skipExtract: true });

    expect(stats.itemsNew).toBeLessThanOrEqual(2);
  });

  it('handles failed sources gracefully', async () => {
    addSource(db, { url: 'https://good.com/feed' });
    addSource(db, { url: 'https://bad.com/feed' });

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('bad.com')) {
        return Promise.resolve(new Response('Server Error', { status: 500 }));
      }
      return Promise.resolve(new Response(RSS_FEED, { status: 200 }));
    });

    const stats = await runIngest(db, config, { skipExtract: true });

    expect(stats.sourcesProcessed).toBe(1);
    expect(stats.sourcesFailed).toBe(1);
    expect(stats.errors).toHaveLength(1);
    expect(stats.errors[0].source).toContain('bad.com');
    // Good source still processed
    expect(stats.itemsNew).toBe(3);
  });

  it('updates source metadata after fetch', async () => {
    const srcId = addSource(db, { url: 'https://example.com/feed' })!;

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(RSS_FEED, {
        status: 200,
        headers: { ETag: '"etag-new"', 'Last-Modified': 'Mon, 01 Jan 2024 00:00:00 GMT' },
      }),
    );

    await runIngest(db, config, { skipExtract: true });

    const source = getSource(db, srcId)!;
    expect(source.etag).toBe('"etag-new"');
    expect(source.last_fetched_at).toBeTruthy();
  });

  it('returns zero stats with no sources', async () => {
    const stats = await runIngest(db, config);
    expect(stats.sourcesProcessed).toBe(0);
    expect(stats.itemsNew).toBe(0);
  });

  it('filters sources by sourceIds', async () => {
    const src1 = addSource(db, { url: 'https://a.com/feed' })!;
    addSource(db, { url: 'https://b.com/feed' });

    const stats = await runIngest(db, config, {
      sourceIds: [src1],
      skipExtract: true,
    });

    expect(stats.sourcesProcessed).toBe(1);
    // Only items from source a.com
    const items = getItemsBySource(db, src1);
    expect(items.length).toBeGreaterThan(0);
  });

  it('only processes active sources', async () => {
    const srcId = addSource(db, { url: 'https://example.com/feed' })!;
    // Deactivate the source
    db.prepare('UPDATE sources SET is_active = 0 WHERE id = ?').run(srcId);

    const stats = await runIngest(db, config, { skipExtract: true });
    expect(stats.sourcesProcessed).toBe(0);
    expect(stats.itemsNew).toBe(0);
  });

  it('tracks duration', async () => {
    addSource(db, { url: 'https://example.com/feed' });
    const stats = await runIngest(db, config, { skipExtract: true });
    expect(stats.durationMs).toBeGreaterThanOrEqual(0);
  });
});
