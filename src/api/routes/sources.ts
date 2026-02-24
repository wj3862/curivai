import { Hono } from 'hono';
import type { AppContext } from '../server.js';
import {
  addSource,
  listSources,
  getSource,
  updateSource,
  deleteSource,
  getSourceItemCounts,
} from '../../source/sourceDb.js';
import { parseOpml } from '../../source/opml.js';
import { loadRadarPack, listAvailablePacks } from '../../shared/packs.js';
import { SourceError } from '../../shared/errors.js';

export function sourceRoutes(ctx: AppContext): Hono {
  const app = new Hono();

  // POST /api/sources — add a single source
  app.post('/sources', async (c) => {
    const body = await c.req.json<{ url: string; title?: string; type?: string }>();
    if (!body.url) {
      return c.json({ error: 'url is required' }, 400);
    }

    const id = addSource(ctx.db, {
      url: body.url,
      title: body.title,
      type: body.type,
    });

    if (id === null) {
      return c.json({ error: 'Source already exists', url: body.url }, 409);
    }

    const source = getSource(ctx.db, id);
    return c.json(source, 201);
  });

  // GET /api/sources — list all sources with item counts
  app.get('/sources', (c) => {
    const sources = listSources(ctx.db);
    const counts = getSourceItemCounts(ctx.db);
    const countMap = new Map(counts.map((row) => [row.source_id, row.count]));

    const result = sources.map((s) => ({
      ...s,
      item_count: countMap.get(s.id) ?? 0,
    }));

    return c.json(result);
  });

  // DELETE /api/sources/:id
  app.delete('/sources/:id', (c) => {
    const id = c.req.param('id');
    const deleted = deleteSource(ctx.db, id);
    if (!deleted) {
      return c.json({ error: 'Source not found' }, 404);
    }
    return c.json({ ok: true });
  });

  // PATCH /api/sources/:id — update title/is_active
  app.patch('/sources/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{ title?: string; is_active?: number }>();

    const source = getSource(ctx.db, id);
    if (!source) {
      return c.json({ error: 'Source not found' }, 404);
    }

    updateSource(ctx.db, id, body);
    const updated = getSource(ctx.db, id);
    return c.json(updated);
  });

  // POST /api/sources/import-opml — import from OPML XML body
  app.post('/sources/import-opml', async (c) => {
    const body = await c.req.text();
    if (!body) {
      return c.json({ error: 'OPML XML body required' }, 400);
    }

    let feeds;
    try {
      feeds = parseOpml(body);
    } catch (err) {
      throw new SourceError(
        `Failed to parse OPML: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const results = { added: 0, skipped: 0, total: feeds.length };
    for (const feed of feeds) {
      const id = addSource(ctx.db, { url: feed.url, title: feed.title });
      if (id) {
        results.added++;
      } else {
        results.skipped++;
      }
    }

    return c.json(results, 201);
  });

  // POST /api/sources/install-pack — install a radar pack
  app.post('/sources/install-pack', async (c) => {
    const body = await c.req.json<{ pack_name: string }>();
    if (!body.pack_name) {
      return c.json({ error: 'pack_name is required' }, 400);
    }

    const pack = loadRadarPack(body.pack_name);
    const results = { added: 0, skipped: 0, total: pack.sources.length, pack: pack.name };

    for (const packSource of pack.sources) {
      const id = addSource(ctx.db, {
        url: packSource.url,
        title: packSource.title,
        pack_name: pack.name,
      });
      if (id) {
        results.added++;
      } else {
        results.skipped++;
      }
    }

    return c.json(results, 201);
  });

  // GET /api/sources/packs — list available radar packs with installed status
  app.get('/sources/packs', (c) => {
    const available = listAvailablePacks();

    // Get installed pack names from DB
    const installedRows = ctx.db
      .prepare('SELECT DISTINCT pack_name FROM sources WHERE pack_name IS NOT NULL')
      .all() as Array<{ pack_name: string }>;
    const installedNames = new Set(installedRows.map((r) => r.pack_name));

    const packs = available.map((entry) => {
      let pack;
      try {
        pack = loadRadarPack(entry.name);
      } catch {
        return null;
      }
      return {
        name: pack.name,
        display_name: pack.display_name,
        description: pack.description,
        source_count: pack.sources.length,
        installed: installedNames.has(pack.name),
      };
    }).filter(Boolean);

    return c.json(packs);
  });

  return app;
}
