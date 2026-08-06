import { AttachedFileKind } from '../types';

export function detectKind(fileName: string): AttachedFileKind {
  const ext = fileName.toLowerCase().split('.').pop() || '';
  switch (ext) {
    case 'pdf':
      return 'pdf';
    case 'docx':
      return 'docx';
    case 'csv':
      return 'csv';
    case 'xlsx':
    case 'xls':
      return 'xlsx';
    default:
      return 'text';
  }
}
