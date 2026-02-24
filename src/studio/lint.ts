import type { Draft } from './drafts.js';

export interface LintResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Lint export content before writing to the exports table.
 * Hard errors block export; warnings are logged but allowed.
 *
 * @param content - The rendered export content string
 * @param draft - The draft being exported
 * @param pickedItemUrls - The URLs of all picked items that should appear in content
 */
export function lintExport(content: string, _draft: Draft, pickedItemUrls: string[]): LintResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Rule 1: Sources section must exist as a section header/label.
  // Checks for attribution at start of a line (with optional markdown decorators).
  // This prevents matching the word 来源 embedded in the middle of a sentence.
  const hasAttribution =
    /(?:^|\n)[\s#*_]*(?:来源|信息来源|Sources|sources)[\s*_]*(?:\n|$|:)/m.test(content) ||
    content.includes('**来源**') ||
    content.includes('**信息来源**') ||
    content.includes('**Sources**') ||
    content.includes('## 来源') ||
    content.includes('## 信息来源');

  if (!hasAttribution) {
    errors.push('缺少来源归因部分 (Missing source attribution section: 来源/信息来源/Sources)');
  }

  // Rule 2: Every picked item URL must appear in content
  for (const url of pickedItemUrls) {
    if (url && !content.includes(url)) {
      errors.push(`缺少来源链接: ${url} (Picked item URL not found in export content)`);
    }
  }

  // Rule 3: Suspected full-translation detection (warning only)
  // Heuristic: paragraphs > 200 chars without Chinese commentary markers
  const chineseCommentaryMarkers = [
    '我认为',
    '我觉得',
    '值得注意',
    '换句话说',
    '总的来说',
    '重要的是',
    '这意味着',
    '对我们来说',
    '从这个角度',
    '有趣的是',
    '值得关注',
    '笔者认为',
    '作者认为',
    '编者按',
    '简单来说',
    '说白了',
    '也就是说',
    '在我看来',
  ];

  const paragraphs = content.split(/\n\n+/);
  let suspiciousParagraphCount = 0;
  for (const para of paragraphs) {
    const stripped = para.replace(/[#*>`_\-[\]()!]/g, '').trim();
    if (stripped.length > 200) {
      const hasCommentary = chineseCommentaryMarkers.some((marker) => stripped.includes(marker));
      if (!hasCommentary) {
        suspiciousParagraphCount++;
      }
    }
  }

  if (suspiciousParagraphCount >= 3) {
    warnings.push(
      `检测到 ${suspiciousParagraphCount} 个长段落缺少原创评论标记，可能存在整段直译 (Suspected full-translation: long paragraphs without commentary markers)`,
    );
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
  };
}
