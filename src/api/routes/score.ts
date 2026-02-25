import { Hono } from 'hono';
import type { AppContext } from '../server.js';
import { logger } from '../../shared/logger.js';
import { runCheapFilter } from '../../engine/cheapFilter.js';
import { runScorePackLite } from '../../engine/scorePack.js';
import { buildTopicPenalties } from '../../engine/topicCluster.js';

interface PersonaRow {
  name: string;
  persona_json: string;
}

export function scoreRoutes(ctx: AppContext): Hono {
  const app = new Hono();

  /**
   * POST /api/score/:persona
   * Run cheapFilter + ScorePack Lite for a persona.
   * Body: { budget?: number, days?: number, force?: boolean }
   */
  app.post('/score/:persona', async (c) => {
    const personaName = c.req.param('persona');
    type ScoreBody = { budget?: number; days?: number; force?: boolean; item_ids?: string[] };
    const body = await c.req.json<ScoreBody>().catch(() => ({} as ScoreBody));

    const personaRow = ctx.db
      .prepare('SELECT name, persona_json FROM personas WHERE name = ?')
      .get(personaName) as PersonaRow | undefined;

    if (!personaRow) {
      return c.json({ error: `Persona not found: ${personaName}` }, 404);
    }

    const persona = JSON.parse(personaRow.persona_json);
    const budget = body.budget ?? ctx.config.scoring.default_budget;
    const days = body.days ?? ctx.config.scoring.default_days;
    const force = body.force ?? false;
    const itemIds = body.item_ids;

    logger.info({ persona: personaName, budget, days, force, hasItemIds: !!itemIds }, 'Score run requested');

    let candidates;
    let candidatesFound = 0;

    if (itemIds && itemIds.length > 0) {
      // Skip CheapFilter — directly score the specified items
      candidates = itemIds.map(id => ({ item_id: id, cheap_score: 100, factors: {} as never }));
      candidatesFound = candidates.length;
    } else {
      const topicPenalties = buildTopicPenalties(personaName, ctx.config.scoring);
      const allCandidates = runCheapFilter(persona, ctx.config.scoring, days, topicPenalties);
      candidatesFound = allCandidates.length;
      candidates = allCandidates.slice(0, budget);
    }

    const rawStats = await runScorePackLite(
      candidates,
      persona,
      ctx.config.ingest.content_excerpt_chars,
      force,
    );

    // Normalize field names: API returns succeeded/skipped_cached, frontend expects scored/cached
    const stats = {
      scored: rawStats.succeeded,
      cached: rawStats.skipped_cached,
      failed: rawStats.failed,
    };

    return c.json({
      persona: personaName,
      days,
      budget,
      candidates_found: candidatesFound,
      candidates_sent: candidates.length,
      stats,
    });
  });

  /**
   * GET /api/feed/:persona
   * Return scored items for a persona, sorted by score.
   * Query: ?top=20&days=3&action=可写
   */
  app.get('/feed/:persona', (c) => {
    const personaName = c.req.param('persona');
    const top = parseInt(c.req.query('top') ?? '20', 10);
    const days = parseInt(c.req.query('days') ?? '3', 10);
    const actionFilter = c.req.query('action');

    const personaRow = ctx.db
      .prepare('SELECT name FROM personas WHERE name = ?')
      .get(personaName) as { name: string } | undefined;

    if (!personaRow) {
      return c.json({ error: `Persona not found: ${personaName}` }, 404);
    }

    const since = new Date();
    since.setDate(since.getDate() - days);

    const params: (string | number)[] = [personaName, since.toISOString()];
    let query = `
      SELECT
        sp.item_id, sp.cn_title, sp.cn_summary_short, sp.score_overall,
        sp.action, sp.reasons_json, sp.angle_suggestion, sp.topic,
        sp.dimension_scores_json, sp.pack_level,
        i.title as original_title, i.url, i.published_at, i.word_count, i.lang,
        s.title as source_title, s.site_domain
      FROM score_packs sp
      JOIN items i ON sp.item_id = i.id
      LEFT JOIN sources s ON i.source_id = s.id
      WHERE sp.persona_name = ?
        AND sp.llm_status = 'done'
        AND i.published_at >= ?
    `;

    if (actionFilter) {
      query += ' AND sp.action = ?';
      params.push(actionFilter);
    }

    query += ' ORDER BY sp.score_overall DESC LIMIT ?';
    params.push(top);

    const rows = ctx.db.prepare(query).all(...params) as Array<Record<string, unknown>>;

    const items = rows.map((row) => ({
      item_id: row['item_id'],
      cn_title: row['cn_title'],
      original_title: row['original_title'],
      cn_summary_short: row['cn_summary_short'],
      score_overall: row['score_overall'],
      action: row['action'],
      reasons: JSON.parse(row['reasons_json'] as string),
      angle_suggestion: row['angle_suggestion'],
      topic: row['topic'],
      dimension_scores: JSON.parse(row['dimension_scores_json'] as string),
      pack_level: row['pack_level'],
      url: row['url'],
      published_at: row['published_at'],
      word_count: row['word_count'],
      lang: row['lang'],
      source_title: row['source_title'],
      site_domain: row['site_domain'],
    }));

    return c.json({ persona: personaName, days, count: items.length, items });
  });

  /**
   * GET /api/candidates/:persona
   * Return candidate items for pre-filter view (after CheapFilter, before LLM).
   * Auto-runs CheapFilter if no scores exist for this persona in window.
   * Query: ?q=&days=7
   */
  app.get('/candidates/:persona', async (c) => {
    const personaName = c.req.param('persona');
    const q = c.req.query('q') ?? '';
    const days = parseInt(c.req.query('days') ?? '7', 10);

    const personaRow = ctx.db
      .prepare('SELECT name, persona_json FROM personas WHERE name = ?')
      .get(personaName) as PersonaRow | undefined;

    if (!personaRow) {
      return c.json({ error: `Persona not found: ${personaName}` }, 404);
    }

    const since = new Date();
    since.setDate(since.getDate() - days);

    // Check if cheap_scores exist for this persona in this window
    const existingCount = (ctx.db
      .prepare(`
        SELECT COUNT(DISTINCT cs.item_id) as cnt
        FROM cheap_scores cs
        JOIN items i ON cs.item_id = i.id
        WHERE cs.persona_name = ? AND i.published_at >= ?
      `)
      .get(personaName, since.toISOString()) as { cnt: number }).cnt;

    // Auto-run CheapFilter if no scores exist
    if (existingCount === 0) {
      const persona = JSON.parse(personaRow.persona_json);
      const { runCheapFilter } = await import('../../engine/cheapFilter.js');
      const { buildTopicPenalties } = await import('../../engine/topicCluster.js');
      const topicPenalties = buildTopicPenalties(personaName, ctx.config.scoring);
      runCheapFilter(persona, ctx.config.scoring, days, topicPenalties);
    }

    // Build query: join items + cheap_scores (latest version) + optional LLM score
    const qParam = q ? `%${q}%` : null;
    const params: (string | number)[] = [personaName, personaName, since.toISOString()];
    let query = `
      SELECT
        i.id as item_id,
        i.title as original_title,
        i.url,
        i.published_at,
        i.word_count,
        i.lang,
        s.title as source_title,
        s.site_domain,
        cs.cheap_score,
        sp.cn_title,
        sp.score_overall,
        sp.action,
        sp.pack_level,
        CASE WHEN sp.llm_status = 'done' THEN 1 ELSE 0 END as is_llm_scored
      FROM cheap_scores cs
      INNER JOIN (
        SELECT item_id, MAX(created_at) as max_at
        FROM cheap_scores
        WHERE persona_name = ?
        GROUP BY item_id
      ) latest ON cs.item_id = latest.item_id AND cs.created_at = latest.max_at
      JOIN items i ON cs.item_id = i.id
      LEFT JOIN sources s ON i.source_id = s.id
      LEFT JOIN score_packs sp ON sp.item_id = i.id AND sp.persona_name = cs.persona_name
      WHERE cs.persona_name = ?
        AND i.published_at >= ?
        AND i.is_duplicate = 0
    `;

    if (qParam) {
      query += ' AND i.title LIKE ?';
      params.push(qParam);
    }

    query += ' ORDER BY cs.cheap_score DESC LIMIT 200';

    const rows = ctx.db.prepare(query).all(...params) as Array<Record<string, unknown>>;

    const items = rows.map(row => ({
      item_id: row['item_id'],
      original_title: row['original_title'],
      url: row['url'],
      published_at: row['published_at'],
      word_count: row['word_count'],
      lang: row['lang'],
      source_title: row['source_title'],
      site_domain: row['site_domain'],
      cheap_score: row['cheap_score'],
      cn_title: row['cn_title'] ?? null,
      score_overall: row['score_overall'] ?? null,
      action: row['action'] ?? null,
      pack_level: row['pack_level'] ?? null,
      is_llm_scored: !!(row['is_llm_scored']),
    }));

    return c.json({ persona: personaName, days, q, count: items.length, items });
  });

  return app;
}
