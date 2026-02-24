import fs from 'node:fs';
import path from 'node:path';
import { parse as yamlParse } from 'yaml';
import type Database from 'better-sqlite3';
import { PersonaSchema, type Persona } from './schema.js';
import { sha1 } from '../shared/utils.js';
import { PersonaError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';

export function parsePersonaYaml(yamlContent: string): Persona {
  const raw = yamlParse(yamlContent) as unknown;
  const result = PersonaSchema.safeParse(raw);
  if (!result.success) {
    throw new PersonaError('Invalid persona YAML', {
      errors: result.error.flatten().fieldErrors,
    });
  }
  return result.data;
}

export function loadPersonaFile(filePath: string): Persona {
  if (!fs.existsSync(filePath)) {
    throw new PersonaError(`Persona file not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return parsePersonaYaml(content);
}

export function loadPersonasFromDir(dir: string): Persona[] {
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  const personas: Persona[] = [];

  for (const file of files) {
    try {
      const persona = loadPersonaFile(path.join(dir, file));
      personas.push(persona);
    } catch (err) {
      logger.warn({ file, error: err instanceof Error ? err.message : String(err) }, 'Failed to load persona');
    }
  }

  return personas;
}

export function syncPersonaToDb(
  db: Database.Database,
  persona: Persona,
  isBuiltin: boolean,
): boolean {
  const yamlHash = sha1(JSON.stringify(persona));
  const personaJson = JSON.stringify(persona);

  const existing = db
    .prepare('SELECT yaml_hash FROM personas WHERE name = ?')
    .get(persona.meta.name) as { yaml_hash: string } | undefined;

  if (existing && existing.yaml_hash === yamlHash) {
    return false; // no change
  }

  const stmt = db.prepare(`
    INSERT INTO personas (name, display_name, description, language, yaml_hash, persona_json, is_builtin, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(name) DO UPDATE SET
      display_name = excluded.display_name,
      description = excluded.description,
      language = excluded.language,
      yaml_hash = excluded.yaml_hash,
      persona_json = excluded.persona_json,
      is_builtin = excluded.is_builtin,
      updated_at = datetime('now')
  `);

  stmt.run(
    persona.meta.name,
    persona.meta.display_name,
    persona.meta.description,
    persona.meta.language,
    yamlHash,
    personaJson,
    isBuiltin ? 1 : 0,
  );

  logger.info({ persona: persona.meta.name }, existing ? 'Persona updated' : 'Persona created');
  return true;
}

export function syncAllPersonas(
  db: Database.Database,
  personasDir: string,
): { synced: number; total: number } {
  const personas = loadPersonasFromDir(personasDir);
  let synced = 0;

  for (const persona of personas) {
    const changed = syncPersonaToDb(db, persona, true);
    if (changed) synced++;
  }

  return { synced, total: personas.length };
}

export function listPersonasFromDb(
  db: Database.Database,
): Array<{ name: string; display_name: string; language: string; is_builtin: boolean }> {
  const rows = db
    .prepare('SELECT name, display_name, language, is_builtin FROM personas ORDER BY name')
    .all() as Array<{
    name: string;
    display_name: string;
    language: string;
    is_builtin: number;
  }>;

  return rows.map((r) => ({
    name: r.name,
    display_name: r.display_name,
    language: r.language,
    is_builtin: r.is_builtin === 1,
  }));
}
