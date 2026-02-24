import { describe, it, expect } from 'vitest';
import { PersonaSchema } from '../schema.js';

const validPersona = {
  meta: {
    name: 'test_persona',
    display_name: 'Test Persona',
    description: 'A test persona',
  },
  profile: {
    identity: 'A test identity',
    goals: ['Goal 1'],
  },
  scoring: {
    dimensions: [
      { name: 'Dim1', key: 'dim_one', weight: 0.6, description: 'First' },
      { name: 'Dim2', key: 'dim_two', weight: 0.4, description: 'Second' },
    ],
  },
};

describe('PersonaSchema', () => {
  it('accepts valid persona with minimal fields', () => {
    const result = PersonaSchema.safeParse(validPersona);
    expect(result.success).toBe(true);
  });

  it('applies defaults for optional sections', () => {
    const result = PersonaSchema.safeParse(validPersona);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.signals.positive.keywords).toEqual([]);
      expect(result.data.constraints.max_age_days).toBe(7);
      expect(result.data.output.reasons_max).toBe(3);
      expect(result.data.creator_style.platform_default).toBe('wechat');
    }
  });

  it('rejects weights that do not sum to 1.0', () => {
    const bad = {
      ...validPersona,
      scoring: {
        dimensions: [
          { name: 'Dim1', key: 'dim_one', weight: 0.5, description: 'First' },
          { name: 'Dim2', key: 'dim_two', weight: 0.3, description: 'Second' },
        ],
      },
    };
    const result = PersonaSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('sum to 1.0'))).toBe(true);
    }
  });

  it('rejects missing goals', () => {
    const bad = {
      ...validPersona,
      profile: { identity: 'Test', goals: [] },
    };
    const result = PersonaSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects invalid dimension key format', () => {
    const bad = {
      ...validPersona,
      scoring: {
        dimensions: [
          { name: 'Dim1', key: 'Invalid-Key', weight: 1.0, description: 'Bad key' },
        ],
      },
    };
    const result = PersonaSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects invalid meta.name format', () => {
    const bad = {
      ...validPersona,
      meta: { ...validPersona.meta, name: 'Has Spaces' },
    };
    const result = PersonaSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('accepts more than 2 dimensions up to 6', () => {
    const keyNames = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
    const dims = keyNames.map((key, i) => ({
      name: `Dim${i}`,
      key,
      weight: 0.2,
      description: `Dimension ${i}`,
    }));
    const result = PersonaSchema.safeParse({
      ...validPersona,
      scoring: { dimensions: dims },
    });
    expect(result.success).toBe(true);
  });

  it('rejects more than 6 dimensions', () => {
    const keyNames = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const dims = keyNames.map((key, i) => ({
      name: `Dim${i}`,
      key,
      weight: 1 / 7,
      description: `Dimension ${i}`,
    }));
    const result = PersonaSchema.safeParse({
      ...validPersona,
      scoring: { dimensions: dims },
    });
    expect(result.success).toBe(false);
  });
});
