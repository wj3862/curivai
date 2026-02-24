import { Hono } from 'hono';
import type { AppContext } from '../server.js';

interface PersonaRow {
  name: string;
  display_name: string;
  persona_json: string;
}

interface ScorePackRow {
  persona_name: string;
  score_overall: number;
  action: string;
  cn_title: string;
  angle_suggestion: string | null;
  pack_level: string;
}

interface ItemRow {
  id: string;
  title: string;
  url: string;
  site_domain: string | null;
  published_at: string | null;
}

export function compareRoutes(ctx: AppContext): Hono {
  const app = new Hono();

  /**
   * GET /api/compare/:itemId
   * Returns cached scores for an item across all personas.
   * NEVER triggers new LLM calls — returns null for unscored personas.
   */
  app.get('/compare/:itemId', (c) => {
    const itemId = c.req.param('itemId');

    const item = ctx.db
      .prepare(
        `SELECT i.id, i.title, i.url, s.site_domain, i.published_at
         FROM items i LEFT JOIN sources s ON i.source_id = s.id
         WHERE i.id = ?`,
      )
      .get(itemId) as ItemRow | undefined;

    if (!item) {
      return c.json({ error: `Item not found: ${itemId}` }, 404);
    }

    const allPersonas = ctx.db
      .prepare('SELECT name, display_name, persona_json FROM personas ORDER BY name')
      .all() as PersonaRow[];

    const scoredRows = ctx.db
      .prepare(
        `SELECT persona_name, score_overall, action, cn_title, angle_suggestion, pack_level
         FROM score_packs
         WHERE item_id = ? AND llm_status = 'done'`,
      )
      .all(itemId) as ScorePackRow[];

    const scoreMap = new Map(scoredRows.map((r) => [r.persona_name, r]));

    const scores = allPersonas.map((p) => {
      const parsed = JSON.parse(p.persona_json) as { meta?: { icon?: string } };
      const cached = scoreMap.get(p.name);
      if (cached) {
        return {
          persona: p.name,
          display_name: p.display_name,
          icon: parsed.meta?.icon ?? null,
          score: cached.score_overall,
          action: cached.action,
          cn_title: cached.cn_title,
          angle_suggestion: cached.angle_suggestion,
          pack_level: cached.pack_level,
          cached: true,
        };
      }
      return {
        persona: p.name,
        display_name: p.display_name,
        icon: parsed.meta?.icon ?? null,
        score: null,
        action: null,
        cn_title: null,
        angle_suggestion: null,
        pack_level: null,
        cached: false,
      };
    });

    return c.json({
      item: {
        id: item.id,
        title: item.title,
        url: item.url,
        site_domain: item.site_domain,
        published_at: item.published_at,
      },
      scores,
    });
  });

  return app;
}
