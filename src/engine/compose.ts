import { getDb } from '../db/db.js';
import { getLlmClient } from '../llm/client.js';
import { buildComposeMessages, PROMPT_VERSIONS } from '../llm/prompts.js';
import { ComposeOutputSchema, parseWithRetry } from '../llm/parse.js';
import { renderExport } from '../studio/export.js';
import { updateDraft, getDraft } from '../studio/drafts.js';
import { ComposeError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';
import type { Persona } from '../persona/schema.js';
import type { ComposeSelectedItem } from '../llm/prompts.js';

export interface ComposeStats {
  draft_id: string;
  items_composed: number;
  token_count: number;
  cost_estimate: number;
  prompt_version: string;
}

interface ScorePackRow {
  item_id: string;
  pack_level: string;
  cn_title: string | null;
  cn_summary_short: string | null;
  cn_summary_long: string | null;
  key_points_json: string | null;
  quotes_json: string | null;
  score_overall: number | null;
  angle_suggestion: string | null;
}

interface ItemRow {
  id: string;
  title: string;
  url: string;
  site_domain: string | null;
}

/**
 * Run the Compose pipeline for a draft:
 * 1. Load draft + picked items from DB
 * 2. Assert all score_packs are full (abort if not)
 * 3. Call LLM compose
 * 4. Render export via renderExport()
 * 5. Update draft with compose_json + content_md
 */
export async function runCompose(
  draftId: string,
  persona: Persona,
): Promise<ComposeStats> {
  const db = getDb();
  const client = getLlmClient();

  // 1. Load draft
  const draft = getDraft(db, draftId);
  if (!draft) {
    throw new ComposeError(`Draft not found: ${draftId}`);
  }

  if (draft.selected_item_ids.length === 0) {
    throw new ComposeError(`Draft ${draftId} has no selected items. Add items to the picked basket first.`);
  }

  // 2. Load full score_packs for each item
  const selectedItems: ComposeSelectedItem[] = [];
  const notFullItems: string[] = [];

  for (let i = 0; i < draft.selected_item_ids.length; i++) {
    const itemId = draft.selected_item_ids[i]!;

    const sp = db
      .prepare(`
        SELECT item_id, pack_level, cn_title, cn_summary_short, cn_summary_long,
               key_points_json, quotes_json, score_overall, angle_suggestion
        FROM score_packs
        WHERE item_id = ? AND persona_name = ? AND llm_status = 'done'
      `)
      .get(itemId, persona.meta.name) as ScorePackRow | undefined;

    if (!sp || sp.pack_level !== 'full') {
      notFullItems.push(itemId);
      continue;
    }

    const item = db
      .prepare(`
        SELECT i.id, i.title, i.url, s.site_domain
        FROM items i LEFT JOIN sources s ON i.source_id = s.id
        WHERE i.id = ?
      `)
      .get(itemId) as ItemRow | undefined;

    if (!item) continue;

    selectedItems.push({
      index: i + 1,
      cn_title: sp.cn_title ?? item.title,
      score_overall: sp.score_overall ?? 0,
      source_domain: item.site_domain ?? new URL(item.url).hostname,
      url: item.url,
      cn_summary_short: sp.cn_summary_short ?? '',
      cn_summary_long: sp.cn_summary_long,
      key_points: JSON.parse(sp.key_points_json ?? '[]') as string[],
      quotes: JSON.parse(sp.quotes_json ?? '[]') as Array<{ original: string; translated: string }>,
      angle_suggestion: sp.angle_suggestion,
    });
  }

  if (notFullItems.length > 0) {
    throw new ComposeError(
      `${notFullItems.length} item(s) are not fully scored. ` +
        `Pick them first to trigger full upgrade: ${notFullItems.join(', ')}`,
      { not_full: notFullItems },
    );
  }

  if (selectedItems.length === 0) {
    throw new ComposeError('No valid scored items found for compose.');
  }

  // 3. Determine prompt version from draft_type
  const promptVersionKey =
    draft.draft_type === 'wechat'
      ? PROMPT_VERSIONS.compose_wechat
      : draft.draft_type === 'xhs'
        ? PROMPT_VERSIONS.compose_xhs
        : PROMPT_VERSIONS.compose_douyin;

  // 4. Build messages and call LLM
  const messages = buildComposeMessages({
    persona,
    draft_type: draft.draft_type,
    merge_strategy: draft.merge_strategy ?? 'roundup',
    selected_items: selectedItems,
    user_commentary: draft.user_commentary ?? '',
    max_quote_words_en: persona.output.max_quote_words_en,
  });

  logger.info(
    {
      draft_id: draftId,
      persona: persona.meta.name,
      items: selectedItems.length,
      draft_type: draft.draft_type,
      merge_strategy: draft.merge_strategy,
    },
    'Running compose',
  );

  const llmResponse = await client.chat(messages);
  const composeOutput = await parseWithRetry(
    ComposeOutputSchema,
    llmResponse.content,
    client,
    messages[0]!.content,
  );

  // 5. Render export
  const contentMd = renderExport(composeOutput, draft);

  // 6. Update draft
  updateDraft(db, draftId, {
    compose_json: JSON.stringify(composeOutput),
    content_md: contentMd,
  });

  logger.info(
    {
      draft_id: draftId,
      tokens: llmResponse.token_count,
      cost: llmResponse.cost_estimate,
      prompt_version: promptVersionKey,
    },
    'Compose complete',
  );

  return {
    draft_id: draftId,
    items_composed: selectedItems.length,
    token_count: llmResponse.token_count,
    cost_estimate: llmResponse.cost_estimate,
    prompt_version: promptVersionKey,
  };
}
