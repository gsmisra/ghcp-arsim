/**
 * Internal, server-side-only representation of a parsed file's structured
 * content. Never crosses the webview boundary (only `AttachedFileMeta` /
 * `AttachedFilePreview` from src/types.ts do) -- this keeps the full file
 * content out of the webview entirely, which never needs it directly.
 */

export interface ParsedTextFile {
  kind: 'text';
  lines: string[];
}

export interface ParsedPdfFile {
  kind: 'pdf';
  /** 1 entry per page, in order. Real page boundaries (PDFs store these). */
  pages: string[];
}

export interface ParsedDocxFile {
  kind: 'docx';
  /** Full flattened text: paragraphs as lines, tables as tab-separated rows. */
  flattenedText: string;
  /** Count of manual <w:br w:type="page"/> markers found in the raw XML. */
  approxPageBreaks: number;
}

export interface ParsedCsvFile {
  kind: 'csv';
  columns: string[];
  rows: Record<string, string>[];
}

export interface ParsedXlsxFile {
  kind: 'xlsx';
  sheets: { name: string; columns: string[]; rows: Record<string, string>[] }[];
}

export type ParsedFile =
  | ParsedTextFile
  | ParsedPdfFile
  | ParsedDocxFile
  | ParsedCsvFile
  | ParsedXlsxFile;
