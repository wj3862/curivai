import { describe, it, expect } from 'vitest';
import { ConfigSchema, generateDefaultConfig, generateDefaultConfigYaml } from '../config.js';

describe('ConfigSchema', () => {
  it('produces valid defaults from empty object', () => {
    const result = ConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.server.port).toBe(3891);
      expect(result.data.llm.model).toBe('gpt-4.1-mini');
      expect(result.data.scoring.cheap_threshold).toBe(65);
      expect(result.data.db.path).toBe('~/.curivai/curivai.db');
    }
  });

  it('accepts valid overrides', () => {
    const result = ConfigSchema.safeParse({
      server: { port: 8080 },
      llm: { model: 'deepseek-chat' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.server.port).toBe(8080);
      expect(result.data.llm.model).toBe('deepseek-chat');
      // defaults still apply for other fields
      expect(result.data.server.host).toBe('127.0.0.1');
    }
  });

  it('rejects invalid types', () => {
    const result = ConfigSchema.safeParse({
      server: { port: 'not-a-number' },
    });
    expect(result.success).toBe(false);
  });

  it('applies nested defaults for scoring.cheap_weights', () => {
    const result = ConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scoring.cheap_weights.freshness).toBe(0.25);
      expect(result.data.scoring.cheap_weights.keyword_match).toBe(0.3);
    }
  });
});

describe('generateDefaultConfig', () => {
  it('returns a full Config object', () => {
    const config = generateDefaultConfig();
    expect(config.server.port).toBe(3891);
    expect(config.budget.max_llm_calls_per_run).toBe(50);
  });
});

describe('generateDefaultConfigYaml', () => {
  it('returns a YAML string', () => {
    const yaml = generateDefaultConfigYaml();
    expect(yaml).toContain('server');
    expect(yaml).toContain('3891');
    expect(yaml).toContain('llm');
  });
});
