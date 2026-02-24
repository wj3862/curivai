import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildScorePackLiteSchema, buildScorePackFullSchema, parseWithRetry } from '../parse.js';
import type { Persona } from '../../persona/schema.js';
import type { LlmClient } from '../client.js';

const TEST_PERSONA: Persona = {
  meta: {
    name: 'test',
    display_name: 'Test',
    description: 'desc',
    language: 'zh',
    author: 'test',
    version: '1.0',
    tags: [],
  },
  profile: { identity: 'id', goals: ['g'], anti_goals: [] },
  scoring: {
    dimensions: [
      { name: 'D1', key: 'dim_one', weight: 0.6, description: 'd1' },
      { name: 'D2', key: 'dim_two', weight: 0.4, description: 'd2' },
    ],
  },
  signals: { positive: { keywords: [], domains: [] }, negative: { keywords: [], domains: [] } },
  constraints: { max_age_days: 7, allow_languages: ['en'], min_word_count: 100 },
  output: { preview_max_chars: 120, reasons_max: 3, max_quotes: 2, max_quote_words_en: 15, translation: 'auto' },
  creator_style: { tone: 'test', structure_hints: [], platform_default: 'wechat' },
};

const VALID_LITE_OUTPUT = JSON.stringify({
  topic: '测试主题',
  cn_title: '中文标题测试文章',
  cn_summary_short: '这是一个用于测试的中文摘要，需要至少二十个字符才能通过验证',
  dimension_scores: { dim_one: 85, dim_two: 70 },
  score_overall: 79,
  action: '可写',
  reasons: ['理由一', '理由二'],
  angle_suggestion: '从创业角度分析',
});

const VALID_FULL_OUTPUT = JSON.stringify({
  topic: '测试主题',
  cn_title: '中文标题测试文章',
  cn_summary_short: '这是一个用于测试的中文摘要，需要至少二十个字符才能通过验证',
  dimension_scores: { dim_one: 85, dim_two: 70 },
  score_overall: 79,
  action: '可写',
  reasons: ['理由一'],
  angle_suggestion: '从创业角度分析',
  cn_summary_long: '这是一个更长的中文摘要，用于测试Full ScorePack的解析功能，需要至少五十个字符才能通过验证测试',
  key_points: ['要点一', '要点二'],
  quotes: [{ original: 'Short quote here', translated: '简短引用' }],
});

describe('buildScorePackLiteSchema', () => {
  it('creates schema with persona dimensions as strict keys', () => {
    const schema = buildScorePackLiteSchema(TEST_PERSONA);
    const result = schema.safeParse(JSON.parse(VALID_LITE_OUTPUT));
    expect(result.success).toBe(true);
  });

  it('rejects extra dimension keys', () => {
    const schema = buildScorePackLiteSchema(TEST_PERSONA);
    const invalid = JSON.parse(VALID_LITE_OUTPUT);
    invalid.dimension_scores.extra_key = 50;
    expect(schema.safeParse(invalid).success).toBe(false);
  });

  it('rejects missing dimension keys', () => {
    const schema = buildScorePackLiteSchema(TEST_PERSONA);
    const invalid = JSON.parse(VALID_LITE_OUTPUT);
    delete invalid.dimension_scores.dim_two;
    expect(schema.safeParse(invalid).success).toBe(false);
  });

  it('enforces reasons_max from persona', () => {
    const schema = buildScorePackLiteSchema(TEST_PERSONA);
    const tooManyReasons = JSON.parse(VALID_LITE_OUTPUT);
    tooManyReasons.reasons = ['r1', 'r2', 'r3', 'r4']; // > reasons_max of 3
    expect(schema.safeParse(tooManyReasons).success).toBe(false);
  });

  it('rejects invalid action value', () => {
    const schema = buildScorePackLiteSchema(TEST_PERSONA);
    const invalid = JSON.parse(VALID_LITE_OUTPUT);
    invalid.action = '无效动作';
    expect(schema.safeParse(invalid).success).toBe(false);
  });
});

describe('buildScorePackFullSchema', () => {
  it('parses valid full output', () => {
    const schema = buildScorePackFullSchema(TEST_PERSONA);
    const result = schema.safeParse(JSON.parse(VALID_FULL_OUTPUT));
    expect(result.success).toBe(true);
  });

  it('requires cn_summary_long', () => {
    const schema = buildScorePackFullSchema(TEST_PERSONA);
    const invalid = JSON.parse(VALID_FULL_OUTPUT);
    delete invalid.cn_summary_long;
    expect(schema.safeParse(invalid).success).toBe(false);
  });

  it('enforces max_quotes from persona', () => {
    const schema = buildScorePackFullSchema(TEST_PERSONA);
    const tooManyQuotes = JSON.parse(VALID_FULL_OUTPUT);
    tooManyQuotes.quotes = [
      { original: 'q1', translated: 'q1t' },
      { original: 'q2', translated: 'q2t' },
      { original: 'q3', translated: 'q3t' }, // > max_quotes of 2
    ];
    expect(schema.safeParse(tooManyQuotes).success).toBe(false);
  });
});

describe('parseWithRetry', () => {
  const mockClient = {
    chat: vi.fn(),
  } as unknown as LlmClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses valid JSON on first attempt', async () => {
    const schema = buildScorePackLiteSchema(TEST_PERSONA);
    const result = await parseWithRetry(schema, VALID_LITE_OUTPUT, mockClient, 'system');
    expect(result.cn_title).toBe('中文标题测试文章');
    expect(result.score_overall).toBe(79);
    expect(mockClient.chat).not.toHaveBeenCalled(); // no repair needed
  });

  it('strips markdown code fences before parsing', async () => {
    const schema = buildScorePackLiteSchema(TEST_PERSONA);
    const withFences = `\`\`\`json\n${VALID_LITE_OUTPUT}\n\`\`\``;
    const result = await parseWithRetry(schema, withFences, mockClient, 'system');
    expect(result.cn_title).toBe('中文标题测试文章');
  });

  it('attempts repair on parse failure and succeeds', async () => {
    const schema = buildScorePackLiteSchema(TEST_PERSONA);
    (mockClient.chat as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: VALID_LITE_OUTPUT,
      model: 'test',
      token_count: 10,
      cost_estimate: 0,
    });

    const invalidJson = '{ "cn_title": "title", invalid json here }';
    const result = await parseWithRetry(schema, invalidJson, mockClient, 'system');
    expect(result.cn_title).toBe('中文标题测试文章');
    expect(mockClient.chat).toHaveBeenCalledOnce(); // repair was called
  });

  it('throws LlmError after failed repair', async () => {
    const schema = buildScorePackLiteSchema(TEST_PERSONA);
    (mockClient.chat as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: 'still invalid json }{',
      model: 'test',
      token_count: 10,
      cost_estimate: 0,
    });

    await expect(parseWithRetry(schema, 'bad json {', mockClient, 'system')).rejects.toThrow();
  });
});
