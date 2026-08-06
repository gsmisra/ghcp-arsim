import Papa from 'papaparse';
import { ParsedCsvFile } from './parsedFile';

export function parseCsv(buffer: Buffer): ParsedCsvFile {
  const text = buffer.toString('utf-8');
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false, // keep every value as a string for lossless re-serialization
  });

  return {
    kind: 'csv',
    columns: result.meta.fields || [],
    rows: result.data,
  };
}
