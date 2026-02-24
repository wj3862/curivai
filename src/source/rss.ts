import Parser from 'rss-parser';
import type { SourceAdapter, Source, RawItem, FetchResult } from './adapter.js';
import { SourceError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';

const parser = new Parser({
  timeout: 30000,
  customFields: {
    item: [['content:encoded', 'contentEncoded']],
  },
});

export class RssAdapter implements SourceAdapter {
  readonly type = 'rss';

  constructor(
    private readonly timeoutMs: number = 15000,
    private readonly userAgent: string = 'CurivAI/1.0',
  ) {}

  async fetch(source: Source): Promise<FetchResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        'User-Agent': this.userAgent,
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      };
      if (source.etag) {
        headers['If-None-Match'] = source.etag;
      }
      if (source.last_modified) {
        headers['If-Modified-Since'] = source.last_modified;
      }

      const response = await fetch(source.url, {
        headers,
        signal: controller.signal,
        redirect: 'follow',
      });

      // 304 Not Modified — no new content
      if (response.status === 304) {
        logger.debug({ source: source.url }, 'RSS 304 Not Modified');
        return { items: [], etag: source.etag ?? undefined, lastModified: source.last_modified ?? undefined };
      }

      if (!response.ok) {
        throw new SourceError(
          `Feed fetch failed: ${response.status} from ${source.site_domain ?? source.url}`,
          { url: source.url, status: response.status, etag: source.etag },
        );
      }

      const xml = await response.text();
      const feed = await parser.parseString(xml);

      const newEtag = response.headers.get('etag') ?? undefined;
      const newLastModified = response.headers.get('last-modified') ?? undefined;

      const items: RawItem[] = [];
      for (const entry of feed.items ?? []) {
        const title = entry.title?.trim();
        const url = entry.link?.trim();
        if (!title || !url) continue;

        let domain: string | undefined;
        try {
          domain = new URL(url).hostname.replace(/^www\./, '');
        } catch {
          // skip invalid URL
        }

        const entryAny = entry as unknown as Record<string, unknown>;
        items.push({
          guid: (entryAny['guid'] as string | undefined) ?? (entryAny['id'] as string | undefined),
          title,
          url,
          canonical_url: entry.link ?? undefined,
          author: (entry.creator as string | undefined) ?? (entryAny['dc:creator'] as string | undefined),
          published_at: entry.isoDate ?? entry.pubDate ?? undefined,
          raw_excerpt: entry.contentSnippet?.slice(0, 500) ?? undefined,
          content_html:
            (entryAny['contentEncoded'] as string | undefined) ??
            (entry.content as string | undefined),
          domain,
        });
      }

      logger.debug({ source: source.url, count: items.length }, 'RSS fetched');
      return { items, etag: newEtag, lastModified: newLastModified };
    } catch (err) {
      if (err instanceof SourceError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new SourceError(`Feed fetch timed out after ${this.timeoutMs}ms: ${source.url}`, {
          url: source.url,
          timeout: this.timeoutMs,
        });
      }
      throw new SourceError(
        `Feed fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        { url: source.url },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async extract(_item: RawItem): Promise<string> {
    // Content extraction is handled by src/source/extract.ts
    // This method exists for the SourceAdapter interface
    return _item.content_html ?? _item.raw_excerpt ?? '';
  }
}
