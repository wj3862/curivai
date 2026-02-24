import { getDb } from '../db/db.js';
import { getLlmClient } from '../llm/client.js';
import { buildScorePackLiteMessages, buildScorePackFullMessages, PROMPT_VERSIONS } from '../llm/prompts.js';
import { buildScorePackLiteSchema, buildScorePackFullSchema, parseWithRetry } from '../llm/parse.js';
import { logger } from '../shared/logger.js';
import { generateId, nowISO } from '../shared/utils.js';
import { LlmError } from '../shared/errors.js';
import type { Persona } from '../persona/schema.js';
import type { CheapScoreResult } from './cheapFilter.js';

interface DbItem {
  id: string;
  title: string;
  url: string;
  lang: string | null;
  word_count: number | null;
  published_at: string | null;
  content_text: string | null;
  site_domain: string | null;
}

interface ScorePackRow {
  id: string;
  pack_level: string;
}

export interface ScorePackStats {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped_cached: number;
  total_tokens: number;
  total_cost: number;
}

/**
 * Run ScorePack Lite for a list of candidate items.
 * Skips items already scored for this persona (unless force=true).
 */
export async function runScorePackLite(
  candidates: CheapScoreResult[],
  persona: Persona,
  contentExcerptChars: number,
  force = false,
): Promise<ScorePackStats> {
  const db = getDb();
  const client = getLlmClient();
  const schema = buildScorePackLiteSchema(persona);
  const stats: ScorePackStats = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skipped_cached: 0,
    total_tokens: 0,
    total_cost: 0,
  };

  const upsert = db.prepare(`
    INSERT INTO score_packs (
      id, item_id, persona_name, pack_level,
      topic, cn_title, cn_summary_short,
      dimension_scores_json, score_overall, action,
      reasons_json, angle_suggestion,
      model, prompt_version, llm_status, token_count, created_at
    ) VALUES (?, ?, ?, 'lite', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'done', ?, ?)
    ON CONFLICT(item_id, persona_name) DO UPDATE SET
      pack_level = 'lite',
      topic = excluded.topic,
      cn_title = excluded.cn_title,
      cn_summary_short = excluded.cn_summary_short,
      dimension_scores_json = excluded.dimension_scores_json,
      score_overall = excluded.score_overall,
      action = excluded.action,
      reasons_json = excluded.reasons_json,
      angle_suggestion = excluded.angle_suggestion,
      model = excluded.model,
      prompt_version = excluded.prompt_version,
      llm_status = 'done',
      token_count = excluded.token_count
  `);

  const markFailed = db.prepare(`
    INSERT INTO score_packs (id, item_id, persona_name, pack_level, cn_title, cn_summary_short,
      dimension_scores_json, score_overall, action, reasons_json, llm_status, created_at)
    VALUES (?, ?, ?, 'lite', '', '', '{}', 0, '跳过', '[]', 'failed', ?)
    ON CONFLICT(item_id, persona_name) DO UPDATE SET llm_status = 'failed'
  `);

  for (const candidate of candidates) {
    // Check cache
    if (!force) {
      const existing = db
        .prepare(`SELECT id, pack_level FROM score_packs WHERE item_id = ? AND persona_name = ? AND llm_status = 'done'`)
        .get(candidate.item_id, persona.meta.name) as ScorePackRow | undefined;

      if (existing) {
        stats.skipped_cached++;
        continue;
      }
    }

    // Load item
    const item = db
      .prepare(
        `SELECT i.id, i.title, i.url, i.lang, i.word_count, i.published_at, i.content_text, s.site_domain
         FROM items i LEFT JOIN sources s ON i.source_id = s.id
         WHERE i.id = ?`,
      )
      .get(candidate.item_id) as DbItem | undefined;

    if (!item) continue;

    stats.attempted++;

    const excerpt = (item.content_text ?? '').slice(0, contentExcerptChars);
    const domain = item.site_domain ?? new URL(item.url).hostname;

    const messages = buildScorePackLiteMessages({
      persona,
      title: item.title,
      source_domain: domain,
      published_at: item.published_at ?? '',
      lang: item.lang,
      url: item.url,
      word_count: item.word_count ?? 0,
      content_excerpt: excerpt,
      excerpt_chars: contentExcerptChars,
    });

    try {
      const llmResponse = await client.chat(messages);
      stats.total_tokens += llmResponse.token_count;
      stats.total_cost += llmResponse.cost_estimate;

      const parsed = await parseWithRetry(schema, llmResponse.content, client, messages[0]!.content);

      upsert.run(
        generateId(),
        item.id,
        persona.meta.name,
        parsed.topic,
        parsed.cn_title,
        parsed.cn_summary_short,
        JSON.stringify(parsed.dimension_scores),
        parsed.score_overall,
        parsed.action,
        JSON.stringify(parsed.reasons),
        parsed.angle_suggestion,
        llmResponse.model,
        PROMPT_VERSIONS.scorepack_lite,
        llmResponse.token_count,
        nowISO(),
      );

      stats.succeeded++;
      logger.debug(
        { item_id: item.id, score: parsed.score_overall, action: parsed.action },
        'ScorePack Lite scored',
      );
    } catch (err) {
      stats.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ item_id: item.id, error: msg }, 'ScorePack Lite failed, marking as failed');
      markFailed.run(generateId(), item.id, persona.meta.name, nowISO());
    }
  }

  logger.info(
    {
      persona: persona.meta.name,
      ...stats,
    },
    'ScorePack Lite run complete',
  );

  return stats;
}

/**
 * Upgrade a specific item's score pack from lite to full.
 * Called when an item is added to the picked basket.
 */
export async function upgradeToFull(
  itemId: string,
  persona: Persona,
  contentExcerptChars: number,
): Promise<void> {
  const db = getDb();
  const client = getLlmClient();

  // Check if already full
  const existing = db
    .prepare(`SELECT pack_level FROM score_packs WHERE item_id = ? AND persona_name = ?`)
    .get(itemId, persona.meta.name) as { pack_level: string } | undefined;

  if (existing?.pack_level === 'full') {
    logger.debug({ item_id: itemId }, 'ScorePack already full, skipping upgrade');
    return;
  }

  const item = db
    .prepare(
      `SELECT i.id, i.title, i.url, i.lang, i.word_count, i.published_at, i.content_text, s.site_domain
       FROM items i LEFT JOIN sources s ON i.source_id = s.id
       WHERE i.id = ?`,
    )
    .get(itemId) as DbItem | undefined;

  if (!item) throw new LlmError(`Item not found: ${itemId}`);

  const schema = buildScorePackFullSchema(persona);
  const excerpt = (item.content_text ?? '').slice(0, contentExcerptChars);
  const domain = item.site_domain ?? new URL(item.url).hostname;

  const messages = buildScorePackFullMessages({
    persona,
    title: item.title,
    source_domain: domain,
    published_at: item.published_at ?? '',
    lang: item.lang,
    url: item.url,
    word_count: item.word_count ?? 0,
    content_excerpt: excerpt,
    excerpt_chars: contentExcerptChars,
    max_quotes: persona.output.max_quotes,
    max_quote_words_en: persona.output.max_quote_words_en,
  });

  const llmResponse = await client.chat(messages);
  const parsed = await parseWithRetry(schema, llmResponse.content, client, messages[0]!.content);

  const update = db.prepare(`
    INSERT INTO score_packs (
      id, item_id, persona_name, pack_level,
      topic, cn_title, cn_summary_short,
      dimension_scores_json, score_overall, action,
      reasons_json, angle_suggestion,
      cn_summary_long, key_points_json, quotes_json,
      model, prompt_version, llm_status, token_count, created_at
    ) VALUES (?, ?, ?, 'full', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'done', ?, ?)
    ON CONFLICT(item_id, persona_name) DO UPDATE SET
      pack_level = 'full',
      topic = excluded.topic,
      cn_title = excluded.cn_title,
      cn_summary_short = excluded.cn_summary_short,
      dimension_scores_json = excluded.dimension_scores_json,
      score_overall = excluded.score_overall,
      action = excluded.action,
      reasons_json = excluded.reasons_json,
      angle_suggestion = excluded.angle_suggestion,
      cn_summary_long = excluded.cn_summary_long,
      key_points_json = excluded.key_points_json,
      quotes_json = excluded.quotes_json,
      model = excluded.model,
      prompt_version = excluded.prompt_version,
      llm_status = 'done',
      token_count = excluded.token_count
  `);

  update.run(
    generateId(),
    item.id,
    persona.meta.name,
    parsed.topic,
    parsed.cn_title,
    parsed.cn_summary_short,
    JSON.stringify(parsed.dimension_scores),
    parsed.score_overall,
    parsed.action,
    JSON.stringify(parsed.reasons),
    parsed.angle_suggestion,
    parsed.cn_summary_long,
    JSON.stringify(parsed.key_points),
    JSON.stringify(parsed.quotes),
    llmResponse.model,
    PROMPT_VERSIONS.scorepack_full,
    llmResponse.token_count,
    nowISO(),
  );

  logger.info({ item_id: itemId, persona: persona.meta.name }, 'ScorePack upgraded to full');
}
