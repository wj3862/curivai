import { z } from 'zod';

const ScoringDimensionSchema = z.object({
  name: z.string().min(1),
  key: z.string().regex(/^[a-z_]+$/),
  weight: z.number().min(0).max(1),
  description: z.string(),
  scoring_hint: z.string().optional(),
});

export const PersonaSchema = z.object({
  meta: z.object({
    name: z.string().regex(/^[a-z0-9_]+$/),
    display_name: z.string(),
    description: z.string(),
    language: z.enum(['zh', 'en']).default('zh'),
    author: z.string().default('curivai'),
    version: z.string().default('1.0'),
    tags: z.array(z.string()).default([]),
    icon: z.string().optional(),
  }),
  profile: z.object({
    identity: z.string(),
    goals: z.array(z.string()).min(1),
    anti_goals: z.array(z.string()).default([]),
  }),
  scoring: z.object({
    dimensions: z
      .array(ScoringDimensionSchema)
      .min(1)
      .max(6)
      .refine((dims) => Math.abs(dims.reduce((s, d) => s + d.weight, 0) - 1.0) < 0.01, {
        message: 'Dimension weights must sum to 1.0',
      }),
  }),
  signals: z
    .object({
      positive: z
        .object({
          keywords: z.array(z.string()).default([]),
          domains: z.array(z.string()).default([]),
        })
        .default({}),
      negative: z
        .object({
          keywords: z.array(z.string()).default([]),
          domains: z.array(z.string()).default([]),
        })
        .default({}),
    })
    .default({}),
  constraints: z
    .object({
      max_age_days: z.number().default(7),
      allow_languages: z.array(z.string()).default(['zh', 'en']),
      min_word_count: z.number().default(100),
    })
    .default({}),
  output: z
    .object({
      preview_max_chars: z.number().default(120),
      reasons_max: z.number().min(1).max(5).default(3),
      max_quotes: z.number().default(3),
      max_quote_words_en: z.number().default(15),
      translation: z.enum(['auto', 'always', 'never']).default('auto'),
    })
    .default({}),
  creator_style: z
    .object({
      tone: z.string().default('专业但不枯燥，有洞察力'),
      structure_hints: z
        .array(z.string())
        .default(['hook', 'summary', 'analysis', 'my_take', 'cta']),
      platform_default: z.enum(['wechat', 'xhs', 'douyin']).default('wechat'),
    })
    .default({}),
});

export type Persona = z.infer<typeof PersonaSchema>;
export type ScoringDimension = z.infer<typeof ScoringDimensionSchema>;
