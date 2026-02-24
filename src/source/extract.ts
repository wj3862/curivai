import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { franc } from 'franc-min';
import { generateContentHash } from './dedup.js';
import { logger } from '../shared/logger.js';

export interface ExtractionResult {
  content_text: string;
  word_count: number;
  read_time_min: number;
  lang: string | null;
  content_hash: string;
}

/**
 * Strip HTML tags and decode common entities.
 */
export function stripHtml(html: string): string {
  // Remove script/style blocks
  let text = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
  // Remove all HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Decode common entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

/**
 * Detect language from text. Maps ISO 639-3 to short codes.
 */
export function detectLanguage(text: string): string | null {
  if (!text || text.length < 20) return null;

  const iso3 = franc(text);
  if (iso3 === 'und') return null;

  const map: Record<string, string> = {
    eng: 'en',
    cmn: 'zh',
    zho: 'zh',
    jpn: 'ja',
    kor: 'ko',
    fra: 'fr',
    deu: 'de',
    spa: 'es',
    por: 'pt',
    rus: 'ru',
    ara: 'ar',
  };

  return map[iso3] ?? iso3;
}

// CJK character range (common CJK unified ideographs)
const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;

/**
 * Count words. Uses whitespace split for Latin, character count for CJK.
 */
export function countWords(text: string): number {
  if (!text) return 0;

  if (CJK_REGEX.test(text)) {
    // For CJK: count CJK characters + split non-CJK words
    const cjkChars = text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) ?? [];
    const latinWords = text
      .replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 0);
    return cjkChars.length + latinWords.length;
  }

  // Latin text: simple whitespace split
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

/**
 * Extract article content from URL, falling back to RSS content.
 * Never throws — returns best available content.
 */
export async function extractContent(
  url: string,
  rssContent: string | undefined,
  options: { timeoutMs?: number; userAgent?: string } = {},
): Promise<ExtractionResult> {
  const { timeoutMs = 15000, userAgent = 'CurivAI/1.0' } = options;

  let text = '';

  // Try fetching and extracting from the article URL
  try {
    const controller = new AbortController();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Request timeout after ${timeoutMs}ms`)), timeoutMs),
    );

    const response = await Promise.race([
      fetch(url, {
        headers: {
          'User-Agent': userAgent,
          Accept: 'text/html',
        },
        signal: controller.signal,
        redirect: 'follow',
      }),
      timeoutPromise,
    ]);

    if (response.ok) {
      const html = await response.text();
      const dom = new JSDOM(html, { url });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();

      if (article?.textContent) {
        text = article.textContent.replace(/\s+/g, ' ').trim();
      }
    }
  } catch (err) {
    logger.debug({ url, error: err instanceof Error ? err.message : String(err) }, 'Article fetch failed, using RSS content');
  }

  // Fallback to RSS content
  if (!text && rssContent) {
    text = stripHtml(rssContent);
  }

  const word_count = countWords(text);
  const read_time_min = Math.max(1, Math.ceil(word_count / 250));
  const lang = detectLanguage(text);
  const content_hash = text ? generateContentHash(text) : '';

  return {
    content_text: text,
    word_count,
    read_time_min,
    lang,
    content_hash,
  };
}
