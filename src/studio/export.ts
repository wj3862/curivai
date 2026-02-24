import type { ComposeOutput } from '../llm/parse.js';
import type { Draft } from './drafts.js';

// ============================================================
// Templates (inline as constants — no file I/O at runtime)
// ============================================================

const WECHAT_TEMPLATE = `# {{title}}

> {{hook_line}}

{{content_md}}

---

**信息来源**

{{sources_list}}

---

*本文由 CurivAI 辅助整理，作者观点基于公开信息分析。*

💬 你怎么看？欢迎在评论区分享你的观点。`;

const XHS_TEMPLATE = `{{title}} 🔥

{{content_md}}

---
来源: {{source_names_inline}}

{{tags_line}}`;

const DOUYIN_TEMPLATE = `{{content_md}}

---
素材来源: {{source_names_inline}}`;

// ============================================================
// Render
// ============================================================

/**
 * Render the compose output into a platform-specific export string.
 */
export function renderExport(composeOutput: ComposeOutput, draft: Draft): string {
  const title = composeOutput.title_candidates[0] ?? draft.title ?? '无标题';
  const sourcesList = composeOutput.sources
    .map((s) => `- [${s.title}](${s.url}) — ${s.domain}`)
    .join('\n');
  const sourceNamesInline = composeOutput.sources.map((s) => s.title).join(' / ');
  const tagsLine = composeOutput.tags.map((t) => `#${t}`).join(' ');

  switch (draft.draft_type) {
    case 'wechat': {
      return WECHAT_TEMPLATE.replace('{{title}}', title)
        .replace('{{hook_line}}', extractHookLine(composeOutput.content_md))
        .replace('{{content_md}}', composeOutput.content_md)
        .replace('{{sources_list}}', sourcesList);
    }

    case 'xhs': {
      return XHS_TEMPLATE.replace('{{title}}', title)
        .replace('{{content_md}}', composeOutput.content_md)
        .replace('{{source_names_inline}}', sourceNamesInline)
        .replace('{{tags_line}}', tagsLine);
    }

    case 'douyin': {
      const ps = composeOutput.platform_specific as DouyinPlatformSpecific | undefined;
      if (ps?.hook_0_3s || ps?.segments) {
        return renderDouyin(ps, sourceNamesInline);
      }
      // Fallback: use content_md
      return DOUYIN_TEMPLATE.replace('{{content_md}}', composeOutput.content_md).replace(
        '{{source_names_inline}}',
        sourceNamesInline,
      );
    }

    default:
      return composeOutput.content_md;
  }
}

// ============================================================
// Douyin-specific rendering
// ============================================================

interface DouyinSegment {
  voiceover: string;
  subtitle: string;
  shot_suggestion: string;
}

interface DouyinPlatformSpecific {
  hook_0_3s?: string;
  segments?: DouyinSegment[];
  cta?: string;
}

function renderDouyin(ps: DouyinPlatformSpecific, sourceNamesInline: string): string {
  const lines: string[] = [];

  if (ps.hook_0_3s) {
    lines.push('[0-3s HOOK]');
    lines.push(ps.hook_0_3s);
    lines.push('');
  }

  if (ps.segments) {
    ps.segments.forEach((seg, i) => {
      lines.push(`[SEGMENT ${i + 1} | 15-20s]`);
      if (seg.shot_suggestion) lines.push(`画面: ${seg.shot_suggestion}`);
      if (seg.voiceover) lines.push(`旁白: ${seg.voiceover}`);
      if (seg.subtitle) lines.push(`字幕: ${seg.subtitle}`);
      lines.push('');
    });
  }

  if (ps.cta) {
    lines.push('[CTA]');
    lines.push(ps.cta);
    lines.push('');
  }

  lines.push('---');
  lines.push(`素材来源: ${sourceNamesInline}`);

  return lines.join('\n');
}

// ============================================================
// Helpers
// ============================================================

/**
 * Extract first sentence/line as a hook from content_md.
 */
function extractHookLine(contentMd: string): string {
  // Try to find first non-empty, non-heading line
  const lines = contentMd.split('\n');
  for (const line of lines) {
    const stripped = line.replace(/^#+\s*/, '').trim();
    if (stripped && stripped.length > 10) {
      // Return first sentence (up to '。' or '.')
      const sentenceEnd = stripped.search(/[。.!！]/);
      if (sentenceEnd !== -1 && sentenceEnd < 100) {
        return stripped.slice(0, sentenceEnd + 1);
      }
      return stripped.slice(0, 80);
    }
  }
  return '';
}
