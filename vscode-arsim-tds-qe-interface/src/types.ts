/**
 * Shared type definitions used across the extension host, the webview
 * message protocol, and the workflow/wizard modules.
 *
 * Keeping these in one file gives the extension <-> webview boundary a
 * single source of truth so the message contract can't silently drift.
 */

export type WorkflowId =
  | 'generic'
  | 'test-case-creation'
  | 'automation-script-creation'
  | 'pr-analysis'
  | 'prod-incident-analysis'
  | 'test-failure-analysis';

export interface WorkflowDefinition {
  id: WorkflowId;
  label: string;
  description: string;
  /** Sent to the model as the system/role framing message. */
  systemPrompt: string;
  /** Short placeholder shown in the prompt textarea for this workflow. */
  inputPlaceholder: string;
}

export interface ModelInfo {
  /** Stable composite id: `${vendor}:${id||family}` -- used for selection round-trips. */
  uid: string;
  id: string;
  name: string;
  vendor: string;
  family: string;
}

export type GithubFileKind = 'skill' | 'instruction' | 'prompt';

export interface GithubFileRef {
  kind: GithubFileKind;
  /** Workspace-relative path, e.g. .github/skills/api-contract-review.md */
  relativePath: string;
  /** File name only, shown in the UI list. */
  fileName: string;
}

export interface GithubFileContent extends GithubFileRef {
  content: string;
  truncated: boolean;
}

export type WizardFieldType = 'text' | 'textarea' | 'select' | 'list';

export interface WizardFieldSchema {
  key: string;
  label: string;
  type: WizardFieldType;
  help?: string;
  placeholder?: string;
  required?: boolean;
  /** For type: 'select' */
  options?: { value: string; label: string }[];
  /** For type: 'list' -- rendered as one-item-per-line textarea, split into an array on save. */
  defaultValue?: string;
}

export interface WizardStepSchema {
  title: string;
  description: string;
  fields: WizardFieldSchema[];
}

export interface WizardSchema {
  kind: GithubFileKind;
  title: string;
  steps: WizardStepSchema[];
}

/**
 * Token accounting for a single request. Counts come from the selected
 * model's own tokenizer via `vscode.lm`'s `LanguageModelChat.countTokens`
 * -- the same tokenizer the model itself uses -- so these are real counts
 * for that model, not a generic/approximate estimate.
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Running totals across every request sent in this VS Code install (persisted). */
export interface SessionTokenTotals {
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * One row of durable token-usage history. Captured in memory as each chat
 * request completes and flushed to a local JSON file under the extension's
 * global storage directory -- so "closing the extension" (window reload,
 * VS Code shutdown, machine restart) never loses data, without requiring a
 * clean-shutdown hook to fire.
 */
export interface TokenHistoryEntry {
  timestamp: string; // ISO 8601
  hostname: string;
  workflowId: WorkflowId;
  workflowLabel: string;
  modelName: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type AttachedFileKind = 'pdf' | 'docx' | 'csv' | 'xlsx' | 'text';

/**
 * Static facts about a file the user picked via Browse, sent once right
 * after parsing so the "Control the data sent in the context" panel can
 * render the right controls for the detected type (page range for
 * pdf/docx, column+row range for csv, per-sheet column+row range for
 * xlsx). Never includes the file's actual content -- that stays server
 * side and is only summarized via `AttachedFilePreview`.
 */
export interface AttachedFileMeta {
  fileId: string;
  fileName: string;
  kind: AttachedFileKind;
  /** pdf: exact page count. docx: an approximation, see `approxPageBreaks`. */
  pageCount?: number;
  /** docx only: count of manual page-break markers found in the document XML.
   *  Word does not store real page boundaries in .docx (pagination is computed
   *  at render/print time), so any "page" concept here is a labeled approximation. */
  approxPageBreaks?: number;
  totalLines?: number; // text
  csvColumns?: string[];
  csvTotalRows?: number;
  sheets?: { name: string; columns: string[]; totalRows: number }[]; // xlsx
  /**
   * Set when parsing succeeded but found little or no usable content --
   * most commonly a scanned/image-based PDF (no text layer for pdfjs to
   * extract; that needs OCR, which this extension does not do) or an
   * otherwise-empty document/spreadsheet. Surfaced in the UI *before* the
   * user sends, rather than letting them discover it from a confused model
   * reply after the fact.
   */
  warning?: string | null;
}

/** User-chosen slice of an attached file's content to actually send. */
export interface FileSelection {
  pageFrom?: number; // pdf (exact) / docx (approximate)
  pageTo?: number;
  lineFrom?: number; // generic text
  lineTo?: number;
  csvColumns?: string[]; // empty/omitted = all columns
  csvRowFrom?: number;
  csvRowTo?: number;
  sheetSelections?: Record<string, { columns?: string[]; rowFrom?: number; rowTo?: number }>;
}

/** Result of applying a FileSelection: what will actually be sent. */
export interface AttachedFilePreview {
  fileId: string;
  charCount: number;
  lineCount: number;
  lastLineIncluded: string;
}

/** Extension -> Webview messages */
export type HostMessage =
  | { type: 'init'; workflows: WorkflowDefinition[]; defaultWorkflow: WorkflowId; wizards: WizardSchema[] }
  | { type: 'models'; models: ModelInfo[]; error?: string }
  | { type: 'files'; skills: GithubFileRef[]; instructions: GithubFileRef[]; prompts: GithubFileRef[] }
  | { type: 'promptContent'; file: GithubFileRef; content: string }
  | { type: 'streamStart'; requestId: string }
  | { type: 'streamChunk'; requestId: string; text: string }
  | { type: 'promptTokenCounted'; requestId: string; promptTokens: number }
  | { type: 'streamDone'; requestId: string; contextSummary: ContextSummary; usage: TokenUsage; session: SessionTokenTotals }
  | { type: 'streamError'; requestId: string; message: string }
  | { type: 'testConnectionResult'; ok: boolean; model?: string; response?: string; error?: string; usage?: TokenUsage }
  | { type: 'wizardSaved'; kind: GithubFileKind; relativePath: string }
  | { type: 'wizardError'; message: string }
  | { type: 'tokenSession'; session: SessionTokenTotals }
  | { type: 'tokenHistory'; entries: TokenHistoryEntry[] }
  | { type: 'fileParsing' }
  | { type: 'fileAttached'; meta: AttachedFileMeta; preview: AttachedFilePreview }
  | { type: 'fileSelectionUpdated'; preview: AttachedFilePreview }
  | { type: 'fileAttachError'; message: string }
  | { type: 'fileCleared' }
  | {
      type: 'contextMeter';
      usedTokens: number;
      maxTokens: number | null;
      exceeded: boolean;
      lastLineIncluded: string | null;
    }
  | { type: 'toast'; level: 'info' | 'warn' | 'error'; message: string };

/** Webview -> Extension messages */
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'listModels' }
  | { type: 'refreshFiles' }
  | { type: 'loadPrompt'; file: GithubFileRef }
  | { type: 'savePrompt'; file: GithubFileRef | null; fileName: string; content: string }
  | {
      type: 'sendPrompt';
      requestId: string;
      workflowId: WorkflowId;
      modelUid: string;
      userText: string;
      selectedSkills: GithubFileRef[];
      selectedInstructions: GithubFileRef[];
      selectedPromptFile: GithubFileRef | null;
      attachedFileId: string | null;
    }
  | { type: 'testConnection'; modelUid: string }
  | { type: 'saveWizardFile'; kind: GithubFileKind; data: Record<string, string> }
  | { type: 'resetTokenSession' }
  | { type: 'loadTokenHistory' }
  | { type: 'clearTokenHistory' }
  | { type: 'exportTokenHistoryCsv'; entries: TokenHistoryEntry[] }
  | { type: 'browseFile' }
  | { type: 'updateFileSelection'; fileId: string; selection: FileSelection }
  | { type: 'clearAttachedFile'; fileId: string }
  | {
      type: 'estimateContext';
      workflowId: WorkflowId;
      modelUid: string;
      userText: string;
      selectedSkills: GithubFileRef[];
      selectedInstructions: GithubFileRef[];
      selectedPromptFile: GithubFileRef | null;
      attachedFileId: string | null;
    };

export interface ContextSummary {
  modelName: string;
  workflowLabel: string;
  skillsIncluded: number;
  instructionsIncluded: number;
  usedPromptFile: boolean;
  attachedFileName: string | null;
  approxCharsSent: number;
  truncatedFiles: string[];
  /** Last full line of the attached file's content that fit within budget, when truncated. */
  attachedFileLastLine: string | null;
  /** Whether the total/attached-file character budget this request used was
   *  derived from the selected model's real token window, or fell back to
   *  the static configured ceiling (e.g. the model didn't report maxInputTokens). */
  budgetSource: 'model' | 'config';
  /** The effective total character budget actually applied for this request. */
  effectiveMaxTotalChars: number;
}
