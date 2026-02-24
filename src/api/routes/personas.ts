import { Hono } from 'hono';
import type { AppContext } from '../server.js';

interface PersonaRow {
  name: string;
  display_name: string;
  description: string | null;
  is_builtin: number;
  persona_json: string;
}

export function personaRoutes(ctx: AppContext): Hono {
  const app = new Hono();

  /**
   * GET /api/personas
   * List all loaded personas.
   */
  app.get('/personas', (c) => {
    const rows = ctx.db
      .prepare('SELECT name, display_name, description, is_builtin, persona_json FROM personas ORDER BY is_builtin DESC, name')
      .all() as PersonaRow[];

    const personas = rows.map((row) => {
      const parsed = JSON.parse(row.persona_json) as { meta?: { icon?: string } };
      return {
        name: row.name,
        display_name: row.display_name,
        description: row.description,
        icon: parsed.meta?.icon ?? null,
        is_builtin: row.is_builtin,
      };
    });

    return c.json(personas);
  });

  /**
   * GET /api/personas/:name
   * Get persona detail + basic stats.
   */
  app.get('/personas/:name', (c) => {
    const name = c.req.param('name');
    const row = ctx.db
      .prepare('SELECT name, display_name, description, is_builtin, persona_json FROM personas WHERE name = ?')
      .get(name) as PersonaRow | undefined;

    if (!row) {
      return c.json({ error: `Persona not found: ${name}` }, 404);
    }

    const parsed = JSON.parse(row.persona_json) as { meta?: { icon?: string } };

    const itemCount = ctx.db
      .prepare('SELECT COUNT(*) as count FROM score_packs WHERE persona_name = ?')
      .get(name) as { count: number };

    const avgScore = ctx.db
      .prepare('SELECT AVG(score_overall) as avg FROM score_packs WHERE persona_name = ? AND llm_status = ?')
      .get(name, 'done') as { avg: number | null };

    return c.json({
      name: row.name,
      display_name: row.display_name,
      description: row.description,
      icon: parsed.meta?.icon ?? null,
      is_builtin: row.is_builtin,
      persona: parsed,
      stats: {
        scored_items: itemCount.count,
        avg_score: avgScore.avg ? Math.round(avgScore.avg) : null,
      },
    });
  });

  return app;
}
