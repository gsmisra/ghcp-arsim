import * as vscode from 'vscode';
import * as os from 'os';
import { TokenHistoryEntry, TokenUsage, WorkflowId } from '../types';

const HISTORY_FILE_NAME = 'token-usage-history.json';
const DEFAULT_MAX_ENTRIES = 2000;

/**
 * Durable log of every chat interaction's token usage.
 *
 * Design notes (why a file, not `globalState`):
 * `context.globalState` is meant for small key/value settings, not an
 * append-only log that grows for the life of the install -- writing the
 * whole state blob on every request would be wasteful and VS Code doesn't
 * document a size ceiling we'd want to bet on. Instead this writes a plain
 * JSON array under the extension's dedicated `globalStorageUri` directory,
 * which VS Code guarantees is a writable, extension-private, persistent
 * location on disk.
 *
 * Durability strategy: rather than relying solely on a clean-shutdown hook
 * (VS Code's `deactivate()` is not guaranteed to run to completion on a
 * hard kill / crash / forced window close), entries are flushed to disk
 * immediately after being recorded. `deactivate()` still calls `flush()`
 * as a final best-effort safety net for anything not yet written.
 */
export class TokenHistoryStore {
  private entries: TokenHistoryEntry[] = [];
  private loaded = false;
  private dirty = false;
  private readonly storageUri: vscode.Uri;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.storageUri = vscode.Uri.joinPath(context.globalStorageUri, HISTORY_FILE_NAME);
  }

  private maxEntries(): number {
    return vscode.workspace
      .getConfiguration('arsimTdsQe')
      .get<number>('maxTokenHistoryEntries', DEFAULT_MAX_ENTRIES);
  }

  async load(): Promise<TokenHistoryEntry[]> {
    if (this.loaded) {
      return this.entries;
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(this.storageUri);
      const parsed = JSON.parse(Buffer.from(bytes).toString('utf-8'));
      if (Array.isArray(parsed)) {
        this.entries = parsed;
      }
    } catch {
      // No history file yet (first run) or it's unreadable -- start clean
      // rather than failing extension activation over telemetry data.
      this.entries = [];
    }
    this.loaded = true;
    return this.entries;
  }

  /** Newest-first, for display. */
  getAllNewestFirst(): TokenHistoryEntry[] {
    return [...this.entries].reverse();
  }

  record(params: {
    workflowId: WorkflowId;
    workflowLabel: string;
    modelName: string;
    usage: TokenUsage;
  }): TokenHistoryEntry {
    const entry: TokenHistoryEntry = {
      timestamp: new Date().toISOString(),
      hostname: safeHostname(),
      workflowId: params.workflowId,
      workflowLabel: params.workflowLabel,
      modelName: params.modelName,
      promptTokens: params.usage.promptTokens,
      completionTokens: params.usage.completionTokens,
      totalTokens: params.usage.totalTokens,
    };

    this.entries.push(entry);

    const cap = this.maxEntries();
    if (this.entries.length > cap) {
      this.entries.splice(0, this.entries.length - cap);
    }

    this.dirty = true;
    return entry;
  }

  clear(): void {
    this.entries = [];
    this.dirty = true;
  }

  /** Best-effort write; never throws -- a failed flush must not break the extension. */
  async flush(): Promise<void> {
    if (!this.dirty) {
      return;
    }
    try {
      await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);
      const body = Buffer.from(JSON.stringify(this.entries, null, 2), 'utf-8');
      await vscode.workspace.fs.writeFile(this.storageUri, body);
      this.dirty = false;
    } catch {
      // Swallow: history is a convenience feature, not a correctness
      // requirement for the extension's core chat functionality.
    }
  }
}

function safeHostname(): string {
  try {
    return os.hostname() || 'unknown-host';
  } catch {
    return 'unknown-host';
  }
}
