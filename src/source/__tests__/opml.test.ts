import { describe, it, expect } from 'vitest';
import { parseOpml, parseBatchUrlFile } from '../opml.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SAMPLE_OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="1.0">
  <head><title>My Feeds</title></head>
  <body>
    <outline text="Tech" title="Tech">
      <outline type="rss" text="TechCrunch" title="TechCrunch" xmlUrl="https://techcrunch.com/feed/" htmlUrl="https://techcrunch.com"/>
      <outline type="rss" text="Hacker News" title="Hacker News" xmlUrl="https://hnrss.org/frontpage"/>
    </outline>
    <outline type="rss" text="Root Feed" xmlUrl="https://example.com/feed"/>
    <outline text="Nested Folder">
      <outline text="Deep Folder">
        <outline type="rss" text="Deep Feed" title="Deep Feed" xmlUrl="https://deep.example.com/feed"/>
      </outline>
    </outline>
  </body>
</opml>`;

describe('parseOpml', () => {
  it('parses all feed URLs from OPML', () => {
    const feeds = parseOpml(SAMPLE_OPML);
    expect(feeds).toHaveLength(4);
    expect(feeds.map((f) => f.url)).toContain('https://techcrunch.com/feed/');
    expect(feeds.map((f) => f.url)).toContain('https://hnrss.org/frontpage');
    expect(feeds.map((f) => f.url)).toContain('https://example.com/feed');
    expect(feeds.map((f) => f.url)).toContain('https://deep.example.com/feed');
  });

  it('extracts title from outline attributes', () => {
    const feeds = parseOpml(SAMPLE_OPML);
    const tc = feeds.find((f) => f.url === 'https://techcrunch.com/feed/');
    expect(tc!.title).toBe('TechCrunch');
  });

  it('falls back to text attribute when title missing', () => {
    const opml = `<opml version="1.0"><body>
      <outline type="rss" text="TextOnly" xmlUrl="https://a.com/feed"/>
    </body></opml>`;
    const feeds = parseOpml(opml);
    expect(feeds[0].title).toBe('TextOnly');
  });

  it('handles deeply nested folders', () => {
    const feeds = parseOpml(SAMPLE_OPML);
    const deep = feeds.find((f) => f.url === 'https://deep.example.com/feed');
    expect(deep).toBeDefined();
    expect(deep!.title).toBe('Deep Feed');
  });

  it('returns empty array for empty OPML', () => {
    const feeds = parseOpml('<opml version="1.0"><body></body></opml>');
    expect(feeds).toHaveLength(0);
  });
});

describe('parseBatchUrlFile', () => {
  it('parses newline-separated URLs', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'curivai-test-'));
    const file = path.join(tmpDir, 'urls.txt');
    fs.writeFileSync(
      file,
      `https://a.com/feed
# comment line
https://b.com/feed

https://c.com/feed
`,
    );

    const feeds = parseBatchUrlFile(file);
    expect(feeds).toHaveLength(3);
    expect(feeds.map((f) => f.url)).toEqual([
      'https://a.com/feed',
      'https://b.com/feed',
      'https://c.com/feed',
    ]);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('throws for missing file', () => {
    expect(() => parseBatchUrlFile('/nonexistent/file.txt')).toThrow('not found');
  });
});
