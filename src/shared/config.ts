import { z } from 'zod';
import { cosmiconfig } from 'cosmiconfig';
import fs from 'node:fs';
import path from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import { resolvePath, getCurivaiDir } from './utils.js';
import { ConfigError } from './errors.js';
import { logger } from './logger.js';

export const ConfigSchema = z.object({
  server: z
    .object({
      port: z.number().default(3891),
      host: z.string().default('127.0.0.1'),
    })
    .default({}),

  llm: z
    .object({
      base_url: z.string().default(''),
      api_key: z.string().default(''),
      model: z.string().default('gpt-4.1-mini'),
      max_tokens: z.number().default(1500),
      temperature: z.number().default(0.3),
      timeout_ms: z.number().default(30000),
      max_concurrent: z.number().default(3),
    })
    .default({}),

  ingest: z
    .object({
      default_concurrency: z.number().default(5),
      content_excerpt_chars: z.number().default(3000),
      fetch_timeout_ms: z.number().default(15000),
      user_agent: z.string().default('CurivAI/1.0'),
    })
    .default({}),

  scoring: z
    .object({
      cheap_threshold: z.number().default(65),
      min_candidates: z.number().default(5),
      default_budget: z.number().default(30),
      default_days: z.number().default(3),
      cheap_weights: z
        .object({
          freshness: z.number().default(0.25),
          keyword_match: z.number().default(0.3),
          source_trust: z.number().default(0.2),
          language_match: z.number().default(0.1),
          length_sanity: z.number().default(0.1),
          duplicate_penalty: z.number().default(0.05),
        })
        .default({}),
      topic_dedup: z
        .object({
          lookback_days: z.number().default(7),
          exact_penalty: z.number().default(30),
          fuzzy_threshold: z.number().default(0.6),
          fuzzy_penalty: z.number().default(15),
        })
        .default({}),
    })
    .default({}),

  budget: z
    .object({
      max_llm_calls_per_run: z.number().default(50),
      max_cost_usd_per_run: z.number().default(0.2),
      cost_per_call_estimate: z.number().default(0.001),
    })
    .default({}),

  schedule: z
    .object({
      ingest_cron: z.string().default('0 */4 * * *'),
      digest_cron: z.string().default('0 8 * * *'),
    })
    .default({}),

  delivery: z
    .object({
      email: z
        .object({
          enabled: z.boolean().default(false),
          smtp_host: z.string().default(''),
          smtp_port: z.number().default(587),
          smtp_user: z.string().default(''),
          smtp_pass: z.string().default(''),
          from: z.string().default('digest@curivai.app'),
          to: z.array(z.string()).default([]),
        })
        .default({}),
    })
    .default({}),

  db: z
    .object({
      path: z.string().default('~/.curivai/curivai.db'),
    })
    .default({}),

  personas_dir: z.string().default('~/.curivai/personas/'),
});

export type Config = z.infer<typeof ConfigSchema>;

let cachedConfig: Config | null = null;

export function generateDefaultConfig(): Config {
  return ConfigSchema.parse({});
}

export function generateDefaultConfigYaml(): string {
  const defaults = generateDefaultConfig();
  return yamlStringify(defaults);
}

export function writeDefaultConfig(configPath: string): void {
  const yaml = generateDefaultConfigYaml();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, yaml, 'utf-8');
}

export async function loadConfig(force = false): Promise<Config> {
  if (cachedConfig && !force) return cachedConfig;

  const explorer = cosmiconfig('curivai', {
    searchPlaces: [
      'curivai.config.yaml',
      'curivai.config.yml',
      '.curivairc.yaml',
      '.curivairc.yml',
    ],
  });

  const envConfigPath = process.env['CURIVAI_CONFIG'];
  const defaultConfigPath = path.join(getCurivaiDir(), 'config.yaml');

  let rawConfig: Record<string, unknown> = {};

  if (envConfigPath) {
    const resolved = resolvePath(envConfigPath);
    if (fs.existsSync(resolved)) {
      const result = await explorer.load(resolved);
      rawConfig = (result?.config as Record<string, unknown>) ?? {};
    } else {
      throw new ConfigError(`Config file not found: ${resolved}`);
    }
  } else if (fs.existsSync(defaultConfigPath)) {
    const result = await explorer.load(defaultConfigPath);
    rawConfig = (result?.config as Record<string, unknown>) ?? {};
  } else {
    logger.debug('No config file found, using defaults');
  }

  // Override LLM settings from env vars
  const envApiKey = process.env['CURIVAI_LLM_API_KEY'];
  const envBaseUrl = process.env['CURIVAI_LLM_BASE_URL'];
  const envModel = process.env['CURIVAI_LLM_MODEL'];

  if (envApiKey || envBaseUrl || envModel) {
    const llm = (rawConfig['llm'] as Record<string, unknown>) ?? {};
    if (envApiKey) llm['api_key'] = envApiKey;
    if (envBaseUrl) llm['base_url'] = envBaseUrl;
    if (envModel) llm['model'] = envModel;
    rawConfig['llm'] = llm;
  }

  const parsed = ConfigSchema.safeParse(rawConfig);
  if (!parsed.success) {
    throw new ConfigError('Invalid configuration', {
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  cachedConfig = parsed.data;
  return cachedConfig;
}

export function resetConfigCache(): void {
  cachedConfig = null;
}

/**
 * Persist config to ~/.curivai/config.yaml and update in-memory cache.
 */
export function saveConfig(config: Config): void {
  const configPath = path.join(getCurivaiDir(), 'config.yaml');
  const yaml = yamlStringify(config as unknown as Record<string, unknown>);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, yaml, 'utf-8');
  cachedConfig = config;
}

/**
 * Deep-merge a plain-object patch into a target object in place.
 */
export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (sv !== null && typeof sv === 'object' && !Array.isArray(sv) &&
        tv !== null && typeof tv === 'object' && !Array.isArray(tv)) {
      deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>);
    } else {
      target[key] = sv;
    }
  }
}
