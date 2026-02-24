import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb, resetDbInstance } from '../../db/db.js';
import { runMigrations } from '../../db/migrate.js';
import { runCheapFilter, computeCheapVersion } from '../cheapFilter.js';
import type { Persona } from '../../persona/schema.js';
import type { Config } from '../../shared/config.js';

const TEST_PERSONA: Persona = {
  meta: {
    name: 'test_persona',
    display_name: 'Test',
    description: 'Test persona',
    language: 'zh',
    author: 'test',
    version: '1.0',
    tags: [],
  },
  profile: {
    identity: 'Test identity',
    goals: ['Test goal'],
    anti_goals: [],
  },
  scoring: {
    dimensions: [
      {
        name: 'Test',
        key: 'test_dim',
        weight: 1.0,
        description: 'Test dimension',
      },
    ],
  },
  signals: {
    positive: {
      keywords: ['AI', 'funding', 'launch'],
      domains: ['techcrunch.com'],
    },
    negative: {
      keywords: ['spam', '课程'],
      domains: [],
    },
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
    tone: 'test tone',
    structure_hints: ['hook'],
    platform_default: 'wechat',
  },
};

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

function insertTestSource(db: ReturnType<typeof initDb>): string {
  const sourceId = 'src_test_001';
  db.prepare(`
    INSERT OR IGNORE INTO sources (id, url, title, site_domain, is_active)
    VALUES (?, 'https://techcrunch.com/feed/', 'TechCrunch', 'techcrunch.com', 1)
  `).run(sourceId);
  return sourceId;
}

function insertTestItem(
  db: ReturnType<typeof initDb>,
  sourceId: string,
  opts: { id: string; title: string; lang?: string; word_count?: number; published_at?: string; is_duplicate?: number },
): void {
  const publishedAt = opts.published_at ?? new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO items (id, source_id, title, url, dedup_key, lang, word_count, published_at, is_duplicate, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    opts.id,
    sourceId,
    opts.title,
    `https://example.com/${opts.id}`,
    `guid:${opts.id}`,
    opts.lang ?? 'en',
    opts.word_count ?? 500,
    publishedAt,
    opts.is_duplicate ?? 0,
  );
}

describe('cheapFilter', () => {
  let db: ReturnType<typeof initDb>;

  beforeEach(() => {
    db = initDb(':memory:');
    runMigrations(db);
    // Insert a persona for FK constraints
    db.prepare(`
      INSERT INTO personas (name, display_name, yaml_hash, persona_json)
      VALUES ('test_persona', 'Test', 'hash', '{}')
    `).run();
  });

  afterEach(() => {
    closeDb();
    resetDbInstance();
  });

  it('returns candidates above threshold', () => {
    const sourceId = insertTestSource(db);
    insertTestItem(db, sourceId, {
      id: 'item_001',
      title: 'AI startup raises $50M funding round on TechCrunch',
      lang: 'en',
      word_count: 500,
    });
    insertTestItem(db, sourceId, {
      id: 'item_002',
      title: 'Random low quality post',
      lang: 'ja', // not in allow_languages
      word_count: 50,
    });

    const results = runCheapFilter(TEST_PERSONA, TEST_CONFIG, 7);
    expect(results.length).toBeGreaterThan(0);

    // item_001 should score higher (keyword match + trusted domain + en language)
    const scores = results.map((r) => r.item_id);
    expect(scores).toContain('item_001');
  });

  it('applies negative keyword penalty', () => {
    const sourceId = insertTestSource(db);
    insertTestItem(db, sourceId, {
      id: 'item_spam',
      title: '免费AI课程培训 spam offer',
      lang: 'zh',
      word_count: 200,
    });

    const results = runCheapFilter(TEST_PERSONA, TEST_CONFIG, 7);
    const spamItem = results.find((r) => r.item_id === 'item_spam');
    if (spamItem) {
      expect(spamItem.factors.keyword_match).toBeLessThan(50);
    }
  });

  it('penalizes duplicate items', () => {
    const sourceId = insertTestSource(db);
    insertTestItem(db, sourceId, {
      id: 'item_dupe',
      title: 'AI launch announcement',
      lang: 'en',
      word_count: 500,
      is_duplicate: 1,
    });

    const results = runCheapFilter(TEST_PERSONA, TEST_CONFIG, 7);
    const dupeItem = results.find((r) => r.item_id === 'item_dupe');
    if (dupeItem) {
      expect(dupeItem.factors.duplicate_penalty).toBe(-50);
    }
  });

  it('falls back to min_candidates when threshold yields too few', () => {
    const sourceId = insertTestSource(db);
    // Insert items that will all be below threshold
    for (let i = 0; i < 5; i++) {
      insertTestItem(db, sourceId, {
        id: `item_low_${i}`,
        title: 'Generic article with no keywords',
        lang: 'fr', // not in allow_languages
        word_count: 50,
        published_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days old
      });
    }

    const results = runCheapFilter(TEST_PERSONA, TEST_CONFIG, 7);
    // Should return at least min_candidates (2) even if all below threshold
    expect(results.length).toBeGreaterThanOrEqual(TEST_CONFIG.min_candidates);
  });

  it('returns results sorted by cheap_score descending', () => {
    const sourceId = insertTestSource(db);
    insertTestItem(db, sourceId, {
      id: 'item_high',
      title: 'AI funding launch',
      lang: 'en',
      word_count: 500,
    });
    insertTestItem(db, sourceId, {
      id: 'item_low',
      title: 'unrelated topic in japanese',
      lang: 'ja',
      word_count: 50,
    });

    const results = runCheapFilter(TEST_PERSONA, TEST_CONFIG, 7);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.cheap_score).toBeGreaterThanOrEqual(results[i]!.cheap_score);
    }
  });

  it('persists cheap scores to DB', () => {
    const sourceId = insertTestSource(db);
    insertTestItem(db, sourceId, { id: 'item_persist', title: 'AI article launch', lang: 'en', word_count: 300 });

    runCheapFilter(TEST_PERSONA, TEST_CONFIG, 7);

    const row = db
      .prepare('SELECT cheap_score FROM cheap_scores WHERE item_id = ?')
      .get('item_persist') as { cheap_score: number } | undefined;

    expect(row).toBeDefined();
    expect(row!.cheap_score).toBeGreaterThanOrEqual(0);
  });
});

describe('computeCheapVersion', () => {
  it('returns a stable version string', () => {
    const weights = TEST_CONFIG.cheap_weights;
    const v1 = computeCheapVersion(weights);
    const v2 = computeCheapVersion(weights);
    expect(v1).toBe(v2);
    expect(v1).toMatch(/^cheap_v1_[a-f0-9]+$/);
  });

  it('changes version when weights change', () => {
    const w1 = { ...TEST_CONFIG.cheap_weights, freshness: 0.1 };
    const w2 = { ...TEST_CONFIG.cheap_weights, freshness: 0.5 };
    expect(computeCheapVersion(w1)).not.toBe(computeCheapVersion(w2));
  });
});
