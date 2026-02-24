import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import { SourceError } from '../shared/errors.js';

export interface OpmlFeed {
  url: string;
  title: string;
}

/**
 * Parse OPML XML string and extract all feed URLs.
 * Handles nested outlines (folders).
 */
export function parseOpml(xmlString: string): OpmlFeed[] {
  const dom = new JSDOM(xmlString, { contentType: 'text/xml' });
  const doc = dom.window.document;
  const feeds: OpmlFeed[] = [];

  // Recursively find all outlines with xmlUrl
  function traverse(node: Element): void {
    const outlines = Array.from(node.children).filter(
      (el) => el.tagName.toLowerCase() === 'outline',
    );
    for (const outline of outlines) {
      const xmlUrl = outline.getAttribute('xmlUrl');
      if (xmlUrl) {
        const title =
          outline.getAttribute('title') ??
          outline.getAttribute('text') ??
          xmlUrl;
        feeds.push({ url: xmlUrl, title });
      }
      // Recurse into nested folders
      traverse(outline);
    }
  }

  const body = doc.querySelector('body');
  if (body) {
    traverse(body);
  }

  return feeds;
}

/**
 * Parse OPML from a file path.
 */
export function parseOpmlFile(filePath: string): OpmlFeed[] {
  if (!fs.existsSync(filePath)) {
    throw new SourceError(`OPML file not found: ${filePath}`, { path: filePath });
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return parseOpml(content);
}

/**
 * Parse a file with newline-separated URLs.
 * Skips empty lines and lines starting with #.
 */
export function parseBatchUrlFile(filePath: string): OpmlFeed[] {
  if (!fs.existsSync(filePath)) {
    throw new SourceError(`Batch URL file not found: ${filePath}`, { path: filePath });
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((url) => ({ url, title: url }));
}
