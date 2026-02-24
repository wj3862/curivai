/**
 * Raw item from a source adapter before dedup/storage.
 */
export interface RawItem {
  guid?: string;
  title: string;
  url: string;
  canonical_url?: string;
  author?: string;
  published_at?: string;
  raw_excerpt?: string;
  content_html?: string;
  domain?: string;
}

/**
 * Database row shape for the sources table.
 */
export interface Source {
  id: string;
  type: string;
  url: string;
  title: string | null;
  site_domain: string | null;
  pack_name: string | null;
  etag: string | null;
  last_modified: string | null;
  last_fetched_at: string | null;
  is_active: number;
  created_at: string;
}

/**
 * Database row shape for the items table.
 */
export interface Item {
  id: string;
  source_id: string;
  guid: string | null;
  title: string;
  url: string;
  canonical_url: string | null;
  dedup_key: string;
  author: string | null;
  published_at: string | null;
  fetched_at: string;
  raw_excerpt: string | null;
  lang: string | null;
  word_count: number | null;
  read_time_min: number | null;
  content_text: string | null;
  content_hash: string | null;
  is_duplicate: number;
}

/**
 * Result of a source fetch operation.
 */
export interface FetchResult {
  items: RawItem[];
  etag?: string;
  lastModified?: string;
}

/**
 * Source adapter interface. Implement for each source type.
 */
export interface SourceAdapter {
  type: string;
  fetch(source: Source): Promise<FetchResult>;
  extract(item: RawItem): Promise<string>;
}
