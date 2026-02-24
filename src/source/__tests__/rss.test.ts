import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RssAdapter } from '../rss.js';
import type { Source } from '../adapter.js';

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <link>https://example.com</link>
    <item>
      <title>Article One</title>
      <link>https://example.com/article-1</link>
      <guid>guid-1</guid>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
      <description>First article excerpt</description>
    </item>
    <item>
      <title>Article Two</title>
      <link>https://example.com/article-2</link>
      <guid>guid-2</guid>
      <description>Second article excerpt</description>
      <content:encoded><![CDATA[<p>Full content of article two</p>]]></content:encoded>
    </item>
    <item>
      <title></title>
      <link>https://example.com/no-title</link>
    </item>
    <item>
      <title>No Link</title>
    </item>
  </channel>
</rss>`;

const SAMPLE_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry>
    <title>Atom Entry</title>
    <link href="https://example.com/atom-1"/>
    <id>atom-1</id>
    <updated>2024-01-15T10:00:00Z</updated>
    <summary>Atom summary</summary>
  </entry>
</feed>`;

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: 'src-1',
    type: 'rss',
    url: 'https://example.com/feed',
    title: 'Test Feed',
    site_domain: 'example.com',
    pack_name: null,
    etag: null,
    last_modified: null,
    last_fetched_at: null,
    is_active: 1,
    created_at: '2024-01-01 00:00:00',
    ...overrides,
  };
}

describe('RssAdapter', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('parses RSS feed items correctly', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(SAMPLE_RSS, {
        status: 200,
        headers: { 'Content-Type': 'application/rss+xml' },
      }),
    );

    const adapter = new RssAdapter();
    const result = await adapter.fetch(makeSource());

    // Items without title or link are skipped
    expect(result.items).toHaveLength(2);
    expect(result.items[0].title).toBe('Article One');
    expect(result.items[0].guid).toBe('guid-1');
    expect(result.items[0].url).toBe('https://example.com/article-1');
    expect(result.items[0].raw_excerpt).toBe('First article excerpt');
    expect(result.items[0].domain).toBe('example.com');
  });

  it('parses Atom feeds', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(SAMPLE_ATOM, {
        status: 200,
        headers: { 'Content-Type': 'application/atom+xml' },
      }),
    );

    const adapter = new RssAdapter();
    const result = await adapter.fetch(makeSource());

    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe('Atom Entry');
    expect(result.items[0].url).toBe('https://example.com/atom-1');
  });

  it('handles 304 Not Modified', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 304 }));

    const adapter = new RssAdapter();
    const source = makeSource({ etag: '"abc"', last_modified: 'Mon, 01 Jan 2024 00:00:00 GMT' });
    const result = await adapter.fetch(source);

    expect(result.items).toHaveLength(0);
    expect(result.etag).toBe('"abc"');
  });

  it('sends conditional headers when etag/last_modified present', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(SAMPLE_RSS, { status: 200 }),
    );
    globalThis.fetch = mockFetch;

    const adapter = new RssAdapter();
    const source = makeSource({
      etag: '"etag-123"',
      last_modified: 'Mon, 01 Jan 2024 00:00:00 GMT',
    });

    await adapter.fetch(source);

    const callHeaders = mockFetch.mock.calls[0][1].headers;
    expect(callHeaders['If-None-Match']).toBe('"etag-123"');
    expect(callHeaders['If-Modified-Since']).toBe('Mon, 01 Jan 2024 00:00:00 GMT');
  });

  it('returns etag and last-modified from response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(SAMPLE_RSS, {
        status: 200,
        headers: {
          ETag: '"new-etag"',
          'Last-Modified': 'Tue, 02 Jan 2024 00:00:00 GMT',
        },
      }),
    );

    const adapter = new RssAdapter();
    const result = await adapter.fetch(makeSource());

    expect(result.etag).toBe('"new-etag"');
    expect(result.lastModified).toBe('Tue, 02 Jan 2024 00:00:00 GMT');
  });

  it('throws SourceError on non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 }));

    const adapter = new RssAdapter();
    await expect(adapter.fetch(makeSource())).rejects.toThrow('Feed fetch failed: 404');
  });

  it('throws SourceError on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const adapter = new RssAdapter();
    await expect(adapter.fetch(makeSource())).rejects.toThrow('Feed fetch failed: ECONNREFUSED');
  });

  it('throws SourceError on timeout', async () => {
    globalThis.fetch = vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
      // Return a promise that rejects when abort signal fires
      return new Promise<Response>((_resolve, reject) => {
        const signal = opts?.signal;
        if (signal) {
          signal.addEventListener('abort', () => {
            reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
          });
        }
      });
    });

    const adapter = new RssAdapter(50); // 50ms timeout
    await expect(adapter.fetch(makeSource())).rejects.toThrow('timed out');
  });

  it('skips items with empty title', async () => {
    const rss = `<?xml version="1.0"?>
    <rss version="2.0"><channel><title>T</title>
      <item><title>  </title><link>https://a.com</link></item>
      <item><title>Valid</title><link>https://a.com/v</link></item>
    </channel></rss>`;

    globalThis.fetch = vi.fn().mockResolvedValue(new Response(rss, { status: 200 }));

    const adapter = new RssAdapter();
    const result = await adapter.fetch(makeSource());
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe('Valid');
  });

  it('extracts domain from item URL', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(SAMPLE_RSS, { status: 200 }),
    );

    const adapter = new RssAdapter();
    const result = await adapter.fetch(makeSource());
    expect(result.items[0].domain).toBe('example.com');
  });
});
