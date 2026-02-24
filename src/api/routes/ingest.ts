import { Hono } from 'hono';
import type { AppContext } from '../server.js';
import { runIngest } from '../../source/ingest.js';
import type { IngestStats } from '../../source/ingest.js';

let lastIngestStats: IngestStats | null = null;

export function ingestRoutes(ctx: AppContext): Hono {
  const app = new Hono();

  // POST /api/ingest — trigger ingest run
  app.post('/ingest', async (c) => {
    type IngestBody = { limit?: number; since_hours?: number; concurrency?: number };
    const body = await c.req.json<IngestBody>().catch(() => ({} as IngestBody));

    const stats = await runIngest(ctx.db, ctx.config, {
      limit: body.limit,
      sinceHours: body.since_hours,
      concurrency: body.concurrency,
    });

    lastIngestStats = stats;
    return c.json(stats);
  });

  // GET /api/ingest/status — last run stats
  app.get('/ingest/status', (c) => {
    if (!lastIngestStats) {
      return c.json({ message: 'No ingest has been run yet' }, 404);
    }
    return c.json(lastIngestStats);
  });

  return app;
}
