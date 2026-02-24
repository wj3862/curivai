import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
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
  const thisFile = fileURLToPath(import.meta.url);
  // src/shared/utils.ts → project root (2 levels up from src/)
  return path.resolve(path.dirname(thisFile), '..', '..');
}

export function getCurivaiDir(): string {
  return resolvePath('~/.curivai');
}
