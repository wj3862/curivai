import type Database from 'better-sqlite3';
import { generateId, nowISO } from '../shared/utils.js';
import { upgradeToFull } from '../engine/scorePack.js';
import { StudioError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';
import type { Persona } from '../persona/schema.js';

export interface PickedItem {
  id: string;
  persona_name: string;
  item_id: string;
  sort_order: number;
  created_at: string;
  // Joined fields from items + score_packs
  original_title: string;
  url: string;
  published_at: string | null;
  site_domain: string | null;
  cn_title: string | null;
  cn_summary_short: string | null;
  cn_summary_long: string | null;
  key_points_json: string | null;
  quotes_json: string | null;
  score_overall: number | null;
  action: string | null;
  angle_suggestion: string | null;
  pack_level: string | null;
}

/**
 * Add an item to the picked basket for a persona.
 * Triggers ScorePack Full upgrade if the item is not yet fully scored.
 * Returns true if newly added, false if already in basket.
 */
export async function addToPicked(
  db: Database.Database,
  itemId: string,
  personaName: string,
  persona: Persona,
  contentExcerptChars: number,
): Promise<boolean> {
  // Verify item exists
  const item = db.prepare('SELECT id FROM items WHERE id = ?').get(itemId) as { id: string } | undefined;
  if (!item) {
    throw new StudioError(`Item not found: ${itemId}`);
  }

  // Verify persona exists
  const personaRow = db.prepare('SELECT name FROM personas WHERE name = ?').get(personaName) as
    | { name: string }
    | undefined;
  if (!personaRow) {
    throw new StudioError(`Persona not found: ${personaName}`);
  }

  // Check if already picked
  const existing = db
    .prepare('SELECT id FROM picked WHERE item_id = ? AND persona_name = ?')
    .get(itemId, personaName) as { id: string } | undefined;

  if (existing) {
    logger.debug({ item_id: itemId, persona: personaName }, 'Item already in picked basket');
    return false;
  }

  // Determine sort order (max + 1)
  const maxOrder = db
    .prepare('SELECT MAX(sort_order) as m FROM picked WHERE persona_name = ?')
    .get(personaName) as { m: number | null };
  const sortOrder = (maxOrder.m ?? -1) + 1;

  // Insert into picked
  db.prepare(`
    INSERT INTO picked (id, persona_name, item_id, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(generateId(), personaName, itemId, sortOrder, nowISO());

  logger.info({ item_id: itemId, persona: personaName }, 'Item added to picked basket');

  // Trigger ScorePack Full upgrade
  try {
    await upgradeToFull(itemId, persona, contentExcerptChars);
  } catch (err) {
    logger.warn(
      { item_id: itemId, error: err instanceof Error ? err.message : String(err) },
      'Failed to upgrade to full ScorePack — item remains in basket with lite score',
    );
  }

  return true;
}

/**
 * Remove an item from the picked basket.
 */
export function removePicked(db: Database.Database, itemId: string, personaName: string): boolean {
  const result = db
    .prepare('DELETE FROM picked WHERE item_id = ? AND persona_name = ?')
    .run(itemId, personaName);
  return result.changes > 0;
}

/**
 * List all items in the picked basket for a persona, with full score_pack data.
 */
export function listPicked(db: Database.Database, personaName: string): PickedItem[] {
  return db
    .prepare(`
      SELECT
        p.id, p.persona_name, p.item_id, p.sort_order, p.created_at,
        i.title as original_title, i.url, i.published_at,
        s.site_domain,
        sp.cn_title, sp.cn_summary_short, sp.cn_summary_long,
        sp.key_points_json, sp.quotes_json,
        sp.score_overall, sp.action, sp.angle_suggestion,
        sp.pack_level
      FROM picked p
      JOIN items i ON p.item_id = i.id
      LEFT JOIN sources s ON i.source_id = s.id
      LEFT JOIN score_packs sp ON sp.item_id = p.item_id AND sp.persona_name = p.persona_name
      WHERE p.persona_name = ?
      ORDER BY p.sort_order ASC
    `)
    .all(personaName) as PickedItem[];
}

/**
 * Clear all items from the picked basket for a persona.
 */
export function clearPicked(db: Database.Database, personaName: string): number {
  const result = db.prepare('DELETE FROM picked WHERE persona_name = ?').run(personaName);
  return result.changes;
}

/**
 * Get the item IDs in the picked basket for a persona (for compose).
 */
export function getPickedItemIds(db: Database.Database, personaName: string): string[] {
  const rows = db
    .prepare('SELECT item_id FROM picked WHERE persona_name = ? ORDER BY sort_order ASC')
    .all(personaName) as Array<{ item_id: string }>;
  return rows.map((r) => r.item_id);
}
