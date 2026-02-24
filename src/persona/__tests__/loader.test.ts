import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../db/migrate.js';
import {
  parsePersonaYaml,
  syncPersonaToDb,
  listPersonasFromDb,
  loadPersonasFromDir,
} from '../loader.js';
import { getPackageRoot } from '../../shared/utils.js';
import path from 'node:path';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
});

afterEach(() => {
  db.close();
});

const sampleYaml = `
meta:
  name: test_persona
  display_name: "Test Persona"
  description: "A test persona"
profile:
  identity: "Test identity"
  goals:
    - "Goal 1"
scoring:
  dimensions:
    - name: "Dim1"
      key: dim_one
      weight: 0.6
      description: "First dimension"
    - name: "Dim2"
      key: dim_two
      weight: 0.4
      description: "Second dimension"
`;

describe('parsePersonaYaml', () => {
  it('parses valid YAML into Persona object', () => {
    const persona = parsePersonaYaml(sampleYaml);
    expect(persona.meta.name).toBe('test_persona');
    expect(persona.scoring.dimensions).toHaveLength(2);
  });

  it('throws on invalid YAML', () => {
    expect(() => parsePersonaYaml('meta:\n  name: "BAD NAME"')).toThrow();
  });
});

describe('syncPersonaToDb', () => {
  it('inserts a new persona', () => {
    const persona = parsePersonaYaml(sampleYaml);
    const changed = syncPersonaToDb(db, persona, true);
    expect(changed).toBe(true);

    const rows = listPersonasFromDb(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('test_persona');
    expect(rows[0]!.is_builtin).toBe(true);
  });

  it('returns false when persona has not changed', () => {
    const persona = parsePersonaYaml(sampleYaml);
    syncPersonaToDb(db, persona, true);
    const changed = syncPersonaToDb(db, persona, true);
    expect(changed).toBe(false);
  });

  it('updates persona when content changes', () => {
    const persona = parsePersonaYaml(sampleYaml);
    syncPersonaToDb(db, persona, true);

    const modified = { ...persona, meta: { ...persona.meta, description: 'Updated' } };
    const changed = syncPersonaToDb(db, modified, true);
    expect(changed).toBe(true);
  });
});

describe('loadPersonasFromDir', () => {
  it('loads built-in personas from project personas/ dir', () => {
    const personasDir = path.join(getPackageRoot(), 'personas');
    const personas = loadPersonasFromDir(personasDir);
    expect(personas.length).toBeGreaterThanOrEqual(3);

    const names = personas.map((p) => p.meta.name);
    expect(names).toContain('ai_entrepreneur');
    expect(names).toContain('investor_kol');
    expect(names).toContain('tech_translator');
  });

  it('returns empty array for nonexistent directory', () => {
    const personas = loadPersonasFromDir('/nonexistent/dir');
    expect(personas).toEqual([]);
  });
});

describe('listPersonasFromDb', () => {
  it('returns empty array when no personas loaded', () => {
    const rows = listPersonasFromDb(db);
    expect(rows).toEqual([]);
  });
});
