import * as mammoth from 'mammoth';
import JSZip from 'jszip';
import { ParsedDocxFile } from './parsedFile';

/**
 * Flattens mammoth's HTML output to plain text, preserving structure the
 * model can still make sense of: paragraphs/headings become lines, table
 * rows become tab-separated lines. This is a small hand-rolled flattener
 * (not a full HTML parser) because mammoth's output vocabulary is narrow
 * and predictable -- p/h1-6/li/table/tr/td/th/br plus inline formatting
 * tags we don't care about.
 */
function flattenMammothHtml(html: string): string {
  let text = html;
  // Table cells -> tab-separated, rows -> newline-separated.
  text = text.replace(/<\/(td|th)>/gi, '\t');
  text = text.replace(/<\/tr>/gi, '\n');
  // Block-level elements -> newline-separated.
  text = text.replace(/<\/(p|h1|h2|h3|h4|h5|h6|li)>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  // Strip every remaining tag (opening table/tr/td/ul/ol/inline formatting tags).
  text = text.replace(/<[^>]+>/g, '');
  // Decode the small set of entities mammoth actually emits.
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
  // Collapse trailing tabs per line and excess blank lines.
  text = text
    .split('\n')
    .map((line) => line.replace(/\t+$/g, '').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text;
}

async function countManualPageBreaks(buffer: Buffer): Promise<number> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const docXmlFile = zip.file('word/document.xml');
    if (!docXmlFile) return 0;
    const xml = await docXmlFile.async('string');
    const matches = xml.match(/<w:br\b[^>]*w:type="page"[^>]*\/?>/g);
    return matches ? matches.length : 0;
  } catch {
    // Non-fatal: page-range control just won't be offered for this file.
    return 0;
  }
}

export async function parseDocx(buffer: Buffer): Promise<ParsedDocxFile> {
  const [{ value: html }, approxPageBreaks] = await Promise.all([
    mammoth.convertToHtml({ buffer }),
    countManualPageBreaks(buffer),
  ]);

  return {
    kind: 'docx',
    flattenedText: flattenMammothHtml(html),
    approxPageBreaks,
  };
}
