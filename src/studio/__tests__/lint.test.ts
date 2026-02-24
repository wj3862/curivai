import { describe, it, expect } from 'vitest';
import { lintExport } from '../lint.js';
import type { Draft } from '../drafts.js';

const baseDraft: Draft = {
  id: 'test-draft-id',
  persona_name: 'ai_entrepreneur',
  draft_type: 'wechat',
  title: 'Test Draft',
  selected_item_ids_json: '["item1","item2"]',
  selected_item_ids: ['item1', 'item2'],
  merge_strategy: 'roundup',
  user_commentary: null,
  compose_json: null,
  content_md: null,
  created_at: '2024-01-01 00:00:00',
  updated_at: '2024-01-01 00:00:00',
};

describe('lintExport', () => {
  describe('Rule 1: Attribution section required', () => {
    it('passes when content contains **来源** header', () => {
      const content = `# 标题\n\n一些内容\n\n**来源**\n\n- [Source](https://example.com)`;
      const result = lintExport(content, baseDraft, ['https://example.com']);
      expect(result.errors.some((e) => e.includes('Missing source attribution'))).toBe(false);
    });

    it('passes when content contains **信息来源** header', () => {
      const content = `内容\n\n**信息来源**\n\n- [Source](https://example.com)`;
      const result = lintExport(content, baseDraft, ['https://example.com']);
      expect(result.errors.some((e) => e.includes('Missing source attribution'))).toBe(false);
    });

    it('passes when content contains Sources on its own line', () => {
      const content = `内容\n\nSources\n\n- [Source](https://example.com)`;
      const result = lintExport(content, baseDraft, ['https://example.com']);
      expect(result.errors.some((e) => e.includes('Missing source attribution'))).toBe(false);
    });

    it('fails when no attribution section is present', () => {
      const content = `# 标题\n\n这是文章正文内容，不包含任何来源章节标记。`;
      // Note: the word '来源' is embedded in a sentence, not as a section header
      // The linter should detect this as missing attribution
      const result = lintExport(content, baseDraft, []);
      expect(result.passed).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Missing source attribution');
    });

    it('fails when content has no attribution whatsoever', () => {
      const content = `# 标题\n\n文章正文，完全没有参考资料标注。`;
      const result = lintExport(content, baseDraft, []);
      expect(result.passed).toBe(false);
      expect(result.errors[0]).toContain('Missing source attribution');
    });
  });

  describe('Rule 2: Picked item URLs must be in content', () => {
    it('passes when all URLs are present', () => {
      const url1 = 'https://techcrunch.com/article/1';
      const url2 = 'https://theverge.com/article/2';
      const content = `内容\n\n来源\n\n- [TC](${url1})\n- [Verge](${url2})`;
      const result = lintExport(content, baseDraft, [url1, url2]);
      expect(result.errors).toHaveLength(0);
    });

    it('fails when a picked URL is missing from content', () => {
      const url1 = 'https://techcrunch.com/article/1';
      const url2 = 'https://theverge.com/article/2';
      const content = `内容\n\n来源\n\n- [TC](${url1})`; // url2 missing
      const result = lintExport(content, baseDraft, [url1, url2]);
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes(url2))).toBe(true);
    });

    it('passes when pickedItemUrls is empty', () => {
      const content = `内容\n\n来源\n\n- [Source](https://example.com)`;
      const result = lintExport(content, baseDraft, []);
      expect(result.errors.filter((e) => e.includes('URL not found'))).toHaveLength(0);
    });

    it('ignores empty string URLs', () => {
      const content = `内容\n\n来源`;
      const result = lintExport(content, baseDraft, ['', '']);
      expect(result.errors.filter((e) => e.includes('URL not found'))).toHaveLength(0);
    });
  });

  describe('Rule 3: Full-translation warning', () => {
    it('warns when many long paragraphs lack Chinese commentary markers', () => {
      // Create 3+ long paragraphs without any commentary markers (no 我认为, 值得注意, etc.)
      // These simulate raw translation without creator's commentary
      const longPara =
        'OpenAI宣布完成了一轮新的融资，总额达到四百亿美元，由软银领投，其他多家知名投资机构跟投。' +
        '本轮融资完成后，OpenAI的估值将超过三千亿美元，创下全球人工智能领域的最高估值纪录。' +
        '公司表示，这笔资金将主要用于扩大计算基础设施规模以及加速下一代模型的研发进程，同时还将投入到安全研究和政策合规工作中去。' +
        '据悉，OpenAI计划在未来十二个月内将其数据中心的计算能力提升三倍，并招募更多顶尖的工程师和研究员加入团队。';

      const content = `**来源**\n\n${longPara}\n\n${longPara}\n\n${longPara}\n\n${longPara}`;
      const result = lintExport(content, baseDraft, []);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes('直译'))).toBe(true);
    });

    it('does not warn when paragraphs contain commentary markers', () => {
      const contentWithCommentary = `我认为这是一个非常重要的趋势，值得注意的是，从各方面来看，这代表了一个重大转变。这也意味着我们需要重新审视我们的方法和策略，特别是在考虑到市场的变化和技术的发展时。换句话说，我们必须保持灵活性并适应不断变化的环境，这对于长期成功至关重要，尤其是在当前的竞争激烈的市场中。`;

      const content = `内容\n\n来源\n\n${contentWithCommentary}\n\n${contentWithCommentary}\n\n${contentWithCommentary}`;
      const result = lintExport(content, baseDraft, []);
      // Should not warn since commentary markers are present
      expect(result.warnings.filter((w) => w.includes('直译'))).toHaveLength(0);
    });
  });

  describe('passed flag', () => {
    it('is true when no errors', () => {
      const url = 'https://example.com/article';
      const content = `内容\n\n来源\n\n- [Source](${url})`;
      const result = lintExport(content, baseDraft, [url]);
      expect(result.passed).toBe(true);
    });

    it('is false when there are errors', () => {
      const content = `文章正文，完全没有参考资料标注`;
      const result = lintExport(content, baseDraft, []);
      expect(result.passed).toBe(false);
    });
  });
});
