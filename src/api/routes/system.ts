import { Hono } from 'hono';
import type { AppContext } from '../server.js';
import { listSources } from '../../source/sourceDb.js';
import { listPersonasFromDb } from '../../persona/loader.js';

export function systemRoutes(ctx: AppContext): Hono {
  const app = new Hono();

  // GET /api/health — basic health check
  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      version: '0.1.0',
      uptime: process.uptime(),
    });
  });

  // GET /api/doctor — detailed health check
  app.get('/doctor', (c) => {
    const checks: Record<string, string> = {};

    // DB check
    try {
      ctx.db.prepare('SELECT 1').get();
      checks['db'] = 'ok';
    } catch {
      checks['db'] = 'error';
    }

    // Sources check
    try {
      const sources = listSources(ctx.db);
      checks['sources'] = `${sources.length} sources`;
    } catch {
      checks['sources'] = 'error';
    }

    // Personas check
    try {
      const personas = listPersonasFromDb(ctx.db);
      checks['personas'] = `${personas.length} loaded`;
    } catch {
      checks['personas'] = 'error';
    }

    // LLM check
    checks['llm'] = ctx.config.llm.api_key ? 'configured' : 'unconfigured';

    return c.json(checks);
  });

  // GET /api/stats — usage statistics
  app.get('/stats', (c) => {
    const sources = ctx.db
      .prepare('SELECT COUNT(*) as count FROM sources')
      .get() as { count: number };
    const items = ctx.db
      .prepare('SELECT COUNT(*) as count FROM items')
      .get() as { count: number };
    const itemsWithContent = ctx.db
      .prepare('SELECT COUNT(*) as count FROM items WHERE content_text IS NOT NULL')
      .get() as { count: number };
    const duplicates = ctx.db
      .prepare('SELECT COUNT(*) as count FROM items WHERE is_duplicate = 1')
      .get() as { count: number };
    const oldestItem = ctx.db
      .prepare('SELECT MIN(fetched_at) as oldest FROM items')
      .get() as { oldest: string | null };
    const newestItem = ctx.db
      .prepare('SELECT MAX(fetched_at) as newest FROM items')
      .get() as { newest: string | null };

    return c.json({
      sources: sources.count,
      items: items.count,
      items_with_content: itemsWithContent.count,
      duplicates: duplicates.count,
      oldest_item: oldestItem.oldest,
      newest_item: newestItem.newest,
    });
  });

  return app;
}
