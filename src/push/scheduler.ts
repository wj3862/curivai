/**
 * Scheduler — node-cron jobs for automated ingest, scoring, and digest delivery.
 * Started by `curivai server` when schedule config is present.
 */

import cron from 'node-cron';
import type Database from 'better-sqlite3';
import type { Config } from '../shared/config.js';
import { logger } from '../shared/logger.js';
import { runIngest } from '../source/ingest.js';
import { runCheapFilter } from '../engine/cheapFilter.js';
import { runScorePackLite } from '../engine/scorePack.js';
import { buildTopicPenalties } from '../engine/topicCluster.js';
import { buildAllDigests } from '../engine/digest.js';
import { sendDigestEmail, renderDigestMarkdown } from './email.js';

interface PersonaRow {
  name: string;
  persona_json: string;
}

let ingestTask: cron.ScheduledTask | null = null;
let digestTask: cron.ScheduledTask | null = null;

/**
 * Run the ingest + scoring pipeline for all active personas.
 */
async function runIngestAndScore(db: Database.Database, config: Config): Promise<void> {
  logger.info('Scheduled ingest starting');
  try {
    const stats = await runIngest(db, config);
    logger.info(stats, 'Scheduled ingest complete');
  } catch (e) {
    logger.error({ error: (e as Error).message }, 'Scheduled ingest failed');
  }

  // Score all personas with default budget
  const personas = db
    .prepare('SELECT name, persona_json FROM personas')
    .all() as PersonaRow[];

  for (const row of personas) {
    try {
      const persona = JSON.parse(row.persona_json);
      const topicPenalties = buildTopicPenalties(row.name, config.scoring);
      const candidates = runCheapFilter(
        persona,
        config.scoring,
        config.scoring.default_days,
        topicPenalties,
      );
      const budgeted = candidates.slice(0, config.scoring.default_budget);
      const stats = await runScorePackLite(
        budgeted,
        persona,
        config.ingest.content_excerpt_chars,
        false,
      );
      logger.info({ persona: row.name, ...stats }, 'Scheduled score complete');
    } catch (e) {
      logger.error({ persona: row.name, error: (e as Error).message }, 'Scheduled score failed');
    }
  }
}

/**
 * Run the digest build + email send pipeline.
 */
async function runDigest(db: Database.Database, config: Config): Promise<void> {
  logger.info('Scheduled digest starting');
  try {
    const digests = buildAllDigests(db, { days: 1, topN: 10, minScore: 60 });
    const hasItems = digests.some((d) => d.items.length > 0);

    if (!hasItems) {
      logger.info('Digest: no scored items found, skipping email');
      return;
    }

    if (config.delivery.email.enabled && config.delivery.email.to.length > 0) {
      await sendDigestEmail(digests, {
        smtp_host: config.delivery.email.smtp_host,
        smtp_port: config.delivery.email.smtp_port,
        smtp_user: config.delivery.email.smtp_user,
        smtp_pass: config.delivery.email.smtp_pass,
        from: config.delivery.email.from,
        to: config.delivery.email.to,
      });
    } else {
      // Log markdown digest to stdout if email not configured
      const md = renderDigestMarkdown(digests);
      logger.info({ digest_preview: md.slice(0, 500) }, 'Digest (email disabled)');
    }
  } catch (e) {
    logger.error({ error: (e as Error).message }, 'Scheduled digest failed');
  }
}

/**
 * Start all scheduled tasks.
 * Called by the server on startup.
 */
export function startScheduler(db: Database.Database, config: Config): void {
  const ingestCron = config.schedule?.ingest_cron ?? '0 */4 * * *';
  const digestCron = config.schedule?.digest_cron ?? '0 8 * * *';

  if (!cron.validate(ingestCron)) {
    logger.warn({ ingestCron }, 'Invalid ingest_cron expression, skipping scheduler');
    return;
  }

  if (!cron.validate(digestCron)) {
    logger.warn({ digestCron }, 'Invalid digest_cron expression, skipping scheduler');
    return;
  }

  ingestTask = cron.schedule(ingestCron, () => {
    void runIngestAndScore(db, config);
  });

  digestTask = cron.schedule(digestCron, () => {
    void runDigest(db, config);
  });

  logger.info(
    { ingest_cron: ingestCron, digest_cron: digestCron },
    'Scheduler started',
  );
}

/**
 * Stop all scheduled tasks (for graceful shutdown).
 */
export function stopScheduler(): void {
  ingestTask?.stop();
  digestTask?.stop();
  ingestTask = null;
  digestTask = null;
  logger.info('Scheduler stopped');
}
