import { ParsedTextFile } from './parsedFile';

export function parseText(buffer: Buffer): ParsedTextFile {
  const content = buffer.toString('utf-8');
  return { kind: 'text', lines: content.split(/\r\n|\r|\n/) };
}
