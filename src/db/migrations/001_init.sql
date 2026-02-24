-- Migration 001_init.sql

-- ================================================================
-- SOURCE LAYER
-- ================================================================

CREATE TABLE sources (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL DEFAULT 'rss',
  url             TEXT UNIQUE NOT NULL,
  title           TEXT,
  site_domain     TEXT,
  pack_name       TEXT,
  etag            TEXT,
  last_modified   TEXT,
  last_fetched_at TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE items (
  id              TEXT PRIMARY KEY,
  source_id       TEXT NOT NULL REFERENCES sources(id),
  guid            TEXT,
  title           TEXT NOT NULL,
  url             TEXT NOT NULL,
  canonical_url   TEXT,
  dedup_key       TEXT NOT NULL,
  author          TEXT,
  published_at    TEXT,
  fetched_at      TEXT NOT NULL DEFAULT (datetime('now')),
  raw_excerpt     TEXT,
  lang            TEXT,
  word_count      INTEGER,
  read_time_min   INTEGER,
  content_text    TEXT,
  content_hash    TEXT,
  is_duplicate    INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX idx_items_dedup ON items(dedup_key);
CREATE INDEX idx_items_published ON items(published_at);
CREATE INDEX idx_items_source ON items(source_id);

-- ================================================================
-- ENGINE LAYER
-- ================================================================

CREATE TABLE personas (
  name            TEXT PRIMARY KEY,
  display_name    TEXT NOT NULL,
  description     TEXT,
  language        TEXT NOT NULL DEFAULT 'zh',
  yaml_hash       TEXT NOT NULL,
  persona_json    TEXT NOT NULL,
  is_builtin      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE cheap_scores (
  id              TEXT PRIMARY KEY,
  item_id         TEXT NOT NULL REFERENCES items(id),
  persona_name    TEXT NOT NULL REFERENCES personas(name),
  cheap_score     REAL NOT NULL,
  factors_json    TEXT NOT NULL,
  cheap_version   TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(item_id, persona_name, cheap_version)
);

CREATE TABLE score_packs (
  id                    TEXT PRIMARY KEY,
  item_id               TEXT NOT NULL REFERENCES items(id),
  persona_name          TEXT NOT NULL REFERENCES personas(name),
  pack_level            TEXT NOT NULL DEFAULT 'lite',
  topic                 TEXT,
  cn_title              TEXT NOT NULL,
  cn_summary_short      TEXT NOT NULL,
  dimension_scores_json TEXT NOT NULL,
  score_overall         INTEGER NOT NULL,
  action                TEXT NOT NULL,
  reasons_json          TEXT NOT NULL,
  angle_suggestion      TEXT,
  cn_summary_long       TEXT,
  key_points_json       TEXT,
  quotes_json           TEXT,
  model                 TEXT,
  prompt_version        TEXT,
  llm_status            TEXT NOT NULL DEFAULT 'pending',
  token_count           INTEGER,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(item_id, persona_name)
);
CREATE INDEX idx_sp_persona_score ON score_packs(persona_name, score_overall DESC);
CREATE INDEX idx_sp_topic ON score_packs(topic);

-- ================================================================
-- STUDIO LAYER
-- ================================================================

CREATE TABLE picked (
  id              TEXT PRIMARY KEY,
  persona_name    TEXT NOT NULL REFERENCES personas(name),
  item_id         TEXT NOT NULL REFERENCES items(id),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(persona_name, item_id)
);

CREATE TABLE drafts (
  id                      TEXT PRIMARY KEY,
  persona_name            TEXT NOT NULL REFERENCES personas(name),
  draft_type              TEXT NOT NULL,
  title                   TEXT,
  selected_item_ids_json  TEXT NOT NULL,
  merge_strategy          TEXT,
  user_commentary         TEXT,
  compose_json            TEXT,
  content_md              TEXT,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE exports (
  id              TEXT PRIMARY KEY,
  draft_id        TEXT NOT NULL REFERENCES drafts(id),
  format          TEXT NOT NULL,
  content         TEXT NOT NULL,
  lint_passed     INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
