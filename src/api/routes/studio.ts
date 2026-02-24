import { Hono } from 'hono';
import type { AppContext } from '../server.js';
import { logger } from '../../shared/logger.js';
import { generateId, nowISO } from '../../shared/utils.js';
import {
  addToPicked,
  removePicked,
  listPicked,
  clearPicked,
} from '../../studio/picked.js';
import {
  createDraft,
  getDraft,
  updateDraft,
  listDrafts,
  deleteDraft,
} from '../../studio/drafts.js';
import { lintExport } from '../../studio/lint.js';
import { runCompose } from '../../engine/compose.js';
import type { DraftType, MergeStrategy } from '../../studio/drafts.js';

interface PersonaRow {
  name: string;
  persona_json: string;
}

export function studioRoutes(ctx: AppContext): Hono {
  const app = new Hono();

  // ============================================================
  // Picked Basket
  // ============================================================

  /**
   * GET /api/picked/:persona
   * List items in the picked basket.
   */
  app.get('/picked/:persona', (c) => {
    const personaName = c.req.param('persona');
    const items = listPicked(ctx.db, personaName);
    return c.json({ persona: personaName, count: items.length, items });
  });

  /**
   * POST /api/picked/:persona
   * Add item to picked basket (triggers ScorePack Full upgrade).
   * Body: { item_id: string }
   */
  app.post('/picked/:persona', async (c) => {
    const personaName = c.req.param('persona');
    type PickedBody = { item_id: string };
    const body = await c.req.json<PickedBody>().catch(() => null);

    if (!body?.item_id) {
      return c.json({ error: 'Missing item_id in request body' }, 400);
    }

    const personaRow = ctx.db
      .prepare('SELECT name, persona_json FROM personas WHERE name = ?')
      .get(personaName) as PersonaRow | undefined;

    if (!personaRow) {
      return c.json({ error: `Persona not found: ${personaName}` }, 404);
    }

    const persona = JSON.parse(personaRow.persona_json);

    const added = await addToPicked(
      ctx.db,
      body.item_id,
      personaName,
      persona,
      ctx.config.ingest.content_excerpt_chars,
    );

    return c.json({
      added,
      item_id: body.item_id,
      persona: personaName,
      message: added ? 'Item added and upgraded to full ScorePack' : 'Item already in basket',
    });
  });

  /**
   * DELETE /api/picked/:persona/:itemId
   * Remove item from picked basket.
   */
  app.delete('/picked/:persona/:itemId', (c) => {
    const personaName = c.req.param('persona');
    const itemId = c.req.param('itemId');
    const removed = removePicked(ctx.db, itemId, personaName);
    return c.json({ removed, item_id: itemId, persona: personaName });
  });

  /**
   * DELETE /api/picked/:persona
   * Clear all items from picked basket.
   */
  app.delete('/picked/:persona', (c) => {
    const personaName = c.req.param('persona');
    const count = clearPicked(ctx.db, personaName);
    return c.json({ cleared: count, persona: personaName });
  });

  // ============================================================
  // Drafts
  // ============================================================

  /**
   * GET /api/drafts
   * List drafts. Query: ?persona=<name>
   */
  app.get('/drafts', (c) => {
    const personaName = c.req.query('persona');
    const drafts = listDrafts(ctx.db, personaName);
    return c.json({ count: drafts.length, drafts });
  });

  /**
   * POST /api/drafts
   * Create a new draft.
   * Body: { persona: string, type: 'wechat'|'xhs'|'douyin', title?: string, strategy?: string }
   */
  app.post('/drafts', async (c) => {
    type DraftBody = {
      persona: string;
      type: DraftType;
      title?: string;
      strategy?: MergeStrategy;
      item_ids?: string[];
    };
    const body = await c.req.json<DraftBody>().catch(() => null);

    if (!body?.persona || !body?.type) {
      return c.json({ error: 'Missing required fields: persona, type' }, 400);
    }

    const validTypes: DraftType[] = ['wechat', 'xhs', 'douyin'];
    if (!validTypes.includes(body.type)) {
      return c.json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` }, 400);
    }

    const personaRow = ctx.db
      .prepare('SELECT name FROM personas WHERE name = ?')
      .get(body.persona) as { name: string } | undefined;

    if (!personaRow) {
      return c.json({ error: `Persona not found: ${body.persona}` }, 404);
    }

    // If no item_ids provided, use the current picked basket
    let selectedIds = body.item_ids ?? [];
    if (selectedIds.length === 0) {
      const picked = listPicked(ctx.db, body.persona);
      selectedIds = picked.map((p) => p.item_id);
    }

    const draft = createDraft(ctx.db, {
      persona_name: body.persona,
      draft_type: body.type,
      title: body.title,
      selected_item_ids: selectedIds,
      merge_strategy: body.strategy,
    });

    return c.json(draft, 201);
  });

  /**
   * GET /api/drafts/:id
   * Get a draft by ID.
   */
  app.get('/drafts/:id', (c) => {
    const id = c.req.param('id');
    const draft = getDraft(ctx.db, id);
    if (!draft) {
      return c.json({ error: `Draft not found: ${id}` }, 404);
    }
    return c.json(draft);
  });

  /**
   * PATCH /api/drafts/:id
   * Update a draft.
   * Body: { title?, user_commentary?, merge_strategy? }
   */
  app.patch('/drafts/:id', async (c) => {
    const id = c.req.param('id');
    type PatchBody = {
      title?: string;
      user_commentary?: string;
      merge_strategy?: MergeStrategy;
      selected_item_ids?: string[];
    };
    const body = await c.req.json<PatchBody>().catch(() => null);

    if (!body) {
      return c.json({ error: 'Invalid request body' }, 400);
    }

    const draft = getDraft(ctx.db, id);
    if (!draft) {
      return c.json({ error: `Draft not found: ${id}` }, 404);
    }

    const updated = updateDraft(ctx.db, id, {
      title: body.title,
      user_commentary: body.user_commentary,
      merge_strategy: body.merge_strategy,
      selected_item_ids: body.selected_item_ids,
    });

    return c.json(updated);
  });

  /**
   * DELETE /api/drafts/:id
   * Delete a draft.
   */
  app.delete('/drafts/:id', (c) => {
    const id = c.req.param('id');
    const deleted = deleteDraft(ctx.db, id);
    return c.json({ deleted, id });
  });

  /**
   * POST /api/drafts/:id/compose
   * Trigger LLM compose for a draft.
   */
  app.post('/drafts/:id/compose', async (c) => {
    const id = c.req.param('id');

    const draft = getDraft(ctx.db, id);
    if (!draft) {
      return c.json({ error: `Draft not found: ${id}` }, 404);
    }

    const personaRow = ctx.db
      .prepare('SELECT name, persona_json FROM personas WHERE name = ?')
      .get(draft.persona_name) as PersonaRow | undefined;

    if (!personaRow) {
      return c.json({ error: `Persona not found: ${draft.persona_name}` }, 404);
    }

    const persona = JSON.parse(personaRow.persona_json);

    logger.info({ draft_id: id, persona: draft.persona_name }, 'Compose requested');

    const stats = await runCompose(id, persona);

    const updatedDraft = getDraft(ctx.db, id);
    return c.json({ stats, draft: updatedDraft });
  });

  /**
   * POST /api/drafts/:id/export
   * Export a draft (runs linter, writes to exports table).
   * Body: { format: 'wechat'|'xhs'|'douyin' }
   */
  app.post('/drafts/:id/export', async (c) => {
    const id = c.req.param('id');
    type ExportBody = { format: 'wechat' | 'xhs' | 'douyin' };
    const body = await c.req.json<ExportBody>().catch(() => null);

    if (!body?.format) {
      return c.json({ error: 'Missing format in request body' }, 400);
    }

    const draft = getDraft(ctx.db, id);
    if (!draft) {
      return c.json({ error: `Draft not found: ${id}` }, 404);
    }

    if (!draft.content_md) {
      return c.json(
        { error: 'Draft has no content. Run compose first: POST /api/drafts/:id/compose' },
        422,
      );
    }

    // Get URLs for lint check
    const pickedUrls = draft.selected_item_ids.map((itemId) => {
      const item = ctx.db.prepare('SELECT url FROM items WHERE id = ?').get(itemId) as
        | { url: string }
        | undefined;
      return item?.url ?? '';
    });

    const lintResult = lintExport(draft.content_md, draft, pickedUrls);

    if (!lintResult.passed) {
      return c.json(
        {
          error: 'Export blocked by linter',
          lint_errors: lintResult.errors,
          lint_warnings: lintResult.warnings,
        },
        422,
      );
    }

    // Write to exports table
    const exportId = generateId();
    ctx.db
      .prepare(`
        INSERT INTO exports (id, draft_id, format, content, lint_passed, created_at)
        VALUES (?, ?, ?, ?, 1, ?)
      `)
      .run(exportId, id, body.format, draft.content_md, nowISO());

    return c.json({
      export_id: exportId,
      draft_id: id,
      format: body.format,
      lint_passed: true,
      lint_warnings: lintResult.warnings,
      content: draft.content_md,
    });
  });

  // ============================================================
  // Exports
  // ============================================================

  /**
   * GET /api/exports/:id
   * Get an export by ID.
   */
  app.get('/exports/:id', (c) => {
    const id = c.req.param('id');
    const exp = ctx.db
      .prepare('SELECT * FROM exports WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;

    if (!exp) {
      return c.json({ error: `Export not found: ${id}` }, 404);
    }

    return c.json(exp);
  });

  return app;
}
