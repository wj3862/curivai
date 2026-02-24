import { describe, it, expect } from 'vitest';
import { resolvePath, sha1, generateId, nowISO, getPackageRoot } from '../utils.js';
import { homedir } from 'node:os';
import path from 'node:path';

describe('resolvePath', () => {
  it('expands ~ to home directory', () => {
    const result = resolvePath('~/test');
    expect(result).toBe(path.join(homedir(), 'test'));
  });

  it('expands bare ~ to home directory', () => {
    const result = resolvePath('~');
    expect(result).toBe(path.join(homedir(), ''));
  });

  it('resolves relative paths', () => {
    const result = resolvePath('./foo/bar');
    expect(path.isAbsolute(result)).toBe(true);
  });

  it('returns absolute paths as-is', () => {
    const result = resolvePath('/absolute/path');
    expect(result).toBe('/absolute/path');
  });
});

describe('sha1', () => {
  it('produces consistent 40-char hex', () => {
    const hash = sha1('hello');
    expect(hash).toHaveLength(40);
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });

  it('produces same hash for same input', () => {
    expect(sha1('test')).toBe(sha1('test'));
  });

  it('produces different hash for different input', () => {
    expect(sha1('a')).not.toBe(sha1('b'));
  });
});

describe('generateId', () => {
  it('generates string of default length', () => {
    const id = generateId();
    expect(id).toHaveLength(21);
  });

  it('generates string of custom length', () => {
    const id = generateId(10);
    expect(id).toHaveLength(10);
  });

  it('generates unique IDs', () => {
    const a = generateId();
    const b = generateId();
    expect(a).not.toBe(b);
  });
});

describe('nowISO', () => {
  it('returns formatted date string', () => {
    const now = nowISO();
    expect(now).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe('getPackageRoot', () => {
  it('returns a path containing package.json', () => {
    const root = getPackageRoot();
    expect(root).toContain('curivai');
  });
});
