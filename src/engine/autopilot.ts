import { getDb } from '../db/db.js';
import { runIngest } from '../source/ingest.js';
import { runCheapFilter } from './cheapFilter.js';
import { buildTopicPenalties } from './topicCluster.js';
import { runScorePackLite, upgradeToFull } from './scorePack.js';
import { runCompose } from './compose.js';
import { lintExport } from '../studio/lint.js';
import { createDraft } from '../studio/drafts.js';
import { clearPicked } from '../studio/picked.js';
import { ComposeError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';
import type { Persona } from '../persona/schema.js';
import type { Config } from '../shared/config.js';
import type { LintResult } from '../studio/lint.js';
import type { DraftType, MergeStrategy } from '../studio/drafts.js';

export interface AutopilotOptions {
  persona: string;
  type: DraftType;
  budget?: number;
  days?: number;
  autoPickCount?: number;
  autoPickFilter?: string;
  mergeStrategy?: MergeStrategy;
  forceIngest?: boolean;
  yes?: boolean;
  title?: string;
}

export interface AutopilotResult {
  content: string;
  draft_id: string;
  lintResult: LintResult;
  stats: AutopilotStats;
}

export interface AutopilotStats {
  items_ingested: number;
  candidates_found: number;
  items_lite_scored: number;
  items_picked: number;
  items_full_upgraded: number;
  total_llm_calls: number;
  estimated_cost: number;
}

interface PersonaRow {
  name: string;
  persona_json: string;
}

/**
 * Run the full autopilot pipeline:
 * 1. Ingest (if needed)
 * 2. CheapFilter → ScorePack Lite
 * 3. Budget guard (print estimate, ask Y/n)
 * 4. Auto-pick top N items
 * 5. ScorePack Full upgrade
 * 6. Compose + Export
 * 7. Lint check
 */
export async function runAutopilot(
  opts: AutopilotOptions,
  config: Config,
  onPlan?: (plan: AutopilotPlan) => Promise<boolean>,
): Promise<AutopilotResult> {
  const db = getDb();

  // Load persona
  const personaRow = db
    .prepare('SELECT name, persona_json FROM personas WHERE name = ?')
    .get(opts.persona) as PersonaRow | undefined;

  if (!personaRow) {
    throw new ComposeError(`Persona not found: ${opts.persona}`);
  }

  const persona = JSON.parse(personaRow.persona_json) as Persona;
  const budget = opts.budget ?? config.scoring.default_budget;
  const days = opts.days ?? config.scoring.default_days;
  const autoPickCount = opts.autoPickCount ?? 5;
  const autoPickFilter = opts.autoPickFilter ?? '可写';
  const mergeStrategy = opts.mergeStrategy ?? 'roundup';

  // Budget guard calculation
  const planLiteCount = budget;
  const planFullCount = autoPickCount;
  const planComposeCalls = 1;
  const totalLlmCalls = planLiteCount + planFullCount + planComposeCalls;
  const estimatedCost = totalLlmCalls * config.budget.cost_per_call_estimate;

  const plan: AutopilotPlan = {
    persona: opts.persona,
    type: opts.type,
    liteScoringCount: planLiteCount,
    fullUpgradeCount: planFullCount,
    composeCalls: planComposeCalls,
    totalLlmCalls,
    estimatedCost,
  };

  // Check budget limits
  if (totalLlmCalls > config.budget.max_llm_calls_per_run) {
    throw new ComposeError(
      `Estimated ${totalLlmCalls} LLM calls exceeds limit ${config.budget.max_llm_calls_per_run}. ` +
        `Reduce --budget or use --force to override.`,
    );
  }
  if (estimatedCost > config.budget.max_cost_usd_per_run) {
    throw new ComposeError(
      `Estimated cost $${estimatedCost.toFixed(4)} exceeds limit $${config.budget.max_cost_usd_per_run}. ` +
        `Reduce --budget or use --force to override.`,
    );
  }

  // Show plan and ask confirmation
  if (onPlan) {
    const confirmed = await onPlan(plan);
    if (!confirmed) {
      throw new ComposeError('Autopilot cancelled by user.');
    }
  }

  logger.info({ persona: opts.persona, type: opts.type, budget, days }, 'Autopilot starting');

  const autopilotStats: AutopilotStats = {
    items_ingested: 0,
    candidates_found: 0,
    items_lite_scored: 0,
    items_picked: 0,
    items_full_upgraded: 0,
    total_llm_calls: 0,
    estimated_cost: 0,
  };

  // Step 1: Ingest (if last ingest > 4 hours ago or force)
  if (opts.forceIngest || shouldIngest(db)) {
    logger.info('Ingesting from active sources...');
    const ingestStats = await runIngest(db, config, { limit: 200 });
    autopilotStats.items_ingested = ingestStats.itemsNew;
    logger.info({ new_items: ingestStats.itemsNew }, 'Ingest complete');
  } else {
    logger.info('Skipping ingest (recent ingest detected)');
  }

  // Step 2: CheapFilter + ScorePack Lite
  const topicPenalties = buildTopicPenalties(opts.persona, config.scoring);
  const candidates = runCheapFilter(persona, config.scoring, days, topicPenalties);
  const budgeted = candidates.slice(0, budget);
  autopilotStats.candidates_found = candidates.length;

  logger.info({ candidates: candidates.length, budget: budgeted.length }, 'CheapFilter complete');

  const liteStats = await runScorePackLite(
    budgeted,
    persona,
    config.ingest.content_excerpt_chars,
    false,
  );
  autopilotStats.items_lite_scored = liteStats.succeeded;
  autopilotStats.total_llm_calls += liteStats.attempted;
  autopilotStats.estimated_cost += liteStats.total_cost;

  // Step 3: Auto-pick top items matching filter
  const feedRows = db
    .prepare(`
      SELECT sp.item_id, sp.score_overall, sp.action
      FROM score_packs sp
      JOIN items i ON sp.item_id = i.id
      WHERE sp.persona_name = ? AND sp.llm_status = 'done' AND sp.action = ?
        AND i.published_at >= datetime('now', ? || ' days')
      ORDER BY sp.score_overall DESC
      LIMIT ?
    `)
    .all(
      opts.persona,
      autoPickFilter,
      String(-days),
      autoPickCount,
    ) as Array<{ item_id: string; score_overall: number; action: string }>;

  if (feedRows.length === 0) {
    logger.warn({ filter: autoPickFilter }, 'No items matched auto-pick filter, trying any scored items');
    // Fallback: pick top scored items regardless of action
    const fallback = db
      .prepare(`
        SELECT sp.item_id, sp.score_overall, sp.action
        FROM score_packs sp
        JOIN items i ON sp.item_id = i.id
        WHERE sp.persona_name = ? AND sp.llm_status = 'done'
          AND i.published_at >= datetime('now', ? || ' days')
        ORDER BY sp.score_overall DESC
        LIMIT ?
      `)
      .all(opts.persona, String(-days), autoPickCount) as Array<{
      item_id: string;
      score_overall: number;
      action: string;
    }>;
    feedRows.push(...fallback);
  }

  // Clear existing picked basket and add new items
  clearPicked(db, opts.persona);

  // Step 4: ScorePack Full upgrade for picked items
  const pickedItemIds: string[] = [];
  for (const row of feedRows) {
    try {
      await upgradeToFull(row.item_id, persona, config.ingest.content_excerpt_chars);
      pickedItemIds.push(row.item_id);
      autopilotStats.items_full_upgraded++;
      autopilotStats.total_llm_calls++;
      autopilotStats.estimated_cost += config.budget.cost_per_call_estimate * 3; // full ~3x lite
    } catch (err) {
      logger.warn({ item_id: row.item_id, error: err instanceof Error ? err.message : String(err) }, 'Full upgrade failed, skipping item');
    }
  }
  autopilotStats.items_picked = pickedItemIds.length;

  if (pickedItemIds.length === 0) {
    throw new ComposeError('No items could be fully scored for compose. Check LLM configuration.');
  }

  // Step 5: Create draft with selected items
  const draft = createDraft(db, {
    persona_name: opts.persona,
    draft_type: opts.type,
    title: opts.title ?? generateAutoTitle(opts.type, persona),
    selected_item_ids: pickedItemIds,
    merge_strategy: mergeStrategy,
  });

  // Step 6: Compose
  const composeStats = await runCompose(draft.id, persona);
  autopilotStats.total_llm_calls++;
  autopilotStats.estimated_cost += composeStats.cost_estimate;

  // Step 7: Lint — re-fetch draft after compose to get updated content
  const updatedDraft = db
    .prepare('SELECT content_md FROM drafts WHERE id = ?')
    .get(draft.id) as { content_md: string | null } | undefined;

  const contentMd = updatedDraft?.content_md ?? '';

  const pickedUrls = pickedItemIds.map((id) => {
    const item = db.prepare('SELECT url FROM items WHERE id = ?').get(id) as
      | { url: string }
      | undefined;
    return item?.url ?? '';
  });

  const lintResult = lintExport(
    contentMd,
    {
      id: draft.id,
      persona_name: opts.persona,
      draft_type: opts.type,
      title: draft.title,
      selected_item_ids_json: JSON.stringify(pickedItemIds),
      selected_item_ids: pickedItemIds,
      merge_strategy: mergeStrategy,
      user_commentary: null,
      compose_json: null,
      content_md: contentMd,
      created_at: draft.created_at,
      updated_at: draft.updated_at,
    },
    pickedUrls,
  );

  logger.info(
    {
      draft_id: draft.id,
      lint_passed: lintResult.passed,
      errors: lintResult.errors.length,
      warnings: lintResult.warnings.length,
    },
    'Autopilot complete',
  );

  return {
    content: contentMd,
    draft_id: draft.id,
    lintResult,
    stats: autopilotStats,
  };
}

export interface AutopilotPlan {
  persona: string;
  type: string;
  liteScoringCount: number;
  fullUpgradeCount: number;
  composeCalls: number;
  totalLlmCalls: number;
  estimatedCost: number;
}

/**
 * Check if we should run ingest (last ingest > 4 hours ago).
 */
function shouldIngest(db: ReturnType<typeof getDb>): boolean {
  const latest = db
    .prepare(`SELECT MAX(last_fetched_at) as last FROM sources WHERE is_active = 1`)
    .get() as { last: string | null };

  if (!latest.last) return true;

  const lastFetch = new Date(latest.last);
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
  return lastFetch < fourHoursAgo;
}

/**
 * Generate a default title for autopilot drafts.
 */
function generateAutoTitle(type: DraftType, persona: Persona): string {
  const date = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
  const names: Record<string, string> = {
    wechat: '公众号文章',
    xhs: '小红书笔记',
    douyin: '抖音脚本',
  };
  return `${persona.meta.display_name} · ${names[type] ?? type} · ${date}`;
}
