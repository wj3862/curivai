import { Hono } from 'hono';
import type { AppContext } from '../server.js';
import { runAutopilot } from '../../engine/autopilot.js';
import { logger } from '../../shared/logger.js';
import type { DraftType, MergeStrategy } from '../../studio/drafts.js';

export function autopilotRoutes(ctx: AppContext): Hono {
  const app = new Hono();

  /**
   * POST /api/autopilot
   * Run the full autopilot pipeline.
   * Body: { persona, type, budget?, days?, auto_pick_count?, auto_pick_filter?, merge_strategy? }
   */
  app.post('/autopilot', async (c) => {
    type AutopilotBody = {
      persona: string;
      type: DraftType;
      budget?: number;
      days?: number;
      auto_pick_count?: number;
      auto_pick_filter?: string;
      merge_strategy?: MergeStrategy;
      title?: string;
    };

    const body = await c.req.json<AutopilotBody>().catch(() => null);

    if (!body?.persona || !body?.type) {
      return c.json({ error: 'Missing required fields: persona, type' }, 400);
    }

    const validTypes: DraftType[] = ['wechat', 'xhs', 'douyin'];
    if (!validTypes.includes(body.type)) {
      return c.json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` }, 400);
    }

    logger.info({ persona: body.persona, type: body.type }, 'Autopilot API request');

    // API always runs without interactive confirmation (yes=true)
    const result = await runAutopilot(
      {
        persona: body.persona,
        type: body.type,
        budget: body.budget,
        days: body.days,
        autoPickCount: body.auto_pick_count,
        autoPickFilter: body.auto_pick_filter,
        mergeStrategy: body.merge_strategy,
        title: body.title,
        yes: true,
      },
      ctx.config,
      // No interactive confirmation for API
      async () => true,
    );

    return c.json({
      draft_id: result.draft_id,
      content: result.content,
      lint_passed: result.lintResult.passed,
      lint_errors: result.lintResult.errors,
      lint_warnings: result.lintResult.warnings,
      stats: result.stats,
    });
  });

  return app;
}
