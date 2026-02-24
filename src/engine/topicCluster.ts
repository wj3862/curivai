import { getDb } from '../db/db.js';
import type { Config } from '../shared/config.js';
import { logger } from '../shared/logger.js';

/**
 * Normalize a topic string for comparison.
 */
function normalizeTopic(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^\u4e00-\u9fff\u3400-\u4dbfa-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tokenize a normalized topic string into a set of tokens.
 */
function tokenize(normalized: string): Set<string> {
  return new Set(normalized.split(' ').filter((t) => t.length > 0));
}

/**
 * Compute Jaccard similarity between two token sets.
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  return intersection.size / union.size;
}

interface ScorePackRow {
  item_id: string;
  topic: string;
}

/**
 * Build a map of item_id → topic penalty for items whose topic
 * duplicates a recently scored topic for this persona.
 *
 * Called AFTER ScorePack Lite results are stored, to penalize
 * subsequent items on the next cheap filter run.
 */
export function buildTopicPenalties(
  personaName: string,
  config: Config['scoring'],
): Map<string, number> {
  const db = getDb();
  const { lookback_days, exact_penalty, fuzzy_threshold, fuzzy_penalty } = config.topic_dedup;

  const since = new Date();
  since.setDate(since.getDate() - lookback_days);

  const rows = db
    .prepare(
      `SELECT item_id, topic FROM score_packs
       WHERE persona_name = ?
         AND topic IS NOT NULL
         AND created_at >= ?
       ORDER BY created_at DESC`,
    )
    .all(personaName, since.toISOString()) as ScorePackRow[];

  if (rows.length === 0) return new Map();

  // Build unique topic list (first occurrence wins)
  const seenTopics: Array<{ normalized: string; tokens: Set<string> }> = [];
  const penalties = new Map<string, number>();

  for (const row of rows) {
    const normalized = normalizeTopic(row.topic);
    const tokens = tokenize(normalized);

    let maxSimilarity = 0;
    for (const seen of seenTopics) {
      if (seen.normalized === normalized) {
        maxSimilarity = 1;
        break;
      }
      const j = jaccardSimilarity(tokens, seen.tokens);
      if (j > maxSimilarity) maxSimilarity = j;
    }

    if (maxSimilarity === 1) {
      // Exact match → strong penalty
      penalties.set(row.item_id, -exact_penalty);
    } else if (maxSimilarity >= fuzzy_threshold) {
      // Fuzzy match → moderate penalty
      penalties.set(row.item_id, -fuzzy_penalty);
    } else {
      // New topic → no penalty, add to seen list
      seenTopics.push({ normalized, tokens });
    }
  }

  logger.debug(
    { persona: personaName, total: rows.length, penalized: penalties.size },
    'TopicCluster penalties built',
  );

  return penalties;
}

/**
 * Check if a NEW topic matches any recently seen topic for a persona.
 * Returns the penalty to apply (0 = no match).
 */
export function checkTopicDuplicate(
  newTopic: string,
  personaName: string,
  config: Config['scoring'],
): number {
  const db = getDb();
  const { lookback_days, exact_penalty, fuzzy_threshold, fuzzy_penalty } = config.topic_dedup;

  const since = new Date();
  since.setDate(since.getDate() - lookback_days);

  const rows = db
    .prepare(
      `SELECT topic FROM score_packs
       WHERE persona_name = ?
         AND topic IS NOT NULL
         AND created_at >= ?
       ORDER BY created_at DESC`,
    )
    .all(personaName, since.toISOString()) as Array<{ topic: string }>;

  if (rows.length === 0) return 0;

  const newNorm = normalizeTopic(newTopic);
  const newTokens = tokenize(newNorm);

  for (const row of rows) {
    const existingNorm = normalizeTopic(row.topic);
    if (existingNorm === newNorm) return -exact_penalty;

    const existingTokens = tokenize(existingNorm);
    const j = jaccardSimilarity(newTokens, existingTokens);
    if (j >= fuzzy_threshold) return -fuzzy_penalty;
  }

  return 0;
}
