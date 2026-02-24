/**
 * Email sender — converts DigestData to MJML HTML and sends via nodemailer.
 * Only used when config.delivery.email.enabled = true.
 */

import nodemailer from 'nodemailer';
import mjml2html from 'mjml';
import type { DigestData, DigestItem } from '../engine/digest.js';
import { logger } from '../shared/logger.js';

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    可写: '🟢 可写',
    可提: '🟡 可提',
    可转: '🟠 可转',
    跳过: '⚪ 跳过',
  };
  return map[action] ?? action;
}

function renderItemRow(item: DigestItem): string {
  return `
    <mj-section padding="8px 24px 0">
      <mj-column>
        <mj-text padding="0 0 4px" font-size="15px" font-weight="bold" line-height="1.4">
          <a href="${item.url}" style="color:#1a1a1a;text-decoration:none;">
            ${item.cn_title || item.title}
          </a>
        </mj-text>
        <mj-text padding="0 0 4px" font-size="12px" color="#888888">
          ${actionLabel(item.action)} &nbsp;·&nbsp; 评分 ${item.score_overall}
          ${item.source_domain ? `&nbsp;·&nbsp; ${item.source_domain}` : ''}
        </mj-text>
        <mj-text padding="0 0 4px" font-size="13px" color="#444444" line-height="1.6">
          ${item.cn_summary_short}
        </mj-text>
        ${
          item.angle_suggestion
            ? `<mj-text padding="0 0 8px" font-size="12px" color="#0066cc">
                💡 ${item.angle_suggestion}
               </mj-text>`
            : '<mj-text padding="0 0 8px"> </mj-text>'
        }
        <mj-divider border-color="#eeeeee" border-width="1px" padding="0" />
      </mj-column>
    </mj-section>`;
}

function buildMjml(digests: DigestData[], date: string): string {
  const personaSections = digests
    .filter((d) => d.items.length > 0)
    .map(
      (d) => `
    <mj-section background-color="#f8f9fa" padding="16px 24px 8px">
      <mj-column>
        <mj-text font-size="18px" font-weight="bold" color="#1a1a1a">
          ${d.icon ?? ''} ${d.display_name}
        </mj-text>
        <mj-text font-size="12px" color="#888888" padding-top="0">
          过去 ${d.days} 天共评分 ${d.total_scored} 篇 · 本期精选 ${d.items.length} 篇
        </mj-text>
      </mj-column>
    </mj-section>
    ${d.items.map(renderItemRow).join('\n')}
    <mj-section padding="8px 24px">
      <mj-column>
        <mj-spacer height="8px" />
      </mj-column>
    </mj-section>`,
    )
    .join('\n');

  return `
<mjml>
  <mj-head>
    <mj-title>CurivAI 每日情报 ${date}</mj-title>
    <mj-attributes>
      <mj-all font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" />
      <mj-text color="#1a1a1a" font-size="14px" line-height="1.6" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#ffffff">
    <!-- Header -->
    <mj-section background-color="#1a1a1a" padding="20px 24px">
      <mj-column>
        <mj-text color="#ffffff" font-size="22px" font-weight="bold">
          CurivAI 每日情报
        </mj-text>
        <mj-text color="#aaaaaa" font-size="13px" padding-top="4px">
          ${date} · 你的 AI 信息管家
        </mj-text>
      </mj-column>
    </mj-section>

    ${personaSections}

    <!-- Footer -->
    <mj-section background-color="#f8f9fa" padding="16px 24px">
      <mj-column>
        <mj-text font-size="11px" color="#aaaaaa" align="center">
          本邮件由 CurivAI 自动生成 · 内容仅供参考，请查阅原文核实
          <br/>
          <a href="http://localhost:3891" style="color:#aaaaaa;">打开 CurivAI 网页版</a>
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
}

export interface EmailConfig {
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass: string;
  from: string;
  to: string[];
}

export async function sendDigestEmail(
  digests: DigestData[],
  emailConfig: EmailConfig,
): Promise<void> {
  const date = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const mjmlSource = buildMjml(digests, date);
  const { html, errors } = mjml2html(mjmlSource, { validationLevel: 'soft' });

  if (errors.length > 0) {
    logger.warn({ errors }, 'MJML compilation warnings');
  }

  const transporter = nodemailer.createTransport({
    host: emailConfig.smtp_host,
    port: emailConfig.smtp_port,
    secure: emailConfig.smtp_port === 465,
    auth: {
      user: emailConfig.smtp_user,
      pass: emailConfig.smtp_pass,
    },
  });

  const totalItems = digests.reduce((sum, d) => sum + d.items.length, 0);

  await transporter.sendMail({
    from: emailConfig.from,
    to: emailConfig.to.join(', '),
    subject: `CurivAI 每日情报 ${date} · ${totalItems} 篇精选`,
    html,
  });

  logger.info(
    { to: emailConfig.to, items: totalItems, date },
    'Digest email sent',
  );
}

/**
 * Render digest as plain markdown string (for CLI / file output).
 */
export function renderDigestMarkdown(digests: DigestData[]): string {
  const date = new Date().toLocaleDateString('zh-CN');
  const lines: string[] = [`# CurivAI 每日情报 ${date}`, ''];

  for (const d of digests) {
    if (d.items.length === 0) continue;
    lines.push(`## ${d.icon ?? ''} ${d.display_name}`);
    lines.push(`> 过去 ${d.days} 天共评分 ${d.total_scored} 篇 · 本期精选 ${d.items.length} 篇`);
    lines.push('');

    for (const item of d.items) {
      lines.push(`### ${item.cn_title || item.title}`);
      lines.push(`**评分**: ${item.score_overall} · **建议**: ${item.action}`);
      lines.push(`**来源**: [${item.source_domain ?? item.url}](${item.url})`);
      lines.push('');
      lines.push(item.cn_summary_short);
      lines.push('');
      if (item.angle_suggestion) {
        lines.push(`💡 **创作角度**: ${item.angle_suggestion}`);
        lines.push('');
      }
      lines.push('---');
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Verify SMTP connection without sending.
 */
export async function verifySmtp(emailConfig: EmailConfig): Promise<boolean> {
  const transporter = nodemailer.createTransport({
    host: emailConfig.smtp_host,
    port: emailConfig.smtp_port,
    secure: emailConfig.smtp_port === 465,
    auth: { user: emailConfig.smtp_user, pass: emailConfig.smtp_pass },
  });
  try {
    await transporter.verify();
    return true;
  } catch {
    return false;
  }
}
