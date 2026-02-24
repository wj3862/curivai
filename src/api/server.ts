import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { serve } from '@hono/node-server';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type Database from 'better-sqlite3';
import type { Config } from '../shared/config.js';
import { CurivaiError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';
import { initDb, closeDb, resetDbInstance } from '../db/db.js';
import { runMigrations } from '../db/migrate.js';
import { loadConfig } from '../shared/config.js';
import { resolvePath, getPackageRoot } from '../shared/utils.js';
import { syncAllPersonas } from '../persona/loader.js';
import { initLlmClient } from '../llm/client.js';
import { sourceRoutes } from './routes/sources.js';
import { ingestRoutes } from './routes/ingest.js';
import { systemRoutes } from './routes/system.js';
import { scoreRoutes } from './routes/score.js';
import { compareRoutes } from './routes/compare.js';
import { studioRoutes } from './routes/studio.js';
import { autopilotRoutes } from './routes/autopilot.js';
import { presetRoutes } from './routes/presets.js';
import { personaRoutes } from './routes/personas.js';
import { digestRoutes } from './routes/digest.js';
import { startScheduler, stopScheduler } from '../push/scheduler.js';

export interface AppContext {
  db: Database.Database;
  config: Config;
}

export function createApp(ctx: AppContext): Hono {
  const app = new Hono();

  // Middleware
  app.use('*', cors());

  // Mount route groups
  app.route('/api', sourceRoutes(ctx));
  app.route('/api', ingestRoutes(ctx));
  app.route('/api', systemRoutes(ctx));
  app.route('/api', scoreRoutes(ctx));
  app.route('/api', compareRoutes(ctx));
  app.route('/api', studioRoutes(ctx));
  app.route('/api', autopilotRoutes(ctx));
  app.route('/api', presetRoutes(ctx));
  app.route('/api', personaRoutes(ctx));
  app.route('/api', digestRoutes(ctx));

  // Serve web dashboard static files if built
  const webDistPath = path.join(getPackageRoot(), 'dist', 'web');
  if (fs.existsSync(webDistPath)) {
    app.use('/*', serveStatic({ root: './dist/web' }));
    app.get('/*', serveStatic({ path: './dist/web/index.html' }));
  }

  // Global error handler
  app.onError((err, c) => {
    if (err instanceof CurivaiError) {
      const status = errorCodeToHttpStatus(err.code) as ContentfulStatusCode;
      return c.json({ error: err.message, code: err.code, details: err.details }, status);
    }
    logger.error({ error: err.message, stack: err.stack }, 'Unhandled error');
    return c.json({ error: 'Internal server error' }, 500 as ContentfulStatusCode);
  });

  // 404 handler
  app.notFound((c) => {
    return c.json({ error: 'Not found' }, 404);
  });

  return app;
}

function errorCodeToHttpStatus(code: string): number {
  switch (code) {
    case 'CONFIG_ERROR':
    case 'PERSONA_ERROR':
      return 400;
    case 'STUDIO_ERROR':
    case 'COMPOSE_ERROR':
      return 422;
    case 'LINT_ERROR':
      return 422;
    case 'SOURCE_ERROR':
      return 502;
    case 'DB_ERROR':
      return 500;
    case 'INGEST_ERROR':
      return 500;
    default:
      return 500;
  }
}

export async function startServer(opts: { port?: number } = {}): Promise<void> {
  const config = await loadConfig();
  const port = opts.port ?? config.server.port;
  const host = config.server.host;

  const dbPath = resolvePath(config.db.path);
  const db = initDb(dbPath);
  runMigrations(db);

  // Sync personas
  const personasDir = resolvePath(config.personas_dir);
  syncAllPersonas(db, personasDir);

  // Init LLM client
  initLlmClient(config.llm);

  const app = createApp({ db, config });

  logger.info({ port, host }, 'Starting CurivAI server');

  serve({ fetch: app.fetch, port, hostname: host }, (info) => {
    // eslint-disable-next-line no-console
    console.log(`CurivAI server running at http://${host}:${info.port}`);
    // eslint-disable-next-line no-console
    console.log(`Web UI: http://${host}:${info.port}/`);
  });

  // Start scheduler
  startScheduler(db, config);

  // Handle graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down...');
    stopScheduler();
    closeDb();
    resetDbInstance();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
