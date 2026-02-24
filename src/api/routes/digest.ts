import { Hono } from 'hono';
import type { AppContext } from '../server.js';
import { buildDigest, buildAllDigests } from '../../engine/digest.js';
import { sendDigestEmail, renderDigestMarkdown } from '../../push/email.js';
import { logger } from '../../shared/logger.js';

export function digestRoutes(ctx: AppContext): Hono {
  const app = new Hono();

  /**
   * GET /api/digest/:persona
   * Build and return digest data for a persona (no email sent).
   * Query: ?days=1&top=10&min_score=60
   */
  app.get('/digest/:persona', (c) => {
    const personaName = c.req.param('persona');
    const days = parseInt(c.req.query('days') ?? '1', 10);
    const topN = parseInt(c.req.query('top') ?? '10', 10);
    const minScore = parseInt(c.req.query('min_score') ?? '60', 10);

    const digest = buildDigest(ctx.db, personaName, { days, topN, minScore });
    return c.json(digest);
  });

  /**
   * GET /api/digest
   * Build digests for ALL personas.
   * Query: ?days=1&top=10&format=json|markdown
   */
  app.get('/digest', (c) => {
    const days = parseInt(c.req.query('days') ?? '1', 10);
    const topN = parseInt(c.req.query('top') ?? '10', 10);
    const format = c.req.query('format') ?? 'json';

    const digests = buildAllDigests(ctx.db, { days, topN });

    if (format === 'markdown') {
      const md = renderDigestMarkdown(digests);
      return c.text(md);
    }

    return c.json({ count: digests.length, digests });
  });

  /**
   * POST /api/digest/send
   * Build all digests and send email (requires email config).
   * Body: { days?: number, top?: number }
   */
  app.post('/digest/send', async (c) => {
    if (!ctx.config.delivery.email.enabled) {
      return c.json({ error: 'Email delivery is not enabled. Set delivery.email.enabled=true in config.' }, 400);
    }
    if (ctx.config.delivery.email.to.length === 0) {
      return c.json({ error: 'No recipients configured. Set delivery.email.to in config.' }, 400);
    }

    type DigestBody = { days?: number; top?: number };
    const body = await c.req.json<DigestBody>().catch(() => ({} as DigestBody));
    const days = body.days ?? 1;
    const topN = body.top ?? 10;

    const digests = buildAllDigests(ctx.db, { days, topN });
    const totalItems = digests.reduce((s, d) => s + d.items.length, 0);

    if (totalItems === 0) {
      return c.json({ sent: false, reason: 'No scored items found for any persona' });
    }

    logger.info({ days, topN, total_items: totalItems }, 'Sending digest email');

    await sendDigestEmail(digests, {
      smtp_host: ctx.config.delivery.email.smtp_host,
      smtp_port: ctx.config.delivery.email.smtp_port,
      smtp_user: ctx.config.delivery.email.smtp_user,
      smtp_pass: ctx.config.delivery.email.smtp_pass,
      from: ctx.config.delivery.email.from,
      to: ctx.config.delivery.email.to,
    });

    return c.json({
      sent: true,
      to: ctx.config.delivery.email.to,
      personas: digests.length,
      total_items: totalItems,
    });
  });

  return app;
}
