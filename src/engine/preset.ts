import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { parse as yamlParse } from 'yaml';
import { getPackageRoot } from '../shared/utils.js';
import { StudioError } from '../shared/errors.js';
import { runAutopilot } from './autopilot.js';
import type { Config } from '../shared/config.js';
import type { AutopilotPlan } from './autopilot.js';
import type { DraftType, MergeStrategy } from '../studio/drafts.js';

// ============================================================
// Preset Schema
// ============================================================

export const PresetConfigSchema = z.object({
  name: z.string(),
  display_name: z.string(),
  description: z.string(),
  radar_pack: z.string().optional(),
  persona: z.string(),
  days: z.number().int().positive().default(7),
  lite_budget: z.number().int().positive().default(30),
  auto_pick_count: z.number().int().positive().default(5),
  auto_pick_filter: z.string().default('可写'),
  merge_strategy: z.enum(['roundup', 'brief', 'compare']).default('roundup'),
  export_format: z.enum(['wechat', 'xhs', 'douyin']).default('wechat'),
});

export type PresetConfig = z.infer<typeof PresetConfigSchema>;

/**
 * List all available presets from the built-in presets directory.
 */
export function listPresets(): PresetConfig[] {
  const presetsDir = path.join(getPackageRoot(), 'presets');

  if (!fs.existsSync(presetsDir)) {
    return [];
  }

  const files = fs.readdirSync(presetsDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  const presets: PresetConfig[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(presetsDir, file), 'utf-8');
      const parsed = yamlParse(content) as unknown;
      const result = PresetConfigSchema.safeParse(parsed);
      if (result.success) {
        presets.push(result.data);
      }
    } catch {
      // Skip invalid preset files
    }
  }

  return presets;
}

/**
 * Load a preset by name.
 */
export function loadPreset(name: string): PresetConfig {
  const presets = listPresets();
  const preset = presets.find((p) => p.name === name);

  if (!preset) {
    const available = presets.map((p) => p.name).join(', ');
    throw new StudioError(`Preset not found: ${name}. Available: ${available || '(none)'}`);
  }

  return preset;
}

/**
 * Run a preset — loads its config and calls runAutopilot with preset params.
 */
export async function runPreset(
  name: string,
  opts: { out?: string; yes?: boolean },
  config: Config,
  onPlan?: (plan: AutopilotPlan) => Promise<boolean>,
): Promise<string> {
  const preset = loadPreset(name);

  const result = await runAutopilot(
    {
      persona: preset.persona,
      type: preset.export_format as DraftType,
      budget: preset.lite_budget,
      days: preset.days,
      autoPickCount: preset.auto_pick_count,
      autoPickFilter: preset.auto_pick_filter,
      mergeStrategy: preset.merge_strategy as MergeStrategy,
      yes: opts.yes ?? false,
      title: `${preset.display_name} — ${new Date().toLocaleDateString('zh-CN')}`,
    },
    config,
    onPlan,
  );

  if (opts.out) {
    fs.writeFileSync(opts.out, result.content, 'utf-8');
  }

  return result.content;
}
