# CurivAI Architecture

## Overview

CurivAI is a four-layer system: Source → Engine → Studio → Push.
Every layer is independently testable and replaceable.

```
┌─────────────────────────────────────────────────────────────┐
│                   PUSH LAYER                                 │
│   Email digest (nodemailer + MJML) │ node-cron scheduler    │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────┴─────────────────────────────────┐
│                   WEB LAYER                                  │
│   React 18 + Vite + Tailwind + shadcn/ui                    │
│   Feed (发现) │ Studio (创作) │ Sources (管理)               │
└───────────────────────────┬─────────────────────────────────┘
                            │ REST API (Hono)
┌───────────────────────────┴─────────────────────────────────┐
│                   ENGINE LAYER                               │
│   CheapFilter │ ScorePack (LLM) │ Compose (LLM)            │
│   TopicCluster │ Autopilot │ Digest │ Preset Runner         │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────┴─────────────────────────────────┐
│                   SOURCE LAYER                               │
│   RSS Adapter │ Content Extractor │ Dedup │ SQLite Store    │
└─────────────────────────────────────────────────────────────┘
```

## Source Layer

**Files:** `src/source/`

| Module | Responsibility |
|--------|---------------|
| `adapter.ts` | `SourceAdapter` interface — RSS is the first implementation |
| `rss.ts` | RSS adapter: fetch → parse → `RawItem[]` |
| `extract.ts` | Readability extraction of `content_text` from article HTML |
| `dedup.ts` | `dedup_key` generation: `guid > canonical_url > hash(title+date+domain)` |
| `ingest.ts` | Orchestrates: fetch sources → deduplicate → extract → store |

**Key invariant:** Each item has a `dedup_key` unique index. Re-running ingest is always safe.

## Engine Layer

**Files:** `src/engine/`

### CheapFilter (`cheapFilter.ts`)
- Zero LLM calls. Pure heuristic scoring on: freshness, keyword match, source trust, language match, length sanity.
- Filters candidates before any LLM call, keeping costs low.
- Versioned by `cheap_v1_<sha1(weights)>` — weight changes invalidate cache automatically.

### ScorePack (`scorePack.ts`)
- **Lite**: Called for all CheapFilter candidates. Produces `cn_title`, `cn_summary_short`, `dimension_scores`, `score_overall`, `action`, `reasons`, `angle_suggestion`, `topic`.
- **Full**: On-demand upgrade triggered when user picks an item. Adds `cn_summary_long`, `key_points`, `quotes`.
- Dynamic Zod schema built from persona dimensions — strict validation prevents extra/missing keys.

### TopicCluster (`topicCluster.ts`)
- Runs after ScorePack Lite. Penalizes items whose `topic` is a near-duplicate of already-scored items.
- Token Jaccard similarity (no ML dependencies).

### Compose (`compose.ts`)
- Called after ScorePack Full for all picked items.
- Merge strategies: `roundup` (weekly brief), `brief` (focused), `compare` (comparison).
- Asserts all picked items have `pack_level = 'full'` before calling LLM.

### Autopilot (`autopilot.ts`)
- Full pipeline in one command: ingest → cheapFilter → scorePackLite → autoPick → scorePackFull → compose → export.
- Budget guard: estimates total LLM calls + cost before executing.

## Studio Layer

**Files:** `src/studio/`

| Module | Responsibility |
|--------|---------------|
| `picked.ts` | Picked basket CRUD + triggers Full upgrade on `add` |
| `drafts.ts` | Draft CRUD + merge strategy storage |
| `export.ts` | Platform-specific rendering (wechat / xhs / douyin) |
| `lint.ts` | Hard-blocks exports missing attribution; warns on suspected full translation |

## LLM Layer

**Files:** `src/llm/`

| Module | Responsibility |
|--------|---------------|
| `client.ts` | OpenAI-compatible wrapper with concurrency limit + retry/backoff |
| `prompts.ts` | All prompt templates as versioned string constants |
| `parse.ts` | `parseWithRetry()` — parse LLM output with Zod, retry once on failure |

**Prompt injection defence:** Article content is marked as UNTRUSTED DATA in the system prompt. Content is truncated to `config.ingest.content_excerpt_chars`. LLM output is parsed with strict Zod schemas — any injection attempt that produces invalid JSON fails closed.

## API Layer

**Files:** `src/api/`

Single Hono app. All routes prefixed with `/api`. Static web assets served from `dist/web/` when present.

Route groups: `sources`, `ingest`, `score` (+ feed), `compare`, `studio` (picked + drafts + exports), `autopilot`, `presets`, `personas`, `digest`, `system` (health + stats + doctor).

## Push Layer

**Files:** `src/push/`

| Module | Responsibility |
|--------|---------------|
| `email.ts` | MJML template → HTML, nodemailer send |
| `scheduler.ts` | node-cron: ingest every 4h, digest daily at 8am |

## Data Flow: Full Autopilot Run

```
1. runIngest()
   └─ For each active source → RssAdapter.fetch() → dedup → extract → store

2. runCheapFilter(persona)
   └─ Score all items in window heuristically → candidates[]

3. runScorePackLite(candidates, budget)
   └─ LLM call per item → score_packs (lite) + topic_cluster update

4. autoPick(top N with action=可写)
   └─ addToPicked() → upgradeToFull() → LLM call per item

5. createDraft() + runCompose()
   └─ LLM call → content_md

6. lintExport() → write to disk / return via API
```

## Database Schema

See `src/db/migrations/001_init.sql` for the full schema.

Key tables: `sources`, `items`, `personas`, `cheap_scores`, `score_packs`, `picked`, `drafts`, `exports`.

## Configuration

Config loaded from (in priority order):
1. `$CURIVAI_CONFIG` env var
2. `~/.curivai/config.yaml`
3. Hardcoded Zod defaults

LLM credentials: `$CURIVAI_LLM_API_KEY`, `$CURIVAI_LLM_BASE_URL`, `$CURIVAI_LLM_MODEL`.

See `.env.example` for all supported env vars.
