import { describe, it, expect } from 'vitest';
import { normalizeUrl, generateDedupKey, generateContentHash } from '../dedup.js';

describe('normalizeUrl', () => {
  it('strips trailing slashes', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com');
    expect(normalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
  });

  it('removes www. prefix', () => {
    expect(normalizeUrl('https://www.example.com/path')).toBe('https://example.com/path');
  });

  it('lowercases scheme and host', () => {
    expect(normalizeUrl('HTTPS://Example.COM/Path')).toBe('https://example.com/Path');
  });

  it('removes tracking params', () => {
    expect(normalizeUrl('https://example.com/p?utm_source=twitter&utm_medium=cpc&id=1')).toBe(
      'https://example.com/p?id=1',
    );
  });

  it('removes fbclid and gclid', () => {
    expect(normalizeUrl('https://example.com/?fbclid=abc&gclid=def')).toBe(
      'https://example.com',
    );
  });

  it('sorts remaining query params', () => {
    expect(normalizeUrl('https://example.com?z=1&a=2')).toBe('https://example.com?a=2&z=1');
  });

  it('strips hash', () => {
    expect(normalizeUrl('https://example.com/page#section')).toBe('https://example.com/page');
  });

  it('handles invalid URLs gracefully', () => {
    expect(normalizeUrl('not a url')).toBe('not a url');
  });

  it('preserves port numbers', () => {
    expect(normalizeUrl('https://example.com:8080/path/')).toBe(
      'https://example.com:8080/path',
    );
  });
});

describe('generateDedupKey', () => {
  it('uses guid when present', () => {
    const key = generateDedupKey({
      guid: 'abc-123',
      title: 'Test',
      url: 'https://example.com',
    });
    expect(key).toBe('guid:abc-123');
  });

  it('falls back to canonical_url when no guid', () => {
    const key = generateDedupKey({
      title: 'Test',
      url: 'https://example.com/page',
      canonical_url: 'https://www.example.com/page/',
    });
    expect(key).toBe('url:https://example.com/page');
  });

  it('falls back to hash when no guid or canonical_url', () => {
    const key = generateDedupKey({
      title: 'Test Article',
      url: 'https://example.com/test',
      published_at: '2024-01-01',
      domain: 'example.com',
    });
    expect(key).toMatch(/^hash:[a-f0-9]{40}$/);
  });

  it('produces different hashes for different titles', () => {
    const key1 = generateDedupKey({
      title: 'Article A',
      url: 'https://example.com/a',
      domain: 'example.com',
    });
    const key2 = generateDedupKey({
      title: 'Article B',
      url: 'https://example.com/b',
      domain: 'example.com',
    });
    expect(key1).not.toBe(key2);
  });

  it('produces same hash for same inputs', () => {
    const input = {
      title: 'Consistent',
      url: 'https://example.com',
      published_at: '2024-06-01',
      domain: 'example.com',
    };
    expect(generateDedupKey(input)).toBe(generateDedupKey(input));
  });
});

describe('generateContentHash', () => {
  it('returns a sha1 hex string', () => {
    const hash = generateContentHash('Hello world');
    expect(hash).toMatch(/^[a-f0-9]{40}$/);
  });

  it('produces same hash for same content', () => {
    expect(generateContentHash('same')).toBe(generateContentHash('same'));
  });

  it('produces different hashes for different content', () => {
    expect(generateContentHash('foo')).not.toBe(generateContentHash('bar'));
  });
});
