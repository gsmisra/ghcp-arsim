import { AttachedFilePreview } from '../types';

/** Shared by the file-attach preview and by contextBuilder's truncation
 *  reporting, so "last line included" always means the same thing everywhere. */
export function summarizeContent(fileId: string, content: string): AttachedFilePreview {
  const trimmed = content.replace(/\s+$/, '');
  const lines = trimmed.split('\n');
  return {
    fileId,
    charCount: content.length,
    lineCount: lines.length,
    lastLineIncluded: lines[lines.length - 1] || '',
  };
}

/** Clips `text` to at most `maxChars`, backing off to the last full line
 *  boundary so we never hand the model (or the user) a mid-word fragment.
 *  Returns the clipped text plus the last full line that made the cut. */
export function truncateToLastLine(text: string, maxChars: number): { clipped: string; lastLine: string; truncated: boolean } {
  if (text.length <= maxChars) {
    const lines = text.split('\n');
    return { clipped: text, lastLine: lines[lines.length - 1] || '', truncated: false };
  }
  const slice = text.slice(0, maxChars);
  const lastNewline = slice.lastIndexOf('\n');
  const clipped = lastNewline > 0 ? slice.slice(0, lastNewline) : slice;
  const lines = clipped.split('\n');
  return { clipped, lastLine: lines[lines.length - 1] || '', truncated: true };
}
