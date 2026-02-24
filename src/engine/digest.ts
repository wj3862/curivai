/**
 * Digest builder — assembles daily top picks for a persona into a structured digest.
 * Pure function: reads from DB, returns DigestData (no LLM calls, no email sending).
 */

import type Database from 'better-sqlite3';
import { logger } from '../shared/logger.js';

export interface DigestItem {
  item_id: string;
  title: string;
  cn_title: string;
  url: string;
  source_domain: string | null;
  published_at: string | null;
  score_overall: number;
  action: string;
  cn_summary_short: string;
  angle_suggestion: string | null;
  topic: string | null;
}

export interface DigestData {
  persona_name: string;
  display_name: string;
  icon: string | null;
  generated_at: string;
  days: number;
  items: DigestItem[];
  total_scored: number;
  top_count: number;
}

interface ScoreRow {
  item_id: string;
  original_title: string;
  cn_title: string;
  url: string;
  site_domain: string | null;
  published_at: string | null;
  score_overall: number;
  action: string;
  cn_summary_short: string;
  angle_suggestion: string | null;
  topic: string | null;
}

interface PersonaRow {
  name: string;
  display_name: string;
  persona_json: string;
}

/**
 * Build a digest for a persona.
 * Returns top `topN` items with action '可写' or '可提', sorted by score DESC.
 */
export function buildDigest(
  db: Database.Database,
  personaName: string,
  opts: { days?: number; topN?: number; minScore?: number } = {},
): DigestData {
  const { days = 1, topN = 10, minScore = 60 } = opts;

  const personaRow = db
    .prepare('SELECT name, display_name, persona_json FROM personas WHERE name = ?')
    .get(personaName) as PersonaRow | undefined;

  if (!personaRow) {
    throw new Error(`Persona not found: ${personaName}`);
  }

  const parsed = JSON.parse(personaRow.persona_json) as { meta?: { icon?: string } };

  const since = new Date();
  since.setDate(since.getDate() - days);

  // Total scored items in window
  const totalRow = db
    .prepare(
      `SELECT COUNT(*) as count FROM score_packs sp
       JOIN items i ON sp.item_id = i.id
       WHERE sp.persona_name = ? AND sp.llm_status = 'done'
         AND i.published_at >= ?`,
    )
    .get(personaName, since.toISOString()) as { count: number };

  // Top N items — prefer '可写', then '可提'
  const rows = db
    .prepare(
      `SELECT
         sp.item_id,
         i.title as original_title,
         sp.cn_title,
         i.url,
         s.site_domain,
         i.published_at,
         sp.score_overall,
         sp.action,
         sp.cn_summary_short,
         sp.angle_suggestion,
         sp.topic
       FROM score_packs sp
       JOIN items i ON sp.item_id = i.id
       LEFT JOIN sources s ON i.source_id = s.id
       WHERE sp.persona_name = ?
         AND sp.llm_status = 'done'
         AND sp.score_overall >= ?
         AND sp.action IN ('可写', '可提', '可转')
         AND i.published_at >= ?
       ORDER BY sp.score_overall DESC
       LIMIT ?`,
    )
    .all(personaName, minScore, since.toISOString(), topN) as ScoreRow[];

  const items: DigestItem[] = rows.map((r) => ({
    item_id: r.item_id,
    title: r.original_title,
    cn_title: r.cn_title,
    url: r.url,
    source_domain: r.site_domain,
    published_at: r.published_at,
    score_overall: r.score_overall,
    action: r.action,
    cn_summary_short: r.cn_summary_short,
    angle_suggestion: r.angle_suggestion,
    topic: r.topic,
  }));

  logger.info(
    { persona: personaName, days, total_scored: totalRow.count, top_count: items.length },
    'Digest built',
  );

  return {
    persona_name: personaName,
    display_name: personaRow.display_name,
    icon: parsed.meta?.icon ?? null,
    generated_at: new Date().toISOString(),
    days,
    items,
    total_scored: totalRow.count,
    top_count: items.length,
  };
}

/**
 * Build digests for all active personas.
 */
export function buildAllDigests(
  db: Database.Database,
  opts: { days?: number; topN?: number; minScore?: number } = {},
): DigestData[] {
  const personas = db
    .prepare('SELECT name FROM personas ORDER BY is_builtin DESC, name')
    .all() as Array<{ name: string }>;

  return personas
    .map((p) => {
      try {
        return buildDigest(db, p.name, opts);
      } catch (e) {
        logger.error({ persona: p.name, error: (e as Error).message }, 'Failed to build digest');
        return null;
      }
    })
    .filter((d): d is DigestData => d !== null);
}
