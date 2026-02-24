import type Database from 'better-sqlite3';
import type { Config } from '../shared/config.js';
import type { Source, RawItem } from './adapter.js';
import { RssAdapter } from './rss.js';
import { generateDedupKey, generateContentHash } from './dedup.js';
import { extractContent } from './extract.js';
import {
  listSources,
  insertItem,
  dedupKeyExists,
  findByContentHash,
  updateSource,
} from './sourceDb.js';
import { nowISO } from '../shared/utils.js';
import { logger } from '../shared/logger.js';

export interface IngestOptions {
  limit?: number;
  sinceHours?: number;
  concurrency?: number;
  sourceIds?: string[];
  skipExtract?: boolean;
}

export interface IngestStats {
  sourcesProcessed: number;
  sourcesFailed: number;
  itemsFetched: number;
  itemsNew: number;
  itemsDuplicate: number;
  itemsContentDuplicate: number;
  errors: Array<{ source: string; error: string }>;
  durationMs: number;
}

/**
 * Simple concurrency limiter.
 */
async function withConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers: Promise<void>[] = [];

  for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          if (item !== undefined) {
            await fn(item);
          }
        }
      })(),
    );
  }

  await Promise.all(workers);
}

export async function runIngest(
  db: Database.Database,
  config: Config,
  options: IngestOptions = {},
): Promise<IngestStats> {
  const startTime = Date.now();
  const limit = options.limit ?? 1000;
  const concurrency = options.concurrency ?? config.ingest.default_concurrency;
  const skipExtract = options.skipExtract ?? false;

  const stats: IngestStats = {
    sourcesProcessed: 0,
    sourcesFailed: 0,
    itemsFetched: 0,
    itemsNew: 0,
    itemsDuplicate: 0,
    itemsContentDuplicate: 0,
    errors: [],
    durationMs: 0,
  };

  // Get sources to process
  let sources = listSources(db, { activeOnly: true });
  if (options.sourceIds && options.sourceIds.length > 0) {
    const idSet = new Set(options.sourceIds);
    sources = sources.filter((s) => idSet.has(s.id));
  }

  if (sources.length === 0) {
    logger.info('No active sources to ingest');
    stats.durationMs = Date.now() - startTime;
    return stats;
  }

  // Filter by sinceHours if specified
  if (options.sinceHours) {
    const cutoff = new Date(Date.now() - options.sinceHours * 3600 * 1000).toISOString();
    sources = sources.filter((s) => !s.last_fetched_at || s.last_fetched_at < cutoff);
  }

  const adapter = new RssAdapter(config.ingest.fetch_timeout_ms, config.ingest.user_agent);
  let totalNew = 0;

  await withConcurrency(sources, concurrency, async (source: Source) => {
    if (totalNew >= limit) return;

    try {
      const fetchResult = await adapter.fetch(source);
      stats.sourcesProcessed++;
      stats.itemsFetched += fetchResult.items.length;

      // Update source metadata
      updateSource(db, source.id, {
        last_fetched_at: nowISO(),
        etag: fetchResult.etag ?? null,
        last_modified: fetchResult.lastModified ?? null,
      });

      // Process each item
      for (const rawItem of fetchResult.items) {
        if (totalNew >= limit) break;

        await processItem(db, config, source, rawItem, skipExtract, stats);
        if (stats.itemsNew > totalNew) {
          totalNew = stats.itemsNew;
        }
      }
    } catch (err) {
      stats.sourcesFailed++;
      const errorMsg = err instanceof Error ? err.message : String(err);
      stats.errors.push({ source: source.url, error: errorMsg });
      logger.warn({ source: source.url, error: errorMsg }, 'Source fetch failed');
    }
  });

  stats.durationMs = Date.now() - startTime;
  logger.info(
    {
      sourcesProcessed: stats.sourcesProcessed,
      itemsNew: stats.itemsNew,
      itemsDuplicate: stats.itemsDuplicate,
      durationMs: stats.durationMs,
    },
    'Ingest complete',
  );

  return stats;
}

async function processItem(
  db: Database.Database,
  config: Config,
  source: Source,
  rawItem: RawItem,
  skipExtract: boolean,
  stats: IngestStats,
): Promise<void> {
  // Generate dedup key
  const dedupKey = generateDedupKey({
    guid: rawItem.guid,
    title: rawItem.title,
    url: rawItem.url,
    canonical_url: rawItem.canonical_url,
    published_at: rawItem.published_at,
    domain: rawItem.domain,
  });

  // Check dedup
  if (dedupKeyExists(db, dedupKey)) {
    stats.itemsDuplicate++;
    return;
  }

  // Content extraction
  let contentText: string | null = null;
  let wordCount: number | null = null;
  let readTimeMin: number | null = null;
  let lang: string | null = null;
  let contentHash: string | null = null;
  let isDuplicate = 0;

  if (!skipExtract) {
    const extraction = await extractContent(rawItem.url, rawItem.content_html ?? rawItem.raw_excerpt, {
      timeoutMs: config.ingest.fetch_timeout_ms,
      userAgent: config.ingest.user_agent,
    });

    contentText = extraction.content_text || null;
    wordCount = extraction.word_count;
    readTimeMin = extraction.read_time_min;
    lang = extraction.lang;
    contentHash = extraction.content_hash || null;

    // Cross-source content dedup
    if (contentHash) {
      const existingId = findByContentHash(db, contentHash);
      if (existingId) {
        isDuplicate = 1;
        stats.itemsContentDuplicate++;
      }
    }
  } else {
    // Minimal processing without extraction
    if (rawItem.content_html || rawItem.raw_excerpt) {
      const text = rawItem.raw_excerpt ?? '';
      contentText = text;
      contentHash = text ? generateContentHash(text) : null;
    }
  }

  // Insert item
  const itemId = insertItem(db, {
    source_id: source.id,
    guid: rawItem.guid ?? null,
    title: rawItem.title,
    url: rawItem.url,
    canonical_url: rawItem.canonical_url ?? null,
    dedup_key: dedupKey,
    author: rawItem.author ?? null,
    published_at: rawItem.published_at ?? null,
    raw_excerpt: rawItem.raw_excerpt ?? null,
    lang,
    word_count: wordCount,
    read_time_min: readTimeMin,
    content_text: contentText,
    content_hash: contentHash,
    is_duplicate: isDuplicate,
  });

  if (itemId) {
    stats.itemsNew++;
  } else {
    stats.itemsDuplicate++;
  }
}
