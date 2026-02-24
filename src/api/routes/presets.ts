import { Hono } from 'hono';
import type { AppContext } from '../server.js';
import { listPresets, runPreset } from '../../engine/preset.js';
import { logger } from '../../shared/logger.js';

export function presetRoutes(ctx: AppContext): Hono {
  const app = new Hono();

  /**
   * GET /api/presets
   * List all available presets.
   */
  app.get('/presets', (c) => {
    const presets = listPresets();
    return c.json({ count: presets.length, presets });
  });

  /**
   * POST /api/presets/:name/run
   * Execute a preset (full autopilot pipeline from preset config).
   * Body: { out?: string }
   */
  app.post('/presets/:name/run', async (c) => {
    const name = c.req.param('name');
    type PresetRunBody = { out?: string };
    const body = await c.req.json<PresetRunBody>().catch(() => ({} as PresetRunBody));

    logger.info({ preset: name }, 'Preset run requested');

    const content = await runPreset(
      name,
      { out: body.out, yes: true },
      ctx.config,
      // No interactive confirmation for API
      async () => true,
    );

    return c.json({ preset: name, content });
  });

  return app;
}
