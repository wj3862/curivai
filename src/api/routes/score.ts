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
    type ScoreBody = { budget?: number; days?: number; force?: boolean };
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

    logger.info({ persona: personaName, budget, days, force }, 'Score run requested');

    const topicPenalties = buildTopicPenalties(personaName, ctx.config.scoring);
    const candidates = runCheapFilter(persona, ctx.config.scoring, days, topicPenalties);
    const budgetedCandidates = candidates.slice(0, budget);
    const stats = await runScorePackLite(
      budgetedCandidates,
      persona,
      ctx.config.ingest.content_excerpt_chars,
      force,
    );

    return c.json({
      persona: personaName,
      days,
      budget,
      candidates_found: candidates.length,
      candidates_sent: budgetedCandidates.length,
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

  return app;
}
