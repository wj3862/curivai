import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../migrate.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
});

afterEach(() => {
  db.close();
});

describe('runMigrations', () => {
  it('creates all tables from 001_init.sql', () => {
    const { applied } = runMigrations(db);
    expect(applied).toContain('001_init.sql');

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('sources');
    expect(tableNames).toContain('items');
    expect(tableNames).toContain('personas');
    expect(tableNames).toContain('cheap_scores');
    expect(tableNames).toContain('score_packs');
    expect(tableNames).toContain('picked');
    expect(tableNames).toContain('drafts');
    expect(tableNames).toContain('exports');
    expect(tableNames).toContain('_migrations');
  });

  it('is idempotent (second run applies nothing)', () => {
    const first = runMigrations(db);
    expect(first.applied.length).toBeGreaterThan(0);

    const second = runMigrations(db);
    expect(second.applied.length).toBe(0);
    expect(second.skipped.length).toBeGreaterThan(0);
  });

  it('records applied migrations in _migrations table', () => {
    runMigrations(db);

    const rows = db.prepare('SELECT name FROM _migrations').all() as Array<{ name: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.name === '001_init.sql')).toBe(true);
  });

  it('creates correct indexes', () => {
    runMigrations(db);

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .all() as Array<{ name: string }>;

    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain('idx_items_dedup');
    expect(indexNames).toContain('idx_items_published');
    expect(indexNames).toContain('idx_items_source');
    expect(indexNames).toContain('idx_sp_persona_score');
    expect(indexNames).toContain('idx_sp_topic');
  });
});
