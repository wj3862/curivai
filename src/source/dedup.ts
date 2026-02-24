import { sha1 } from '../shared/utils.js';

/**
 * Normalize a URL for dedup comparison:
 * - Strip trailing slashes
 * - Remove www. prefix
 * - Remove common tracking params (utm_*, ref, source, etc.)
 * - Sort remaining query params
 * - Lowercase scheme + host
 */
export function normalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // If invalid URL, return as-is trimmed
    return raw.trim();
  }

  // Lowercase scheme + host
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();

  // Strip www.
  if (url.hostname.startsWith('www.')) {
    url.hostname = url.hostname.slice(4);
  }

  // Remove tracking params
  const trackingPrefixes = ['utm_', 'ref', 'source', 'fbclid', 'gclid', 'mc_', 'mkt_'];
  const keysToRemove: string[] = [];
  for (const key of url.searchParams.keys()) {
    if (trackingPrefixes.some((p) => key.toLowerCase().startsWith(p))) {
      keysToRemove.push(key);
    }
  }
  for (const key of keysToRemove) {
    url.searchParams.delete(key);
  }

  // Sort remaining params
  url.searchParams.sort();

  // Build clean URL (strip trailing slashes from pathname)
  let pathname = url.pathname;
  while (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }
  // If pathname is just "/", treat as empty (root)
  if (pathname === '/') {
    pathname = '';
  }

  // Remove hash
  url.hash = '';

  const search = url.searchParams.toString();
  return `${url.protocol}//${url.hostname}${url.port ? ':' + url.port : ''}${pathname}${search ? '?' + search : ''}`;
}

export interface DedupInput {
  guid?: string;
  title: string;
  url: string;
  canonical_url?: string;
  published_at?: string;
  domain?: string;
}

/**
 * Generate dedup key with priority: guid > canonical_url > hash(title+date+domain).
 */
export function generateDedupKey(item: DedupInput): string {
  if (item.guid) {
    return `guid:${item.guid}`;
  }
  if (item.canonical_url) {
    return `url:${normalizeUrl(item.canonical_url)}`;
  }
  return `hash:${sha1(item.title + (item.published_at ?? '') + (item.domain ?? ''))}`;
}

/**
 * Generate content hash for cross-source dedup.
 */
export function generateContentHash(text: string): string {
  return sha1(text);
}
