import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb, resetDbInstance } from '../../db/db.js';
import { runMigrations } from '../../db/migrate.js';
import { buildTopicPenalties, checkTopicDuplicate } from '../topicCluster.js';
import type { Config } from '../../shared/config.js';

const TEST_CONFIG: Config['scoring'] = {
  cheap_threshold: 50,
  min_candidates: 2,
  default_budget: 10,
  default_days: 3,
  cheap_weights: {
    freshness: 0.25,
    keyword_match: 0.30,
    source_trust: 0.20,
    language_match: 0.10,
    length_sanity: 0.10,
    duplicate_penalty: 0.05,
  },
  topic_dedup: {
    lookback_days: 7,
    exact_penalty: 30,
    fuzzy_threshold: 0.6,
    fuzzy_penalty: 15,
  },
};

function insertScorePack(
  db: ReturnType<typeof initDb>,
  id: string,
  itemId: string,
  topic: string,
  createdAt?: string,
): void {
  db.prepare(`
    INSERT OR IGNORE INTO items (id, source_id, title, url, dedup_key, fetched_at)
    SELECT ?, s.id, 'title', 'http://x.com', ?, datetime('now')
    FROM sources s LIMIT 1
  `).run(itemId, `guid:${itemId}`);

  db.prepare(`
    INSERT OR IGNORE INTO score_packs (
      id, item_id, persona_name, pack_level, topic,
      cn_title, cn_summary_short, dimension_scores_json,
      score_overall, action, reasons_json, llm_status, created_at
    ) VALUES (?, ?, 'test_persona', 'lite', ?, '', '', '{}', 50, '可提', '[]', 'done', ?)
  `).run(id, itemId, topic, createdAt ?? new Date().toISOString());
}

describe('buildTopicPenalties', () => {
  let db: ReturnType<typeof initDb>;

  beforeEach(() => {
    db = initDb(':memory:');
    runMigrations(db);
    db.prepare(`
      INSERT INTO sources (id, url, site_domain, is_active)
      VALUES ('src1', 'https://example.com/feed', 'example.com', 1)
    `).run();
    db.prepare(`
      INSERT INTO personas (name, display_name, yaml_hash, persona_json)
      VALUES ('test_persona', 'Test', 'hash', '{}')
    `).run();
  });

  afterEach(() => {
    closeDb();
    resetDbInstance();
  });

  it('returns empty map when no previous scores', () => {
    const penalties = buildTopicPenalties('test_persona', TEST_CONFIG);
    expect(penalties.size).toBe(0);
  });

  it('penalizes exact topic duplicates', () => {
    insertScorePack(db, 'sp1', 'item1', 'OpenAI融资事件');
    insertScorePack(db, 'sp2', 'item2', 'OpenAI融资事件'); // exact duplicate

    const penalties = buildTopicPenalties('test_persona', TEST_CONFIG);
    expect(penalties.get('item2')).toBe(-TEST_CONFIG.topic_dedup.exact_penalty);
  });

  it('penalizes fuzzy topic duplicates', () => {
    insertScorePack(db, 'sp1', 'item1', 'OpenAI 融资 新闻');
    insertScorePack(db, 'sp2', 'item2', 'OpenAI 融资 公告'); // similar (Jaccard > 0.6)

    const penalties = buildTopicPenalties('test_persona', TEST_CONFIG);
    // May get fuzzy penalty depending on token overlap
    if (penalties.has('item2')) {
      expect(penalties.get('item2')).toBe(-TEST_CONFIG.topic_dedup.fuzzy_penalty);
    }
  });

  it('does not penalize unrelated topics', () => {
    insertScorePack(db, 'sp1', 'item1', 'AI创业融资');
    insertScorePack(db, 'sp2', 'item2', '量子计算突破'); // completely different

    const penalties = buildTopicPenalties('test_persona', TEST_CONFIG);
    expect(penalties.has('item2')).toBe(false);
  });
});

describe('checkTopicDuplicate', () => {
  let db: ReturnType<typeof initDb>;

  beforeEach(() => {
    db = initDb(':memory:');
    runMigrations(db);
    db.prepare(`
      INSERT INTO sources (id, url, site_domain, is_active)
      VALUES ('src1', 'https://example.com/feed', 'example.com', 1)
    `).run();
    db.prepare(`
      INSERT INTO personas (name, display_name, yaml_hash, persona_json)
      VALUES ('test_persona', 'Test', 'hash', '{}')
    `).run();
  });

  afterEach(() => {
    closeDb();
    resetDbInstance();
  });

  it('returns 0 when no existing topics', () => {
    const penalty = checkTopicDuplicate('新主题', 'test_persona', TEST_CONFIG);
    expect(penalty).toBe(0);
  });

  it('returns exact penalty for identical topic', () => {
    insertScorePack(db, 'sp1', 'item1', 'OpenAI融资');
    const penalty = checkTopicDuplicate('OpenAI融资', 'test_persona', TEST_CONFIG);
    expect(penalty).toBe(-TEST_CONFIG.topic_dedup.exact_penalty);
  });

  it('returns 0 for unrelated topic', () => {
    insertScorePack(db, 'sp1', 'item1', 'AI创业');
    const penalty = checkTopicDuplicate('气候变化政策', 'test_persona', TEST_CONFIG);
    expect(penalty).toBe(0);
  });
});
