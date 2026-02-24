import { describe, it, expect, vi, afterEach } from 'vitest';
import { stripHtml, detectLanguage, countWords, extractContent } from '../extract.js';

describe('stripHtml', () => {
  it('removes HTML tags', () => {
    expect(stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('removes script and style blocks', () => {
    expect(stripHtml('<script>alert(1)</script><style>.x{}</style><p>text</p>')).toBe('text');
  });

  it('decodes common entities', () => {
    expect(stripHtml('&amp; &lt; &gt; &quot; &#39; &nbsp;')).toBe('& < > " \'');
  });

  it('collapses whitespace', () => {
    expect(stripHtml('<p>a</p>\n\n<p>b</p>')).toBe('a b');
  });

  it('handles empty string', () => {
    expect(stripHtml('')).toBe('');
  });
});

describe('detectLanguage', () => {
  it('detects English text', () => {
    const text =
      'This is a long English text about technology and innovation in the modern world of computing.';
    expect(detectLanguage(text)).toBe('en');
  });

  it('detects Chinese text', () => {
    const text = '这是一段关于科技和创新的中文文本，讨论了人工智能在现代世界的应用和发展趋势。';
    expect(detectLanguage(text)).toBe('zh');
  });

  it('returns null for very short text', () => {
    expect(detectLanguage('hi')).toBeNull();
  });

  it('returns null for empty text', () => {
    expect(detectLanguage('')).toBeNull();
  });
});

describe('countWords', () => {
  it('counts English words', () => {
    expect(countWords('Hello world foo bar')).toBe(4);
  });

  it('counts CJK characters', () => {
    expect(countWords('你好世界')).toBe(4);
  });

  it('handles mixed CJK and Latin', () => {
    const count = countWords('Hello 你好世界 world');
    // 4 CJK chars + 2 Latin words = 6
    expect(count).toBe(6);
  });

  it('handles empty string', () => {
    expect(countWords('')).toBe(0);
  });

  it('handles multiple whitespace', () => {
    expect(countWords('  a   b   c  ')).toBe(3);
  });
});

describe('extractContent', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('falls back to RSS content when fetch fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await extractContent(
      'https://example.com/article',
      '<p>RSS fallback content for testing extraction</p>',
    );

    expect(result.content_text).toBe('RSS fallback content for testing extraction');
    expect(result.word_count).toBe(6);
    expect(result.content_hash).toMatch(/^[a-f0-9]{40}$/);
  });

  it('returns empty content when both fetch and RSS fail', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await extractContent('https://example.com/article', undefined);

    expect(result.content_text).toBe('');
    expect(result.word_count).toBe(0);
    expect(result.content_hash).toBe('');
  });

  it('extracts content from HTML response', async () => {
    const html = `<html><head><title>Test</title></head>
    <body><article><p>This is the main article content about technology and innovation in the modern world.</p></article></body></html>`;

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } }),
    );

    const result = await extractContent('https://example.com/article', undefined);

    expect(result.content_text.length).toBeGreaterThan(0);
    expect(result.word_count).toBeGreaterThan(0);
    expect(result.read_time_min).toBeGreaterThanOrEqual(1);
  });

  it('falls back to RSS content on non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('Forbidden', { status: 403 }));

    const result = await extractContent(
      'https://example.com/article',
      '<p>RSS content works fine for testing</p>',
    );

    expect(result.content_text).toBe('RSS content works fine for testing');
  });

  it('respects timeout', async () => {
    const neverResolve = new Promise<Response>(() => {});
    globalThis.fetch = vi.fn().mockReturnValue(neverResolve);

    const result = await extractContent(
      'https://example.com/article',
      '<p>Fallback content after timeout for test</p>',
      { timeoutMs: 50 },
    );

    expect(result.content_text).toBe('Fallback content after timeout for test');
  });

  it('computes read_time_min as at least 1', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fail'));
    const result = await extractContent('https://example.com', '<p>Short</p>');
    expect(result.read_time_min).toBe(1);
  });
});
