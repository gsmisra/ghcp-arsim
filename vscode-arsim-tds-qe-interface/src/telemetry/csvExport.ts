import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { TokenHistoryEntry } from '../types';

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv(entries: TokenHistoryEntry[]): string {
  const header = ['Timestamp', 'Workflow', 'Model', 'Sent Tokens', 'Received Tokens', 'Total Tokens', 'Host'];
  const lines = [header.join(',')];
  for (const e of entries) {
    lines.push(
      [
        csvEscape(e.timestamp),
        csvEscape(e.workflowLabel),
        csvEscape(e.modelName),
        String(e.promptTokens),
        String(e.completionTokens),
        String(e.totalTokens),
        csvEscape(e.hostname),
      ].join(',')
    );
  }
  // CRLF line endings: the conventional, most broadly-compatible choice for
  // CSV (Excel on Windows in particular expects it).
  return lines.join('\r\n') + '\r\n';
}

/**
 * Writes the given rows as CSV to the current OS user's Downloads folder,
 * matching the literal ask ("download ... to the downloads folder"). Done
 * in the extension host (trusted, has real filesystem access) rather than
 * via a webview <a download> -- webviews cannot target an arbitrary OS
 * folder directly, and even where a save dialog could work, going through
 * the host keeps this deterministic and testable.
 */
export async function exportTokenHistoryToDownloads(entries: TokenHistoryEntry[]): Promise<vscode.Uri> {
  const csv = toCsv(entries);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `token-usage-history-${stamp}.csv`;

  const downloadsUri = vscode.Uri.file(path.join(os.homedir(), 'Downloads'));
  // Safe even if it already exists (no-op); guards against the rare
  // environment where a Downloads folder isn't pre-provisioned.
  await vscode.workspace.fs.createDirectory(downloadsUri);

  const fileUri = vscode.Uri.joinPath(downloadsUri, fileName);
  await vscode.workspace.fs.writeFile(fileUri, Buffer.from(csv, 'utf-8'));
  return fileUri;
}

/**
 * Generic header+rows -> CSV -> Downloads-folder writer, factored out of
 * `exportTokenHistoryToDownloads` above so the PROD Incident Analysis
 * chat's "Download as CSV" (on an LLM-produced markdown table parsed
 * client-side) can reuse the exact same file-writing behavior instead of a
 * second implementation.
 */
export async function exportRowsToDownloads(
  headers: string[],
  rows: string[][],
  fileNameHint: string
): Promise<vscode.Uri> {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(','));
  }
  const csv = lines.join('\r\n') + '\r\n';

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeHint = fileNameHint.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '') || 'export';
  const fileName = `${safeHint}-${stamp}.csv`;

  const downloadsUri = vscode.Uri.file(path.join(os.homedir(), 'Downloads'));
  await vscode.workspace.fs.createDirectory(downloadsUri);

  const fileUri = vscode.Uri.joinPath(downloadsUri, fileName);
  await vscode.workspace.fs.writeFile(fileUri, Buffer.from(csv, 'utf-8'));
  return fileUri;
}
