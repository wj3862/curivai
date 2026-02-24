import { createHash } from 'node:crypto';
import type { Persona } from '../persona/schema.js';
import type { Config } from '../shared/config.js';
import { getDb } from '../db/db.js';
import { logger } from '../shared/logger.js';
import { generateId, nowISO } from '../shared/utils.js';

export interface CheapFactors {
  freshness: number;
  keyword_match: number;
  source_trust: number;
  language_match: number;
  length_sanity: number;
  duplicate_penalty: number;
  topic_duplicate: number;
}

export interface CheapScoreResult {
  item_id: string;
  cheap_score: number;
  factors: CheapFactors;
}

interface DbItem {
  id: string;
  title: string;
  raw_excerpt: string | null;
  lang: string | null;
  word_count: number | null;
  published_at: string | null;
  site_domain: string | null;
  is_duplicate: number;
}

/**
 * Compute cheap_version string from scoring weights config.
 */
export function computeCheapVersion(weights: Config['scoring']['cheap_weights']): string {
  const hash = createHash('sha1')
    .update(JSON.stringify(weights))
    .digest('hex')
    .slice(0, 8);
  return `cheap_v1_${hash}`;
}

/**
 * Compute freshness score (0-100) with exponential decay by hours since published.
 * Fresh (<6h) = 100, 1 day = ~80, 3 days = ~60, 7 days = ~30, older = ~10
 */
function computeFreshness(publishedAt: string | null): number {
  if (!publishedAt) return 50;
  const ageMs = Date.now() - new Date(publishedAt).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  if (ageHours < 0) return 80; // future date → treat as fresh
  // Exponential decay: score = 100 * e^(-0.01 * hours)
  return Math.max(5, Math.round(100 * Math.exp(-0.01 * ageHours)));
}

/**
 * Compute keyword match score (0-100).
 * Checks title + excerpt against persona positive/negative keyword lists.
 */
function computeKeywordMatch(
  title: string,
  excerpt: string | null,
  persona: Persona,
): number {
  const text = `${title} ${excerpt ?? ''}`.toLowerCase();
  const posKeywords = persona.signals.positive.keywords;
  const negKeywords = persona.signals.negative.keywords;

  let posHits = 0;
  for (const kw of posKeywords) {
    if (text.includes(kw.toLowerCase())) posHits++;
  }

  let negHits = 0;
  for (const kw of negKeywords) {
    if (text.includes(kw.toLowerCase())) negHits++;
  }

  if (negHits > 0) return Math.max(0, 30 - negHits * 15);

  if (posKeywords.length === 0) return 50;
  const ratio = posHits / posKeywords.length;
  // Scale: 0 hits → 20, 1 hit → ~40, 2+ → higher
  return Math.min(100, Math.round(20 + ratio * 80 + Math.min(posHits, 3) * 10));
}

/**
 * Compute source trust score (0-100) based on persona domain signals.
 */
function computeSourceTrust(domain: string | null, persona: Persona): number {
  if (!domain) return 50;
  const posDomains = persona.signals.positive.domains.map((d) => d.toLowerCase());
  const negDomains = persona.signals.negative.domains.map((d) => d.toLowerCase());
  const d = domain.toLowerCase();

  if (negDomains.some((nd) => d.includes(nd))) return 10;
  if (posDomains.some((pd) => d.includes(pd))) return 90;
  return 50;
}

/**
 * Compute language match (0 or 100).
 */
function computeLanguageMatch(lang: string | null, persona: Persona): number {
  if (!lang) return 50;
  return persona.constraints.allow_languages.includes(lang) ? 100 : 0;
}

/**
 * Compute length sanity score (0-100).
 * Penalize very short or absurdly long articles.
 */
function computeLengthSanity(wordCount: number | null, minWordCount: number): number {
  if (wordCount === null) return 50;
  if (wordCount < minWordCount) {
    return Math.max(0, Math.round((wordCount / minWordCount) * 60));
  }
  if (wordCount > 10000) return 70; // very long articles get slight penalty
  return 100;
}

/**
 * Run cheap filter for a persona on items from the last N days.
 * Returns candidates sorted by cheap_score DESC.
 */
export function runCheapFilter(
  persona: Persona,
  config: Config['scoring'],
  days: number,
  topicPenalties: Map<string, number> = new Map(),
): CheapScoreResult[] {
  const db = getDb();
  const weights = config.cheap_weights;
  const cheapVersion = computeCheapVersion(weights);

  const since = new Date();
  since.setDate(since.getDate() - days);

  // Load items within window, with max_age_days constraint
  const maxAge = persona.constraints.max_age_days;
  const effectiveDays = Math.min(days, maxAge);
  const effectiveSince = new Date();
  effectiveSince.setDate(effectiveSince.getDate() - effectiveDays);

  const items = db
    .prepare(
      `SELECT i.id, i.title, i.raw_excerpt, i.lang, i.word_count, i.published_at, i.is_duplicate,
              s.site_domain
       FROM items i
       LEFT JOIN sources s ON i.source_id = s.id
       WHERE i.published_at >= ?
         AND s.is_active = 1
       ORDER BY i.published_at DESC`,
    )
    .all(effectiveSince.toISOString()) as DbItem[];

  logger.debug({ persona: persona.meta.name, itemCount: items.length, days: effectiveDays }, 'CheapFilter: loaded items');

  const results: CheapScoreResult[] = [];

  for (const item of items) {
    const freshness = computeFreshness(item.published_at);
    const keyword_match = computeKeywordMatch(item.title, item.raw_excerpt, persona);
    const source_trust = computeSourceTrust(item.site_domain, persona);
    const language_match = computeLanguageMatch(item.lang, persona);
    const length_sanity = computeLengthSanity(item.word_count, persona.constraints.min_word_count);
    const duplicate_penalty = item.is_duplicate ? -50 : 0;
    const topic_duplicate = topicPenalties.get(item.id) ?? 0;

    const factors: CheapFactors = {
      freshness,
      keyword_match,
      source_trust,
      language_match,
      length_sanity,
      duplicate_penalty,
      topic_duplicate,
    };

    // Weighted sum (duplicate_penalty and topic_duplicate are additive penalties)
    const baseScore =
      freshness * weights.freshness +
      keyword_match * weights.keyword_match +
      source_trust * weights.source_trust +
      language_match * weights.language_match +
      length_sanity * weights.length_sanity;

    const cheap_score = Math.max(0, Math.min(100, Math.round(baseScore + duplicate_penalty + topic_duplicate)));

    results.push({ item_id: item.id, cheap_score, factors });
  }

  // Sort by score descending
  results.sort((a, b) => b.cheap_score - a.cheap_score);

  // Apply threshold + fallback
  let candidates = results.filter((r) => r.cheap_score >= config.cheap_threshold);

  if (candidates.length < config.min_candidates) {
    candidates = results.slice(0, Math.max(config.min_candidates, candidates.length));
  }

  // Persist cheap scores to DB
  const upsert = db.prepare(`
    INSERT INTO cheap_scores (id, item_id, persona_name, cheap_score, factors_json, cheap_version, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(item_id, persona_name, cheap_version) DO UPDATE SET
      cheap_score = excluded.cheap_score,
      factors_json = excluded.factors_json
  `);

  const upsertMany = db.transaction((rows: CheapScoreResult[]) => {
    for (const r of rows) {
      upsert.run(
        generateId(),
        r.item_id,
        persona.meta.name,
        r.cheap_score,
        JSON.stringify(r.factors),
        cheapVersion,
        nowISO(),
      );
    }
  });

  upsertMany(results); // persist all, not just candidates

  logger.debug(
    {
      persona: persona.meta.name,
      total: results.length,
      candidates: candidates.length,
      threshold: config.cheap_threshold,
    },
    'CheapFilter complete',
  );

  return candidates;
}
