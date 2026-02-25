#!/usr/bin/env node

import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, writeDefaultConfig } from '../shared/config.js';
import { getCurivaiDir, getPackageRoot, resolvePath } from '../shared/utils.js';
import { initDb, closeDb, resetDbInstance } from '../db/db.js';
import { runMigrations } from '../db/migrate.js';
import { syncAllPersonas, listPersonasFromDb } from '../persona/loader.js';
import { listAvailablePacks, loadRadarPack } from '../shared/packs.js';
import {
  addSource,
  listSources,
  getSourceItemCounts,
} from '../source/sourceDb.js';
import { parseOpmlFile, parseBatchUrlFile } from '../source/opml.js';
import { runIngest } from '../source/ingest.js';
import { startServer } from '../api/server.js';
import { initLlmClient } from '../llm/client.js';
import { runCheapFilter } from '../engine/cheapFilter.js';
import { runScorePackLite } from '../engine/scorePack.js';
import { buildTopicPenalties } from '../engine/topicCluster.js';
import { addToPicked, removePicked, listPicked, clearPicked } from '../studio/picked.js';
import {
  createDraft,
  getDraft,
  updateDraft,
  listDrafts,
} from '../studio/drafts.js';
import { lintExport } from '../studio/lint.js';
import { runCompose } from '../engine/compose.js';
import { runAutopilot, type AutopilotPlan } from '../engine/autopilot.js';
import { listPresets, runPreset } from '../engine/preset.js';
import readline from 'node:readline';

const program = new Command();

program
  .name('curivai')
  .description('AI workbench for Chinese content creators')
  .version('0.1.0');

// === init ===
program
  .command('init')
  .description('Initialize CurivAI: create config, database, and load personas')
  .action(async () => {
    const curivaiDir = getCurivaiDir();
    const configPath = path.join(curivaiDir, 'config.yaml');
    const personasDir = path.join(curivaiDir, 'personas');

    // 1. Create config
    if (!fs.existsSync(configPath)) {
      writeDefaultConfig(configPath);
      log('✓ ~/.curivai/config.yaml created');
    } else {
      log('✓ ~/.curivai/config.yaml already exists');
    }

    // 2. Copy built-in personas
    const builtinDir = path.join(getPackageRoot(), 'personas');
    fs.mkdirSync(personasDir, { recursive: true });

    if (fs.existsSync(builtinDir)) {
      const files = fs.readdirSync(builtinDir).filter((f) => f.endsWith('.yaml'));
      for (const file of files) {
        const dest = path.join(personasDir, file);
        if (!fs.existsSync(dest)) {
          fs.copyFileSync(path.join(builtinDir, file), dest);
        }
      }
    }

    // 3. Init database
    const config = await loadConfig();
    const dbPath = resolvePath(config.db.path);
    const db = initDb(dbPath);
    const { applied } = runMigrations(db);
    if (applied.length > 0) {
      log(`✓ ~/.curivai/curivai.db created (${applied.length} migrations applied)`);
    } else {
      log('✓ ~/.curivai/curivai.db already up to date');
    }

    // 4. Sync personas to DB
    const { total } = syncAllPersonas(db, personasDir);
    log(`✓ ${total} persona YAMLs copied, all pass zod validation`);

    closeDb();
    resetDbInstance();
  });

// === doctor ===
program
  .command('doctor')
  .description('Check system health: config, database, personas, LLM')
  .action(async () => {
    const results: string[] = [];

    // Config check
    try {
      const config = await loadConfig();
      results.push('DB: checking...');

      // DB check
      try {
        const dbPath = resolvePath(config.db.path);
        if (!fs.existsSync(dbPath)) {
          results[0] = 'DB: missing (run curivai init)';
        } else {
          const db = initDb(dbPath);
          runMigrations(db);
          results[0] = 'DB: ok';

          // Personas check
          const personas = listPersonasFromDb(db);
          results.push(`Personas: ${personas.length} loaded`);

          // Sources check
          const sources = listSources(db);
          results.push(`Sources: ${sources.length}`);

          closeDb();
          resetDbInstance();
        }
      } catch (err) {
        results[0] = `DB: error (${err instanceof Error ? err.message : String(err)})`;
      }

      // LLM check
      if (config.llm.api_key) {
        results.push('LLM: configured');
      } else {
        results.push('LLM: (unconfigured)');
      }

      // Config itself
      results.unshift('Config: ok');
    } catch (err) {
      results.unshift(`Config: error (${err instanceof Error ? err.message : String(err)})`);
    }

    log(`✓ ${results.join(' | ')}`);
  });

// === personas ===
const personasCmd = program.command('personas').description('Manage personas');

personasCmd
  .command('list')
  .description('List all loaded personas')
  .action(async () => {
    const config = await loadConfig();
    const dbPath = resolvePath(config.db.path);

    if (!fs.existsSync(dbPath)) {
      log('Database not found. Run curivai init first.');
      process.exitCode = 1;
      return;
    }

    const db = initDb(dbPath);
    runMigrations(db);

    // Ensure personas are synced
    const personasDir = resolvePath(config.personas_dir);
    syncAllPersonas(db, personasDir);

    const personas = listPersonasFromDb(db);

    if (personas.length === 0) {
      log('No personas loaded.');
    } else {
      for (const p of personas) {
        const builtinTag = p.is_builtin ? '✓ built-in' : '  custom';
        log(`${p.name.padEnd(18)} ${p.display_name.padEnd(14)} ${p.language}   ${builtinTag}`);
      }
    }

    closeDb();
    resetDbInstance();
  });

// === packs ===
program
  .command('packs')
  .description('List available radar packs')
  .action(() => {
    const packs = listAvailablePacks();
    for (const pack of packs) {
      log(`${pack.name.padEnd(20)} ${pack.file}`);
    }
  });

// === source ===
const sourceCmd = program.command('source').description('Manage sources');

sourceCmd
  .command('add <url>')
  .description('Add a single RSS source')
  .option('-t, --title <title>', 'Source title')
  .action(async (url: string, opts: { title?: string }) => {
    const { db, cleanup } = await getDb();
    try {
      const id = addSource(db, { url, title: opts.title });
      if (id === null) {
        log(`Source already exists: ${url}`);
      } else {
        log(`✓ Source added: ${url}`);
      }
    } finally {
      cleanup();
    }
  });

sourceCmd
  .command('add-batch <file>')
  .description('Add sources from a newline-separated URL file')
  .action(async (file: string) => {
    const { db, cleanup } = await getDb();
    try {
      const feeds = parseBatchUrlFile(resolvePath(file));
      let added = 0;
      let skipped = 0;
      for (const feed of feeds) {
        const id = addSource(db, { url: feed.url, title: feed.title });
        if (id) {
          added++;
        } else {
          skipped++;
        }
      }
      log(`✓ ${added} sources added, ${skipped} duplicates skipped`);
    } finally {
      cleanup();
    }
  });

sourceCmd
  .command('import-opml <path>')
  .description('Import sources from OPML file')
  .action(async (opmlPath: string) => {
    const { db, cleanup } = await getDb();
    try {
      const feeds = parseOpmlFile(resolvePath(opmlPath));
      let added = 0;
      let skipped = 0;
      for (const feed of feeds) {
        const id = addSource(db, { url: feed.url, title: feed.title });
        if (id) {
          added++;
        } else {
          skipped++;
        }
      }
      log(`✓ ${added} sources imported from OPML, ${skipped} duplicates skipped`);
    } finally {
      cleanup();
    }
  });

sourceCmd
  .command('install-pack <packName>')
  .description('Install a radar source pack')
  .action(async (packName: string) => {
    const { db, cleanup } = await getDb();
    try {
      const pack = loadRadarPack(packName);
      let added = 0;
      let skipped = 0;
      for (const packSource of pack.sources) {
        const id = addSource(db, {
          url: packSource.url,
          title: packSource.title,
          pack_name: pack.name,
        });
        if (id) {
          added++;
        } else {
          skipped++;
        }
      }
      log(`✓ ${added} sources added from pack "${pack.display_name}", ${skipped} duplicates skipped`);
    } finally {
      cleanup();
    }
  });

sourceCmd
  .command('list')
  .description('List all configured sources')
  .action(async () => {
    const { db, cleanup } = await getDb();
    try {
      const sources = listSources(db);
      const counts = getSourceItemCounts(db);
      const countMap = new Map(counts.map((c) => [c.source_id, c.count]));

      if (sources.length === 0) {
        log('No sources configured. Use: curivai source add <url>');
      } else {
        for (const s of sources) {
          const itemCount = countMap.get(s.id) ?? 0;
          const status = s.is_active ? '●' : '○';
          const domain = (s.site_domain ?? '').padEnd(25);
          const title = (s.title ?? '').padEnd(20);
          const lastFetch = s.last_fetched_at ?? 'never';
          log(`${status} ${domain} ${title} ${String(itemCount).padStart(4)} items  last: ${lastFetch}`);
        }
        log(`\n${sources.length} sources total`);
      }
    } finally {
      cleanup();
    }
  });

// === ingest ===
program
  .command('ingest')
  .description('Fetch new items from all active sources')
  .option('-l, --limit <n>', 'Max items to ingest', '200')
  .option('-s, --since-hours <h>', 'Only fetch sources not fetched in this many hours')
  .option('-c, --concurrency <n>', 'Concurrent source fetches')
  .action(async (opts: { limit: string; sinceHours?: string; concurrency?: string }) => {
    const { db, config, cleanup } = await getDb();
    try {
      log('Ingesting from active sources...');
      const stats = await runIngest(db, config, {
        limit: parseInt(opts.limit, 10),
        sinceHours: opts.sinceHours ? parseInt(opts.sinceHours, 10) : undefined,
        concurrency: opts.concurrency ? parseInt(opts.concurrency, 10) : undefined,
      });

      log(`\nIngest complete:`);
      log(`  Sources processed: ${stats.sourcesProcessed}`);
      log(`  Sources failed:    ${stats.sourcesFailed}`);
      log(`  Items fetched:     ${stats.itemsFetched}`);
      log(`  Items new:         ${stats.itemsNew}`);
      log(`  Items duplicate:   ${stats.itemsDuplicate}`);
      log(`  Content dupes:     ${stats.itemsContentDuplicate}`);
      log(`  Duration:          ${stats.durationMs}ms`);

      if (stats.errors.length > 0) {
        log('\nErrors:');
        for (const e of stats.errors) {
          log(`  ${e.source}: ${e.error}`);
        }
      }
    } finally {
      cleanup();
    }
  });

// === score ===
program
  .command('score')
  .description('Run CheapFilter + ScorePack Lite for a persona')
  .requiredOption('-p, --persona <name>', 'Persona name')
  .option('-b, --budget <n>', 'Max LLM calls', '30')
  .option('-d, --days <n>', 'Lookback days', '3')
  .option('-f, --force', 'Re-score already scored items', false)
  .action(async (opts: { persona: string; budget: string; days: string; force: boolean }) => {
    const { db, config, cleanup } = await getDbWithPersonas();
    try {
      const personaRow = db
        .prepare('SELECT name, persona_json FROM personas WHERE name = ?')
        .get(opts.persona) as { name: string; persona_json: string } | undefined;

      if (!personaRow) {
        log(`Persona not found: ${opts.persona}`);
        log('Available personas:');
        const all = listPersonasFromDb(db);
        for (const p of all) log(`  ${p.name}`);
        process.exitCode = 1;
        return;
      }

      initLlmClient(config.llm);
      const persona = JSON.parse(personaRow.persona_json);
      const budget = parseInt(opts.budget, 10);
      const days = parseInt(opts.days, 10);

      log(`Scoring for persona: ${opts.persona} (budget=${budget}, days=${days})`);

      const topicPenalties = buildTopicPenalties(opts.persona, config.scoring);
      const candidates = runCheapFilter(persona, config.scoring, days, topicPenalties);
      const budgeted = candidates.slice(0, budget);

      log(`CheapFilter: ${candidates.length} candidates → ${budgeted.length} sent to LLM`);

      const stats = await runScorePackLite(budgeted, persona, config.ingest.content_excerpt_chars, opts.force);

      log(`\nScore complete:`);
      log(`  Attempted:       ${stats.attempted}`);
      log(`  Succeeded:       ${stats.succeeded}`);
      log(`  Failed:          ${stats.failed}`);
      log(`  Skipped (cache): ${stats.skipped_cached}`);
      log(`  Total tokens:    ${stats.total_tokens}`);
      log(`  Total cost:      $${stats.total_cost.toFixed(4)}`);
    } finally {
      cleanup();
    }
  });

// === feed ===
program
  .command('feed')
  .description('List scored items for a persona')
  .requiredOption('-p, --persona <name>', 'Persona name')
  .option('-n, --top <n>', 'Number of items to show', '20')
  .option('-d, --days <n>', 'Lookback days', '3')
  .option('-a, --action <action>', 'Filter by action (可写|可提|可转|跳过)')
  .action(async (opts: { persona: string; top: string; days: string; action?: string }) => {
    const { db, cleanup } = await getDbWithPersonas();
    try {
      const top = parseInt(opts.top, 10);
      const days = parseInt(opts.days, 10);
      const since = new Date();
      since.setDate(since.getDate() - days);

      const params: (string | number)[] = [opts.persona, since.toISOString()];
      let query = `
        SELECT sp.item_id, sp.cn_title, sp.score_overall, sp.action, sp.angle_suggestion,
               i.url, i.published_at, s.site_domain
        FROM score_packs sp
        JOIN items i ON sp.item_id = i.id
        LEFT JOIN sources s ON i.source_id = s.id
        WHERE sp.persona_name = ? AND sp.llm_status = 'done' AND i.published_at >= ?
      `;
      if (opts.action) {
        query += ' AND sp.action = ?';
        params.push(opts.action);
      }
      query += ' ORDER BY sp.score_overall DESC LIMIT ?';
      params.push(top);

      const rows = db.prepare(query).all(...params) as Array<{
        item_id: string;
        cn_title: string;
        score_overall: number;
        action: string;
        angle_suggestion: string;
        url: string;
        published_at: string;
        site_domain: string;
      }>;

      if (rows.length === 0) {
        log(`No scored items found for persona "${opts.persona}". Run: curivai score --persona ${opts.persona}`);
        return;
      }

      const actionColor: Record<string, string> = { '可写': '🔴', '可提': '🟡', '可转': '🔵', '跳过': '⚪' };
      for (const row of rows) {
        const icon = actionColor[row.action] ?? '  ';
        log(`${String(row.score_overall).padStart(3)} ${icon} ${row.action}  [${row.item_id.slice(0, 8)}]`);
        log(`   ${row.cn_title}`);
        if (row.angle_suggestion) log(`   💡 ${row.angle_suggestion}`);
        log(`   ${row.site_domain ?? ''} · ${row.published_at?.slice(0, 10) ?? ''}`);
        log('');
      }
    } finally {
      cleanup();
    }
  });

// === compare ===
program
  .command('compare <itemId>')
  .description('Show cached scores for an item across all personas')
  .action(async (itemId: string) => {
    const { db, cleanup } = await getDbWithPersonas();
    try {
      const item = db
        .prepare('SELECT id, title, url FROM items WHERE id = ? OR id LIKE ?')
        .get(itemId, `${itemId}%`) as { id: string; title: string; url: string } | undefined;

      if (!item) {
        log(`Item not found: ${itemId}`);
        process.exitCode = 1;
        return;
      }

      log(`Item: ${item.title}`);
      log(`URL:  ${item.url}`);
      log('');

      const personas = listPersonasFromDb(db);
      for (const p of personas) {
        const sp = db
          .prepare(`SELECT score_overall, action, angle_suggestion FROM score_packs
                    WHERE item_id = ? AND persona_name = ? AND llm_status = 'done'`)
          .get(item.id, p.name) as { score_overall: number; action: string; angle_suggestion: string } | undefined;

        if (sp) {
          log(`${p.display_name.padEnd(16)} ${String(sp.score_overall).padStart(3)}分  ${sp.action}`);
          if (sp.angle_suggestion) log(`  💡 ${sp.angle_suggestion}`);
        } else {
          log(`${p.display_name.padEnd(16)} 未评分  (run: curivai score --persona ${p.name})`);
        }
      }
    } finally {
      cleanup();
    }
  });

// === server ===
program
  .command('server')
  .description('Start the API server and web UI')
  .option('-p, --port <n>', 'Port number')
  .option('--open', 'Open browser automatically on startup')
  .action(async (opts: { port?: string; open?: boolean }) => {
    await startServer({
      port: opts.port ? parseInt(opts.port, 10) : undefined,
      open: opts.open ?? false,
    });
  });

// === stats ===
program
  .command('stats')
  .description('Show usage statistics')
  .action(async () => {
    const { db, cleanup } = await getDb();
    try {
      const sources = db.prepare('SELECT COUNT(*) as count FROM sources').get() as { count: number };
      const items = db.prepare('SELECT COUNT(*) as count FROM items').get() as { count: number };
      const withContent = db
        .prepare('SELECT COUNT(*) as count FROM items WHERE content_text IS NOT NULL')
        .get() as { count: number };
      const dupes = db
        .prepare('SELECT COUNT(*) as count FROM items WHERE is_duplicate = 1')
        .get() as { count: number };

      log(`Sources:            ${sources.count}`);
      log(`Items:              ${items.count}`);
      log(`With content:       ${withContent.count}`);
      log(`Content duplicates: ${dupes.count}`);
    } finally {
      cleanup();
    }
  });

// === Helper to get DB + sync personas ===
async function getDbWithPersonas(): Promise<{
  db: ReturnType<typeof initDb>;
  config: Awaited<ReturnType<typeof loadConfig>>;
  cleanup: () => void;
}> {
  const result = await getDb();
  const personasDir = resolvePath(result.config.personas_dir);
  syncAllPersonas(result.db, personasDir);
  return result;
}

// === Helper to get DB connection ===
async function getDb(): Promise<{
  db: ReturnType<typeof initDb>;
  config: Awaited<ReturnType<typeof loadConfig>>;
  cleanup: () => void;
}> {
  const config = await loadConfig();
  const dbPath = resolvePath(config.db.path);

  if (!fs.existsSync(dbPath)) {
    log('Database not found. Run curivai init first.');
    process.exit(1);
  }

  const db = initDb(dbPath);
  runMigrations(db);

  return {
    db,
    config,
    cleanup: () => {
      closeDb();
      resetDbInstance();
    },
  };
}

// === pick ===
const pickCmd = program.command('pick').description('Manage the picked item basket');

pickCmd
  .command('add <itemIds...>')
  .description('Add items to the picked basket (triggers ScorePack Full upgrade)')
  .requiredOption('-p, --persona <name>', 'Persona name')
  .action(async (itemIds: string[], opts: { persona: string }) => {
    const { db, config, cleanup } = await getDbWithPersonas();
    try {
      initLlmClient(config.llm);

      const personaRow = db
        .prepare('SELECT name, persona_json FROM personas WHERE name = ?')
        .get(opts.persona) as { name: string; persona_json: string } | undefined;

      if (!personaRow) {
        log(`Persona not found: ${opts.persona}`);
        process.exitCode = 1;
        return;
      }

      const persona = JSON.parse(personaRow.persona_json);

      for (const itemId of itemIds) {
        // Support short IDs (prefix match)
        const resolved = db
          .prepare('SELECT id FROM items WHERE id = ? OR id LIKE ?')
          .get(itemId, `${itemId}%`) as { id: string } | undefined;

        if (!resolved) {
          log(`Item not found: ${itemId}`);
          continue;
        }

        log(`Adding ${resolved.id.slice(0, 8)}... to picked basket...`);
        const added = await addToPicked(db, resolved.id, opts.persona, persona, config.ingest.content_excerpt_chars);
        if (added) {
          log(`✓ Added and upgraded to full ScorePack: ${resolved.id.slice(0, 8)}`);
        } else {
          log(`  Already in basket: ${resolved.id.slice(0, 8)}`);
        }
      }
    } finally {
      cleanup();
    }
  });

pickCmd
  .command('remove <itemId>')
  .description('Remove an item from the picked basket')
  .requiredOption('-p, --persona <name>', 'Persona name')
  .action(async (itemId: string, opts: { persona: string }) => {
    const { db, cleanup } = await getDb();
    try {
      // Support short IDs
      const resolved = db
        .prepare('SELECT id FROM items WHERE id = ? OR id LIKE ?')
        .get(itemId, `${itemId}%`) as { id: string } | undefined;

      if (!resolved) {
        log(`Item not found: ${itemId}`);
        process.exitCode = 1;
        return;
      }

      const removed = removePicked(db, resolved.id, opts.persona);
      if (removed) {
        log(`✓ Removed from picked basket: ${resolved.id.slice(0, 8)}`);
      } else {
        log(`Item not in basket: ${resolved.id.slice(0, 8)}`);
      }
    } finally {
      cleanup();
    }
  });

pickCmd
  .command('list')
  .description('List items in the picked basket')
  .requiredOption('-p, --persona <name>', 'Persona name')
  .action(async (opts: { persona: string }) => {
    const { db, cleanup } = await getDbWithPersonas();
    try {
      const items = listPicked(db, opts.persona);

      if (items.length === 0) {
        log(`No items in picked basket for persona "${opts.persona}".`);
        log(`Use: curivai pick add <itemId> --persona ${opts.persona}`);
        return;
      }

      log(`Picked basket for ${opts.persona} (${items.length} items):\n`);
      for (const item of items) {
        const score = item.score_overall != null ? `${item.score_overall}分` : '未评分';
        const packLevel = item.pack_level ?? '?';
        log(`[${item.item_id.slice(0, 8)}] ${score}  [${packLevel}]`);
        log(`   ${item.cn_title ?? item.original_title}`);
        log(`   ${item.site_domain ?? ''} · ${item.url}`);
        log('');
      }
    } finally {
      cleanup();
    }
  });

pickCmd
  .command('clear')
  .description('Clear all items from the picked basket')
  .requiredOption('-p, --persona <name>', 'Persona name')
  .action(async (opts: { persona: string }) => {
    const { db, cleanup } = await getDb();
    try {
      const count = clearPicked(db, opts.persona);
      log(`✓ Cleared ${count} items from picked basket for "${opts.persona}"`);
    } finally {
      cleanup();
    }
  });

// === draft ===
const draftCmd = program.command('draft').description('Manage drafts');

draftCmd
  .command('create')
  .description('Create a new draft')
  .requiredOption('-p, --persona <name>', 'Persona name')
  .requiredOption('-t, --type <format>', 'Export type: wechat|xhs|douyin')
  .option('--title <title>', 'Draft title')
  .option('-s, --strategy <strategy>', 'Merge strategy: roundup|brief|compare')
  .action(async (opts: { persona: string; type: string; title?: string; strategy?: string }) => {
    const { db, cleanup } = await getDbWithPersonas();
    try {
      const validTypes = ['wechat', 'xhs', 'douyin'];
      if (!validTypes.includes(opts.type)) {
        log(`Invalid type: ${opts.type}. Must be one of: ${validTypes.join(', ')}`);
        process.exitCode = 1;
        return;
      }

      // Get picked items
      const picked = listPicked(db, opts.persona);
      if (picked.length === 0) {
        log(`No items in picked basket for "${opts.persona}". Use: curivai pick add <itemId> --persona ${opts.persona}`);
        process.exitCode = 1;
        return;
      }

      const draft = createDraft(db, {
        persona_name: opts.persona,
        draft_type: opts.type as 'wechat' | 'xhs' | 'douyin',
        title: opts.title,
        selected_item_ids: picked.map((p) => p.item_id),
        merge_strategy: opts.strategy as 'roundup' | 'brief' | 'compare' | undefined,
      });

      log(`✓ Draft created: ${draft.id}`);
      log(`  Persona: ${draft.persona_name}`);
      log(`  Type: ${draft.draft_type}`);
      log(`  Items: ${draft.selected_item_ids.length}`);
      log(`  Strategy: ${draft.merge_strategy ?? 'roundup'}`);
      log(`\n  Run: curivai draft compose --draft ${draft.id}`);
    } finally {
      cleanup();
    }
  });

draftCmd
  .command('compose')
  .description('Run LLM compose for a draft')
  .requiredOption('--draft <id>', 'Draft ID')
  .action(async (opts: { draft: string }) => {
    const { db, config, cleanup } = await getDbWithPersonas();
    try {
      initLlmClient(config.llm);

      const draft = getDraft(db, opts.draft);
      if (!draft) {
        log(`Draft not found: ${opts.draft}`);
        process.exitCode = 1;
        return;
      }

      const personaRow = db
        .prepare('SELECT name, persona_json FROM personas WHERE name = ?')
        .get(draft.persona_name) as { name: string; persona_json: string } | undefined;

      if (!personaRow) {
        log(`Persona not found: ${draft.persona_name}`);
        process.exitCode = 1;
        return;
      }

      const persona = JSON.parse(personaRow.persona_json);
      log(`Composing draft ${opts.draft}...`);

      const stats = await runCompose(opts.draft, persona);

      log(`\n✓ Compose complete:`);
      log(`  Items: ${stats.items_composed}`);
      log(`  Tokens: ${stats.token_count}`);
      log(`  Cost: $${stats.cost_estimate.toFixed(4)}`);
      log(`\n  Run: curivai draft export --draft ${opts.draft} --format ${draft.draft_type} --out ./draft.md`);
    } finally {
      cleanup();
    }
  });

draftCmd
  .command('comment')
  .description("Add or update creator's commentary on a draft")
  .requiredOption('--draft <id>', 'Draft ID')
  .requiredOption('--text <text>', 'Commentary text')
  .action(async (opts: { draft: string; text: string }) => {
    const { db, cleanup } = await getDb();
    try {
      const draft = getDraft(db, opts.draft);
      if (!draft) {
        log(`Draft not found: ${opts.draft}`);
        process.exitCode = 1;
        return;
      }

      updateDraft(db, opts.draft, { user_commentary: opts.text });
      log(`✓ Commentary updated for draft ${opts.draft}`);
    } finally {
      cleanup();
    }
  });

draftCmd
  .command('export')
  .description('Export a draft to a file')
  .requiredOption('--draft <id>', 'Draft ID')
  .requiredOption('-f, --format <format>', 'Format: wechat|xhs|douyin')
  .requiredOption('--out <path>', 'Output file path')
  .action(async (opts: { draft: string; format: string; out: string }) => {
    const { db, cleanup } = await getDb();
    try {
      const draft = getDraft(db, opts.draft);
      if (!draft) {
        log(`Draft not found: ${opts.draft}`);
        process.exitCode = 1;
        return;
      }

      if (!draft.content_md) {
        log(`Draft has no content. Run compose first: curivai draft compose --draft ${opts.draft}`);
        process.exitCode = 1;
        return;
      }

      const pickedUrls = draft.selected_item_ids.map((id) => {
        const item = db.prepare('SELECT url FROM items WHERE id = ?').get(id) as
          | { url: string }
          | undefined;
        return item?.url ?? '';
      });

      const lintResult = lintExport(draft.content_md, draft, pickedUrls);

      if (!lintResult.passed) {
        log('✗ Export blocked by linter:');
        for (const err of lintResult.errors) {
          log(`  ERROR: ${err}`);
        }
        process.exitCode = 1;
        return;
      }

      if (lintResult.warnings.length > 0) {
        log('⚠ Linter warnings:');
        for (const w of lintResult.warnings) {
          log(`  WARN: ${w}`);
        }
      }

      import('node:fs').then((fs) => {
        fs.writeFileSync(resolvePath(opts.out), draft.content_md!, 'utf-8');
        log(`\n✓ Exported to: ${opts.out}`);
        log(`  Format: ${opts.format}`);
        log(`  Linter: passed`);
      });
    } finally {
      cleanup();
    }
  });

draftCmd
  .command('list')
  .description('List all drafts')
  .option('-p, --persona <name>', 'Filter by persona')
  .action(async (opts: { persona?: string }) => {
    const { db, cleanup } = await getDb();
    try {
      const drafts = listDrafts(db, opts.persona);

      if (drafts.length === 0) {
        log('No drafts found.');
        return;
      }

      for (const d of drafts) {
        const hasContent = d.content_md ? '✓' : '○';
        log(`${hasContent} [${d.id.slice(0, 8)}] ${d.draft_type.padEnd(8)} ${d.persona_name.padEnd(20)} ${d.title ?? '(no title)'}`);
        log(`   Updated: ${d.updated_at} · Items: ${d.selected_item_ids.length}`);
        log('');
      }
    } finally {
      cleanup();
    }
  });

draftCmd
  .command('show <id>')
  .description('Show draft details')
  .action(async (id: string) => {
    const { db, cleanup } = await getDb();
    try {
      const draft = getDraft(db, id);
      if (!draft) {
        log(`Draft not found: ${id}`);
        process.exitCode = 1;
        return;
      }

      log(`Draft: ${draft.id}`);
      log(`Persona: ${draft.persona_name}`);
      log(`Type: ${draft.draft_type}`);
      log(`Title: ${draft.title ?? '(none)'}`);
      log(`Strategy: ${draft.merge_strategy ?? 'roundup'}`);
      log(`Items: ${draft.selected_item_ids.length}`);
      log(`Commentary: ${draft.user_commentary ? 'yes' : 'none'}`);
      log(`Content: ${draft.content_md ? `${draft.content_md.length} chars` : 'not yet composed'}`);
      log(`Created: ${draft.created_at}`);
      log(`Updated: ${draft.updated_at}`);

      if (draft.content_md) {
        log('\n--- Content Preview (first 500 chars) ---');
        log(draft.content_md.slice(0, 500));
        if (draft.content_md.length > 500) log('...');
      }
    } finally {
      cleanup();
    }
  });

// === autopilot ===
program
  .command('autopilot')
  .description('Run the full autopilot pipeline: ingest → score → pick → compose → export')
  .requiredOption('-p, --persona <name>', 'Persona name')
  .requiredOption('-t, --type <format>', 'Export type: wechat|xhs|douyin')
  .option('--out <path>', 'Output file path')
  .option('-b, --budget <n>', 'Max ScorePack Lite calls', '30')
  .option('-d, --days <n>', 'Lookback days', '3')
  .option('--auto-pick-count <n>', 'Number of items to auto-pick', '5')
  .option('--auto-pick-filter <action>', 'Action filter for auto-pick', '可写')
  .option('--strategy <strategy>', 'Merge strategy: roundup|brief|compare', 'roundup')
  .option('-y, --yes', 'Skip confirmation prompt', false)
  .action(
    async (opts: {
      persona: string;
      type: string;
      out?: string;
      budget: string;
      days: string;
      autoPickCount: string;
      autoPickFilter: string;
      strategy: string;
      yes: boolean;
    }) => {
      const { config, cleanup } = await getDbWithPersonas();
      try {
        initLlmClient(config.llm);

        const result = await runAutopilot(
          {
            persona: opts.persona,
            type: opts.type as 'wechat' | 'xhs' | 'douyin',
            budget: parseInt(opts.budget, 10),
            days: parseInt(opts.days, 10),
            autoPickCount: parseInt(opts.autoPickCount, 10),
            autoPickFilter: opts.autoPickFilter,
            mergeStrategy: opts.strategy as 'roundup' | 'brief' | 'compare',
            yes: opts.yes,
          },
          config,
          async (plan: AutopilotPlan) => {
            log('\nCurivAI Autopilot Plan:');
            log(`  Persona:       ${plan.persona}`);
            log(`  Format:        ${plan.type}`);
            log(`  Lite scoring:  ${plan.liteScoringCount} items`);
            log(`  Full upgrade:  ${plan.fullUpgradeCount} items`);
            log(`  Compose:       ${plan.composeCalls} draft`);
            log(`  Total LLM:     ${plan.totalLlmCalls} calls`);
            log(`  Est. cost:     $${plan.estimatedCost.toFixed(4)}`);

            if (opts.yes) {
              log('  (--yes flag, skipping confirmation)');
              return true;
            }

            return new Promise<boolean>((resolve) => {
              const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
              rl.question('\n  Proceed? [Y/n] ', (answer) => {
                rl.close();
                resolve(answer.trim().toLowerCase() !== 'n');
              });
            });
          },
        );

        if (opts.out) {
          import('node:fs').then((fs) => {
            fs.writeFileSync(resolvePath(opts.out!), result.content, 'utf-8');
            log(`\n✓ Written to: ${opts.out}`);
          });
        } else {
          log('\n--- Generated Content ---');
          log(result.content);
        }

        log(`\n✓ Autopilot complete:`);
        log(`  Draft ID:     ${result.draft_id}`);
        log(`  Items picked: ${result.stats.items_picked}`);
        log(`  LLM calls:    ${result.stats.total_llm_calls}`);
        log(`  Cost:         $${result.stats.estimated_cost.toFixed(4)}`);
        log(`  Lint:         ${result.lintResult.passed ? 'passed' : 'failed'}`);

        if (result.lintResult.errors.length > 0) {
          log('\n⚠ Lint errors:');
          for (const e of result.lintResult.errors) {
            log(`  ${e}`);
          }
          process.exitCode = 1;
        }
        if (result.lintResult.warnings.length > 0) {
          log('\n⚠ Lint warnings:');
          for (const w of result.lintResult.warnings) {
            log(`  ${w}`);
          }
        }
      } finally {
        cleanup();
      }
    },
  );

// === preset ===
const presetCmd = program.command('preset').description('Run workflow presets');

presetCmd
  .command('list')
  .description('List available presets')
  .action(() => {
    const presets = listPresets();
    if (presets.length === 0) {
      log('No presets found.');
      return;
    }
    for (const p of presets) {
      log(`${p.name.padEnd(25)} ${p.display_name}`);
      log(`  ${p.description}`);
      log(`  persona=${p.persona}  days=${p.days}  budget=${p.lite_budget}  format=${p.export_format}`);
      log('');
    }
  });

presetCmd
  .command('run <name>')
  .description('Run a preset (full autopilot from preset config)')
  .option('--out <path>', 'Output file path')
  .option('-y, --yes', 'Skip confirmation prompt', false)
  .action(async (name: string, opts: { out?: string; yes: boolean }) => {
    const { config, cleanup } = await getDbWithPersonas();
    try {
      initLlmClient(config.llm);

      log(`Running preset: ${name}`);

      const content = await runPreset(
        name,
        { out: opts.out, yes: opts.yes },
        config,
        async (plan: AutopilotPlan) => {
          log('\nCurivAI Preset Plan:');
          log(`  Preset:        ${name}`);
          log(`  Persona:       ${plan.persona}`);
          log(`  Format:        ${plan.type}`);
          log(`  Total LLM:     ${plan.totalLlmCalls} calls`);
          log(`  Est. cost:     $${plan.estimatedCost.toFixed(4)}`);

          if (opts.yes) {
            log('  (--yes flag, skipping confirmation)');
            return true;
          }

          return new Promise<boolean>((resolve) => {
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            rl.question('\n  Proceed? [Y/n] ', (answer) => {
              rl.close();
              resolve(answer.trim().toLowerCase() !== 'n');
            });
          });
        },
      );

      if (opts.out) {
        log(`\n✓ Preset complete. Written to: ${opts.out}`);
      } else {
        log('\n--- Generated Content ---');
        log(content);
        log('\n✓ Preset complete.');
      }
    } finally {
      cleanup();
    }
  });

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(msg);
}

// When running as a pkg-bundled .exe with no subcommand (i.e. double-clicked),
// default to "server --open" so the browser opens automatically.
const isPkg = !!(process as unknown as { pkg?: unknown }).pkg;
const hasSubcommand = process.argv.slice(2).some(a => !a.startsWith('-'));
if (isPkg && !hasSubcommand) {
  process.argv.splice(2, 0, 'server', '--open');
}

program.parse();
