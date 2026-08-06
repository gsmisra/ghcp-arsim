import * as XLSX from 'xlsx';
import { ParsedXlsxFile } from './parsedFile';

export function parseXlsx(buffer: Buffer): ParsedXlsxFile {
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  const sheets = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
      defval: '',
      raw: false, // format values as displayed strings rather than raw numbers/dates
    });
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { name, columns, rows };
  });

  return { kind: 'xlsx', sheets };
}
