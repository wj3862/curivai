import { Hono } from 'hono';
import type { AppContext } from '../server.js';
import { listSources } from '../../source/sourceDb.js';
import { listPersonasFromDb } from '../../persona/loader.js';
import { ConfigSchema, saveConfig, deepMerge } from '../../shared/config.js';
import { initLlmClient } from '../../llm/client.js';

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

  // GET /api/config — return current config (api_key masked)
  app.get('/config', (c) => {
    const cfg = JSON.parse(JSON.stringify(ctx.config)) as typeof ctx.config;
    if (cfg.llm.api_key) cfg.llm.api_key = '***';
    return c.json(cfg);
  });

  // PATCH /api/config — deep-merge patch, validate, save, hot-reload safe fields
  app.patch('/config', async (c) => {
    const patch = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));

    // Clone current config as base
    const merged = JSON.parse(JSON.stringify(ctx.config)) as Record<string, unknown>;

    // Deep merge the patch
    deepMerge(merged, patch);

    // Preserve api_key if the caller sent the masked sentinel
    const patchLlm = patch['llm'] as Record<string, unknown> | undefined;
    if (patchLlm && patchLlm['api_key'] === '***') {
      const mergedLlm = merged['llm'] as Record<string, unknown>;
      mergedLlm['api_key'] = ctx.config.llm.api_key;
    }

    // Validate
    const result = ConfigSchema.safeParse(merged);
    if (!result.success) {
      return c.json({ error: 'Invalid config', errors: result.error.flatten().fieldErrors }, 400);
    }

    const newConfig = result.data;

    // Persist to file + update cache
    saveConfig(newConfig);

    // Update ctx.config in-place so all subsequent requests see new values
    const newCfgRecord = newConfig as unknown as Record<string, unknown>;
    for (const k of Object.keys(newCfgRecord)) {
      (ctx.config as unknown as Record<string, unknown>)[k] = newCfgRecord[k];
    }

    // Hot-reload LLM client if llm section changed
    if ('llm' in patch) {
      initLlmClient(newConfig.llm);
    }

    const masked = JSON.parse(JSON.stringify(newConfig)) as typeof newConfig;
    if (masked.llm.api_key) masked.llm.api_key = '***';
    return c.json({ saved: true, config: masked });
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

  // GET /api/stats/funnel/:persona — token efficiency funnel
  app.get('/stats/funnel/:persona', (c) => {
    const personaName = c.req.param('persona');

    const personaRow = ctx.db
      .prepare('SELECT name FROM personas WHERE name = ?')
      .get(personaName) as { name: string } | undefined;

    if (!personaRow) {
      return c.json({ error: `Persona not found: ${personaName}` }, 404);
    }

    // Q1: total non-duplicate items in DB
    const totalItems = (ctx.db
      .prepare('SELECT COUNT(*) as count FROM items WHERE is_duplicate = 0')
      .get() as { count: number }).count;

    // Q2: cheap scores for this persona (per item, deduplicated by latest version)
    const cheapRows = ctx.db
      .prepare(`
        SELECT cs.item_id, cs.cheap_score
        FROM cheap_scores cs
        INNER JOIN (
          SELECT item_id, MAX(created_at) as max_at
          FROM cheap_scores
          WHERE persona_name = ?
          GROUP BY item_id
        ) latest ON cs.item_id = latest.item_id AND cs.created_at = latest.max_at
        WHERE cs.persona_name = ?
      `)
      .all(personaName, personaName) as Array<{ item_id: string; cheap_score: number }>;

    const cheapEvaluated = cheapRows.length;
    const cheapAboveThreshold = cheapRows.filter(r => r.cheap_score >= ctx.config.scoring.cheap_threshold).length;

    // Q3: LLM scored results by action
    const actionRows = ctx.db
      .prepare(`
        SELECT action, COUNT(*) as cnt, SUM(COALESCE(token_count, 0)) as tokens
        FROM score_packs
        WHERE persona_name = ? AND llm_status = 'done' AND pack_level = 'lite'
        GROUP BY action
      `)
      .all(personaName) as Array<{ action: string; cnt: number; tokens: number }>;

    // Also include full packs in lite count (they were upgraded from lite)
    const liteTotal = ctx.db
      .prepare(`
        SELECT COUNT(*) as cnt, SUM(COALESCE(token_count, 0)) as tokens
        FROM score_packs
        WHERE persona_name = ? AND llm_status = 'done'
      `)
      .get(personaName) as { cnt: number; tokens: number };

    // Q4: full upgraded
    const fullRow = ctx.db
      .prepare(`
        SELECT COUNT(*) as cnt, SUM(COALESCE(token_count, 0)) as tokens
        FROM score_packs
        WHERE persona_name = ? AND pack_level = 'full' AND llm_status = 'done'
      `)
      .get(personaName) as { cnt: number; tokens: number };

    const actionBreakdown: Record<string, number> = { 可写: 0, 可提: 0, 可转: 0, 跳过: 0 };
    for (const row of actionRows) {
      actionBreakdown[row.action] = row.cnt;
    }

    const liteTokens = liteTotal.tokens ?? 0;
    const fullTokens = fullRow.tokens ?? 0;
    const totalTokens = liteTokens + fullTokens;

    // Cost estimation: mixed input/output ratio approximation
    const costPerToken = 0.00000064;
    const liteCostUsd = liteTokens * costPerToken;
    const fullCostUsd = fullTokens * costPerToken;
    const totalCostUsd = totalTokens * costPerToken;

    const actionableCount = (actionBreakdown['可写'] ?? 0) + (actionBreakdown['可提'] ?? 0);
    const liteScored = liteTotal.cnt ?? 0;

    return c.json({
      funnel: {
        total_items: totalItems,
        cheap_evaluated: cheapEvaluated,
        cheap_above_threshold: cheapAboveThreshold,
        lite_scored: liteScored,
        full_upgraded: fullRow.cnt ?? 0,
      },
      action_breakdown: actionBreakdown,
      tokens: {
        lite_total: liteTokens,
        full_total: fullTokens,
        lite_cost_usd: liteCostUsd,
        full_cost_usd: fullCostUsd,
        estimated_cost_usd: totalCostUsd,
      },
      efficiency: {
        cost_per_actionable: actionableCount > 0 ? totalCostUsd / actionableCount : null,
        actionable_rate: liteScored > 0 ? actionableCount / liteScored : null,
      },
    });
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
