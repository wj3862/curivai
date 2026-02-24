import type Database from 'better-sqlite3';
import { generateId, nowISO } from '../shared/utils.js';
import { StudioError } from '../shared/errors.js';

export type DraftType = 'wechat' | 'xhs' | 'douyin';
export type MergeStrategy = 'roundup' | 'brief' | 'compare';

export interface Draft {
  id: string;
  persona_name: string;
  draft_type: DraftType;
  title: string | null;
  selected_item_ids_json: string;
  selected_item_ids: string[];
  merge_strategy: MergeStrategy | null;
  user_commentary: string | null;
  compose_json: string | null;
  content_md: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateDraftOpts {
  persona_name: string;
  draft_type: DraftType;
  title?: string;
  selected_item_ids?: string[];
  merge_strategy?: MergeStrategy;
}

export interface UpdateDraftPatch {
  title?: string;
  selected_item_ids?: string[];
  merge_strategy?: MergeStrategy;
  user_commentary?: string;
  compose_json?: string;
  content_md?: string;
}

/**
 * Create a new draft.
 */
export function createDraft(db: Database.Database, opts: CreateDraftOpts): Draft {
  const id = generateId();
  const now = nowISO();
  const itemIds = opts.selected_item_ids ?? [];
  const itemIdsJson = JSON.stringify(itemIds);

  db.prepare(`
    INSERT INTO drafts (
      id, persona_name, draft_type, title,
      selected_item_ids_json, merge_strategy,
      user_commentary, compose_json, content_md,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)
  `).run(
    id,
    opts.persona_name,
    opts.draft_type,
    opts.title ?? null,
    itemIdsJson,
    opts.merge_strategy ?? null,
    now,
    now,
  );

  return getDraft(db, id)!;
}

/**
 * Get a draft by ID, with JSON fields parsed.
 */
export function getDraft(db: Database.Database, id: string): Draft | undefined {
  const row = db.prepare('SELECT * FROM drafts WHERE id = ?').get(id) as
    | Omit<Draft, 'selected_item_ids'>
    | undefined;

  if (!row) return undefined;

  return {
    ...row,
    selected_item_ids: JSON.parse(row.selected_item_ids_json ?? '[]') as string[],
  };
}

/**
 * Update a draft (partial update, only provided fields).
 */
export function updateDraft(db: Database.Database, id: string, patch: UpdateDraftPatch): Draft {
  const draft = getDraft(db, id);
  if (!draft) {
    throw new StudioError(`Draft not found: ${id}`);
  }

  const sets: string[] = ['updated_at = ?'];
  const values: unknown[] = [nowISO()];

  if (patch.title !== undefined) {
    sets.push('title = ?');
    values.push(patch.title);
  }
  if (patch.selected_item_ids !== undefined) {
    sets.push('selected_item_ids_json = ?');
    values.push(JSON.stringify(patch.selected_item_ids));
  }
  if (patch.merge_strategy !== undefined) {
    sets.push('merge_strategy = ?');
    values.push(patch.merge_strategy);
  }
  if (patch.user_commentary !== undefined) {
    sets.push('user_commentary = ?');
    values.push(patch.user_commentary);
  }
  if (patch.compose_json !== undefined) {
    sets.push('compose_json = ?');
    values.push(patch.compose_json);
  }
  if (patch.content_md !== undefined) {
    sets.push('content_md = ?');
    values.push(patch.content_md);
  }

  values.push(id);
  db.prepare(`UPDATE drafts SET ${sets.join(', ')} WHERE id = ?`).run(...values);

  return getDraft(db, id)!;
}

/**
 * List drafts, optionally filtered by persona.
 */
export function listDrafts(db: Database.Database, personaName?: string): Draft[] {
  let query = 'SELECT * FROM drafts';
  const params: string[] = [];

  if (personaName) {
    query += ' WHERE persona_name = ?';
    params.push(personaName);
  }

  query += ' ORDER BY updated_at DESC';

  const rows = db.prepare(query).all(...params) as Array<Omit<Draft, 'selected_item_ids'>>;
  return rows.map((row) => ({
    ...row,
    selected_item_ids: JSON.parse(row.selected_item_ids_json ?? '[]') as string[],
  }));
}

/**
 * Delete a draft by ID.
 */
export function deleteDraft(db: Database.Database, id: string): boolean {
  const result = db.prepare('DELETE FROM drafts WHERE id = ?').run(id);
  return result.changes > 0;
}
