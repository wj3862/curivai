import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { nanoid } from 'nanoid';

export function generateId(size = 21): string {
  return nanoid(size);
}

export function resolvePath(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(homedir(), p.slice(1));
  }
  return path.resolve(p);
}

export function sha1(input: string): string {
  return createHash('sha1').update(input, 'utf8').digest('hex');
}

export function nowISO(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export function getPackageRoot(): string {
  // When running as a pkg executable (process.pkg is set by the pkg bundler)
  if ((process as NodeJS.Process & { pkg?: unknown }).pkg) {
    // process.argv[1] = /snapshot/dist/cli.js → go up one level → /snapshot/
    return path.resolve(path.dirname(process.argv[1]!), '..');
  }
  // Walk up from the current file to find the directory containing package.json.
  // Works for both tsx (src/shared/utils.ts) and tsup bundle (dist/cli.js).
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  // Fallback: original two-levels-up from src/shared/utils.ts
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

export function getCurivaiDir(): string {
  return resolvePath('~/.curivai');
}
