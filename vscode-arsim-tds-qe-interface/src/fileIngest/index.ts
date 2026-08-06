import { AttachedFileMeta } from '../types';
import { ParsedFile } from './parsedFile';
import { parseText } from './textParser';
import { parsePdf } from './pdfParser';
import { parseDocx } from './docxParser';
import { parseCsv } from './csvParser';
import { parseXlsx } from './xlsxParser';
import { detectKind } from './detect';

export { detectKind } from './detect';
export { sliceParsedFile } from './slice';
export { summarizeContent, truncateToLastLine } from './textStats';
export type { ParsedFile } from './parsedFile';

/**
 * Detects "parsing succeeded but there's effectively nothing here" so the
 * UI can warn the user *before* they send, instead of the model getting a
 * near-empty payload and the user only finding out from a confused reply.
 * Most common real-world case: a scanned/photographed document saved as
 * PDF has no text layer at all -- pdfjs (and this extension) can only read
 * embedded text, not pixels; that needs OCR, which is out of scope here.
 */
function detectEmptyContentWarning(parsed: ParsedFile): string | null {
  switch (parsed.kind) {
    case 'pdf': {
      const hasText = parsed.pages.some((p) => p.trim().length > 0);
      return hasText
        ? null
        : 'No extractable text was found on any page. This usually means the PDF is scanned/image-based (a photo or print-to-PDF of a paper document) rather than a text PDF -- reading it would require OCR, which this extension does not perform. Sending it as-is will give the model no real content to work with.';
    }
    case 'docx': {
      return parsed.flattenedText.trim().length > 0
        ? null
        : 'No readable text was found in this document.';
    }
    case 'csv': {
      return parsed.rows.length > 0 ? null : 'No data rows were found in this CSV file.';
    }
    case 'xlsx': {
      const hasRows = parsed.sheets.some((s) => s.rows.length > 0);
      return hasRows ? null : 'No data rows were found in any sheet of this workbook.';
    }
    case 'text': {
      return parsed.lines.some((l) => l.trim().length > 0) ? null : 'This file appears to be empty.';
    }
  }
}

/** Parses a picked file's raw bytes into structured data plus the static
 *  metadata the webview needs to render type-specific range controls. */
export async function parseFile(
  buffer: Buffer,
  fileName: string,
  fileId: string
): Promise<{ parsed: ParsedFile; meta: AttachedFileMeta }> {
  const kind = detectKind(fileName);

  switch (kind) {
    case 'pdf': {
      const parsed = await parsePdf(buffer);
      return {
        parsed,
        meta: {
          fileId,
          fileName,
          kind,
          pageCount: parsed.pages.length,
          warning: detectEmptyContentWarning(parsed),
        },
      };
    }

    case 'docx': {
      const parsed = await parseDocx(buffer);
      return {
        parsed,
        meta: {
          fileId,
          fileName,
          kind,
          pageCount: parsed.approxPageBreaks + 1,
          approxPageBreaks: parsed.approxPageBreaks,
          warning: detectEmptyContentWarning(parsed),
        },
      };
    }

    case 'csv': {
      const parsed = parseCsv(buffer);
      return {
        parsed,
        meta: {
          fileId,
          fileName,
          kind,
          csvColumns: parsed.columns,
          csvTotalRows: parsed.rows.length,
          warning: detectEmptyContentWarning(parsed),
        },
      };
    }

    case 'xlsx': {
      const parsed = parseXlsx(buffer);
      return {
        parsed,
        meta: {
          fileId,
          fileName,
          kind,
          sheets: parsed.sheets.map((s) => ({ name: s.name, columns: s.columns, totalRows: s.rows.length })),
          warning: detectEmptyContentWarning(parsed),
        },
      };
    }

    case 'text':
    default: {
      const parsed = parseText(buffer);
      return {
        parsed,
        meta: {
          fileId,
          fileName,
          kind: 'text',
          totalLines: parsed.lines.length,
          warning: detectEmptyContentWarning(parsed),
        },
      };
    }
  }
}
