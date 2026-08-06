import * as crypto from 'crypto';
import { AttachedFileMeta, FileSelection } from '../types';
import { ParsedFile } from './parsedFile';
import { sliceParsedFile } from './slice';

interface AttachedFileEntry {
  meta: AttachedFileMeta;
  parsed: ParsedFile;
  selection: FileSelection;
}

/**
 * In-memory only (deliberately not persisted): attached files are a
 * per-request-authoring convenience, not durable state like Skills or
 * Token History. Keyed by a generated fileId so the webview never needs
 * to know a real filesystem path.
 */
export class AttachedFilesStore {
  private readonly files = new Map<string, AttachedFileEntry>();

  add(meta: AttachedFileMeta, parsed: ParsedFile): void {
    this.files.set(meta.fileId, { meta, parsed, selection: {} });
  }

  get(fileId: string): AttachedFileEntry | undefined {
    return this.files.get(fileId);
  }

  updateSelection(fileId: string, selection: FileSelection): AttachedFileEntry | undefined {
    const entry = this.files.get(fileId);
    if (!entry) return undefined;
    entry.selection = selection;
    return entry;
  }

  remove(fileId: string): void {
    this.files.delete(fileId);
  }

  /** The currently-selected slice of content for this file, or null if unknown/removed. */
  currentContent(fileId: string): string | null {
    const entry = this.files.get(fileId);
    if (!entry) return null;
    return sliceParsedFile(entry.parsed, entry.selection);
  }
}

export function generateFileId(): string {
  return `file-${crypto.randomUUID()}`;
}
