import { z } from 'zod';
import type { Persona } from '../persona/schema.js';
import { logger } from '../shared/logger.js';
import { LlmError } from '../shared/errors.js';
import type { LlmClient } from './client.js';
import { buildRepairPrompt } from './prompts.js';

// ============================================================
// Compose Output Schema
// ============================================================

export const ComposeSourceSchema = z.object({
  title: z.string(),
  url: z.string(),
  domain: z.string(),
});

export const DouyinSegmentSchema = z.object({
  voiceover: z.string(),
  subtitle: z.string(),
  shot_suggestion: z.string(),
});

export const DouyinPlatformSpecificSchema = z.object({
  hook_0_3s: z.string().optional(),
  segments: z.array(DouyinSegmentSchema).optional(),
  cta: z.string().optional(),
});

export const ComposeOutputSchema = z.object({
  title_candidates: z.array(z.string()).min(1).max(5),
  content_md: z.string().min(10),
  tags: z.array(z.string()),
  sources: z.array(ComposeSourceSchema),
  platform_specific: z.record(z.unknown()),
});

export type ComposeOutput = {
  title_candidates: string[];
  content_md: string;
  tags: string[];
  sources: Array<{ title: string; url: string; domain: string }>;
  platform_specific: Record<string, unknown>;
};

export const ScorePackLiteBaseSchema = z.object({
  topic: z.string().min(1),
  cn_title: z.string().min(1),
  cn_summary_short: z.string().min(20),
  score_overall: z.number().min(0).max(100),
  action: z.enum(['可写', '可提', '可转', '跳过']),
  reasons: z.array(z.string()).min(1),
  angle_suggestion: z.string(),
});

export const ScorePackFullExtensionSchema = z.object({
  cn_summary_long: z.string().min(50),
  key_points: z.array(z.string()).max(5),
  quotes: z
    .array(
      z.object({
        original: z.string(),
        translated: z.string(),
      }),
    )
    .max(5),
});

export type ScorePackLiteOutput = z.infer<typeof ScorePackLiteBaseSchema> & {
  dimension_scores: Record<string, number>;
};

export type ScorePackFullOutput = ScorePackLiteOutput & z.infer<typeof ScorePackFullExtensionSchema>;

/**
 * Build a dynamic ScorePack Lite schema based on persona dimensions.
 */
export function buildScorePackLiteSchema(persona: Persona) {
  const dimensionKeys = persona.scoring.dimensions.map((d) => d.key);
  const dimensionScoresShape: Record<string, z.ZodNumber> = {};
  for (const key of dimensionKeys) {
    dimensionScoresShape[key] = z.number().min(0).max(100);
  }

  return ScorePackLiteBaseSchema.extend({
    dimension_scores: z.object(dimensionScoresShape).strict(),
    reasons: z.array(z.string()).min(1).max(persona.output.reasons_max),
  });
}

/**
 * Build a dynamic ScorePack Full schema based on persona dimensions.
 */
export function buildScorePackFullSchema(persona: Persona) {
  return buildScorePackLiteSchema(persona).merge(ScorePackFullExtensionSchema).extend({
    quotes: z
      .array(z.object({ original: z.string(), translated: z.string() }))
      .max(persona.output.max_quotes),
  });
}

/**
 * Strip markdown code fences from LLM output.
 */
function stripCodeFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

/**
 * Try to parse and validate JSON from LLM output.
 * Returns the parsed data, or a string error message if it fails.
 */
function tryParse<T>(schema: z.ZodSchema<T>, raw: string): T | string {
  try {
    const json = JSON.parse(raw) as unknown;
    const result = schema.safeParse(json);
    if (result.success) return result.data;
    return result.error.message;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Parse LLM JSON output with one repair-retry on parse or validation failure.
 */
export async function parseWithRetry<T>(
  schema: z.ZodSchema<T>,
  rawOutput: string,
  client: LlmClient,
  systemMessage: string,
): Promise<T> {
  const cleaned = stripCodeFences(rawOutput);

  // First attempt
  const firstResult = tryParse(schema, cleaned);
  if (typeof firstResult !== 'string') return firstResult;

  // Repair retry
  logger.warn({ error: firstResult, raw: cleaned.slice(0, 200) }, 'LLM output invalid, attempting repair');

  const repairPrompt = buildRepairPrompt(firstResult, cleaned);
  let repairResponse;
  try {
    repairResponse = await client.chat([
      { role: 'system', content: systemMessage },
      { role: 'user', content: repairPrompt },
    ]);
  } catch (err) {
    throw new LlmError(`LLM repair call failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const repairedCleaned = stripCodeFences(repairResponse.content);
  const repairedResult = tryParse(schema, repairedCleaned);
  if (typeof repairedResult !== 'string') return repairedResult;

  throw new LlmError('LLM output invalid after repair attempt', {
    original_error: firstResult,
    repair_error: repairedResult,
    raw: repairedCleaned.slice(0, 500),
  });
}
