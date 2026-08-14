import { AttachedFileMeta, FileSelection, JiraChunkKind } from '../types';
import { ParsedFile } from '../fileIngest/parsedFile';
import { sliceParsedFile } from '../fileIngest/slice';

/**
 * Host-side counterpart to the webview's JiraChunkMeta[] -- holds the
 * actual content (or, for an attachment, the structured ParsedFile plus
 * whatever range/sheet selection the user applied). Deliberately a
 * separate, additive store rather than a generalization of
 * AttachedFilesStore: this workflow needs *multiple simultaneously
 * selectable* chunks, and AttachedFilesStore/state.attachedFile is
 * threaded through the Browse-file feature as a single slot everywhere in
 * the webview -- keeping this separate means zero risk to that working
 * feature. One active session at a time (reset on every new fetch),
 * mirroring how AttachedFilesStore is scoped to "whatever's currently
 * attached", just for a list instead of one file.
 */
export interface JiraChunkEntry {
  id: string;
  label: string;
  kind: JiraChunkKind;
  /** ac / description / linked-ticket: plain flattened text. */
  content?: string;
  /** attachment: structured content, sliced on demand via sliceParsedFile
   *  (the same function the Browse-file feature already uses). */
  parsed?: ParsedFile;
  meta?: AttachedFileMeta;
  selection?: FileSelection;
}

export class JiraContextStore {
  private chunks: JiraChunkEntry[] = [];

  /** Replaces the whole chunk set (a fresh ticket fetch). Which chunks are
   *  *selected* is tracked client-side only (state.jiraWizard.selectedChunkIds
   *  in main.js) and sent fresh with every sendPrompt/estimateContext call
   *  -- the exact same "selection lives in the webview, read live at call
   *  time" pattern already used for Skills/Instructions, so there's no
   *  separate selection state to keep in sync here. */
  reset(chunks: JiraChunkEntry[]): void {
    this.chunks = chunks;
  }

  getAll(): JiraChunkEntry[] {
    return this.chunks;
  }

  get(id: string): JiraChunkEntry | undefined {
    return this.chunks.find((c) => c.id === id);
  }

  updateAttachmentSelection(id: string, selection: FileSelection): JiraChunkEntry | undefined {
    const chunk = this.chunks.find((c) => c.id === id && c.kind === 'attachment');
    if (!chunk) return undefined;
    chunk.selection = selection;
    return chunk;
  }

  /** Current content for one chunk, honoring its selection if it's an
   *  attachment -- used both for building the actual context and for
   *  reporting a fresh char count after a range/sheet selection changes. */
  currentContent(id: string): string {
    const chunk = this.chunks.find((c) => c.id === id);
    if (!chunk) return '';
    return chunk.parsed ? sliceParsedFile(chunk.parsed, chunk.selection || {}) : chunk.content || '';
  }

  /** Given the ids the webview currently has checked, resolves them to
   *  content ready for buildContext()'s jiraChunks param. Empty-content
   *  chunks are dropped rather than sent as empty sections; unknown ids
   *  (stale after a new fetch) are silently ignored. */
  contentFor(ids: string[]): { label: string; content: string }[] {
    const wanted = new Set(ids);
    return this.chunks
      .filter((c) => wanted.has(c.id))
      .map((c) => ({ label: c.label, content: this.currentContent(c.id) }))
      .filter((c) => c.content.trim().length > 0);
  }

  clear(): void {
    this.chunks = [];
  }
}
