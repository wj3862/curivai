import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initDb, closeDb, resetDbInstance } from '../../db/db.js';
import { runMigrations } from '../../db/migrate.js';
import { addToPicked, removePicked, listPicked, clearPicked, getPickedItemIds } from '../picked.js';
import type { Persona } from '../../persona/schema.js';

// Mock upgradeToFull to avoid real LLM calls in tests
vi.mock('../../engine/scorePack.js', () => ({
  upgradeToFull: vi.fn().mockResolvedValue(undefined),
}));

// Minimal test persona
const testPersona: Persona = {
  meta: {
    name: 'test_persona',
    display_name: 'Test Persona',
    description: 'Test',
    language: 'zh',
    author: 'test',
    version: '1.0',
    tags: [],
  },
  profile: {
    identity: 'A test persona',
    goals: ['test goal'],
    anti_goals: [],
  },
  scoring: {
    dimensions: [
      {
        name: 'test',
        key: 'test_dim',
        weight: 1.0,
        description: 'test',
      },
    ],
  },
  signals: {
    positive: { keywords: [], domains: [] },
    negative: { keywords: [], domains: [] },
  },
  constraints: {
    max_age_days: 7,
    allow_languages: ['en', 'zh'],
    min_word_count: 100,
  },
  output: {
    preview_max_chars: 120,
    reasons_max: 3,
    max_quotes: 3,
    max_quote_words_en: 15,
    translation: 'auto',
  },
  creator_style: {
    tone: 'test',
    structure_hints: ['hook'],
    platform_default: 'wechat',
  },
};

let db: Database.Database;

function seedTestData(db: Database.Database) {
  // Insert persona
  db.prepare(`
    INSERT OR IGNORE INTO personas (name, display_name, description, language, yaml_hash, persona_json, is_builtin)
    VALUES ('test_persona', 'Test Persona', 'test', 'zh', 'hash1', '{}', 0)
  `).run();

  // Insert source
  db.prepare(`
    INSERT OR IGNORE INTO sources (id, type, url, title, is_active)
    VALUES ('src1', 'rss', 'https://example.com/feed', 'Test Source', 1)
  `).run();

  // Insert items
  db.prepare(`
    INSERT OR IGNORE INTO items (id, source_id, title, url, dedup_key, fetched_at)
    VALUES
      ('item1', 'src1', 'Test Article 1', 'https://example.com/1', 'guid:item1', datetime('now')),
      ('item2', 'src1', 'Test Article 2', 'https://example.com/2', 'guid:item2', datetime('now')),
      ('item3', 'src1', 'Test Article 3', 'https://example.com/3', 'guid:item3', datetime('now'))
  `).run();
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  // Override the singleton for tests
  (global as Record<string, unknown>).__db_override__ = db;

  // Initialize using the module's initDb with in-memory DB
  initDb(':memory:');
  const testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  runMigrations(testDb);
  seedTestData(testDb);
  db = testDb;
  // Reset global singleton to use our test db
  resetDbInstance();
  // Re-initialize with a fresh in-memory DB and run migrations
  const realDb = initDb(':memory:');
  runMigrations(realDb);
  seedTestData(realDb);
  db = realDb;
});

afterEach(() => {
  closeDb();
  resetDbInstance();
  vi.clearAllMocks();
});

describe('addToPicked', () => {
  it('adds an item to the picked basket', async () => {
    const added = await addToPicked(db, 'item1', 'test_persona', testPersona, 3000);
    expect(added).toBe(true);

    const items = listPicked(db, 'test_persona');
    expect(items).toHaveLength(1);
    expect(items[0]?.item_id).toBe('item1');
  });

  it('returns false if item already in basket (idempotent)', async () => {
    await addToPicked(db, 'item1', 'test_persona', testPersona, 3000);
    const added2 = await addToPicked(db, 'item1', 'test_persona', testPersona, 3000);
    expect(added2).toBe(false);

    const items = listPicked(db, 'test_persona');
    expect(items).toHaveLength(1);
  });

  it('assigns sequential sort_order', async () => {
    await addToPicked(db, 'item1', 'test_persona', testPersona, 3000);
    await addToPicked(db, 'item2', 'test_persona', testPersona, 3000);
    await addToPicked(db, 'item3', 'test_persona', testPersona, 3000);

    const items = listPicked(db, 'test_persona');
    expect(items[0]?.sort_order).toBe(0);
    expect(items[1]?.sort_order).toBe(1);
    expect(items[2]?.sort_order).toBe(2);
  });

  it('throws StudioError for non-existent item', async () => {
    await expect(
      addToPicked(db, 'nonexistent', 'test_persona', testPersona, 3000),
    ).rejects.toThrow('Item not found');
  });

  it('throws StudioError for non-existent persona', async () => {
    await expect(
      addToPicked(db, 'item1', 'nonexistent_persona', testPersona, 3000),
    ).rejects.toThrow('Persona not found');
  });
});

describe('removePicked', () => {
  it('removes an item from the basket', async () => {
    await addToPicked(db, 'item1', 'test_persona', testPersona, 3000);
    const removed = removePicked(db, 'item1', 'test_persona');
    expect(removed).toBe(true);

    const items = listPicked(db, 'test_persona');
    expect(items).toHaveLength(0);
  });

  it('returns false if item not in basket', () => {
    const removed = removePicked(db, 'item1', 'test_persona');
    expect(removed).toBe(false);
  });
});

describe('listPicked', () => {
  it('returns empty array when basket is empty', () => {
    const items = listPicked(db, 'test_persona');
    expect(items).toHaveLength(0);
  });

  it('returns items with original_title and url from items join', async () => {
    await addToPicked(db, 'item1', 'test_persona', testPersona, 3000);
    const items = listPicked(db, 'test_persona');

    expect(items[0]?.original_title).toBe('Test Article 1');
    expect(items[0]?.url).toBe('https://example.com/1');
  });

  it('returns null for score_pack fields when not scored', async () => {
    await addToPicked(db, 'item1', 'test_persona', testPersona, 3000);
    const items = listPicked(db, 'test_persona');

    expect(items[0]?.cn_title).toBeNull();
    expect(items[0]?.score_overall).toBeNull();
    expect(items[0]?.pack_level).toBeNull();
  });

  it('returns score_pack data when item is scored', async () => {
    // Insert a score pack for item1
    db.prepare(`
      INSERT INTO score_packs (id, item_id, persona_name, pack_level, cn_title, cn_summary_short,
        dimension_scores_json, score_overall, action, reasons_json, llm_status, cn_summary_long)
      VALUES ('sp1', 'item1', 'test_persona', 'full', '测试标题', '摘要',
        '{"test_dim":85}', 85, '可写', '["理由"]', 'done', '详细摘要')
    `).run();

    await addToPicked(db, 'item1', 'test_persona', testPersona, 3000);
    const items = listPicked(db, 'test_persona');

    expect(items[0]?.cn_title).toBe('测试标题');
    expect(items[0]?.score_overall).toBe(85);
    expect(items[0]?.pack_level).toBe('full');
    expect(items[0]?.cn_summary_long).toBe('详细摘要');
  });
});

describe('clearPicked', () => {
  it('removes all items from the basket', async () => {
    await addToPicked(db, 'item1', 'test_persona', testPersona, 3000);
    await addToPicked(db, 'item2', 'test_persona', testPersona, 3000);

    const count = clearPicked(db, 'test_persona');
    expect(count).toBe(2);

    const items = listPicked(db, 'test_persona');
    expect(items).toHaveLength(0);
  });

  it('returns 0 when basket is already empty', () => {
    const count = clearPicked(db, 'test_persona');
    expect(count).toBe(0);
  });
});

describe('getPickedItemIds', () => {
  it('returns item ids in sort order', async () => {
    await addToPicked(db, 'item1', 'test_persona', testPersona, 3000);
    await addToPicked(db, 'item2', 'test_persona', testPersona, 3000);
    await addToPicked(db, 'item3', 'test_persona', testPersona, 3000);

    const ids = getPickedItemIds(db, 'test_persona');
    expect(ids).toEqual(['item1', 'item2', 'item3']);
  });
});
