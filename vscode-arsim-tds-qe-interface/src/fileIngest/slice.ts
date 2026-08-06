import { FileSelection } from '../types';
import { ParsedFile } from './parsedFile';

function clampRange(from: number | undefined, to: number | undefined, total: number): [number, number] {
  const safeTotal = Math.max(total, 1);
  let f = from && from > 0 ? Math.floor(from) : 1;
  let t = to && to > 0 ? Math.floor(to) : safeTotal;
  f = Math.max(1, Math.min(f, safeTotal));
  t = Math.max(1, Math.min(t, safeTotal));
  if (t < f) [f, t] = [t, f];
  return [f, t];
}

function csvCell(value: unknown): string {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowsToDelimitedText(columns: string[], rows: Record<string, string>[]): string {
  const header = columns.join(',');
  const lines = rows.map((r) => columns.map((c) => csvCell(r[c])).join(','));
  return [header, ...lines].join('\n');
}

/**
 * Produces the exact text that will be sent for an attached file, honoring
 * the user's chosen range/columns/sheets. Every branch defaults to "send
 * everything" when the user hasn't opened "Control the data sent in the
 * context" yet, except xlsx, which defaults to just the first sheet --
 * workbooks can be large enough across sheets that silently including all
 * of them by default would be a surprising, budget-eating default.
 */
export function sliceParsedFile(parsed: ParsedFile, selection: FileSelection): string {
  switch (parsed.kind) {
    case 'text': {
      const [from, to] = clampRange(selection.lineFrom, selection.lineTo, parsed.lines.length);
      return parsed.lines.slice(from - 1, to).join('\n');
    }

    case 'pdf': {
      const [from, to] = clampRange(selection.pageFrom, selection.pageTo, parsed.pages.length);
      return parsed.pages
        .slice(from - 1, to)
        .map((text, i) => `--- Page ${from + i} ---\n${text.trim() || '(no extractable text on this page)'}`)
        .join('\n\n');
    }

    case 'docx': {
      if (!selection.pageFrom && !selection.pageTo) {
        return parsed.flattenedText;
      }
      // Approximate pagination: divide the flattened text evenly across
      // (manual page breaks + 1) segments. See ParsedDocxFile's doc
      // comment -- .docx has no stored page boundaries to slice on exactly.
      const totalPages = parsed.approxPageBreaks + 1;
      const [from, to] = clampRange(selection.pageFrom, selection.pageTo, totalPages);
      const lines = parsed.flattenedText.split('\n');
      const perPage = Math.max(1, Math.ceil(lines.length / totalPages));
      const startLine = (from - 1) * perPage;
      const endLine = Math.min(lines.length, to * perPage);
      return lines.slice(startLine, endLine).join('\n');
    }

    case 'csv': {
      const columns = selection.csvColumns && selection.csvColumns.length > 0 ? selection.csvColumns : parsed.columns;
      const [from, to] = clampRange(selection.csvRowFrom, selection.csvRowTo, parsed.rows.length);
      return rowsToDelimitedText(columns, parsed.rows.slice(from - 1, to));
    }

    case 'xlsx': {
      const hasExplicitSelection = !!selection.sheetSelections && Object.keys(selection.sheetSelections).length > 0;
      const sheetsToInclude = hasExplicitSelection
        ? parsed.sheets.filter((s) => selection.sheetSelections![s.name])
        : parsed.sheets.slice(0, 1);

      const sections = sheetsToInclude.map((sheet) => {
        const sel = selection.sheetSelections?.[sheet.name];
        const columns = sel?.columns && sel.columns.length > 0 ? sel.columns : sheet.columns;
        const [from, to] = clampRange(sel?.rowFrom, sel?.rowTo, sheet.rows.length);
        return `--- Sheet: ${sheet.name} ---\n${rowsToDelimitedText(columns, sheet.rows.slice(from - 1, to))}`;
      });
      return sections.join('\n\n');
    }
  }
}
