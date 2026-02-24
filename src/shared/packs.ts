import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { parse as yamlParse } from 'yaml';
import { getPackageRoot } from './utils.js';
import { ConfigError } from './errors.js';

const RadarPackSourceSchema = z.object({
  url: z.string().url(),
  title: z.string(),
});

export const RadarPackSchema = z.object({
  name: z.string(),
  display_name: z.string(),
  description: z.string(),
  sources: z.array(RadarPackSourceSchema).min(1),
});

export type RadarPack = z.infer<typeof RadarPackSchema>;
export type RadarPackSource = z.infer<typeof RadarPackSourceSchema>;

const IndexSchema = z.object({
  packs: z.array(
    z.object({
      name: z.string(),
      file: z.string(),
    }),
  ),
});

function getPacksDir(): string {
  return path.join(getPackageRoot(), 'radar_packs');
}

export function listAvailablePacks(): Array<{ name: string; file: string }> {
  const indexPath = path.join(getPacksDir(), 'index.yaml');
  if (!fs.existsSync(indexPath)) {
    throw new ConfigError(`Radar packs index not found: ${indexPath}`);
  }

  const raw = yamlParse(fs.readFileSync(indexPath, 'utf-8')) as unknown;
  const parsed = IndexSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError('Invalid radar packs index.yaml', {
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  return parsed.data.packs;
}

export function loadRadarPack(packName: string): RadarPack {
  const packs = listAvailablePacks();
  const entry = packs.find((p) => p.name === packName);
  if (!entry) {
    throw new ConfigError(`Radar pack not found: ${packName}. Available: ${packs.map((p) => p.name).join(', ')}`);
  }

  const filePath = path.join(getPacksDir(), entry.file);
  if (!fs.existsSync(filePath)) {
    throw new ConfigError(`Radar pack file not found: ${filePath}`);
  }

  const raw = yamlParse(fs.readFileSync(filePath, 'utf-8')) as unknown;
  const parsed = RadarPackSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(`Invalid radar pack: ${packName}`, {
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  return parsed.data;
}
